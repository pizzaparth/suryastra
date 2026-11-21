// The semi-3D engine: Earth, magnetosphere, solar wind, CME, Aditya-L1, NavIC + GPS satellites,
// signal paths to Indian sites, and a scripted camera that the presenter can nudge.
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
    this.camTarget = new THREE.Vector3(-15, 0, 0);


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
    this.buildRays();
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
    this.earth.add(occ);

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
          float s = mix(0.034, 0.0115, aIndia);
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
    this.earth.add(new THREE.Points(g, this.dotMat));

    // India outline
    for (const ring of landData.india_outline) {
      const pts = ring.map(([lat, lon]) => llv(lat, lon, 1.003));
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: COL.india, transparent: true, opacity: 0.55 })
      );
      this.earth.add(line);
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
    this.earth.add(new THREE.Mesh(new THREE.SphereGeometry(1.045, 96, 64), this.ionoMat));

    // Thin atmosphere rim (not rotating with Earth matters little: it's a sphere)
    this.scene.add(new THREE.Mesh(new THREE.SphereGeometry(1.09, 64, 48), fresnelMaterial(new THREE.Color("#4f8dff"), 0.3, 0, 3.5, THREE.BackSide)));
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

  buildWind() {
    const n = 900;
    this.wind = { n, p: new Float32Array(n * 3), v: new Float32Array(n * 3), r: new Float32Array(n) };
    for (let i = 0; i < n; i++) this.spawn(i, true);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(this.wind.p, 3));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    this.windPts = new THREE.Points(
      g,
      new THREE.ShaderMaterial({
        uniforms: { uPR: { value: this.renderer.getPixelRatio() } },
        vertexShader: /* glsl */ `
          attribute vec3 color; varying vec3 vC; uniform float uPR;
          void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0);
            gl_PointSize = clamp(uPR * 110.0 / -mv.z, 1.5, 3.5); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: /* glsl */ `
          varying vec3 vC; void main(){ vec2 c = gl_PointCoord - 0.5; float d = dot(c,c); if (d > 0.25) discard;
            gl_FragColor = vec4(vC * (1.0 - d * 3.0), 1.0); }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    this.windPts.frustumCulled = false;
    this.scene.add(this.windPts);
  }

  spawn(i, anywhere = false) {
    const { p, v, r } = this.wind;
    const a = Math.random() * Math.PI * 2;
    const rad = Math.sqrt(Math.random()) * 17 + 0.15;
    p[i * 3] = anywhere ? -46 + Math.random() * 80 : -46 - Math.random() * 2;
    p[i * 3 + 1] = Math.cos(a) * rad;
    p[i * 3 + 2] = Math.sin(a) * rad;
    v[i * 3] = 1;
    v[i * 3 + 1] = 0;
    v[i * 3 + 2] = 0;
    r[i] = Math.random();
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
    this.earth.add(this.siteGroup);
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
    this.raySites = this.sites.filter((x) => x.s.kind === "disaster");
    this.rayCount = this.navic.length * this.raySites.length;
    this.allocRays();
  }

  buildRays() {
    this.raySegs = 14;
  }

  allocRays() {
    const verts = this.rayCount * this.raySegs * 2;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
    this.rays = new THREE.LineSegments(
      g,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
    );
    this.rays.frustumCulled = false;
    this.scene.add(this.rays);
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
    this.setShell(this.magnetopause, r0, alpha, 2.15);
    const breach = r0 < GEO_R;
    this.magnetopause.material.uniforms.uColor.value.copy(COL.shield).lerp(COL.shieldBreach, breach ? 1 : smooth(8, 6.6, r0));
    this.magnetopause.material.uniforms.uOpacity.value = breach ? 0.22 : 0.14;

    this.updateField(st, r0, alpha, t);
    this.updateWind(st, r0, alpha, dt);
    this.updateCme(st, r0, t);
    this.updateSatellites(st, t);
    this.updateSites(st, t);
    this.updateRays(st, t);
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

  updateField(st, r0, alpha, t) {
    const storm = st.storm;
    const tmp = new THREE.Color();
    const fieldCol = COL.field.clone().lerp(COL.fieldStorm, smooth(0.15, 0.8, storm));
    for (const fl of this.fieldLines) {
      const { psi, L, N, line, seed } = fl;
      const dx = Math.cos(psi);
      const dz = Math.sin(psi);
      const sunward = -dx; // +1 noon, -1 midnight
      // magnetopause distance in this meridian's equatorial direction
      const thMp = Math.acos(clamp(sunward, -1, 1));
      const R = r0 * Math.pow(2 / (1 + Math.cos(Math.min(thMp, 2.2))), alpha);
      const k = Math.min(1, (0.9 * R) / L);
      const night = Math.max(0, -sunward);
      const stretch = 1 + (0.35 + 2.4 * storm) * night * Math.pow(L / 8, 1.3);
      const squash = 1 / (1 + (0.25 + 1.2 * storm) * night * (L / 8));
      const thMin = Math.asin(Math.sqrt(1 / L));
      const pos = line.geometry.attributes.position.array;
      const col = line.geometry.attributes.color.array;
      const fade = L > 9 ? 0.55 : 1;
      for (let i = 0; i < N; i++) {
        const u = i / (N - 1);
        const th = lerp(thMin, Math.PI - thMin, u);
        const s = Math.sin(th);
        const r = L * s * s;
        let hor = r * s;
        let y = r * Math.cos(th);
        const eq = Math.pow(s, 4);
        hor *= lerp(1, k, s * s);
        hor *= lerp(1, stretch, eq);
        y *= lerp(1, squash, s * s);
        pos[i * 3] = dx * hor;
        pos[i * 3 + 1] = y;
        pos[i * 3 + 2] = dz * hor;
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
    this.cmeMat.uniforms.uOpacity.value = st.chapter === 1 ? op : 0;
    this.cmeMat.uniforms.uTime.value = t;
    this.cmeX = x;
    // L1 detection ping
    const sincePass = st.h - (st.impactH - 0.75);
    const ping = sincePass > 0 && sincePass < 0.6 ? 1 - sincePass / 0.6 : 0;
    this.l1Ping.material.opacity = 0;
    this.l1Ping.scale.setScalar(1 + (1 - ping) * 4);
    this.l1.rotation.x = t * 0.2;
  }

  updateWind(st, r0, alpha, dt) {
    const { n, p, v, r } = this.wind;
    const cols = this.windPts.geometry.attributes.color.array;
    const o = st.obs;
    const frontX = this.cmeX ?? -100;
    const preImpact = st.h < st.impactH;
    this.windDim = st.chapter === 1 ? 1 : st.zoom ? 0.12 : 0.3;
    const cAmb = COL.wind.clone().lerp(COL.windSouth, smooth(-2, -20, o.bz));
    const cCme = COL.cme.clone().lerp(COL.windSouth, 0.35);
    const ambFrac = clamp(o.proton_density / 25, 0.35, 1);
    const ambSpeed = (o.sw_speed / 400) * 7;
    const tmp = new THREE.Vector3();
    const nrm = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const ix = i * 3;
      const inCme = preImpact && p[ix] < frontX;
      const speed = inCme ? 12 : ambSpeed;
      const visible = r[i] < (inCme ? 1 : ambFrac);
      // integrate
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
          const m = Math.hypot(vx, vy, vz);
          v[ix] = vx / m;
          v[ix + 1] = vy / m;
          v[ix + 2] = vz / m;
        }
      } else if (p[ix] > 0) {
        // relax back to anti-sunward flow downstream
        v[ix] = lerp(v[ix], 1, 0.02);
        const m = Math.hypot(v[ix], v[ix + 1], v[ix + 2]);
        v[ix] /= m;
        v[ix + 1] /= m;
        v[ix + 2] /= m;
      }
      if (p[ix] > 34 || Math.abs(p[ix + 1]) > 30 || Math.abs(p[ix + 2]) > 30) this.spawn(i);
      const c = inCme ? cCme : cAmb;
      const b = visible ? (inCme ? 0.9 : 0.75) * this.windDim : 0;
      cols[ix] = c.r * b;
      cols[ix + 1] = c.g * b;
      cols[ix + 2] = c.b * b;
    }
    this.windPts.geometry.attributes.position.needsUpdate = true;
    this.windPts.geometry.attributes.color.needsUpdate = true;
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

  updateRays(st, t) {
    if (!this.rays) return;
    const pos = this.rays.geometry.attributes.position.array;
    const col = this.rays.geometry.attributes.color.array;
    const S = this.raySegs;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const perp = new THREE.Vector3();
    const perp2 = new THREE.Vector3();
    const c = new THREE.Color();
    const sig = COL.signal;
    const degr = clamp(st.truthError / 70); // 0 calm .. 1 badly degraded
    let k = 0;
    let rid = 0;
    const show = 1;
    for (const sat of this.navic) {
      for (const site of this.raySites) {
        rid++;
        const visible = site.world.clone().sub(sat.world).dot(site.world) < 0; // site sees the satellite
        const statusCol = new THREE.Color(STATUS_HEX[site.status === "off" ? "off" : site.status]);
        const focus = st.focusSite && st.focusSite === site.s.id;
        const flick = 1;
        const base = (visible ? 1 : 0) * show * (st.focusSite ? (focus ? 0.9 : 0.06) : 0.5) * flick;
        a.copy(sat.world);
        b.copy(site.world);
        const dir = b.clone().sub(a).normalize();
        perp.crossVectors(dir, new THREE.Vector3(0, 1, 0)).normalize();
        perp2.crossVectors(dir, perp).normalize();
        for (let i = 0; i < S; i++) {
          for (let e = 0; e < 2; e++) {
            const u = (i + e) / S;
            const p = a.clone().lerp(b, u);
            const w = smooth(0.55, 0.92, u) * (1 - smooth(0.985, 1, u));
            const amp = degr * 0.035 * w;
            p.addScaledVector(perp, noise1(t * 9 + rid * 7 + u * 25) * amp);
            p.addScaledVector(perp2, noise1(t * 8 + rid * 5 + u * 31 + 50) * amp);
            pos[k * 3] = p.x;
            pos[k * 3 + 1] = p.y;
            pos[k * 3 + 2] = p.z;
            const toward = smooth(0.5, 1, u);
            const target = site.status === "off" ? sig : statusCol;
            c.copy(sig).lerp(target, toward);
            const travel = 1;
            const v = base * travel * 0.35;
            col[k * 3] = c.r * v;
            col[k * 3 + 1] = c.g * v;
            col[k * 3 + 2] = c.b * v;
            k++;
          }
        }
      }
    }
    this.rays.geometry.attributes.position.needsUpdate = true;
    this.rays.geometry.attributes.color.needsUpdate = true;
  }

  // ---------- camera ----------
  shotFor(st) {
    const indiaW = llv(INDIA.lat, INDIA.lon, 1).applyQuaternion(this.earth.quaternion).normalize();
    const north = new THREE.Vector3(0, 1, 0);
    const side = new THREE.Vector3().crossVectors(north, indiaW).normalize();
    const track = (dist, lift, swing, lookK) => {
      const dir = indiaW.clone().addScaledVector(north, lift).addScaledVector(side, swing).normalize();
      return { pos: dir.multiplyScalar(dist), target: indiaW.clone().multiplyScalar(lookK) };
    };
    if (st.chapter === 1) {
      const push = smooth(st.impactH - 1.2, st.impactH + 1.5, st.h);
      return {
        pos: new THREE.Vector3(lerp(-20, -4, push), lerp(11, 5, push), lerp(58, 21, push)),
        target: new THREE.Vector3(lerp(-19, -3.5, push), -1, 0),
      };
    }
    if (st.chapter === 2) return track(19, 0.42, 0.18, 0);
    return track(4.6, 0.3, -0.12, 0.85);
  }

  updateCamera(st, dt) {
    const shot = this.shotFor(st);
    const off = shot.pos.clone().sub(shot.target);
    const up = new THREE.Vector3(0, 1, 0);
    off.applyAxisAngle(up, this.user.yaw);
    const right = new THREE.Vector3().crossVectors(up, off).normalize();
    off.applyAxisAngle(right, this.user.pitch);
    off.multiplyScalar(this.user.zoom);
    const desired = shot.target.clone().add(off);
    const k = 1 - Math.exp(-dt * (st.snap ? 60 : 2.2));
    this.camera.position.lerp(desired, k);
    this.camTarget.lerp(shot.target, k);
    this.camera.lookAt(this.camTarget);
  }
}
