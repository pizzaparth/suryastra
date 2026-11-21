// Master timeline: play/pause, speed, scrubbing, chapter bands.
// Bands and markers sit at their real positions on the same hour axis as the playhead.
import { CHAPTERS, H_END, IMPACT_H, current } from "../engine/story.js";

const NS = "http://www.w3.org/2000/svg";

export class Timeline {
  constructor(root, playback) {
    this.pb = playback;
    this.root = root;
    root.innerHTML = `
      <div class="controls">
        <button class="btn primary" id="play">Play</button>
        ${[1, 5, 20].map((s) => `<button class="btn" data-speed="${s}" aria-pressed="${s === 1}">${s}×</button>`).join("")}
      </div>
      <div class="track-area">
        <div class="bands" id="bands"></div>
        <div class="track" id="track" role="slider" tabindex="0" aria-label="Storm timeline" aria-valuemin="0">
          <div class="range" id="range"></div>
          <svg class="spark dim" id="spark-dim" viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden="true"></svg>
          <svg class="spark lit" id="spark-lit" viewBox="0 0 100 20" preserveAspectRatio="none" aria-hidden="true"></svg>
          <div class="rail"></div>
          <div class="done" id="done"></div>
          <div class="marks" id="marks"></div>
          <div class="head" id="head"></div>
        </div>
      </div>`;
    this.playBtn = root.querySelector("#play");
    this.head = root.querySelector("#head");
    this.done = root.querySelector("#done");
    this.track = root.querySelector("#track");
    this.range = root.querySelector("#range");
    this.lit = root.querySelector("#spark-lit");

    this.playBtn.addEventListener("click", () => playback.toggle());
    root.querySelectorAll("[data-speed]").forEach((b) =>
      b.addEventListener("click", () => {
        playback.setSpeed(Number(b.dataset.speed));
        root.querySelectorAll("[data-speed]").forEach((x) => x.setAttribute("aria-pressed", x === b));
      })
    );
    const scrubTo = (e) => {
      const r = this.track.getBoundingClientRect();
      playback.scrub(((e.clientX - r.left) / r.width) * H_END());
    };
    let dragging = false;
    this.track.addEventListener("pointerdown", (e) => {
      dragging = true;
      this.track.setPointerCapture(e.pointerId);
      scrubTo(e);
    });
    this.track.addEventListener("pointermove", (e) => dragging && scrubTo(e));
    this.track.addEventListener("pointerup", () => (dragging = false));
    this.track.addEventListener("keydown", (e) => {
      if (e.key === "ArrowRight") playback.scrub(playback.h + 0.25);
      if (e.key === "ArrowLeft") playback.scrub(playback.h - 0.25);
    });
    this.reset();
  }

  // Bands, sparkline and markers depend on the scenario.
  reset() {
    const segs = this.pb.segs;
    const end = H_END();
    const pct = (h) => `${(h / end) * 100}%`;
    this.pct = pct;
    this.segs = segs;
    this.chapter = null;

    const bands = this.root.querySelector("#bands");
    bands.innerHTML = segs
      .map((s) => {
        const c = CHAPTERS[s.chapter - 1];
        return `<button class="band" data-ch="${c.n}" style="left:${pct(s.from)};width:${pct(s.to - s.from)}" title="${c.n}. ${c.title}">${c.n}. ${c.title}</button>`;
      })
      .join("");
    bands.querySelectorAll(".band").forEach((b) => b.addEventListener("click", () => this.pb.goChapter(Number(b.dataset.ch))));

    // Observed Dst as a filled sparkline: deeper storm = taller.
    const S = current();
    const lo = Math.min(-60, ...S.hourly.map((r) => r.dst_obs));
    const pts = S.hourly.map((r, i) => {
      const x = (i / end) * 100;
      const y = 20 - Math.max(0, Math.min(1, r.dst_obs / lo)) * 19;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    });
    const d = `M0,20 L${pts.join(" L")} L100,20 Z`;
    for (const svg of this.root.querySelectorAll(".spark")) {
      const lit = svg.classList.contains("lit");
      svg.innerHTML = `
        <defs><linearGradient id="g-${lit ? "lit" : "dim"}" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#555555"/>
        </linearGradient></defs>
        <path d="${d}" fill="url(#g-${lit ? "lit" : "dim"})"/>`;
    }

    const r = S.results;
    const marks = [
      { h: IMPACT_H(), cls: "impact", label: "Shock hits Earth" },
      { h: r.first_red_issued_h, cls: "red", label: "First red alert" },
      { h: r.min_dst_obs_h, cls: "peak", label: "Lowest Dst" },
    ].filter((m) => m.h != null);
    this.root.querySelector("#marks").innerHTML = marks
      .map((m) => `<span class="mark ${m.cls}" style="left:${pct(m.h)}" title="${m.label}"></span>`)
      .join("");
    this.track.setAttribute("aria-valuemax", end);
  }

  update(st) {
    const p = this.pct(st.h);
    this.head.style.left = p;
    this.done.style.width = p;
    this.lit.style.clipPath = `inset(0 ${100 - (st.h / H_END()) * 100}% 0 0)`;
    this.track.setAttribute("aria-valuenow", st.h.toFixed(2));
    if (this.playing !== this.pb.playing) {
      this.playing = this.pb.playing;
      this.playBtn.textContent = this.playing ? "Pause" : "Play";
    }
    if (this.chapter !== st.chapter) {
      this.chapter = st.chapter;
      this.root.querySelectorAll(".band").forEach((b) => b.setAttribute("aria-current", Number(b.dataset.ch) === st.chapter));
      const seg = this.segs.find((x) => x.chapter === st.chapter);
      this.range.style.left = this.pct(seg.from);
      this.range.style.width = this.pct(seg.to - seg.from);
    }
  }
}
