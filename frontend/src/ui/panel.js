// Side panel: Dst chart that stays across chapters, plus a few key numbers per chapter.
// All values are precomputed (scripts/export_dashboard.py); nothing is modelled here.
import { current, H_END, timeAt, forecastAt } from "../engine/story.js";
import { dstChart } from "./charts.js";

const hhmm = (d) => d.toISOString().slice(11, 16);
const fmtH = (h) => hhmm(timeAt(h));
const nt = (v) => `${v > 0 ? "+" : ""}${Math.round(v)}`.replace("-", "−");
const num = (v, d) => v.toFixed(d).replace("-", "−");
const level = (a) => `<span class="level" data-status="${a.status}">${a.label}</span>`;
const row = (k, id, big = false) => `<div class="row"><span class="k" ${big ? `id="${id}-k"` : ""}>${k}</span><span class="v${big ? " big" : ""}" id="${id}">–</span></div>`;

export class Panel {
  constructor(root) {
    this.root = root;
    root.innerHTML = `
      <section class="block" id="dst-block">
        <div class="block-head"><h3>Dst index (nT)</h3>
          <div class="key"><span><i></i>Observed</span><span id="key-fc"><i class="dash"></i>Forecast</span></div>
        </div>
        <div class="chart-wrap"><canvas id="dst-chart" role="img" aria-label="Dst index, observed and forecast"></canvas></div>
      </section>
      <div id="chapter-block"></div>`;
    this.chapterEl = root.querySelector("#chapter-block");
    this.canvas = root.querySelector("#dst-chart");
    this.reset();
  }

  // Call after the scenario changes.
  reset() {
    this.dst?.destroy();
    this.dst = dstChart(this.canvas, { xMax: H_END(), fmtX: (v) => fmtH(v) });
    this.mode = null;
    this.last = 0;
  }

  build(mode) {
    this.mode = mode;
    this.root.dataset.ch = mode;
    this.chapterEl.innerHTML = mode === 1 ? this.ch1() : mode === 2 ? this.ch2() : this.ch3();
    this.root.scrollTop = 0;
  }

  ch1() {
    return `
      <section class="block">
        <h3>Solar wind</h3>
        <div class="rows">
          ${row("CME arrival", "v-cme")}
          ${row("Speed", "v-speed")}
          ${row("Bz", "v-bz")}
          ${row("Density", "v-n")}
          ${row("Pressure", "v-p")}
        </div>
      </section>
      <section class="block">
        <h3>Earth</h3>
        <div class="rows">
          ${row("Dst", "v-dst")}
          ${row("Magnetopause", "v-mp")}
        </div>
      </section>`;
  }

  ch2() {
    const r = current().results;
    const lead = r.storm_warning_lead_h;
    return `
      <section class="block">
        <h3>Storm forecast, 1 hour ahead</h3>
        <div class="rows">
          ${row("Forecast", "fc-v", true)}
          ${row("Observed now", "fc-obs")}
          <div class="row"><span class="k">Storm warning lead</span><span class="v">${lead == null ? "–" : `${lead} h`}</span></div>
        </div>
      </section>
      <section class="block">
        <h3>Alerts issued</h3>
        <div class="rows" id="alert-counts"></div>
      </section>
      <section class="block">
        <h3>Error on this storm</h3>
        <div class="rows">
          <div class="row"><span class="k">M1</span><span class="v">${num(r.m1.mae, 1)} nT</span></div>
          <div class="row"><span class="k">Persistence</span><span class="v">${num(r.persistence.mae, 1)} nT</span></div>
        </div>
      </section>`;
  }

  ch3() {
    return `
      <section class="block">
        <h3>NavIC error over India</h3>
        <div class="rows">
          ${row("Forecast", "m2-v", true)}
          ${row("From observed Dst", "m2-obs")}
        </div>
      </section>
      <section class="block">
        <h3>Alerts</h3>
        <div id="decisions"></div>
      </section>`;
  }

  set(id, html) {
    const el = this.chapterEl.querySelector(`#${id}`);
    if (el && el.innerHTML !== html) el.innerHTML = html;
  }

