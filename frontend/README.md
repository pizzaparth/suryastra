# Suryastra: presentation dashboard

A replay of three real geomagnetic storms with a 3D scene, a metrics panel, and a Data analysis page. No model runs in the browser: `scripts/export_dashboard.py` (in the repo root) ran M1 and M2 once on the real NASA OMNI data and saved the results here.

## Run it

**Presenting, offline:** double-click `dist/index.html`. It is one self-contained file.

**Editing:**

```bash
cd frontend
npm install        # once, needs internet
npm run dev        # http://localhost:5173, reloads on save
npm run build      # rebuilds dist/index.html
```

## Deploy on Vercel

`vercel.json` and `.vercelignore` in the repo root are set up for this. Import the repo on Vercel and keep the project root at the repo root; no settings need changing. Vercel runs `npm ci` and `npm run build` in `frontend/` and serves `frontend/dist/`. Data, model weights and the Python code are not uploaded. Needs Node 20.19 or newer (Vercel's default is fine).

From a terminal instead: `npx vercel` (preview) or `npx vercel --prod`, run from the repo root.

## The three scenarios

All three are from 2021–2024, the years M1 never saw in training.

| Button | Storm | Lowest Dst | Shock reaches Earth (OMNI hour) |
|---|---|---|---|
| May 2024 | 10–11 May 2024 superstorm | −406 nT | 2024-05-10 17:00 UTC |
| Apr 2023 | 23–24 April 2023 intense storm | −213 nT | 2023-04-23 18:00 UTC |
| Nov 2021 | 3–4 November 2021 moderate storm | −105 nT | 2021-11-03 20:00 UTC |

Each replay covers 6 hours before to 24 hours after the shock. Chapter timing comes from the computed results: chapter 2 starts an hour before M1's first storm-level forecast, and chapter 3 starts at the Dst minimum.

## Updating the results

From the repo root, with the Python requirements installed:

```bash
python scripts/export_dashboard.py     # rewrites frontend/src/data/scenarios.json and analysis.json
cd frontend && npm run build
```

Do this after retraining M1, changing M2, or editing `src/config/alert_rules.json`. The alert rules are applied in Python at export time, not in the browser.

## Controls

| Control | What it does |
|---|---|
| Scenario buttons | Switch storm |
| Data analysis | Opens the analysis page (charts are interactive; 3D charts rotate) |
| Play / Pause, or Space | Plays the story, about 85 s at 1× |
| 1× / 5× / 20× | Playback speed |
| Chapter names | Jump to a chapter |
| Timeline bar | Click or drag to scrub |
| Drag / scroll on the 3D view | Rotate (about ±30°) / zoom |

Rehearsal URL: `index.html?sc=apr2023&ch=2&h=8` (add `&analysis` to open the analysis page).

## Files

```
frontend/
├── src/
│   ├── main.js              # wires everything; scenario switching
│   ├── config/alert_rules.json
│   ├── data/
│   │   ├── scenarios.json   # written by scripts/export_dashboard.py
│   │   ├── analysis.json    # written by scripts/export_dashboard.py
│   │   └── land_dots.json   # globe dots (npm run globe)
│   ├── engine/story.js      # timeline, chapters, playback, data access
│   ├── scene/scene.js       # Three.js engine
│   └── ui/                  # panel, timeline, charts, analysis page (Plotly)
├── scripts/build_globe.mjs
└── dist/index.html          # offline build
```
