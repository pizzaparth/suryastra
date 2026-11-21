"""FastAPI service for the SolarShield pipeline.

Run from the repo root:
    uvicorn solarshield.api:app --reload
Then open http://127.0.0.1:8000/docs for the interactive API page.
"""
from __future__ import annotations

from contextlib import asynccontextmanager

import pandas as pd
from fastapi import FastAPI, HTTPException, Query, Request
from pydantic import BaseModel, Field

from solarshield.pipeline import MIN_GNSS_SAMPLES, Pipeline


# ---------------------------------------------------------------- request bodies
class SolarWind(BaseModel):
    bz: float = Field(..., description="IMF Bz (nT); negative = southward", examples=[-15.0])
    proton_density: float = Field(..., ge=0, description="Proton density (n/cm³)", examples=[20.0])
    sw_speed: float = Field(..., gt=0, description="Solar wind speed (km/s)", examples=[650.0])
    dyn_pressure: float = Field(..., ge=0, description="Dynamic pressure (nPa)", examples=[12.0])
    dst: float = Field(..., description="Dst index for the current hour (nT)", examples=[-80.0])


class GnssSample(BaseModel):
    c1: float
    c2: float
    c3: float


class GnssHistory(BaseModel):
    samples: list[GnssSample] = Field(
        ...,
        min_length=MIN_GNSS_SAMPLES,
        description=f"At least {MIN_GNSS_SAMPLES} readings, oldest first, 30 s apart",
    )

    def to_frame(self) -> pd.DataFrame:
        return pd.DataFrame([s.model_dump() for s in self.samples])


class PipelineRequest(BaseModel):
    solar_wind: SolarWind
    gnss: GnssHistory


# ---------------------------------------------------------------- app
@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.pipeline = Pipeline()  # load models once at startup
    yield


app = FastAPI(
    title="SolarShield-NavIC API",
    description="Solar wind -> storm forecast; GNSS history -> error forecast; error -> disaster-zone alerts.",
    version="0.1.0",
    lifespan=lifespan,
)


def _pipeline(request: Request) -> Pipeline:
    return request.app.state.pipeline


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/predict/storm")
def predict_storm(body: SolarWind, request: Request):
    """M1 only: solar wind now -> Dst one hour ahead."""
    return _pipeline(request).predict_storm(body.model_dump())


@app.post("/predict/gnss")
def predict_gnss(body: GnssHistory, request: Request):
    """GNSS model only: recent c1..c3 readings -> c3 five minutes ahead."""
    try:
        return _pipeline(request).predict_gnss(body.to_frame())
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))


@app.get("/alerts")
def alerts(error_m: float = Query(..., ge=0, description="NavIC error in metres")):
    """Alert engine only: handy for the demo slider."""
    return Pipeline.alerts(error_m)


@app.post("/pipeline")
def run_pipeline(body: PipelineRequest, request: Request):
    """Everything: storm forecast + GNSS error forecast + per-zone alerts."""
    try:
        return _pipeline(request).run(body.solar_wind.model_dump(), body.gnss.to_frame())
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
