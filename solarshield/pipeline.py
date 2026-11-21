"""End-to-end SolarShield pipeline.

    solar wind (hour t)        --> M1 (XGBoost)    --> Dst(t+1) + storm category
    GNSS c1..c3 history (30 s) --> GNSS (LightGBM) --> c3 forecast 5 min ahead
                                                     --> |c3| as error (m) --> alert engine --> per-zone alerts

`Pipeline` holds the loaded models and is independent of FastAPI, so it can be
used from notebooks, Streamlit or tests as well as from `solarshield.api`.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

import alert_engine  # the user's rule-based engine, alert_engine.py at the repo root
from solarshield.models import gnss, m1_storm

# ---------------------------------------------------------------- GNSS features
GNSS_CHANNELS = ("c1", "c2", "c3")
LAGS = (0, 1, 2, 5, 10, 20)
WINDOWS = (10, 30)
MIN_GNSS_SAMPLES = max(max(LAGS) + 1, max(WINDOWS))  # 30 samples = 15 min at 30 s

# The training code for the GNSS model is not in the repo. Its metadata
# (y_clip of about +/-0.33, "r2_change", "persistence_mae") indicates it predicts the
# *change* c3(t+10) - c3(t), not c3 itself. Set to False if that turns out wrong.
GNSS_PREDICTS_CHANGE = True


def build_gnss_features(history: pd.DataFrame) -> pd.DataFrame:
    """Turn a c1/c2/c3 series (oldest first, 30 s apart) into the model's features
    for the latest sample.

    ASSUMED definitions (reconstructed from the feature names; check against the
    original training notebook if you have it):
      lagK  = x(t-K)            meanN / stdN = rolling mean / std of the last N samples
      devN  = x(t) - meanN      d1           = x(t) - x(t-1)
    """
    if len(history) < MIN_GNSS_SAMPLES:
        raise ValueError(f"need at least {MIN_GNSS_SAMPLES} GNSS samples, got {len(history)}")

    feats = {}
    for c in GNSS_CHANNELS:
        x = history[c].astype(float).reset_index(drop=True)
        for k in LAGS:
            feats[f"{c}_lag{k}"] = x.shift(k)
        for n in WINDOWS:
            mean = x.rolling(n).mean()
            feats[f"{c}_mean{n}"] = mean
            feats[f"{c}_std{n}"] = x.rolling(n).std()
            feats[f"{c}_dev{n}"] = x - mean
        feats[f"{c}_d1"] = x.diff()
    return pd.DataFrame(feats).iloc[[-1]]


# ---------------------------------------------------------------- storm category
def storm_category(dst_nt: float) -> str:
    """Standard Dst storm classes (Gonzalez et al., 1994; Loewe & Prolss, 1997)."""
    if dst_nt > -30:
        return "quiet"
    if dst_nt > -50:
        return "weak"
    if dst_nt > -100:
        return "moderate"
    if dst_nt > -250:
        return "intense"
    return "extreme"


# ---------------------------------------------------------------- pipeline
class Pipeline:
    """Loads both models once; each call runs inference only."""

    def __init__(self) -> None:
        self.m1 = m1_storm.load_model()
        self.gnss = gnss.load_gnss_model()
        clip = self.gnss.meta.get("y_clip")
        self.y_clip = tuple(clip) if clip else None

    # -- M1 -------------------------------------------------------------------
    def predict_storm(self, solar_wind: dict) -> dict:
        """solar_wind: bz, proton_density, sw_speed, dyn_pressure, dst (current hour)."""
        row = {**solar_wind, "dst_lag1": solar_wind["dst"]}  # M1 calls current Dst "dst_lag1"
        X = pd.DataFrame([row])
        dst_next = float(m1_storm.predict_dst_next(self.m1, X)[0])
        return {
            "dst_now_nt": float(solar_wind["dst"]),
            "dst_next_hour_nt": round(dst_next, 1),
            "storm_category": storm_category(dst_next),
        }

    # -- GNSS -----------------------------------------------------------------
    def predict_gnss(self, history: pd.DataFrame) -> dict:
        X = build_gnss_features(history)
        raw = float(self.gnss.predict(X)[0])
        if self.y_clip:
            raw = float(np.clip(raw, *self.y_clip))

        c3_now = float(history["c3"].iloc[-1])
        c3_forecast = c3_now + raw if GNSS_PREDICTS_CHANGE else raw
        horizon_s = self.gnss.meta.get("horizon_steps", 10) * self.gnss.meta.get("step_seconds", 30)
        return {
            "c3_now": round(c3_now, 3),
            "c3_change_pred": round(raw, 3) if GNSS_PREDICTS_CHANGE else None,
            "c3_forecast": round(c3_forecast, 3),
            "horizon_seconds": horizon_s,
            "error_m": round(abs(c3_forecast), 2),
        }

    # -- alerts ---------------------------------------------------------------
    @staticmethod
    def alerts(error_m: float) -> list[dict]:
        return alert_engine.evaluate_zones(error_m)

    # -- everything -----------------------------------------------------------
    def run(self, solar_wind: dict, gnss_history: pd.DataFrame) -> dict:
        storm = self.predict_storm(solar_wind)
        gnss_out = self.predict_gnss(gnss_history)
        alerts = self.alerts(gnss_out["error_m"])
        return {
            "storm": storm,
            "gnss": gnss_out,
            "alerts": alerts,
            "highest_level": alerts[0]["level"] if alerts else None,
        }
