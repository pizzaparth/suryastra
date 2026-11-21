"""Loader for the NASA OMNI hourly ASCII export (omniweb.gsfc.nasa.gov)."""
from pathlib import Path

import numpy as np
import pandas as pd

from solarshield.config import OMNI_PATH

COLUMNS = ["year", "doy", "hour", "bz", "proton_density", "sw_speed", "dyn_pressure", "dst"]

# OMNI marks missing values with all-9 fill values.
FILL_VALUES = {"bz": 999.9, "proton_density": 999.9, "sw_speed": 9999.0, "dyn_pressure": 99.99, "dst": 99999}


def load_omni(path: Path = OMNI_PATH) -> pd.DataFrame:
    """Read the OMNI file into an hourly, time-indexed DataFrame with fill values set to NaN."""
    df = pd.read_csv(path, sep=r"\s+", header=None, names=COLUMNS)

    for col, fill in FILL_VALUES.items():
        df.loc[df[col] >= fill, col] = np.nan

    df["time"] = (
        pd.to_datetime(df["year"].astype(str), format="%Y")
        + pd.to_timedelta(df["doy"] - 1, unit="D")
        + pd.to_timedelta(df["hour"], unit="h")
    )
    return df.set_index("time").sort_index()
