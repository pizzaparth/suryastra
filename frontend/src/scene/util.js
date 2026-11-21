import * as THREE from "three";

const D2R = Math.PI / 180;

// Earth-fixed frame: +y = north pole, lon 0 on +x, longitude increases eastward (counter-clockwise from north).
export function llv(lat, lon, r = 1, target = new THREE.Vector3()) {
  const la = lat * D2R;
  const lo = lon * D2R;
  return target.set(Math.cos(la) * Math.cos(lo) * r, Math.sin(la) * r, -Math.cos(la) * Math.sin(lo) * r);
}

// Earth rotation angle (about +y) that puts the sub-solar point on the -x axis (the Sun is to the left).
export function earthRotation(date) {
  const ut = date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  const subsolarLon = (12 - ut) * 15 * D2R;
  return Math.PI - subsolarLon;
}

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth = (a, b, x) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

// Cheap deterministic 1D noise for jitter.
export function noise1(x) {
  const i = Math.floor(x);
  const f = x - i;
  const h = (n) => {
    const s = Math.sin(n * 127.1) * 43758.5453;
    return s - Math.floor(s);
  };
  const u = f * f * (3 - 2 * f);
  return lerp(h(i), h(i + 1), u) * 2 - 1;
}

export function radialTexture(stops, size = 256) {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) grad.addColorStop(o, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Monochrome alert levels: brighter = more severe.
export const STATUS_HEX = {
  good: "#4d4d4d",
  warning: "#8c8c8c",
  serious: "#c8c8c8",
  critical: "#ffffff",
  off: "#5a5a5a",
};
