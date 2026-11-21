"""GNSS error model: LightGBM forecasting channel c3, 10 steps (5 min at 30 s) ahead.

Only the trained weights are in the repo (models/gnss_model/), not the training or
feature-engineering code, so `predict` expects a DataFrame that already contains the
columns listed in `features` (lags, rolling mean/std/dev and first difference of c1-c3).
"""
import json
from dataclasses import dataclass
from pathlib import Path

import lightgbm as lgb
import numpy as np
import pandas as pd

from solarshield.config import GNSS_MODEL_DIR

MODEL_NAME = "lgbm_c3_h10"


@dataclass
class GnssModel:
    booster: lgb.Booster
    meta: dict

    @property
    def features(self) -> list[str]:
        return self.booster.feature_name()

    def predict(self, X: pd.DataFrame) -> np.ndarray:
        missing = set(self.features) - set(X.columns)
        if missing:
            raise KeyError(f"missing GNSS features: {sorted(missing)}")
        return self.booster.predict(X[self.features])


def load_gnss_model(model_dir: Path = GNSS_MODEL_DIR, name: str = MODEL_NAME) -> GnssModel:
    """Load the booster from its native text dump (portable across LightGBM versions) plus metadata."""
    booster = lgb.Booster(model_file=str(model_dir / f"{name}.txt"))
    meta = json.loads((model_dir / f"{name}_meta.json").read_text())
    return GnssModel(booster=booster, meta=meta)
