// Seven by Seven, 3D map concept: the scene, the three looks, the camera and its gestures, names, flags, pins and the tap.
// Draws only when something moves (a camera change, a fade, a lift); between those the page is still.
// ?look=paper|clay|night  ?view=bay|sf|gg|skyline|hills|vegas  ?still=1 (no opening flight)  ?pr=N (pixel ratio cap)
(function () {
  'use strict';
  const T = window.M3D.terrain, MD = window.M3D.models, proj = T.proj;
  const Q = new URLSearchParams(location.search);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v)), lerp = (a, b, t) => a + (b - a) * t;
  const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2, easeOut = t => 1 - Math.pow(1 - t, 3);
  const backOut = t => { const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
  const $ = s => document.querySelector(s);
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const SANS = '"Figtree", "Avenir Next", "Helvetica Neue", Arial, sans-serif';

  // ---------- the three looks: same geometry, different materials, light and air ----------
  const BUILT = { // colours of everything built, by material name
    paper: { whiteCable: '#eef0ee', white: '#f8f4ec', whiteShade: '#e4ddcf', stone: '#ebe4d5', stoneShade: '#cdc4b0', metal: '#dcdcd8', glass: '#b4c5ce', glassTop: '#d6e0e5', glassDark: '#74858f', roof: '#98a2a8', glassRoof: '#c4d3d8', red: '#d4563a', gg: '#e85a1f', ggShade: '#d04f1a', ggCable: '#dc551d', steel: '#99a0a2', steelShade: '#848b8e', steelCable: '#8d9496', concrete: '#d2cbbb', concreteLight: '#e6e0d2', road: '#6c7075', roadLight: '#b3b0a8', dark: '#3c4a57', rust: '#b3765a', ochre: '#dcae80', ochreShade: '#b98a5e', dome: '#cc7a50', lagoon: '#a9c9d2', lamp: '#fff3c4', clock: '#fdf9ee', p0: '#9db8cc', p1: '#e6c97a', p2: '#dd9c90', p3: '#a8c096', p4: '#f1e5ca', p5: '#b8a3c5', p6: '#8cb6b1', trim: '#fdfaf2', sphere: '#394655', bronze: '#8e6d51', bronzeShade: '#70553f', wheel: '#f4f1ea', wheelShade: '#c6c2b8', cabin: '#dfe7ec', luxor: '#3a434e', sand: '#d9bc8e', bldg0: '#f4f0e7', bldg1: '#ece6da', bldg2: '#e2dccf', bldg3: '#d6dee1', resort0: '#f3eee4', resort1: '#dcc48e', resort2: '#e8decb', resort3: '#cfd8dc', resort4: '#c4a575', podium: '#e4ddcd', boulevard: '#fdfbf6', pole: '#4f4a41', poleBase: '#3c4a57', flag: '#e85a1f', roofTop: '#d6cfbf', pin: '#ffffff', pinDot: '#ffffff' },
    clay: { whiteCable: '#ffffff', white: '#fffaf0', whiteShade: '#f0e2cf', stone: '#fbeed8', stoneShade: '#e3cfb0', metal: '#e9e6e0', glass: '#9fd0ec', glassTop: '#cdeaf7', glassDark: '#5f8fb0', roof: '#7fa2b8', glassRoof: '#bfe3ee', red: '#f0503a', gg: '#ff5326', ggShade: '#e8461d', ggCable: '#f74d22', steel: '#aab6c2', steelShade: '#93a0ad', steelCable: '#9eabb8', concrete: '#e8dcc6', concreteLight: '#f6ecda', road: '#6a6f7c', roadLight: '#c2bcb4', dark: '#3d3a5c', rust: '#d67a50', ochre: '#f5b877', ochreShade: '#d99555', dome: '#ef7d4a', lagoon: '#8fdcec', lamp: '#fff3b0', clock: '#fffdf2', p0: '#8fc3f0', p1: '#ffd257', p2: '#ff9a8c', p3: '#9bdc86', p4: '#fff0c9', p5: '#c9a2ec', p6: '#6fd6c8', trim: '#ffffff', sphere: '#3b3f6b', bronze: '#b0794d', bronzeShade: '#8f5f3a', wheel: '#ffffff', wheelShade: '#d9d6d0', cabin: '#d6f0ff', luxor: '#3d3f5e', sand: '#f1c98a', bldg0: '#fffaf0', bldg1: '#fdeedd', bldg2: '#f4e0c8', bldg3: '#d8ecf6', resort0: '#fff4dc', resort1: '#ffd257', resort2: '#ff9d73', resort3: '#8fc3f0', resort4: '#ff96aa', podium: '#f6e6cc', boulevard: '#ffffff', pole: '#5a4a42', poleBase: '#3d3a5c', flag: '#ff5326', roofTop: '#eadccb', pin: '#ffffff', pinDot: '#ffffff' },
    night: { whiteCable: '#77828e', white: '#55606d', whiteShade: '#454f5b', stone: '#4d5764', stoneShade: '#3c4651', metal: '#6a7480', glass: '#3c5266', glassTop: '#7fb6d8', glassDark: '#2a3a4a', roof: '#343e4b', glassRoof: '#3d5560', red: '#a3463a', gg: '#e2602a', ggShade: '#c04e1e', ggCable: '#cf5522', steel: '#59636f', steelShade: '#48525d', steelCable: '#56606c', concrete: '#444e5a', concreteLight: '#525c68', road: '#1c242d', roadLight: '#3a444f', dark: '#1a232c', rust: '#7a5140', ochre: '#8a6f55', ochreShade: '#6e573f', dome: '#96583a', lagoon: '#1d3a4a', lamp: '#fff3c4', clock: '#fff4d6', p0: '#55708a', p1: '#8f7c48', p2: '#8b5e58', p3: '#5f7556', p4: '#857d68', p5: '#6f6082', p6: '#4b6f6c', trim: '#7d8690', sphere: '#4f66ff', bronze: '#6b523d', bronzeShade: '#523f2e', wheel: '#6a7480', wheelShade: '#4d5764', cabin: '#b9d8ff', luxor: '#1b222b', sand: '#77664c', bldg0: '#5d6878', bldg1: '#566170', bldg2: '#4f5a68', bldg3: '#55667a', resort0: '#646a74', resort1: '#7d6b44', resort2: '#666159', resort3: '#53616f', resort4: '#6d5a43', podium: '#46505c', boulevard: '#6a5a3a', pole: '#c3ccd4', poleBase: '#8e9ca8', flag: '#ff7a3d', roofTop: '#414a56', pin: '#ffffff', pinDot: '#ffffff' },
  };
  const LOOKS = {
    paper: {
      bg: '#e9e5da', fog: [1.7, 8], water: '#c4d2da', deep: '#a8bcc8', shallow: '#d9e4e8', shore: 1, inland: '#c4d2da', land: '#e5dece', far: '#e2dbca',
      vibe: { 'v-fog': '#8ea4ba', 'v-hills': '#c98a66', 'v-water': '#74a9ab', 'v-sun': '#d6b25c', 'v-buzz': '#c5848e', 'v-green': '#9fb48a' }, lift: '#fdfbf6', liftK: 0.05,
      side: '#6a4529', sideK: 0.14, bevelK: 0.2,
      accent: '#e85a1f', key: { c: '#fff2df', i: 2.15, az: 302, el: 44 }, hemi: { sky: '#f5f6f6', ground: '#dccdb2', i: 1.85 }, shadowR: 2.5,
      tile: { rough: 0.94 }, built: { rough: 0.82 }, pane: 0.1, waterMat: { rough: 0.78, metal: 0 }, glow: 0, lights: false,
      label: '#15202b', label2: '#3c4a57', region: '#3c4a57', halo: '#ebe5d6', wlbl: '#7a8f9c', want: '#2f6fcf',
      kinds: { food: '#c98a66', drink: '#8c6a9b', coffee: '#8a6a4f', view: '#5f7a94', shop: '#d6b25c', park: '#7f9a6b', other: '#68788a' },
    },
    clay: {
      bg: '#fbe8d3', fog: [1.6, 8], water: '#86cdea', shallow: '#c4eef6', shore: 1.15, inland: '#a5ddf0', land: '#f6e4c4', far: '#f3dfbc',
      vibe: { 'v-fog': '#86aee6', 'v-hills': '#f39a6b', 'v-water': '#4ec8c2', 'v-sun': '#f8cb4a', 'v-buzz': '#f58ba3', 'v-green': '#97d47f' }, lift: '#ffffff', liftK: 0.06,
      accent: '#ff5326', key: { c: '#fff0d8', i: 2.35, az: 300, el: 38 }, hemi: { sky: '#eaf3ff', ground: '#ffd9b8', i: 1.62 }, shadowR: 5,
      tile: { rough: 0.62 }, built: { rough: 0.55 }, pane: 0.14, waterMat: { rough: 0.32, metal: 0 }, glow: 0, lights: false,
      label: '#2b2140', label2: '#4d4266', halo: 'rgba(255,250,240,.9)', wlbl: '#3f93b8', want: '#2f6fcf',
      kinds: { food: '#f39a6b', drink: '#a678d0', coffee: '#a9744c', view: '#5a92d6', shop: '#f8cb4a', park: '#6fbf5c', other: '#7d8aa0' },
    },
    night: {
      bg: '#0b1118', fog: [1.6, 7.5], water: '#0d151d', deep: '#080d13', shallow: '#142a3b', shore: 1.25, rim: '#4b6a8a', inland: '#101c27', land: '#323d4b', far: '#262f3b',
      vibe: { 'v-fog': '#6f88a6', 'v-hills': '#b8795a', 'v-water': '#5d9598', 'v-sun': '#c2a052', 'v-buzz': '#b0727d', 'v-green': '#86a075' }, lift: '#c9d6e6', liftK: 0.04,
      side: '#05080c', sideK: 0.32, bevelK: 0.14,
      accent: '#ff7a3d', key: { c: '#b4c8ff', i: 1.05, az: 300, el: 48 }, hemi: { sky: '#9fb2d4', ground: '#2c2a33', i: 1.75 }, shadowR: 2.5,
      tile: { rough: 0.9 }, built: { rough: 0.75 }, pane: 0.3, waterMat: { rough: 0.6, metal: 0.1 }, glow: 0.95, amb: 0.22, lights: true,
      label: '#eaeff3', label2: '#c3ccd4', region: '#c3ccd4', halo: '#1b232c', wlbl: '#5c7389', want: '#6ea0e0',
      kinds: { food: '#c98a66', drink: '#a483b4', coffee: '#a3826a', view: '#7f9ab3', shop: '#d6b25c', park: '#8fae7b', other: '#8e9ca8' },
    },
  };
  const LIGHTS = { warm: '#ffc27a', white: '#eaf2ff', red: '#ff4b3a', cool: '#9fd2ff', gold: '#ffcf6b', pink: '#ff6fb0', violet: '#9b7bff', sphere: '#5a72ff', beam: '#fff1c2' };
  let look = LOOKS[Q.get('look')] ? Q.get('look') : 'paper';

  // ---------- renderer and scene ----------
  const glCanvas = $('#gl'), lblCanvas = $('#labels'), lctx = lblCanvas.getContext('2d');
  const renderer = new THREE.WebGLRenderer({ canvas: glCanvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; renderer.shadowMap.autoUpdate = false;
  const DPR = Math.min(window.devicePixelRatio || 1, +Q.get('pr') || 3), PR_MOVE = Math.min(DPR, 2);
  let pr = DPR, vw = 1, vh = 1;
  const scene = new THREE.Scene(); scene.fog = new THREE.Fog(0xffffff, 100, 1000);
  const camera = new THREE.PerspectiveCamera(30, 1, 1, 10000), probe = camera.clone();
  const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1), key = new THREE.DirectionalLight(0xffffff, 1);
  key.castShadow = true; key.shadow.mapSize.set(coarse ? 2048 : 4096, coarse ? 2048 : 4096); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.6;
  scene.add(hemi, key, key.target);
  // everything that stands on the land hangs from one group: its heights are stretched as the map zooms out (see updateScene)
  const land = new THREE.Group(); scene.add(land); let vex = 1;

  const C = new THREE.Color(), col = hex => { C.set(hex); return [C.r, C.g, C.b]; };
  const mixc = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

  // ---------- build ----------
  const world = T.build(), tiles = world.tiles, ground = (x, z) => T.heightAt(tiles, x, z);
  const bySlug = Object.fromEntries(tiles.map(t => [t.slug, t]));
  function meshOf(S, mat) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(S.pos), 3)); g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(S.nor), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(S.pos.length), 3)); g.setIndex(new THREE.BufferAttribute(new Uint32Array(S.idx), 1));
    g.computeBoundingSphere(); g.computeBoundingBox(); return new THREE.Mesh(g, mat);
  }
  const tileMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0 }), landMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0, roughness: 0.95 });
  const tileMesh = meshOf(world.mesh, tileMat); tileMesh.castShadow = tileMesh.receiveShadow = true; land.add(tileMesh);
  const tilePos = tileMesh.geometry.attributes.position, tileCol = tileMesh.geometry.attributes.color, baseY = new Float32Array(world.mesh.n); for (let i = 0; i < world.mesh.n; i++) baseY[i] = world.mesh.pos[i * 3 + 1];
  const landMesh = meshOf(world.land, landMat); landMesh.receiveShadow = true; land.add(landMesh);
  // far land: the Central Valley east of the counties and the desert around the Strip, one flat sheet
  const farMat = new THREE.MeshStandardMaterial({ metalness: 0, roughness: 0.95 });
  { const [x0, z0, x1, z1] = world.farLand, g = new THREE.BufferGeometry(), y = T.LAND_TOP - 0.03, P = [], N = [], I = [];
    // east of the counties as the app draws it, and (the tilted view sees past the 2D canvas) the land north, north-east and south of them, roughed in
    const sheets = [[[x0, z0], [x0, z1], [x1 + 3000, z1], [x1 + 3000, z0]], [[-262, -4000], [-262, 75], [x0 + 5, 75], [x0 + 5, -4000]], [[780, 75], [780, 440], [x0 + 5, 440], [x0 + 5, 75]],
      [[486, 1373], [560, 1426], [640, 1470], [690, 1482], [750, 1481], [800, 1540], [815, 1600], [790, 1680], [760, 1720], [800, 1800], [900, 2100], [x0 + 5, 2500], [x0 + 5, 1373]]];
    for (const poly of sheets) { const k = P.length / 3, f = THREE.ShapeUtils.triangulateShape(poly.map(p => new THREE.Vector2(p[0], p[1])), []); for (const p of poly) { P.push(p[0], y, p[1]); N.push(0, 1, 0); }
      for (const t of f) { const a = poly[t[0]], b2 = poly[t[1]], c = poly[t[2]], cr = (b2[0] - a[0]) * (c[1] - a[1]) - (b2[1] - a[1]) * (c[0] - a[0]); if (cr > 0) I.push(k + t[0], k + t[2], k + t[1]); else I.push(k + t[0], k + t[1], k + t[2]); } }
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3)); g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(N), 3)); g.setIndex(I);
    const m = new THREE.Mesh(g, farMat); m.receiveShadow = true; land.add(m); }
  // inland water
  const inlandMat = new THREE.MeshStandardMaterial({ metalness: 0, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(world.inland.pos), 3)); g.setIndex(new THREE.BufferAttribute(new Uint32Array(world.inland.idx), 1)); g.computeVertexNormals(); const m = new THREE.Mesh(g, inlandMat); m.receiveShadow = true; land.add(m); }
  // the sea: one sheet, textured over the map with a soft depth gradient along every shore
  const [bx0, bz0, bx1, bz1] = [world.bounds[0] - 70, world.bounds[1] - 70, world.bounds[2] + 70, world.bounds[3] + 70];
  const wsc = Math.min(1.4, 2048 / (bz1 - bz0)), wcv = document.createElement('canvas'); wcv.width = Math.round((bx1 - bx0) * wsc); wcv.height = Math.round((bz1 - bz0) * wsc);
  const waterTex = new THREE.CanvasTexture(wcv); waterTex.colorSpace = THREE.SRGBColorSpace; waterTex.anisotropy = 4; waterTex.wrapS = waterTex.wrapT = THREE.ClampToEdgeWrapping;
  const waterMat = new THREE.MeshStandardMaterial({ map: waterTex });
  { const S = 16000, cx = 500, cz = 750, g = new THREE.BufferGeometry(), P = [cx - S, 0, cz - S, cx - S, 0, cz + S, cx + S, 0, cz + S, cx + S, 0, cz - S], uv = [];
    for (let i = 0; i < 4; i++) uv.push((P[i * 3] - bx0) / (bx1 - bx0), 1 - (P[i * 3 + 2] - bz0) / (bz1 - bz0));
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3)); g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), 3)); g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2)); g.setIndex([0, 1, 2, 0, 2, 3]);
    const m = new THREE.Mesh(g, waterMat); m.receiveShadow = false; scene.add(m); }
  function paintWater(L) {
    const c = wcv.getContext('2d'), W = wcv.width, H = wcv.height;
    // depth: the open ocean deep, lightening towards every shore (wide soft strokes of the bay's colour), so the bay itself,
    // never far from a shore, stays light; then the shallows along the shore
    c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.fillStyle = L.deep || L.water; c.fillRect(0, 0, W, H);
    c.setTransform(wsc, 0, 0, wsc, -bx0 * wsc, -bz0 * wsc); c.lineJoin = c.lineCap = 'round';
    const path = new Path2D(); for (const l of world.shore) l.forEach((p, k) => k ? path.lineTo(p[0], p[1]) : path.moveTo(p[0], p[1]));
    if (L.deep) { c.strokeStyle = L.water; c.filter = 'blur(18px)'; for (const w of [300, 230, 170, 120, 84, 56, 34]) { c.globalAlpha = 0.17; c.lineWidth = w; c.stroke(path); } c.filter = 'none'; }
    c.strokeStyle = L.shallow;
    for (const [w, a] of [[44, .05], [30, .07], [19, .1], [11, .14], [6, .2], [2.6, .3]]) { c.globalAlpha = Math.min(1, a * L.shore); c.lineWidth = w; c.stroke(path); }
    if (L.rim) { c.globalAlpha = 0.55; c.strokeStyle = L.rim; c.lineWidth = 1.1; c.stroke(path); }
    // soft shadows painted on the water instead of the shadow map (which would be coarse and crawl this far out): a contact
    // shade along the shore on the side away from the light, and each bridge deck's shadow, offset by its height
    { const az = L.key.az * Math.PI / 180, el = L.key.el * Math.PI / 180, ox = -Math.sin(az) / Math.tan(el), oz = Math.cos(az) / Math.tan(el);
      c.save(); c.filter = 'blur(1.4px)'; c.strokeStyle = L.cast || '#1a2430'; c.globalAlpha = L.castA != null ? L.castA : 0.2; c.lineWidth = 1.4;
      c.translate(ox * 0.6, oz * 0.6); c.stroke(path); c.translate(-ox * 0.6, -oz * 0.6);
      c.globalAlpha = (L.castA != null ? L.castA : 0.2) * 2.2; c.lineWidth = 0.6; c.filter = 'blur(0.8px)';
      for (const f of bridges.list) { c.beginPath(); for (let i = 0; i <= 48; i++) { const q = f.P(f.L * i / 48, 0, f.deck(f.L * i / 48)), y = Math.max(0, q[1]); if (i) c.lineTo(q[0] + ox * y, q[2] + oz * y); else c.moveTo(q[0] + ox * y, q[2] + oz * y); } c.stroke(); }
      c.restore(); }
    // the open sea beyond the map: fade the shore glow out towards the edge of the sheet
    c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; const m = 120;
    const edge = L.deep || L.water; for (const [x0, y0, x1, y1, r] of [[0, 0, 0, m, [0, 0, W, m]], [0, H, 0, H - m, [0, H - m, W, m]], [0, 0, m, 0, [0, 0, m, H]], [W, 0, W - m, 0, [W - m, 0, m, H]]]) { const g = c.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, edge); g.addColorStop(1, edge + '00'); c.fillStyle = g; c.fillRect(r[0], r[1], r[2], r[3]); }
    waterTex.needsUpdate = true;
  }

  // everything built: one material, vertex colours, windows that glow at night
  const winTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'), R = (() => { let s = 12345; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
    g.fillStyle = '#000'; g.fillRect(0, 0, 128, 128);
    // lit windows as short runs along a floor (not a checkerboard), most of the building dark, a few cool-white offices
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { const r = R(); if (r < 0.62) continue; const v = 140 + Math.floor(R() * 90); g.fillStyle = r > 0.92 ? `rgb(${v},${v},${Math.min(255, v + 25)})` : `rgb(${v},${Math.floor(v * 0.8)},${Math.floor(v * 0.5)})`; g.fillRect(x * 16 + 1, y * 16 + 7, 14, 4); }
    g.fillStyle = '#fff'; g.fillRect(0, 0, 16, 16); // the first cell: solid light
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
  })();
  const paneTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#fff'; for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) g.fillRect(x * 8 + 1.5, y * 8 + 2, 5, 4.5); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t; })();
  const paneU = { uPane: { value: paneTex }, uPaneK: { value: 0.16 }, uAmb: { value: 0 } };
  const builtMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0, emissive: 0xffffff, emissiveMap: winTex, emissiveIntensity: 0 });
  builtMat.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float glow;\nvarying float vGlow;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = glow;');
    sh.uniforms.uPane = paneU.uPane; sh.uniforms.uPaneK = paneU.uPaneK; sh.uniforms.uAmb = paneU.uAmb;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vGlow;\nuniform sampler2D uPane;\nuniform float uPaneK;\nuniform float uAmb;').replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vGlow < 0.0 ? -vGlow * vColor.rgb * 2.4 : vec3(vGlow);\ntotalEmissiveRadiance += vColor.rgb * uAmb;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= 1.0 - uPaneK * step(0.01, vGlow) * texture2D(uPane, vEmissiveMapUv).g;');
  };
  const built = []; // { mesh, mat (material index per vertex), names }
  const addBuilt = (o, shadow = true) => { const m = new THREE.Mesh(o.geometry, builtMat); m.castShadow = shadow; m.receiveShadow = true; land.add(m); built.push({ mesh: m, mat: o.mat, names: o.names, shade: o.shade }); return m; };
  const bridges = MD.bridges(ground); addBuilt(bridges);
  const icons = MD.icons(ground); icons.forEach(ic => { ic.mesh = addBuilt(ic); ic.mesh.position.set(ic.x, ic.y, ic.z); });
  let cityMesh = null, cityLights = [];
  function buildCity(vegas) { const c = MD.city(tiles, ground, vegas); cityMesh = addBuilt(c); cityLights = c.lights; }

  // flags and pins: instanced, sized to hold on screen
  const flagG = MD.flag(), pinG = MD.pin(), markMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0, roughness: 0.6 });
  let flags = null, pins = null, pinDots = null, seedSpots = [], seedHoods = {};
  function buildMarks(seed) {
    const ex = (seed && seed['sbs-explored']) || {}; seedHoods = ex.hoods || {};
    const walked = Object.keys(seedHoods).map(s => bySlug[s]).filter(Boolean); walked.forEach(t => { t.walked = seedHoods[t.slug]; });
    flags = new THREE.InstancedMesh(flagG.geometry, markMat, Math.max(1, walked.length)); flags.count = walked.length; flags.castShadow = true; flags.userData.tiles = walked; flags.frustumCulled = false; land.add(flags);
    built.push({ mesh: flags, mat: flagG.mat, names: flagG.names, shade: flagG.shade });
    seedSpots = Object.keys(ex.spots || {}).map(id => { const s = ex.spots[id], p = proj([s.lon, s.lat]); return Object.assign({ id, x: p[0], z: p[1], y: ground(p[0], p[1]) }, s); });
    // the pin's body takes its spot's colour, its dot stays white: two instanced meshes from the two materials of one model
    const split = name => { const g = new THREE.BufferGeometry(), keep = []; const mi = pinG.names.indexOf(name); for (let i = 0; i < pinG.mat.length; i++) if (pinG.mat[i] === mi) keep.push(i); for (const a of ['position', 'normal']) { const src = pinG.geometry.attributes[a].array, out = new Float32Array(keep.length * 3); keep.forEach((v, k) => { out[k * 3] = src[v * 3]; out[k * 3 + 1] = src[v * 3 + 1]; out[k * 3 + 2] = src[v * 3 + 2]; }); g.setAttribute(a, new THREE.BufferAttribute(out, 3)); } return g; };
    const pm = new THREE.MeshStandardMaterial({ metalness: 0, roughness: 0.45 }), n = Math.max(1, seedSpots.length);
    pins = new THREE.InstancedMesh(split('pin'), pm, n); pinDots = new THREE.InstancedMesh(split('pinDot'), new THREE.MeshStandardMaterial({ metalness: 0, roughness: 0.5, color: 0xffffff }), n);
    for (const m of [pins, pinDots]) { m.count = seedSpots.length; m.castShadow = m === pins; m.frustumCulled = false; land.add(m); }
  }

  // night lights: soft additive points (bridge cables, beacons, the Strip) and a scatter of city lights over the places
  const lightMat = new THREE.ShaderMaterial({
    uniforms: { uScale: { value: 1 }, uMin: { value: 1 }, uGain: { value: 1 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: 'attribute float size; attribute vec3 tint; varying vec3 vTint; varying float vFade; uniform float uScale; uniform float uMin;\nvoid main(){ vTint = tint; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; float px = size * uScale / max(0.001, -mv.z); vFade = clamp(px / uMin, 0.25, 1.0); gl_PointSize = max(px, uMin); }',
    fragmentShader: 'varying vec3 vTint; varying float vFade; uniform float uGain;\nvoid main(){ float r = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, r); a = a * a * (0.35 + 0.65 * smoothstep(0.55, 0.0, r)); gl_FragColor = vec4(vTint * a * vFade * uGain, 1.0); }',
  });
  const lightSets = [];
  function pointsOf(list, parent) {
    if (!list.length) return null; const g = new THREE.BufferGeometry(), P = new Float32Array(list.length * 3), S = new Float32Array(list.length), Tt = new Float32Array(list.length * 3);
    list.forEach((l, i) => { P[i * 3] = l.x; P[i * 3 + 1] = l.y; P[i * 3 + 2] = l.z; S[i] = l.size * 0.34; const c = col(LIGHTS[l.kind] || l.kind); Tt[i * 3] = c[0]; Tt[i * 3 + 1] = c[1]; Tt[i * 3 + 2] = c[2]; });
    g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('size', new THREE.BufferAttribute(S, 1)); g.setAttribute('tint', new THREE.BufferAttribute(Tt, 3)); g.computeBoundingSphere();
    const pts = new THREE.Points(g, lightMat); pts.visible = false; pts.renderOrder = 5; (parent || land).add(pts); lightSets.push(pts); return pts;
  }
  let nightBuilt = false, beam = null;
  function buildNight() {
    if (nightBuilt) return; nightBuilt = true;
    pointsOf(bridges.lights); pointsOf(cityLights); icons.forEach(ic => pointsOf(ic.lights, ic.mesh));
    // a scatter of small warm lights over every place, denser where it is busy
    const R = (() => { let s = 4242; return () => (s = (s * 48271) % 2147483647) / 2147483647; })(), dens = { buzz: 1, sun: 0.55, fog: 0.5, hills: 0.4, water: 0.42, green: 0.07 }, list = [];
    for (const t of tiles) {
      // on a loose street grid, most crossings dark: reads as blocks of lit streets, not as stars
      const city = t.region === 'sf' || t.region === 'vegas', pitch = city ? 0.6 : 2.8, keep = (dens[t.vibe] || 0.4) * (city ? 0.22 : 0.12), b = t.bbox, ang = t.region === 'sf' ? 0.16 : 0.5, ca = Math.cos(ang), sa = Math.sin(ang);
      const cx = (b[0] + b[2]) / 2, cz = (b[1] + b[3]) / 2, rad = Math.hypot(b[2] - b[0], b[3] - b[1]) / 2, n = Math.ceil(rad / pitch);
      for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
        if (R() > keep) continue; const u = (i + (R() - 0.5) * 0.3) * pitch, v = (j + (R() - 0.5) * 0.3) * pitch, x = cx + u * ca - v * sa, z = cz + u * sa + v * ca;
        if (x < b[0] || x > b[2] || z < b[1] || z > b[3] || !t.parts.some(p => T.inRings(p.rings, x, z))) continue;
        const k = R(); list.push({ x, y: T.topAt(t, x, z) + 0.06, z, kind: k > 0.93 ? '#cfe2ff' : k > 0.55 ? '#ffd39a' : '#ffb866', size: (city ? 0.24 : 0.8) * (0.7 + R() * 0.6) });
      }
    }
    pointsOf(list);
    // the Luxor's sky beam
    const lux = icons.find(i => i.id === 'luxor');
    if (lux) { const g = new THREE.CylinderGeometry(0.28, 0.05, 30, 10, 1, true); g.translate(0, lux.h + 15, 0); beam = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xbcd0ff, transparent: true, opacity: 0.09, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false })); beam.visible = false; lux.mesh.add(beam); }
  }

  // ---------- colours ----------
  let selected = null, lift = 0, liftFrom = 0, liftTo = 0, liftT0 = 0, liftTile = null;
  function paintTile(t, L) {
    const S = world.mesh, base = col(L.vibe[t.tone] || L.vibe['v-fog']), hi = col(L.lift), acc = col(L.accent), sel = t === selected;
    const plateau = T.variant === 'plateau', side = col(L.side || '#000000'), top = mixc(base, hi, clamp((t.top - T.BASE) / 4, 0, 1) * L.liftK * 2.2 + (sel ? 0.1 : 0));
    for (let v = t.v0; v < t.v1; v++) {
      const k = S.kind[v], sh = S.shade[v]; let c;
      if (plateau) {
        if (sel && k >= 1) c = k === 1 ? mixc(acc, hi, 0.15) : mixc(acc, side, 0.25);
        else if (k === 0) c = top;
        else if (k === 1) c = mixc(top, hi, L.bevelK || 0);
        else c = mixc(base, side, L.sideK || 0);
      }
      else if (sel && k >= 1) c = k === 3 ? mixc(acc, [0, 0, 0], 0.35) : acc;
      else if (k === 0) c = mixc(base, hi, clamp((baseY[v] - T.BASE) / 6.5, 0, 1) * L.liftK * 2.2 + (sel ? 0.1 : 0));
      else c = base;
      tileCol.array[v * 3] = c[0] * sh; tileCol.array[v * 3 + 1] = c[1] * sh; tileCol.array[v * 3 + 2] = c[2] * sh;
    }
  }
  function paintBuilt(L) {
    const pal = BUILT[look];
    for (const b of built) {
      const cols = b.names.map(n => col(pal[n] || '#ff00ff')), a = b.mesh.geometry.attributes.color;
      for (let i = 0; i < b.mat.length; i++) { const c = cols[b.mat[i]], k = b.shade ? b.shade[i] : 1; a.array[i * 3] = c[0] * k; a.array[i * 3 + 1] = c[1] * k; a.array[i * 3 + 2] = c[2] * k; }
      a.needsUpdate = true;
    }
  }
  function applyLook(name) {
    look = name; const L = LOOKS[look]; document.body.dataset.look = look;
    document.querySelectorAll('#looks button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.look === look)));
    renderer.setClearColor(L.bg, 1); scene.fog.color.set(L.bg);
    for (const t of tiles) paintTile(t, L); tileCol.needsUpdate = true;
    { const S = world.land, a = landMesh.geometry.attributes.color, c = col(L.land); for (let v = 0; v < S.n; v++) { a.array[v * 3] = c[0] * S.shade[v]; a.array[v * 3 + 1] = c[1] * S.shade[v]; a.array[v * 3 + 2] = c[2] * S.shade[v]; } a.needsUpdate = true; }
    farMat.color.set(L.land); inlandMat.color.set(L.inland); paintWater(L);
    tileMat.roughness = L.tile.rough; builtMat.roughness = L.built.rough; waterMat.roughness = L.waterMat.rough; waterMat.metalness = L.waterMat.metal; builtMat.emissiveIntensity = L.glow; paneU.uPaneK.value = L.pane; paneU.uAmb.value = L.amb || 0;
    hemi.color.set(L.hemi.sky); hemi.groundColor.set(L.hemi.ground); hemi.intensity = L.hemi.i; key.color.set(L.key.c); key.intensity = L.key.i; key.shadow.radius = L.shadowR;
    paintBuilt(L);
    if (pins) seedSpots.forEach((s, i) => { C.set(s.status === 'want' ? L.want : (L.kinds[s.kind] || L.kinds.other)); pins.setColorAt(i, C); }), pins.instanceColor && (pins.instanceColor.needsUpdate = true);
    if (L.lights) buildNight(); lightSets.forEach(p => { p.visible = L.lights; }); if (beam) beam.visible = L.lights;
    shadowDirty = true; invalidate();
  }

  // ---------- camera ----------
  const FOCUS_Y = 0.6, PH_MIN = 0.03, PH_MAX = 1.27, D_MIN = 12, VEX_FAR = T.variant === 'plateau' ? 1.55 : 2.3;
  // the tilt follows the zoom: nearly straight down over the whole bay (it reads like the app's atlas), tilting as you come in;
  // a tilt of your own is kept as an offset, which shrinks as you zoom out
  let D_FAR = 1500;
  const phAuto = d => lerp(1.0, 0.16, smooth((Math.log(d) - Math.log(110)) / (Math.log(D_FAR) - Math.log(110))));
  const phMax = d => Math.min(PH_MAX, phAuto(d) + 0.45);
  function setD(st, d) { const a0 = phAuto(st.d), off = st.ph - a0; st.d = clamp(d, D_MIN, AREAS[area].dMax); const a1 = phAuto(st.d); st.ph = clamp(a1 + off * Math.min(1, a1 / a0), PH_MIN, phMax(st.d)); }
  const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const AREAS = { bay: { box: [-60, -40, 1120, 1560], dMax: 4300 }, vegas: null };
  let area = 'bay';
  const cur = { x: 500, z: 800, d: 2500, th: 0, ph: 0.85 }, goal = Object.assign({}, cur);
  function place(st, cam) {
    const sp = Math.sin(st.ph), cp = Math.cos(st.ph);
    cam.position.set(st.x + st.d * sp * Math.sin(st.th), FOCUS_Y + st.d * cp, st.z + st.d * sp * Math.cos(st.th)); cam.up.set(0, 1, 0); cam.lookAt(st.x, FOCUS_Y, st.z);
    cam.near = Math.max(0.5, st.d * 0.05); cam.far = st.d * 14 + 600; cam.aspect = vw / vh; cam.updateProjectionMatrix(); cam.updateMatrixWorld(true);
  }
  const ray = new THREE.Raycaster(), v2 = new THREE.Vector2(), v3 = new THREE.Vector3(), planeY = new THREE.Plane(new THREE.Vector3(0, 1, 0), -FOCUS_Y);
  // the ground point under a screen point for a camera state (null above the horizon)
  function groundUnder(st, sx, sy) { place(st, probe); v2.set(sx / vw * 2 - 1, 1 - sy / vh * 2); ray.setFromCamera(v2, probe); const p = ray.ray.intersectPlane(planeY, v3); if (!p) return null; if (p.distanceTo(probe.position) > st.d * 9) return null; return [p.x, p.z]; }
  function limit(st) {
    const A = AREAS[area]; st.d = clamp(st.d, D_MIN, A.dMax); st.ph = clamp(st.ph, PH_MIN, phMax(st.d));
    st.x = clamp(st.x, A.box[0], A.box[2]); st.z = clamp(st.z, A.box[1], A.box[3]); return st;
  }
  const insets = () => ({ t: 62, b: vw < 880 ? 64 : 30, l: 10, r: 10 });
  // the camera state that frames a map box (with the heights standing in it) at a heading and tilt
  function frame(box, th, ph, hgt = 3, pad = 1, ins = insets()) {
    const st = { x: (box[0] + box[2]) / 2, z: (box[1] + box[3]) / 2, d: 100, th, ph }, pts = [];
    for (const x of [box[0], box[2]]) for (const z of [box[1], box[3]]) for (const y of [FOCUS_Y, hgt]) pts.push([x, y, z]);
    const cx = (ins.l + vw - ins.r) / 2, cy = (ins.t + vh - ins.b) / 2, hw = (vw - ins.l - ins.r) / 2, hh = (vh - ins.t - ins.b) / 2;
    const ext = () => { place(st, probe); let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, bad = false; for (const p of pts) { v3.set(p[0], p[1], p[2]).project(probe); if (v3.z > 1) bad = true; const sx = (v3.x + 1) / 2 * vw, sy = (1 - v3.y) / 2 * vh; x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy); } return { x0, x1, y0, y1, bad }; };
    for (let it = 0; it < 4; it++) {
      let lo = 2, hi = 20000; for (let k = 0; k < 26; k++) { st.d = Math.sqrt(lo * hi); const e = ext(); if (e.bad || (e.x1 - e.x0) / 2 > hw || (e.y1 - e.y0) / 2 > hh) lo = st.d; else hi = st.d; } st.d = hi;
      const e = ext(), a = groundUnder(st, (e.x0 + e.x1) / 2, (e.y0 + e.y1) / 2), b = groundUnder(st, cx, cy); if (a && b) { st.x += a[0] - b[0]; st.z += a[1] - b[1]; }
    }
    st.d *= pad; return st;
  }
  let fly = null, vel = [0, 0], moving = false, userTouched = false;
  function flyTo(to, ms) {
    to = limit(Object.assign({}, to));
    if (reduceMotion || ms === 0) { Object.assign(cur, to); Object.assign(goal, to); fly = null; invalidate(); return; }
    const from = Object.assign({}, cur); let dth = (to.th - from.th) % (Math.PI * 2); if (dth > Math.PI) dth -= Math.PI * 2; if (dth < -Math.PI) dth += Math.PI * 2;
    const dist = Math.hypot(to.x - from.x, to.z - from.z), big = Math.max(from.d, to.d), bump = Math.max(0, Math.log(dist * 1.05 / big)) * 0.85;
    const dur = ms || clamp(650 + 420 * (Math.abs(Math.log(to.d / from.d)) + Math.min(2.5, dist / big)), 700, 2400);
    fly = { from, to, dth, bump, t0: performance.now(), dur }; vel = [0, 0]; invalidate();
  }
  function stepCamera(now, dt) {
    if (fly) {
      const t = clamp((now - fly.t0) / fly.dur, 0, 1), e = ease(t), f = fly.from, to = fly.to;
      cur.x = lerp(f.x, to.x, e); cur.z = lerp(f.z, to.z, e); cur.th = f.th + fly.dth * e; cur.ph = lerp(f.ph, to.ph, e);
      cur.d = Math.exp(lerp(Math.log(f.d), Math.log(to.d), e) + fly.bump * Math.sin(Math.PI * e));
      Object.assign(goal, cur); if (t >= 1) { Object.assign(goal, to); fly = null; }
      return true;
    }
    if (vel[0] || vel[1]) { goal.x += vel[0] * dt; goal.z += vel[1] * dt; const k = Math.exp(-dt / 0.3); vel[0] *= k; vel[1] *= k; if (Math.hypot(vel[0], vel[1]) < goal.d * 0.004) vel = [0, 0]; }
    limit(goal);
    const k = 1 - Math.exp(-dt / 0.075); let dth = goal.th - cur.th;
    cur.x += (goal.x - cur.x) * k; cur.z += (goal.z - cur.z) * k; cur.th += dth * k; cur.ph += (goal.ph - cur.ph) * k; cur.d = Math.exp(Math.log(cur.d) + (Math.log(goal.d) - Math.log(cur.d)) * k);
    const rest = Math.abs(goal.x - cur.x) + Math.abs(goal.z - cur.z) < cur.d * 0.0004 && Math.abs(dth) < 0.0006 && Math.abs(goal.ph - cur.ph) < 0.0006 && Math.abs(Math.log(goal.d / cur.d)) < 0.0006 && !vel[0] && !vel[1];
    if (rest) { Object.assign(cur, goal); return false; }
    return true;
  }
  function zoomAt(sx, sy, factor) { const a = groundUnder(goal, sx, sy); setD(goal, goal.d * factor); const b = groundUnder(goal, sx, sy); if (a && b) { goal.x += a[0] - b[0]; goal.z += a[1] - b[1]; } }

  // ---------- gestures: one finger pans, two pinch, turn and tilt; mouse drags pan, right or ctrl drag orbits, the wheel zooms ----------
  const ptr = new Map(); let grab = null, g2 = null, trail = [], downAt = null, orbit = false;
  const stop = () => { fly = null; vel = [0, 0]; userTouched = true; $('#hint').classList.add('off'); };
  const two = () => { const [a, b] = [...ptr.values()]; return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, s: Math.hypot(b.x - a.x, b.y - a.y) || 1, a: Math.atan2(b.y - a.y, b.x - a.x) }; };
  glCanvas.addEventListener('contextmenu', e => e.preventDefault());
  glCanvas.addEventListener('pointerdown', e => {
    try { glCanvas.setPointerCapture(e.pointerId); } catch (err) {} ptr.set(e.pointerId, { x: e.clientX, y: e.clientY }); stop();
    if (ptr.size === 1) { orbit = e.pointerType === 'mouse' && (e.button === 2 || e.button === 1 || e.ctrlKey || e.shiftKey); grab = orbit ? null : groundUnder(goal, e.clientX, e.clientY); trail = []; downAt = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false }; glCanvas.classList.add('grabbing'); }
    else if (ptr.size === 2) { const q = two(); g2 = Object.assign({ mode: null, s0: q.s, a0: q.a, cx0: q.cx, cy0: q.cy, turn: false }, q); grab = null; if (downAt) downAt.moved = true; }
    invalidate();
  });
  glCanvas.addEventListener('pointermove', e => {
    const p = ptr.get(e.pointerId); if (!p) return; const px = p.x, py = p.y; p.x = e.clientX; p.y = e.clientY;
    if (ptr.size === 1) {
      if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) > (e.pointerType === 'mouse' ? 4 : 9)) downAt.moved = true;
      if (orbit) { goal.th -= (e.clientX - px) * 0.0055; goal.ph = clamp(goal.ph - (e.clientY - py) * 0.0045, PH_MIN, phMax(goal.d)); }
      else if (grab && downAt && downAt.moved) { const q = groundUnder(goal, e.clientX, e.clientY); if (q) { goal.x += grab[0] - q[0]; goal.z += grab[1] - q[1]; limit(goal); trail.push([performance.now(), goal.x, goal.z]); if (trail.length > 6) trail.shift(); } }
    } else if (ptr.size === 2 && g2) {
      const q = two(), ds = Math.abs(Math.log(q.s / g2.s0)); let da = q.a - g2.a0; da = Math.atan2(Math.sin(da), Math.cos(da));
      const dx = q.cx - g2.cx0, dy = q.cy - g2.cy0;
      if (!g2.mode) {
        if (ds > 0.07 || Math.abs(da) > 0.11) g2.mode = 'pinch';
        else if (Math.abs(dy) > 12 && Math.abs(dy) > 2 * Math.abs(dx) && Math.abs(Math.sin(q.a)) < 0.7) g2.mode = 'tilt';
        else if (Math.hypot(dx, dy) > 18) g2.mode = 'pinch';
      }
      if (g2.mode === 'tilt') goal.ph = clamp(goal.ph - (q.cy - g2.cy) * 0.0065, PH_MIN, phMax(goal.d));
      else if (g2.mode === 'pinch') {
        const before = groundUnder(goal, g2.cx, g2.cy);
        setD(goal, goal.d * g2.s / q.s);
        if (!g2.turn && Math.abs(da) > 0.13) { g2.turn = true; } else if (g2.turn) { let d = q.a - g2.a; d = Math.atan2(Math.sin(d), Math.cos(d)); goal.th += d; }
        const after = groundUnder(goal, q.cx, q.cy); if (before && after) { goal.x += before[0] - after[0]; goal.z += before[1] - after[1]; }
      }
      g2.cx = q.cx; g2.cy = q.cy; g2.s = q.s; g2.a = q.a;
    }
    invalidate();
  });
  const up = e => {
    if (!ptr.has(e.pointerId)) return; ptr.delete(e.pointerId);
    if (ptr.size === 1) { const [q] = [...ptr.values()]; grab = groundUnder(goal, q.x, q.y); g2 = null; trail = []; }
    if (ptr.size === 0) {
      glCanvas.classList.remove('grabbing'); g2 = null;
      if (downAt && !downAt.moved && performance.now() - downAt.t < 500 && e.type === 'pointerup') tap(e.clientX, e.clientY);
      else if (trail.length >= 2) { const a = trail[0], b = trail[trail.length - 1], dt = (b[0] - a[0]) / 1000; if (dt > 0.01 && performance.now() - b[0] < 80) { vel = [(b[1] - a[1]) / dt, (b[2] - a[2]) / dt]; const sp = Math.hypot(vel[0], vel[1]), mx = goal.d * 3; if (sp > mx) { vel[0] *= mx / sp; vel[1] *= mx / sp; } } }
      downAt = null; grab = null;
    }
    invalidate();
  };
  glCanvas.addEventListener('pointerup', up); glCanvas.addEventListener('pointercancel', up);
  glCanvas.addEventListener('wheel', e => { e.preventDefault(); stop(); const dy = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY; zoomAt(e.clientX, e.clientY, Math.exp(clamp(dy, -160, 160) * (e.ctrlKey ? 0.011 : 0.0016))); invalidate(); }, { passive: false });
  glCanvas.addEventListener('dblclick', e => { stop(); const st = Object.assign({}, goal), a = groundUnder(st, e.clientX, e.clientY); setD(st, st.d * 0.5); const b = groundUnder(st, e.clientX, e.clientY); if (a && b) { st.x += a[0] - b[0]; st.z += a[1] - b[1]; } flyTo(st, 450); });
  window.addEventListener('keydown', e => { const k = e.key; if (k === 'Escape') select(null); else if (k === '+' || k === '=') { stop(); setD(goal, goal.d * 0.8); } else if (k === '-') { stop(); setD(goal, goal.d * 1.25); } else if (k === 'ArrowLeft') { stop(); goal.th -= 0.2; } else if (k === 'ArrowRight') { stop(); goal.th += 0.2; } else if (k === 'ArrowUp') { stop(); goal.ph += 0.1; } else if (k === 'ArrowDown') { stop(); goal.ph -= 0.1; } else return; invalidate(); });

  // ---------- the tap: a place rises, its edge takes the accent, the camera eases to it, a card names it ----------
  const card = $('#card'), REG = window.REGIONS, VIBES = window.VIBES;
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const niceDate = iso => { const d = new Date(String(iso).slice(0, 10) + 'T12:00:00'); return isNaN(d) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); };
  function screenOf(x, y, z) { v3.set(x, y * vex, z).project(camera); return [(v3.x + 1) / 2 * vw, (1 - v3.y) / 2 * vh, v3.z]; }
  function tap(sx, sy) {
    // a pin first (its head is small: a generous radius), then the place under the finger
    let best = null, bd = 26; for (const s of seedSpots) { const p = screenOf(s.x, s.y + (s.h || 1) * 0.75 / vex, s.z), d = Math.hypot(p[0] - sx, p[1] - sy); if (p[2] < 1 && d < bd) { bd = d; best = s; } }
    if (best) return showSpot(best);
    v2.set(sx / vw * 2 - 1, 1 - sy / vh * 2); ray.setFromCamera(v2, camera); const hit = ray.intersectObject(tileMesh, false)[0];
    if (!hit) return select(null);
    const k = hit.faceIndex * 3; let lo = 0, hi = tiles.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (tiles[m].i1 <= k) lo = m + 1; else hi = m; }
    select(tiles[lo] === selected ? null : tiles[lo]);
  }
  function showCard(html) { card.querySelector('h2').innerHTML = html.h; card.querySelector('.sub').innerHTML = html.sub; card.querySelector('p').textContent = html.p || ''; card.classList.add('on'); }
  function showSpot(s) {
    select(null); const L = LOOKS[look];
    showCard({ h: esc(s.name), sub: `<span><i style="--c:${s.status === 'want' ? L.want : (L.kinds[s.kind] || L.kinds.other)}"></i><b>${esc((s.kind || 'spot').replace(/^./, c => c.toUpperCase()))}</b></span><span>${esc(s.sub || '')}${s.sub ? ', ' : ''}${esc(s.hood || '')}</span>${s.status === 'want' ? '<span class="walked">Want to go</span>' : s.rating ? `<span class="walked">${'★'.repeat(s.rating)}</span>` : ''}`, p: s.note || '' });
    const st = Object.assign({}, goal, { x: s.x, z: s.z, d: Math.min(goal.d, 70) }); flyTo(st);
  }
  function select(t, o = {}) {
    if (t === selected) return; const prev = selected; selected = t;
    const L = LOOKS[look]; if (prev) paintTile(prev, L); if (t) paintTile(t, L); tileCol.needsUpdate = true;
    if (t) { if (liftTile && liftTile !== t) setLift(liftTile, 0); liftTile = t; liftFrom = 0; liftTo = 1; liftT0 = performance.now(); }
    else { liftFrom = lift; liftTo = 0; liftT0 = performance.now(); }
    if (!t) { card.classList.remove('on'); invalidate(); return; }
    const reg = REG[t.region] || {}, ft = Math.round(t.max * 3.28084).toLocaleString();
    showCard({ h: esc(t.name), sub: `<span><i style="--c:${L.vibe[t.tone]}"></i><b>${esc((VIBES[t.vibe] || {}).label || '')}</b></span><span>${esc(reg.label || '')}</span><span><b>${ft} ft</b> high point</span>${t.walked ? `<span class="walked">⚑ Walked ${esc(niceDate(t.walked.at))}</span>` : ''}`, p: t.line });
    if (o.fly !== false) { const phone = vw < 880, st = frame(t.bbox, goal.th, clamp(goal.ph, 0.7, 1.05), t.peak + 1, 1.9, { t: 70, b: phone ? 230 : 40, l: phone ? 20 : 380, r: 20 }); st.d = clamp(st.d, 34, AREAS[area].dMax); flyTo(st, o.ms); }
    invalidate();
  }
  function setLift(t, h) { const S = world.mesh; for (let v = t.v0; v < t.v1; v++) if (S.kind[v] !== 3 && !(T.variant === 'plateau' && S.kind[v] === 4)) tilePos.array[v * 3 + 1] = baseY[v] + h; tilePos.addUpdateRange(t.v0 * 3, (t.v1 - t.v0) * 3); tilePos.needsUpdate = true; t.lift = h; shadowDirty = true; }
  card.querySelector('.x').addEventListener('click', () => select(null) || card.classList.remove('on'));

  // ---------- names: drawn on a canvas over the map, always facing the reader, never behind anything ----------
  const lblA = new Map(), lastDrawn = new Map(), widths = new Map(); let lblAnimating = false, lblLast = 0;
  const WATER_LBL = [['Pacific Ocean', -122.80, 37.35, 2600, 420], ['San Francisco Bay', -122.25, 37.63, 1500, 220], ['San Pablo Bay', -122.40, 38.06, 1500, 220], ['Golden Gate', -122.515, 37.812, 330, 60]].map(([t, lon, lat, far, near]) => ({ t: t.toUpperCase(), p: proj([lon, lat]), far, near }));
  const REGION_AT = { sf: [-122.445, 37.757], north: [-122.47, 38.2], east: [-122.06, 37.86], south: [-121.99, 37.265], penin: [-122.3, 37.49], marin: [-122.63, 37.99] };
  const REGION_LBL = Object.keys(window.GEO.regions).filter(r => r !== 'vegas').map(r => { const p = proj(REGION_AT[r]); return { id: 'r:' + r, t: (r === 'sf' ? 'San Francisco' : REG[r].label).toUpperCase(), p }; });
  const BRIDGE_LBL = [['Golden Gate Bridge', 'gg', 0.5, 4.2], ['Bay Bridge', 'bayWest', 0.5, 3.4]].map(([t, id, f, y]) => { const fr = bridges.frames[id]; return { id: 'b:' + id, t, x: lerp(fr.A[0], fr.B[0], f), z: lerp(fr.A[1], fr.B[1], f), y, n: fr.n }; });
  function measure(text, font, ls) { const k = font + '|' + ls + '|' + text; let w = widths.get(k); if (w === undefined) { lctx.font = font; if ('letterSpacing' in lctx) lctx.letterSpacing = ls || '0px'; w = lctx.measureText(text).width; widths.set(k, w); } return w; }
  // The app's label language (js/map.js): Figtree 600, a thin halo in the land's colour (the text drawn six times, offset by a
  // tenth of its size), place names in tracked capitals at the far zoom and in mixed case nearer, water names in wide-tracked
  // capitals with no halo. Names are placed in priority order and never on top of each other, a landmark, a flag or a pin; each
  // fades in and out; landmark names appear only close up.
  function haloText(text, x, y, size, color, halo) {
    if (halo) { const r = Math.max(0.9, size * 0.11); lctx.fillStyle = halo; for (let q = 0; q < 6; q++) { const a = q * Math.PI / 3; lctx.fillText(text, x + Math.cos(a) * r, y + Math.sin(a) * r); } }
    lctx.fillStyle = color; lctx.fillText(text, x, y);
  }
  let farNames = false;
  function drawLabels(now) {
    const L = LOOKS[look], dt = Math.min(0.1, (now - lblLast) / 1000); lblLast = now; const phone = vw < 880;
    lctx.setTransform(pr, 0, 0, pr, 0, 0); lctx.clearRect(0, 0, vw, vh); lctx.textAlign = 'center'; lctx.textBaseline = 'middle';
    const boxes = [], hits = b => boxes.some(o => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);
    const ppuAt = (x, y, z) => vh / (2 * Math.tan(camera.fov * Math.PI / 360) * Math.max(0.001, camera.position.distanceTo(v3.set(x, y * vex, z))));
    const want = new Map();
    const put = (id, text, sx, sy, o) => {
      const w = measure(text, o.font, o.ls), h = o.size * 1.2, gx = phone ? 4 : 2, b = [sx - w / 2 - gx, sy - h / 2 - 1, sx + w / 2 + gx, sy + h / 2 + 1];
      if (b[0] < 2 || b[2] > vw - 2 || b[1] < 0 || b[3] > vh) { if (!o.force) return false; }
      if (!o.force && hits(b)) return false; boxes.push(b); want.set(id, { text, sx, sy, o }); return true;
    };
    // the page's own controls
    boxes.push([0, 0, phone ? vw : 300, 58]); boxes.push([vw - 58, 52, vw, 104]); if (phone) boxes.push([vw / 2 - 135, vh - 68, vw / 2 + 135, vh]);
    if (card.classList.contains('on')) { const r = card.getBoundingClientRect(); boxes.push([r.left - 4, r.top - 6, r.right + 4, r.bottom + 4]); }
    // far names in capitals; the switch has some slack so names do not flicker between the two at the threshold
    farNames = area === 'bay' && (farNames ? cur.d > 330 : cur.d > 400);
    const fsz = phone ? 10.5 : 11.5, F = {
      far: `600 ${fsz}px ${SANS}`, near: `600 ${fsz + 1.5}px ${SANS}`, sel: `600 ${fsz + 2.5}px ${SANS}`, icon: `500 ${fsz}px ${SANS}`, region: `600 ${fsz + 1}px ${SANS}`, water: `500 ${phone ? 9.5 : 10.5}px ${SANS}`, bridge: `500 ${phone ? 9.5 : 10.5}px ${SANS}`,
    };
    // the landmarks themselves (always clear of names), and their names when close
    const icn = [];
    for (const ic of icons) {
      const s = ic.mesh.scale.x, a = screenOf(ic.x, ic.y, ic.z), b = screenOf(ic.x, ic.y + ic.h * s / vex, ic.z); if (a[2] > 1 || b[2] > 1) continue; const hpx = a[1] - b[1], wpx = ic.r * s * ppuAt(ic.x, ic.y, ic.z);
      if (hpx < 8) continue; const box = [Math.min(a[0], b[0]) - wpx * 0.55, b[1] - 2, Math.max(a[0], b[0]) + wpx * 0.55, a[1] + 2]; if (box[2] < 0 || box[0] > vw || box[3] < 0 || box[1] > vh) continue;
      boxes.push(box); icn.push([ic, hpx, b]);
    }
    // flags and pins
    if (flags) for (const t of flags.userData.tiles) { const y = t.top + (t.lift || 0), a = screenOf(t.cx, y, t.cy), b = screenOf(t.cx, y + (t.flagH || 1) * 1.12 / vex, t.cy); if (a[2] < 1) boxes.push([a[0] - 3, b[1] - 1, a[0] + Math.max(8, (a[1] - b[1]) * 0.6), a[1] + 2]); }
    for (const s of seedSpots) { const a = screenOf(s.x, s.y, s.z), b = screenOf(s.x, s.y + (s.h || 1) * 1.05 / vex, s.z); if (a[2] < 1) { const w = Math.max(5, (a[1] - b[1]) * 0.3); boxes.push([a[0] - w, b[1] - 1, a[0] + w, a[1] + 1]); } }
    if (selected) { const t = selected, p = screenOf(t.cx, t.top + (t.lift || 0), t.cy); if (p[2] < 1) put('t:' + t.i, t.name, p[0], p[1] + (t.walked ? 13 : 0), { font: F.sel, size: fsz + 2.5, color: L.label, halo: L.halo, force: true }); }
    for (const [ic, hpx, b] of icn) if (cur.d < 150 && hpx > 54) put('i:' + ic.id, ic.label, b[0], b[1] - 10, { font: F.icon, size: fsz, color: L.label2, halo: L.halo });
    // the regions, over the whole bay
    if (farNames && cur.d > 700) for (const r of REGION_LBL) { const p = screenOf(r.p[0], 0.5, r.p[1]); if (p[2] < 1) put(r.id, r.t, p[0], p[1], { font: F.region, size: fsz + 1, color: L.region, halo: L.halo, ls: '0.16em' }); }
    // places: the walked ones first, then by size; a name shows once its place is wide enough to carry it
    const cand = [], fnt = farNames ? F.far : F.near;
    for (const t of tiles) {
      if (t === selected) continue; const p = screenOf(t.cx, t.top, t.cy); if (p[2] > 1 || p[0] < -40 || p[0] > vw + 40 || p[1] < 0 || p[1] > vh + 20) continue;
      const text = farNames ? t.name.toUpperCase() : t.name, w = measure(text, fnt, farNames ? '0.05em' : '0px'), px = Math.sqrt(t.area) * ppuAt(t.cx, t.top, t.cy) * Math.max(0.6, Math.cos(cur.ph)), on = lblA.get('t:' + t.i + (farNames ? 'F' : '')) > 0.5;
      if (px < (t.walked && !farNames ? 22 : Math.max(farNames ? 40 : 30, w * (on ? 0.7 : 0.82)))) continue;
      cand.push([(t.walked ? 1e7 : 0) + (on ? 3e5 : 0) + px * 1000, t, p, text]);
    }
    cand.sort((a, b) => b[0] - a[0]);
    for (const [, t, p, text] of cand) put('t:' + t.i + (farNames ? 'F' : ''), text, p[0], p[1] + (t.walked && !farNames ? 13 : 0), { font: fnt, size: farNames ? fsz : fsz + 1.5, color: L.label, halo: L.halo, ls: farNames ? '0.05em' : '0px' });
    for (const bl of BRIDGE_LBL) { const m = screenOf(bl.x, 0, bl.z), q = screenOf(bl.x + bl.n[1], 0, bl.z - bl.n[0]); let dx = q[0] - m[0], dy = q[1] - m[1]; const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl; let px = -dy, py = dx; if (py < 0) { px = -px; py = -py; } const tw = measure(bl.t, F.bridge, '0px') / 2, off = 12 + Math.abs(px) * tw + Math.abs(py) * 8, p = [m[0] + px * off, m[1] + py * off, m[2]]; if (p[2] < 1 && ppuAt(bl.x, bl.y, bl.z) > 9) put(bl.id, bl.t, p[0], p[1], { font: F.bridge, size: 10, color: L.wlbl, halo: L.water }); }
    for (const wl of WATER_LBL) { if (area !== 'bay' || cur.d > wl.far || cur.d < wl.near) continue; const p = screenOf(wl.p[0], 0, wl.p[1]); if (p[2] < 1) put('w:' + wl.t, wl.t, p[0], p[1], { font: F.water, size: 9.5, color: L.wlbl, ls: '0.3em' }); }
    // fade in and out
    lblAnimating = false;
    for (const [id, rec] of want) { const a = lblA.get(id) || 0; rec.a = Math.min(1, a + dt / 0.18); lblA.set(id, rec.a); if (rec.a < 1) lblAnimating = true; }
    const gone = [];
    for (const [id, a] of lblA) if (!want.has(id)) { const n = a - dt / 0.14; if (n <= 0) lblA.delete(id); else { lblA.set(id, n); lblAnimating = true; if (lastDrawn.has(id)) gone.push([lastDrawn.get(id), n]); } }
    const draw = (rec, a) => { const o = rec.o; lctx.globalAlpha = a; lctx.font = o.font; if ('letterSpacing' in lctx) lctx.letterSpacing = o.ls || '0px'; haloText(rec.text, rec.sx, rec.sy, o.size, o.color, o.halo); };
    for (const [rec, a] of gone) draw(rec, a);
    for (const [, rec] of want) draw(rec, rec.a);
    for (const [id, rec] of want) lastDrawn.set(id, rec); for (const id of [...lastDrawn.keys()]) if (!lblA.has(id)) lastDrawn.delete(id);
    lctx.globalAlpha = 1; if ('letterSpacing' in lctx) lctx.letterSpacing = '0px';
  }

  // ---------- frame loop: draw on demand ----------
  let raf = 0, needs = true, lastT = 0, shadowDirty = true, sh = {}, lightBasis = null, BAY_C = [500, 800], VEGAS_C = [4897, 2129], lmScale = 1, frames = 0, lastMs = 0;
  const lightDir = new THREE.Vector3(), lightCam = new THREE.OrthographicCamera(), m4 = new THREE.Matrix4(), qt = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), yAxis = new THREE.Vector3(0, 1, 0);
  function invalidate() { needs = true; if (!raf) raf = requestAnimationFrame(tick); }
  function setPR(p) { if (p === pr) return; pr = p; renderer.setPixelRatio(pr); renderer.setSize(vw, vh, false); lblCanvas.width = Math.round(vw * pr); lblCanvas.height = Math.round(vh * pr); }
  function resize() { vw = window.innerWidth; vh = window.innerHeight; renderer.setPixelRatio(pr); renderer.setSize(vw, vh, false); lblCanvas.width = Math.round(vw * pr); lblCanvas.height = Math.round(vh * pr); invalidate(); }
  function updateScene(now) {
    place(cur, camera);
    const L = LOOKS[look];
    scene.fog.near = cur.d * L.fog[0]; scene.fog.far = cur.d * L.fog[1];
    // heights are stretched as the map zooms out (1 at city scale, VEX_FAR across the whole bay), so Mount Tam and the East Bay
    // hills still stand up when they are a few pixels wide; the icons grow a little too, so the skyline reads from across the bay
    const vx = 1 + (VEX_FAR - 1) * smooth((Math.log(cur.d) - Math.log(240)) / (Math.log(1700) - Math.log(240))); if (Math.abs(vx - vex) > 0.003) { vex = vx; land.scale.y = vex; shadowDirty = true; }
    const k = clamp(Math.pow(cur.d / 150, 0.7), 1, 2.6); if (Math.abs(k - lmScale) > 0.004) { lmScale = k; shadowDirty = true; }
    for (const ic of icons) ic.mesh.scale.set(lmScale, lmScale / vex, lmScale); if (cityMesh) cityMesh.scale.y = (1 + (lmScale - 1) * 0.6) / vex;
    // flags and pins hold their size on screen, within limits
    const ppu = (x, y, z) => vh / (2 * Math.tan(camera.fov * Math.PI / 360) * Math.max(0.001, camera.position.distanceTo(v3.set(x, y * vex, z))));
    if (flags) { flags.userData.tiles.forEach((t, i) => { const y = t.top + (t.lift || 0), s = clamp(20 / ppu(t.cx, y, t.cy), 0.7, 4.5); t.flagH = s; qt.setFromAxisAngle(yAxis, cur.th); m4.compose(ps.set(t.cx, y, t.cy), qt, sc.set(s, s / vex, s)); flags.setMatrixAt(i, m4); }); flags.instanceMatrix.needsUpdate = true; }
    if (pins) { seedSpots.forEach((s, i) => { const k2 = clamp(14 / ppu(s.x, s.y, s.z), 0.4, 3); s.h = k2; const tl = T.tileAt(tiles, s.x, s.z), y = s.y + ((tl && tl.lift) || 0); m4.compose(ps.set(s.x, y, s.z), qt.identity(), sc.set(k2, k2 / vex, k2)); pins.setMatrixAt(i, m4); pinDots.setMatrixAt(i, m4); }); pins.instanceMatrix.needsUpdate = pinDots.instanceMatrix.needsUpdate = true; }
    // the key light's shadow box is fitted to what the camera sees (the ground under the screen, out to a few view distances, and
    // the height of the tallest things), in the light's own fixed frame; its size moves in steps and its edges snap to whole shadow
    // texels, so a pan moves the shadows by whole texels (nothing crawls) and a zoom changes them only at a step
    { const az = L.key.az * Math.PI / 180, el = L.key.el * Math.PI / 180, A = area === 'vegas' ? VEGAS_C : BAY_C;
      lightDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
      if (!lightBasis || lightBasis.az !== az || lightBasis.el !== el || lightBasis.A !== A) {
        key.target.position.set(A[0], 0, A[1]); key.position.set(A[0] + lightDir.x * 4000, lightDir.y * 4000, A[1] + lightDir.z * 4000); key.target.updateMatrixWorld(); key.updateMatrixWorld();
        lightCam.position.copy(key.position); lightCam.up.set(0, 1, 0); lightCam.lookAt(key.target.position); lightCam.updateMatrixWorld(); lightBasis = { az, el, A, inv: lightCam.matrixWorldInverse.clone() }; shadowDirty = true;
      }
      const reach = cur.d * 2.4, hTop = 7 * vex, pts = [];
      for (const [sx, sy] of [[0, 0], [vw / 2, 0], [vw, 0], [0, vh / 2], [vw, vh / 2], [0, vh], [vw / 2, vh], [vw, vh]]) {
        let g = groundUnder(cur, sx, sy); if (!g) g = groundUnder(cur, sx, Math.max(sy, vh * 0.35)) || [cur.x, cur.z];
        const dx = g[0] - cur.x, dz = g[1] - cur.z, l = Math.hypot(dx, dz); if (l > reach) g = [cur.x + dx / l * reach, cur.z + dz / l * reach];
        pts.push(g);
      }
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (const g of pts) for (const y of [0, hTop]) { v3.set(g[0], y, g[1]).applyMatrix4(lightBasis.inv); x0 = Math.min(x0, v3.x); x1 = Math.max(x1, v3.x); y0 = Math.min(y0, v3.y); y1 = Math.max(y1, v3.y); z0 = Math.min(z0, v3.z); z1 = Math.max(z1, v3.z); }
      const W = Math.pow(1.12, Math.ceil(Math.log(Math.max(x1 - x0, y1 - y0, 4) + 2) / Math.log(1.12))), tx = W / key.shadow.mapSize.x;
      const L0 = Math.floor((x0 + x1 - W) / 2 / tx) * tx, B0 = Math.floor((y0 + y1 - W) / 2 / tx) * tx, N0 = Math.max(1, Math.floor((-z1 - 40) / 50) * 50), F0 = Math.ceil((-z0 + 40) / 50) * 50;
      if (L0 !== sh.l || B0 !== sh.b || W !== sh.w || N0 !== sh.n || F0 !== sh.f || shadowDirty) {
        sh = { l: L0, b: B0, w: W, n: N0, f: F0 }; const c = key.shadow.camera;
        c.left = L0; c.right = L0 + W; c.bottom = B0; c.top = B0 + W; c.near = N0; c.far = F0; c.updateProjectionMatrix();
        key.shadow.normalBias = tx * 2.2; key.shadow.bias = -0.0006; renderer.shadowMap.needsUpdate = true; shadowDirty = false;
      }
    }
    lightMat.uniforms.uScale.value = vh * pr / (2 * Math.tan(camera.fov * Math.PI / 360)); lightMat.uniforms.uMin.value = 1.4 * pr;
    $('#north svg').style.transform = `rotate(${-cur.th * 180 / Math.PI}deg)`;
  }
  function tick(now) {
    raf = 0; const dt = Math.min(0.05, (now - (lastT || now)) / 1000) || 0.016; lastT = now;
    let anim = stepCamera(now, dt);
    if (liftTile && lift !== liftTo) { const t = clamp((now - liftT0) / (liftTo ? 520 : 260), 0, 1); lift = liftTo ? backOut(t) * 0.85 : liftFrom * (1 - easeOut(t)); if (t >= 1) lift = liftTo ? 0.85 : 0; setLift(liftTile, lift); if (t < 1) anim = true; else if (!liftTo) liftTile = null; needs = true; }
    const active = anim || ptr.size > 0;
    if (active !== moving) { moving = active; if (DPR > PR_MOVE) { setPR(moving ? PR_MOVE : DPR); needs = true; } }
    if (needs || anim) { const t0 = performance.now(); updateScene(now); renderer.render(scene, camera); drawLabels(now); lastMs = performance.now() - t0; frames++; needs = false; }
    else if (lblAnimating) drawLabels(now);
    if (anim || lblAnimating || needs) raf = requestAnimationFrame(tick); else lastT = 0;
  }

  // ---------- views, areas, controls ----------
  const VIEWS = {};
  function makeViews() {
    const R = window.GEO.regions, gg = bridges.frames.gg, tp = bySlug['twin-peaks'], fd = bySlug['financial-district'];
    // the whole bay: the places from Petaluma and Napa to Cupertino, coast to Concord, filling the phone as the 2D map does
    VIEWS.bay = frame(vw < vh ? [205, 425, 815, 1225] : [150, 380, 880, 1270], 0, 0.16, 4, 1); D_FAR = VIEWS.bay.d;
    VIEWS.all = frame([20, 30, 990, 1480], 0, 0.16, 4, 1);
    VIEWS.sf = frame([R.sf[0] + 4, R.sf[1] + 6, R.sf[2] - 6, R.sf[3] - 4], -0.22, 0.95, 5, vw < vh ? 0.84 : 1.2);
    VIEWS.gg = frame([Math.min(gg.A[0], gg.B[0]) - 2, Math.min(gg.A[1], gg.B[1]) - 1.5, Math.max(gg.A[0], gg.B[0]) + 2, Math.max(gg.A[1], gg.B[1]) + 1.5], 1.25, 1.12, 4.5, 0.82);
    VIEWS.skyline = frame([fd.cx - 5, fd.cy - 4, fd.cx + 10, fd.cy + 9], 2.2, 1.2, 6, 0.9);
    VIEWS.hills = frame([tp.cx - 11, tp.cy - 10, tp.cx + 11, tp.cy + 10], 0.6, 1.2, 7, 0.95);
    { const tam = bySlug['mount-tam-muir-woods'], ok = bySlug['oakland'], bk = bySlug['berkeley']; VIEWS.tam = frame(tam.bbox, 0.55, 1.18, tam.peak, 0.9); VIEWS.eastbay = frame([bk.bbox[0], bk.bbox[1], ok.bbox[2], ok.bbox[3]], -1.35, 1.15, ok.peak, 0.95); }
    VIEWS.vegas = frame([R.vegas[0] + 1, R.vegas[1] + 1, R.vegas[2] - 1, R.vegas[3] - 1], -0.37, 1.02, 4, 0.66);
    VIEWS.vegasclose = frame([R.vegas[0] + 4, R.vegas[1] + 18, R.vegas[2] - 4, R.vegas[3] - 18], 1.2, 1.2, 4, 0.85);
    AREAS.vegas = { box: [R.vegas[0] - 30, R.vegas[1] - 30, R.vegas[2] + 30, R.vegas[3] + 30], dMax: VIEWS.vegas.d * 2.4 };
    AREAS.bay.dMax = Math.max(VIEWS.all.d, D_FAR * 1.25);
  }
  function setArea(a, o = {}) {
    if (a === area && !o.force) return; area = a; select(null);
    document.querySelectorAll('#areas button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.area === a)));
    const to = Object.assign({}, a === 'vegas' ? VIEWS.vegas : VIEWS.sf);
    if (o.instant || reduceMotion) { flyTo(to, 0); return; }
    // a cut, not a flight across 600 km of nothing: fade out, move, settle in
    glCanvas.classList.add('cut'); lblCanvas.classList.add('cut');
    setTimeout(() => { const from = Object.assign({}, to, { d: to.d * 1.35 }); Object.assign(cur, from); Object.assign(goal, from); fly = null; flyTo(to, 900); glCanvas.classList.remove('cut'); lblCanvas.classList.remove('cut'); }, 280);
  }
  function setView(name, o = {}) { const v = VIEWS[name]; if (!v) return false; const a = /^vegas/.test(name) ? 'vegas' : 'bay'; if (a !== area) { area = a; document.querySelectorAll('#areas button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.area === a))); } flyTo(v, o.fly ? undefined : 0); return true; }
  document.querySelectorAll('#looks button').forEach(b => b.addEventListener('click', () => applyLook(b.dataset.look)));
  document.querySelectorAll('#areas button').forEach(b => b.addEventListener('click', () => setArea(b.dataset.area)));
  $('#north').addEventListener('click', () => { stop(); let th = cur.th % (Math.PI * 2); if (th > Math.PI) th -= Math.PI * 2; if (th < -Math.PI) th += Math.PI * 2; cur.th = goal.th = th; flyTo(Object.assign({}, goal, { th: 0, ph: 0.9 }), 700); });
  window.addEventListener('resize', resize);
  document.addEventListener('gesturestart', e => e.preventDefault()); // iOS: no page zoom from a pinch that starts on the controls
  // paper grain, made here: no image is downloaded
  $('#grain').style.backgroundImage = `url("data:image/svg+xml;utf8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="220" height="220"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency=".9" numOctaves="2" seed="7"/><feColorMatrix values="0 0 0 0 .45  0 0 0 0 .38  0 0 0 0 .26  0 0 0 .5 -.14"/></filter><rect width="220" height="220" filter="url(#n)"/></svg>')}")`;
  $('#hint').textContent = coarse ? 'Drag to move · pinch to zoom · two fingers to turn and tilt' : 'Drag to move · scroll to zoom · right-drag to turn and tilt';

  // ---------- start ----------
  const api = window.__m3d = { ready: null, setView, setLook: applyLook, select: n => select(n ? (bySlug[n] || tiles.find(t => t.name === n)) : null, { ms: 0 }), setArea, views: VIEWS, cur, goal, flyTo, tiles, icons, three: { renderer, scene, camera, key, hemi, waterMat, tileMat, builtMat, invalidate: () => { shadowDirty = true; invalidate(); } } };
  api.screenOf = n => { const t = bySlug[n] || tiles.find(q => q.name === n); if (!t) return null; place(cur, camera); const p = screenOf(t.cx, t.top, t.cy); return [Math.round(p[0]), Math.round(p[1])]; };
  api.stats = () => {
    let tris = 0, meshes = 0; scene.traverse(o => { if (o.isMesh && o.visible) { const g = o.geometry, n = (g.index ? g.index.count : g.attributes.position.count) / 3; tris += n * (o.isInstancedMesh ? o.count : 1); meshes++; } });
    renderer.shadowMap.needsUpdate = true; updateScene(performance.now()); renderer.render(scene, camera); const withShadow = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
    renderer.render(scene, camera); const plain = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles };
    return { sceneTriangles: Math.round(tris), meshes, frame: plain, frameWithShadowPass: withShadow, tiles: world.mesh.idx.length / 3, land: world.land.idx.length / 3, bridges: bridges.tris, icons: icons.reduce((s, i) => s + i.tris, 0), city: cityMesh ? cityMesh.geometry.attributes.position.count / 3 : 0, buildMs: api.buildMs, bad: world.bad.map(b => tiles[b[0]].name + ' ' + b[1] + '/' + b[2]), pr, size: [vw, vh], frames, lastMs: +lastMs.toFixed(2), geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures };
  };
  // frame time: n frames of a slow orbit, each forced to finish on the GPU, shadows redrawn on every frame (the worst case) or as in use
  api.bench = (n = 120, everyShadow = false) => {
    const gl = renderer.getContext(), keep = Object.assign({}, cur), times = []; const px = new Uint8Array(4);
    for (let i = 0; i < n; i++) { cur.th = keep.th + i * 0.012; cur.x = keep.x + Math.sin(i * 0.05) * cur.d * 0.05; if (everyShadow) shadowDirty = true; const t0 = performance.now(); updateScene(t0); renderer.render(scene, camera); drawLabels(t0); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); times.push(performance.now() - t0); }
    Object.assign(cur, keep); invalidate(); times.sort((a, b) => a - b);
    return { n, everyShadow, avg: +(times.reduce((s, t) => s + t, 0) / n).toFixed(2), p50: +times[n >> 1].toFixed(2), p95: +times[Math.floor(n * 0.95)].toFixed(2), max: +times[n - 1].toFixed(2) };
  };
  api.settle = () => new Promise(res => { const chk = () => { if (!raf && !fly && !lblAnimating && !moving) res(true); else setTimeout(chk, 60); }; invalidate(); setTimeout(chk, 120); });
  api.ready = (async () => {
    const t0 = performance.now();
    const [seed, vegas] = await Promise.all([fetch('seed.json').then(r => r.ok ? r.json() : null).catch(() => null), fetch('../../data/subareas_vegas.json').then(r => r.ok ? r.json() : null).catch(() => null)]);
    // the app's web fonts, so names are measured in the face they are drawn in (and again if a face arrives late)
    if (document.fonts) { try { await Promise.race([Promise.all(['500 12px Figtree', '600 12px Figtree', '600 12px "Bricolage Grotesque"'].map(f => document.fonts.load(f))), new Promise(r => setTimeout(r, 1800))]); } catch (e) { /* the fallback faces */ }
      widths.clear(); document.fonts.addEventListener && document.fonts.addEventListener('loadingdone', () => { widths.clear(); invalidate(); }); }
    buildCity(vegas); buildMarks(seed);
    resize(); makeViews(); applyLook(look);
    api.buildMs = { terrain: Math.round(world.ms.tiles + world.ms.rest), total: Math.round(performance.now() - t0 + world.ms.tiles + world.ms.rest) };
    const view = Q.get('view'), still = Q.get('still') === '1' || reduceMotion;
    if (view && VIEWS[view]) setView(view);
    else if (still) setView('sf');
    else { setView('bay'); setTimeout(() => { if (!userTouched) flyTo(VIEWS.sf, 2600); }, 900); }
    if (Q.get('select')) api.select(Q.get('select'));
    $('#loading').classList.add('off'); if (Q.get('still') === '1') $('#hint').classList.add('off'); else setTimeout(() => $('#hint').classList.add('off'), 7000);
    return true;
  })();
})();
