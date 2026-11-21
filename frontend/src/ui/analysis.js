// Data analysis page. Every number here was computed once by scripts/export_dashboard.py
// (analysis.json + scenarios.json); this file only draws it.
import Plotly from "plotly.js-dist-min";
import A from "../data/analysis.json";
import S from "../data/scenarios.json";

const WHITE = "#ffffff";
const ORANGE = "#ff8a24";
const BLUE = "#4f8dff";
const GREY = "#8c8c8c";
const SC_COLOR = { may2024: WHITE, apr2023: ORANGE, nov2021: BLUE };
const LEVEL_RANK = { GREEN: 0, YELLOW: 1, ORANGE: 2, RED: 3 };
const LEVEL_NAMES = ["Green", "Yellow", "Orange", "Red"];
// Brighter = more intense storm (low Dst) or larger error.
const STORM_SCALE = [[0, "#fff1dc"], [0.3, ORANGE], [0.65, "#4a2200"], [1, "#111111"]];
const ERROR_SCALE = [[0, "#111111"], [0.4, "#4a2200"], [0.75, ORANGE], [1, "#fff1dc"]];
const DIVERGING = [[0, BLUE], [0.5, "#262626"], [1, ORANGE]];
const LEVEL_SCALE = [
  [0, "#2b2b2b"], [0.25, "#2b2b2b"], [0.25, "#6b6b6b"], [0.5, "#6b6b6b"],
  [0.5, "#b3b3b3"], [0.75, "#b3b3b3"], [0.75, "#ffffff"], [1, "#ffffff"],
];

const axis = (title, extra = {}) => ({
  title: { text: title, font: { size: 14 } },
  gridcolor: "#1f1f1f",
  zerolinecolor: "#3a3a3a",
  linecolor: "#3a3a3a",
  tickfont: { size: 13 },
  ...extra,
});
const axis3 = (title) => ({
  title: { text: title, font: { size: 13 } },
  gridcolor: "#2e2e2e",
  zerolinecolor: "#555",
  showbackground: false,
  color: "#bdbdbd",
  tickfont: { size: 12 },
});
const base = (extra = {}) => ({
  paper_bgcolor: "#000",
  plot_bgcolor: "#000",
  font: { family: '"Archivo Variable", system-ui, sans-serif', size: 14, color: "#bdbdbd" },
  margin: { l: 64, r: 20, t: 12, b: 54 },
  legend: { orientation: "h", x: 0, y: 1.14, font: { size: 13 } },
  hoverlabel: { bgcolor: "#000", bordercolor: "#555", font: { color: "#fff", size: 14 } },
  colorway: [WHITE, ORANGE, BLUE, GREY],
  ...extra,
});
const CONFIG = { displaylogo: false, responsive: true, modeBarButtonsToRemove: ["lasso2d", "select2d", "toImage"] };

const sinceShock = (sc) => sc.hourly.map((_, i) => i - sc.timeline.impact_h);
const fmt = (v, d = 1) => (v == null ? "–" : Number(v).toFixed(d).replace("-", "−"));

