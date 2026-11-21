// Master timeline: play/pause, speed, scrubbing, chapter bands.
import { CHAPTERS, H_END } from "../engine/story.js";

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
          <div class="rail"></div>
          <div class="range" id="range"></div>
          <div class="done" id="done"></div>
          <div class="head" id="head"></div>
        </div>
      </div>`;
    this.playBtn = root.querySelector("#play");
    this.head = root.querySelector("#head");
    this.done = root.querySelector("#done");
    this.track = root.querySelector("#track");

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

  // Bands depend on the scenario's chapter segments.
  reset() {
    const segs = this.pb.segs;
    const end = H_END();
    const pct = (h) => `${(h / end) * 100}%`;
    this.root.querySelector("#bands").innerHTML = CHAPTERS.map(
      (c) => `<button class="band" data-ch="${c.n}">${c.n}. ${c.title}</button>`
    ).join("");
    this.segs = segs;
    this.root.querySelectorAll(".band").forEach((b) => b.addEventListener("click", () => this.pb.goChapter(Number(b.dataset.ch))));
    this.pct = pct;
    this.track.setAttribute("aria-valuemax", end);
  }

  update(st) {
    this.head.style.left = this.pct(st.h);
    this.done.style.width = this.pct(st.h);
    this.track.setAttribute("aria-valuenow", st.h.toFixed(2));
    if (this.playing !== this.pb.playing) {
      this.playing = this.pb.playing;
      this.playBtn.textContent = this.playing ? "Pause" : "Play";
    }
    this.root.querySelectorAll(".band").forEach((b) => b.setAttribute("aria-current", Number(b.dataset.ch) === st.chapter));
    const seg = this.segs.find((x) => x.chapter === st.chapter);
    const range = this.root.querySelector("#range");
    range.style.left = this.pct(seg.from);
    range.style.width = this.pct(seg.to - seg.from);
  }
}
