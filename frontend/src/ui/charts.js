import { Chart, LineController, LineElement, PointElement, LinearScale, Tooltip } from "chart.js";

Chart.register(LineController, LineElement, PointElement, LinearScale, Tooltip);

const INK = "#ffffff";
const DIM = "#777777";
const GRID = "#1c1c1c";

Chart.defaults.font.family = '"Archivo Variable", system-ui, sans-serif';
Chart.defaults.font.size = 14;
Chart.defaults.color = "#a6a6a6";
Chart.defaults.animation = false;

// Reference line + playhead; everything right of the playhead is dimmed.
const overlay = {
  id: "overlay",
  afterDatasetsDraw(chart, _args, opts) {
    const { ctx, chartArea: a, scales } = chart;
    ctx.save();
    if (opts.refY != null) {
      const y = scales.y.getPixelForValue(opts.refY);
      ctx.strokeStyle = "#555";
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(a.left, y);
      ctx.lineTo(a.right, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (opts.playX != null) {
      const x = scales.x.getPixelForValue(opts.playX);
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(x, a.top, a.right - x, a.bottom - a.top);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, a.top);
      ctx.lineTo(x, a.bottom);
      ctx.stroke();
    }
    ctx.restore();
  },
};
Chart.register(overlay);

const tooltip = {
  backgroundColor: "#000",
  borderColor: "#444",
  borderWidth: 1,
  titleColor: INK,
  bodyColor: INK,
  padding: 10,
  displayColors: false,
  mode: "nearest",
  axis: "x",
  intersect: false,
};

function line(label, color, dash, width = 2) {
  return {
    label,
    data: [],
    borderColor: color,
    backgroundColor: color,
    borderWidth: width,
    borderDash: dash ? [6, 4] : [],
    pointRadius: (c) => (c.dataIndex === c.dataset.data.length - 1 ? 4 : 0),
    pointHoverRadius: 5,
    pointBorderWidth: 0,
    tension: 0.25,
  };
}

const axis = (extra) => ({ grid: { color: GRID, drawTicks: false }, border: { display: false }, ticks: { padding: 8 }, ...extra });

export function dstChart(canvas, { xMax, fmtX }) {
  return new Chart(canvas, {
    type: "line",
    data: { datasets: [line("Observed", INK), line("Forecast", INK, true)] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      interaction: { mode: "nearest", axis: "x", intersect: false },
      scales: {
        x: axis({ type: "linear", min: 0, max: xMax, ticks: { padding: 8, stepSize: 12, callback: fmtX } }),
        y: axis({ min: -450, max: 100, ticks: { padding: 8, stepSize: 200, callback: (v) => `${v}`.replace("-", "−") } }),
      },
      plugins: {
        legend: { display: false },
        overlay: { refY: -50 },
        tooltip: {
          ...tooltip,
          callbacks: {
            title: (i) => (i[0] ? `${fmtX(i[0].parsed.x)} UTC` : ""),
            label: (i) => `${i.dataset.label}: ${Math.round(i.parsed.y)} nT`,
          },
        },
      },
    },
  });
}

export function gnssChart(canvas, { xMax, fmtX, yMin, yMax }) {
  return new Chart(canvas, {
    type: "line",
    data: { datasets: [line("Observed", INK), line("Model", INK, true), line("Persistence", DIM, true, 1.5)] },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      parsing: false,
      interaction: { mode: "nearest", axis: "x", intersect: false },
      scales: {
        x: axis({ type: "linear", min: 0, max: xMax, ticks: { padding: 8, stepSize: 20, callback: fmtX } }),
        y: axis({ min: yMin, max: yMax, ticks: { padding: 8, maxTicksLimit: 3, callback: (v) => v.toFixed(1).replace("-", "−") } }),
      },
      plugins: {
        legend: { display: false },
        overlay: { refY: null },
        tooltip: {
          ...tooltip,
          callbacks: {
            title: (i) => (i[0] ? `${fmtX(i[0].parsed.x)} UTC` : ""),
            label: (i) => `${i.dataset.label}: ${i.parsed.y.toFixed(3)} m`,
          },
        },
      },
    },
  });
}