// ---------------- chart definitions ----------------
function scenarioCharts() {
  const scs = S.scenarios;
  const charts = [];

  const dstTraces = scs.flatMap((sc) => {
    const x = sinceShock(sc);
    return [
      { x, y: sc.hourly.map((h) => h.dst_obs), name: `${sc.name} observed`, line: { color: SC_COLOR[sc.id], width: 2 } },
      {
        x: sc.hourly.filter((h) => h.m1).map((_, i) => x[i] + 1),
        y: sc.hourly.filter((h) => h.m1).map((h) => h.m1.dst_pred),
        name: `${sc.name} M1 forecast`,
        line: { color: SC_COLOR[sc.id], width: 2, dash: "dash" },
      },
    ];
  });
  charts.push({
    title: "Dst: observed vs M1 forecast",
    sub: "Forecasts are plotted at the hour they predict. Hour 0 is the shock arriving at Earth.",
    wide: true,
    data: dstTraces.map((t) => ({ ...t, type: "scatter", mode: "lines" })),
    layout: base({ xaxis: axis("Hours since shock"), yaxis: axis("Dst (nT)"), shapes: [hline(-50)] }),
  });

  charts.push({
    title: "Forecast error on each storm",
    sub: "Mean absolute error of the 1-hour Dst forecast. Persistence assumes Dst does not change.",
    data: [
      { type: "bar", name: "M1", x: scs.map((s) => s.name), y: scs.map((s) => s.results.m1.mae), marker: { color: WHITE } },
      { type: "bar", name: "Persistence", x: scs.map((s) => s.name), y: scs.map((s) => s.results.persistence.mae), marker: { color: "#555" } },
    ],
    layout: base({ barmode: "group", xaxis: axis(""), yaxis: axis("MAE (nT)") }),
  });

  charts.push({
    title: "Warning lead time",
    sub: "Hours between the first warning and Dst actually falling below −50 nT. Below zero means late.",
    data: [
      { type: "bar", name: "Storm-level forecast", x: scs.map((s) => s.name), y: scs.map((s) => s.results.storm_warning_lead_h), marker: { color: WHITE } },
      { type: "bar", name: "First red alert", x: scs.map((s) => s.name), y: scs.map((s) => s.results.red_lead_vs_storm_h), marker: { color: ORANGE } },
    ],
    layout: base({ barmode: "group", xaxis: axis(""), yaxis: axis("Hours", { dtick: 1 }) }),
  });

  const line = (key, title, unit, sub, shapes = []) => ({
    title,
    sub,
    data: scs.map((sc) => ({
      type: "scatter",
      mode: "lines",
      name: sc.name,
      x: sinceShock(sc),
      y: sc.hourly.map((h) => (key === "mp" ? h.magnetopause_re : h.inputs[key])),
      line: { color: SC_COLOR[sc.id], width: 2 },
    })),
    layout: base({ xaxis: axis("Hours since shock"), yaxis: axis(unit), shapes }),
  });
  charts.push(line("bz", "Magnetic field Bz", "Bz (nT)", "Southward (negative) Bz is what lets the storm energy in."));
  charts.push(line("dyn_pressure", "Solar wind dynamic pressure", "Pressure (nPa)", "The jump at hour 0 is the shock arriving."));
  charts.push(line("mp", "Magnetopause distance", "Earth radii", "Shue (1998) model from observed pressure and Bz. Dashed line: geostationary orbit, 6.6 Rₑ.", [hline(6.6)]));

  charts.push({
    title: "NavIC error over India",
    sub: "M2 applied to the M1 forecast (solid) and to the Dst that actually happened (dashed).",
    data: scs.flatMap((sc) => {
      const x = sinceShock(sc).map((v) => v + 1);
      const rows = sc.hourly.filter((h) => h.m2);
      return [
        { type: "scatter", mode: "lines", name: `${sc.name} forecast`, x, y: rows.map((h) => h.m2.navic_error_m), line: { color: SC_COLOR[sc.id], width: 2 } },
        { type: "scatter", mode: "lines", name: `${sc.name} observed`, x, y: rows.map((h) => h.m2.navic_error_from_observed_m), line: { color: SC_COLOR[sc.id], width: 1.5, dash: "dot" } },
      ];
    }),
    layout: base({ xaxis: axis("Hours since shock"), yaxis: axis("Error (m)"), shapes: [hline(30)] }),
  });

  const rows = [];
  const z = [];
  for (const sc of scs) {
    for (const kind of ["disaster", "receiver"]) {
      rows.push(`${sc.name} ${kind === "disaster" ? "rescue zones" : "receivers"}`);
      z.push(sc.hourly.map((h) => (h.alerts ? LEVEL_RANK[h.alerts[kind]] : null)));
    }
  }
  charts.push({
    title: "Alert levels hour by hour",
    sub: "What the rule engine issued for the next hour. Brighter is more severe.",
    wide: true,
    data: [
      {
        type: "heatmap",
        z,
        x: sinceShock(scs[0]),
        y: rows,
        zmin: -0.5,
        zmax: 3.5,
        colorscale: LEVEL_SCALE,
        xgap: 2,
        ygap: 4,
        colorbar: { tickvals: [0, 1, 2, 3], ticktext: LEVEL_NAMES, tickfont: { size: 13 }, outlinewidth: 0 },
        hovertemplate: "%{y}<br>Hour %{x}<extra></extra>",
      },
    ],
    layout: base({ margin: { l: 190, r: 20, t: 12, b: 54 }, xaxis: axis("Hours since shock"), yaxis: axis("", { autorange: "reversed" }) }),
  });

  // forecast alert vs the alert the observed Dst would have produced
  const cm = Array.from({ length: 4 }, () => [0, 0, 0, 0]);
  for (const sc of scs)
    for (const h of sc.hourly)
      if (h.alerts && h.alerts_if_observed)
        for (const kind of ["disaster", "receiver"]) cm[LEVEL_RANK[h.alerts[kind]]][LEVEL_RANK[h.alerts_if_observed[kind]]]++;
  const total = cm.flat().reduce((a, b) => a + b, 0);
  const agree = cm.reduce((a, r, i) => a + r[i], 0);
  charts.push({
    title: "Alert accuracy",
    sub: `Forecast alert vs the alert the real Dst would have given. ${agree} of ${total} site-hours match (${Math.round((agree / total) * 100)}%).`,
    data: [
      {
        type: "heatmap",
        z: cm,
        x: LEVEL_NAMES,
        y: LEVEL_NAMES,
        colorscale: [[0, "#111"], [1, WHITE]],
        showscale: false,
        xgap: 3,
        ygap: 3,
        hovertemplate: "Forecast %{y}, actual %{x}: %{z}<extra></extra>",
      },
    ],
    layout: base({
      xaxis: axis("Alert from observed Dst"),
      yaxis: axis("Alert from forecast"),
      annotations: cm.flatMap((r, i) => r.map((v, j) => ({ x: LEVEL_NAMES[j], y: LEVEL_NAMES[i], text: String(v), showarrow: false, font: { size: 16, color: v > total / 6 ? "#000" : "#fff" } }))),
    }),
  });

  const keys = [
    ["peak_speed", "Peak speed", 1],
    ["min_bz", "Most southward Bz", -1],
    ["peak_pressure", "Peak pressure", 1],
    ["min_dst_obs", "Lowest Dst", -1],
    ["peak_navic_error_m", "Peak NavIC error", 1],
    ["storm_hours", "Storm hours", 1],
  ];
  const max = Object.fromEntries(keys.map(([k, , s]) => [k, Math.max(...scs.map((sc) => s * sc.results[k]))]));
  charts.push({
    title: "Storm signatures",
    sub: "Each axis scaled to the largest of the three storms.",
    data: scs.map((sc) => ({
      type: "scatterpolar",
      name: sc.name,
      r: [...keys.map(([k, , s]) => (s * sc.results[k]) / max[k]), (keys[0][2] * sc.results[keys[0][0]]) / max[keys[0][0]]],
      theta: [...keys.map(([, l]) => l), keys[0][1]],
      line: { color: SC_COLOR[sc.id], width: 2 },
      hovertemplate: "%{theta}: %{r:.2f}<extra>" + sc.name + "</extra>",
    })),
    layout: base({
      polar: { bgcolor: "#000", radialaxis: { range: [0, 1], gridcolor: "#2a2a2a", tickfont: { size: 11 }, showticklabels: false }, angularaxis: { gridcolor: "#2a2a2a", tickfont: { size: 13 } } },
      margin: { l: 70, r: 70, t: 30, b: 30 },
    }),
  });

  charts.push({
    title: "Dst during each storm",
    sub: "Distribution of hourly Dst over the 31 hours of each replay.",
    data: scs.map((sc) => ({
      type: "violin",
      name: sc.name,
      y: sc.hourly.map((h) => h.dst_obs),
      line: { color: SC_COLOR[sc.id] },
      fillcolor: "rgba(0,0,0,0)",
      box: { visible: true },
      meanline: { visible: true },
      points: false,
      spanmode: "hard",
    })),
    layout: base({ showlegend: false, yaxis: axis("Dst (nT)"), xaxis: axis("") }),
  });

  charts.push({
    title: "Storm path in 3D",
    sub: "Each storm's hourly track through Bz, pressure and Dst. Drag to rotate.",
    wide: true,
    tall: true,
    data: scs.map((sc) => ({
      type: "scatter3d",
      mode: "lines+markers",
      name: sc.name,
      x: sc.hourly.map((h) => h.inputs.bz),
      y: sc.hourly.map((h) => h.inputs.dyn_pressure),
      z: sc.hourly.map((h) => h.dst_obs),
      line: { color: SC_COLOR[sc.id], width: 4 },
      marker: { size: 2.5, color: SC_COLOR[sc.id] },
    })),
    layout: base({ margin: { l: 0, r: 0, t: 10, b: 0 }, scene: { bgcolor: "#000", camera: { eye: { x: 1.45, y: 1.45, z: 0.85 } }, xaxis: axis3("Bz (nT)"), yaxis: axis3("Pressure (nPa)"), zaxis: axis3("Dst (nT)") } }),
  });
  return charts;
}

