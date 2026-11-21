// Builds the dashboard's data files.
//
//   node scripts/build_mock.mjs
//
// Writes:
//   src/data/scenario_may2024.json  - the replay scenario (schema documented in DATA_CONTRACT.md)
//   src/data/land_dots.json         - lat/lon dots for the stylised globe
//
// What is real and what is mock:
//   REAL  - hourly solar wind + Dst rows (scripts/omni_may2024.txt, cut from data/raw/omni2_*.lst)
//   REAL  - M1 test metrics (copied from notebooks/m1_storm_predictor.ipynb outputs)
//   REAL  - GNSS model test metrics (copied from models/gnss_model/lgbm_c3_h10_meta.json)
//   MOCK  - M1 forecasts, M2 errors, GNSS c3 series. Replace with a Python export of the real models.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { feature } from "topojson-client";
import { geoContains } from "d3-geo";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const outDir = path.join(root, "src", "data");
fs.mkdirSync(outDir, { recursive: true });

// ---------- deterministic noise ----------
let seed = 20240510;
function rand() {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
}
function gauss() {
  const u = Math.max(rand(), 1e-9);
  const v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const round = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

// ---------- observed OMNI rows ----------
const rows = fs
  .readFileSync(path.join(here, "omni_may2024.txt"), "utf8")
  .trim()
  .split("\n")
  .map((line) => {
    const [year, doy, hour, bz, n, v, p, dst] = line.trim().split(/\s+/).map(Number);
    const t = new Date(Date.UTC(year, 0, 1) + (doy - 1) * 864e5 + hour * 36e5);
    return { t, bz, proton_density: n, sw_speed: v, dyn_pressure: p, dst };
  });

// ---------- M2 (plan.md): 2nd-degree polyfit Dst -> NavIC error, x1.5 post-sunset ----------
const M2_POINTS = {
  dst: [-5, -30, -50, -63, -100, -150, -204, -300, -412],
  err: [2.5, 5, 12, 64.06, 35, 42, 45, 65, 80],
};
function polyfit2(xs, ys) {
  // least squares for y = a x^2 + b x + c via normal equations
  const S = (f) => xs.reduce((s, x, i) => s + f(x, ys[i]), 0);
  const n = xs.length;
  const sx = S((x) => x), sx2 = S((x) => x * x), sx3 = S((x) => x ** 3), sx4 = S((x) => x ** 4);
  const sy = S((x, y) => y), sxy = S((x, y) => x * y), sx2y = S((x, y) => x * x * y);
  const A = [[sx4, sx3, sx2], [sx3, sx2, sx], [sx2, sx, n]];
  const B = [sx2y, sxy, sy];
  const det = (m) =>
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  const D = det(A);
  const col = (k) => A.map((r, i) => r.map((v, j) => (j === k ? B[i] : v)));
  return [det(col(0)) / D, det(col(1)) / D, det(col(2)) / D];
}
const M2_COEFFS = polyfit2(M2_POINTS.dst, M2_POINTS.err);
const istHour = (t) => ((t.getUTCHours() + t.getUTCMinutes() / 60 + 5.5) % 24);
const m2Multiplier = (t) => {
  const h = istHour(t);
  return h >= 18 || h < 6 ? 1.5 : 1.0;
};
function m2(dst, t) {
  const [a, b, c] = M2_COEFFS;
  const base = Math.max(a * dst * dst + b * dst + c, 2.0);
  const mult = m2Multiplier(t);
  return { base_error_m: round(base), multiplier: mult, navic_error_m: round(base * mult) };
}

// ---------- M1 mock forecast: features at hour t -> Dst(t+1) ----------
// Shape follows the saved delta model's behaviour on this storm (notebook cell 16):
// lags sharp drops, overshoots the minimum (model min -443 nT vs observed -406 nT).
const hourly = [];
for (let i = 0; i < rows.length - 1; i++) {
  const r = rows[i];
  const next = rows[i + 1];
  let pred = r.dst + 0.72 * (next.dst - r.dst) + gauss() * 7;
  if (next.dst === Math.min(...rows.map((x) => x.dst))) pred = -443;
  pred = round(pred, 0);
  const forecastFor = next.t;
  hourly.push({
    t: r.t.toISOString(),
    inputs: {
      bz: r.bz,
      proton_density: r.proton_density,
      sw_speed: r.sw_speed,
      dyn_pressure: r.dyn_pressure,
      dst_lag1: r.dst,
    },
    dst_obs: r.dst,
    m1: { forecast_for: forecastFor.toISOString(), dst_pred: pred, dst_obs_at_target: next.dst },
    m2: { input: "m1.dst_pred", forecast_for: forecastFor.toISOString(), ...m2(pred, forecastFor) },
  });
}
// last row has observations but no forecast target
const last = rows[rows.length - 1];
hourly.push({
  t: last.t.toISOString(),
  inputs: { bz: last.bz, proton_density: last.proton_density, sw_speed: last.sw_speed, dyn_pressure: last.dyn_pressure, dst_lag1: last.dst },
  dst_obs: last.dst,
  m1: null,
  m2: null,
});

const mockMae =
  hourly.filter((h) => h.m1).reduce((s, h) => s + Math.abs(h.m1.dst_pred - h.m1.dst_obs_at_target), 0) /
  hourly.filter((h) => h.m1).length;

// ---------- GNSS LightGBM mock: c3 (Up error, m), 30 s steps, 10-step (5 min) horizon ----------
const Y_CLIP = [-0.32750048577785484, 0.37059998512268066];
const gnssStart = new Date(Date.UTC(2024, 4, 11, 2, 0, 0)); // around Dst minimum
const STEPS = 60 + 10;
const c3 = [];
let level = 0.02;
for (let k = 0; k < STEPS; k++) {
  const storm = 0.55 + 0.45 * Math.sin((k / STEPS) * Math.PI); // bursty scintillation envelope
  level = 0.86 * level + gauss() * 0.045 * storm + 0.012 * Math.sin(k / 4.5);
  c3.push(Math.min(Y_CLIP[1], Math.max(Y_CLIP[0], level)));
}
const gnssSeries = [];
for (let k = 0; k < 60; k++) {
  const target = k + 10;
  const persist = c3[k];
  const lgbm = c3[k] + 0.05 * (c3[target] - c3[k]) + gauss() * 0.006;
  gnssSeries.push({
    t: new Date(gnssStart.getTime() + k * 30e3).toISOString(),
    c3_obs: round(c3[k], 4),
    forecast_for: new Date(gnssStart.getTime() + target * 30e3).toISOString(),
    c3_pred: round(lgbm, 4),
    c3_persistence: round(persist, 4),
    c3_obs_at_target: round(c3[target], 4),
  });
}

// ---------- sites ----------
const sites = [
  { id: "blr", name: "Bengaluru", kind: "receiver", lat: 13.02, lon: 77.57 },
  { id: "hyd", name: "Hyderabad", kind: "receiver", lat: 17.42, lon: 78.55 },
  { id: "amd", name: "Ahmedabad", kind: "receiver", lat: 23.03, lon: 72.55 },
  { id: "del", name: "New Delhi", kind: "receiver", lat: 28.61, lon: 77.21 },
  { id: "ccu", name: "Kolkata", kind: "receiver", lat: 22.57, lon: 88.36 },
  { id: "trv", name: "Thiruvananthapuram", kind: "receiver", lat: 8.52, lon: 76.94 },
  { id: "kerala", name: "Kerala flood rescue", kind: "disaster", lat: 9.5, lon: 76.4, disaster_type: "flood" },
  { id: "odisha", name: "Odisha cyclone response", kind: "disaster", lat: 19.81, lon: 85.83, disaster_type: "cyclone" },
  { id: "assam", name: "Assam flood relief", kind: "disaster", lat: 26.14, lon: 91.74, disaster_type: "flood" },
];

const scenario = {
  meta: {
    title: "May 10-11, 2024 geomagnetic superstorm",
    contract_version: 1,
    generated_by: "frontend/scripts/build_mock.mjs",
    mock: true,
    real_fields: ["hourly[].inputs", "hourly[].dst_obs", "m1_metrics", "gnss.metrics"],
    mock_fields: ["hourly[].m1", "hourly[].m2", "gnss.series"],
    note: "Observed values are NASA OMNI hourly rows. Forecasts are placeholders shaped like the real models; replace them with a Python export.",
    mock_window_m1_mae_nt: round(mockMae, 1),
  },
  timeline: {
    start: hourly[0].t,
    end: hourly[hourly.length - 1].t,
    step_hours: 1,
    impact: "2024-05-10T17:05:00.000Z",
  },
  hourly,
  m1_metrics: {
    source: "notebooks/m1_storm_predictor.ipynb (delta model = saved model)",
    test_all_hours: { r2: 0.965, mae_nt: 2.587, rmse_nt: 3.951 },
    test_storm_hours: { r2: 0.951, mae_nt: 6.418, rmse_nt: 10.579 },
    persistence_all_hours: { r2: 0.953, mae_nt: 2.885, rmse_nt: 4.579 },
    persistence_storm_hours: { r2: 0.93, mae_nt: 7.864, rmse_nt: 12.73 },
    may2024_window: {
      model: { r2: 0.96, mae_nt: 11.1, rmse_nt: 21.81, min_dst_nt: -443 },
      persistence: { r2: 0.96, mae_nt: 10.13, rmse_nt: 21.67 },
      observed_min_dst_nt: -406,
    },
  },
  m2_model: {
    source: "plan.md (not built yet)",
    form: "error_m = a*dst^2 + b*dst + c, floor 2 m, x1.5 when IST hour is 18-06",
    coeffs: M2_COEFFS.map((c) => Number(c.toPrecision(6))),
    training_points: M2_POINTS,
  },
  gnss: {
    model: "lgbm_c3_h10",
    target: "c3 (Up position error, m)",
    step_seconds: 30,
    horizon_steps: 10,
    display_station: "blr",
    station_note: "Model validated on a global station network; transfer to Indian receivers not yet tested.",
    window_start: gnssStart.toISOString(),
    series: gnssSeries,
    metrics: {
      source: "models/gnss_model/lgbm_c3_h10_meta.json",
      lgbm_mae_m: 0.05329,
      persistence_mae_m: 0.05628,
      improvement_pct: 5.3,
    },
  },
  sites,
};

fs.writeFileSync(path.join(outDir, "scenario_may2024.json"), JSON.stringify(scenario, null, 1));

// ---------- land dots + India outline ----------
const world = JSON.parse(fs.readFileSync(path.join(root, "node_modules/world-atlas/countries-110m.json"), "utf8"));
const land = feature(world, world.objects.land);
const countries = feature(world, world.objects.countries);
const india = countries.features.find((f) => f.id === "356");

const dots = [];
const STEP = 1.5;
for (let lat = -84; lat <= 84; lat += STEP) {
  const n = Math.max(1, Math.round((360 * Math.cos((lat * Math.PI) / 180)) / STEP));
  for (let j = 0; j < n; j++) {
    const lon = -180 + (360 * j) / n;
    if (geoContains(india, [lon, lat])) continue; // India gets its own dense grid
    if (geoContains(land, [lon, lat])) dots.push([round(lat, 2), round(lon, 2)]);
  }
}
const indiaDots = [];
const ISTEP = 0.55;
for (let lat = 6; lat <= 37; lat += ISTEP) {
  const n = Math.round((360 * Math.cos((lat * Math.PI) / 180)) / ISTEP);
  for (let j = 0; j < n; j++) {
    const lon = -180 + (360 * j) / n;
    if (lon < 66 || lon > 99) continue;
    if (geoContains(india, [lon, lat])) indiaDots.push([round(lat, 2), round(lon, 2)]);
  }
}
const outline = (india.geometry.type === "Polygon" ? [india.geometry.coordinates] : india.geometry.coordinates).map(
  (poly) => poly[0].map(([lon, lat]) => [round(lat, 2), round(lon, 2)])
);
fs.writeFileSync(path.join(outDir, "land_dots.json"), JSON.stringify({ land: dots, india: indiaDots, india_outline: outline }));

console.log(`hourly rows: ${hourly.length}, mock M1 MAE on window: ${mockMae.toFixed(1)} nT`);
console.log(`M2 coeffs: ${M2_COEFFS.map((c) => c.toExponential(3)).join(", ")}`);
console.log(`land dots: ${dots.length}, india dots: ${indiaDots.length}`);
