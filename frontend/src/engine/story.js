// Scenario access + the master timeline.
//
// Everything here is replayed from src/data/scenarios.json, written once by
// scripts/export_dashboard.py. No model runs in the browser.
//
// Time is measured in story hours h: h = 0 is the first hourly row of the scenario
// (6 hours before the shock reaches Earth).
import data from "../data/scenarios.json";

export const SITES = data.sites;
export const SCENARIOS = data.scenarios;
const LEVELS = Object.fromEntries(data.rules.map((l) => [l.id, l]));
const [A, B, C] = data.m2_coeffs;

let S = SCENARIOS[0];
let T0 = Date.parse(S.timeline.start);

export const current = () => S;
export const H_END = () => S.hourly.length - 1;
export const IMPACT_H = () => S.timeline.impact_h;

export function setScenario(id) {
  S = SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
  T0 = Date.parse(S.timeline.start);
}

export const CHAPTERS = [
  { n: 1, title: "The storm reaches Earth" },
  { n: 2, title: "Warning one hour ahead" },
  { n: 3, title: "From error forecast to alert" },
];

// Chapter segments come from the scenario's computed results.
export function segments() {
  const r = S.results;
  const end = H_END();
  const imp = IMPACT_H();
  const ch2From = Math.max(0, (r.first_forecast_storm_issued_h ?? imp) - 1);
  const ch2To = Math.min(end - 4, Math.max(r.min_dst_obs_h, ch2From + 5));
  return [
    { chapter: 1, from: 0, to: imp + 3, secs: 24 },
    { chapter: 2, from: ch2From, to: ch2To, secs: 30 },
    { chapter: 3, from: ch2To, to: end, secs: 30 },
  ];
}

export const timeAt = (h) => new Date(T0 + h * 36e5);
const lerp = (a, b, t) => a + (b - a) * t;

// Observed values interpolated between hourly rows (for smooth animation only).
export function observedAt(h) {
  const end = H_END();
  const hc = Math.min(Math.max(h, 0), end);
  const i = Math.min(Math.floor(hc), end - 1);
  const t = hc - i;
  const a = S.hourly[i];
  const b = S.hourly[i + 1];
  const out = {};
  for (const k of Object.keys(a.inputs)) out[k] = lerp(a.inputs[k] ?? b.inputs[k] ?? 0, b.inputs[k] ?? a.inputs[k] ?? 0, t);
  out.dst = lerp(a.dst_obs, b.dst_obs, t);
  return out;
}

// Latest forecast the system has issued at time h (issued on the hour, for the next hour).
export function forecastAt(h) {
  let i = Math.min(Math.max(Math.floor(h), 0), H_END() - 1);
  while (i > 0 && !S.hourly[i].m1) i--;
  const row = S.hourly[i];
  return { issuedH: i, forH: i + 1, m1: row.m1, m2: row.m2, alerts: row.alerts };
}

export function alertsAt(h) {
  const f = forecastAt(h);
  if (!f.alerts) return null;
  return SITES.map((site) => {
    const id = site.kind === "disaster" ? f.alerts.disaster : f.alerts.receiver;
    return { site, error: f.m2.navic_error_m, alert: LEVELS[id] };
  });
}

export const levelInfo = (id) => LEVELS[id];

// Plan M2 applied to observed Dst: used only to drive how degraded the signal paths look.
export function m2Error(dst, date) {
  const base = Math.max(A * dst * dst + B * dst + C, 2);
  const ist = (date.getUTCHours() + date.getUTCMinutes() / 60 + 5.5) % 24;
  return base * (ist >= 18 || ist < 6 ? 1.5 : 1);
}

// Shue et al. (1998) magnetopause model, from dynamic pressure (nPa) and Bz (nT). Units: Earth radii.
export function magnetopause(p, bz) {
  const P = Math.max(p, 0.1);
  const r0 = (10.22 + 1.29 * Math.tanh(0.184 * (bz + 8.14))) * Math.pow(P, -1 / 6.6);
  const alpha = (0.58 - 0.007 * bz) * (1 + 0.024 * Math.log(P));
  return { r0, alpha };
}

// ---------- playback ----------
export class Playback {
  constructor() {
    this.seg = 0;
    this.h = 0;
    this.playing = false;
    this.speed = 1;
    this.listeners = new Set();
  }
  get segs() {
    return segments();
  }
  get chapter() {
    return this.segs[this.seg].chapter;
  }
  on(fn) {
    this.listeners.add(fn);
  }
  emit(type) {
    for (const fn of this.listeners) fn(type, this);
  }
  setSpeed(s) {
    this.speed = s;
  }
  pause() {
    if (this.playing) {
      this.playing = false;
      this.emit("play");
    }
  }
  toggle() {
    const segs = this.segs;
    if (!this.playing && this.seg === segs.length - 1 && this.h >= segs[this.seg].to) this.goChapter(1);
    this.playing = !this.playing;
    this.emit("play");
  }
  goChapter(n) {
    this.seg = this.segs.findIndex((s) => s.chapter === n);
    this.h = this.segs[this.seg].from;
    this.emit("chapter");
  }
  scrub(h) {
    const segs = this.segs;
    h = Math.min(Math.max(h, 0), H_END());
    const cur = this.chapter;
    let idx = segs.findIndex((s) => s.chapter === cur && h >= s.from && h <= s.to);
    if (idx < 0) idx = segs.findIndex((s) => h >= s.from && h <= s.to);
    if (idx < 0) idx = Math.max(0, segs.map((s) => s.from <= h).lastIndexOf(true));
    const changed = segs[idx].chapter !== cur;
    this.seg = idx;
    this.h = h;
    this.emit(changed ? "chapter" : "scrub");
  }
  tick(dt) {
    if (!this.playing) return;
    const segs = this.segs;
    const s = segs[this.seg];
    this.h += ((s.to - s.from) / s.secs) * dt * this.speed;
    if (this.h >= s.to) {
      if (this.seg < segs.length - 1) {
        this.seg += 1;
        this.h = segs[this.seg].from;
        this.emit("chapter");
      } else {
        this.h = s.to;
        this.playing = false;
        this.emit("play");
      }
    }
  }
}
