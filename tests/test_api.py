"""API smoke tests. Run from the repo root:  pytest -q"""
import numpy as np
import pytest
from fastapi.testclient import TestClient

from solarshield.api import app
from solarshield.pipeline import MIN_GNSS_SAMPLES

SOLAR_WIND = {"bz": -15.0, "proton_density": 20.0, "sw_speed": 650.0, "dyn_pressure": 12.0, "dst": -80.0}


def gnss_samples(n=MIN_GNSS_SAMPLES + 10, seed=0):
    """Synthetic c1..c3 random walk, just to exercise the pipeline."""
    rng = np.random.default_rng(seed)
    walk = np.cumsum(rng.normal(0, 0.05, size=(n, 3)), axis=0) + [1.0, 1.5, 3.0]
    return [{"c1": a, "c2": b, "c3": c} for a, b, c in walk.tolist()]


@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:  # "with" runs the startup that loads the models
        yield c


def test_health(client):
    assert client.get("/health").json() == {"status": "ok"}


def test_storm(client):
    r = client.post("/predict/storm", json=SOLAR_WIND)
    assert r.status_code == 200
    body = r.json()
    assert isinstance(body["dst_next_hour_nt"], float)
    assert body["storm_category"] in {"quiet", "weak", "moderate", "intense", "extreme"}


def test_gnss(client):
    r = client.post("/predict/gnss", json={"samples": gnss_samples()})
    assert r.status_code == 200
    assert r.json()["error_m"] >= 0


def test_gnss_too_few_samples(client):
    r = client.post("/predict/gnss", json={"samples": gnss_samples(5)})
    assert r.status_code == 422


def test_alerts(client):
    levels = [a["level"] for a in client.get("/alerts", params={"error_m": 42}).json()]
    assert levels[0] == "RED"


def test_full_pipeline(client):
    r = client.post("/pipeline", json={"solar_wind": SOLAR_WIND, "gnss": {"samples": gnss_samples()}})
    assert r.status_code == 200
    body = r.json()
    assert {"storm", "gnss", "alerts", "highest_level"} <= set(body)
    assert len(body["alerts"]) == 4