function hline(y) {
  return { type: "line", xref: "paper", x0: 0, x1: 1, y0: y, y1: y, line: { color: "#666", dash: "dash", width: 1 } };
}

function m1Charts() {
  const m = A.m1;
  const sp = m.splits;
  const cats = [];
  const mod = [];
  const per = [];
  for (const [k, label] of [["train", "Train"], ["val", "Validation"], ["test", "Test"]]) {
    cats.push(`${label} all`, `${label} storm`);
    mod.push(sp[k].model_all.mae, sp[k].model_storm.mae);
    per.push(sp[k].persist_all.mae, sp[k].persist_storm.mae);
  }
  const surf = (s, yKey, yTitle) => ({
    type: "surface",
    x: s.bz,
    y: s[yKey],
    z: s.delta_dst,
    colorscale: STORM_SCALE,
    contours: { z: { show: true, usecolormap: true, project: { z: false }, width: 1 } },
    colorbar: { title: { text: "ΔDst", font: { size: 13 } }, tickfont: { size: 12 }, outlinewidth: 0, len: 0.7 },
    hovertemplate: `Bz %{x} nT<br>${yTitle} %{y}<br>ΔDst %{z:.1f} nT<extra></extra>`,
  });
  return [
    {
      title: "Error by data split",
      sub: "Trained on 2000–2016, tuned on 2017–2020, tested on 2021–2024. Storm = Dst below −50 nT.",
      data: [
        { type: "bar", name: "M1", x: cats, y: mod, marker: { color: WHITE } },
        { type: "bar", name: "Persistence", x: cats, y: per, marker: { color: "#555" } },
      ],
      layout: base({ barmode: "group", xaxis: axis(""), yaxis: axis("MAE (nT)") }),
    },
    {
      title: "Predicted vs observed, test set",
      sub: "Every storm hour plus 3,000 random hours from 2021–2024. On the line = perfect.",
      data: [
        { type: "scattergl", mode: "markers", x: m.pred_vs_obs.obs, y: m.pred_vs_obs.pred, marker: { size: 3, color: "rgba(255,255,255,0.45)" }, name: "Hours" },
        { type: "scatter", mode: "lines", x: [-420, 80], y: [-420, 80], line: { color: ORANGE, width: 1.5 }, name: "Perfect" },
      ],
      layout: base({ showlegend: false, xaxis: axis("Observed Dst (nT)"), yaxis: axis("Forecast Dst (nT)") }),
    },
    {
      title: "Forecast errors, test set",
      sub: "Forecast minus observed. Most hours are within a few nT.",
      data: [{ type: "bar", x: m.residual_hist.x, y: m.residual_hist.count, marker: { color: WHITE }, hovertemplate: "%{x} nT: %{y} hours<extra></extra>" }],
      layout: base({ bargap: 0.05, xaxis: axis("Error (nT)"), yaxis: axis("Hours", { type: "log" }) }),
    },
    {
      title: "Error by storm strength, test set",
      sub: "The stronger the storm, the larger the error, and the more M1 beats persistence.",
      data: [
        { type: "bar", name: "M1", x: m.mae_by_dst_bin.label, y: m.mae_by_dst_bin.model, marker: { color: WHITE } },
        { type: "bar", name: "Persistence", x: m.mae_by_dst_bin.label, y: m.mae_by_dst_bin.persistence, marker: { color: "#555" } },
      ],
      layout: base({ barmode: "group", xaxis: axis("Observed Dst (nT)"), yaxis: axis("MAE (nT)") }),
    },
    {
      title: "Feature importance (gain)",
      sub: "How much each input improves the trees' splits.",
      data: [{ type: "bar", orientation: "h", y: m.importance.features, x: m.importance.gain, marker: { color: WHITE } }],
      layout: base({ margin: { l: 130, r: 20, t: 12, b: 54 }, xaxis: axis("Gain"), yaxis: axis("", { autorange: "reversed" }) }),
    },
    {
      title: "Mean SHAP value",
      sub: "Average effect of each input on a forecast, in nT. Computed with XGBoost's built-in TreeSHAP.",
      data: [{ type: "bar", orientation: "h", y: m.shap_mean_abs.features, x: m.shap_mean_abs.value, marker: { color: ORANGE } }],
      layout: base({ margin: { l: 130, r: 20, t: 12, b: 54 }, xaxis: axis("Mean |SHAP| (nT)"), yaxis: axis("", { autorange: "reversed" }) }),
    },
    {
      title: "How Bz drives the forecast",
      sub: "SHAP value of Bz for 2,500 test hours. Southward Bz pushes Dst down.",
      data: [{ type: "scattergl", mode: "markers", x: m.shap_dependence.bz.x, y: m.shap_dependence.bz.shap, marker: { size: 4, color: "rgba(255,138,36,0.55)" } }],
      layout: base({ xaxis: axis("Bz (nT)"), yaxis: axis("SHAP (nT)") }),
    },
    {
      title: "How current Dst drives the forecast",
      sub: "SHAP value of the current Dst. Deep storms tend to recover.",
      data: [{ type: "scattergl", mode: "markers", x: m.shap_dependence.dst_lag1.x, y: m.shap_dependence.dst_lag1.shap, marker: { size: 4, color: "rgba(79,141,255,0.6)" } }],
      layout: base({ xaxis: axis("Current Dst (nT)"), yaxis: axis("SHAP (nT)") }),
    },
    {
      title: "M1 response surface: Bz and speed",
      sub: `Forecast change in Dst over the next hour, with ${m.surface_bz_speed.fixed}.`,
      tall: true,
      data: [surf(m.surface_bz_speed, "speed", "Speed")],
      layout: base({ margin: { l: 0, r: 0, t: 10, b: 0 }, scene: { bgcolor: "#000", camera: { eye: { x: 1.45, y: 1.45, z: 0.85 } }, xaxis: axis3("Bz (nT)"), yaxis: axis3("Speed (km/s)"), zaxis: axis3("ΔDst (nT)") } }),
    },
    {
      title: "M1 response surface: Bz and current Dst",
      sub: `Forecast change in Dst over the next hour, at ${m.surface_bz_dst.fixed}.`,
      tall: true,
      data: [surf(m.surface_bz_dst, "dst", "Current Dst")],
      layout: base({ margin: { l: 0, r: 0, t: 10, b: 0 }, scene: { bgcolor: "#000", camera: { eye: { x: 1.45, y: 1.45, z: 0.85 } }, xaxis: axis3("Bz (nT)"), yaxis: axis3("Current Dst (nT)"), zaxis: axis3("ΔDst (nT)") } }),
    },
    {
      title: "Same surface from above: Bz and speed",
      sub: "Contours of the forecast change in Dst.",
      wide: true,
      data: [
        {
          type: "contour",
          x: m.surface_bz_speed.bz,
          y: m.surface_bz_speed.speed,
          z: m.surface_bz_speed.delta_dst,
          colorscale: STORM_SCALE,
          contours: { coloring: "heatmap", showlabels: true, labelfont: { size: 12, color: "#fff" } },
          line: { width: 0.5, color: "#000" },
          colorbar: { title: { text: "ΔDst", font: { size: 13 } }, outlinewidth: 0 },
        },
      ],
      layout: base({ xaxis: axis("Bz (nT)"), yaxis: axis("Speed (km/s)") }),
    },
  ];
}

