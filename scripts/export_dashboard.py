"""Run the models ONCE on three real storms and write the dashboard's data files.

    python scripts/export_dashboard.py

The dashboard never runs a model. It replays what this script computed:

    frontend/src/data/scenarios.json   - three storm replays: observed solar wind + Dst,
                                         M1 forecasts, M2 NavIC error, alert decisions
    frontend/src/data/analysis.json    - everything plotted on the Data analysis page

Models used:
    M1  models/m1_xgb.pkl (XGBoost, Dst one hour ahead)          - run on real OMNI data
    M2  plan.md polynomial (Dst -> NavIC error, x1.5 after sunset) - computed from M1's forecast
    GNSS models/gnss_model/lgbm_c3_h10.txt (LightGBM)              - importance + test metrics only;
        it cannot be run on these storms because the repo has no GNSS receiver data.
Alert rules are read from frontend/src/config/alert_rules.json.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from solarshield.config import GNSS_MODEL_DIR  # noqa: E402
from solarshield.data.omni import load_omni  # noqa: E402
from solarshield.models import m1_storm  # noqa: E402

OUT = ROOT / "frontend" / "src" / "data"
RULES = json.loads((ROOT / "frontend" / "src" / "config" / "alert_rules.json").read_text())

# Three test-set storms (2021-2024 were never used for training), one per severity class.
# "impact" = the hourly OMNI row where the solar wind speed and pressure jump (shock arrival).
SCENARIOS = [
    {"id": "may2024", "name": "May 2024", "title": "10–11 May 2024 superstorm", "impact": "2024-05-10 17:00"},
    {"id": "apr2023", "name": "Apr 2023", "title": "23–24 April 2023 intense storm", "impact": "2023-04-23 18:00"},
    {"id": "nov2021", "name": "Nov 2021", "title": "3–4 November 2021 moderate storm", "impact": "2021-11-03 20:00"},
]
BEFORE_H, AFTER_H = 6, 24

SITES = [
    {"id": "blr", "name": "Bengaluru", "kind": "receiver", "lat": 13.02, "lon": 77.57},
    {"id": "hyd", "name": "Hyderabad", "kind": "receiver", "lat": 17.42, "lon": 78.55},
    {"id": "amd", "name": "Ahmedabad", "kind": "receiver", "lat": 23.03, "lon": 72.55},
    {"id": "del", "name": "New Delhi", "kind": "receiver", "lat": 28.61, "lon": 77.21},
    {"id": "ccu", "name": "Kolkata", "kind": "receiver", "lat": 22.57, "lon": 88.36},
    {"id": "trv", "name": "Thiruvananthapuram", "kind": "receiver", "lat": 8.52, "lon": 76.94},
    {"id": "kerala", "name": "Kerala flood rescue", "kind": "disaster", "lat": 9.5, "lon": 76.4},
    {"id": "odisha", "name": "Odisha cyclone response", "kind": "disaster", "lat": 19.81, "lon": 85.83},
    {"id": "assam", "name": "Assam flood relief", "kind": "disaster", "lat": 26.14, "lon": 91.74},
]


def r(x, d=1):
    """Round for JSON; NaN -> None."""
    if x is None or (isinstance(x, float) and np.isnan(x)):
        return None
    return round(float(x), d)


def rl(values, d=1):
    return [r(v, d) for v in values]


# ---------------- M2 (plan.md) ----------------
M2_DST = np.array([-5, -30, -50, -63, -100, -150, -204, -300, -412], float)
M2_ERR = np.array([2.5, 5, 12, 64.06, 35, 42, 45, 65, 80], float)
M2_COEFFS = np.polyfit(M2_DST, M2_ERR, 2)


def ist_hour(ts: pd.Timestamp) -> float:
    return (ts.hour + ts.minute / 60 + 5.5) % 24


def m2_multiplier(ts: pd.Timestamp) -> float:
    h = ist_hour(ts)
    return 1.5 if (h >= 18 or h < 6) else 1.0


def m2_error(dst: float, ts: pd.Timestamp) -> float:
    return max(float(np.polyval(M2_COEFFS, dst)), 2.0) * m2_multiplier(ts)


# ---------------- alert rules ----------------
OPS = {">": np.greater, ">=": np.greater_equal, "<": np.less, "<=": np.less_equal}


def _eval(cond, ctx) -> bool:
    if cond.get("always"):
        return True
    if "all" in cond:
        return all(_eval(c, ctx) for c in cond["all"])
    if "any" in cond:
        return any(_eval(c, ctx) for c in cond["any"])
    if "flag" in cond:
        return bool(ctx[cond["flag"]]) == cond["equals"]
    return bool(OPS[cond["op"]](ctx[cond["metric"]], cond["value"]))


def classify(error_m: float, disaster: bool) -> str:
    ctx = {"navic_error_m": error_m, "disaster_active": disaster}
    for level in RULES["levels"]:
        if _eval(level["when"], ctx):
            return level["id"]
    raise ValueError("no alert level matched")


LEVEL_RANK = {lvl["id"]: len(RULES["levels"]) - 1 - i for i, lvl in enumerate(RULES["levels"])}  # GREEN 0 .. RED 3


# ---------------- helpers ----------------
def metrics(y, p) -> dict:
    y, p = np.asarray(y, float), np.asarray(p, float)
    err = p - y
    ss = ((y - y.mean()) ** 2).sum()
    return {
        "mae": r(np.abs(err).mean(), 2),
        "rmse": r(np.sqrt((err**2).mean()), 2),
        "r2": r(1 - (err**2).sum() / ss, 3) if ss > 0 else None,
    }


def shue(p, bz):
    p = np.maximum(p, 0.1)
    return (10.22 + 1.29 * np.tanh(0.184 * (bz + 8.14))) * p ** (-1 / 6.6)


def main() -> None:
    omni = load_omni()
    data = m1_storm.build_dataset(omni)
    splits = m1_storm.split_by_year(data)
    model = m1_storm.load_model()
    booster = model.get_booster()
    feats = m1_storm.FEATURES

    # ======================= scenarios =======================
    scenarios = []
    for sc in SCENARIOS:
        t_imp = pd.Timestamp(sc["impact"])
        win = omni.loc[t_imp - pd.Timedelta(hours=BEFORE_H): t_imp + pd.Timedelta(hours=AFTER_H)].copy()
        nxt = omni["dst"].shift(-1).loc[win.index]
        X = win[feats[:-1]].assign(dst_lag1=win["dst"])
        ok = X.notna().all(axis=1)
        pred = pd.Series(np.nan, index=win.index)
        pred[ok] = m1_storm.predict_dst_next(model, X[ok])

        hourly = []
        for t, row in win.iterrows():
            target = t + pd.Timedelta(hours=1)
            p = pred[t]
            entry = {
                "t": t.isoformat() + "Z",
                "inputs": {k: r(row[k], 2) for k in ["bz", "proton_density", "sw_speed", "dyn_pressure"]},
                "dst_obs": r(row["dst"], 0),
                "magnetopause_re": r(shue(row["dyn_pressure"], row["bz"]), 2) if not np.isnan(row["dyn_pressure"]) else None,
            }
            if not np.isnan(p):
                err_fc = m2_error(p, target)
                err_obs = m2_error(nxt[t], target) if not np.isnan(nxt[t]) else None
                entry["m1"] = {"forecast_for": target.isoformat() + "Z", "dst_pred": r(p, 1), "dst_obs_at_target": r(nxt[t], 0)}
                entry["m2"] = {
                    "forecast_for": target.isoformat() + "Z",
                    "navic_error_m": r(err_fc, 1),
                    "multiplier": m2_multiplier(target),
                    "navic_error_from_observed_m": r(err_obs, 1),
                }
                entry["alerts"] = {"disaster": classify(err_fc, True), "receiver": classify(err_fc, False)}
                if err_obs is not None:
                    entry["alerts_if_observed"] = {"disaster": classify(err_obs, True), "receiver": classify(err_obs, False)}
            else:
                entry["m1"] = entry["m2"] = entry["alerts"] = None
            hourly.append(entry)

        # results
        valid = pred.notna() & nxt.notna()
        y, p = nxt[valid].values, pred[valid].values
        persist = win["dst"][valid].values
        idx = list(win.index)
        first_obs_storm = next((i for i, t in enumerate(idx) if win["dst"][t] < -50), None)
        first_fc_storm = next((i for i, t in enumerate(idx) if not np.isnan(pred[t]) and pred[t] < -50), None)
        first_red = next((i for i, h in enumerate(hourly) if h["alerts"] and h["alerts"]["disaster"] == "RED"), None)
        min_i = int(np.argmin(win["dst"].values))
        storm_mask = y < -50
        scenarios.append(
            {
                **{k: sc[k] for k in ["id", "name", "title"]},
                "timeline": {"start": idx[0].isoformat() + "Z", "end": idx[-1].isoformat() + "Z", "impact_h": BEFORE_H},
                "hourly": hourly,
                "results": {
                    "min_dst_obs": r(win["dst"].min(), 0),
                    "min_dst_obs_h": min_i,
                    "min_dst_pred": r(pred.min(), 0),
                    "peak_speed": r(win["sw_speed"].max(), 0),
                    "min_bz": r(win["bz"].min(), 1),
                    "peak_pressure": r(win["dyn_pressure"].max(), 1),
                    "min_magnetopause_re": r(np.nanmin(shue(win["dyn_pressure"].values, win["bz"].values)), 2),
                    "peak_navic_error_m": r(max(h["m2"]["navic_error_m"] for h in hourly if h["m2"]), 1),
                    "storm_hours": int((win["dst"] < -50).sum()),
                    "m1": metrics(y, p),
                    "persistence": metrics(y, persist),
                    "m1_storm_hours": metrics(y[storm_mask], p[storm_mask]) if storm_mask.sum() > 2 else None,
                    "persistence_storm_hours": metrics(y[storm_mask], persist[storm_mask]) if storm_mask.sum() > 2 else None,
                    "first_observed_storm_h": first_obs_storm,
                    "first_forecast_storm_issued_h": first_fc_storm,
                    "first_red_issued_h": first_red,
                    # an alert issued at hour i is for hour i+1; lead time vs the observed crossing
                    "storm_warning_lead_h": (first_obs_storm - first_fc_storm) if first_obs_storm is not None and first_fc_storm is not None else None,
                    "red_lead_vs_storm_h": (first_obs_storm - first_red) if first_obs_storm is not None and first_red is not None else None,
                },
            }
        )

    # ======================= analysis =======================
    A: dict = {"meta": {"generated_by": "scripts/export_dashboard.py", "omni_rows": int(len(omni)), "years": "2000–2024"}}

    # --- dataset ---
    daily = omni["dst"].resample("D").min()
    A["dataset"] = {
        "daily_min_dst": {"t": [d.strftime("%Y-%m-%d") for d in daily.index], "v": rl(daily.values, 0)},
    }
    yr = omni.groupby("year")["dst"]
    A["dataset"]["storm_hours_per_year"] = {
        "year": [int(y) for y in yr.size().index],
        "moderate": [int(((g < -50) & (g >= -100)).sum()) for _, g in yr],
        "intense": [int(((g < -100) & (g >= -250)).sum()) for _, g in yr],
        "extreme": [int((g < -250).sum()) for _, g in yr],
    }
    A["dataset"]["dst_box_per_year"] = {
        "year": [int(y) for y, _ in yr],
        "q1": [r(g.quantile(0.25), 0) for _, g in yr],
        "median": [r(g.median(), 0) for _, g in yr],
        "q3": [r(g.quantile(0.75), 0) for _, g in yr],
        "low": [r(g.quantile(0.01), 0) for _, g in yr],
        "high": [r(g.quantile(0.99), 0) for _, g in yr],
        "min": [r(g.min(), 0) for _, g in yr],
    }
    bins = np.arange(-420, 101, 10)
    hist, _ = np.histogram(omni["dst"].clip(-419, 99), bins=bins)
    A["dataset"]["dst_hist"] = {"x": [int(b + 5) for b in bins[:-1]], "count": [int(c) for c in hist]}
    cols = ["bz", "proton_density", "sw_speed", "dyn_pressure", "dst"]
    corr_df = data[cols + ["dst_next"]].assign(dst_change=lambda d: d["dst_next"] - d["dst"]).drop(columns="dst_next")
    corr = corr_df.corr()
    A["dataset"]["correlation"] = {"labels": list(corr.columns), "matrix": [rl(row, 2) for row in corr.values]}
    mm = omni.assign(month=omni.index.month).groupby(["year", "month"])["dst"].min().unstack()
    A["dataset"]["monthly_min_heatmap"] = {"years": [int(y) for y in mm.index], "months": list(range(1, 13)), "z": [rl(row, 0) for row in mm.values]}
    rng = np.random.default_rng(7)
    storm_rows = data[data["dst"] < -30]
    s3 = storm_rows.iloc[rng.choice(len(storm_rows), size=min(2500, len(storm_rows)), replace=False)]
    A["dataset"]["scatter3d"] = {"bz": rl(s3["bz"], 1), "speed": rl(s3["sw_speed"], 0), "dst": rl(s3["dst"], 0), "pressure": rl(s3["dyn_pressure"], 1)}
    s2 = data.iloc[rng.choice(len(data), size=6000, replace=False)]
    A["dataset"]["bz_vs_change"] = {"bz": rl(s2["bz"], 1), "change": rl(s2["dst_next"] - s2["dst"], 0)}

    # --- M1 ---
    m1 = {"splits": {}}
    for name, part in splits.items():
        y_ = part["dst_next"].values
        p_ = m1_storm.predict_dst_next(model, part)
        per = part["dst_lag1"].values
        st = y_ < -50
        m1["splits"][name] = {
            "rows": int(len(part)),
            "model_all": metrics(y_, p_),
            "persist_all": metrics(y_, per),
            "model_storm": metrics(y_[st], p_[st]),
            "persist_storm": metrics(y_[st], per[st]),
        }
    test = splits["test"]
    yt = test["dst_next"].values
    pt = m1_storm.predict_dst_next(model, test)
    pers = test["dst_lag1"].values
    pick = np.concatenate([np.where(yt < -50)[0], rng.choice(len(yt), 3000, replace=False)])
    pick = np.unique(pick)
    m1["pred_vs_obs"] = {"obs": rl(yt[pick], 0), "pred": rl(pt[pick], 1)}
    res = pt - yt
    rb = np.arange(-40, 41, 2)
    h_, _ = np.histogram(np.clip(res, -39.9, 39.9), bins=rb)
    m1["residual_hist"] = {"x": [int(b + 1) for b in rb[:-1]], "count": [int(c) for c in h_]}
    edges = [100, 0, -30, -50, -100, -200, -500]
    labels = ["> 0", "0 to −30", "−30 to −50", "−50 to −100", "−100 to −200", "< −200"]
    by_bin = {"label": labels, "model": [], "persistence": [], "n": []}
    for hi, lo in zip(edges[:-1], edges[1:]):
        mk = (yt <= hi) & (yt > lo)
        by_bin["model"].append(r(np.abs(pt[mk] - yt[mk]).mean(), 2) if mk.any() else None)
        by_bin["persistence"].append(r(np.abs(pers[mk] - yt[mk]).mean(), 2) if mk.any() else None)
        by_bin["n"].append(int(mk.sum()))
    m1["mae_by_dst_bin"] = by_bin
    imp = {}
    for kind in ["gain", "weight", "cover"]:
        sc_ = booster.get_score(importance_type=kind)
        imp[kind] = [r(sc_.get(f, 0.0), 2) for f in feats]
    m1["importance"] = {"features": feats, **imp}
    contrib = booster.predict(xgb.DMatrix(test[feats]), pred_contribs=True)[:, :-1]
    m1["shap_mean_abs"] = {"features": feats, "value": rl(np.abs(contrib).mean(axis=0), 3)}
    sp = rng.choice(len(test), 2500, replace=False)
    m1["shap_dependence"] = {
        f: {"x": rl(test[f].values[sp], 1), "shap": rl(contrib[sp, i], 2)} for i, f in enumerate(feats)
    }
    # response surface: change in Dst over Bz x speed, density 10 /cm3, current Dst -50 nT
    bz_g = np.arange(-40, 20.1, 2.5)
    v_g = np.arange(300, 950.1, 25)
    BZ, V = np.meshgrid(bz_g, v_g)
    n0 = 10.0
    grid = pd.DataFrame(
        {"bz": BZ.ravel(), "proton_density": n0, "sw_speed": V.ravel(), "dyn_pressure": 2e-6 * n0 * V.ravel() ** 2, "dst_lag1": -50.0}
    )
    dz = model.predict(grid[feats]).reshape(BZ.shape)
    m1["surface_bz_speed"] = {"bz": rl(bz_g, 1), "speed": rl(v_g, 0), "delta_dst": [rl(row, 1) for row in dz], "fixed": "density 10 /cm³, current Dst −50 nT"}
    # second surface: Bz x current Dst at 600 km/s
    d_g = np.arange(-400, 21, 20)
    BZ2, D2 = np.meshgrid(bz_g, d_g)
    grid2 = pd.DataFrame({"bz": BZ2.ravel(), "proton_density": n0, "sw_speed": 600.0, "dyn_pressure": 2e-6 * n0 * 600.0**2, "dst_lag1": D2.ravel()})
    dz2 = model.predict(grid2[feats]).reshape(BZ2.shape)
    m1["surface_bz_dst"] = {"bz": rl(bz_g, 1), "dst": rl(d_g, 0), "delta_dst": [rl(row, 1) for row in dz2], "fixed": "600 km/s, density 10 /cm³"}
    A["m1"] = m1

    # --- M2 ---
    dst_axis = np.arange(-450, 61, 5)
    day = [max(float(np.polyval(M2_COEFFS, d)), 2.0) for d in dst_axis]
    hours = np.arange(0, 24, 1)
    surf = [[max(float(np.polyval(M2_COEFFS, d)), 2.0) * (1.5 if (h >= 18 or h < 6) else 1.0) for h in hours] for d in dst_axis]
    A["m2"] = {
        "coeffs": [float(f"{c:.6g}") for c in M2_COEFFS],
        "points": {"dst": M2_DST.tolist(), "err": M2_ERR.tolist()},
        "curve": {"dst": dst_axis.tolist(), "day": rl(day, 2), "night": rl(np.array(day) * 1.5, 2)},
        "surface": {"dst": dst_axis.tolist(), "ist_hour": hours.tolist(), "error": [rl(row, 1) for row in surf]},
        "quiet_error_m": r(max(float(np.polyval(M2_COEFFS, 0)), 2.0), 1),
    }

    # --- GNSS LightGBM ---
    import lightgbm as lgb

    # Normalise line endings: a Windows checkout turns the model text into CRLF, which LightGBM rejects.
    model_text = (GNSS_MODEL_DIR / "lgbm_c3_h10.txt").read_bytes().decode().replace("\r\n", "\n")
    gb = lgb.Booster(model_str=model_text)
    meta = json.loads((GNSS_MODEL_DIR / "lgbm_c3_h10_meta.json").read_text())
    names = gb.feature_name()
    gain = gb.feature_importance("gain")
    split = gb.feature_importance("split")
    order = np.argsort(gain)[::-1]
    share = gain / gain.sum()
    by_ch = {c: r(share[[i for i, n in enumerate(names) if n.startswith(c + "_")]].sum() * 100, 1) for c in ["c1", "c2", "c3"]}
    kinds = {"lag": "_lag", "rolling mean": "_mean", "rolling std": "_std", "deviation": "_dev", "first difference": "_d1"}
    by_kind = {k: r(share[[i for i, n in enumerate(names) if s in n]].sum() * 100, 1) for k, s in kinds.items()}
    A["gnss"] = {
        "importance": {"features": [names[i] for i in order], "gain_pct": rl(share[order] * 100, 2), "splits": [int(split[i]) for i in order]},
        "by_channel_pct": by_ch,
        "by_kind_pct": by_kind,
        "metrics": {
            "lgbm_mae_m": r(meta["results"]["lgbm_mae"], 4),
            "persistence_mae_m": r(meta["results"]["persistence_mae"], 4),
            "improvement_pct": r(meta["results"]["improvement_pct"], 1),
        },
        "trees": int(gb.num_trees()),
        "test_stations": len(meta["test_stations"]),
    }

    # --- scenario comparison ---
    A["scenarios"] = {"ids": [s["id"] for s in scenarios], "names": [s["name"] for s in scenarios]}

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "scenarios.json").write_text(json.dumps({"rules": RULES["levels"], "sites": SITES, "m2_coeffs": A["m2"]["coeffs"], "scenarios": scenarios}, separators=(",", ":")))
    (OUT / "analysis.json").write_text(json.dumps(A, separators=(",", ":")))

    for s in scenarios:
        res_ = s["results"]
        print(f"\n{s['title']}")
        for k, v in res_.items():
            print(f"  {k}: {v}")
    print("\nM2 quiet-day error:", A["m2"]["quiet_error_m"], "m")
    print("GNSS importance by channel:", by_ch)
    print("M1 importance gain:", dict(zip(feats, imp["gain"])))
    print("M1 mean |SHAP|:", dict(zip(feats, m1["shap_mean_abs"]["value"])))
    for f in ["scenarios.json", "analysis.json"]:
        print(f, round((OUT / f).stat().st_size / 1024), "KB")


if __name__ == "__main__":
    main()
