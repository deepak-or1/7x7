// The 3D map (beta): a second map engine beside js/map.js, with the same members and the same options, so js/app.js drives either.
// It is inert unless index.html also loaded three.js and js/map3d/{land,models,blocks}.js (it does when the 3D map is asked for):
// window.MapView3D returns null without them, or without WebGL, and the app makes the flat map instead.
//
// Everything that is data, not drawing (sections, bounding boxes, landmarks, areas, region boxes) comes from a real MapView made on
// a detached canvas, so it is the flat map's own. The camera the app sees is still the flat rectangle { x, y, w } in map units: the
// north-up ground box the view is centred on, w its width at the centre, k = W / w. What is new is the tilt, which follows the zoom
// (nearly straight down over the whole bay, leaning in as you come closer) plus whatever a two-finger turn or tilt adds; fitView
// solves its box against the real projection, so a fitted place stays inside the insets however the view leans. toMap ray-casts to
// the block tops and walls; toScreen projects a map point at the height of what stands there. Both take a view as a last argument.
//
// Drawn with WebGL on a canvas of its own, under one 2D canvas for names, spots and the quiz's pills (both inside #stage; the flat
// map's canvas stays in the page, hidden). Colours come from setColors and the CSS tokens the flat map reads; the light theme is the
// paper look, the dark theme the night look. Frames are drawn on demand, never in a loop, except while something animates.
(function () {
  'use strict';
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v)), lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (v, a, b) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const easeOut = t => 1 - Math.pow(1 - t, 4), backOut = t => { const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
  const now = () => performance.now();
  const RM = matchMedia('(prefers-reduced-motion: reduce)');
  const U = 400;                                  // as js/map.js: zoom limits are tuned in map units of the first canvas
  const FOV = 30, F = 1 / Math.tan(FOV * Math.PI / 360);
  const D_MIN = 12, D_NEAR = 110, PH_MIN = 0.03, PH_MAX = 1.27, PH_NEAR = 1.0, PH_FAR = 0.16, PH_ADD = 0.45; // the camera's distance and tilt (radians from straight down)
  const MARK_MAX = 16;                            // a flag or a bookmark holds its size on screen until it would stand this tall on the map
  const FOCUS_Y = 0.5, VEX_FAR = 1.55, LIFT = 0.85; // the height the camera looks at; how far heights stretch at the far zoom; how far the selected place rises
  const hex2rgb = h => { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); const n = parseInt(h, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  const cssColor = cs => { cs = String(cs).trim(); if (cs.startsWith('var(')) return getComputedStyle(document.documentElement).getPropertyValue(cs.slice(4, -1).trim()).trim(); return cs; };
  const LIN = new Float32Array(256); for (let i = 0; i < 256; i++) { const c = i / 255; LIN[i] = c < 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); } // sRGB to the renderer's linear colours
  const lin = hex => { const c = hex2rgb(hex); return [LIN[c[0]], LIN[c[1]], LIN[c[2]]]; };
  const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const mixHex = (a, b, t) => { const p = hex2rgb(a), q = hex2rgb(b); return '#' + [0, 1, 2].map(k => Math.round(clamp(lerp(p[k], q[k], t), 0, 255)).toString(16).padStart(2, '0')).join(''); };
  const starPath = (c, x, y, r) => { c.beginPath(); for (let q = 0; q < 10; q++) { const rr = q % 2 ? r * .45 : r, a = -Math.PI / 2 + q * Math.PI / 5; c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } c.closePath(); };

  // ---- the two looks: what no CSS token says (light, air, the tone of a block's sides, the colours of the models) ----
  const LOOKS = {
    paper: { bg: '#e9e5da', fog: [1.7, 8], shore: 1, lift: '#fdfbf6', liftK: 0.05, side: '#6a4529', sideK: 0.14, bevelK: 0.2, key: { c: '#fff2df', i: 2.15, az: 302, el: 44 }, hemi: { sky: '#f5f6f6', ground: '#dccdb2', i: 1.85 }, shadowR: 2.5,
      tileRough: 0.94, builtRough: 0.82, pane: 0.1, waterRough: 0.78, waterMetal: 0, glow: 0, amb: 0, lights: false, castA: 0.2 },
    night: { bg: '#0b1118', fog: [1.6, 7.5], shore: 1.25, lift: '#c9d6e6', liftK: 0.04, side: '#05080c', sideK: 0.32, bevelK: 0.14, key: { c: '#b4c8ff', i: 1.05, az: 300, el: 48 }, hemi: { sky: '#9fb2d4', ground: '#2c2a33', i: 1.75 }, shadowR: 2.5,
      tileRough: 0.9, builtRough: 0.75, pane: 0.3, waterRough: 0.6, waterMetal: 0.1, glow: 0.95, amb: 0.22, lights: true, castA: 0.2 },
  };
  const BUILT = { // colours of everything built, by material name (the Golden Gate, the steel, the flag and the bookmark take the app's tokens instead)
    paper: { whiteCable: '#eef0ee', white: '#f8f4ec', whiteShade: '#e4ddcf', stone: '#ebe4d5', stoneShade: '#cdc4b0', metal: '#dcdcd8', glass: '#b4c5ce', glassTop: '#d6e0e5', glassDark: '#74858f', roof: '#98a2a8', glassRoof: '#c4d3d8', red: '#d4563a', concrete: '#d2cbbb', concreteLight: '#e6e0d2', road: '#6c7075', roadLight: '#b3b0a8', dark: '#3c4a57', rust: '#b3765a', ochre: '#dcae80', ochreShade: '#b98a5e', dome: '#cc7a50', lagoon: '#a9c9d2', lamp: '#fff3c4', clock: '#fdf9ee', p0: '#9db8cc', p1: '#e6c97a', p2: '#dd9c90', p3: '#a8c096', p4: '#f1e5ca', p5: '#b8a3c5', p6: '#8cb6b1', trim: '#fdfaf2', sphere: '#394655', bronze: '#8e6d51', bronzeShade: '#70553f', wheel: '#f4f1ea', wheelShade: '#c6c2b8', cabin: '#dfe7ec', luxor: '#3a434e', sand: '#d9bc8e', bldg0: '#f4f0e7', bldg1: '#ece6da', bldg2: '#e2dccf', bldg3: '#d6dee1', resort0: '#f3eee4', resort1: '#dcc48e', resort2: '#e8decb', resort3: '#cfd8dc', resort4: '#c4a575', podium: '#e4ddcd', boulevard: '#fdfbf6', pole: '#4f4a41', poleBase: '#3c4a57', roofTop: '#d6cfbf' },
    night: { whiteCable: '#77828e', white: '#55606d', whiteShade: '#454f5b', stone: '#4d5764', stoneShade: '#3c4651', metal: '#6a7480', glass: '#3c5266', glassTop: '#7fb6d8', glassDark: '#2a3a4a', roof: '#343e4b', glassRoof: '#3d5560', red: '#a3463a', concrete: '#444e5a', concreteLight: '#525c68', road: '#1c242d', roadLight: '#3a444f', dark: '#1a232c', rust: '#7a5140', ochre: '#8a6f55', ochreShade: '#6e573f', dome: '#96583a', lagoon: '#1d3a4a', lamp: '#fff3c4', clock: '#fff4d6', p0: '#55708a', p1: '#8f7c48', p2: '#8b5e58', p3: '#5f7556', p4: '#857d68', p5: '#6f6082', p6: '#4b6f6c', trim: '#7d8690', sphere: '#4f66ff', bronze: '#6b523d', bronzeShade: '#523f2e', wheel: '#6a7480', wheelShade: '#4d5764', cabin: '#b9d8ff', luxor: '#1b222b', sand: '#77664c', bldg0: '#5d6878', bldg1: '#566170', bldg2: '#4f5a68', bldg3: '#55667a', resort0: '#646a74', resort1: '#7d6b44', resort2: '#666159', resort3: '#53616f', resort4: '#6d5a43', podium: '#46505c', boulevard: '#6a5a3a', pole: '#c3ccd4', poleBase: '#8e9ca8', roofTop: '#414a56' },
  };
  const LIGHTS = { warm: '#ffc27a', white: '#eaf2ff', red: '#ff4b3a', cool: '#9fd2ff', gold: '#ffcf6b', pink: '#ff6fb0', violet: '#9b7bff', sphere: '#5a72ff', beam: '#fff1c2' };
  // the CSS tokens read (the flat map's, the quiz's two inks, and the second ink for region names)
  const VARS = { water: '--water', paper: '--paper', ink: '--ink', ink2: '--ink-2', muted: '--muted', land: '--land', landOther: '--land-other', coast: '--coast', steel: '--steel', gg: '--gg', accent: '--accent', want: '--want', label: '--label', labelHalo: '--label-halo', subLine: '--sub-line', face: '--glyph-face', shade: '--glyph-shade', roof: '--glyph-roof', star: '--star', okInk: '--qz-ok-ink', noInk: '--qz-no-ink' };
  const REGION_AT = { sf: [-122.445, 37.757], north: [-122.47, 38.2], east: [-122.06, 37.86], south: [-121.99, 37.265], penin: [-122.3, 37.49], marin: [-122.63, 37.99] }; // where a region's name sits over the whole bay

  window.MapView3D = function (canvas, o) {
    const THREE = window.THREE, M3D = window.M3D || {}, land = M3D.land, MD = M3D.models;
    if (!THREE || !land || !MD || !window.MapView) return null;          // three.js or the 3D files did not load: the flat map
    o = o || {};
    const glc = document.createElement('canvas'), lbl = document.createElement('canvas');
    let renderer; try { renderer = new THREE.WebGLRenderer({ canvas: glc, antialias: true, alpha: false, powerPreference: 'high-performance' }); } catch (e) { return null; } // no WebGL here: the flat map
    const G = window.GEO, Geom = window.Geom, HOODS = G.hoods, proj = Geom.proj, REGS = window.REGIONS || {}, SHORT = window.SHORT || {}, SUBD = window.SUBAREAS || {};
    const stage = canvas.parentElement, ctx = lbl.getContext('2d'), supportsLS = 'letterSpacing' in ctx, isPhone = () => window.innerWidth <= 880;

    // ---- the flat engine, detached: the data is its own ----
    const base = window.MapView(document.createElement('div').appendChild(document.createElement('canvas')), {});
    const BB = base.bbox, LANDS = base.landmarks, AREAS = base.areas, IDX = Object.fromEntries(HOODS.map((h, i) => [h.name, i]));
    const areaObj = (x, y) => { const id = base.areaAt(x, y); return AREAS.find(a => a.id === id) || AREAS[0]; };
    const DETAIL = HOODS.map((h, i) => Math.round(base.hoodPx(i) / ((BB[i][2] - BB[i][0]) * base.k) * 1e6) / 1e6 || 1); // the flat map's own detail factor per place
    const subsOf = i => base.subs(i);
    const PP = []; window.HP.forEach(h => { const i = IDX[h.name]; if (i != null) PP[i] = h.polys.map(poly => poly.map(ring => ring.map(proj))); }); // place polygons in map units, as js/map.js makes them
    const COV = land.covered(), PPD = PP.map((polys, i) => polys.filter((p, k) => !COV[i].has(k))); // the pieces that carry a block: not the ground a later place also claims (js/map3d/land.js)
    const HT = HOODS.map((h, i) => land.topOf(i));                        // the top of each block
    const HMAX = Math.max.apply(null, HT) + LIFT;
    const STAR = HOODS.map(h => (SUBD[h.name] || []).some(s => s && s.star));
    const SIZE = HOODS.map((h, i) => Math.sqrt(Math.abs((PP[i] || []).reduce((s, poly) => s + poly.reduce((a, r, k) => a + (k ? -1 : 1) * Math.abs(Geom.area(r)), 0), 0)))); // the side of a square of the place's area
    const SIDE_X = HOODS.map((h, i) => { if (DETAIL[i] <= 1 || !PP[i]) return 0; const band = (BB[i][3] - BB[i][1]) * .2; let x = -Infinity; PP[i].flat().forEach(r => r.forEach(q => { if (Math.abs(q[1] - h.cy) <= band && q[0] > x) x = q[0]; })); return x > -Infinity ? x : BB[i][2]; }); // js/map.js: a detailed place is named beside it
    const LM_ID = Object.fromEntries(LANDS.map((l, j) => [l.id, j]));
    const REGION_LBL = Object.keys(REGION_AT).filter(r => REGS[r] && G.regions[r]).map(r => ({ id: 'r:' + r, t: (r === 'sf' ? 'San Francisco' : REGS[r].label).toUpperCase(), p: proj(REGION_AT[r]) }));

    // ---- the page: two canvases after the flat map's (hidden), and the button that faces north again ----
    glc.className = 'm3d'; lbl.className = 'm3d m3d-labels'; glc.setAttribute('role', 'img'); glc.setAttribute('aria-label', canvas.getAttribute('aria-label') || 'Map'); lbl.setAttribute('aria-hidden', 'true');
    const north = document.createElement('button'); north.type = 'button'; north.className = 'm3d-north'; north.hidden = true; north.title = 'Face north'; north.setAttribute('aria-label', 'Face north');
    north.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="n" d="M12 3l3.6 9H8.4z"/><path class="s" d="M12 21l-3.6-9h7.2z"/></svg>';
    canvas.hidden = true; canvas.after(glc, lbl, north);

    // ---- state ----
    let W = 1, H = 1, dpr = 1, pr = 1, dFar = 1500, camV = 0;
    let area = AREAS[0];
    const cam = { x: 0, y: 0, w: Geom.NX };                               // what the app reads: the flat rectangle
    const cur = { cx: Geom.NX / 2, cz: Geom.NY / 2, w: Geom.NX, th: 0, off: 0 }, goal = Object.assign({}, cur); // the centre, the width there, the heading, the tilt added by hand
    let mode = 'still', fly = null, vel = { x: 0, z: 0 }, raf = 0, lastT = 0, userMoved = false, needs = true, ready = false, moving = false;
    let region = 'all', sel = -1, selSub = -1, hover = -1, hoverSub = -1, hoverSpot = null, quiz = false, press = -1;
    const colNow = HOODS.map(() => [200, 200, 200]), colTo = HOODS.map(() => [200, 200, 200]); let colAnim = false, paintAll = true;
    const alphaNow = new Float32Array(HOODS.length).fill(1), flagNow = new Uint8Array(HOODS.length), liftV = new Float32Array(HOODS.length), liftAnim = new Map();
    const farA = [1], markAnim = {}; let me = null, meT0 = 0, drawnSpots = [], lmBox = [], farNames = false;
    const lblA = new Map(), lblLast = new Map(), lmA = LANDS.map(() => 0), measureCache = new Map(), hoodCache = new Map();
    const P = {}; let LK = null, dark = false;                             // the tokens, and the look made from them
    const stat = { t0: now(), firstFrame: 0, build: {}, blocks: '', frames: 0, lastMs: 0 };
    const insets = () => o.insets ? o.insets() : { top: 0, right: 0, bottom: 0, left: 0 };
    const kNow = () => W / cur.w;
    const hoodPx = i => (BB[i][2] - BB[i][0]) * kNow() * DETAIL[i];
    const topAt = i => HT[i] + liftV[i];

    // ---- palette ----
    function refreshPalette() {
      const cs = getComputedStyle(document.documentElement); for (const k in VARS) P[k] = cs.getPropertyValue(VARS[k]).trim() || '#888888';
      const w = hex2rgb(P.water); dark = (w[0] * .3 + w[1] * .59 + w[2] * .11) < 110;
      const L = LOOKS[dark ? 'night' : 'paper'], pal = Object.assign({}, BUILT[dark ? 'night' : 'paper']);
      Object.assign(pal, { gg: P.gg, ggShade: mixHex(P.gg, '#000000', .1), ggCable: mixHex(P.gg, '#000000', .05), steel: P.steel, steelShade: mixHex(P.steel, '#000000', .14), steelCable: mixHex(P.steel, '#000000', .07), flag: P.accent, ribbon: P.want });
      // the water deepens towards the open sea and lightens at the shore; the land around the places is the flat map's, a little
      // lifted in the dark so it reads against the water under this light
      LK = Object.assign({}, L, { pal, water: P.water, deep: dark ? mixHex(P.water, '#000000', .38) : mixHex(P.water, P.coast, .43), shallow: dark ? mixHex(P.water, P.coast, .25) : mixHex(P.water, '#ffffff', .31), rim: dark ? P.coast : null,
        landHex: mixHex(P.landOther, P.land, dark ? 1.7 : .25), land: null, liftC: lin(L.lift), sideC: lin(L.side), accent: lin(P.accent), ink: lin(P.ink), okInk: lin(P.okInk), noInk: lin(P.noInk) });
      LK.land = lin(LK.landHex);
    }

    // ---- the camera ----
    const dOf = w => w * F * H / (2 * W);                                 // how far the camera stands for a ground width w at the centre
    const phAuto = d => lerp(PH_NEAR, PH_FAR, smooth(Math.log(d), Math.log(D_NEAR), Math.log(dFar)));
    const phOf = (w, off) => { const a = phAuto(dOf(w)); return clamp(a + off, PH_MIN, Math.min(PH_MAX, a + PH_ADD)); };
    const vexOf = d => 1 + (VEX_FAR - 1) * smooth(Math.log(d), Math.log(240), Math.log(1700)); // heights stretch as the map zooms out, so the hills still stand up when they are a few pixels wide
    // position and axes for a state { cx, cz, w, th, off }
    function camOf(s) {
      const d = dOf(s.w), ph = phOf(s.w, s.off), sp = Math.sin(ph), cp = Math.cos(ph), st = Math.sin(s.th), ct = Math.cos(s.th);
      const fx = -sp * st, fy = -cp, fz = -sp * ct, rl = Math.hypot(fz, fx) || 1, rx = -fz / rl, rz = fx / rl;
      return { d, ph, vex: vexOf(d), px: s.cx + d * sp * st, py: FOCUS_Y + d * cp, pz: s.cz + d * sp * ct, fx, fy, fz, rx, rz, ux: -rz * fy, uy: rz * fx - rx * fz, uz: rx * fy, g: F * H / 2 };
    }
    // a world point on screen: [x, y, depth along the view]
    function project(c, X, Y, Z) { const vx = X - c.px, vy = Y - c.py, vz = Z - c.pz, zc = vx * c.fx + vy * c.fy + vz * c.fz, s = c.g / (zc > 1e-6 ? zc : 1e-6); return [W / 2 + (vx * c.rx + vz * c.rz) * s, H / 2 - (vx * c.ux + vy * c.uy + vz * c.uz) * s, zc]; }
    function rayOf(c, sx, sy) { const a = (sx - W / 2) / c.g, b = -(sy - H / 2) / c.g; return [c.fx + c.rx * a + c.ux * b, c.fy + c.uy * b, c.fz + c.rz * a + c.uz * b]; }
    // the point of the plane y under a screen point (a view that looks past the horizon there gets a point far off, not none)
    function planeAt(c, sx, sy, y) { const r = rayOf(c, sx, sy), far = c.d * 12, dy = r[1] < -1e-4 ? r[1] : -1e-4; let t = (y - c.py) / dy; const hl = Math.hypot(r[0], r[2]); if (t * hl > far) t = far / hl; return [c.px + r[0] * t, c.pz + r[2] * t]; }
    const groundAt = (s, sx, sy) => planeAt(camOf(s), sx, sy, FOCUS_Y);
    const camNow = () => { const c = camOf(cur); if (ready) c.vex = vex; return c; }; // the view on screen, with the height stretch the scene was last drawn with
    const stateOf = v => ({ cx: v.x + v.w / 2, cz: v.y + v.w * H / W / 2, w: v.w, th: v.th != null ? v.th : goal.th, off: v.off != null ? v.off : goal.off });
    const viewOf = s => ({ x: s.cx - s.w / 2, y: s.cz - s.w * H / W / 2, w: s.w, th: s.th, off: s.off });
    let lastV = null, lastC = null, lastK = -1;
    const camFor = v => { if (!v) return camNow(); if (v !== lastV || lastK !== camV) { lastV = v; lastK = camV; lastC = camOf(stateOf(v)); } return lastC; }; // a view's camera, kept while the same view is asked about
    const maxW = (a = area) => Math.max(a.r[2] - a.r[0], (a.r[3] - a.r[1]) * W / H) * 2.2;
    const minW = () => Math.max(U * 0.012, D_MIN * 2 * W / (F * H));
    function limit(s, a = area) { s.w = clamp(s.w, minW(), maxW(a)); const h = s.w * H / W; s.cx = clamp(s.cx, a.r[0] - s.w * .05, a.r[2] + s.w * .05); s.cz = clamp(s.cz, a.r[1] - h * .05, a.r[3] + h * .05); return s; }
    function sync() { cam.x = cur.cx - cur.w / 2; cam.y = cur.cz - cur.w * H / W / 2; cam.w = cur.w; }

    // ---- what stands where ----
    const placeAt = (L, x, y) => { for (let i = 0; i < HOODS.length; i++) { const bb = BB[i]; if (x < bb[0] || x > bb[2] || y < bb[1] || y > bb[3]) continue; if (Geom.inPolys(L[i], x, y)) return i; } return -1; };
    const hoodAt = (x, y) => placeAt(PPD, x, y);                          // the place whose block stands at a point
    const firstAt = (x, y) => placeAt(PP, x, y);                          // the place the flat map's hit test gives there: the first in the list
    const hoodOf = (x, y) => { const k = x + ',' + y; let i = hoodCache.get(k); if (i === undefined) { if (hoodCache.size > 4000) hoodCache.clear(); i = hoodAt(x, y); hoodCache.set(k, i); } return i; };
    const ringNear = (r, x, y, d2) => { for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const ax = r[j][0], ay = r[j][1], dx = r[i][0] - ax, dy = r[i][1] - ay, l2 = dx * dx + dy * dy; let t = l2 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t; const qx = ax + dx * t - x, qy = ay + dy * t - y; if (qx * qx + qy * qy <= d2) return true; } return false; };
    // the height of what stands at a map point: the top of the place there (the tallest one within `near` of it: a point on a
    // boundary belongs to the block it edges), else the water
    function surfaceAt(x, y, near) {
      let h = -1;
      for (let i = 0; i < HOODS.length; i++) { const bb = BB[i]; if (x < bb[0] - near || x > bb[2] + near || y < bb[1] - near || y > bb[3] + near || topAt(i) <= h) continue; if (Geom.inPolys(PPD[i], x, y) || (near > 0 && PPD[i].some(poly => ringNear(poly[0], x, y, near * near)))) h = topAt(i); }
      return h < 0 ? 0 : h;
    }
    // the first thing a ray from a screen point meets: the top of a block, or its wall, else the water. { i, x, y } in map units
    function pick(c, sx, sy) {
      const r = rayOf(c, sx, sy), dy = r[1] < -1e-4 ? r[1] : -1e-4, tOf = y => (y - c.py) / dy, far = c.d * 12 / (Math.hypot(r[0], r[2]) || 1e-9);
      const t0 = Math.max(0, tOf(HMAX * c.vex)), tg = Math.min(Math.max(t0, tOf(0)), Math.max(far, t0));
      const ax = c.px + r[0] * t0, ay = c.pz + r[2] * t0, gx = c.px + r[0] * tg, gy = c.pz + r[2] * tg;
      const x0 = Math.min(ax, gx), x1 = Math.max(ax, gx), y0 = Math.min(ay, gy), y1 = Math.max(ay, gy);
      let best = -1, bt = tg;
      for (let i = 0; i < HOODS.length; i++) {
        const bb = BB[i]; if (bb[2] < x0 || bb[0] > x1 || bb[3] < y0 || bb[1] > y1) continue;
        const ti = Math.max(0, tOf(topAt(i) * c.vex)); if (ti >= bt) continue;
        const qx = c.px + r[0] * ti, qy = c.pz + r[2] * ti;
        if (Geom.inPolys(PPD[i], qx, qy)) { best = i; bt = ti; continue; }
        // below its top: the ray may come in through the wall. The first crossing of the place's outline between there and the ground
        const ex = gx - qx, ey = gy - qy; let s = Infinity;
        for (const poly of PPD[i]) { const ring = poly[0]; for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) { const px = ring[b][0], py = ring[b][1], fx = ring[a][0] - px, fy = ring[a][1] - py, den = ex * fy - ey * fx; if (Math.abs(den) < 1e-12) continue; const u = ((px - qx) * fy - (py - qy) * fx) / den, w = ((px - qx) * ey - (py - qy) * ex) / den; if (u >= 0 && u <= 1 && w >= 0 && w <= 1 && u < s) s = u; } }
        if (s <= 1) { const t = ti + (tg - ti) * s + 1e-4 * (tg - ti); if (t < bt) { best = i; bt = t; } }
      }
      let x = c.px + r[0] * bt, y = c.pz + r[2] * bt;
      if (best >= 0 && !Geom.inPolys(PPD[best], x, y)) { const hl = Math.hypot(r[0], r[2]) || 1; x += r[0] / hl * .03; y += r[2] / hl * .03; } // a wall: a point just inside it
      if (best >= 0 && COV.some(c => c.size)) { const j = firstAt(x, y); if (j >= 0) best = j; } // ground two places claim: the flat map's answer, the first in the list
      return { i: best, x, y };
    }

    // ---- framing ----
    // The view that puts a box (grown by pad about its centre, with what stands in it) inside the insets, centred there, at the
    // heading and added tilt in use: the width by bisection on the projected corners, the centre by moving it until the box's middle
    // lands on the insets' middle, a few rounds of both, then a last check against the projection itself. minW: the least width of
    // ground across the insets, as in the flat map.
    function fitView(x0, y0, x1, y1, pad, minWv) {
      const I = insets(), vw = Math.max(80, W - I.left - I.right), vh = Math.max(80, H - I.top - I.bottom), mx = (x0 + x1) / 2, my = (y0 + y1) / 2, hx = (x1 - x0) / 2 * pad, hy = (y1 - y0) / 2 * pad;
      const ta = areaObj(mx, my), cut = ta !== area;
      let top = 0; for (let i = 0; i < HOODS.length; i++) { const b = BB[i]; if (b[2] >= x0 && b[0] <= x1 && b[3] >= y0 && b[1] <= y1) top = Math.max(top, HT[i] + (i === sel ? LIFT : 0)); }
      const s = { cx: mx, cz: my, w: Math.max(hx * 2, 1), th: cut ? 0 : goal.th, off: cut ? 0 : goal.off }; // another area is a cut, and a cut faces north
      const ext = () => { const c = camOf(s), e = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, bad: false };
        for (const X of [mx - hx, mx + hx]) for (const Z of [my - hy, my + hy]) for (const Y of [0, top]) { const p = project(c, X, Y * c.vex, Z); if (p[2] <= 1e-6) e.bad = true; e.x0 = Math.min(e.x0, p[0]); e.x1 = Math.max(e.x1, p[0]); e.y0 = Math.min(e.y0, p[1]); e.y1 = Math.max(e.y1, p[1]); }
        return e; };
      const centre = () => { const e = ext(), a = groundAt(s, (e.x0 + e.x1) / 2, (e.y0 + e.y1) / 2), b = groundAt(s, I.left + vw / 2, I.top + vh / 2); s.cx += a[0] - b[0]; s.cz += a[1] - b[1]; };
      for (let it = 0; it < 5; it++) {
        let lo = 0.5, hi = 60000; for (let k = 0; k < 30; k++) { s.w = Math.sqrt(lo * hi); const e = ext(); if (e.bad || e.x1 - e.x0 > vw || e.y1 - e.y0 > vh) lo = s.w; else hi = s.w; }
        s.w = Math.max(hi, (minWv || 0) * W / vw); centre();
      }
      limit(s, ta);
      for (let n = 0; n < 20 && s.w < maxW(ta); n++) { const e = ext(); if (!e.bad && e.x0 >= I.left - .5 && e.x1 <= I.left + vw + .5 && e.y0 >= I.top - .5 && e.y1 <= I.top + vh + .5) break; s.w *= 1.02; centre(); limit(s, ta); }
      return viewOf(s);
    }
    function startFly(v, dur) {
      const to = stateOf(v), ta = areaObj(to.cx, to.cz);
      if (ta !== area) { // another area: cut to a view a little wider than the target, same centre, facing north, and settle in from there
        area = ta; to.th = 0; to.off = 0; limit(to); Object.assign(cur, to, { w: to.w * 1.45 }); limit(cur); needs = true; shadowDirty = true;
        if (glc.animate && !RM.matches) for (const el of [glc, lbl]) el.animate([{ opacity: .15 }, { opacity: 1 }], { duration: 380, easing: 'ease-out' });
      }
      const from = Object.assign({}, cur); limit(to);
      const d = Math.hypot(to.cx - from.cx, to.cz - from.cz);
      const wArc = Math.max(from.w, to.w, d * 1.1), bump = Math.max(0, Math.log(wArc) - Math.max(Math.log(from.w), Math.log(to.w))) * .9;
      const ratio = Math.abs(Math.log(to.w / from.w)), dist = d / Math.max(from.w, to.w);
      let dth = (to.th - from.th) % (Math.PI * 2); if (dth > Math.PI) dth -= Math.PI * 2; if (dth < -Math.PI) dth += Math.PI * 2;
      fly = { from, to, dth, t0: now(), dur: dur || clamp(380 + ratio * 160 + dist * 260, 380, 900), bump };
      mode = 'fly'; Object.assign(goal, to); kick();
    }
    function stepFly(t) {
      const e = easeOut(clamp((t - fly.t0) / fly.dur, 0, 1)), f = fly.from, g = fly.to;
      cur.w = Math.exp(lerp(Math.log(f.w), Math.log(g.w), e) + fly.bump * Math.sin(Math.PI * e));
      cur.cx = lerp(f.cx, g.cx, e); cur.cz = lerp(f.cz, g.cz, e); cur.th = f.th + fly.dth * e; cur.off = lerp(f.off, g.off, e);
      if (e >= 1) { Object.assign(cur, g); fly = null; mode = 'still'; }
    }
    // what is under a screen point for a state (the top of a block, or the water) and its height, and the move of the centre that
    // brings it back under that point after the state changed: pans, zooms and pinches hold on to the map itself, not to a flat plane under it
    function grabAt(s, sx, sy) { const p = pick(camOf(s), sx, sy); return { x: p.x, z: p.y, h: p.i >= 0 ? topAt(p.i) : 0 }; }
    function hold(s, g, sx, sy) { const c = camOf(s), p = planeAt(c, sx, sy, g.h * c.vex); s.cx += g.x - p[0]; s.cz += g.z - p[1]; }
    function zoomAt(sx, sy, factor, instant) { // keep what is under (sx, sy) where it is
      const b = instant ? cur : goal, a = grabAt(b, sx, sy); b.w = clamp(b.w * factor, minW(), maxW()); hold(b, a, sx, sy); limit(b);
      if (instant) { Object.assign(goal, cur); mode = 'drag'; } else if (mode !== 'smooth') { fly = null; mode = 'smooth'; }
      userMoved = true; kick();
    }
    function setTilt(s, d) { const a = phAuto(dOf(s.w)); s.off = clamp(phOf(s.w, s.off) + d, PH_MIN, Math.min(PH_MAX, a + PH_ADD)) - a; }

    // ---- the scene ----
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; renderer.shadowMap.autoUpdate = false;
    const coarse = matchMedia('(pointer: coarse)').matches;
    const scene = new THREE.Scene(); scene.fog = new THREE.Fog(0xffffff, 100, 1000);
    const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 10000);
    const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1), key = new THREE.DirectionalLight(0xffffff, 1);
    key.castShadow = true; key.shadow.mapSize.set(coarse ? 2048 : 4096, coarse ? 2048 : 4096); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.6;
    scene.add(hemi, key, key.target);
    const landG = new THREE.Group(); scene.add(landG);                     // everything that stands on the land: its heights stretch with the zoom
    const secG = new THREE.Group(); landG.add(secG);
    const C3 = new THREE.Color(), col = hex => { C3.set(hex); return [C3.r, C3.g, C3.b]; };
    let tiles = null, tileMesh = null, tilePos = null, tileCol = null, baseY = null, tileS = null, landMesh = null, landS = null, bridges = null, icons = [], cityParts = [];
    let rim = null, rimPos = null, flags = null, books = null, waterTex = null, wcv = null, wbox = null, wsc = 1, beam = null, nightBuilt = false, scatter = null, shadowDirty = true, vex = 1, lmScale = 1, sh = {}, lightBasis = null;
    const tileMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0 }), landMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0, roughness: 0.95 });
    const farMat = new THREE.MeshStandardMaterial({ metalness: 0, roughness: 0.95 }), waterMat = new THREE.MeshStandardMaterial({});
    const inlandMat = new THREE.MeshStandardMaterial({ metalness: 0, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const markMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0, roughness: 0.6 });
    function meshOf(S, mat) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(S.pos), 3)); g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(S.nor), 3));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(S.pos.length), 3)); g.setIndex(new THREE.BufferAttribute(new Uint32Array(S.idx), 1));
      g.computeBoundingSphere(); g.computeBoundingBox(); return new THREE.Mesh(g, mat);
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
    builtMat.onBeforeCompile = s => {
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nattribute float glow;\nvarying float vGlow;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = glow;');
      s.uniforms.uPane = paneU.uPane; s.uniforms.uPaneK = paneU.uPaneK; s.uniforms.uAmb = paneU.uAmb;
      s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vGlow;\nuniform sampler2D uPane;\nuniform float uPaneK;\nuniform float uAmb;').replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= vGlow < 0.0 ? -vGlow * vColor.rgb * 2.4 : vec3(vGlow);\ntotalEmissiveRadiance += vColor.rgb * uAmb;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= 1.0 - uPaneK * step(0.01, vGlow) * texture2D(uPane, vEmissiveMapUv).g;');
    };
    const built = []; // { mesh, mat (material index per vertex), names, shade }
    const addBuilt = (b, shadow = true, parent = landG) => { const m = new THREE.Mesh(b.geometry, builtMat); m.castShadow = shadow; m.receiveShadow = true; parent.add(m); built.push({ mesh: m, mat: b.mat, names: b.names, shade: b.shade }); return m; };
    // night lights: soft additive points (bridge cables, beacons, the Strip) and a scatter of city lights over the places
    const lightMat = new THREE.ShaderMaterial({
      uniforms: { uScale: { value: 1 }, uMin: { value: 1 }, uGain: { value: 1 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: 'attribute float size; attribute vec3 tint; varying vec3 vTint; varying float vFade; uniform float uScale; uniform float uMin;\nvoid main(){ vTint = tint; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; float px = size * uScale / max(0.001, -mv.z); vFade = clamp(px / uMin, 0.25, 1.0); gl_PointSize = max(px, uMin); }',
      fragmentShader: 'varying vec3 vTint; varying float vFade; uniform float uGain;\nvoid main(){ float r = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, r); a = a * a * (0.35 + 0.65 * smoothstep(0.55, 0.0, r)); gl_FragColor = vec4(vTint * a * vFade * uGain, 1.0); }',
    });
    const lightSets = [];
    function pointsOf(list, parent) {
      if (!list || !list.length) return null; const g = new THREE.BufferGeometry(), Pp = new Float32Array(list.length * 3), S = new Float32Array(list.length), Tt = new Float32Array(list.length * 3);
      list.forEach((l, i) => { Pp[i * 3] = l.x; Pp[i * 3 + 1] = l.y; Pp[i * 3 + 2] = l.z; S[i] = l.size * 0.34; const c = col(LIGHTS[l.kind] || l.kind); Tt[i * 3] = c[0]; Tt[i * 3 + 1] = c[1]; Tt[i * 3 + 2] = c[2]; });
      g.setAttribute('position', new THREE.BufferAttribute(Pp, 3)); g.setAttribute('size', new THREE.BufferAttribute(S, 1)); g.setAttribute('tint', new THREE.BufferAttribute(Tt, 3)); g.computeBoundingSphere();
      const pts = new THREE.Points(g, lightMat); pts.visible = !!(LK && LK.lights); pts.renderOrder = 5; (parent || landG).add(pts); lightSets.push(pts); return pts;
    }
    const ground = (x, z) => { const i = hoodAt(x, z); return i >= 0 ? HT[i] : land.LAND_TOP; };

    // The scene is built after the constructor has returned, in steps with a breath between them, so the app's first paint does not
    // wait for the map; until the first 3D frame the stage shows its water colour. The camera, the fits and the hit tests need none of it.
    function build() {
      const steps = [
        () => { // the blocks
          const t0 = now(), ol = land.blocks(), tb = land.buildTiles(ol); stat.blocks = ol.from; tiles = tb.tiles; tileS = tb.mesh;
          tileMesh = meshOf(tileS, tileMat); tileMesh.castShadow = tileMesh.receiveShadow = true; landG.add(tileMesh);
          tilePos = tileMesh.geometry.attributes.position; tileCol = tileMesh.geometry.attributes.color; baseY = new Float32Array(tileS.n); for (let i = 0; i < tileS.n; i++) baseY[i] = tileS.pos[i * 3 + 1];
          tileMesh.geometry.boundingBox.max.y += LIFT; tileMesh.geometry.boundingSphere.radius += LIFT;
          // a hairline in the paper's colour round the top of every block (the flat map's line between places), from the region
          // scale inwards: it keeps the tops apart where the rounded edge is too fine to see
          { const segs = []; tiles.forEach(t => { t.r0 = segs.length; segs.push(...ringSegs(t.edge)); t.r1 = segs.length; }); rim = new THREE.Mesh(ribbon(segs, 0, 1), lineMat(P.paper, .5)); rim.renderOrder = 1; rim.frustumCulled = false; rimPos = rim.geometry.attributes.position; tiles.forEach(t => rimY(t, 0)); secG.add(rim); }
          stat.build.blocks = now() - t0;
        },
        () => { // the bridges, the landmarks, the flag and the bookmark
          const t0 = now(); bridges = MD.bridges(ground); addBuilt(bridges);
          icons = MD.icons(ground); icons.forEach(ic => { ic.mesh = addBuilt(ic); ic.hood = hoodAt(ic.x, ic.z); ic.lm = LM_ID[ic.id]; ic.mesh.position.set(ic.x, ic.y, ic.z); });
          const inst = model => { const m = new THREE.InstancedMesh(model.geometry, markMat, HOODS.length); m.count = 0; m.castShadow = true; m.frustumCulled = false; landG.add(m); built.push({ mesh: m, mat: model.mat, names: model.names, shade: model.shade }); return m; };
          flags = inst(MD.flag()); books = inst(MD.bookmark()); stat.build.models = now() - t0;
        },
        () => { // the quiet land, the far land, the inland water, the sea
          const t0 = now(); landS = land.buildLand(); landMesh = meshOf(landS, landMat); landMesh.receiveShadow = true; landG.add(landMesh);
          const ex = land.extent(landS), [x0, z0, x1, z1] = ex.farLand;
          { // far land: the Central Valley east of the counties and the desert around the Strip, one flat sheet; and (the tilted view sees past the flat map's canvas) the land north, north-east and south of the counties, roughed in
            const g = new THREE.BufferGeometry(), y = land.LAND_TOP - 0.03, Pp = [], N = [], I = [];
            const sheets = [[[x0, z0], [x0, z1], [x1 + 3000, z1], [x1 + 3000, z0]], [[-262, -4000], [-262, 75], [x0 + 5, 75], [x0 + 5, -4000]], [[780, 75], [780, 440], [x0 + 5, 440], [x0 + 5, 75]],
              [[486, 1373], [560, 1426], [640, 1470], [690, 1482], [750, 1481], [800, 1540], [815, 1600], [790, 1680], [760, 1720], [800, 1800], [900, 2100], [x0 + 5, 2500], [x0 + 5, 1373]]];
            for (const poly of sheets) { const k = Pp.length / 3, f = land.tri2(poly, []); for (const p of poly) { Pp.push(p[0], y, p[1]); N.push(0, 1, 0); }
              for (const t of f) { const a = poly[t[0]], b2 = poly[t[1]], c = poly[t[2]], cr = (b2[0] - a[0]) * (c[1] - a[1]) - (b2[1] - a[1]) * (c[0] - a[0]); if (cr > 0) I.push(k + t[0], k + t[2], k + t[1]); else I.push(k + t[0], k + t[1], k + t[2]); } }
            g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Pp), 3)); g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(N), 3)); g.setIndex(I);
            const m = new THREE.Mesh(g, farMat); m.receiveShadow = true; landG.add(m); }
          { const Wt = land.buildInland((x, y, i) => { const j = hoodAt(x, y); return j >= 0 && j !== i; }), g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Wt.pos), 3)); g.setIndex(new THREE.BufferAttribute(new Uint32Array(Wt.idx), 1)); g.computeVertexNormals(); const m = new THREE.Mesh(g, inlandMat); m.receiveShadow = true; landG.add(m); }
          // the sea: one sheet, textured over the map with a soft depth gradient along every shore
          wbox = [ex.bounds[0] - 70, ex.bounds[1] - 70, ex.bounds[2] + 70, ex.bounds[3] + 70]; wsc = Math.min(1.4, 2048 / (wbox[3] - wbox[1]));
          wcv = document.createElement('canvas'); wcv.width = Math.round((wbox[2] - wbox[0]) * wsc); wcv.height = Math.round((wbox[3] - wbox[1]) * wsc); wcv.shore = ex.shore;
          waterTex = new THREE.CanvasTexture(wcv); waterTex.colorSpace = THREE.SRGBColorSpace; waterTex.anisotropy = 4; waterTex.wrapS = waterTex.wrapT = THREE.ClampToEdgeWrapping; waterMat.map = waterTex;
          { const S = 16000, cx = 500, cz = 750, g = new THREE.BufferGeometry(), Pp = [cx - S, 0, cz - S, cx - S, 0, cz + S, cx + S, 0, cz + S, cx + S, 0, cz - S], uv = [];
            for (let i = 0; i < 4; i++) uv.push((Pp[i * 3] - wbox[0]) / (wbox[2] - wbox[0]), 1 - (Pp[i * 3 + 2] - wbox[1]) / (wbox[3] - wbox[1]));
            g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Pp), 3)); g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]), 3)); g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(uv), 2)); g.setIndex([0, 1, 2, 0, 2, 3]);
            scene.add(new THREE.Mesh(g, waterMat)); }
          stat.build.land = now() - t0;
        },
        () => { const t0 = now(); applyLook(); stat.build.look = now() - t0; ready = true; needs = true; kick(); },
        () => { // after the first frame: the skylines and the Strip's resorts (by place, so each rises with its block), then the night's lights
          const t0 = now(), strip = {}; HOODS.forEach(h => { if (REGS[h.region] && REGS[h.region].away && SUBD[h.name]) strip[h.name] = SUBD[h.name]; });
          cityParts = MD.city((x, z) => { const i = hoodAt(x, z); return i >= 0 ? HOODS[i].name : null; }, ground, strip).map(part => { part.mesh = addBuilt(part); part.hood = IDX[part.place] != null ? IDX[part.place] : -1; part.pts = dark ? pointsOf(part.lights, part.mesh) : null; return part; });
          paintBuilt(); if (dark) buildNight(); stat.build.city = now() - t0; shadowDirty = true; needs = true; kick();
        },
      ];
      let k = 0;
      const next = () => {
        try { steps[k++](); } catch (e) { // the 3D map cannot be made here: say so once in the console, and come back as the flat map
          console.error('3D map: ' + (e && e.stack || e)); try { sessionStorage.setItem('sbs-map3d-off', '1'); location.reload(); } catch (err) {} return; }
        if (k < steps.length) setTimeout(next, k === steps.length - 1 ? 60 : 0);
      };
      setTimeout(next, 0);
    }
    function buildNight() {
      if (nightBuilt || !ready) return; nightBuilt = true;
      pointsOf(bridges.lights); icons.forEach(ic => pointsOf(ic.lights, ic.mesh)); cityParts.forEach(p => { if (!p.pts) p.pts = pointsOf(p.lights, p.mesh); });
      // a scatter of small warm lights over every place, denser where it is busy: on a loose street grid, most crossings dark, so
      // it reads as blocks of lit streets, not as stars
      const R = (() => { let s = 4242; return () => (s = (s * 48271) % 2147483647) / 2147483647; })(), dens = { buzz: 1, sun: 0.55, fog: 0.5, hills: 0.4, water: 0.42, green: 0.07 }, list = [], INFO = window.INFO || {};
      HOODS.forEach((h, t) => {
        const city = DETAIL[t] > 1 || h.region === 'sf', pitch = city ? 0.6 : 2.8, keep = (dens[(INFO[h.name] || {}).vibe] || 0.4) * (city ? 0.22 : 0.12), b = BB[t], ang = h.region === 'sf' ? 0.16 : 0.5, ca = Math.cos(ang), sa = Math.sin(ang);
        const cx = (b[0] + b[2]) / 2, cz = (b[1] + b[3]) / 2, rad = Math.hypot(b[2] - b[0], b[3] - b[1]) / 2, n = Math.ceil(rad / pitch), i0 = list.length;
        for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
          if (R() > keep) continue; const u = (i + (R() - 0.5) * 0.3) * pitch, v = (j + (R() - 0.5) * 0.3) * pitch, x = cx + u * ca - v * sa, z = cz + u * sa + v * ca;
          if (x < b[0] || x > b[2] || z < b[1] || z > b[3] || !Geom.inPolys(PPD[t], x, z)) continue;
          const k = R(); list.push({ x, y: HT[t] + 0.06, z, kind: k > 0.93 ? '#cfe2ff' : k > 0.55 ? '#ffd39a' : '#ffb866', size: (city ? 0.24 : 0.8) * (0.7 + R() * 0.6) });
        }
        tiles[t].l0 = i0; tiles[t].l1 = list.length;
      });
      scatter = pointsOf(list); if (scatter) HOODS.forEach((h, t) => { if (liftV[t]) liftLights(t); });
      const lux = icons.find(i => i.id === 'luxor'); // the Luxor's sky beam
      if (lux) { const g = new THREE.CylinderGeometry(0.28, 0.05, 30, 10, 1, true); g.translate(0, lux.h + 15, 0); beam = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xbcd0ff, transparent: true, opacity: 0.09, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false })); lux.mesh.add(beam); }
    }
    // The sea's texture: the open ocean deep, lightening towards every shore, the shallows along it, and soft shadows painted on the
    // water (a contact shade on the side away from the light, each bridge deck's shadow moved by its height). The wide soft glow is
    // drawn small and stretched, which blurs it the same in every browser (canvas filters are not in all of them).
    function paintWater() {
      const c = wcv.getContext('2d'), Wp = wcv.width, Hp = wcv.height, L = LK, [bx0, bz0] = wbox;
      c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; c.filter = 'none'; c.fillStyle = L.deep; c.fillRect(0, 0, Wp, Hp);
      const path = new Path2D(); for (const l of wcv.shore) l.forEach((p, k) => k ? path.lineTo(p[0], p[1]) : path.moveTo(p[0], p[1]));
      { const q = 1 / 18, sm = document.createElement('canvas'); sm.width = Math.ceil(Wp * q); sm.height = Math.ceil(Hp * q); const g = sm.getContext('2d');
        g.setTransform(wsc * q, 0, 0, wsc * q, -bx0 * wsc * q, -bz0 * wsc * q); g.lineJoin = g.lineCap = 'round'; g.strokeStyle = L.water;
        for (const w of [300, 230, 170, 120, 84, 56, 34]) { g.globalAlpha = 0.17; g.lineWidth = w; g.stroke(path); }
        c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high'; c.drawImage(sm, 0, 0, Wp, Hp); }
      c.setTransform(wsc, 0, 0, wsc, -bx0 * wsc, -bz0 * wsc); c.lineJoin = c.lineCap = 'round'; c.strokeStyle = L.shallow;
      for (const [w, a] of [[44, .05], [30, .07], [19, .1], [11, .14], [6, .2], [2.6, .3]]) { c.globalAlpha = Math.min(1, a * L.shore); c.lineWidth = w; c.stroke(path); }
      if (L.rim) { c.globalAlpha = 0.55; c.strokeStyle = L.rim; c.lineWidth = 1.1; c.stroke(path); }
      { const az = L.key.az * Math.PI / 180, el = L.key.el * Math.PI / 180, ox = -Math.sin(az) / Math.tan(el), oz = Math.cos(az) / Math.tan(el), soft = 'filter' in c;
        c.save(); if (soft) c.filter = 'blur(1.4px)'; c.strokeStyle = '#1a2430'; c.globalAlpha = L.castA; c.lineWidth = 1.4;
        c.translate(ox * 0.6, oz * 0.6); c.stroke(path); c.translate(-ox * 0.6, -oz * 0.6);
        c.globalAlpha = L.castA * 2.2; c.lineWidth = 0.6; if (soft) c.filter = 'blur(0.8px)';
        for (const f of bridges.list) { c.beginPath(); for (let i = 0; i <= 48; i++) { const q = f.P(f.L * i / 48, 0, f.deck(f.L * i / 48)), y = Math.max(0, q[1]); if (i) c.lineTo(q[0] + ox * y, q[2] + oz * y); else c.moveTo(q[0] + ox * y, q[2] + oz * y); } c.stroke(); }
        c.restore(); }
      // the open sea beyond the map: fade the shore glow out towards the edge of the sheet
      c.setTransform(1, 0, 0, 1, 0, 0); c.globalAlpha = 1; const m = 120;
      for (const [x0, y0, x1, y1, r] of [[0, 0, 0, m, [0, 0, Wp, m]], [0, Hp, 0, Hp - m, [0, Hp - m, Wp, m]], [0, 0, m, 0, [0, 0, m, Hp]], [Wp, 0, Wp - m, 0, [Wp - m, 0, m, Hp]]]) { const g = c.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, L.deep); g.addColorStop(1, L.deep + '00'); c.fillStyle = g; c.fillRect(r[0], r[1], r[2], r[3]); }
      waterTex.needsUpdate = true;
    }

    // ---- colours ----
    // A place's fill is the app's (setColors), faded towards the land around it by its opacity (alphaFor, and the region fade); its
    // top lightens a little with its height, its rounded edge is lighter, its walls darker and warmer. The selected place takes the
    // accent on its edge and walls; the quiz's answers their green or red; the place under the pointer (or about to be picked) the ink.
    function paintTile(i) {
      const t = tiles[i]; if (t.v1 === t.v0) return;
      const c0 = colNow[i], a = alphaNow[i], L = LK, f = flagNow[i], fill = [lerp(L.land[0], LIN[c0[0] | 0], a), lerp(L.land[1], LIN[c0[1] | 0], a), lerp(L.land[2], LIN[c0[2] | 0], a)];
      let top = mix3(fill, L.liftC, clamp((t.H - land.TOP0) / 4, 0, 1) * L.liftK * 2.2 + (f & 1 ? 0.1 : 0)), bev = mix3(top, L.liftC, L.bevelK), wall = mix3(fill, L.sideC, L.sideK);
      if (f & 1) { bev = mix3(L.accent, L.liftC, 0.15); wall = mix3(L.accent, L.sideC, 0.25); }
      else if (f & 24) { bev = f & 8 ? L.okInk : L.noInk; wall = mix3(bev, L.sideC, 0.2); }
      else if (f & 4) { top = mix3(top, L.ink, 0.2); bev = mix3(L.ink, top, 0.1); }
      else if (f & 2) { top = mix3(top, L.liftC, 0.1); bev = mix3(L.ink, top, 0.3); }
      const K = tileS.kind, S = tileS.shade, A = tileCol.array;
      for (let v = t.v0; v < t.v1; v++) { const k = K[v], c = k === 0 ? top : k === 1 ? bev : wall, s = S[v]; A[v * 3] = c[0] * s; A[v * 3 + 1] = c[1] * s; A[v * 3 + 2] = c[2] * s; }
    }
    function paintBuilt() {
      for (const b of built) {
        const cols = b.names.map(n => col(LK.pal[n] || '#ff00ff')), a = b.mesh.geometry.attributes.color;
        for (let i = 0; i < b.mat.length; i++) { const c = cols[b.mat[i]], k = b.shade ? b.shade[i] : 1; a.array[i * 3] = c[0] * k; a.array[i * 3 + 1] = c[1] * k; a.array[i * 3 + 2] = c[2] * k; }
        a.needsUpdate = true;
      }
    }
    let waterKey = '';
    function applyLook() {
      const L = LK; renderer.setClearColor(L.bg, 1); scene.fog.color.set(L.bg); paintAll = true;
      { const a = landMesh.geometry.attributes.color, c = L.land; for (let v = 0; v < landS.n; v++) { a.array[v * 3] = c[0] * landS.shade[v]; a.array[v * 3 + 1] = c[1] * landS.shade[v]; a.array[v * 3 + 2] = c[2] * landS.shade[v]; } a.needsUpdate = true; }
      farMat.color.set(L.landHex); inlandMat.color.set(L.water); rim.material.color.set(P.paper);
      const wk = [L.water, L.deep, L.shallow, L.rim, L.shore].join('|'); if (wk !== waterKey) { waterKey = wk; paintWater(); }
      tileMat.roughness = L.tileRough; builtMat.roughness = L.builtRough; waterMat.roughness = L.waterRough; waterMat.metalness = L.waterMetal; builtMat.emissiveIntensity = L.glow; paneU.uPaneK.value = L.pane; paneU.uAmb.value = L.amb;
      hemi.color.set(L.hemi.sky); hemi.groundColor.set(L.hemi.ground); hemi.intensity = L.hemi.i; key.color.set(L.key.c); key.intensity = L.key.i; key.shadow.radius = L.shadowR;
      paintBuilt(); for (const m of secMeshes.values()) m.dirty = true; selKey = ''; for (const [i, e] of edgeMeshes) { drop(e.mesh); edgeMeshes.delete(i); }
      if (L.lights) buildNight(); lightSets.forEach(p => { p.visible = L.lights; }); if (beam) beam.visible = L.lights;
      shadowDirty = true; needs = true;
    }

    // ---- lifting the selected place ----
    const rimY = (t, h) => { const a = rimPos.array; for (let k = t.r0 * 3 + 1; k < t.r1 * 3; k += 3) a[k] = t.H + 0.006 + h; rimPos.needsUpdate = true; }; // 4 vertices to a segment of 4 numbers: the same count
    function liftLights(i) { const t = tiles[i]; if (!scatter || t.l0 == null) return; const a = scatter.geometry.attributes.position; for (let k = t.l0; k < t.l1; k++) a.array[k * 3 + 1] = HT[i] + 0.06 + liftV[i]; a.needsUpdate = true; }
    function setLift(i, h) {
      liftV[i] = h; const t = tiles[i], K = tileS.kind, A = tilePos.array;
      for (let v = t.v0; v < t.v1; v++) if (K[v] !== 3 && K[v] !== 4) A[v * 3 + 1] = baseY[v] + h;
      tilePos.needsUpdate = true; rimY(t, h); liftLights(i); shadowDirty = true;
    }
    function stepLifts(t) { // the selected place rises with a small overshoot; the one it replaces settles back
      for (let i = 0; i < HOODS.length; i++) { const to = i === sel ? LIFT : 0, a = liftAnim.get(i); if ((a ? a.to : liftV[i]) !== to) liftAnim.set(i, { from: liftV[i], to, t0: t }); }
      let anim = false;
      for (const [i, a] of liftAnim) { const p = RM.matches ? 1 : clamp((t - a.t0) / (a.to ? 520 : 260), 0, 1); if (p >= 1) { setLift(i, a.to); liftAnim.delete(i); } else { setLift(i, a.to ? a.from + (a.to - a.from) * backOut(p) : a.from * Math.pow(1 - p, 3)); anim = true; } }
      return anim;
    }

    // ---- sections: lines on the flat top of a place, the selected one outlined ----
    // A line is a ribbon lying on the top, as wide on screen as a stroke: each vertex is moved sideways in the shader by a width in
    // pixels times the ground a pixel covers at the centre.
    const lineW = { value: 1 }, secMeshes = new Map(), edgeMeshes = new Map(); let selKey = '', selMeshes = [];
    function lineMat(hex, opacity) {
      const m = new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide });
      m.onBeforeCompile = s => { s.uniforms.uW = lineW; s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aOff;\nuniform float uW;').replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += aOff * uW;'); };
      return m;
    }
    function ribbon(segs, y, px) { // segs: [ax, ay, bx, by, ...] in map units; px: the stroke's width
      const n = segs.length / 4, Pp = new Float32Array(n * 12), Of = new Float32Array(n * 12), I = new Uint32Array(n * 6);
      for (let s = 0; s < n; s++) {
        const ax = segs[s * 4], ay = segs[s * 4 + 1], bx = segs[s * 4 + 2], by = segs[s * 4 + 3], l = Math.hypot(bx - ax, by - ay) || 1, dx = (bx - ax) / l * px / 2, dy = (by - ay) / l * px / 2;
        [[ax, ay, -dx + dy, -dy - dx], [ax, ay, -dx - dy, -dy + dx], [bx, by, dx + dy, dy - dx], [bx, by, dx - dy, dy + dx]].forEach((q, k) => { const p = (s * 4 + k) * 3; Pp[p] = q[0]; Pp[p + 1] = y; Pp[p + 2] = q[1]; Of[p] = q[2]; Of[p + 2] = q[3]; });
        I.set([s * 4, s * 4 + 1, s * 4 + 2, s * 4 + 1, s * 4 + 3, s * 4 + 2], s * 6);
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(Pp, 3)); g.setAttribute('aOff', new THREE.BufferAttribute(Of, 3)); g.setIndex(new THREE.BufferAttribute(I, 1)); g.computeBoundingSphere(); return g;
    }
    const ringSegs = rings => { const s = []; for (const r of rings) for (let a = 0, b = r.length - 1; a < r.length; b = a++) s.push(r[b][0], r[b][1], r[a][0], r[a][1]); return s; };
    const drop = m => { secG.remove(m); m.geometry.dispose(); m.material.dispose(); };
    // A place's sections as they lie on its block: the flat map's own cut (Geom.clipHalf between the same seeds, as Geom.cells makes
    // it), made on the outline of the block's top instead of the place's boundary, so no line or tint hangs over the edge. Hits
    // still go through the flat map's subIndexAt: the same seeds, the same partition
    const topCellCache = [];
    function topCells(i) {
      if (topCellCache[i]) return topCellCache[i];
      const seeds = (SUBD[HOODS[i].name] || []).map(q => proj([q.lon, q.lat]));
      return topCellCache[i] = seeds.map((sd, j) => { const out = []; for (const piece of tiles[i].tops) { let ring = piece[0]; for (let q = 0; q < seeds.length && ring.length; q++) { if (q === j) continue; const t = seeds[q]; ring = Geom.clipHalf(ring, (sd[0] + t[0]) / 2, (sd[1] + t[1]) / 2, t[0] - sd[0], t[1] - sd[1]); } if (ring.length >= 3 && Math.abs(Geom.area(ring)) > 1e-4) out.push(ring); } return out; });
    }
    // the lines between a place's sections (the cut edges with the top on both sides: its own outline is the block's edge), and the outlines of its starred ones
    function sectionLines(i) {
      const cells = subsOf(i), tc = topCells(i), tops = tiles[i].tops, segs = [], gold = [], seen = new Set();
      tc.forEach((rings, j) => {
        if (cells[j] && cells[j].star) gold.push(...ringSegs(rings));
        for (const r of rings) for (let a = 0, b = r.length - 1; a < r.length; b = a++) {
          if (!r[a].cut || !r[b].cut) continue;
          const ax = r[b][0], ay = r[b][1], bx = r[a][0], by = r[a][1], dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy); if (l < 1e-4) continue;
          const mx = (ax + bx) / 2, my = (ay + by) / 2, e = Math.min(.05, l / 4), nx = -dy / l * e, ny = dx / l * e;
          if (!Geom.inPolys(tops, mx + nx, my + ny) || !Geom.inPolys(tops, mx - nx, my - ny)) continue;
          const k = Math.round(mx * 50) + ',' + Math.round(my * 50); if (seen.has(k)) continue; seen.add(k); segs.push(ax, ay, bx, by);
        }
      });
      return { segs, gold };
    }
    function updateSections(subF) {
      for (const [i, m] of secMeshes) if (!(subF[i] > 0.01)) { m.lines.visible = false; if (m.gold) m.gold.visible = false; }
      for (let i = 0; i < HOODS.length; i++) {
        if (!(subF[i] > 0.01)) continue;
        let m = secMeshes.get(i);
        if (!m || m.dirty) { if (m) { drop(m.lines); if (m.gold) drop(m.gold); } const s = sectionLines(i); m = { lines: new THREE.Mesh(ribbon(s.segs, HT[i] + 0.012, 1.1), lineMat(P.subLine, 1)), gold: s.gold.length ? new THREE.Mesh(ribbon(s.gold, HT[i] + 0.014, 2.4), lineMat(P.star, 1)) : null }; m.lines.renderOrder = 2; secG.add(m.lines); if (m.gold) { m.gold.renderOrder = 3; secG.add(m.gold); } secMeshes.set(i, m); }
        m.lines.visible = true; m.lines.material.opacity = subF[i] * (dark ? .8 : .9); m.lines.position.y = liftV[i];
        if (m.gold) { m.gold.visible = true; m.gold.material.opacity = subF[i]; m.gold.position.y = liftV[i]; }
      }
      if (secMeshes.size > 40) for (const [i, m] of secMeshes) if (!m.lines.visible) { drop(m.lines); if (m.gold) drop(m.gold); secMeshes.delete(i); }
      // the selected section: outlined in the accent (harder on the phone, and tinted there unless it is starred); the section under the pointer in ink
      const ph = isPhone(), cells = sel >= 0 ? subsOf(sel) : null, sp = cells && selSub >= 0 ? cells[selSub] : null, hv = cells && hover === sel && hoverSub >= 0 && hoverSub !== selSub ? cells[hoverSub] : null, tc = sp || hv ? topCells(sel) : null;
      const k = [sel, sp ? selSub : -1, hv ? hoverSub : -1, ph, dark].join('|');
      if (k !== selKey) {
        selKey = k; selMeshes.forEach(drop); selMeshes = [];
        const add = (geo, mat, order) => { const m = new THREE.Mesh(geo, mat); m.renderOrder = order; secG.add(m); selMeshes.push(m); };
        if (sp) {
          add(ribbon(ringSegs(tc[selSub]), HT[sel] + 0.016, ph ? 2.8 : 1.8), lineMat(P.accent, 1), 4);
          if (ph && !sp.star) { const Pp = [], I = []; for (const r of tc[selSub]) { const b = Pp.length / 3; let f = []; try { f = land.tri2(r, []); } catch (e) {} for (const p of r) Pp.push(p[0], HT[sel] + 0.008, p[1]); for (const t of f) I.push(b + t[0], b + t[1], b + t[2]); }
            const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Pp), 3)); g.setAttribute('aOff', new THREE.BufferAttribute(new Float32Array(Pp.length), 3)); g.setIndex(I); g.computeBoundingSphere(); add(g, lineMat(P.accent, .16), 1); }
        }
        if (hv) add(ribbon(ringSegs(tc[hoverSub]), HT[sel] + 0.015, 1.2), lineMat(P.ink, 1), 4);
      }
      for (const m of selMeshes) m.position.y = sel >= 0 ? liftV[sel] : 0;
      // a place's own outline, round the edge of its top: the accent on the selected one (thinner on the phone once a section is
      // picked, as in the flat map), the quiz's green or red, the ink under the pointer or a finger about to pick
      for (let i = 0; i < HOODS.length; i++) {
        const f = flagNow[i], o2 = edgeMeshes.get(i), want = !f ? '' : f & 1 ? P.accent + '|' + (sp && ph ? 1.4 : 2.2) : f & 8 ? P.okInk + '|2.6' : f & 16 ? P.noInk + '|2.6' : f & 4 ? P.ink + '|2.6' : P.ink + '|1.4';
        if (o2 && o2.key !== want) { drop(o2.mesh); edgeMeshes.delete(i); }
        if (want && !edgeMeshes.has(i)) { const [hex, px] = want.split('|'), m = new THREE.Mesh(ribbon(ringSegs(tiles[i].edge), HT[i] + 0.018, +px), lineMat(hex, 1)); m.renderOrder = 5; secG.add(m); edgeMeshes.set(i, { mesh: m, key: want }); }
        if (want) edgeMeshes.get(i).mesh.position.y = liftV[i];
      }
    }
    // how strongly a place's sections show, as in the flat map: from 300 px across, or as soon as it is selected and big enough
    function subFactor(i) { if (quiz) return 0; const px = hoodPx(i); let f = smooth(px, 300, 560); if (i === sel) f = Math.max(f, px > (isPhone() ? 110 : 150) ? 1 : 0); return f > 0 && subsOf(i) ? f : 0; }

    // ---- one frame of the scene ----
    const lightDir = new THREE.Vector3(), lightCam = new THREE.OrthographicCamera(), m4 = new THREE.Matrix4(), qt = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), v3 = new THREE.Vector3(), yAxis = new THREE.Vector3(0, 1, 0), xAxis = new THREE.Vector3(1, 0, 0), q2 = new THREE.Quaternion();
    let C = null, viewBB = [0, 0, 0, 0], subF = [];
    function updateScene(t, vx) {
      const c = C, L = LK;
      camera.position.set(c.px, c.py, c.pz); camera.up.set(0, 1, 0); camera.lookAt(cur.cx, FOCUS_Y, cur.cz);
      camera.near = Math.max(0.5, c.d * 0.05); camera.far = c.d * 14 + 600; camera.aspect = W / H; camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
      scene.fog.near = c.d * L.fog[0]; scene.fog.far = c.d * L.fog[1];
      if (Math.abs(vx - vex) > 0.003) { vex = vx; landG.scale.y = vex; shadowDirty = true; }
      c.vex = vex;
      // the landmarks grow a little as the map zooms out, so the skyline reads from across the bay; each stands on its block
      const k = clamp(Math.pow(c.d / 150, 0.7), 1, 2.6); if (Math.abs(k - lmScale) > 0.004) { lmScale = k; shadowDirty = true; }
      const show = !quiz; // the quiz hides the landmarks and the skylines, as the flat map hides its glyphs: they are hints
      for (const ic of icons) { if (ic.mesh.visible !== show) { ic.mesh.visible = show; shadowDirty = true; } ic.mesh.scale.set(lmScale, lmScale / vex, lmScale); ic.mesh.position.y = ic.hood >= 0 ? topAt(ic.hood) : ic.y; }
      for (const p of cityParts) { p.mesh.visible = show; const sy = (1 + (lmScale - 1) * 0.6) / vex; p.mesh.scale.y = sy; p.mesh.position.y = p.hood >= 0 ? HT[p.hood] * (1 - sy) + liftV[p.hood] : 0; } // stretched from the top of its block, not from the water
      // flags and bookmarks hold their size on screen, within limits, and face the reader; seen from above (the far zoom) they lean
      // back, so a pole is never seen end on
      const marks = quiz || !o.marks ? [] : o.marks(); let nf = 0, nb = 0, pop = false; qt.setFromAxisAngle(yAxis, cur.th).multiply(q2.setFromAxisAngle(xAxis, -Math.max(0, Math.PI / 2 - c.ph - 0.6)));
      for (let i = 0; i < HOODS.length; i++) {
        const m = marks[i]; if (!m) continue; const h = HOODS[i], y = topAt(i), zc = (h.cx - c.px) * c.fx + (y * vex - c.py) * c.fy + (h.cy - c.pz) * c.fz; if (zc <= 0) continue;
        let s = clamp((m === 'flag' ? 20 : 17) * zc / c.g, 0.5, MARK_MAX);
        if (markAnim[i]) { const p = (t - markAnim[i]) / 420; if (p < 1) { s *= 1 + Math.sin(p * Math.PI) * .6 * (1 - p); pop = true; } else delete markAnim[i]; }
        m4.compose(ps.set(h.cx, y, h.cy), qt, sc.set(s, s / vex, s)); if (m === 'flag') flags.setMatrixAt(nf++, m4); else books.setMatrixAt(nb++, m4);
      }
      if (flags.count !== nf || books.count !== nb) shadowDirty = true;
      flags.count = nf; books.count = nb; flags.instanceMatrix.needsUpdate = books.instanceMatrix.needsUpdate = true;
      // sections
      lineW.value = 1 / kNow(); updateSections(subF); rim.material.opacity = (dark ? .5 : .55) * smooth(kNow(), 1.5, 6); rim.visible = rim.material.opacity > .01;
      // the key light's shadow box is fitted to what the camera sees (the ground under the screen, out to a few view distances, and
      // the height of the tallest things), in the light's own fixed frame; its size moves in steps and its edges snap to whole shadow
      // texels, so a pan moves the shadows by whole texels (nothing crawls) and a zoom changes them only at a step
      { const az = L.key.az * Math.PI / 180, el = L.key.el * Math.PI / 180, A = area.r;
        lightDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
        if (!lightBasis || lightBasis.az !== az || lightBasis.el !== el || lightBasis.A !== A) {
          const ax = (A[0] + A[2]) / 2, az2 = (A[1] + A[3]) / 2;
          key.target.position.set(ax, 0, az2); key.position.set(ax + lightDir.x * 4000, lightDir.y * 4000, az2 + lightDir.z * 4000); key.target.updateMatrixWorld(); key.updateMatrixWorld();
          lightCam.position.copy(key.position); lightCam.up.set(0, 1, 0); lightCam.lookAt(key.target.position); lightCam.updateMatrixWorld(); lightBasis = { az, el, A, inv: lightCam.matrixWorldInverse.clone() }; shadowDirty = true;
        }
        const reach = c.d * 2.4, hTop = 7 * vex, pts = [];
        for (const [sx, sy] of [[0, 0], [W / 2, 0], [W, 0], [0, H / 2], [W, H / 2], [0, H], [W / 2, H], [W, H]]) {
          let g = planeAt(c, sx, sy, FOCUS_Y); const dx = g[0] - cur.cx, dz = g[1] - cur.cz, l = Math.hypot(dx, dz); if (l > reach) g = [cur.cx + dx / l * reach, cur.cz + dz / l * reach];
          pts.push(g);
        }
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        for (const g of pts) for (const y of [0, hTop]) { v3.set(g[0], y, g[1]).applyMatrix4(lightBasis.inv); x0 = Math.min(x0, v3.x); x1 = Math.max(x1, v3.x); y0 = Math.min(y0, v3.y); y1 = Math.max(y1, v3.y); z0 = Math.min(z0, v3.z); z1 = Math.max(z1, v3.z); }
        const Wb = Math.pow(1.12, Math.ceil(Math.log(Math.max(x1 - x0, y1 - y0, 4) + 2) / Math.log(1.12))), tx = Wb / key.shadow.mapSize.x;
        const L0 = Math.floor((x0 + x1 - Wb) / 2 / tx) * tx, B0 = Math.floor((y0 + y1 - Wb) / 2 / tx) * tx, N0 = Math.max(1, Math.floor((-z1 - 40) / 50) * 50), F0 = Math.ceil((-z0 + 40) / 50) * 50;
        if (L0 !== sh.l || B0 !== sh.b || Wb !== sh.w || N0 !== sh.n || F0 !== sh.f || shadowDirty) {
          sh = { l: L0, b: B0, w: Wb, n: N0, f: F0 }; const sc2 = key.shadow.camera;
          sc2.left = L0; sc2.right = L0 + Wb; sc2.bottom = B0; sc2.top = B0 + Wb; sc2.near = N0; sc2.far = F0; sc2.updateProjectionMatrix();
          key.shadow.normalBias = tx * 2.2; key.shadow.bias = -0.0006; renderer.shadowMap.needsUpdate = true; shadowDirty = false;
        }
      }
      lightMat.uniforms.uScale.value = H * pr / (2 * Math.tan(FOV * Math.PI / 360)); lightMat.uniforms.uMin.value = 1.4 * pr;
      return pop;
    }
    // which places are in sight (their boxes against the ground the screen covers), how strongly their sections show, and what has
    // to be painted again: a place whose opacity, state or colour changed
    function prepare(dt) {
      const c = C; let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, anim = false;
      for (const [sx, sy] of [[0, 0], [W, 0], [0, H], [W, H]]) { const g = planeAt(c, sx, sy, 0); x0 = Math.min(x0, g[0]); x1 = Math.max(x1, g[0]); y0 = Math.min(y0, g[1]); y1 = Math.max(y1, g[1]); }
      viewBB = [x0 - 4, y0 - 4, x1 + 4, y1 + 4];
      // the region fade follows the camera, as in the flat map: a hand pan or zoom fades it out, the next flight brings it back
      const farOn = !userMoved || !!quiz, f0 = farA[0], tgt = farOn ? 1 : 0;
      if (region === 'all' || RM.matches) farA[0] = tgt; else if (Math.abs(tgt - farA[0]) < 0.01) farA[0] = tgt; else { farA[0] += (tgt - farA[0]) * (1 - Math.exp(-dt / 160)); anim = true; }
      const pk = quiz ? (press >= 0 ? press : hover) : -1, okM = new Set(), noM = new Set(); if (quiz) for (const m of quiz.marks()) { if (m.dot && !m.name) continue; (m.ok ? okM : noM).add(m.i); }
      for (let i = 0; i < HOODS.length; i++) {
        const bb = BB[i], vis = bb[2] > viewBB[0] && bb[0] < viewBB[2] && bb[3] > viewBB[1] && bb[1] < viewBB[3];
        const far = region !== 'all' && HOODS[i].region !== region && i !== sel, a = (o.alphaFor ? o.alphaFor(i) : 1) * (far ? lerp(1, .32, farA[0]) : 1);
        subF[i] = vis ? subFactor(i) * (far ? 1 - farA[0] : 1) : 0; // a place faded with its region keeps its sections to itself
        const f = (i === sel ? 1 : 0) | (i === hover && i !== sel && !quiz ? 2 : 0) | (pk === i && quiz.pick(i) ? 4 : 0) | (okM.has(i) ? 8 : 0) | (noM.has(i) ? 16 : 0);
        if (paintAll || f !== flagNow[i] || Math.abs(a - alphaNow[i]) > 0.002) { flagNow[i] = f; alphaNow[i] = a; if (tiles) { paintTile(i); tileCol.needsUpdate = true; } needs = true; }
      }
      if (tiles) paintAll = false;
      return anim || farA[0] !== f0;
    }

    // ---- names, spots and the quiz's pills: the 2D canvas over the scene ----
    if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', () => { measureCache.clear(); kick(); });
    // widths scale linearly with size for a given face, so measure once at 20px and scale (js/map.js)
    function measure(text, weight, size) { const key = weight + '|' + text; let w = measureCache.get(key); if (w == null) { if (supportsLS) ctx.letterSpacing = '0px'; ctx.font = `${weight} 20px Figtree, system-ui, sans-serif`; w = ctx.measureText(text).width; if (!document.fonts || document.fonts.status !== 'loading') measureCache.set(key, w); } return w * size / 20; }
    function haloText(text, x, y, size, color) { const r = Math.max(1, size * .11); ctx.fillStyle = P.labelHalo; for (let q = 0; q < 6; q++) { const a = q * Math.PI / 3; ctx.fillText(text, x + Math.cos(a) * r, y + Math.sin(a) * r); } ctx.fillStyle = color; ctx.fillText(text, x, y); }
    function haloStar(x, y, size) { starPath(ctx, x, y, size * .5); ctx.strokeStyle = P.labelHalo; ctx.lineWidth = Math.max(2, size * .26); ctx.lineJoin = 'round'; ctx.stroke(); ctx.fillStyle = P.star; ctx.fill(); }
    const at = (x, y, h) => project(C, x, h * C.vex, y);                 // a map point at a height, on screen
    const bboxOn = i => { const b = BB[i], h = topAt(i); let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of [[b[0], b[1]], [b[2], b[1]], [b[0], b[3]], [b[2], b[3]]]) { const p = at(x, y, h); x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); } return [x0, y0, x1, y1]; };
    function drawOverlay(t, dt) {
      const c = C, k = kNow(), phone = isPhone(), fsz = phone ? 10.5 : 11.5, I = insets(); let anim = false;
      ctx.setTransform(pr, 0, 0, pr, 0, 0); ctx.clearRect(0, 0, W, H); ctx.textBaseline = 'middle'; ctx.textAlign = 'center'; ctx.globalAlpha = 1; if (supportsLS) ctx.letterSpacing = '0px';
      const placed = [], clash = (b, self) => placed.some(q => (q.own == null || q.own !== self) && b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1]);
      if (o.occluders) for (const b of o.occluders()) placed.push(b);     // floating chrome over the canvas
      if (!north.hidden) { const r = north.getBoundingClientRect(), s = stage.getBoundingClientRect(); placed.push([r.left - s.left - 4, r.top - s.top - 4, r.right - s.left + 4, r.bottom - s.top + 4]); }
      const marks = quiz || !o.marks ? [] : o.marks(), farOn = !userMoved || !!quiz;
      const want = new Map(), put = (id, rec) => { want.set(id, rec); };
      const cosT = Math.max(.35, Math.cos(c.ph)), inView = b => !phone || (b[0] >= 2 && b[2] <= W - 2 && b[1] >= 0 && b[3] <= H);

      // the landmarks: a model's footprint on screen, or (the ones with no model yet) the flat map's glyph standing at its point.
      // Tappable when the flat map would show them, and never under a name
      const lmK = k * (area.detail > 1 ? 2 : 1), lmF = quiz ? 0 : smooth(lmK, 7, 10.5), lmH = clamp(lmK * 1.7, 16, 44), glyphs = []; lmBox = [];
      const model = {}; for (const ic of icons) if (ic.lm != null) model[ic.lm] = ic;
      LANDS.forEach((l, j) => {
        const hi = IDX[l.hood], far = farOn && region !== 'all' && hi != null && HOODS[hi].region !== region, ic = model[j];
        if (ic) {
          const s = ic.mesh.scale.x, y = ic.mesh.position.y, a = at(ic.x, ic.z, y), b = at(ic.x, ic.z, y + ic.h * s / c.vex); if (a[2] <= 0 || b[2] <= 0) return;
          const hpx = a[1] - b[1], wpx = ic.r * s * c.g / a[2], box = [Math.min(a[0], b[0]) - wpx * .55, b[1] - 2, Math.max(a[0], b[0]) + wpx * .55, a[1] + 2];
          if (hpx < 8 || box[2] < 0 || box[0] > W || box[3] < 0 || box[1] > H) return;
          if (quiz) return; placed.push(box); if (lmF > .5 && hpx >= 12 && !far) lmBox[j] = box;
          return;
        }
        const h = hi != null ? topAt(hi) : 0, p = at(l.x, l.y, h), on = p[2] > 0 && p[0] > -60 && p[0] < W + 60 && p[1] > -60 && p[1] < H + 60;
        const tg = on && !far && ready ? lmF : 0; if (Math.abs(tg - lmA[j]) < .01) lmA[j] = tg; else { lmA[j] += (tg - lmA[j]) * (1 - Math.exp(-dt / 180)); anim = true; }
        if (!(lmA[j] > .01) || !on) return;
        const box = [p[0] - lmH * (l.w || 1) / 2, p[1] - lmH, p[0] + lmH * (l.w || 1) / 2, p[1]]; glyphs.push([l, j, p]);
        if (lmA[j] > .3) placed.push([box[0] - 2, box[1] - 2, box[2] + 2, box[3] + 2]); if (lmA[j] > .5) lmBox[j] = box;
      });
      // flags and bookmarks stand at the anchors: names keep clear of them
      const anchor = HOODS.map((h, i) => { const b = BB[i]; return b[2] > viewBB[0] && b[0] < viewBB[2] && b[3] > viewBB[1] && b[1] < viewBB[3] ? at(h.cx, h.cy, topAt(i)) : null; });
      for (let i = 0; i < HOODS.length; i++) if (marks[i] && anchor[i] && anchor[i][2] > 0) { const p = anchor[i], s = clamp((marks[i] === 'flag' ? 20 : 17) * p[2] / c.g, 0.5, MARK_MAX) * c.g / p[2]; placed.push(marks[i] === 'flag' ? [p[0] - 4, p[1] - s - 2, p[0] + s * .62, p[1] + 3] : [p[0] - s * .25, p[1] - s - 2, p[0] + s * .25, p[1] + 3]); }

      if (!quiz && ready) {
        // far names in capitals, near ones in mixed case; the switch has some slack so names do not flicker between the two
        farNames = area === AREAS[0] && (farNames ? c.d > 330 : c.d > 400);
        const lsz = farNames ? fsz : fsz + 1.5, ls = farNames ? .05 : 0;
        const prio = i => (i === sel ? 1e9 : 0) + (i === hover ? 5e8 : 0) + (STAR[i] ? 2e7 : 0) + (marks[i] ? 1e7 : 0) + HOODS[i].cells;
        const order = []; for (let i = 0; i < HOODS.length; i++) if (anchor[i] && anchor[i][2] > 0) order.push(i); order.sort((a, b) => prio(b) - prio(a));
        // the regions, over the whole bay (after the selected place, before the rest)
        const regions = () => { if (farNames && c.d > 700) for (const r of REGION_LBL) { const p = at(r.p[0], r.p[1], .5); if (p[2] <= 0) continue; const size = fsz + 1, tw = measure(r.t, 600, size) + r.t.length * size * .16, b = [p[0] - tw / 2 - 3, p[1] - size * .7, p[0] + tw / 2 + 3, p[1] + size * .7]; if (inView(b) && b[2] > 0 && b[0] < W && !clash(b)) { placed.push(b); put(r.id, { text: r.t, x: p[0], y: p[1], size, ls: .16, color: P.ink2 }); } } };
        let didRegions = false;
        for (const i of order) {
          const h = HOODS[i], hot = i === sel || i === hover; if (!hot && !didRegions) { regions(); didRegions = true; }
          if (farOn && region !== 'all' && h.region !== region && !hot) continue;
          const side = DETAIL[i] > 1; if (!side && subF[i] > .6) continue;       // its sections are named instead
          const name = SHORT[h.name] || h.name, text = farNames ? name.toUpperCase() : name, size = hot ? lsz * 1.1 : lsz, st = STAR[i] ? size * 1.15 : 0;
          const tw = measure(text, 600, size) + text.length * size * ls + st, th = size * 1.2, p = anchor[i], kl = c.g / p[2], px = SIZE[i] * kl * Math.max(.6, cosT), id = 'h' + i + (farNames ? 'F' : ''), on = lblA.get(id) > .5;
          if (!hot && !side && px < ((marks[i] || STAR[i]) ? 22 : Math.max(farNames ? 40 : 30, tw * (on ? .7 : .82)))) continue;
          const cx = side ? at(SIDE_X[i], h.cy, topAt(i))[0] + 12 + tw / 2 : p[0], cy = p[1] + (marks[i] && !side ? size * 1.25 : 0), gx = phone ? 4 : 2, gy = phone ? 1 : 0;
          const boxAt = y => [cx - tw / 2 - gx, y - th / 2 - gy, cx + tw / 2 + gx, y + th / 2 + gy]; let box = boxAt(cy);
          if (clash(box, i)) for (const dy of [th * 1.15, -th * 1.15]) { const alt = boxAt(cy + dy); if (!clash(alt, i)) { box = alt; break; } }
          if (hot || (!clash(box, i) && inView(box))) { box.own = i; placed.push(box); put(id, { text, x: (box[0] + box[2]) / 2 - st / 2, y: (box[1] + box[3]) / 2, size, ls, color: hot ? P.accent : P.label, star: st ? [box[2] - gx - st * .45, size * .85] : null }); }
          else if (STAR[i] && p[0] > 0 && p[0] < W && p[1] > 0 && p[1] < H) { const sb = [p[0] - 9, p[1] - 9, p[0] + 9, p[1] + 9]; if (!clash(sb)) { placed.push(sb); put('s' + i, { text: '', x: p[0], y: p[1], size: lsz, ls: 0, color: P.label, star: [p[0], lsz * 1.1] }); } } // a starred place whose name lost the room still shows its gold star
        }
        if (!didRegions) regions();
      }
      // spots are fixed like flags: their dots and the open spot's name are reserved before section names
      const spots = drawnSpots = o.spots && !quiz && ready ? o.spots() : [], pinScale = clamp(k / 12, .75, 1.15), openSpot = o.selectedSpot ? o.selectedSpot() : null, spotBoxes = [];
      for (const sp of spots) {
        const hi = hoodOf(sp.x, sp.y), p = at(sp.x, sp.y, hi >= 0 ? topAt(hi) : 0); if (p[2] <= 0 || p[0] < -20 || p[0] > W + 20 || p[1] < -20 || p[1] > H + 20) { sp._s = null; continue; }
        sp._s = [p[0], p[1]];
        const r = 6.5 * pinScale * (sp.status === 'pending' && phone ? 1.5 : 1) + 2, b = [p[0] - r, p[1] - r, p[0] + r, p[1] + r]; b.own = 'dot'; spotBoxes.push(b);
        if (sp.id === openSpot && k > 16 && sp.name) { const x0 = p[0] + 6.5 * pinScale + 3; spotBoxes.push([x0, p[1] - 7, x0 + measure(sp.name, 500, fsz) + 4, p[1] + 7]); }
      }
      for (const b of spotBoxes) placed.push(b);
      // section names, on the tops: the selected section first, then starred ones, then the rest
      if (!quiz && ready) {
        const hotL = [], secs = [], plain = [];
        for (let i = 0; i < HOODS.length; i++) if (subF[i] > 0.2 || (i === sel && subF[i] > 0.01)) { const cells = subsOf(i); if (cells) cells.forEach((cell, j) => (i === sel && j === selSub ? hotL : cell.star ? secs : plain).push([i, j, cell])); }
        for (const [i, j, cell] of hotL.concat(secs, plain)) {
          const hot = i === sel && j === selSub, big = hot && phone, ss = big ? fsz * 1.25 : fsz, sw = cell.star ? ss * 1.05 + 3 : 0, wt = big ? 600 : 500;
          const tw = measure(cell.name, wt, ss) + sw, th = ss * 1.2, p = at(cell.c[0], cell.c[1], topAt(i)); if (p[2] <= 0 || p[0] < -40 || p[0] > W + 40 || p[1] < -20 || p[1] > H + 20) continue;
          const kl = c.g / p[2], box = [p[0] - tw / 2 - 2, p[1] - th / 2, p[0] + tw / 2 + 2, p[1] + th / 2];
          const fits = (cell.bbox[2] - cell.bbox[0]) * kl >= tw * .8 && (cell.bbox[3] - cell.bbox[1]) * kl * cosT >= th * 1.1;
          if (!(cell.star || fits || hot) || clash(box) || !(hot || inView(box))) continue;
          placed.push(box); put('c' + i + ':' + j, { text: cell.name, x: (box[0] + box[2]) / 2 + sw / 2, y: p[1], size: ss, ls: 0, weight: wt, color: hot && !cell.star ? P.accent : P.label, a: hot ? 1 : smooth(subF[i], .2, .8), star: sw ? [box[0] + 2 + ss * .525, ss * 1.05] : null });
        }
      }
      // fade names in and out, then draw: the ones leaving first
      for (const [id, rec] of want) { const a = lblA.get(id) || 0, n = RM.matches ? 1 : Math.min(1, a + dt / 160); lblA.set(id, n); rec.al = n * (rec.a != null ? rec.a : 1); if (n < 1) anim = true; }
      const text = rec => { ctx.globalAlpha = rec.al; if (rec.text) { ctx.font = `${rec.weight || 600} ${rec.size.toFixed(2)}px Figtree, system-ui, sans-serif`; if (supportsLS) ctx.letterSpacing = rec.ls ? rec.ls + 'em' : '0px'; ctx.textAlign = 'center'; haloText(rec.text, rec.x, rec.y, rec.size, rec.color); } if (rec.star) haloStar(rec.star[0], rec.y - rec.size * .05, rec.star[1]); };
      for (const [id, a] of lblA) if (!want.has(id)) { const n = a - dt / 140, rec = lblLast.get(id); if (n <= 0 || !rec || RM.matches) { lblA.delete(id); lblLast.delete(id); } else { lblA.set(id, n); anim = true; rec.al = n * (rec.a != null ? rec.a : 1); text(rec); } }
      for (const [id, rec] of want) { text(rec); lblLast.set(id, rec); }
      ctx.globalAlpha = 1; if (supportsLS) ctx.letterSpacing = '0px';
      // the landmarks with no model
      for (const [l, j, p] of glyphs) { ctx.globalAlpha = lmA[j]; ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.beginPath(); ctx.ellipse(p[0], p[1] + 1, lmH * (l.w || 1) * .42, lmH * .07, 0, 0, Math.PI * 2); ctx.fill(); window.drawGlyph(ctx, l, p[0], p[1], lmH, { ink: P.ink, face: P.face, shade: P.shade, roof: P.roof, accent: P.accent, lw: lmH < 24 ? 1 : 1.25 }); }
      ctx.globalAlpha = 1;
      // spots: a filled dot for been, a ring for want to go, a dashed accent ring for the place being picked (js/map.js)
      ctx.textAlign = 'left'; ctx.font = `500 ${fsz}px Figtree, system-ui, sans-serif`;
      for (const sp of spots) {
        if (!sp._s) continue; const [sx, sy] = sp._s, hot = sp.id === hoverSpot || sp.id === openSpot, r = (hot ? 6.5 : 5) * pinScale;
        ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2);
        if (sp.status === 'pending' && phone) { ctx.beginPath(); ctx.arc(sx, sy, r * 1.5, 0, Math.PI * 2); ctx.globalAlpha = .22; ctx.fillStyle = P.accent; ctx.fill(); ctx.globalAlpha = 1; ctx.setLineDash([3, 2]); ctx.strokeStyle = P.accent; ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]); ctx.beginPath(); ctx.arc(sx, sy, r * .45, 0, Math.PI * 2); ctx.fillStyle = P.accent; ctx.fill(); }
        else if (sp.status === 'pending') { ctx.fillStyle = P.paper; ctx.fill(); ctx.setLineDash([2, 1.5]); ctx.strokeStyle = P.accent; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]); }
        else { ctx.fillStyle = P.paper; ctx.fill(); ctx.strokeStyle = hot ? P.ink : 'rgba(0,0,0,.25)'; ctx.lineWidth = hot ? 1.5 : 1; ctx.stroke(); ctx.beginPath(); ctx.arc(sx, sy, r * .55, 0, Math.PI * 2); const cc = cssColor(sp.c); if (sp.status === 'want') { ctx.strokeStyle = cc; ctx.lineWidth = 1.6; ctx.stroke(); } else { ctx.fillStyle = cc; ctx.fill(); } }
        if (k > 16 && sp.name) { const tw = measure(sp.name, 500, fsz), box = [sx + r + 3, sy - 7, sx + r + 3 + tw + 4, sy + 7]; if (!clash(box, 'dot') || hot) { placed.push(box); haloText(sp.name, sx + r + 5, sy, fsz, P.label); } }
      }
      if (quiz && ready) anim = quizBadges(I, t) || anim;
      if (me) { const hi = hoodOf(me[0], me[1]), q = at(me[0], me[1], hi >= 0 ? topAt(hi) : 0); if (q[2] > 0) { const ph = ((t - meT0) % 1800) / 1800; ctx.globalAlpha = .4 * (1 - ph); ctx.fillStyle = P.want; ctx.beginPath(); ctx.arc(q[0], q[1], 6 + 12 * ph, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(q[0], q[1], 5, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = P.paper; ctx.lineWidth = 2; ctx.stroke(); } }
      return anim;
    }
    // The quiz's answer badges, as js/map.js draws them: a named mark is a pill on its place (just below a place too thin or small
    // to hold it), the check or the cross, then the name, white on the deep green or red, kept on screen and below the prompt
    // (quiz.top()); a dot without a name (the end of a round) is a small round check or cross
    function quizIcon(ok, x, y, r) { ctx.beginPath(); if (ok) { ctx.moveTo(x - r * .9, y + r * .05); ctx.lineTo(x - r * .25, y + r * .7); ctx.lineTo(x + r, y - r * .65); } else { ctx.moveTo(x - r * .7, y - r * .7); ctx.lineTo(x + r * .7, y + r * .7); ctx.moveTo(x + r * .7, y - r * .7); ctx.lineTo(x - r * .7, y + r * .7); } ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(2, r * .42); ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke(); }
    function pill(x, y, w, h) { const r = h / 2; ctx.beginPath(); ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2); ctx.lineTo(x + r, y + h); ctx.arc(x + r, y + r, r, Math.PI / 2, Math.PI * 1.5); ctx.closePath(); }
    function quizBadges(I, t) {
      const top = Math.max(I.top, quiz.top ? quiz.top() : 0) + 6, bot = H - I.bottom - 4, fs = isPhone() ? 15 : 15.5, boxes = []; let anim = false;
      const ms = quiz.marks().slice().sort((a, b) => (b.ok ? 1 : 0) - (a.ok ? 1 : 0));
      ctx.textBaseline = 'middle'; ctx.textAlign = 'left'; if (supportsLS) ctx.letterSpacing = '0px';
      for (const m of ms) {
        const h = HOODS[m.i], colr = m.ok ? P.okInk : P.noInk, p = at(h.cx, h.cy, topAt(m.i)); if (p[2] <= 0) continue; let sx = p[0], sy = p[1];
        if (m.dot && !m.name) { if (sx < -10 || sx > W + 10 || sy < -10 || sy > H + 10) continue; ctx.beginPath(); ctx.arc(sx, sy, 10, 0, Math.PI * 2); ctx.fillStyle = colr; ctx.fill(); ctx.strokeStyle = P.labelHalo; ctx.lineWidth = 2; ctx.stroke(); quizIcon(m.ok, sx, sy, 4.6); continue; }
        const tw = measure(h.name, 700, fs), iw = fs * .95, bw = tw + iw + 30, bh = fs + 16, bb = bboxOn(m.i);
        if (bb[3] - bb[1] < bh * 2.2 || bb[2] - bb[0] < bw * .9) sy = bb[3] + bh / 2 + 6 + bh / 2 <= bot ? bb[3] + bh / 2 + 6 : bb[1] - bh / 2 - 6;
        sx = clamp(sx, I.left + bw / 2 + 6, W - I.right - bw / 2 - 6); sy = clamp(sy, top + bh / 2, Math.max(top + bh / 2, bot - bh / 2));
        let b = [sx - bw / 2, sy - bh / 2, sx + bw / 2, sy + bh / 2];
        for (const dy of [0, bh + 8, -(bh + 8), 2 * (bh + 8), -2 * (bh + 8)]) { const q = [b[0], b[1] + dy, b[2], b[3] + dy]; if (q[1] >= top - 2 && q[3] <= bot + 2 && !boxes.some(z => q[0] < z[2] && q[2] > z[0] && q[1] < z[3] && q[3] > z[1])) { b = q; break; } }
        boxes.push(b);
        const pp = m.t0 && !RM.matches ? clamp((t - m.t0) / 260, 0, 1) : 1, s = .55 + .45 * easeOut(pp); if (pp < 1) anim = true;
        ctx.save(); ctx.translate((b[0] + b[2]) / 2, (b[1] + b[3]) / 2); ctx.scale(s, s);
        pill(-bw / 2, -bh / 2, bw, bh); ctx.shadowColor = 'rgba(0,0,0,.28)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 2; ctx.fillStyle = colr; ctx.fill(); ctx.shadowColor = 'transparent';
        ctx.strokeStyle = P.labelHalo; ctx.lineWidth = 2; ctx.stroke();
        quizIcon(m.ok, -bw / 2 + 12 + iw / 2, 0, fs * .36);
        ctx.font = `700 ${fs}px Figtree, system-ui, sans-serif`; ctx.fillStyle = '#fff'; ctx.fillText(h.name, -bw / 2 + 18 + iw, 1);
        ctx.restore();
      }
      return anim;
    }

    // ---- the frame loop: drawn on demand ----
    function kick() { if (!raf) { lastT = now(); raf = requestAnimationFrame(frame); } }
    function setPR(p) { if (p === pr) return; pr = p; renderer.setPixelRatio(pr); renderer.setSize(W, H, false); lbl.width = Math.round(W * pr); lbl.height = Math.round(H * pr); needs = true; }
    function frame(t) {
      raf = 0; const dt = Math.min(50, t - lastT || 16); lastT = t; let busy = false;
      if (g2 && g2.dirty && ptrs.size >= 2) twoFingers();
      if (mode === 'fly' && fly) { stepFly(t); busy = true; }
      else if (mode === 'smooth') { const a = 1 - Math.exp(-dt / 90); let d = 0; for (const p of ['cx', 'cz']) { const dd = goal[p] - cur[p]; d += Math.abs(dd) / cur.w; cur[p] += dd * a; } for (const p of ['th', 'off']) { const dd = goal[p] - cur[p]; d += Math.abs(dd); cur[p] += dd * a; } const lw = Math.log(goal.w / cur.w); d += Math.abs(lw); cur.w *= Math.exp(lw * a); if (d < 0.0005) { Object.assign(cur, goal); mode = 'still'; } else busy = true; }
      else if (mode === 'inertia') { const f = Math.exp(-dt / 320); cur.cx += vel.x * dt; cur.cz += vel.z * dt; limit(cur); Object.assign(goal, cur); userMoved = true; vel.x *= f; vel.z *= f; if (Math.hypot(vel.x, vel.z) * kNow() < 0.02) mode = 'still'; else busy = true; }
      if (colAnim) { const a = 1 - Math.exp(-dt / 140); let left = false; for (let i = 0; i < HOODS.length; i++) { const c = colNow[i], g = colTo[i]; for (let j = 0; j < 3; j++) { const d = g[j] - c[j]; if (Math.abs(d) > 1) { c[j] += d * a; left = true; } else c[j] = g[j]; } } colAnim = left; busy = busy || left; paintAll = true; }
      if (busy) needs = true; sync();
      const turned = Math.abs(cur.th) > 0.02 || Math.abs(cur.off) > 0.02; if (north.hidden === turned) { north.hidden = !turned; } if (turned) north.firstChild.style.transform = `rotate(${-cur.th * 180 / Math.PI}deg)`;
      if (!ready) { if (busy) raf = requestAnimationFrame(frame); if (busy && o.onMove) o.onMove(); return; }
      const t0 = now(); C = camOf(cur); const vx = C.vex; C.vex = vex; // names and hits use the stretch the scene was last drawn with
      let anim = prepare(dt); if (stepLifts(t)) { anim = true; needs = true; }
      const mv = busy || ptrs.size > 0; if (mv !== moving) { moving = mv; setPR(moving ? Math.min(dpr, 2) : dpr); } // a lighter frame while the map moves, the full one when it rests
      if (needs) { needs = false; if (updateScene(t, vx)) { anim = true; needs = true; } renderer.render(scene, camera); stat.frames++; if (!stat.firstFrame) stat.firstFrame = now(); }
      anim = drawOverlay(t, dt) || anim; stat.lastMs = now() - t0;
      if (busy || anim || me || needs) raf = requestAnimationFrame(frame);
      if (busy && o.onMove) o.onMove();
    }

    // ---- hit testing: the same hits, in the same order, as the flat map ----
    function hitTest(sx, sy, touch) {
      const spots = drawnSpots;
      if (touch) { let best = null, bd = 20; for (let q = spots.length - 1; q >= 0; q--) { const sp = spots[q]; if (!sp._s || sp.status === 'pending') continue; const d = Math.hypot(sp._s[0] - sx, sp._s[1] - sy); if (d < bd) { best = sp; bd = d; } } if (best) return { type: 'spot', id: best.id, hood: best.hood }; }
      else for (let q = spots.length - 1; q >= 0; q--) { const sp = spots[q]; if (sp._s && Math.hypot(sp._s[0] - sx, sp._s[1] - sy) < 11 && sp.status !== 'pending') return { type: 'spot', id: sp.id, hood: sp.hood }; }
      for (let j = LANDS.length - 1; j >= 0; j--) { const b = lmBox[j]; if (b && sx >= b[0] - 3 && sx <= b[2] + 3 && sy >= b[1] - 3 && sy <= b[3] + 3) return { type: 'landmark', landmark: LANDS[j], hood: LANDS[j].hood }; }
      const p = pick(camNow(), sx, sy);
      if (p.i >= 0) { const px = hoodPx(p.i), sub = (px > 300 || p.i === sel) ? base.subIndexAt(p.i, p.x, p.y) : -1; return { type: 'hood', i: p.i, hood: HOODS[p.i].name, sub, x: p.x, y: p.y }; }
      return { type: 'water', x: p.x, y: p.y };
    }

    // ---- gestures: one finger pans, two pinch, turn and tilt; the wheel zooms; a right or ctrl drag turns and tilts ----
    const ptrs = new Map(); let drag = null, g2 = null, lastTap = null, downAt = 0;
    const two = () => { const [a, b] = [...ptrs.values()]; return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, s: Math.hypot(b.x - a.x, b.y - a.y) || 1, a: Math.atan2(b.y - a.y, b.x - a.x) }; };
    // Two fingers, read once per frame: the browser reports each finger on its own, and one of a pair moved without the other looks
    // like a turn. A spread or a twist is a pinch (zoom about the middle, pan with it, and turn once the twist is clear); both
    // fingers side by side moving up or down together is a tilt.
    function twoFingers() {
      g2.dirty = false; const r = stage.getBoundingClientRect(), q = two(), ds = Math.abs(Math.log(q.s / g2.s0)); let da = q.a - g2.a0; da = Math.atan2(Math.sin(da), Math.cos(da)); const dx = q.cx - g2.cx0, dy = q.cy - g2.cy0;
      if (!g2.mode) { if (ds > 0.07 || Math.abs(da) > 0.11) g2.mode = 'pinch'; else if (Math.abs(dy) > 12 && Math.abs(dy) > 2 * Math.abs(dx) && Math.abs(Math.sin(q.a)) < 0.7) g2.mode = 'tilt'; else if (Math.hypot(dx, dy) > 18) g2.mode = 'pinch'; }
      if (g2.mode === 'tilt') setTilt(cur, -(q.cy - g2.cy) * 0.0065);
      else if (g2.mode === 'pinch') {
        const before = grabAt(cur, g2.cx - r.left, g2.cy - r.top); cur.w = clamp(cur.w * g2.s / q.s, minW(), maxW());
        if (!g2.turn && Math.abs(da) > 0.13) g2.turn = true; else if (g2.turn) { let d = q.a - g2.a; d = Math.atan2(Math.sin(d), Math.cos(d)); cur.th += d; }
        hold(cur, before, q.cx - r.left, q.cy - r.top); limit(cur);
      }
      if (g2.mode) { Object.assign(goal, cur); userMoved = true; mode = 'drag'; needs = true; }
      g2.cx = q.cx; g2.cy = q.cy; g2.s = q.s; g2.a = q.a;
    }
    stage.addEventListener('pointerdown', e => {
      if (e.target !== glc && e.target !== stage) return;
      const orbit = e.pointerType === 'mouse' && (e.button === 2 || (e.button === 0 && e.ctrlKey));
      if (e.pointerType === 'mouse' && e.button !== 0 && !orbit) return;
      try { stage.setPointerCapture(e.pointerId); } catch (err) {}
      const r = stage.getBoundingClientRect(); ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); downAt = now();
      fly = null; if (mode === 'fly' || mode === 'smooth') Object.assign(goal, cur); mode = 'drag'; vel = { x: 0, z: 0 };
      if (ptrs.size === 1) drag = { x: e.clientX, y: e.clientY, t: now(), moved: orbit ? 99 : 0, pinched: false, orbit, grab: orbit ? null : grabAt(cur, e.clientX - r.left, e.clientY - r.top) };
      else if (ptrs.size === 2) { g2 = Object.assign({ mode: null, turn: false }, two()); g2.s0 = g2.s; g2.a0 = g2.a; g2.cx0 = g2.cx; g2.cy0 = g2.cy; if (drag) drag.pinched = true; }
      if (quiz) { const h = ptrs.size === 1 && e.pointerType === 'touch' ? hitTest(e.clientX - r.left, e.clientY - r.top, false) : null; press = h && h.type === 'hood' && quiz.pick(h.i) ? h.i : -1; } // quiz: a finger down shows the place it would pick; the answer is taken on release
      kick(); o.onGestureStart && o.onGestureStart();
    });
    stage.addEventListener('pointermove', e => {
      const r = stage.getBoundingClientRect();
      if (ptrs.has(e.pointerId)) {
        const p = ptrs.get(e.pointerId), px = p.x, py = p.y; p.x = e.clientX; p.y = e.clientY;
        if (ptrs.size >= 2 && g2) { press = -1; g2.dirty = true; kick(); // read once per frame (twoFingers), when both fingers have reported
        } else if (drag && ptrs.size === 1) {
          const dx = e.clientX - drag.x, dy = e.clientY - drag.y, t = now(), dt = Math.max(1, t - drag.t);
          drag.moved += Math.abs(dx) + Math.abs(dy);
          if (drag.orbit) { cur.th -= (e.clientX - px) * 0.0055; setTilt(cur, -(e.clientY - py) * 0.0045); Object.assign(goal, cur); userMoved = true; stage.classList.add('dragging'); needs = true; kick(); }
          else if (drag.moved > 5) {
            press = -1; stage.classList.add('dragging');
            if (!drag.grab) drag.grab = grabAt(cur, e.clientX - r.left, e.clientY - r.top); // after a pinch: what is under the finger that stayed
            const x0 = cur.cx, z0 = cur.cz; hold(cur, drag.grab, e.clientX - r.left, e.clientY - r.top); limit(cur); Object.assign(goal, cur); userMoved = true;
            const a = .35; vel.x = vel.x * (1 - a) + ((cur.cx - x0) / dt) * a; vel.z = vel.z * (1 - a) + ((cur.cz - z0) / dt) * a;
            if (o.onHover) o.onHover(null); needs = true; kick();
          }
          drag.x = e.clientX; drag.y = e.clientY; drag.t = t;
        }
        return;
      }
      if (e.pointerType !== 'touch' && o.onHover) { const h = hitTest(e.clientX - r.left, e.clientY - r.top); o.onHover(h, e.clientX - r.left, e.clientY - r.top); }
    });
    const release = e => {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.delete(e.pointerId);
      const r = stage.getBoundingClientRect();
      if (ptrs.size === 1 && g2) { g2 = null; const [p] = [...ptrs.values()]; drag = { x: p.x, y: p.y, t: now(), moved: 99, pinched: true, orbit: false, grab: null }; mode = 'still'; kick(); return; }
      if (ptrs.size === 0) {
        stage.classList.remove('dragging'); g2 = null;
        if (drag && drag.moved <= 5 && !drag.pinched && e.type === 'pointerup') {
          const sx = e.clientX - r.left, sy = e.clientY - r.top, t = now();
          mode = 'still'; // before the callbacks: a tap may start a fly or a zoom
          if (lastTap && !quiz && t - lastTap.t < 320 && Math.hypot(lastTap.x - sx, lastTap.y - sy) < 28) { lastTap = null; zoomAt(sx, sy, 1 / 1.9); }
          else { lastTap = { t, x: sx, y: sy }; const h = hitTest(sx, sy, e.pointerType === 'touch' && !quiz); if (o.onTap && !(quiz && e.pointerType === 'touch' && (h.type === 'hood' ? h.i : -1) !== press)) o.onTap(h, sx, sy, downAt); }
        } else if (drag && drag.moved > 5 && !drag.orbit) {
          if (Math.hypot(vel.x, vel.z) * kNow() > 0.08 && now() - drag.t < 80) mode = 'inertia'; else mode = 'still';
        } else mode = 'still';
        drag = null; press = -1; needs = true; kick();
        o.onGestureEnd && o.onGestureEnd();
      }
    };
    stage.addEventListener('pointerup', release); stage.addEventListener('pointercancel', release);
    stage.addEventListener('pointerleave', () => { if (!ptrs.size && o.onHover) o.onHover(null); });
    stage.addEventListener('contextmenu', e => e.preventDefault());
    stage.addEventListener('wheel', e => {
      e.preventDefault(); const r = stage.getBoundingClientRect();
      let d = e.deltaY; if (e.deltaMode === 1) d *= 16; else if (e.deltaMode === 2) d *= 120; d = clamp(d, -160, 160);
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(d * (e.ctrlKey ? 0.01 : 0.0028)));
    }, { passive: false });
    north.addEventListener('click', () => { const to = Object.assign({}, goal, { th: 0, off: 0 }); let th = cur.th % (Math.PI * 2); if (th > Math.PI) th -= Math.PI * 2; if (th < -Math.PI) th += Math.PI * 2; cur.th = th; startFly(viewOf(to), 600); });
    glc.addEventListener('webglcontextlost', e => e.preventDefault());
    glc.addEventListener('webglcontextrestored', () => { shadowDirty = true; needs = true; kick(); });

    // ---- resize ----
    function resize() {
      const r = stage.getBoundingClientRect(), w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height)), d = Math.min(window.devicePixelRatio || 1, 3);
      if (w === W && h === H && d === dpr) return;
      const first = W <= 1, W0 = W, H0 = H; W = w; H = h; dpr = d; pr = moving ? Math.min(dpr, 2) : dpr; camV++;
      renderer.setPixelRatio(pr); renderer.setSize(W, H, false); lbl.width = Math.round(W * pr); lbl.height = Math.round(H * pr);
      // the tilt is nearly straight down from the distance of the first screen (the bay core, as the flat map lands on it)
      const all = base.regionBBox('all'); dFar = Math.max(400, dOf(Math.max(all[2] - all[0], (all[3] - all[1]) * W / H) * 1.06));
      if (!first) { const refit = s => { s.w = s.w * W / W0; return limit(s); }; refit(cur); refit(goal); if (fly) { refit(fly.from); refit(fly.to); } } // keep scale and centre through the new box
      sync(); needs = true; kick();
    }
    new ResizeObserver(resize).observe(stage);
    (function watchDpr() { try { const mq = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`); mq.addEventListener('change', () => { resize(); watchDpr(); }, { once: true }); } catch (e) {} })();
    refreshPalette(); resize(); build();

    return {
      is3d: true,
      get cam() { return cam; }, get k() { return kNow(); }, get W() { return W; }, get H() { return H; },
      get userMoved() { return userMoved; }, set userMoved(v) { userMoved = v; },
      resize, redraw: () => { needs = true; kick(); }, invalidate: () => { paintAll = true; needs = true; kick(); },
      refreshPalette: () => { refreshPalette(); if (ready) applyLook(); needs = true; kick(); },
      fitView, hitTest, hoodBBox: i => BB[i], regionBBox: r => base.regionBBox(r), subs: subsOf, subIndexAt: base.subIndexAt, landmarks: LANDS, bbox: BB,
      // a map point on screen, at the height of what stands there; the map point under a screen point. v: a view from fitView (default: the view on screen)
      toScreen(x, y, v) { const c = camFor(v), p = project(c, x, surfaceAt(x, y, .15) * c.vex, y); return [p[0], p[1]]; },
      toMap(sx, sy, v) { const p = pick(camFor(v), sx, sy); return [p.x, p.y]; },
      flyTo(bb, pad, minWv, dur) { const v = fitView(bb[0], bb[1], bb[2], bb[3], pad, minWv); userMoved = false; startFly(v, dur); },
      flyToView(v, dur) { userMoved = false; startFly(v, dur); },
      jumpTo(v) { const s = stateOf(v), a = areaObj(s.cx, s.cz); if (a !== area) { s.th = 0; s.off = 0; } area = a; Object.assign(cur, limit(s)); Object.assign(goal, cur); fly = null; mode = 'still'; sync(); shadowDirty = true; needs = true; kick(); },
      get area() { return area.id; }, areaAt: base.areaAt, areas: AREAS,
      zoom(f) { zoomAt(W / 2, H / 2, f); },
      setColors(colors, animate) { colors.forEach((c, i) => { const rgb = hex2rgb(cssColor(c)); colTo[i] = rgb; if (!animate) colNow[i] = rgb.slice(); }); colAnim = !!animate; paintAll = true; needs = true; kick(); },
      setState(s) { if (s.region !== undefined) region = s.region; if (s.sel !== undefined) sel = s.sel; if (s.selSub !== undefined) selSub = s.selSub; if (s.quiz !== undefined) { quiz = s.quiz; press = -1; } needs = true; kick(); },
      setHover(i, sub, spot) { if (i === hover && sub === hoverSub && spot === hoverSpot) return; hover = i; hoverSub = sub; hoverSpot = spot; needs = true; kick(); },
      pop(i) { markAnim[i] = now(); needs = true; kick(); },
      setMe(xy) { me = xy; meT0 = now(); kick(); },
      subsShowing(i) { return subsOf(i) && (hoodPx(i) > 560 || i === sel); },
      hoodPx,
      // for tests and the console: what was built and how long it took, what a frame draws, and the cost of frames along a flight
      stats() { const info = renderer.info; let tris = 0; scene.traverse(q => { if ((q.isMesh || q.isPoints) && q.visible && q.geometry) { const g = q.geometry, n = q.isPoints ? 0 : (g.index ? g.index.count : g.attributes.position.count) / 3; tris += n * (q.isInstancedMesh ? q.count : 1); } });
        return { ready, blocks: stat.blocks, build: stat.build, firstFrame: stat.firstFrame ? Math.round(stat.firstFrame - stat.t0) : 0, sinceNav: stat.firstFrame ? Math.round(stat.firstFrame) : 0, frames: stat.frames, lastMs: +stat.lastMs.toFixed(2), sceneTriangles: Math.round(tris), calls: info.render.calls, triangles: info.render.triangles, pr, size: [W, H], dark, area: area.id, view: Object.assign({ ph: +phOf(cur.w, cur.off).toFixed(3) }, cur) }; },
      bench(n = 60) { // n frames spread along the flight in progress or, at rest, a small orbit; each forced to finish on the GPU
        const gl = renderer.getContext(), px = new Uint8Array(4), keep = Object.assign({}, cur), times = [];
        for (let i = 0; i < n; i++) { cur.th = keep.th + Math.sin(i / n * Math.PI * 2) * 0.12; cur.w = keep.w * (1 + 0.25 * Math.sin(i / n * Math.PI)); cur.cx = keep.cx + Math.sin(i * 0.2) * keep.w * 0.05; const t0 = now(); C = camOf(cur); const vx = C.vex; C.vex = vex; prepare(16); updateScene(t0, vx); renderer.render(scene, camera); drawOverlay(t0, 16); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); times.push(now() - t0); }
        Object.assign(cur, keep); needs = true; kick(); times.sort((a, b) => a - b);
        return { n, avg: +(times.reduce((s, x) => s + x, 0) / n).toFixed(2), p50: +times[n >> 1].toFixed(2), p95: +times[Math.floor(n * .95)].toFixed(2), max: +times[n - 1].toFixed(2) }; },
    };
  };
})();
