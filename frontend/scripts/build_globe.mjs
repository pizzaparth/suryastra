// Builds src/data/land_dots.json: lat/lon dots for the stylised globe, plus India's outline.
//
//   npm run globe
//
// Storm data and model results come from ../scripts/export_dashboard.py, not from here.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { feature } from "topojson-client";
import { geoContains } from "d3-geo";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const outDir = path.join(root, "src", "data");
const round = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

// ---------- land dots + India outline ----------
const world = JSON.parse(fs.readFileSync(path.join(root, "node_modules/world-atlas/countries-110m.json"), "utf8"));
const land = feature(world, world.objects.land);
const countries = feature(world, world.objects.countries);
const india = countries.features.find((f) => f.id === "356");

const dots = [];
const STEP = 1.5;
for (let lat = -84; lat <= 84; lat += STEP) {
  const n = Math.max(1, Math.round((360 * Math.cos((lat * Math.PI) / 180)) / STEP));
  for (let j = 0; j < n; j++) {
    const lon = -180 + (360 * j) / n;
    if (geoContains(india, [lon, lat])) continue; // India gets its own dense grid
    if (geoContains(land, [lon, lat])) dots.push([round(lat, 2), round(lon, 2)]);
  }
}
const indiaDots = [];
const ISTEP = 0.55;
for (let lat = 6; lat <= 37; lat += ISTEP) {
  const n = Math.round((360 * Math.cos((lat * Math.PI) / 180)) / ISTEP);
  for (let j = 0; j < n; j++) {
    const lon = -180 + (360 * j) / n;
    if (lon < 66 || lon > 99) continue;
    if (geoContains(india, [lon, lat])) indiaDots.push([round(lat, 2), round(lon, 2)]);
  }
}
const outline = (india.geometry.type === "Polygon" ? [india.geometry.coordinates] : india.geometry.coordinates).map(
  (poly) => poly[0].map(([lon, lat]) => [round(lat, 2), round(lon, 2)])
);
fs.writeFileSync(path.join(outDir, "land_dots.json"), JSON.stringify({ land: dots, india: indiaDots, india_outline: outline }));

console.log(`land dots: ${dots.length}, india dots: ${indiaDots.length}`);
