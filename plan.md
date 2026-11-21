# SolarShield-NavIC — ASTRA 2026 Hackathon Plan

## One-Liner

Predict how solar storms degrade NavIC positioning accuracy over India and warn disaster-rescue teams before their GPS goes unreliable.

---

## Problem Statement

India's NavIC satellite navigation system is critical for disaster response — rescue teams, drone operators, and relief convoys depend on accurate positioning. During geomagnetic storms triggered by Coronal Mass Ejections (CMEs), ionospheric scintillation causes NavIC positioning errors up to **64.06 meters** (Hakani & Rawat, 2025). ISRO monitors satellite health and reports "no significant degradation in service metrics," but that measures whether the satellites are broadcasting — not whether the position your receiver computes is accurate.

**No tool exists** that connects solar wind data → storm severity → NavIC positioning degradation → disaster zone impact. SolarShield-NavIC fills that gap.

---

## ASTRA Domains Covered

| Domain | How We Cover It |
|--------|----------------|
| **01 — Indian Space Missions / ISSDC** | Uses Aditya-L1 ASPEX (SWIS) solar wind data from ISRO's PRADAN portal |
| **03 — Space-Based Disaster Management** | Overlays NavIC degradation on active NDMA disaster zones to protect rescue ops |
| **04 — Satellite Communication / NavIC** | Core focus — predicts NavIC positioning error during geomagnetic storms |

---

## Technical Architecture (Simplified)

```
┌─────────────────┐     ┌──────────────────┐     ┌───────────────────┐     ┌──────────────┐
│  DATA INGESTION │────▶│  M1: STORM       │────▶│  M2: NavIC ERROR  │────▶│  ALERT       │
│                 │     │  PREDICTOR       │     │  ESTIMATOR        │     │  ENGINE      │
│ • NASA OMNI     │     │                  │     │                   │     │              │
│ • DSCOVR live   │     │ Solar wind →     │     │ Dst →             │     │ Error +      │
│ • Aditya-L1     │     │ Predicted Dst    │     │ NavIC error (m)   │     │ Disaster →   │
│                 │     │                  │     │                   │     │ Risk alert   │
│                 │     │ [XGBoost, <2hr]  │     │ [PolyFit, <2hr]   │     │ [Rule-based] │
└─────────────────┘     └──────────────────┘     └───────────────────┘     └──────────────┘
                                                                                  │
                                                                                  ▼
                                                                     ┌─────────────────────┐
                                                                     │   STREAMLIT UI       │
                                                                     │   3-col dashboard    │
                                                                     │   + Folium map       │
                                                                     │   + Alert cards      │
                                                                     └─────────────────────┘
```

**What changed from the full plan:** Dropped M3 (scintillation classifier) entirely. It needed RINEX data processing which is a time sink. Scintillation risk is now folded into M2 as a Dst-based severity threshold — same practical result, zero extra model work.

---

## AI Models (2 only)

### M1: Storm Severity Predictor — XGBoost, ≤ 2 hours

| Field | Detail |
|-------|--------|
| **Goal** | Predict Dst index 1 hour ahead from solar wind parameters |
| **Algorithm** | XGBoost Regressor — no LSTM, no deep learning |
| **Build time** | ≤ 2 hours (data already clean in OMNI) |

**Inputs (5 features — keep it minimal):**

| Feature | Unit | Source |
|---------|------|--------|
| Bz (southward IMF) | nT | NASA OMNI |
| Proton density | n/cm³ | NASA OMNI |
| Solar wind speed | km/s | NASA OMNI |
| Dynamic pressure | nPa | NASA OMNI |
| Previous Dst (t−1) | nT | NASA OMNI |

**Output:** Predicted Dst index (nT), 1 hour ahead. Negative = storm.

**Shortcuts to stay under 2 hours:**
- Use OMNI data 2000–2024 only (~200K rows, not 500K). Already merged and clean — no joins needed.
- 5 raw features + 1 lag. Skip rolling means, coupling functions, dawn-dusk proxy. XGBoost handles nonlinearity on its own.
- 70/15/15 train/val/test split by year. No k-fold.
- Default XGBoost hyperparams with `n_estimators=500, max_depth=6, learning_rate=0.1`. Skip Bayesian tuning.
- Expect R² ~0.85–0.90 (lower than the 0.96 in published papers, but good enough for demo).

**Data source:** NASA OMNI — `omniweb.gsfc.nasa.gov` — ASCII download, no registration, no API key.

