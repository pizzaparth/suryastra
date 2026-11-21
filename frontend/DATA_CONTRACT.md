# Data files

Both files are written by `scripts/export_dashboard.py` in the repo root. The dashboard only reads them.

## `src/data/scenarios.json`

```jsonc
{
  "rules": [ /* alert levels from config/alert_rules.json: id, label, status, action */ ],
  "sites": [ { "id", "name", "kind": "receiver" | "disaster", "lat", "lon" } ],
  "m2_coeffs": [a, b, c],          // plan.md polynomial, used only for the signal-path visuals
  "scenarios": [
    {
      "id": "may2024", "name": "May 2024", "title": "...",
      "timeline": { "start": "ISO UTC", "end": "ISO UTC", "impact_h": 6 },
      "hourly": [                   // 31 rows, one per hour
        {
          "t": "ISO UTC",
          "inputs": { "bz", "proton_density", "sw_speed", "dyn_pressure" },   // OMNI, real
          "dst_obs": -33,                                                       // OMNI, real
          "magnetopause_re": 5.59,                                              // Shue (1998)
          "m1": { "forecast_for", "dst_pred", "dst_obs_at_target" },           // M1 output
          "m2": { "forecast_for", "navic_error_m", "multiplier", "navic_error_from_observed_m" },
          "alerts": { "disaster": "RED", "receiver": "ORANGE" },                // rule engine on m2
          "alerts_if_observed": { "disaster", "receiver" }                     // same rules on observed Dst
        }
      ],
      "results": {
        "min_dst_obs", "min_dst_obs_h", "min_dst_pred", "peak_speed", "min_bz", "peak_pressure",
        "min_magnetopause_re", "peak_navic_error_m", "storm_hours",
        "m1": { "mae", "rmse", "r2" }, "persistence": { ... },
        "m1_storm_hours": { ... }, "persistence_storm_hours": { ... },
        "first_observed_storm_h", "first_forecast_storm_issued_h", "first_red_issued_h",
        "storm_warning_lead_h", "red_lead_vs_storm_h"
      }
    }
  ]
}
```

A forecast issued at hour `i` is for hour `i + 1`. Lead times compare the hour a warning was issued with the hour observed Dst first fell below −50 nT.

## `src/data/analysis.json`

| Key | Contents |
|---|---|
| `dataset` | Daily min Dst 2000–2024, storm hours per year, Dst quartiles per year, Dst histogram, correlation matrix, monthly min heatmap, 3D and 2D samples |
| `m1` | Metrics per split (model and persistence), test predicted vs observed sample, residual histogram, MAE by Dst range, importance (gain/weight/cover), mean SHAP, SHAP dependence, two response surfaces |
| `m2` | Coefficients, fitted points, day and night curves, error surface over Dst × IST hour |
| `gnss` | LightGBM importance (sorted), importance by channel and by feature type, test metrics |
