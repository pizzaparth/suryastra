"""M1 storm severity predictor: solar wind at hour t -> Dst at hour t+1.

The saved model predicts the change Dst(t+1) - Dst(t) (the "delta model"); use
`predict_dst_next` to turn that back into an absolute Dst forecast in nT.
"""
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from xgboost import XGBRegressor

from solarshield.config import M1_MODEL_PATH

FEATURES = ["bz", "proton_density", "sw_speed", "dyn_pressure", "dst_lag1"]
TARGET = "dst_next"
STORM_THRESHOLD_NT = -50

TRAIN_YEARS = (None, 2016)
VAL_YEARS = (2017, 2020)
TEST_YEARS = (2021, None)

XGB_PARAMS = dict(n_estimators=500, max_depth=6, learning_rate=0.1, random_state=42, n_jobs=-1)


def build_dataset(df: pd.DataFrame) -> pd.DataFrame:
    """Add the dst_lag1 feature and dst_next target, dropping rows with missing values."""
    gaps = df.index.to_series().diff().dropna()
    if not gaps.eq(pd.Timedelta(hours=1)).all():
        raise ValueError("OMNI index is not a continuous hourly series")

    data = df.copy()
    data["dst_lag1"] = data["dst"]          # Dst at hour t
    data[TARGET] = data["dst"].shift(-1)    # Dst at hour t+1
    return data.dropna(subset=FEATURES + [TARGET])


def _years(data: pd.DataFrame, lo, hi) -> pd.DataFrame:
    mask = pd.Series(True, index=data.index)
    if lo is not None:
        mask &= data["year"] >= lo
    if hi is not None:
        mask &= data["year"] <= hi
    return data[mask]


def split_by_year(data: pd.DataFrame) -> dict[str, pd.DataFrame]:
    """Chronological train / val / test split (no shuffling, no leakage across time)."""
    return {
        "train": _years(data, *TRAIN_YEARS),
        "val": _years(data, *VAL_YEARS),
        "test": _years(data, *TEST_YEARS),
    }


def train_delta_model(train: pd.DataFrame, val: pd.DataFrame, verbose: int | bool = 100) -> XGBRegressor:
    """Fit XGBoost on the target Dst(t+1) - Dst(t)."""
    def delta(part):
        return part[TARGET] - part["dst_lag1"]

    model = XGBRegressor(**XGB_PARAMS)
    model.fit(
        train[FEATURES], delta(train),
        eval_set=[(train[FEATURES], delta(train)), (val[FEATURES], delta(val))],
        verbose=verbose,
    )
    return model


def predict_dst_next(model: XGBRegressor, X: pd.DataFrame) -> np.ndarray:
    """Forecast Dst at t+1 (nT) from features at hour t."""
    return model.predict(X[FEATURES]) + X["dst_lag1"].to_numpy()


def metrics(y_true, y_pred) -> dict[str, float]:
    return {
        "R2": r2_score(y_true, y_pred),
        "MAE (nT)": mean_absolute_error(y_true, y_pred),
        "RMSE (nT)": float(np.sqrt(mean_squared_error(y_true, y_pred))),
    }


def evaluate(model: XGBRegressor, part: pd.DataFrame) -> dict[str, dict[str, float]]:
    """Metrics on all hours and on storm hours (Dst < -50 nT)."""
    y = part[TARGET]
    pred = predict_dst_next(model, part)
    storm = (y < STORM_THRESHOLD_NT).to_numpy()
    return {"all hours": metrics(y, pred), "storm hours": metrics(y[storm], pred[storm])}


def save_bundle(model: XGBRegressor, test_metrics: dict, path: Path = M1_MODEL_PATH) -> None:
    bundle = {
        "model": model,
        "features": FEATURES,
        "target": "Dst(t+1) - Dst(t) in nT; add dst_lag1 to get Dst at t+1",
        "predicts_delta": True,
        "train_years": "2000-2016",
        "test_metrics": test_metrics["all hours"],
        "test_storm_metrics": test_metrics["storm hours"],
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(bundle, path)


def load_model(path: Path = M1_MODEL_PATH) -> XGBRegressor:
    return joblib.load(path)["model"]