function m2Charts() {
  const m = A.m2;
  const errors = S.scenarios.map((sc) => ({ sc, e: sc.hourly.filter((h) => h.m2).map((h) => h.m2.navic_error_m) }));
  return [
    {
      title: "M2: Dst to NavIC error",
      sub: `The plan's 2nd-degree fit through 9 literature points. It gives ${fmt(m.quiet_error_m)} m on a quiet day (Dst 0).`,
      wide: true,
      data: [
        { type: "scatter", mode: "lines", name: "Daytime", x: m.curve.dst, y: m.curve.day, line: { color: WHITE, width: 2 } },
        { type: "scatter", mode: "lines", name: "After sunset (×1.5)", x: m.curve.dst, y: m.curve.night, line: { color: ORANGE, width: 2, dash: "dash" } },
        { type: "scatter", mode: "markers", name: "Fitted points", x: m.points.dst, y: m.points.err, marker: { size: 10, color: BLUE, line: { color: "#000", width: 1 } } },
      ],
      layout: base({ xaxis: axis("Dst (nT)", { autorange: "reversed" }), yaxis: axis("NavIC error (m)"), shapes: [hline(30)] }),
    },
    {
      title: "M2 error surface",
      sub: "NavIC error over Dst and time of day in India.",
      tall: true,
      data: [
        {
          type: "surface",
          x: m.surface.ist_hour,
          y: m.surface.dst,
          z: m.surface.error,
          colorscale: ERROR_SCALE,
          colorbar: { title: { text: "m", font: { size: 13 } }, outlinewidth: 0, len: 0.7 },
          hovertemplate: "IST %{x}:00<br>Dst %{y} nT<br>%{z:.1f} m<extra></extra>",
        },
      ],
      layout: base({ margin: { l: 0, r: 0, t: 10, b: 0 }, scene: { bgcolor: "#000", camera: { eye: { x: 1.45, y: 1.45, z: 0.85 } }, xaxis: axis3("Hour (IST)"), yaxis: axis3("Dst (nT)"), zaxis: axis3("Error (m)") } }),
    },
    {
      title: "M2 error map",
      sub: "The same surface as a heatmap. The step at 18:00 and 06:00 is the post-sunset multiplier.",
      data: [
        {
          type: "heatmap",
          x: m.surface.ist_hour,
          y: m.surface.dst,
          z: m.surface.error,
          colorscale: ERROR_SCALE,
          colorbar: { title: { text: "m", font: { size: 13 } }, outlinewidth: 0 },
          hovertemplate: "IST %{x}:00<br>Dst %{y} nT<br>%{z:.1f} m<extra></extra>",
        },
      ],
      layout: base({ xaxis: axis("Hour (IST)", { dtick: 3 }), yaxis: axis("Dst (nT)") }),
    },
    {
      title: "Forecast NavIC error per storm",
      sub: "Hourly M2 forecasts during each replay. Dashed line: the 30 m red-alert threshold.",
      wide: true,
      data: errors.map(({ sc, e }) => ({ type: "box", name: sc.name, y: e, marker: { color: SC_COLOR[sc.id] }, line: { color: SC_COLOR[sc.id] }, fillcolor: "rgba(0,0,0,0)", boxpoints: "all", jitter: 0.4, pointpos: 0 })),
      layout: base({ showlegend: false, xaxis: axis(""), yaxis: axis("Error (m)"), shapes: [hline(30)] }),
    },
  ];
}