```python
# M1 in ~40 lines
import pandas as pd
from xgboost import XGBRegressor
from sklearn.model_selection import train_test_split
import joblib

df = pd.read_csv("data/raw/omni_hourly.csv")
features = ["bz", "proton_density", "sw_speed", "dyn_pressure", "dst_lag1"]
df["dst_lag1"] = df["dst"].shift(1)
df = df.dropna()

X = df[features]
y = df["dst"]

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.15, shuffle=False)

model = XGBRegressor(n_estimators=500, max_depth=6, learning_rate=0.1)
model.fit(X_train, y_train)

print(f"R² = {model.score(X_test, y_test):.3f}")
joblib.dump(model, "models/m1_xgb.pkl")
```

---

### M2: NavIC Error Estimator — Polynomial Fit, ≤ 2 hours

| Field | Detail |
|-------|--------|
| **Goal** | Convert Dst index to estimated NavIC positioning error in meters |
| **Algorithm** | 2nd-degree polynomial regression (curve fit) |
| **Build time** | ≤ 2 hours (most time spent building the small dataset from papers) |

**Inputs (2 features):**

| Feature | Unit | Source |
|---------|------|--------|
| Dst index | nT | Output from M1 (or WDC Kyoto historical) |
| Local time | Hour (IST) | System clock / OMNI epoch |

**Output:** Estimated NavIC horizontal positioning error (meters).

**How the dataset is built (the main work):**

Manually extract ~30–50 data points from published papers:

| Storm Date | Dst (nT) | NavIC Error (m) | Source |
|-----------|----------|-----------------|--------|
| 2021-07-03 | −63 | 64.06 | Hakani & Rawat 2025 |
| 2015-06-22 | −204 | ~45 (GPS scaled) | Literature |
| 2024-05-10 | −412 | ~80 (estimated) | May 2024 superstorm reports |
| Quiet day | −5 | 2.5 | Nominal NavIC spec |
| ... | ... | ... | ... |

For storms without direct NavIC measurements, use GPS error data × 1.3 scaling factor (NavIC L5 is more susceptible at equatorial latitudes per BITS Goa study).

**Shortcuts to stay under 2 hours:**
- 30–50 data points is enough for a polynomial fit. This isn't deep learning.
- `numpy.polyfit(dst_values, error_values, deg=2)` — literally one line of model code.
- Hardcode the data points in a CSV. No web scraping, no PDF parsing during hackathon — do the paper reading beforehand.
- Add a time-of-day multiplier: errors are ~1.5× worse during post-sunset (18:00–24:00 IST) due to equatorial plasma bubble activity. Simple lookup, not a model.

**Data sources:** WDC Kyoto Dst (`wdc.kugi.kyoto-u.ac.jp`) + published NavIC error papers (Hakani & Rawat 2025, Desai & Shah 2018, BITS Goa study).

```python
# M2 in ~20 lines
import numpy as np
import joblib

# Pre-built dataset from papers
dst_values = np.array([-5, -30, -50, -63, -100, -150, -204, -300, -412])
error_meters = np.array([2.5, 5, 12, 64.06, 35, 42, 45, 65, 80])

# Fit 2nd-degree polynomial: error = a*dst² + b*dst + c
coeffs = np.polyfit(dst_values, error_meters, deg=2)
predict_error = np.poly1d(coeffs)

# Time-of-day multiplier
def get_multiplier(hour_ist):
    if 18 <= hour_ist <= 24 or 0 <= hour_ist < 6:
        return 1.5  # post-sunset equatorial bubble
    return 1.0

def predict_navic_error(dst, hour_ist):
    base = max(predict_error(dst), 2.0)  # floor at 2m nominal
    return round(base * get_multiplier(hour_ist), 1)

joblib.dump(coeffs, "models/m2_poly.pkl")
```

---

## Alert Engine (Rule-Based — Not an AI Model)

No training, no data. Pure if/else logic.

| Alert Level | Condition | Recommended Action |
|-------------|-----------|-------------------|
| 🟢 Green | Predicted error < 5m | Normal NavIC operations |
| 🟡 Yellow | 5–15m error | Switch to dual-frequency correction |
| 🟠 Orange | 15–30m error **or** error > 10m + disaster zone active | Manual navigation backup ready |
| 🔴 Red | > 30m error + disaster zone active | Halt NavIC-dependent rescue ops |

```python
def classify_alert(error_m, disaster_active):
    if error_m > 30 and disaster_active:
        return "RED", "Halt NavIC-dependent rescue ops, use alternative positioning"
    elif error_m > 15 or (error_m > 10 and disaster_active):
        return "ORANGE", "Switch to manual navigation backup"
    elif error_m > 5:
        return "YELLOW", "Use dual-frequency correction"
    else:
        return "GREEN", "Normal operations"
```

---

## Free Data Sources (Trimmed)

Only the sources you actually need for 2 models + alert engine:

| Source | URL | Format | Reg? | Used By | What You Download |
|--------|-----|--------|------|---------|------------------|
| NASA OMNI | `omniweb.gsfc.nasa.gov` | ASCII | No | M1 (training) | Hourly Bz, density, speed, pressure, Dst — 2000 to 2024 |
| NOAA DSCOVR | `swpc.noaa.gov/products/real-time-solar-wind` | JSON | No | M1 (live inference) | Real-time solar wind for dashboard |
| Aditya-L1 ASPEX | `pradan.issdc.gov.in/al1` | CDF | Free SSO | Demo/pitch | SWIS data — show India's own L1 data on dashboard |
| Aditya-L1 (Zenodo) | `zenodo.org/records/15833452` | CDF | No | Fallback | ASPEX-STEPS Jan–May 2024, ~150 MB |
| NASA DONKI | `api.nasa.gov/DONKI` | JSON | Free key | Dashboard | CME event list for context display |
| NDMA | `ndma.gov.in` | Web | No | Alert engine | Active disaster zones (hardcode for demo) |
| BHUVAN | `bhuvan.nrsc.gov.in` | GeoJSON | Free | Map | India district boundaries |

**Dropped sources:** WDC Kyoto Dst (OMNI already includes Dst), GFZ Kp (not needed with 2-model setup), IGS RINEX / LISN / EMBRACE (all needed only for dropped M3).

---

## UI — Streamlit Dashboard

### Layout (unchanged)

```
┌────────────────────────────────────────────────────────────────────┐
│  🛡️ SolarShield-NavIC            [Live] [Demo Mode]   IST: HH:MM │
├──────────────┬───────────────────────────┬─────────────────────────┤
│              │                           │                         │
│ SOLAR WIND   │    NavIC ACCURACY MAP     │    ACTIVE ALERTS        │
│ FEED         │                           │                         │
│              │   ┌───────────────────┐   │  ┌───────────────────┐  │
│ Speed: ___   │   │                   │   │  │ 🔴 RED ALERT      │  │
│ Density: __  │   │   Folium Map      │   │  │ Kerala Floods     │  │
│ Bz: ___      │   │   Color-coded     │   │  │ Error: 42m        │  │
│              │   │   regions         │   │  │ Action: Halt ops  │  │
│ ┌──────────┐ │   │   + disaster      │   │  └───────────────────┘  │
│ │ Dst Plot │ │   │   markers ⭐      │   │                         │
│ └──────────┘ │   │                   │   │  ┌───────────────────┐  │
│              │   └───────────────────┘   │  │ 🟡 YELLOW         │  │
│ Predicted:   │                           │  │ Mumbai Region     │  │
│ Dst = -120   │                           │  │ Error: 8m         │  │
│ Error = 35m  │                           │  │ Action: Use dual  │  │
│              │                           │  └───────────────────┘  │
├──────────────┴───────────────────────────┴─────────────────────────┤
│  Storm Timeline  ◄━━━━━━━━━━━━●━━━━━━━━━━━━━━━━━━━━━━━━━━━━►     │
│                  -24h        NOW                        +24h       │
└────────────────────────────────────────────────────────────────────┘
```

### Tech Stack

| Component | Library |
|-----------|---------|
| Framework | Streamlit |
| Charts | Plotly |
| Map | Folium + streamlit-folium |
| Data | pandas, numpy |
| ML | xgboost, scikit-learn |
| CDF | cdflib |
| API | requests |

---

## File Structure (Simplified)

```
solarshield-navic/
├── app.py                      # Streamlit dashboard
├── requirements.txt
├── plan.md
│
├── models/
│   ├── m1_storm_predictor.py   # XGBoost: solar wind → Dst
│   ├── m2_navic_error.py       # PolyFit: Dst → NavIC error (m)
│   ├── alert_engine.py         # Rule-based alert generator
│   ├── m1_xgb.pkl              # Trained M1 model
│   └── m2_poly.pkl             # Trained M2 coefficients
│
├── data/
│   ├── download_omni.py        # Fetch OMNI hourly data
│   ├── navic_errors.csv        # Hand-built dataset from papers
│   └── raw/
│       └── omni_hourly.csv
│
└── assets/
    └── india_districts.geojson
```

---

## Build Order & Timeline

### Phase 1: Data — 2 hours

| Step | Task | Time |
|------|------|------|
| 1.1 | Download OMNI hourly 2000–2024 from omniweb | 30 min |
| 1.2 | Build `navic_errors.csv` from papers (do this BEFORE hackathon) | 45 min |
| 1.3 | Download India districts GeoJSON from BHUVAN | 15 min |
| 1.4 | Register ISRO SSO + download one ASPEX CDF for demo display | 30 min |

### Phase 2: Models — 3 hours

