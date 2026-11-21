"""Train M1 (storm severity predictor) end to end and save the model bundle.

    python scripts/train_m1.py [--out models/m1_xgb.pkl]
"""
import argparse
import sys
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from solarshield.config import M1_MODEL_PATH  # noqa: E402
from solarshield.data.omni import load_omni  # noqa: E402
from solarshield.models import m1_storm  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path, default=M1_MODEL_PATH)
    args = parser.parse_args()

    data = m1_storm.build_dataset(load_omni())
    splits = m1_storm.split_by_year(data)
    for name, part in splits.items():
        print(f"{name:5s} {part.index.min():%Y-%m-%d} -> {part.index.max():%Y-%m-%d}  {len(part):7,} rows")

    model = m1_storm.train_delta_model(splits["train"], splits["val"])

    results = {name: m1_storm.evaluate(model, part) for name, part in splits.items()}
    print(pd.DataFrame({(s, k): v for s, r in results.items() for k, v in r.items()}).T.round(3))

    m1_storm.save_bundle(model, results["test"], args.out)
    print("Saved to", args.out)


if __name__ == "__main__":
    main()