function gnssCharts() {
  const g = A.gnss;
  const top = 20;
  return [
    {
      title: `Top ${top} inputs of the station model`,
      sub: `Share of total split gain across ${g.trees.toLocaleString()} trees.`,
      tall: true,
      data: [{ type: "bar", orientation: "h", y: g.importance.features.slice(0, top), x: g.importance.gain_pct.slice(0, top), marker: { color: WHITE } }],
      layout: base({ margin: { l: 110, r: 20, t: 12, b: 54 }, xaxis: axis("Gain (%)"), yaxis: axis("", { autorange: "reversed" }) }),
    },
    {
      title: "Importance by channel",
      sub: "c3, the channel being forecast, carries most of the signal.",
      data: [
        {
          type: "pie",
          hole: 0.55,
          labels: Object.keys(g.by_channel_pct),
          values: Object.values(g.by_channel_pct),
          marker: { colors: [BLUE, GREY, ORANGE], line: { color: "#000", width: 2 } },
          textfont: { size: 15, color: "#000" },
          sort: false,
        },
      ],
      layout: base({ legend: { orientation: "v", x: 1, y: 0.5, font: { size: 14 } }, margin: { l: 20, r: 20, t: 20, b: 20 } }),
    },
    {
      title: "Importance by feature type",
      sub: "Which engineered features the trees rely on.",
      data: [{ type: "bar", x: Object.keys(g.by_kind_pct), y: Object.values(g.by_kind_pct), marker: { color: ORANGE } }],
      layout: base({ xaxis: axis(""), yaxis: axis("Gain (%)") }),
    },
    {
      title: "Test error vs persistence",
      sub: `${g.test_stations} held-out stations. ${fmt(g.metrics.improvement_pct)}% lower error than assuming no change.`,
      data: [
        {
          type: "bar",
          x: ["LightGBM", "Persistence"],
          y: [g.metrics.lgbm_mae_m, g.metrics.persistence_mae_m],
          marker: { color: [WHITE, "#555"] },
          text: [fmt(g.metrics.lgbm_mae_m, 4), fmt(g.metrics.persistence_mae_m, 4)],
          textposition: "outside",
          textfont: { size: 15, color: WHITE },
        },
      ],
      layout: base({ xaxis: axis(""), yaxis: axis("MAE (m)", { range: [0, g.metrics.persistence_mae_m * 1.25] }) }),
    },
  ];
}

