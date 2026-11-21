import "@fontsource-variable/archivo/wdth.css";
import "./styles.css";
import { StormScene } from "./scene/scene.js";
import { Panel } from "./ui/panel.js";
import { Timeline } from "./ui/timeline.js";
import {
  SCENARIOS,
  SITES,
  Playback,
  CHAPTERS,
  IMPACT_H,
  current,
  setScenario,
  timeAt,
  observedAt,
  magnetopause,
  m2Error,
  alertsAt,
} from "./engine/story.js";

const $ = (s) => document.querySelector(s);
const hhmm = (d) => d.toISOString().slice(11, 16);

const scene = new StormScene($("#scene"), $("#labels"));
scene.setSites(SITES);
const pb = new Playback();
const panel = new Panel($("#panel"));
const timeline = new Timeline($("#timeline"), pb);

window.addEventListener("resize", () => scene.resize());
window.addEventListener("keydown", (e) => {
  if (e.code === "Space" && e.target === document.body && $("#analysis").hidden) {
    e.preventDefault();
    pb.toggle();
  }
});

// ---------- scenario switcher ----------
$("#scenarios").innerHTML = SCENARIOS.map((s, i) => `<button class="btn" data-sc="${s.id}" aria-pressed="${i === 0}">${s.name}</button>`).join("");
function chooseScenario(id) {
  setScenario(id);
  document.querySelectorAll("[data-sc]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.sc === id));
  pb.playing = false;
  pb.seg = 0;
  pb.h = 0;
  panel.reset();
  timeline.reset();
  scene.resetView();
  setCaption(1);
  snapFrames = 8;
  if (analysis) analysis.setScenario?.(id);
}
document.querySelectorAll("[data-sc]").forEach((b) => b.addEventListener("click", () => chooseScenario(b.dataset.sc)));

// ---------- data analysis page (loaded on first open) ----------
let analysis = null;
$("#analysis-btn").addEventListener("click", async () => {
  const el = $("#analysis");
  const opening = el.hidden;
  if (opening) {
    pb.pause();
    if (!analysis) {
      const mod = await import("./ui/analysis.js");
      analysis = new mod.Analysis(el);
    }
    el.hidden = false;
    document.body.classList.add("show-analysis");
    analysis.show();
  } else {
    el.hidden = true;
    document.body.classList.remove("show-analysis");
  }
  $("#analysis-btn").textContent = opening ? "Back to simulation" : "Data analysis";
  $("#analysis-btn").setAttribute("aria-pressed", opening);
});

// ---------- caption and transition flash ----------
function setCaption(n) {
  const c = CHAPTERS[n - 1];
  $("#caption").innerHTML = `<div class="num">${current().title}</div><h2>${c.n}. ${c.title}</h2>`;
}

function flash(title) {
  const el = $("#flash");
  el.hidden = false;
  el.innerHTML = `<span>${title}</span>`;
  el.style.animation = "none";
  void el.offsetWidth;
  el.style.animation = "";
  clearTimeout(flash.t);
  flash.t = setTimeout(() => (el.hidden = true), 2300);
}

let prevH = 0;
pb.on((type, p) => {
  if (type === "chapter") {
    scene.resetView();
    setCaption(p.chapter);
    if (p.playing && p.chapter > 1) {
      const to = hhmm(timeAt(p.h));
      flash(p.h < prevH ? `Rewind to ${to} UTC` : `${to} UTC`);
    }
    panel.update(state(), true);
  }
});
setCaption(1);

// ---------- state for one frame ----------
let snapFrames = 0;
function state(dt = 0) {
  const h = pb.h;
  const date = timeAt(h);
  const obs = observedAt(h);
  const mp = magnetopause(obs.dyn_pressure, obs.bz);
  return {
    h,
    dt,
    date,
    chapter: pb.chapter,
    zoom: false,
    obs,
    mp,
    storm: Math.min(1, Math.max(0, (-obs.dst - 15) / 330)),
    impactH: IMPACT_H(),
    truthError: m2Error(obs.dst, date),
    alerts: pb.chapter > 1 ? alertsAt(h) : null,
    focusSite: null,
    snap: snapFrames > 0,
  };
}

let last = performance.now();
let lastClock = "";
function frame(now) {
  const dt = (now - last) / 1000;
  last = now;
  if ($("#analysis").hidden) {
    prevH = pb.h;
    pb.tick(dt);
    const st = state(dt);
    if (snapFrames > 0) snapFrames--;
    scene.update(st);
    panel.update(st);
    timeline.update(st);
    const clock = `${st.date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}, ${hhmm(st.date)} UTC`;
    if (clock !== lastClock) {
      lastClock = clock;
      $("#clock").textContent = clock;
    }
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// For rehearsing a moment: ?sc=apr2023&ch=2&h=7.5  (add &analysis to open the analysis page)
const q = new URLSearchParams(location.search);
if (q.has("sc")) chooseScenario(q.get("sc"));
if (q.has("ch")) pb.goChapter(Number(q.get("ch")));
if (q.has("h")) pb.scrub(Number(q.get("h")));
if (q.has("ch") || q.has("h")) snapFrames = 8;
if (q.has("analysis")) $("#analysis-btn").click();
window.__pb = pb;
