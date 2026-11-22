<div align="center">

# ☀️ SuryaAstra

### SolarShield-NavIC: early warning when solar storms make NavIC positions unreliable

**Solar wind at L1 &nbsp;→&nbsp; geomagnetic storm forecast &nbsp;→&nbsp; NavIC positioning error &nbsp;→&nbsp; alerts for disaster-response teams**

![Python](https://img.shields.io/badge/python-3.10%2B-3776AB?logo=python&logoColor=white)
![XGBoost](https://img.shields.io/badge/M1-XGBoost-EB5E28)
![LightGBM](https://img.shields.io/badge/GNSS-LightGBM-9ACD32)
![FastAPI](https://img.shields.io/badge/API-FastAPI-009688?logo=fastapi&logoColor=white)
![Three.js](https://img.shields.io/badge/dashboard-Three.js%20%2B%20Vite-000000?logo=three.js&logoColor=white)
![ASTRA 2026](https://img.shields.io/badge/ASTRA-2026-6C3BFF)

</div>

---

## Why this exists

On **3 July 2021**, a moderate geomagnetic storm pushed NavIC positioning errors in Ahmedabad to **64.06 m** (Hakani & Rawat, 2025). At that size of error, a rescue helicopter can land on the wrong side of a river.

During storms, ISRO reports "no significant degradation in service metrics", and that is correct for what it measures: the satellites keep broadcasting. It does not tell you whether the position your receiver computes is still accurate. The ionosphere between the satellite and the receiver is what breaks during a storm.

We found no tool that connects these four things:

```
solar wind  ──▶  storm severity  ──▶  NavIC positioning error  ──▶  impact on active disaster zones
```

SuryaAstra connects them. It reads upstream solar wind, forecasts the Dst storm index one hour ahead, estimates the NavIC error that storm will cause, and gives each rescue zone a clear GREEN / YELLOW / ORANGE / RED instruction.

### ASTRA 2026 domains covered

| Domain | How SuryaAstra covers it |
|---|---|
| **01 · Indian Space Missions / ISSDC** | Built around L1 solar wind data, the same measurements Aditya-L1 ASPEX-SWIS makes |
| **03 · Space-Based Disaster Management** | Puts the NavIC degradation forecast on top of active NDMA-style disaster zones |
| **04 · Satellite Communication / NavIC** | Core focus: forecast of user-level NavIC positioning error |

---

## Results at a glance

**M1 storm forecaster**, scored on **2021–2024**, years the model never saw in training (34,340 hours):

| | All hours |  | Storm hours (Dst < −50 nT) |  |
|---|---:|---:|---:|---:|
| | **M1** | Persistence | **M1** | Persistence |
| R² | **0.965** | 0.953 | **0.951** | 0.930 |
| MAE (nT) | **2.59** | 2.88 | **6.42** | 7.86 |
| RMSE (nT) | **3.95** | 4.58 | **10.58** | 12.73 |

"Persistence" is the forecast "next hour's Dst equals this hour's Dst". It is the baseline any Dst model has to beat, and M1 beats it on every metric, most clearly in storm hours.

**Three real storm replays** (all from the held-out test years):

| Storm | Observed min Dst | M1 predicted min | Peak est. NavIC error | M1 storm warning |
|---|---:|---:|---:|---|
| 10–11 May 2024 superstorm | −406 nT | −443 nT | 109.6 m | 1 h before observed onset |
| 23–24 Apr 2023 intense storm | −213 nT | −208 nT | 67.5 m | 1 h before observed onset |
| 3–4 Nov 2021 moderate storm | −105 nT | −104 nT | 50.5 m | at observed onset |

The most important input is **IMF Bz**, the north–south component of the interplanetary magnetic field (mean |SHAP| 1.26). Next is the current Dst (0.85), then solar wind speed (0.45). This matches the physics: a southward Bz is what lets solar wind energy into the magnetosphere.

---

## How it works

```
 ┌──────────────────────┐    ┌───────────────────────┐    ┌────────────────────────┐    ┌──────────────────────┐
 │  SOLAR WIND (hour t) │    │  M1 · STORM FORECAST  │    │  NavIC ERROR ESTIMATE  │    │  ALERT ENGINE        │
 │                      │    │                       │    │                        │    │                      │
 │  Bz          (nT)    │───▶│  XGBoost, predicts    │───▶│  M2: Dst ──▶ error (m) │───▶│  error + zone status │
 │  density     (n/cm³) │    │  ΔDst = Dst(t+1)−Dst(t│    │  ×1.5 after sunset IST │    │  ──▶ GREEN … RED     │
 │  speed       (km/s)  │    │  ──▶ Dst(t+1), storm  │    │                        │    │  + recommended action│
 │  pressure    (nPa)   │    │       category        │    │  GNSS: LightGBM, c3    │    │  per disaster zone   │
 │  Dst now     (nT)    │    │                       │    │  5 min ahead (API)     │    │                      │
 └──────────────────────┘    └───────────────────────┘    └────────────────────────┘    └──────────────────────┘
```

### M1: Storm severity predictor (`solarshield/models/m1_storm.py`)

- **Input:** five hourly NASA OMNI values: Bz, proton density, solar wind speed, dynamic pressure, and Dst at hour *t*.
- **Target:** the *change* Dst(t+1) − Dst(t), not Dst itself. The model only has to learn what the solar wind adds or removes, because the current Dst already explains most of the next one. `predict_dst_next` adds the current Dst back to give an absolute forecast in nT.
- **Model:** `XGBRegressor(n_estimators=500, max_depth=6, learning_rate=0.1)`.
- **Data:** 219,168 hours of OMNI data, 2000–2024, split **by year** to prevent time leakage: train 2000–2016, validation 2017–2020, test 2021–2024.
- **Output:** Dst one hour ahead plus a standard storm category: quiet > −30, weak > −50, moderate > −100, intense > −250, else extreme (Gonzalez et al., 1994).

### M2: NavIC error estimator (Dst → metres)

A 2nd-degree polynomial fit to storm-time NavIC and GNSS errors collected from published papers (Hakani & Rawat 2025, Desai & Shah 2018, the BITS Goa L5/S-band study, May 2024 superstorm reports):

```
error(m) = max(−0.000275·Dst² − 0.279·Dst + 8.67, 2.0) × (1.5 if 18:00–06:00 IST else 1.0)
```

The 1.5× night-time multiplier models equatorial plasma bubbles, which form after sunset and make scintillation over India worse. The 2 m floor is NavIC's nominal accuracy. The dashboard computes M2 in `scripts/export_dashboard.py`.

### GNSS error forecaster (`solarshield/models/gnss.py`)

A LightGBM model (Huber loss, 2,000 trees) trained on 30-second receiver position-error series (channels `c1`–`c3`) from hundreds of stations around the September 2017 storms. From the last 15 minutes of readings (lags, 10- and 30-sample rolling mean / std / deviation, first difference) it forecasts channel `c3` **10 steps (5 minutes) ahead**. The FastAPI pipeline uses this model.

### Alert engine (`alert_engine.py`, `frontend/src/config/alert_rules.json`)

Rule-based on purpose. Rescue coordinators must be able to read and trust every decision.

| Level | Condition | Action |
|---|---|---|
| 🔴 **RED** | error > 30 m **and** disaster zone active | Halt NavIC-dependent rescue ops; use alternative positioning |
| 🟠 **ORANGE** | error > 15 m, **or** error > 10 m in an active disaster zone | Keep manual navigation backup ready |
| 🟡 **YELLOW** | error > 5 m | Use dual-frequency (L5 + S) correction |
| 🟢 **GREEN** | otherwise | Normal NavIC operations |

---

## Quick start

### 1 · Python backend

```bash
git clone git@github.com:pizzaparth/suryastra.git
cd suryastra
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
pytest -q                                   # 6 API smoke tests, loads both models
```

### 2 · Run the API

```bash
uvicorn solarshield.api:app --reload
# interactive docs: http://127.0.0.1:8000/docs
```

```bash
# Storm forecast from current solar wind
curl -s -X POST http://127.0.0.1:8000/predict/storm \
  -H 'Content-Type: application/json' \
  -d '{"bz": -15, "proton_density": 20, "sw_speed": 650, "dyn_pressure": 12, "dst": -80}'

# Alerts for every disaster zone at a given NavIC error
curl -s 'http://127.0.0.1:8000/alerts?error_m=42'
```

| Endpoint | Method | What it does |
|---|---|---|
| `/health` | GET | Liveness check |
| `/predict/storm` | POST | M1 only: solar wind now → Dst one hour ahead + storm category |
| `/predict/gnss` | POST | GNSS model only: ≥ 30 `c1/c2/c3` samples (30 s apart) → `c3` 5 min ahead + error (m) |
| `/alerts?error_m=` | GET | Alert engine only: error → per-zone level, action, colour |
| `/pipeline` | POST | Everything: storm + GNSS forecast + per-zone alerts + highest level |

### 3 · Dashboard

The dashboard is a cinematic 3D replay of the three storms: the Sun, the solar wind, a magnetosphere that compresses, and India's receivers turning red. It also has a **Data analysis** page with interactive Plotly charts (SHAP, response surfaces, residuals, the M2 error surface).

```bash
cd frontend
npm install
npm run dev            # http://localhost:5173
npm run build          # writes one self-contained file: frontend/dist/index.html
```

You can present fully offline: double-click `frontend/dist/index.html`. The browser runs no model. It replays results that Python computed once. Rehearsal deep link: `index.html?sc=apr2023&ch=2&h=8` (add `&analysis` to open the analysis page). The full list of controls is in [`frontend/README.md`](frontend/README.md).

**Deploy:** `vercel.json` is already set up. Import the repo on Vercel, or run `npx vercel --prod` from the repo root.

---

## Reproduce everything

```bash
python scripts/train_m1.py                  # retrain M1 from OMNI and save models/m1_xgb.pkl
python scripts/export_dashboard.py          # run M1 + M2 on the 3 storms, write frontend/src/data/*.json
cd frontend && npm run build                # rebuild the offline dashboard
```

The exploration notebook `notebooks/m1_storm_predictor.ipynb` imports from the `solarshield` package, so the notebook and the scripts use the same code.

---

## Repository layout

```
.
├── solarshield/                  # importable Python package (all reusable code)
│   ├── config.py                 # repo-relative paths to data and model files
│   ├── data/omni.py              # NASA OMNI hourly loader (fill values → NaN)
│   ├── models/
│   │   ├── m1_storm.py           # M1: dataset, year split, training, metrics, save/load
│   │   └── gnss.py               # LightGBM GNSS model loader
│   ├── pipeline.py               # Pipeline: GNSS feature engineering + M1 + GNSS + alerts
│   └── api.py                    # FastAPI service around Pipeline
├── alert_engine.py               # rule-based alert levels and disaster zones
├── scripts/
│   ├── train_m1.py               # retrain M1 end to end
│   └── export_dashboard.py       # precompute storm replays + analysis data for the UI
├── models/                       # trained artifacts only
│   ├── m1_xgb.pkl                # M1 bundle (model + features + test metrics)
│   └── gnss_model/               # LightGBM text dump + metadata
├── data/raw/omni2_*.lst          # NASA OMNI hourly 2000–2024 (8.8 MB)
├── notebooks/                    # exploration
├── tests/test_api.py             # API smoke tests
├── frontend/                     # Vite + Three.js + Plotly presentation dashboard
├── plan.md                       # original hackathon design document
└── vercel.json                   # dashboard deployment
```

---

## Data sources

| Source | Used for |
|---|---|
| [NASA OMNI](https://omniweb.gsfc.nasa.gov) hourly, 2000–2024 | M1 training and the storm replays |
| GNSS receiver position-error series, September 2017 storms | GNSS LightGBM model |
| Published NavIC / GNSS storm-error studies | M2 polynomial fit points |
| [Aditya-L1 ASPEX](https://pradan.issdc.gov.in/al1) (ISRO PRADAN) | Target live L1 feed: the same quantities M1 takes as input |
| [NOAA DSCOVR real-time solar wind](https://www.swpc.noaa.gov/products/real-time-solar-wind) | Target live L1 feed |

---

## Roadmap

- [ ] Live ingest from DSCOVR / Aditya-L1 ASPEX-SWIS instead of OMNI replays
- [ ] Multi-hour Dst forecasts that use CME arrival predictions
- [ ] Replace M2 with a model trained on NavIC receiver data from Indian stations
- [ ] Error maps per region (latitude and the equatorial anomaly) instead of one error value for all of India
- [ ] Live NDMA / BHUVAN disaster-zone feed
- [ ] One source of truth for the alert rules, shared by the API and the dashboard

---

## References

1. Hakani & Rawat (2025): NavIC positioning errors reaching 64.06 m during the 3 July 2021 storm.
2. Desai & Shah (2018): NavIC TEC behaviour during geomagnetic disturbances.
3. BITS Pilani, Goa campus: NavIC L5 and S-band scintillation measurements.
4. ISRO, URSI 2024: NavIC ionospheric model accuracy during storms.
5. Ye et al. (2025), *ApJ Supplement*: XGBoost Dst prediction (MAE 5.62 nT, R² 0.96), the benchmark for M1.
6. ASPEX-SWIS validation against Wind and DSCOVR, arXiv:2507.17523.
7. Gonzalez et al. (1994), *JGR*: "What is a geomagnetic storm?" (Dst storm classes).
8. Shue et al. (1998), *JGR*: the magnetopause standoff model used in the dashboard.

---

<div align="center">

Built for **ASTRA 2026**.<br>
*"The satellites work" is not the same as "your position is accurate".*

</div>