| Step | Task | Time |
|------|------|------|
| 2.1 | M1: load OMNI, make lag feature, train XGBoost, save pkl | 1.5 hr |
| 2.2 | M2: load navic_errors.csv, polyfit, add time multiplier, save | 1 hr |
| 2.3 | Alert engine: write classify_alert function | 30 min |

### Phase 3: Dashboard — 3 hours

| Step | Task | Time |
|------|------|------|
| 3.1 | Streamlit 3-column layout + left panel (Plotly solar wind charts) | 1 hr |
| 3.2 | Center panel (Folium map with error color overlay + disaster markers) | 1 hr |
| 3.3 | Right panel (alert cards) + demo mode (replay May 2024 storm) | 1 hr |

### Phase 4: Presentation — 1 hour

| Step | Task | Time |
|------|------|------|
| 4.1 | Write pitch script (hook → gap → solution → demo → impact) | 30 min |
| 4.2 | Rehearse demo flow once | 30 min |

**Total: ~9 hours** (down from 18–22)

---

## Prep BEFORE the Hackathon

Do these before the clock starts — they don't require code:

1. **Register ISRO PRADAN SSO** — takes 1–2 days for approval
2. **Build `navic_errors.csv`** — read the 5–6 papers, extract Dst vs NavIC error data points manually into a CSV
3. **Download OMNI data** — go to omniweb, select 2000–2024 hourly, download ASCII
4. **Download India GeoJSON** — from BHUVAN or a public GitHub repo
5. **Note 3–4 recent NDMA disaster zones** — lat/lon and type, to hardcode in demo

---

## Presentation Strategy

### The Pitch (3–5 min)

1. **Hook (30 sec):** "On July 3, 2021, NavIC positioning errors hit 64 meters in Ahmedabad. If a rescue helicopter was using NavIC during a flood, it could've landed on the wrong side of a river."

2. **The Gap (45 sec):** ISRO says NavIC was fine during the May 2024 superstorm. They're right — the satellites worked. But user-level positioning accuracy degraded massively. No one is monitoring that.

3. **Our Solution (60 sec):** SolarShield-NavIC uses Aditya-L1 solar wind data to predict storms, estimates NavIC positioning errors, and overlays degradation on active disaster zones to warn rescue teams.

4. **Live Demo (90 sec):** Walk through dashboard — quiet sun → storm arrives → map turns red → alert fires for flood zone.

5. **Impact (30 sec):** This could save lives during the next cyclone + geomagnetic storm coincidence. India has the data (Aditya-L1), the need (NavIC-dependent disaster response), and no existing tool.

### Key Differentiators

- Uses **India's own Aditya-L1** data
- Exploits the **ISRO contradiction**: "satellites work" ≠ "your position is accurate"
- **Cross-domain**: solar physics + navigation + disaster management
- **No existing tool** does this (validated via Grok X search + GitHub search)

---

## Research Citations

| # | Paper / Source | Key Finding | Used For |
|---|---------------|-------------|----------|
| 1 | Hakani & Rawat, 2025 (IITRAM) | NavIC errors peaked at 64.06m during July 3, 2021 storm | M2 data, pitch hook |
| 2 | Desai & Shah, 2018 (SVNIT Surat) | NavIC TEC analysis during geomagnetic disturbances | M2 data |
| 3 | BITS-Pilani Goa study | NavIC L5 and S-band scintillation measurements | 1.3× scaling factor |
| 4 | ISRO URSI 2024 paper | NavIC ionosphere model accuracy during storms | M2 reference |
| 5 | Ye et al., 2025 (ApJ Suppl.) | XGBoost Dst prediction: MAE 5.62 nT, R² 0.96 | M1 benchmark |
| 6 | ASPEX validation (arXiv 2507.17523) | ASPEX-SWIS validated against Wind and DSCOVR | Aditya-L1 data reliability |

---

## Risk Register

| Risk | Mitigation |
|------|------------|
| PRADAN registration delays | Use Zenodo ASPEX dump + OMNI as fallback |
| NavIC error dataset too small | Use GPS error papers × 1.3 scaling to augment |
| M1 accuracy is mediocre | Fine for hackathon — show R² and explain trade-off in pitch |
| NDMA has no clean API | Hardcode 3–4 recent disaster zones for demo |
| Judges don't understand space weather | Lead with the 64m helicopter scenario, skip jargon |

---

## Dependencies (requirements.txt)

```
streamlit>=1.30
plotly>=5.18
folium>=0.15
streamlit-folium>=0.18
pandas>=2.1
numpy>=1.26
scikit-learn>=1.3
xgboost>=2.0
cdflib>=1.2
requests>=2.31
joblib>=1.3
```

---

## Quick Start

```bash
pip install -r requirements.txt
python data/download_omni.py
python models/m1_storm_predictor.py
python models/m2_navic_error.py
streamlit run app.py
```
