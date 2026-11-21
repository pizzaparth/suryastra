# SolarShield-NavIC

Predict how solar storms degrade NavIC positioning accuracy over India. See [plan.md](plan.md) for the full design.

## Layout

```
├── solarshield/              # importable Python package (all reusable code)
│   ├── config.py             # repo paths (data, model files)
│   ├── data/omni.py          # NASA OMNI hourly loader
│   └── models/
│       ├── m1_storm.py       # M1: solar wind -> Dst(t+1), XGBoost
│       └── gnss.py           # GNSS LightGBM (c3, 10-step horizon) loader
├── scripts/train_m1.py       # retrain M1 from scratch and save models/m1_xgb.pkl
├── notebooks/                # exploration; imports from solarshield/
├── models/                   # trained artifacts only (no code)
│   ├── m1_xgb.pkl
│   └── gnss_model/
└── data/raw/                 # downloaded datasets
```

## Setup

```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
```

## Usage

```bash
python scripts/train_m1.py          # retrain M1
```

```python
from solarshield.models import m1_storm, gnss

m1 = m1_storm.load_model()
dst_next = m1_storm.predict_dst_next(m1, X)   # X has bz, proton_density, sw_speed, dyn_pressure, dst_lag1

g = gnss.load_gnss_model()
y = g.predict(X_gnss)                          # X_gnss has the columns in g.features
```