function datasetCharts() {
  const d = A.dataset;
  const marks = S.scenarios.map((sc) => ({ t: sc.timeline.start.slice(0, 10), name: sc.name, id: sc.id }));
  return [
    {
      title: "Daily minimum Dst, 2000–2024",
      sub: `${A.meta.omni_rows.toLocaleString()} hourly NASA OMNI rows. Marked: the three replayed storms.`,
      wide: true,
      data: [{ type: "scattergl", mode: "lines", x: d.daily_min_dst.t, y: d.daily_min_dst.v, line: { color: WHITE, width: 1 }, name: "Daily min" }],
      layout: base({
        showlegend: false,
        xaxis: axis(""),
        yaxis: axis("Dst (nT)"),
        shapes: marks.map((m) => ({ type: "line", x0: m.t, x1: m.t, yref: "paper", y0: 0, y1: 1, line: { color: SC_COLOR[m.id], width: 1.5, dash: "dot" } })),
        annotations: marks.map((m) => ({ x: m.t, yref: "paper", y: 1.02, text: m.name, showarrow: false, font: { size: 13, color: SC_COLOR[m.id] } })),
      }),
    },
    {
      title: "Storm hours per year",
      sub: "Hours with Dst below −50 nT, split by strength. The peaks follow the 11-year solar cycle.",
      data: [
        { type: "bar", name: "−50 to −100", x: d.storm_hours_per_year.year, y: d.storm_hours_per_year.moderate, marker: { color: "#555" } },
        { type: "bar", name: "−100 to −250", x: d.storm_hours_per_year.year, y: d.storm_hours_per_year.intense, marker: { color: ORANGE } },
        { type: "bar", name: "Below −250", x: d.storm_hours_per_year.year, y: d.storm_hours_per_year.extreme, marker: { color: WHITE } },
      ],
      layout: base({ barmode: "stack", xaxis: axis(""), yaxis: axis("Hours") }),
    },
    {
      title: "Dst by year",
      sub: "Box: middle 50% of hours. Whiskers: 1st to 99th percentile.",
      data: [
        {
          type: "box",
          x: d.dst_box_per_year.year,
          q1: d.dst_box_per_year.q1,
          median: d.dst_box_per_year.median,
          q3: d.dst_box_per_year.q3,
          lowerfence: d.dst_box_per_year.low,
          upperfence: d.dst_box_per_year.high,
          marker: { color: WHITE },
          line: { color: WHITE, width: 1 },
          fillcolor: "#222",
        },
      ],
      layout: base({ showlegend: false, xaxis: axis(""), yaxis: axis("Dst (nT)") }),
    },
    {
      title: "How often each Dst level occurs",
      sub: "All hours, log scale. Superstorm hours are thousands of times rarer than quiet ones.",
      data: [{ type: "bar", x: d.dst_hist.x, y: d.dst_hist.count, marker: { color: WHITE }, hovertemplate: "%{x} nT: %{y} hours<extra></extra>" }],
      layout: base({ bargap: 0.05, xaxis: axis("Dst (nT)"), yaxis: axis("Hours", { type: "log" }) }),
    },
    {
      title: "Correlation between inputs",
      sub: "Pearson correlation over all hours. Dst change is the next hour minus this hour.",
      data: [
        {
          type: "heatmap",
          z: d.correlation.matrix,
          x: d.correlation.labels,
          y: d.correlation.labels,
          zmin: -1,
          zmax: 1,
          colorscale: DIVERGING,
          xgap: 2,
          ygap: 2,
          colorbar: { outlinewidth: 0 },
        },
      ],
      layout: base({
        margin: { l: 120, r: 20, t: 12, b: 100 },
        yaxis: axis("", { autorange: "reversed" }),
        xaxis: axis(""),
        annotations: d.correlation.matrix.flatMap((r, i) => r.map((v, j) => ({ x: d.correlation.labels[j], y: d.correlation.labels[i], text: fmt(v, 2), showarrow: false, font: { size: 13, color: WHITE } }))),
      }),
    },
    {
      title: "Strongest storm each month",
      sub: "Lowest Dst in each month. Bright = big storm.",
      data: [
        {
          type: "heatmap",
          z: d.monthly_min_heatmap.z,
          x: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
          y: d.monthly_min_heatmap.years,
          colorscale: STORM_SCALE,
          xgap: 1,
          ygap: 1,
          colorbar: { title: { text: "nT", font: { size: 13 } }, outlinewidth: 0 },
          hovertemplate: "%{x} %{y}: %{z} nT<extra></extra>",
        },
      ],
      layout: base({ yaxis: axis("", { autorange: "reversed", dtick: 2 }), xaxis: axis("") }),
    },
    {
      title: "Storm hours in 3D",
      sub: "2,500 hours with Dst below −30 nT. Colour = dynamic pressure.",
      tall: true,
      data: [
        {
          type: "scatter3d",
          mode: "markers",
          x: d.scatter3d.bz,
          y: d.scatter3d.speed,
          z: d.scatter3d.dst,
          marker: { size: 2.2, color: d.scatter3d.pressure, colorscale: ERROR_SCALE, cmin: 0, cmax: 20, colorbar: { title: { text: "nPa", font: { size: 13 } }, outlinewidth: 0, len: 0.7 } },
        },
      ],
      layout: base({ margin: { l: 0, r: 0, t: 10, b: 0 }, scene: { bgcolor: "#000", camera: { eye: { x: 1.45, y: 1.45, z: 0.85 } }, xaxis: axis3("Bz (nT)"), yaxis: axis3("Speed (km/s)"), zaxis: axis3("Dst (nT)") } }),
    },
    {
      title: "Bz vs next-hour Dst change",
      sub: "Density of 6,000 random hours. Southward Bz goes with falling Dst.",
      tall: true,
      data: [
        {
          type: "histogram2dcontour",
          x: d.bz_vs_change.bz,
          y: d.bz_vs_change.change,
          colorscale: [[0, "#000"], [0.3, "#4a2200"], [0.7, ORANGE], [1, "#fff1dc"]],
          ncontours: 18,
          contours: { coloring: "fill", showlines: false },
          showscale: false,
        },
      ],
      layout: base({ xaxis: axis("Bz (nT)", { range: [-12, 10] }), yaxis: axis("Dst change (nT)", { range: [-15, 10] }) }),
    },
  ];
}