  update(st, force = false) {
    const now = performance.now();
    if (!force && now - this.last < 90) return;
    this.last = now;
    if (st.chapter !== this.mode) this.build(st.chapter);
    this.updateDst(st);
    if (st.chapter === 1) this.updateCh1(st);
    if (st.chapter === 2) this.updateCh2(st);
    if (st.chapter === 3) this.updateCh3(st);
  }

  updateDst(st) {
    const S = current();
    const obs = [];
    for (let i = 0; i <= Math.floor(st.h); i++) obs.push({ x: i, y: S.hourly[i].dst_obs });
    obs.push({ x: st.h, y: st.obs.dst });
    const fc = [];
    if (st.chapter > 1)
      for (let i = 0; i <= Math.min(Math.floor(st.h), H_END() - 1); i++) {
        const r = S.hourly[i];
        if (r.m1) fc.push({ x: i + 1, y: r.m1.dst_pred });
      }
    this.dst.data.datasets[0].data = obs;
    this.dst.data.datasets[1].data = fc;
    this.dst.options.plugins.overlay.playX = st.h;
    this.dst.update("none");
    this.root.querySelector("#key-fc").style.visibility = st.chapter > 1 ? "visible" : "hidden";
  }

  updateCh1(st) {
    const o = st.obs;
    const dh = st.impactH - st.h;
    const hm = (x) => `${Math.floor(x)}h ${String(Math.floor((x % 1) * 60)).padStart(2, "0")}m`;
    this.set("v-cme", dh > 0 ? `in ${hm(dh)}` : "arrived");
    this.set("v-speed", `${Math.round(o.sw_speed)} km/s`);
    this.set("v-bz", `${num(o.bz, 1)} nT`);
    this.set("v-n", `${num(o.proton_density, 1)} /cm³`);
    this.set("v-p", `${num(o.dyn_pressure, 1)} nPa`);
    this.set("v-dst", `${nt(o.dst)} nT`);
    this.set("v-mp", `${num(st.mp.r0, 1)} Rₑ`);
  }

  updateCh2(st) {
    const f = forecastAt(st.h);
    this.set("fc-v-k", `For ${fmtH(f.forH)} UTC`);
    this.set("fc-v", `${nt(f.m1.dst_pred)} nT`);
    this.set("fc-obs", `${nt(st.obs.dst)} nT`);
    const counts = new Map();
    for (const a of st.alerts ?? []) counts.set(a.alert, (counts.get(a.alert) || 0) + 1);
    this.set(
      "alert-counts",
      [...counts.entries()]
        .map(([l, n]) => `<div class="row"><span class="k">${level(l)}</span><span class="v">${n} site${n > 1 ? "s" : ""}</span></div>`)
        .join("")
    );
  }

  updateCh3(st) {
    const f = forecastAt(st.h);
    this.set("m2-v-k", `For ${fmtH(f.forH)} UTC`);
    this.set("m2-v", `${num(f.m2.navic_error_m, 1)} m`);
    this.set("m2-obs", f.m2.navic_error_from_observed_m == null ? "–" : `${num(f.m2.navic_error_from_observed_m, 1)} m`);

    const groups = [];
    for (const a of st.alerts ?? []) {
      const key = `${a.site.kind}|${a.alert.id}`;
      let g = groups.find((x) => x.key === key);
      if (!g) groups.push((g = { key, a, n: 0 }));
      g.n++;
    }
    groups.sort((x, y) => (x.a.site.kind === "disaster" ? -1 : 1) - (y.a.site.kind === "disaster" ? -1 : 1));
    this.set(
      "decisions",
      groups
        .map((g) => {
          const what = g.a.site.kind === "disaster" ? "rescue zone" : "receiver";
          const who = g.n > 1 ? `${g.n} ${what}s` : g.a.site.name;
          return `<div class="decision"><div class="top-line">${level(g.a.alert)}<span>${who}</span></div><div class="act">${g.a.alert.action}</div></div>`;
        })
        .join("")
    );
  }
}
