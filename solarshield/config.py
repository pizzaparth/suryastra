"""Project paths, resolved from the repo root so code works from any working directory."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

DATA_DIR = ROOT / "data"
RAW_DIR = DATA_DIR / "raw"
OMNI_PATH = RAW_DIR / "omni2_Q21fNnxIU8.lst"

MODELS_DIR = ROOT / "models"
M1_MODEL_PATH = MODELS_DIR / "m1_xgb.pkl"
GNSS_MODEL_DIR = MODELS_DIR / "gnss_model"
