// The semi-3D engine: Earth, magnetosphere, solar wind, CME, Aditya-L1, NavIC + GPS satellites,
// alert sites over India, and a camera that follows the timeline (the presenter can nudge it).
//
// The magnetopause is not drawn as a surface: solar-wind particles show it by piling up and
// sliding around it. Some get caught on the field lines and spiral down into funnels at the poles.
// Everything that moves runs on the story clock (st.dh): pause the timeline and the scene stops.
//
// Units: 1 scene unit = 1 Earth radius (Re). The Sun is far to the left (-x). Not to scale
// outside the magnetosphere: L1 and the Sun are pulled in so they fit on screen.
import * as THREE from "three";
import { CSS2DRenderer, CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import landData from "../data/land_dots.json";
import { llv, earthRotation, clamp, lerp, smooth, noise1, radialTexture, STATUS_HEX } from "./util.js";

const COL = {
  bg: new THREE.Color("#000000"),
  occluder: new THREE.Color("#030303"),
  dotDay: new THREE.Color("#3fbf5a"),
  dotNight: new THREE.Color("#1a4d27"),
  india: new THREE.Color("#8af0a0"),
  field: new THREE.Color("#d9d9d9"),
  fieldStorm: new THREE.Color("#ffffff"),
  shield: new THREE.Color("#9a9a9a"),
  shieldBreach: new THREE.Color("#ffffff"),
  wind: new THREE.Color("#ff7a1a"),
  windSouth: new THREE.Color("#ffa040"),
  cme: new THREE.Color("#ff8a24"),
  signal: new THREE.Color("#ffffff"),
};

const L1_X = -30;
const GEO_R = 6.62;
const GPS_R = 4.16;
const INDIA = { lat: 22, lon: 80 };
const EARTH_R = 1.35; // globe drawn larger than 1 Re so India reads at every zoom

const fresnelVert = /* glsl */ `
  varying vec3 vN; varying vec3 vV;
  void main(){
    vec4 mv = modelViewMatrix * vec4(position,1.0);
    vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;
const fresnelFrag = /* glsl */ `
  uniform vec3 uColor; uniform float uOpacity; uniform float uBase; uniform float uPow;
  varying vec3 vN; varying vec3 vV;
  void main(){
    float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), uPow);
    gl_FragColor = vec4(uColor, clamp(uBase + f * uOpacity, 0.0, 1.0));
  }`;

function fresnelMaterial(color, opacity, base = 0, pow = 2.5, side = THREE.DoubleSide) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: color.clone() }, uOpacity: { value: opacity }, uBase: { value: base }, uPow: { value: pow } },
    vertexShader: fresnelVert,
    fragmentShader: fresnelFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side,
  });
}

export class StormScene {
  constructor(container, labelHost) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.labels = new CSS2DRenderer();
    this.labels.domElement.className = "scene-labels";
    labelHost.appendChild(this.labels.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = COL.bg;
    this.camera = new THREE.PerspectiveCamera(38, 1, 0.05, 2000);
    this.camera.position.set(-16, 9, 46);


    this.time = 0;
    this.user = { yaw: 0, pitch: 0, zoom: 1, dragging: false };

    this.buildStars();
    this.buildSun();
    this.buildEarth();
    this.buildField();
    this.buildShields();
    this.buildWind();
    this.buildCme();
    this.buildL1();
    this.buildSatellites();
    this.buildSites();
    this.bindPointer();
    this.resize();
  }

  // ---------- builders ----------
  buildStars() {
    const n = 1800;
    const pos = new Float32Array(n * 3);
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.randomDirection().multiplyScalar(500 + Math.random() * 300);
      pos.set([v.x, v.y, v.z], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.scene.add(
      new THREE.Points(g, new THREE.PointsMaterial({ color: "#5a5a5a", size: 1.3, sizeAttenuation: false, transparent: true, opacity: 0.7 }))
    );
  }

  buildSun() {
    const tex = radialTexture([
      [0, "rgba(255,236,120,1)"],
      [0.14, "rgba(255,214,40,1)"],
      [0.17, "rgba(255,200,0,0.25)"],
      [0.4, "rgba(255,180,0,0.04)"],
      [1, "rgba(255,170,0,0)"],
    ]);
    this.sun = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    this.sun.position.set(-47, 3, -2);
    this.sun.scale.setScalar(30);
    this.scene.add(this.sun);
    this.sunDir = new THREE.Vector3(-1, 0, 0);
  }

  buildEarth() {
    this.earth = new THREE.Group();
    this.scene.add(this.earth);
    this.globe = new THREE.Group();
    this.globe.scale.setScalar(EARTH_R);
    this.earth.add(this.globe);

    // Ocean: blue, lit on the day side
    const occ = new THREE.Mesh(
      new THREE.SphereGeometry(0.985, 64, 48),
      new THREE.ShaderMaterial({
        uniforms: { uSun: { value: this.sunDir }, uDay: { value: new THREE.Color("#1d5fc4") }, uNight: { value: new THREE.Color("#071a3d") } },
        vertexShader: `varying vec3 vN; void main(){ vN = normalize((modelMatrix * vec4(position,1.0)).xyz); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `uniform vec3 uSun; uniform vec3 uDay; uniform vec3 uNight; varying vec3 vN;
          void main(){ float d = smoothstep(-0.12, 0.35, dot(vN, uSun)); gl_FragColor = vec4(mix(uNight, uDay, d), 1.0); }`,
      })
    );
    this.globe.add(occ);

    const all = [...landData.land.map((p) => [...p, 0]), ...landData.india.map((p) => [...p, 1])];
    const pos = new Float32Array(all.length * 3);
    const india = new Float32Array(all.length);
    const v = new THREE.Vector3();
    all.forEach(([lat, lon, ind], i) => {
      llv(lat, lon, 1.0, v);
      pos.set([v.x, v.y, v.z], i * 3);
      india[i] = ind;
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    g.setAttribute("aIndia", new THREE.BufferAttribute(india, 1));
    this.dotMat = new THREE.ShaderMaterial({
      uniforms: {
        uSun: { value: this.sunDir },
        uDay: { value: COL.dotDay },
        uNight: { value: COL.dotNight },
        uIndia: { value: COL.india.clone() },
        uPR: { value: this.renderer.getPixelRatio() },
        uFocus: { value: 0 },
      },
      vertexShader: /* glsl */ `
        attribute float aIndia; uniform vec3 uSun; uniform float uPR; uniform float uFocus;
        varying float vDay; varying float vIndia;
        void main(){
          vec3 n = normalize((modelMatrix * vec4(position,1.0)).xyz);
          vDay = smoothstep(-0.12, 0.3, dot(n, uSun));
          vIndia = aIndia;
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          float s = mix(0.034, 0.0115, aIndia) * ${EARTH_R.toFixed(2)};
          gl_PointSize = clamp(s * uPR * 900.0 / -mv.z, mix(1.0, 1.6, aIndia), 9.0);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uDay; uniform vec3 uNight; uniform vec3 uIndia;
        varying float vDay; varying float vIndia;
        void main(){
          vec2 c = gl_PointCoord - 0.5; if (dot(c,c) > 0.25) discard;
          vec3 col = mix(uNight, uDay, vDay);
          col = mix(col, uIndia * mix(0.75, 0.6, vDay), vIndia);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.globe.add(new THREE.Points(g, this.dotMat));

    // India outline
    for (const ring of landData.india_outline) {
      const pts = ring.map(([lat, lon]) => llv(lat, lon, 1.003));
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: COL.india, transparent: true, opacity: 0.55 })
      );
      this.globe.add(line);
    }

    // Ionosphere: brightens in the equatorial anomaly bands on the night side as the storm grows
    this.ionoMat = new THREE.ShaderMaterial({
      uniforms: {
        uSun: { value: this.sunDir },
        uStorm: { value: 0 },
        uTime: { value: 0 },
        uCalm: { value: new THREE.Color("#6e6e6e") },
        uHot: { value: new THREE.Color("#9a9a9a") },
      },
      vertexShader: /* glsl */ `
        varying vec3 vL; varying vec3 vNW; varying vec3 vV;
        void main(){
          vL = position;
          vNW = normalize((modelMatrix * vec4(position,1.0)).xyz);
          vec4 mv = modelViewMatrix * vec4(position,1.0);
          vV = normalize(-mv.xyz);
          vec3 nV = normalize(normalMatrix * normal);
          vV = vec3(dot(nV, vV));
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uSun; uniform float uStorm; uniform float uTime; uniform vec3 uCalm; uniform vec3 uHot;
        varying vec3 vL; varying vec3 vNW; varying vec3 vV;
        void main(){
          vec3 p = normalize(vL);
          float lat = asin(p.y);
          float lon = atan(-p.z, p.x);
          float bands = exp(-pow((abs(lat) - 0.26) / 0.1, 2.0));
          float night = smoothstep(0.15, -0.35, dot(vNW, uSun));
          float n = 0.5 + 0.5 * sin(lon * 23.0 + uTime * 1.7) * sin(lat * 31.0 - uTime * 1.1);
          float plumes = smoothstep(0.55, 1.0, n) * night;
          float rim = pow(1.0 - abs(vV.x), 3.0);
          float s = uStorm;
          float a = rim * (0.12 + 0.35 * s) + s * night * (0.18 * bands + 0.45 * plumes * bands) + 0.06 * s;
          vec3 col = mix(uCalm, uHot, smoothstep(0.2, 0.9, s));
          gl_FragColor = vec4(col, clamp(a * 0.25, 0.0, 0.3));
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.globe.add(new THREE.Mesh(new THREE.SphereGeometry(1.045, 96, 64), this.ionoMat));

    // Thin atmosphere rim (not rotating with Earth matters little: it's a sphere)
    this.scene.add(new THREE.Mesh(new THREE.SphereGeometry(1.09 * EARTH_R, 64, 48), fresnelMaterial(new THREE.Color("#4f8dff"), 0.3, 0, 3.5, THREE.BackSide)));
  }

  buildField() {
    this.fieldLines = [];
    const Ls = [2.5, 4, 6, 9];
    const N = 64;
    this.fieldMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let m = 0; m < 8; m++) {
      const psi = (m / 8) * Math.PI * 2;
      for (const L of Ls) {
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
        g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
        const line = new THREE.Line(g, this.fieldMat);
        line.frustumCulled = false;
        this.scene.add(line);
        this.fieldLines.push({ line, psi, L, N, seed: Math.random() * 10 });
      }
    }
  }

  buildShields() {
    const NT = 40;
    const NP = 48;
    const make = (mat) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(new Float32Array((NT + 1) * (NP + 1) * 3), 3));
      const idx = [];
      for (let i = 0; i < NT; i++)
        for (let j = 0; j < NP; j++) {
          const a = i * (NP + 1) + j;
          const b = a + NP + 1;
          idx.push(a, b, a + 1, b, b + 1, a + 1);
        }
      g.setIndex(idx);
      const mesh = new THREE.Mesh(g, mat);
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      return mesh;
    };
    this.shieldGrid = { NT, NP };
    this.magnetopause = make(fresnelMaterial(COL.shield, 0.14, 0.0, 3.0));
    this.magnetopause.visible = false; // shown by the particles instead
    this.bowShock = make(fresnelMaterial(new THREE.Color("#808080"), 0.0, 0.0, 3.2));
    this.bowShock.visible = false;
  }

  setShell(mesh, r0, alpha, thetaMax) {
    const { NT, NP } = this.shieldGrid;
    const pos = mesh.geometry.attributes.position.array;
    let k = 0;
    for (let i = 0; i <= NT; i++) {
      const th = (i / NT) * thetaMax;
      const r = r0 * Math.pow(2 / (1 + Math.cos(th)), alpha);
      for (let j = 0; j <= NP; j++) {
        const ph = (j / NP) * Math.PI * 2;
        pos[k++] = -r * Math.cos(th);
        pos[k++] = r * Math.sin(th) * Math.cos(ph);
        pos[k++] = r * Math.sin(th) * Math.sin(ph);
      }
    }
    mesh.geometry.attributes.position.needsUpdate = true;
    mesh.geometry.computeVertexNormals();
  }

  // ---------- solar wind ----------
  // A pool of particles released from the Sun in batches (puffs). Each particle is idle,
  // flowing with the wind, or caught on a field line and spiralling into a polar funnel.
  buildWind() {
    const n = 16000;
    this.wind = {
      n,
      p: new Float32Array(n * 3),
      v: new Float32Array(n * 3),
      r: new Float32Array(n),
      mode: new Uint8Array(n), // 0 idle, 1 flowing, 2 caught on a field line
      cap: new Float32Array(n * 8), // L, psi, hemi, s, speed, phase, u0, uEnd
      cp: new Float32Array(n * 3), // where it was caught
      next: 0,
      clock: 0,
    };
    for (let i = 0; i < n; i++) {
      this.wind.r[i] = Math.random();
      this.park(i);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.wind.p, 3));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute("aSize", new THREE.BufferAttribute(new Float32Array(n), 1));
    this.windMat = new THREE.ShaderMaterial({
      uniforms: { uPR: { value: this.renderer.getPixelRatio() }, uBoost: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute vec3 color; attribute float aSize; varying vec3 vC; uniform float uPR; uniform float uBoost;
        void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0);
          gl_PointSize = clamp(uPR * aSize * 130.0 * (1.0 + 0.5 * uBoost) / -mv.z, 1.5, 4.0 + 3.0 * uBoost); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: /* glsl */ `
        varying vec3 vC; void main(){ vec2 c = gl_PointCoord - 0.5; float d = dot(c,c); if (d > 0.25) discard;
          gl_FragColor = vec4(vC * (1.0 - d * 3.0), 1.0); }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.windPts = new THREE.Points(g, this.windMat);
    this.windPts.frustumCulled = false;
    this.scene.add(this.windPts);
  }

  park(i) {
    const W = this.wind;
    W.mode[i] = 0;
    W.p[i * 3] = 0;
    W.p[i * 3 + 1] = 1e5;
    W.p[i * 3 + 2] = 0;
  }

  // One batch: a few puffs of particles leaving the Sun together.
  releaseBatch(size, aim) {
    const W = this.wind;
    const g = () => Math.random() + Math.random() + Math.random() - 1.5;
    const puffs = 1 + Math.floor(Math.random() * 3);
    let tries = 0;
    for (let k = 0; k < puffs; k++) {
      const a = Math.random() * Math.PI * 2;
      const rad = Math.sqrt(Math.random()) * aim;
      const cy = Math.cos(a) * rad;
      const cz = Math.sin(a) * rad;
      const spread = 1.2 + Math.random() * 1.6;
      let placed = 0;
      while (placed < size / puffs && tries < W.n) {
        const i = W.next;
        W.next = (W.next + 1) % W.n;
        tries++;
        if (W.mode[i]) continue;
        W.p[i * 3] = -47 + g() * spread * 2;
        W.p[i * 3 + 1] = cy + g() * spread;
        W.p[i * 3 + 2] = cz + g() * spread;
        W.v[i * 3] = 1;
        W.v[i * 3 + 1] = 0;
        W.v[i * 3 + 2] = 0;
        W.mode[i] = 1;
        placed++;
      }
    }
  }

  // Hand a particle that hit the magnetopause over to the field line through that point.
  capture(i, r0, alpha) {
    const W = this.wind;
    const x = W.p[i * 3];
    const y = W.p[i * 3 + 1];
    const z = W.p[i * 3 + 2];
    const L = clamp(Math.hypot(x, y, z) * (0.85 + 0.25 * Math.random()), 3, 12);
    const hemi = Math.abs(y) < 0.4 ? (Math.random() < 0.5 ? 1 : -1) : Math.sign(y);
    const thMin = Math.asin(Math.sqrt(1 / L));
    const span = Math.PI - 2 * thMin;
    const uFoot = (Math.asin(Math.sqrt(Math.min(1, (EARTH_R * 1.02) / L))) - thMin) / span;
    const c = W.cap;
    c[i * 8] = L;
    c[i * 8 + 1] = Math.atan2(z, x);
    c[i * 8 + 2] = hemi;
    c[i * 8 + 3] = 0;
    c[i * 8 + 4] = 0.3 + 0.35 * Math.random();
    c[i * 8 + 5] = Math.random() * Math.PI * 2;
    c[i * 8 + 6] = 0.5 - hemi * 0.04;
    c[i * 8 + 7] = hemi > 0 ? uFoot : 1 - uFoot;
    W.cp[i * 3] = x;
    W.cp[i * 3 + 1] = y;
    W.cp[i * 3 + 2] = z;
    W.mode[i] = 2;
  }

  // How hard the Sun is pushing: quiet wind ~0, a big storm ~1.
  windIntensity(st) {
    const o = st.obs;
    return clamp(Math.max(st.storm * 1.25, (o.dyn_pressure - 2) / 18, (o.sw_speed - 400) / 450));
  }

  stepWind(st, r0, alpha, dt, inten) {
    const W = this.wind;
    const { n, p, v, cap } = W;
    const o = st.obs;
    // batches: more often and bigger as the storm grows
    W.clock += dt;
    const every = lerp(0.7, 0.1, inten);
    while (W.clock >= every) {
      W.clock -= every;
      this.releaseBatch(Math.round(lerp(70, 480, inten) * (0.6 + 0.8 * Math.random())), lerp(15, 10, inten));
    }
    const frontX = this.cmeX ?? -100;
    const preImpact = st.h < st.impactH;
    const ambSpeed = (o.sw_speed / 400) * 7;
    const capRate = 0.25 + 3.5 * inten; // per second spent against the magnetopause
    const tmp = this._t1 ?? (this._t1 = new THREE.Vector3());
    const nrm = this._t2 ?? (this._t2 = new THREE.Vector3());
    const A = this._t3 ?? (this._t3 = new THREE.Vector3());
    const B = this._t4 ?? (this._t4 = new THREE.Vector3());
    const e1 = this._t5 ?? (this._t5 = new THREE.Vector3());
    const e2 = this._t6 ?? (this._t6 = new THREE.Vector3());
    for (let i = 0; i < n; i++) {
      const m = W.mode[i];
      if (m === 0) continue;
      const ix = i * 3;
      if (m === 2) {
        // caught: spiral along the field line down into the polar funnel
        const c = i * 8;
        let sP = cap[c + 3] + dt * cap[c + 4] * (0.5 + 1.5 * cap[c + 3]);
        if (sP >= 1) {
          this.park(i);
          continue;
        }
        cap[c + 3] = sP;
        const L = cap[c];
        const psi = cap[c + 1];
        const u = lerp(cap[c + 6], cap[c + 7], sP);
        const du = (cap[c + 7] - cap[c + 6]) * 0.01;
        this.fieldPoint(psi, L, u, r0, alpha, st.storm, A);
        this.fieldPoint(psi, L, u + du, r0, alpha, st.storm, B);
        B.sub(A);
        e1.crossVectors(B, A).normalize();
        e2.crossVectors(B, e1).normalize();
        const rad = 0.07 * A.length() * (1 - 0.4 * sP);
        const ph = cap[c + 5] + sP * 32;
        A.addScaledVector(e1, Math.cos(ph) * rad).addScaledVector(e2, Math.sin(ph) * rad);
        const b = smooth(0, 0.2, sP);
        p[ix] = lerp(W.cp[ix], A.x, b);
        p[ix + 1] = lerp(W.cp[ix + 1], A.y, b);
        p[ix + 2] = lerp(W.cp[ix + 2], A.z, b);
        continue;
      }
      const inCme = preImpact && p[ix] < frontX;
      const speed = inCme ? 12 : ambSpeed;
      p[ix] += v[ix] * speed * dt;
      p[ix + 1] += v[ix + 1] * speed * dt;
      p[ix + 2] += v[ix + 2] * speed * dt;
      // deflect around the magnetopause
      tmp.set(p[ix], p[ix + 1], p[ix + 2]);
      const d = tmp.length();
      const cosTh = -tmp.x / d;
      if (cosTh > -0.55 && d < 30) {
        const th = Math.acos(cosTh);
        const R = r0 * Math.pow(2 / (1 + Math.cos(th)), alpha) * 1.1;
        if (d < R) {
          nrm.copy(tmp).divideScalar(d);
          tmp.copy(nrm).multiplyScalar(R);
          p[ix] = tmp.x;
          p[ix + 1] = tmp.y;
          p[ix + 2] = tmp.z;
          if (Math.random() < capRate * dt) {
            this.capture(i, r0, alpha);
            continue;
          }
          let vx = v[ix], vy = v[ix + 1], vz = v[ix + 2];
          const vn = vx * nrm.x + vy * nrm.y + vz * nrm.z;
          if (vn < 0) {
            vx -= vn * nrm.x;
            vy -= vn * nrm.y;
            vz -= vn * nrm.z;
          }
          const yz = Math.hypot(nrm.y, nrm.z) || 1;
          vx += 0.25;
          vy += (nrm.y / yz) * 0.4;
          vz += (nrm.z / yz) * 0.4;
          const mm = Math.hypot(vx, vy, vz);
          v[ix] = vx / mm;
          v[ix + 1] = vy / mm;
          v[ix + 2] = vz / mm;
        }
      } else if (p[ix] > 0) {
        // relax back to anti-sunward flow downstream
        v[ix] = lerp(v[ix], 1, 0.02);
        const mm = Math.hypot(v[ix], v[ix + 1], v[ix + 2]);
        v[ix] /= mm;
        v[ix + 1] /= mm;
        v[ix + 2] /= mm;
      }
      if (p[ix] > 34 || Math.abs(p[ix + 1]) > 30 || Math.abs(p[ix + 2]) > 30) this.park(i);
    }
  }

  updateWind(st, r0, alpha) {
    const W = this.wind;
    const inten = this.windIntensity(st);
    // Motion runs on the story clock: frozen when paused, capped so 20x stays readable.
    const dh = Math.abs(st.dh ?? 0);
    if (!this.windWarm || dh > 0.5) {
      // first frame or a jump on the timeline: refill the flow for the new moment
      for (let i = 0; i < W.n; i++) this.park(i);
      W.clock = 0;
      for (let k = 0; k < 170; k++) this.stepWind(st, r0, alpha, 0.06, inten);
      this.windWarm = true;
    } else {
      this.stepWind(st, r0, alpha, clamp(dh / (st.rate || 1), 0, 0.06), inten);
    }

    const { n, p, r, cap } = W;
    const cols = this.windPts.geometry.attributes.color.array;
    const sizes = this.windPts.geometry.attributes.aSize.array;
    const o = st.obs;
    const frontX = this.cmeX ?? -100;
    const preImpact = st.h < st.impactH;
    const dim = lerp(1, 0.3, this.closeK ?? 0);
    const boost = 1 + 0.6 * inten;
    const cAmb = COL.wind.clone().lerp(COL.windSouth, smooth(-2, -20, o.bz));
    const cCme = COL.cme.clone().lerp(COL.windSouth, 0.35);
    const cHot = new THREE.Color("#fff1c4");
    const c = new THREE.Color();
    this.windMat.uniforms.uBoost.value = inten;
    for (let i = 0; i < n; i++) {
      const ix = i * 3;
      const m = W.mode[i];
      let b = 0;
      if (m === 1) {
        const inCme = preImpact && p[ix] < frontX;
        c.copy(inCme ? cCme : cAmb);
        b = (inCme ? 0.9 : 0.6 + 0.25 * r[i]) * dim * boost;
        sizes[i] = 0.8 + 0.5 * r[i];
      } else if (m === 2) {
        const sP = cap[i * 8 + 3];
        c.copy(cAmb).lerp(cHot, smooth(0.3, 1, sP));
        b = 0.9 + 0.6 * sP;
        sizes[i] = 1.5 + 0.6 * r[i] - 0.5 * sP;
      }
      cols[ix] = Math.min(1, c.r * b);
      cols[ix + 1] = Math.min(1, c.g * b);
      cols[ix + 2] = Math.min(1, c.b * b);
    }
    this.windPts.geometry.attributes.position.needsUpdate = true;
    this.windPts.geometry.attributes.color.needsUpdate = true;
    this.windPts.geometry.attributes.aSize.needsUpdate = true;
  }

  buildCme() {
    this.cmeR = 30;
    const g = new THREE.SphereGeometry(this.cmeR, 64, 24, 0, Math.PI * 2, 0, 0.62);
    this.cmeMat = new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 0 }, uColor: { value: COL.cme }, uTime: { value: 0 } },
      vertexShader: /* glsl */ `varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uOpacity; uniform vec3 uColor; uniform float uTime; varying vec3 vP;
        void main(){
          float c = vP.y;
          float core = smoothstep(cos(0.62), 1.0, c);
          float edge = smoothstep(cos(0.62), cos(0.45), c);
          float ripple = 0.92 + 0.08 * sin(atan(vP.z, vP.x) * 14.0 + uTime * 2.0);
          gl_FragColor = vec4(uColor, uOpacity * edge * (0.35 + 0.65 * pow(core, 0.6)) * ripple);
        }`,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.cme = new THREE.Mesh(g, this.cmeMat);
    this.cme.rotation.z = -Math.PI / 2;
    this.scene.add(this.cme);
  }

  buildL1() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshBasicMaterial({ color: "#d0d0d0" }));
    const panelMat = new THREE.MeshBasicMaterial({ color: "#555555" });
    const p1 = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.42, 1.5), panelMat);
    p1.position.z = 1.05;
    const p2 = p1.clone();
    p2.position.z = -1.05;
    const glow = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: radialTexture([[0, "rgba(255,255,255,0.8)"], [1, "rgba(255,255,255,0)"]]),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    g.add(body, p1, p2);
    g.position.set(L1_X, 1.6, 0);
    this.scene.add(g);
    this.l1 = g;
    this.l1Ping = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1.0, 64),
      new THREE.MeshBasicMaterial({ color: "#ffffff", transparent: true, opacity: 0, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    this.l1Ping.rotation.y = Math.PI / 2;
    g.add(this.l1Ping);
    const el = document.createElement("div");
    el.className = "label label-l1";
    el.innerHTML = `<span style="display:block">Aditya-L1</span>`;
    const lab = new CSS2DObject(el);
    lab.position.set(0, 1.4, 0);
    g.add(lab);
    this.l1Label = el;
  }

  satelliteMesh(scale, bodyColor, panelColor) {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 0.2), new THREE.MeshBasicMaterial({ color: bodyColor })));
    const pm = new THREE.MeshBasicMaterial({ color: panelColor });
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.01, 0.16), pm);
    a.position.x = 0.42;
    const b = a.clone();
    b.position.x = -0.42;
    g.add(a, b);
    g.scale.setScalar(scale);
    return g;
  }

  buildSatellites() {
    this.navic = [
      { name: "NavIC GEO 32.5°E", lon: 32.5 },
      { name: "NavIC GEO 83°E", lon: 83 },
      { name: "NavIC GEO 131.5°E", lon: 131.5 },
      { name: "NavIC GSO 55°E", lon: 55, inc: 29, phase: 0 },
      { name: "NavIC GSO 55°E", lon: 55, inc: 29, phase: Math.PI },
      { name: "NavIC GSO 111.75°E", lon: 111.75, inc: 29, phase: Math.PI / 2 },
      { name: "NavIC GSO 111.75°E", lon: 111.75, inc: 29, phase: (3 * Math.PI) / 2 },
    ].map((s) => {
      const mesh = this.satelliteMesh(1, "#ffffff", "#5c5c5c");
      this.earth.add(mesh);
      return { ...s, mesh, world: new THREE.Vector3() };
    });
    // GEO ring guide
    const ring = [];
    for (let i = 0; i <= 128; i++) ring.push(llv(0, (i / 128) * 360, GEO_R));
    this.geoRing = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(ring),
      new THREE.LineDashedMaterial({ color: "#808080", dashSize: 0.25, gapSize: 0.2, transparent: true, opacity: 0.3 })
    );
    this.geoRing.computeLineDistances();
    this.earth.add(this.geoRing);
    const geoEl = document.createElement("div");
    geoEl.className = "label label-ring";
    geoEl.textContent = "Geostationary orbit, 6.6 Rₑ";
    this.geoLabel = new CSS2DObject(geoEl);
    this.scene.add(this.geoLabel);
    this.geoLabelEl = geoEl;

    const navEl = document.createElement("div");
    navEl.className = "label label-sat";
    navEl.textContent = "NavIC";
    this.navicLabel = new CSS2DObject(navEl);
    this.navic[1].mesh.add(this.navicLabel);
    this.navicLabel.position.set(0, 0.45, 0);
    this.navicLabelEl = navEl;

    this.gps = Array.from({ length: 6 }, (_, k) => {
      const mesh = this.satelliteMesh(0.7, "#9a9a9a", "#444444");
      this.scene.add(mesh);
      return { mesh, raan: (k * Math.PI) / 3, phase: k * 1.9 };
    });
  }

  buildSites() {
    this.sites = [];
    this.siteGroup = new THREE.Group();
    this.globe.add(this.siteGroup);
  }

  setSites(sites) {
    for (const s of sites) {
      const g = new THREE.Group();
      const normal = llv(s.lat, s.lon, 1);
      g.position.copy(normal).multiplyScalar(1.006);
      g.lookAt(normal.clone().multiplyScalar(2));
      const mat = new THREE.MeshBasicMaterial({ color: STATUS_HEX.off, transparent: true, side: THREE.DoubleSide, depthWrite: false });
      let core;
      if (s.kind === "disaster") {
        core = new THREE.Mesh(new THREE.CircleGeometry(0.03, 4), mat);
      } else {
        core = new THREE.Mesh(new THREE.RingGeometry(0.016, 0.026, 24), mat);
      }
      const haloMat = mat.clone();
      haloMat.opacity = 0;
      const halo = new THREE.Mesh(new THREE.RingGeometry(0.04, 0.05, 40), haloMat);
      g.add(core, halo);
      const el = document.createElement("div");
      el.className = `label label-site ${s.kind}`;
      el.dataset.side = { kerala: "left", trv: "left", amd: "left", assam: "right-up" }[s.id] ?? "right";
      el.innerHTML = `<i></i><span>${s.name}</span>`;
      const lab = new CSS2DObject(el);
      lab.position.set(0, 0, 0.02);
      g.add(lab);
      this.siteGroup.add(g);
      this.sites.push({ s, g, mat, halo, haloMat, el, normal, world: new THREE.Vector3(), status: "off" });
    }
  }

  bindPointer() {
    const el = this.renderer.domElement;
    let last = null;
    el.addEventListener("pointerdown", (e) => {
      last = [e.clientX, e.clientY];
      el.setPointerCapture(e.pointerId);
      this.user.dragging = true;
    });
    el.addEventListener("pointermove", (e) => {
      if (!last) return;
      const dx = e.clientX - last[0];
      const dy = e.clientY - last[1];
      last = [e.clientX, e.clientY];
      this.user.yaw = clamp(this.user.yaw - dx * 0.004, -0.52, 0.52);
      this.user.pitch = clamp(this.user.pitch + dy * 0.004, -0.52, 0.52);
    });
    const up = () => {
      last = null;
      this.user.dragging = false;
    };
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.user.zoom = clamp(this.user.zoom * Math.exp(e.deltaY * 0.001), 0.6, 1.6);
      },
      { passive: false }
    );
  }

  resetView() {
    this.user.yaw = 0;
    this.user.pitch = 0;
    this.user.zoom = 1;
  }

  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.labels.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // ---------- per-frame ----------
  // state: { h, chapter, zoom, date, obs, mp:{r0,alpha}, storm, impactH, truthError, alerts, focusSite, dt }
  update(st) {
    const dt = Math.min(st.dt, 0.05);
    this.time += dt;
    const t = this.time;

    // Earth orientation follows UTC
    this.earth.rotation.y = earthRotation(st.date);
    this.earth.updateMatrixWorld(true);
    this.ionoMat.uniforms.uStorm.value = st.storm;
    this.ionoMat.uniforms.uTime.value = t;
    this.dotMat.uniforms.uFocus.value = st.chapter > 1 ? 1 : 0;

    // Shields
    const { r0, alpha } = st.mp;

    this.updateField(st, r0, alpha, t);
    this.updateWind(st, r0, alpha);
    this.updateCme(st, r0, t);
    this.updateSatellites(st, t);
    this.updateSites(st, t);
    this.updateCamera(st, dt);

    // Site labels: rescue zones from chapter 2, receivers only when they are the focus. Markers grow with distance.
    const camDir = this.camera.position.clone().normalize();
    const camDist = this.camera.position.length();
    for (const site of this.sites) {
      const facing = site.world.clone().normalize().dot(camDir);
      const focus = st.focusSite === site.s.id;
      const wanted = focus || (site.s.kind === "disaster" && st.chapter > 1);
      const show = wanted && facing > 0.3 && camDist < 24;
      site.el.style.opacity = show ? 1 : 0;
      site.el.classList.toggle("focus", focus);
      site.g.scale.setScalar(clamp(camDist / 4.5, 1, 2.6) * (focus ? 1.4 : 1));
    }
    this.l1Label.style.opacity = st.chapter === 1 ? 1 : 0;
    this.geoLabel.position.copy(llv(0, 0, GEO_R)).applyMatrix4(this.earth.matrixWorld);
    // place GEO label at the ring point nearest the camera's right
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0).setY(0).normalize();
    this.geoLabel.position.copy(right.multiplyScalar(GEO_R)).add(new THREE.Vector3(0, -0.25, 0));
    this.geoLabelEl.style.opacity = st.chapter === 1 && st.h > st.impactH - 0.5 ? 1 : 0;
    this.navicLabelEl.style.opacity = st.chapter === 2 ? 1 : 0;

    this.renderer.render(this.scene, this.camera);
    this.labels.render(this.scene, this.camera);
  }

  // Point u (0 = north foot, 1 = south foot) on the dipole line (L, meridian psi), squeezed on
  // the day side by the magnetopause and stretched into a tail on the night side.
  fieldPoint(psi, L, u, r0, alpha, storm, out) {
    const dx = Math.cos(psi);
    const dz = Math.sin(psi);
    const sunward = -dx; // +1 noon, -1 midnight
    const thMp = Math.acos(clamp(sunward, -1, 1));
    const R = r0 * Math.pow(2 / (1 + Math.cos(Math.min(thMp, 2.2))), alpha);
    const k = Math.min(1, (0.9 * R) / L);
    const night = Math.max(0, -sunward);
    const stretch = 1 + (0.35 + 2.4 * storm) * night * Math.pow(L / 8, 1.3);
    const squash = 1 / (1 + (0.25 + 1.2 * storm) * night * (L / 8));
    const thMin = Math.asin(Math.sqrt(1 / L));
    const th = lerp(thMin, Math.PI - thMin, u);
    const s = Math.sin(th);
    const r = L * s * s;
    let hor = r * s;
    let y = r * Math.cos(th);
    hor *= lerp(1, k, s * s);
    hor *= lerp(1, stretch, Math.pow(s, 4));
    y *= lerp(1, squash, s * s);
    return out.set(dx * hor, y, dz * hor);
  }

  updateField(st, r0, alpha, t) {
    const storm = st.storm;
    const tmp = new THREE.Color();
    const v = new THREE.Vector3();
    const fieldCol = COL.field.clone().lerp(COL.fieldStorm, smooth(0.15, 0.8, storm));
    for (const fl of this.fieldLines) {
      const { psi, L, N, line } = fl;
      const pos = line.geometry.attributes.position.array;
      const col = line.geometry.attributes.color.array;
      const fade = (L > 9 ? 0.55 : 1) * lerp(1, 0.45, this.closeK ?? 0);
      for (let i = 0; i < N; i++) {
        const u = i / (N - 1);
        this.fieldPoint(psi, L, u, r0, alpha, storm, v);
        pos[i * 3] = v.x;
        pos[i * 3 + 1] = v.y;
        pos[i * 3 + 2] = v.z;
        const ends = smooth(0, 0.08, u) * smooth(1, 0.92, u);
        const b = 0.22 * ends * fade * (0.85 + storm * 0.3);
        tmp.copy(fieldCol).multiplyScalar(b);
        col[i * 3] = tmp.r;
        col[i * 3 + 1] = tmp.g;
        col[i * 3 + 2] = tmp.b;
      }
      line.geometry.attributes.position.needsUpdate = true;
      line.geometry.attributes.color.needsUpdate = true;
    }
  }

  frontX(h, impactH, r0) {
    const k1 = impactH - 0.75; // shock passes Aditya-L1 ~45 min before Earth
    if (h <= k1) return lerp(-46, L1_X, clamp(h / k1));
    if (h <= impactH) return lerp(L1_X, -r0 * 1.32, (h - k1) / 0.75);
    return lerp(-r0 * 1.32, 34, clamp((h - impactH) / 0.9));
  }

  updateCme(st, r0, t) {
    const x = this.frontX(st.h, st.impactH, r0);
    this.cme.position.set(x - this.cmeR, 0, 0);
    const before = st.h <= st.impactH;
    const op = before ? 0.12 : 0.12 * (1 - clamp((st.h - st.impactH) / 0.9));
    this.cmeMat.uniforms.uOpacity.value = op;
    this.cmeMat.uniforms.uTime.value = t;
    this.cmeX = x;
    // L1 detection ping
    const sincePass = st.h - (st.impactH - 0.75);
    const ping = sincePass > 0 && sincePass < 0.6 ? 1 - sincePass / 0.6 : 0;
    this.l1Ping.material.opacity = 0;
    this.l1Ping.scale.setScalar(1 + (1 - ping) * 4);
    this.l1.rotation.x = t * 0.2;
  }

  updateSatellites(st, t) {
    const hrs = st.h + 11; // story hour 0 = 11:00 UTC; only used as an orbit phase
    for (const s of this.navic) {
      let lat = 0;
      let lon = s.lon;
      if (s.inc) {
        const w = (2 * Math.PI * hrs) / 24 + s.phase;
        lat = s.inc * Math.sin(w);
        lon = s.lon + 3.6 * Math.sin(2 * w);
      }
      llv(lat, lon, GEO_R, s.mesh.position);
      s.mesh.lookAt(0, 0, 0);
      s.mesh.getWorldPosition(s.world);
    }
    const inc = (55 * Math.PI) / 180;
    for (const g of this.gps) {
      const a = (2 * Math.PI * hrs) / 12 + g.phase;
      const x = Math.cos(a) * GPS_R;
      const y = Math.sin(a) * GPS_R * Math.sin(inc);
      const z = Math.sin(a) * GPS_R * Math.cos(inc);
      g.mesh.position.set(x * Math.cos(g.raan) - z * Math.sin(g.raan), y, x * Math.sin(g.raan) + z * Math.cos(g.raan));
      g.mesh.lookAt(0, 0, 0);
      g.mesh.visible = g.mesh.position.distanceTo(this.camera.position) > 2.2;
    }
  }

  updateSites(st, t) {
    for (const site of this.sites) {
      site.g.getWorldPosition(site.world);
      const a = st.alerts?.find((x) => x.site.id === site.s.id);
      const status = a ? a.alert.status : "off";
      site.status = status;
      site.mat.color.set(STATUS_HEX[status]);
      site.el.style.setProperty("--c", STATUS_HEX[status]);
      const urgent = status === "critical" || status === "serious" || st.focusSite === site.s.id;
      const ph = (t * 0.9 + site.s.lat * 0.1) % 1;
      site.halo.scale.setScalar(urgent ? 1 + ph * 2.2 : 1);
      site.haloMat.color.set(STATUS_HEX[status]);
      site.haloMat.opacity = 0;
    }
  }

  // ---------- camera ----------
  // A shot is { target, dir (unit, from target to camera), dist }. Shots blend on a sphere around
  // the target (direction slerp + log distance), so a zoom never cuts through Earth.
  shotFor(st) {
    const indiaW = llv(INDIA.lat, INDIA.lon, 1).applyQuaternion(this.earth.quaternion).normalize();
    // Follow India with a rate limit: at 20x Earth turns ~100 deg/s and the view would spin.
    // A jump on the timeline resets the tracked direction; the camera smoothing still glides there.
    if (!this.indiaDir || st.snap || Math.abs(st.dh ?? 0) > 0.25) this.indiaDir = indiaW.clone();
    else rotateToward(this.indiaDir, indiaW, (Math.PI / 180) * 12 * Math.min(st.dt, 0.05));
    const india = this.indiaDir;
    const north = new THREE.Vector3(0, 1, 0);
    const side = new THREE.Vector3().crossVectors(north, india).normalize();
    const track = (dist, lift, swing, lookK) => {
      const target = india.clone().multiplyScalar(lookK * EARTH_R);
      const pos = india.clone().addScaledVector(north, lift).addScaledVector(side, swing).normalize().multiplyScalar(dist);
      return toShot(pos, target);
    };
    const push = smooth(st.impactH - 1.2, st.impactH + 1.5, st.h);
    const wide = toShot(
      new THREE.Vector3(lerp(-20, -4, push), lerp(11, 5, push), lerp(58, 21, push)),
      new THREE.Vector3(lerp(-19, -3.5, push), -1, 0)
    );
    // Blend across each chapter boundary so the camera is a function of story time.
    const [, s2, s3] = st.segs;
    const w1 = smooth(s2.from - 0.6, s2.from + 1.6, st.h);
    const w2 = smooth(s3.from - 0.6, s3.from + 1.6, st.h);
    this.closeK = Math.max(0.4 * w1, w2);
    const mid = track(19, 0.42, 0.18, 0);
    const close = track(4.6, 0.3, -0.12, 0.85);
    return blendShot(blendShot(wide, mid, w1), close, w2);
  }

  updateCamera(st, dt) {
    const shot = this.shotFor(st);
    // presenter nudges, applied around the shot's target
    const up = new THREE.Vector3(0, 1, 0);
    const dir = shot.dir.clone().applyAxisAngle(up, this.user.yaw);
    const right = new THREE.Vector3().crossVectors(up, dir).normalize();
    dir.applyAxisAngle(right, this.user.pitch).normalize();
    const dist = shot.dist * this.user.zoom;

    if (!this.cam || st.snap) {
      this.cam = { target: shot.target.clone(), dir: dir.clone(), logDist: Math.log(dist) };
    } else {
      const k = 1 - Math.exp(-Math.min(dt, 0.05) * 3);
      this.cam.target.lerp(shot.target, k);
      rotateToward(this.cam.dir, dir, Math.acos(clamp(this.cam.dir.dot(dir), -1, 1)) * k);
      this.cam.logDist = lerp(this.cam.logDist, Math.log(dist), k);
    }
    this.camera.position.copy(this.cam.dir).multiplyScalar(Math.exp(this.cam.logDist)).add(this.cam.target);
    this.camera.lookAt(this.cam.target);
  }
}

function toShot(pos, target) {
  const off = pos.clone().sub(target);
  const dist = off.length();
  return { target, dir: off.divideScalar(dist), dist };
}

function blendShot(a, b, w) {
  if (w <= 0) return a;
  if (w >= 1) return b;
  const dir = a.dir.clone();
  rotateToward(dir, b.dir, Math.acos(clamp(a.dir.dot(b.dir), -1, 1)) * w);
  return {
    target: a.target.clone().lerp(b.target, w),
    dir,
    dist: Math.exp(lerp(Math.log(a.dist), Math.log(b.dist), w)),
  };
}

// Rotate unit vector v toward unit vector to by at most maxAngle (radians), in place.
const _q = new THREE.Quaternion();
const _axis = new THREE.Vector3();
function rotateToward(v, to, maxAngle) {
  const ang = Math.acos(clamp(v.dot(to), -1, 1));
  if (ang < 1e-5 || maxAngle <= 0) return v;
  _axis.crossVectors(v, to);
  if (_axis.lengthSq() < 1e-10) _axis.set(0, 1, 0).cross(v);
  _axis.normalize();
  return v.applyQuaternion(_q.setFromAxisAngle(_axis, Math.min(ang, maxAngle))).normalize();
}