const TABS = [
  { id: "scenarios", label: "Storm scenarios", charts: scenarioCharts, table: true },
  { id: "m1", label: "Storm model (M1)", charts: m1Charts },
  { id: "m2", label: "Error model (M2)", charts: m2Charts },
  { id: "gnss", label: "Station model", charts: gnssCharts },
  { id: "dataset", label: "Dataset", charts: datasetCharts },
];

function resultsTable() {
  const scs = S.scenarios;
  const rows = [
    ["Shock arrives (UTC)", (s) => s.hourly[s.timeline.impact_h].t.replace("T", " ").slice(0, 16)],
    ["Lowest Dst, observed", (s) => `${fmt(s.results.min_dst_obs, 0)} nT`],
    ["Lowest Dst, M1 forecast", (s) => `${fmt(s.results.min_dst_pred, 0)} nT`],
    ["Peak speed", (s) => `${fmt(s.results.peak_speed, 0)} km/s`],
    ["Most southward Bz", (s) => `${fmt(s.results.min_bz)} nT`],
    ["Closest magnetopause", (s) => `${fmt(s.results.min_magnetopause_re, 1)} Rₑ`],
    ["M1 error (MAE)", (s) => `${fmt(s.results.m1.mae)} nT`],
    ["Persistence error (MAE)", (s) => `${fmt(s.results.persistence.mae)} nT`],
    ["Storm warning lead", (s) => (s.results.storm_warning_lead_h == null ? "–" : `${fmt(s.results.storm_warning_lead_h, 0)} h`)],
    ["Red alert lead", (s) => (s.results.red_lead_vs_storm_h == null ? "–" : `${fmt(s.results.red_lead_vs_storm_h, 0)} h`)],
    ["Peak NavIC error (M2)", (s) => `${fmt(s.results.peak_navic_error_m)} m`],
  ];
  return `<table class="results"><thead><tr><th></th>${scs.map((s) => `<th style="color:${SC_COLOR[s.id]}">${s.title}</th>`).join("")}</tr></thead>
    <tbody>${rows.map(([k, f]) => `<tr><td>${k}</td>${scs.map((s) => `<td>${f(s)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}

export class Analysis {
  constructor(root) {
    this.root = root;
    root.innerHTML = `
      <nav class="tabs" role="tablist">${TABS.map((t, i) => `<button role="tab" class="tab" data-tab="${t.id}" aria-selected="${i === 0}">${t.label}</button>`).join("")}</nav>
      <div class="tab-body" id="tab-body"></div>`;
    this.body = root.querySelector("#tab-body");
    root.querySelectorAll(".tab").forEach((b) => b.addEventListener("click", () => this.open(b.dataset.tab)));
    this.tab = TABS[0].id;
    this.rendered = null;
  }

  show() {
    if (this.rendered !== this.tab) this.open(this.tab);
  }

  open(id) {
    this.tab = id;
    this.root.querySelectorAll(".tab").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === id));
    this.body.querySelectorAll(".plot").forEach((el) => Plotly.purge(el));
    const tab = TABS.find((t) => t.id === id);
    const charts = tab.charts();
    this.body.innerHTML =
      (tab.table ? `<section class="card wide"><h4>Computed results</h4>${resultsTable()}</section>` : "") +
      charts
        .map(
          (c, i) =>
            `<section class="card${c.wide ? " wide" : ""}"><h4>${c.title}</h4><p>${c.sub}</p><div class="plot${c.tall ? " tall" : ""}" id="plot-${i}"></div></section>`
        )
        .join("");
    this.body.scrollTop = 0;
    charts.forEach((c, i) => Plotly.newPlot(this.body.querySelector(`#plot-${i}`), c.data, c.layout, CONFIG));
    this.rendered = id;
  }
}
