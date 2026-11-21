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

// Chapter segments: three back-to-back ranges of one continuous timeline, so the playhead
// only ever moves forward during playback.
//   1. start -> shock has passed Earth (impact + 2 h)
//   2. -> Dst minimum (main phase), at least 4 h long
//   3. -> end of the replay
export function segments() {
  const r = S.results;
  const end = H_END();
  const b1 = Math.min(IMPACT_H() + 2, end - 8);
  const b2 = Math.min(end - 4, Math.max(r.min_dst_obs_h, b1 + 4));
  return [
    { chapter: 1, from: 0, to: b1 },
    { chapter: 2, from: b1, to: b2 },
    { chapter: 3, from: b2, to: end },
  ];
}

// Story hours per real second at 1x: the whole replay takes about 85 s.
export const RATE_1X = () => H_END() / 85;

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
// One clock (h) drives everything: the scene, the panel and the timeline bar.
export class Playback {
  constructor() {
    this.h = 0;
    this.playing = false;
    this.speed = 1;
    this.listeners = new Set();
    this._chapter = 1;
  }
  get segs() {
    return segments();
  }
  get seg() {
    return this.segs.findIndex((s) => s.chapter === this._chapter);
  }
  set seg(i) {
    this._chapter = this.segs[i]?.chapter ?? 1;
  }
  get chapter() {
    return this._chapter;
  }
  chapterAt(h) {
    const segs = this.segs;
    for (let i = segs.length - 1; i >= 0; i--) if (h >= segs[i].from) return segs[i].chapter;
    return 1;
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
    if (!this.playing && this.h >= H_END()) this.scrub(0);
    this.playing = !this.playing;
    this.emit("play");
  }
  goChapter(n) {
    const s = this.segs.find((x) => x.chapter === n) ?? this.segs[0];
    this.scrub(s.from);
  }
  scrub(h) {
    this.h = Math.min(Math.max(h, 0), H_END());
    this.sync("scrub");
  }
  sync(fallback) {
    const ch = this.chapterAt(this.h);
    const changed = ch !== this._chapter;
    this._chapter = ch;
    if (changed) this.emit("chapter");
    else if (fallback) this.emit(fallback);
  }
  tick(dt) {
    if (!this.playing) return;
    this.h += RATE_1X() * dt * this.speed;
    if (this.h >= H_END()) {
      this.h = H_END();
      this.playing = false;
      this.sync();
      this.emit("play");
      return;
    }
    this.sync();
  }
}
