// The 3D map (beta): a second map engine beside js/map.js, with the same members and the same options, so js/app.js drives either.
// It is inert unless index.html also loaded three.js and js/map3d/{land,models,blocks}.js (it does when the 3D map is asked for):
// window.MapView3D returns null without them, or without WebGL, and the app makes the flat map instead.
// With js/map3d/relief.js and terrain.js the top of every block is the real ground (hAt below), and everything that stands on a
// place, is drawn on it or is tapped on it follows that ground; without them the blocks are the flat-topped plateaus they were.
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
//
// On top of the blocks, when their files are loaded too (js/map3d/fabric.js, js/map3d/air.js; without them the map is the plain
// blocks): a city fabric that rises from the block tops as the map comes close, tinted from each block's own colour (and, where
// js/map3d/real.js and buildings.js cover, the real buildings in its place: downtown San Francisco and Oakland, the Strip); a sky and a
// haze behind the lower tilts; water that ripples, with a wash where it meets the land; the light theme's light following the
// hour; a fog bank over the foggy places; ferries, and at night the traffic on the bridges. What moves by itself runs for 20 s
// after the last touch, at 30 frames a second at most, never out of sight and never under reduced motion (AMBIENT below). When
// frames run long the engine gives effects up one at a time, and takes them back when they run well again (the governor).
(function () {
  'use strict';
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v)), lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (v, a, b) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const easeOut = t => 1 - Math.pow(1 - t, 4), backOut = t => { const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
  const now = () => performance.now();
  const RM = matchMedia('(prefers-reduced-motion: reduce)');
  const U = 400;                                  // as js/map.js: zoom limits are tuned in map units of the first canvas
  const FOV = 30, F = 1 / Math.tan(FOV * Math.PI / 360);
  const D_MIN = 12, D_NEAR = 110, PH_MIN = 0.03, PH_MAX = 1.45, PH_FIT = 1.27, PH_NEAR = 1.0, PH_FAR = 0.16, PH_ADD = 0.45, CAM_CLEAR = 3.55; // the camera's distance and tilt (radians from straight down): by hand it leans as far as PH_MAX (the sky shows over the skyline), never so low that it would stand inside a hill (CAM_CLEAR above the ground it looks at); a fit leans no further than PH_FIT, so the box it frames stays under the horizon
  const AMBIENT = true, AMB_MS = 20000, AMB_GAP = 1000 / 30; // what moves by itself (water, fog, ferries, traffic): while the map is in sight, for 20 s after the last touch, 30 frames a second at most; never under reduced motion
  const FOG_ON = true;                            // the fog bank over the foggy places: false takes it out
  const FK0 = 5.5, FK1 = 10, FAB_MAX = 420;       // the city fabric rises between these scales (pixels to a map unit at the middle of the view); the most chunks of it kept
  const MARK_MAX = 16;                            // a flag or a bookmark holds its size on screen until it would stand this tall on the map
  const FOCUS_Y = 0.5, VEX_FAR = 1.55, VEX_HILLS = 2.3, LIFT = 0.85, CAM_OVER = 1.1; // the height the camera looks at; how far heights stretch at the far zoom; how far the selected place rises
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
      tileRough: 0.94, builtRough: 0.82, pane: 0.1, waterRough: 0.78, waterMetal: 0, glow: 0, amb: 0, lights: false, castA: 0.2,
      zenith: '#a9c6de', skyGlow: '#ffd9a6', glowK: 0.1, wave: 0.06, glint: 0.42, wash: '#fbfdfd', washK: 0.85, sand: '#eadcbc', pale: '#fffdf8', roofK: 0.4, wallK: 0.24, tree: '#5f8a4d', treeK: 0.62, win: '#000000', fogC: '#fdfdfc', fogK: 0.22 },
    night: { bg: '#0b1118', fog: [1.6, 7.5], shore: 1.25, lift: '#c9d6e6', liftK: 0.04, side: '#05080c', sideK: 0.32, bevelK: 0.14, key: { c: '#b4c8ff', i: 1.05, az: 300, el: 48 }, hemi: { sky: '#9fb2d4', ground: '#2c2a33', i: 1.75 }, shadowR: 2.5,
      tileRough: 0.9, builtRough: 0.75, pane: 0.3, waterRough: 0.6, waterMetal: 0.1, glow: 0.95, amb: 0.22, lights: true, castA: 0.2,
      zenith: '#05080d', skyGlow: '#4b4a66', glowK: 0.3, wave: 0.05, glint: 0.3, wash: '#8fb4cc', washK: 0.4, sand: '#5d5a52', pale: '#aebcd0', roofK: 0.2, wallK: 0.3, tree: '#35584a', treeK: 0.42, win: '#ffc680', fogC: '#7f91ab', fogK: 0.15 },
  };
  const BUILT = { // colours of everything built, by material name (the Golden Gate, the steel, the flag and the bookmark take the app's tokens instead)
    paper: { whiteCable: '#eef0ee', white: '#f8f4ec', whiteShade: '#e4ddcf', stone: '#ebe4d5', stoneShade: '#cdc4b0', metal: '#dcdcd8', glass: '#b4c5ce', glassTop: '#d6e0e5', glassDark: '#74858f', roof: '#98a2a8', glassRoof: '#c4d3d8', red: '#d4563a', concrete: '#d2cbbb', concreteLight: '#e6e0d2', road: '#6c7075', roadLight: '#b3b0a8', dark: '#3c4a57', rust: '#b3765a', ochre: '#dcae80', ochreShade: '#b98a5e', dome: '#cc7a50', lagoon: '#a9c9d2', lamp: '#fff3c4', clock: '#fdf9ee', p0: '#9db8cc', p1: '#e6c97a', p2: '#dd9c90', p3: '#a8c096', p4: '#f1e5ca', p5: '#b8a3c5', p6: '#8cb6b1', trim: '#fdfaf2', sphere: '#394655', bronze: '#8e6d51', bronzeShade: '#70553f', wheel: '#f4f1ea', wheelShade: '#c6c2b8', cabin: '#dfe7ec', luxor: '#3a434e', sand: '#d9bc8e', bldg0: '#f4f0e7', bldg1: '#ece6da', bldg2: '#e2dccf', bldg3: '#d6dee1', resort0: '#f3eee4', resort1: '#dcc48e', resort2: '#e8decb', resort3: '#cfd8dc', resort4: '#c4a575', podium: '#e4ddcd', boulevard: '#fdfbf6', pole: '#4f4a41', poleBase: '#3c4a57', roofTop: '#d6cfbf' },
    night: { whiteCable: '#77828e', white: '#55606d', whiteShade: '#454f5b', stone: '#4d5764', stoneShade: '#3c4651', metal: '#6a7480', glass: '#3c5266', glassTop: '#7fb6d8', glassDark: '#2a3a4a', roof: '#343e4b', glassRoof: '#3d5560', red: '#a3463a', concrete: '#444e5a', concreteLight: '#525c68', road: '#1c242d', roadLight: '#3a444f', dark: '#1a232c', rust: '#7a5140', ochre: '#8a6f55', ochreShade: '#6e573f', dome: '#96583a', lagoon: '#1d3a4a', lamp: '#fff3c4', clock: '#fff4d6', p0: '#55708a', p1: '#8f7c48', p2: '#8b5e58', p3: '#5f7556', p4: '#857d68', p5: '#6f6082', p6: '#4b6f6c', trim: '#7d8690', sphere: '#4f66ff', bronze: '#6b523d', bronzeShade: '#523f2e', wheel: '#6a7480', wheelShade: '#4d5764', cabin: '#b9d8ff', luxor: '#1b222b', sand: '#77664c', bldg0: '#5d6878', bldg1: '#566170', bldg2: '#4f5a68', bldg3: '#55667a', resort0: '#646a74', resort1: '#7d6b44', resort2: '#666159', resort3: '#53616f', resort4: '#6d5a43', podium: '#46505c', boulevard: '#6a5a3a', pole: '#c3ccd4', poleBase: '#8e9ca8', roofTop: '#414a56' },
  };
  // the colours the extra landmarks bring (js/map3d/icons-*.js); a name already here keeps its colour
  const adoptMats = () => (window.M3D.extra || []).forEach(e => e && e.mats && Object.keys(e.mats).forEach(k => { if (!BUILT.paper[k]) { BUILT.paper[k] = e.mats[k][0]; BUILT.night[k] = e.mats[k][1]; } }));
  const LIGHTS = { warm: '#ffc27a', white: '#eaf2ff', red: '#ff4b3a', cool: '#9fd2ff', gold: '#ffcf6b', pink: '#ff6fb0', violet: '#9b7bff', sphere: '#5a72ff', beam: '#fff1c2' };
  // the CSS tokens read (the flat map's, the quiz's two inks, and the second ink for region names)
  const VARS = { water: '--water', paper: '--paper', ink: '--ink', ink2: '--ink-2', muted: '--muted', land: '--land', landOther: '--land-other', coast: '--coast', steel: '--steel', gg: '--gg', accent: '--accent', want: '--want', label: '--label', labelHalo: '--label-halo', subLine: '--sub-line', face: '--glyph-face', shade: '--glyph-shade', roof: '--glyph-roof', star: '--star', okInk: '--qz-ok-ink', noInk: '--qz-no-ink' };
  const REGION_AT = { sf: [-122.445, 37.757], north: [-122.47, 38.2], east: [-122.06, 37.86], south: [-121.99, 37.265], penin: [-122.3, 37.49], marin: [-122.63, 37.99] }; // where a region's name sits over the whole bay

  window.MapView3D = function (canvas, o) {
    const THREE = window.THREE, M3D = window.M3D || {}, land = M3D.land, MD = M3D.models, FB = M3D.fabric, AIR = M3D.air, RB = M3D.real; // the fabric and the air are extras: without their files the map is the plain blocks
    if (!THREE || !land || !MD || !window.MapView) return null;          // three.js or the 3D files did not load: the flat map
    o = o || {};
    // the speed test's switches (js/map3d/bench.js), read once: ?m3d-pr=<1..3> one pixel ratio always, m3d-aa=off, m3d-shadows=off, m3d-q=<0..6> one quality
    // level (the governor and the session's level left out), m3d-shadowhold=off and m3d-pump=old (the rules before the speed fixes). None in the address: none changes anything
    const qsv = k => { const m = new RegExp('[?&]m3d-' + k + '=([^&]*)').exec(location.search); return m ? m[1] : null; };
    const SW = { pr: +qsv('pr') > 0 ? clamp(+qsv('pr'), 1, 3) : 0, aa: qsv('aa') !== 'off', shadows: qsv('shadows') !== 'off', q: /^[0-6]$/.test(qsv('q') || '') ? +qsv('q') : -1, hold: qsv('shadowhold') !== 'off', pumpOld: qsv('pump') === 'old' };
    const glc = document.createElement('canvas'), lbl = document.createElement('canvas');
    let renderer; try { renderer = new THREE.WebGLRenderer({ canvas: glc, antialias: SW.aa, alpha: false, powerPreference: 'high-performance' }); } catch (e) { return null; } // no WebGL here: the flat map
    // the canvas is opaque: until the scene is ready it shows the theme's water, never black
    try { renderer.setClearColor(getComputedStyle(document.documentElement).getPropertyValue('--water').trim() || '#888888', 1); renderer.clear(); } catch (e) {}
    // From here a throw undoes what was done (the catch at the end) and the app makes the flat map; dead stops what was already started
    const ac = new AbortController(), sig = ac.signal; let dead = false, ro = null;
    try {
    adoptMats();
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
    // The land's real shape (js/map3d/relief.js, from js/map3d/terrain.js): the ground of a place at a point. Without it (the
    // files missing or cut short, ?m3d-land=flat, or its meshes failing as they are made: flatLand below) every place is the
    // plateau it was, one height all over. HT: the top of each block (with the relief: its highest ground); AY: the ground at its anchor
    let RL = null; const tRelief = now(); if (!/[?&]m3d-land=flat(?:&|$)/.test(location.search) && M3D.relief) { try { RL = M3D.relief.make(M3D.terrainData, BB); land.heightAt = RL.heightAt; } catch (e) { RL = null; console.warn('3D map, the land stays flat: ' + (e && e.message || e)); } }
    const HT = HOODS.map(() => 0), AY = HOODS.map(() => 0); let HMAX = 0;
    const hAt = (i, x, z) => RL && RL.has(i) ? RL.h(i, x, z) : HT[i];      // the ground of place i at a point (as it lies, not lifted)
    const heights = () => { HOODS.forEach((h, i) => { HT[i] = RL && RL.has(i) ? RL.max[i] : land.topOf(i); }); HOODS.forEach((h, i) => { AY[i] = hAt(i, h.cx, h.cy); }); HMAX = Math.max.apply(null, HT) + LIFT; };
    heights();
    const STAR = HOODS.map(h => (SUBD[h.name] || []).some(s => s && s.star));
    const SIZE = HOODS.map((h, i) => Math.sqrt(Math.abs((PP[i] || []).reduce((s, poly) => s + poly.reduce((a, r, k) => a + (k ? -1 : 1) * Math.abs(Geom.area(r)), 0), 0)))); // the side of a square of the place's area
    const SIDE_X = HOODS.map((h, i) => { if (DETAIL[i] <= 1 || !PP[i]) return 0; const band = (BB[i][3] - BB[i][1]) * .2; let x = -Infinity; PP[i].flat().forEach(r => r.forEach(q => { if (Math.abs(q[1] - h.cy) <= band && q[0] > x) x = q[0]; })); return x > -Infinity ? x : BB[i][2]; }); // js/map.js: a detailed place is named beside it
    const LM_ID = Object.fromEntries(LANDS.map((l, j) => [l.id, j])), LM_STOP = new Set(['the', 'and', 'of', 'at', 'to', 'las', 'vegas', 'san', 'francisco', 'street', 'park']); // words a landmark's name may share with a place's and still be named (drawOverlay)
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
    let mode = 'still', fly = null, vel = { x: 0, z: 0 }, raf = 0, lastT = 0, govT = 0, userMoved = false, needs = true, ready = false, moving = false;
    let region = 'all', sel = -1, selSub = -1, hover = -1, hoverSub = -1, hoverSpot = null, quiz = false, press = -1;
    const colNow = HOODS.map(() => [200, 200, 200]), colTo = HOODS.map(() => [200, 200, 200]); let colAnim = false, paintAll = true;
    const alphaNow = new Float32Array(HOODS.length).fill(1), flagNow = new Uint8Array(HOODS.length), liftV = new Float32Array(HOODS.length), liftAnim = new Map();
    const farA = [1], markAnim = {}; let me = null, meT0 = 0, meTimer = 0, drawnSpots = [], lmBox = [], farNames = false;
    const lblA = new Map(), lblLast = new Map(), lmA = LANDS.map(() => 0), measureCache = new Map(), hoodCache = new Map();
    const P = {}; let LK = null, dark = false;                             // the tokens, and the look made from them
    const stat = { t0: now(), firstFrame: 0, build: { relief: now() - tRelief }, blocks: '', frames: 0, lastMs: 0, amb: 0, shadowDraws: 0 };
    let ambUntil = 0, ambT = 0, ambLast = 0, ambTimer = 0, ambTick = false, olAnim = true, sunAt = 0, sunKey = '', fogLens = false; // ambient motion: until when it runs, its own seconds, the timer of its next frame
    const poke = () => { ambUntil = now() + AMB_MS; };                    // a touch (or a move the app asked for): the ambient motion runs on from here
    const ambOn = () => AMBIENT && ready && Q.life && !RM.matches && !document.hidden && now() < ambUntil; // the governor's first step gives it up
    const insets = () => o.insets ? o.insets() : { top: 0, right: 0, bottom: 0, left: 0 };
    const kNow = () => W / cur.w;
    const hoodPx = i => (BB[i][2] - BB[i][0]) * kNow() * DETAIL[i];
    const topAt = i => HT[i] + liftV[i], anchY = i => AY[i] + liftV[i], gAt = (i, x, z) => hAt(i, x, z) + liftV[i]; // the highest point of a place as it stands (lifted when selected), the ground at its anchor, the ground at a point of it

    // ---- palette ----
    const spotCol = new Map(), spotColor = c => { let v = spotCol.get(c); if (v === undefined) { v = cssColor(c); spotCol.set(c, v); } return v; }; // a spot's colour, looked up once (again after refreshPalette: the theme or the palette changed)
    function refreshPalette() {
      spotCol.clear(); const cs = getComputedStyle(document.documentElement); for (const k in VARS) P[k] = cs.getPropertyValue(VARS[k]).trim() || '#888888';
      const w = hex2rgb(P.water); dark = (w[0] * .3 + w[1] * .59 + w[2] * .11) < 110;
      const L = LOOKS[dark ? 'night' : 'paper'], pal = Object.assign({}, BUILT[dark ? 'night' : 'paper']);
      Object.assign(pal, { gg: P.gg, ggShade: mixHex(P.gg, '#000000', .1), ggCable: mixHex(P.gg, '#000000', .05), steel: P.steel, steelShade: mixHex(P.steel, '#000000', .14), steelCable: mixHex(P.steel, '#000000', .07), flag: P.accent, ribbon: P.want });
      // the water deepens towards the open sea and lightens at the shore; the land around the places is the flat map's, a little
      // lifted in the dark so it reads against the water under this light
      LK = Object.assign({}, L, { pal, water: P.water, deep: dark ? mixHex(P.water, '#000000', .38) : mixHex(P.water, P.coast, .43), shallow: dark ? mixHex(P.water, P.coast, .25) : mixHex(P.water, '#ffffff', .31), rim: dark ? P.coast : null,
        landHex: mixHex(P.landOther, P.land, dark ? 1.7 : .25), land: null, liftC: lin(L.lift), sideC: lin(L.side), accent: lin(P.accent), ink: lin(P.ink), okInk: lin(P.okInk), noInk: lin(P.noInk) });
      LK.land = lin(LK.landHex); LK.haze = L.bg;
      // the light theme follows the day, gently (js/map3d/air.js sun): the light swings from the east to the west, low and warm at
      // both ends; the hemisphere fills in what a low sun takes from the tops, so the places' colours read the same all day
      if (!dark && AIR) {
        const d = new Date(), m = /[?&]m3d-hour=([\d.]+)/.exec(location.search), s = AIR.sun(m ? +m[1] : d.getHours() + d.getMinutes() / 60, Math.floor((d - new Date(d.getFullYear(), 0, 0)) / 864e5));
        const ki = L.key.i * (1 + 0.25 * s.low), top0 = L.key.i * Math.sin(L.key.el * Math.PI / 180);
        LK.key = { c: mixHex(L.key.c, '#ffc98a', s.warm * 0.8), i: ki, az: s.az, el: s.el };
        LK.hemi = { sky: mixHex(L.hemi.sky, '#f7ead6', s.warm * 0.7), ground: L.hemi.ground, i: L.hemi.i + 0.9 * Math.max(0, top0 - ki * Math.sin(s.el * Math.PI / 180)) };
        LK.haze = mixHex(L.bg, '#f3dcc0', s.warm * 0.55); LK.zenith = mixHex(L.zenith, '#b9bfd2', s.warm * 0.6); LK.glowK = L.glowK + s.warm * 0.5;
        sunKey = Math.round(s.az / 3) + '|' + Math.round(s.el / 2) + '|' + Math.round(s.warm * 20);
      }
    }

    // ---- the camera ----
    const dOf = w => w * F * H / (2 * W);                                 // how far the camera stands for a ground width w at the centre
    const phAuto = d => lerp(PH_NEAR, PH_FAR, smooth(Math.log(d), Math.log(D_NEAR), Math.log(dFar)));
    const phTop = (d, a) => Math.min(PH_MAX, a + PH_ADD, Math.acos(Math.min(1, CAM_CLEAR / d)));
    const phOf = (w, off) => { const d = dOf(w), a = phAuto(d); return clamp(a + off, PH_MIN, phTop(d, a)); };
    const vexOf = d => RL ? 1 + (VEX_HILLS - 1) * smooth(Math.log(d), Math.log(220), Math.log(1400)) : 1 + (VEX_FAR - 1) * smooth(Math.log(d), Math.log(240), Math.log(1700)); // heights stretch as the map zooms out, so the hills still stand up when they are a few pixels wide (real ground, which no longer stands at each place's highest point all over, is stretched further)
    // position and axes for a state { cx, cz, w, th, off }
    // (over real ground a low, close camera also keeps clear of the hill it stands over: the tilt comes up until it is CAM_OVER
    // above the ground under it, so a view carried towards a mountain rides up its side instead of entering it; only in the bay:
    // outside the height grids heightAt answers with their edge, which means nothing there)
    function camOf(s) {
      const d = dOf(s.w), st = Math.sin(s.th), ct = Math.cos(s.th); let ph = phOf(s.w, s.off);
      if (RL && area.id === 'bay' && ph > 0.8 && FOCUS_Y + d * Math.cos(ph) < HMAX * VEX_HILLS + CAM_OVER) { const vx = vexOf(d); for (let q = 0; q < 3; q++) { const r = d * Math.sin(ph), x = s.cx + r * st, z = s.cz + r * ct, g = Math.max(RL.heightAt(x, z), RL.heightAt(x + 1.2, z), RL.heightAt(x - 1.2, z), RL.heightAt(x, z + 1.2), RL.heightAt(x, z - 1.2)) * vx + CAM_OVER; if (FOCUS_Y + d * Math.cos(ph) >= g) break; ph = Math.max(PH_MIN, Math.acos(clamp((g - FOCUS_Y) / d, -1, 1))); } }
      const sp = Math.sin(ph), cp = Math.cos(ph);
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
      for (let i = 0; i < HOODS.length; i++) { const bb = BB[i]; if (x < bb[0] - near || x > bb[2] + near || y < bb[1] - near || y > bb[3] + near || topAt(i) <= h) continue; if (Geom.inPolys(PPD[i], x, y) || (near > 0 && PPD[i].some(poly => ringNear(poly[0], x, y, near * near)))) h = Math.max(h, gAt(i, x, y)); }
      return h < 0 ? 0 : h;
    }
    // the first thing a ray from a screen point meets: the top of a block, or its wall, else the water. { i, x, y } in map units
    function pick(c, sx, sy) {
      const r = rayOf(c, sx, sy), dy = r[1] < -1e-4 ? r[1] : -1e-4, tOf = y => (y - c.py) / dy, far = c.d * 12 / (Math.hypot(r[0], r[2]) || 1e-9);
      const t0 = Math.max(0, tOf(HMAX * c.vex)), tg = Math.min(Math.max(t0, tOf(0)), Math.max(far, t0));
      const ax = c.px + r[0] * t0, ay = c.pz + r[2] * t0, gx = c.px + r[0] * tg, gy = c.pz + r[2] * tg;
      const x0 = Math.min(ax, gx), x1 = Math.max(ax, gx), y0 = Math.min(ay, gy), y1 = Math.max(ay, gy);
      let best = -1, bt = tg; const hl = Math.hypot(r[0], r[2]) || 1e-9;
      for (let i = 0; i < HOODS.length; i++) {
        const bb = BB[i]; if (bb[2] < x0 || bb[0] > x1 || bb[3] < y0 || bb[1] > y1) continue;
        const ti = Math.max(0, tOf(topAt(i) * c.vex)); if (ti >= bt) continue;
        if (RL && RL.has(i)) {
          // real ground: the stretches of the ray over the place in plan (between its crossings of the outline); where one begins
          // under the ground it is the wall there; else the ray is walked over the place's ground to where it first goes under
          const ex = gx - ax, ey = gy - ay, us = []; let ins = Geom.inPolys(PPD[i], ax, ay);
          for (const poly of PPD[i]) for (const ring of poly) for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) { const px = ring[b][0], py = ring[b][1], fx = ring[a][0] - px, fy = ring[a][1] - py, den = ex * fy - ey * fx; if (Math.abs(den) < 1e-12) continue; const u = ((px - ax) * fy - (py - ay) * fx) / den, w = ((px - ax) * ey - (py - ay) * ex) / den; if (u > 0 && u <= 1 && w >= 0 && w < 1) us.push(u); }
          us.sort((p, q) => p - q); us.push(1.000001);
          let u0 = 0;
          for (const u of us) {
            if (ins) { let ta = Math.max(ti, t0 + (tg - t0) * u0); const tb = Math.min(bt, t0 + (tg - t0) * Math.min(1, u)); if (ta >= bt) break;
              if (ta < tb) { let hit = RL.ray(i, c.px, c.py, c.pz, r[0], dy, r[2], ta, tb, liftV[i], c.vex); if (hit === ta && u0 > 0 && ta > ti) hit = ta + 1e-4 * (tg - t0);   // (under the ground where the stretch begins: the wall)
                if (hit >= 0 && hit < bt) { best = i; bt = hit; break; } } }
            ins = !ins; u0 = u;
          }
          continue;
        }
        const qx = c.px + r[0] * ti, qy = c.pz + r[2] * ti;
        if (Geom.inPolys(PPD[i], qx, qy)) { best = i; bt = ti; continue; }
        // below its top: the ray may come in through the wall. The first crossing of the place's outline between there and the ground
        const ex = gx - qx, ey = gy - qy; let s = Infinity;
        for (const poly of PPD[i]) { const ring = poly[0]; for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) { const px = ring[b][0], py = ring[b][1], fx = ring[a][0] - px, fy = ring[a][1] - py, den = ex * fy - ey * fx; if (Math.abs(den) < 1e-12) continue; const u = ((px - qx) * fy - (py - qy) * fx) / den, w = ((px - qx) * ey - (py - qy) * ex) / den; if (u >= 0 && u <= 1 && w >= 0 && w <= 1 && u < s) s = u; } }
        if (s <= 1) { const t = ti + (tg - ti) * s + 1e-4 * (tg - ti); if (t < bt) { best = i; bt = t; } }
      }
      let x = c.px + r[0] * bt, y = c.pz + r[2] * bt; const h = best < 0 ? 0 : RL && RL.has(best) ? (c.py + dy * bt) / c.vex : topAt(best); // the height of what was met (a plateau: its top)
      if (best >= 0 && !Geom.inPolys(PPD[best], x, y)) { x += r[0] / hl * .03; y += r[2] / hl * .03; } // a wall: a point just inside it
      if (best >= 0 && COV.some(c => c.size)) { const j = firstAt(x, y); if (j >= 0) best = j; } // ground two places claim: the flat map's answer, the first in the list
      return { i: best, x, y, h };
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
      const capOff = () => { if (!cut) s.off = Math.min(goal.off, PH_FIT - phAuto(dOf(s.w))); }; // a fit keeps the tilt by hand, and comes back up only where the angle at its own distance would pass PH_FIT
      const ext = () => { capOff(); const c = camOf(s), e = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity, bad: false };
        for (const X of [mx - hx, mx + hx]) for (const Z of [my - hy, my + hy]) for (const Y of [0, top]) { const p = project(c, X, Y * c.vex, Z); if (p[2] <= 1e-6) e.bad = true; e.x0 = Math.min(e.x0, p[0]); e.x1 = Math.max(e.x1, p[0]); e.y0 = Math.min(e.y0, p[1]); e.y1 = Math.max(e.y1, p[1]); }
        return e; };
      const centre = () => { const e = ext(), a = groundAt(s, (e.x0 + e.x1) / 2, (e.y0 + e.y1) / 2), b = groundAt(s, I.left + vw / 2, I.top + vh / 2); s.cx += a[0] - b[0]; s.cz += a[1] - b[1]; };
      for (let it = 0; it < 5; it++) {
        let lo = 0.5, hi = 60000; for (let k = 0; k < 30; k++) { s.w = Math.sqrt(lo * hi); const e = ext(); if (e.bad || e.x1 - e.x0 > vw || e.y1 - e.y0 > vh) lo = s.w; else hi = s.w; }
        s.w = Math.max(hi, (minWv || 0) * W / vw); centre();
      }
      limit(s, ta);
      for (let n = 0; n < 20 && s.w < maxW(ta); n++) { const e = ext(); if (!e.bad && e.x0 >= I.left - .5 && e.x1 <= I.left + vw + .5 && e.y0 >= I.top - .5 && e.y1 <= I.top + vh + .5) break; s.w *= 1.02; centre(); limit(s, ta); }
      capOff(); return viewOf(s);
    }
    const topIn = b => { let top = 0; for (let i = 0; i < HOODS.length; i++) { const q = BB[i]; if (q[2] >= b[0] && q[0] <= b[2] && q[3] >= b[1] && q[1] <= b[3]) top = Math.max(top, HT[i] + (i === sel ? LIFT : 0)); } return top; }; // fitView's height for a box
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
    // (a finger in the sky holds the ground just under the horizon)
    const underSky = (c, sy) => Math.max(sy, H / 2 - c.g / Math.tan(c.ph) + H * 0.05);
    function grabAt(s, sx, sy) { const c = camOf(s), p = pick(c, sx, underSky(c, sy)); return { x: p.x, z: p.y, h: p.h }; }
    // (where the camera rides up over a hill the tilt changes with the centre, and the plain move misses: it is made again with the
    // camera that move gives, three times at most, until the point is within half a pixel of the finger. Each time the better of
    // two corrections is kept: the plain one, and one that allows for how the point under the finger moves with the centre there)
    function hold(s, g, sx, sy) {
      const at = (cx, cz) => { const c = camOf({ cx, cz, w: s.w, th: s.th, off: s.off }), y = underSky(c, sy), p = planeAt(c, sx, y, g.h * c.vex), e = project(c, g.x, g.h * c.vex, g.z); return { f: [p[0] - g.x, p[1] - g.z], px: Math.hypot(e[0] - sx, e[1] - y) }; };
      let r = at(s.cx, s.cz); s.cx -= r.f[0]; s.cz -= r.f[1];
      for (let q = 0; q < 3; q++) {
        r = at(s.cx, s.cz); if (!(r.px >= 0.5)) break;
        const h = s.w * 1e-4, a = at(s.cx + h, s.cz).f, b = at(s.cx, s.cz + h).f, f = r.f, j11 = (a[0] - f[0]) / h, j21 = (a[1] - f[1]) / h, j12 = (b[0] - f[0]) / h, j22 = (b[1] - f[1]) / h, det = j11 * j22 - j12 * j21, steps = [f, [f[0] / 2, f[1] / 2]];
        if (Math.abs(det) > 1e-9) { const nx = (j22 * f[0] - j12 * f[1]) / det, nz = (j11 * f[1] - j21 * f[0]) / det; steps.unshift([nx, nz], [nx / 2, nz / 2]); }
        let best = null, bp = r.px; for (const m of steps) { if (!(Math.hypot(m[0], m[1]) < s.w)) continue; const t = at(s.cx - m[0], s.cz - m[1]); if (t.px < bp) { bp = t.px; best = m; } }
        if (!best) break; s.cx -= best[0]; s.cz -= best[1];
      }
    }
    function zoomAt(sx, sy, factor, instant) { // keep what is under (sx, sy) where it is
      const b = instant ? cur : goal, a = grabAt(b, sx, sy); b.w = clamp(b.w * factor, minW(), maxW()); hold(b, a, sx, sy); limit(b);
      if (instant) { Object.assign(goal, cur); mode = 'drag'; } else if (mode !== 'smooth') { fly = null; mode = 'smooth'; }
      userMoved = true; kick();
    }
    function setTilt(s, d) { const dd = dOf(s.w), a = phAuto(dd); s.off = clamp(camOf(s).ph + d, PH_MIN, phTop(dd, a)) - a; s.off = camOf(s).ph - a; } // from the tilt drawn, and only as far as it is drawn (over a hill, less than asked for): no tilt is stored up there to fall on the view when it leaves the hill

    // ---- the scene ----
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap; renderer.shadowMap.autoUpdate = false;
    const coarse = matchMedia('(pointer: coarse)').matches;
    const scene = new THREE.Scene(); scene.fog = new THREE.Fog(0xffffff, 100, 1000);
    const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 10000);
    const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1), key = new THREE.DirectionalLight(0xffffff, 1);
    key.castShadow = SW.shadows; key.shadow.mapSize.set(coarse ? 2048 : 4096, coarse ? 2048 : 4096); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.6;
    scene.add(hemi, key, key.target);
    const landG = new THREE.Group(); scene.add(landG);                     // everything that stands on the land: its heights stretch with the zoom
    const secG = new THREE.Group(); landG.add(secG);
    const C3 = new THREE.Color(), col = hex => { C3.set(hex); return [C3.r, C3.g, C3.b]; };
    let tiles = null, tileMesh = null, tilePos = null, tileCol = null, baseY = null, tileS = null, landMesh = null, landS = null, bridges = null, icons = [], cityParts = [];
    let blockRings = null, cityFoot = [], cityStrip = [];
    let fineS = null, fineMesh = null, finePos = null, fineCol = null, fineBaseY = null, fineOn = false, fineBusy = false, tileSplit = 0, rimSplit = 0, rimF = null, rimBase = null, rimFBase = null, scatterY = null; // the full meshes of the places the fine grid covers (the relief), drawn close in instead of their far ones
    let rim = null, rimPos = null, flags = null, books = null, waterTex = null, wcv = null, wbox = null, wsc = 1, beam = null, nightBuilt = false, scatter = null, shadowDirty = true, vex = 1, lmScale = 1, sh = {}, shT = 0, lightBasis = null;
    const tileMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0 }), landMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0, roughness: 0.95 });
    const farMat = new THREE.MeshStandardMaterial({ metalness: 0, roughness: 0.95 }), waterMat = new THREE.MeshStandardMaterial({});
    const inlandMat = new THREE.MeshStandardMaterial({ metalness: 0, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    const markMat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0, roughness: 0.6 });
    // One small texture the fabric's shaders read: row 0, a texel per place, its top's colour as painted (paintTile) and how far it
    // is lifted (setLift); row 1, a texel per chunk of fabric, how far it has grown
    let TW = 512; while (TW < HOODS.length) TW *= 2;
    const placeData = new Float32Array(TW * 2 * 4), placeTex = new THREE.DataTexture(placeData, TW, 2, THREE.RGBAFormat, THREE.FloatType); placeTex.magFilter = placeTex.minFilter = THREE.NearestFilter; placeTex.needsUpdate = true;
    const fabU = { uPlace: { value: placeTex }, uTexW: { value: TW }, uGrow: { value: 0 }, uFocus: { value: new THREE.Vector4(0, 0, 1, 2) }, uPale: { value: new THREE.Color() }, uRoofK: { value: 0.5 }, uWallK: { value: 0.3 }, uTree: { value: new THREE.Color() }, uTreeK: { value: 0.5 }, uWin: { value: new THREE.Color(0, 0, 0) }, uRise: { value: 1 } }; // uRise: the real buildings' growth from afar, the landmarks' (updateScene)
    const fab = { gen: null, gl: null, chunks: new Map(), queue: [], slots: Array.from({ length: TW }, (_, i) => TW - 1 - i), timer: 0, live: 0, land: new Map(), key: '', nb: 0, nt: 0 };
    const rb = { gen: null, gl: null, chunks: new Map(), queue: [], slots: fab.slots.splice(0, 72), timer: 0, live: 0, key: '', n: 0, tris: 0, tall: [], tallNext: 0, tallTimer: 0, tallGl: null, tallU: null }; // the real buildings (js/map3d/real.js): their chunks, as the fabric's, with slots of their own in the same texture; and the tall ones, in a few shapes of their own made once (tallPump)
    const sky = AIR ? AIR.sky(THREE) : null; if (sky) scene.add(sky.mesh);
    const waterU = AIR ? AIR.water(THREE, waterMat) : null; let noise = null, wash = null, fogBank = null, ferries = [], traffic = null;
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
    const ground = (x, z) => { const i = hoodAt(x, z); return i >= 0 ? hAt(i, x, z) : land.LAND_TOP; };

    // The scene is built after the constructor has returned, in steps with a breath between them, so the app's first paint does not
    // wait for the map; until the first 3D frame the stage shows its water colour. The camera, the fits and the hit tests need none of it.
    function build() {
      const steps = [
        () => { // the blocks
          const t0 = now(), ol = land.blocks(); let tb = null; stat.blocks = ol.from; blockRings = ol.blocks;
          if (RL) try { tb = RL.buildTiles(ol); } catch (e) { flatLand(e); }                                   // the relief fails as it is made: the plateaus
          if (!tb) tb = land.buildTiles(ol); tiles = tb.tiles; tileS = tb.mesh; tileSplit = tb.split || 0; heights();
          tiles.forEach(t => { if (!t.rim) t.rim = t.edge.map(r => r.map(q => [q[0], t.H, q[1]])); });
          tileMesh = meshOf(tileS, tileMat); tileMesh.castShadow = tileMesh.receiveShadow = true; landG.add(tileMesh);
          tilePos = tileMesh.geometry.attributes.position; tileCol = tileMesh.geometry.attributes.color; baseY = new Float32Array(tileS.n); for (let i = 0; i < tileS.n; i++) baseY[i] = tileS.pos[i * 3 + 1];
          tileMesh.geometry.boundingBox.max.y += LIFT; tileMesh.geometry.boundingSphere.radius += LIFT;
          // a hairline in the paper's colour round the top of every block (the flat map's line between places), from the region
          // scale inwards: it keeps the tops apart where the rounded edge is too fine to see
          { const segs = [], hs = []; tiles.filter(t => !t.far).concat(tiles.filter(t => t.far)).forEach(t => { if (t.far && !rimSplit) rimSplit = segs.length / 4 * 6; t.r0 = segs.length; rimSegs(t.rim, segs, hs); t.r1 = segs.length; }); // (in the order of the blocks' mesh: the places with a far mesh last)
            rim = new THREE.Mesh(ribbon(segs, 0.006, 1, hs), lineMat(P.paper, .5)); rim.renderOrder = 1; rim.frustumCulled = false; rimPos = rim.geometry.attributes.position; rimBase = new Float32Array(rimPos.count); for (let k = 0; k < rimPos.count; k++) rimBase[k] = rimPos.array[k * 3 + 1]; secG.add(rim); }
          stat.build.blocks = now() - t0;
        },
        () => { // the bridges, the landmarks, the flag and the bookmark
          const t0 = now(); bridges = MD.bridges(ground); addBuilt(bridges);
          icons = MD.icons(ground, (x, z, x0, z0) => { const i = hoodAt(x0, z0); return i >= 0 && Geom.inPolys(tiles[i].tops, x, z) ? hAt(i, x, z) : null; }); icons.forEach(ic => { ic.mesh = addBuilt(ic); ic.hood = hoodAt(ic.x, ic.z); ic.lm = LM_ID[ic.id]; ic.mesh.position.set(ic.x, ic.y, ic.z); });
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
            const sea = new THREE.Mesh(g, waterMat); sea.receiveShadow = true; scene.add(sea); } // the blocks, the bridges and the towers throw their shadows on it too, close in
          stat.build.land = now() - t0;
        },
        () => { const t0 = now(); applyLook(); try { const q = SW.q >= 0 ? SW.q : Math.round(+sessionStorage.getItem('sbs-map3d-q')); if (q > 0) setQuality(q); } catch (e) {} stat.build.look = now() - t0; ready = true; needs = true; poke(); kick(); }, // (the step the governor settled on earlier in this session: a slow device does not start from the top again)
        () => { // after the first frame: the real buildings' outlines (js/map3d/real.js, from js/map3d/buildings.js), unpacked and sorted by chunk; their shapes are made as the camera comes near. Without them (the file missing or cut short, ?m3d-real=off) the town is the made-up one it was
          const t0 = now(); if (RB && !/[?&]m3d-real=off(?:&|$)/.test(location.search)) try {
            const boxes = icons.map(ic => { const b = ic.geometry.boundingBox, k = 1.12; return [ic.x + b.min.x * k, ic.z + b.min.z * k, ic.x + b.max.x * k, ic.z + b.max.z * k]; }); // a landmark's plan, a little grown: no real outline stands in it
            rb.gen = RB.make(M3D.buildingData, { inTop: (x, z) => { const i = hoodAt(x, z); return i >= 0 && Geom.inPolys(tiles[i].tops, x, z) ? i : -1; }, inTopOf: (i, x, z) => Geom.inPolys(tiles[i].tops, x, z), hAt, boxes }); rb.gl = RB.gl(THREE, fabU);
            rb.tallU = Object.assign({}, fabU, { uGrow: { value: 0 }, uFocus: { value: new THREE.Vector4(0, 0, 1e6, 2e6) } }); rb.tallGl = RB.gl(THREE, rb.tallU); // the tall ones: their own rise (from the city-wide view), everywhere in sight
            // its two shaders are made now, one a frame, on a building nobody sees (as the fabric's below): not in the first flight in
            const slot = rb.slots.pop(), d = rb.gl.mesh({ ix: 0, iz: 0, n: 3, pos: new Float32Array([cur.cx, 0, cur.cz, cur.cx + 0.01, 0, cur.cz, cur.cx, 0.01, cur.cz]), nor: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), aB: new Float32Array(12), aW: new Float32Array(12), idx: new Uint16Array([0, 1, 2]), y0: 0, y1: 0.01 }, slot);
            placeData[(TW + slot) * 4] = 0; d.frustumCulled = false; d.castShadow = false;
            const seq = [() => landG.add(d), () => { d.castShadow = true; shadowDirty = true; }, () => { landG.remove(d); d.geometry.dispose(); rb.slots.push(slot); }];
            let q = 0; const go = () => { if (dead) return; const t1 = now(); seq[q++](); needs = true; if (raf) { cancelAnimationFrame(raf); raf = 0; } lastT = now(); frame(lastT, true); stat.build['realWarm' + q] = now() - t1; if (q < seq.length) setTimeout(go, 120); }; setTimeout(go, 120);
          } catch (e) { rb.gen = rb.gl = null; console.warn('3D map, the real buildings left out: ' + (e && e.message || e)); }
          stat.build.real = now() - t0;
        },
        () => { // the skylines and the Strip's resorts (by place, so each rises with its block), then the night's lights
          const t0 = now(), strip = {}; HOODS.forEach(h => { if (REGS[h.region] && REGS[h.region].away && SUBD[h.name]) strip[h.name] = SUBD[h.name]; });
          const made = MD.city((x, z) => { const i = hoodAt(x, z); return i >= 0 ? HOODS[i].name : null; }, ground, strip, icons, !!rb.gen); cityFoot = made.foot || []; cityStrip = made.strip || [];
          cityParts = made.map(part => { part.mesh = addBuilt(part); part.hood = IDX[part.place] != null ? IDX[part.place] : -1; part.pts = dark ? pointsOf(part.lights, part.mesh) : null; return part; });
          paintBuilt(); if (dark) buildNight(); stat.build.city = now() - t0; shadowDirty = true; needs = true; kick();
        },
        // From here on, extras: a step of them that fails says so in the console and is left out; the map stays (extra, below)
        extra('air', () => { // the air (js/map3d/air.js): the water's ripples, the wash round the blocks
          noise = AIR.noiseTex(THREE); waterU.uNoise.value = noise; const rings = []; (blockRings || []).forEach(pieces => pieces.forEach(rs => rs.forEach(r => rings.push(r)))); wash = AIR.wash(THREE, rings); scene.add(wash.mesh); applyAir();
        }),
        extra('fog', () => { buildFog(); applyAir(); }),
        extra('life', () => { buildLife(); paintBuilt(); applyAir(); }),
        () => { // the relief's full meshes (js/map3d/relief.js): the places the fine grid covers, a place at a time, then one mesh of them all, drawn instead of their far ones when the map is close (setFine)
          if (!RL || !RL.fineList.length) return; const S2 = land.sink(), list = RL.fineList.slice(), t0 = now(); let q = 0, spent = 0; fineBusy = true;
          const go = () => {
            if (dead) return; const t1 = now();
            try {
              if (!RL) throw new Error('no relief'); while (q < list.length && now() - t1 < (moving ? 3 : 7)) { const i = list[q++]; tiles[i].fine = RL.buildFine(S2, i, blockRings); }
              spent += now() - t1; if (q < list.length) return void setTimeout(go, moving ? 24 : 8);
              fineS = S2; fineMesh = meshOf(S2, tileMat); fineMesh.castShadow = fineMesh.receiveShadow = true; fineMesh.visible = false; fineMesh.geometry.boundingBox.max.y += LIFT; fineMesh.geometry.boundingSphere.radius += LIFT; landG.add(fineMesh);
              finePos = fineMesh.geometry.attributes.position; fineCol = fineMesh.geometry.attributes.color; fineBaseY = new Float32Array(S2.n); for (let i = 0; i < S2.n; i++) fineBaseY[i] = S2.pos[i * 3 + 1];
              const segs = [], hs = []; list.forEach(i => { const f = tiles[i].fine; f.r0 = segs.length; rimSegs(f.rim, segs, hs); f.r1 = segs.length; });
              rimF = new THREE.Mesh(ribbon(segs, 0.006, 1, hs), rim.material); rimF.renderOrder = 1; rimF.frustumCulled = false; rimF.visible = false; rimFBase = new Float32Array(rimF.geometry.attributes.position.count); for (let k = 0; k < rimFBase.length; k++) rimFBase[k] = rimF.geometry.attributes.position.array[k * 3 + 1]; secG.add(rimF);
              heights(); list.forEach(i => { tiles[i].H = HT[i]; if (liftV[i]) setLift(i, liftV[i]); }); paintAll = true;
            } catch (e) { console.warn('3D map, the close relief left out: ' + (e && e.stack || e)); fineMesh = null;
              // the far meshes stay what is drawn: from here on taps, spots, lines, names and what stands on those places read their ground
              if (RL && RL.coarse) { RL.coarse(); heights(); list.forEach(i => { tiles[i].fine = null; tiles[i].H = HT[i]; }); for (const m of secMeshes.values()) m.dirty = true; selKey = ''; paintAll = true; } }
            fineBusy = false; stat.build.fine = Math.round(spent); stat.build.fineDone = Math.round(now() - t0); needs = true; kick();
          };
          go();
        },
        () => { // the city fabric (js/map3d/fabric.js): only its plan; its chunks are made as the camera comes near
          const t0 = now(); try { if (FB && FB.gl) {
            const avoid = []; for (const ic of icons) avoid.push([ic.x, ic.z, ic.r * 1.8 + 0.2]); for (const f of cityFoot) avoid.push(f); HOODS.forEach(h => avoid.push([h.cx, h.cy, 0.5])); // (landmarks are drawn up to about 1.8 times their size while the fabric shows)
            fab.gen = FB.make({ HOODS, BB, HT, hAt, INFO: window.INFO, SUBD, REGS, proj, inTop: (i, x, z) => Geom.inPolys(tiles[i].tops, x, z), avoid, strip: cityStrip, solid: rb.gen ? (x, z, r) => !!rb.gen && rb.gen.solid(x, z, r) : null, dense: rb.gen ? (x, z) => !!rb.gen && rb.gen.dense(x, z) : null }); fab.gl = FB.gl(THREE, fabU); // (solid, dense: once the real buildings have given up, rbGiveUp, nothing real stands anywhere)
            // its four shaders are made now, one a frame, on a building and a tree nobody sees: not in the middle of the first flight in
            const d = fab.gl.mesh({ ix: 0, iz: 0, nb: 1, nt: 1, b: new Float32Array([cur.cx, 0, cur.cz, 0, 1, 1, 1, 0, 0, 0, 0]), t: new Float32Array([cur.cx, 0, cur.cz, 1, 0, 0, 0]) }, fab.slots.shift());
            for (const m of [d.b, d.t]) { m.frustumCulled = false; m.castShadow = false; }
            const seq = [() => landG.add(d.b), () => landG.add(d.t), () => { d.b.castShadow = d.t.castShadow = true; shadowDirty = true; }, () => { for (const m of [d.b, d.t]) { landG.remove(m); fabFree(m); } }];
            let q = 0; const go = () => { if (dead) return; const t1 = now(); seq[q++](); needs = true; if (raf) { cancelAnimationFrame(raf); raf = 0; } lastT = now(); frame(lastT, true); stat.build['warm' + q] = now() - t1; if (q < seq.length) setTimeout(go, 120); }; setTimeout(go, 120);
          } } catch (e) { fab.gl = null; console.warn('3D map, the city fabric left out: ' + (e && e.stack || e)); }
          stat.build.fabric = now() - t0; needs = true; kick();
        },
      ];
      let k = 0;
      function extra(name, fn) { return () => { const t0 = now(); if (AIR) try { fn(); } catch (e) { console.warn('3D map, ' + name + ' left out: ' + (e && e.stack || e)); } stat.build[name] = now() - t0; needs = true; kick(); }; }
      const next = () => {
        if (dead) return;
        try { steps[k++](); } catch (e) { giveUp(e); return; }
        if (k < steps.length) setTimeout(next, k === 4 ? 60 : k > 4 ? 30 : 0); // after the first frame: a breath between the steps
      };
      setTimeout(next, 0);
    }
    // the 3D map cannot be made (or its first frame drawn) here: say so once in the console, and come back as the flat map, once:
    // a reload with the session's mark, or where site storage is blocked the same address with ?map=2d (index.html: it refuses the
    // 3D map, so this cannot come round again)
    function giveUp(e) {
      if (dead) return; dead = true; console.error('3D map: ' + (e && e.stack || e));
      try { sessionStorage.setItem('sbs-map3d-off', '1'); } catch (err) { try { const u = new URL(location.href); if (u.searchParams.get('map') !== '2d') { u.searchParams.set('map', '2d'); location.replace(u.href); } } catch (er) {} return; }
      try { location.reload(); } catch (err) {}
    }
    // the relief cannot be made here: say so once, and every place is the plateau it was
    function flatLand(e) { console.warn('3D map, the land stays flat: ' + (e && e.stack || e)); RL = null; land.heightAt = null; heights(); }
    // the rim of a block as it lies, as segments for a ribbon and the height at each end
    function rimSegs(rings, segs, hs) { for (const r of rings) for (let a = 0, b = r.length - 1; a < r.length; b = a++) { segs.push(r[b][0], r[b][2], r[a][0], r[a][2]); hs.push(r[b][1], r[a][1]); } }
    // close in, the places the fine grid covers are drawn by their full meshes; from far off by the far ones (the end of the blocks' mesh)
    function setFine(on) {
      fineOn = on; fineMesh.visible = on; tileMesh.geometry.setDrawRange(0, on ? tileSplit : Infinity); rim.geometry.setDrawRange(0, on ? rimSplit : Infinity);
      for (const [i, e] of edgeMeshes) { drop(e.mesh); edgeMeshes.delete(i); } shadowDirty = true; needs = true;
    }
    function buildNight() {
      if (nightBuilt || !ready) return; nightBuilt = true;
      pointsOf(bridges.lights); icons.forEach(ic => pointsOf(ic.lights, ic.mesh)); cityParts.forEach(p => { if (!p.pts) p.pts = pointsOf(p.lights, p.mesh); }); lifeNight();
      // a scatter of small warm lights over every place, denser where it is busy: on a loose street grid, most crossings dark, so
      // it reads as blocks of lit streets, not as stars
      const R = (() => { let s = 4242; return () => (s = (s * 48271) % 2147483647) / 2147483647; })(), dens = { buzz: 1, sun: 0.55, fog: 0.5, hills: 0.4, water: 0.42, green: 0.07 }, list = [], INFO = window.INFO || {};
      HOODS.forEach((h, t) => {
        const city = DETAIL[t] > 1 || h.region === 'sf', pitch = city ? 0.6 : 2.8, keep = (dens[(INFO[h.name] || {}).vibe] || 0.4) * (city ? 0.22 : 0.12), b = BB[t], ang = h.region === 'sf' ? 0.16 : 0.5, ca = Math.cos(ang), sa = Math.sin(ang);
        const cx = (b[0] + b[2]) / 2, cz = (b[1] + b[3]) / 2, rad = Math.hypot(b[2] - b[0], b[3] - b[1]) / 2, n = Math.ceil(rad / pitch), i0 = list.length;
        for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
          if (R() > keep) continue; const u = (i + (R() - 0.5) * 0.3) * pitch, v = (j + (R() - 0.5) * 0.3) * pitch, x = cx + u * ca - v * sa, z = cz + u * sa + v * ca;
          if (x < b[0] || x > b[2] || z < b[1] || z > b[3] || !Geom.inPolys(PPD[t], x, z)) continue;
          const k = R(); list.push({ x, y: hAt(t, x, z) + 0.06, z, kind: k > 0.93 ? '#cfe2ff' : k > 0.55 ? '#ffd39a' : '#ffb866', size: (city ? 0.24 : 0.8) * (0.7 + R() * 0.6) });
        }
        tiles[t].l0 = i0; tiles[t].l1 = list.length;
      });
      scatter = pointsOf(list); scatterY = Float32Array.from(list, l => l.y); if (scatter) HOODS.forEach((h, t) => { if (liftV[t]) liftLights(t); });
      const lux = icons.find(i => i.id === 'luxor'); // the Luxor's sky beam
      if (lux) { const g = new THREE.CylinderGeometry(0.28, 0.05, 30, 10, 1, true); g.translate(0, lux.h + 15, 0); beam = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xbcd0ff, transparent: true, opacity: 0.09, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false })); lux.mesh.add(beam); }
    }
    // the fog bank: over the places the app calls foggy (data/info.js fog 4 and 5) and the Golden Gate, draped over their tops
    function buildFog() {
      if (!FOG_ON || !noise) return; const INFO = window.INFO || {}, places = [], box = [Infinity, Infinity, -Infinity, -Infinity];
      HOODS.forEach((h, i) => { const f = (INFO[h.name] || {}).fog; if (!(f >= 4) || !PP[i] || areaObj(h.cx, h.cy) !== AREAS[0]) return; places.push({ polys: PP[i], k: f >= 5 ? 1 : 0.6 }); const b = BB[i]; box[0] = Math.min(box[0], b[0]); box[1] = Math.min(box[1], b[1]); box[2] = Math.max(box[2], b[2]); box[3] = Math.max(box[3], b[3]); });
      if (!places.length) return; const gg = bridges.frames.gg, mid = gg.P(gg.L / 2, 0, 0);
      box[0] -= 16; box[1] -= 12; box[2] += 12; box[3] += 12;
      fogBank = AIR.fog(THREE, AIR.fogMask(THREE, box, places, [[mid[0], mid[2], 13, 8, 1], [mid[0] - 14, mid[2] + 1, 18, 12, 0.9]]), box, noise, ground, [0.45, 0.9, 1.4]); landG.add(fogBank.group);
    }
    // what moves: three ferries out of the Ferry Building, and at night the traffic on the three great bridges
    const FERRIES = [[[-122.3915, 37.7985], [-122.3990, 37.8125], [-122.4300, 37.8160], [-122.4560, 37.8350], [-122.4745, 37.8545]],
      [[-122.3895, 37.7965], [-122.3790, 37.7895], [-122.3570, 37.7900], [-122.3410, 37.7955]],
      [[-122.3900, 37.7995], [-122.3930, 37.8300], [-122.4060, 37.8720], [-122.4380, 37.9050], [-122.4580, 37.9260]]];
    function buildLife() {
      const wg = AIR.wake(THREE), wm = AIR.wakeMat(THREE);
      FERRIES.forEach((r, k) => { const b = new MD.Builder(); AIR.ferryModel(b); const model = b.finish(), mesh = addBuilt(model, false, scene), wk = new THREE.Mesh(wg, wm); wk.position.y = 0.012; wk.renderOrder = 2; mesh.add(wk);
        ferries.push({ mesh, wake: wk, lights: model.lights, pts: null, path: AIR.ferryPath(r.map(proj)), off: 9 + k * 23, speed: 0.2 + k * 0.03 }); });
      const R = (() => { let s = 99; return () => (s = (s * 16807) % 2147483647) / 2147483647; })(), cars = [], list = [];
      for (const [f, hw] of [[bridges.frames.gg, 6.5], [bridges.frames.bayWest, 4.8], [bridges.frames.bayEast, 17]]) for (const dir of [-1, 1]) { const n = Math.max(3, Math.round(f.L / 260)); for (let i = 0; i < n; i++) { cars.push({ f, lat: dir * hw, dir, x0: (i + R() * 0.7) / n * f.L, v: 30 + R() * 8 }); list.push({ x: 0, y: 0, z: 0, kind: dir > 0 ? '#fff0d0' : '#ff5846', size: 0.5 }); } }
      traffic = { cars, pts: pointsOf(list) }; if (traffic.pts) traffic.pts.frustumCulled = false;
      if (nightBuilt) lifeNight(); stepLife();
    }
    function lifeNight() { for (const f of ferries) if (!f.pts) f.pts = pointsOf(f.lights, f.mesh); }
    function stepLife() {
      const show = Q.life && !quiz && area === AREAS[0], s = clamp(lmScale * 1.9, 1.9, 4.5);
      for (const f of ferries) { const p = f.path.at(f.off + ambT * f.speed); f.mesh.visible = show; f.mesh.position.set(p[0], 0.004, p[1]); f.mesh.rotation.y = p[2]; f.mesh.scale.setScalar(s); }
      if (traffic && traffic.pts) { traffic.pts.visible = show && !!LK.lights; if (traffic.pts.visible) { const a = traffic.pts.geometry.attributes.position; traffic.cars.forEach((c, i) => { const x = (((c.x0 + c.dir * ambT * c.v) % c.f.L) + c.f.L) % c.f.L, q = c.f.D(x, c.lat, 2.2); a.array[i * 3] = q[0]; a.array[i * 3 + 1] = q[1]; a.array[i * 3 + 2] = q[2]; }); a.needsUpdate = true; } }
    }
    // the look of the air's own pieces (made after the first look was applied)
    function applyAir() { const L = LK; if (wash) wash.U.uCol.value.set(L.wash); if (fogBank) fogBank.U.uCol.value.set(L.fogC); for (const f of ferries) f.wake.material.uniforms.uCol.value.set(L.wash); }

    // ---- the city fabric: chunks of it made as the camera comes near, a few milliseconds at a time, kept while they are near ----
    const CS = FB ? FB.CS : 8, Q = { level: 0, life: true, fabShadow: true, shadows: SW.shadows, fab: 1, cap: [2, 3] }; // Q: what the frame rate allows (the governor below)
    const T = {}, TQ = {}; let plainMat = null, onDraw = null; // the speed test's settings (tune below): T the pixel ratio and the rules, TQ what it sets of Q; onDraw: told of every frame drawn
    // a chunk's geometry shares the unit building's and tree's position, normal and uv (js/map3d/fabric.js inst): detached first, so
    // dispose frees only the chunk's own buffer, not the GL buffers the other chunks draw with
    const fabFree = m => { const g = m.geometry; for (const k of ['position', 'normal', 'uv']) if (g.attributes[k]) g.deleteAttribute(k); if (g.index) g.setIndex(null); g.dispose(); };
    const fabDist = (ch, f) => Math.hypot((ch.ix + 0.5) * CS - f.x, (ch.iz + 0.5) * CS - f.y);
    function fabLand(ix, iz) { const k = ix * 65536 + iz; let v = fab.land.get(k); if (v === undefined) { const x0 = ix * CS, z0 = iz * CS; v = false; for (let i = 0; i < HOODS.length && !v; i++) { const b = BB[i]; v = b[2] > x0 && b[0] < x0 + CS && b[3] > z0 && b[1] < z0 + CS; } fab.land.set(k, v); } return v; }
    function fabDrop(k, ch) { for (const m of [ch.b, ch.t]) if (m) { landG.remove(m); fabFree(m); } if (ch.slot != null) { placeData[(TW + ch.slot) * 4] = 0; fab.slots.push(ch.slot); fab.live--; fab.nb -= ch.nb; fab.nt -= ch.nt; } fab.chunks.delete(k); }
    // While the map moves the three pumps below are not run from their timers (a timer turn then returns at once): draw gives them one turn
    // a frame between them, after the render, until end (pumpTurn); at rest they run from their timers as before (m3d-pump=old: always the timers)
    const byFrame = () => moving && !SW.pumpOld;
    function fabPump(end) {
      if (!end) fab.timer = 0; if (dead || !fab.gen || (!end && byFrame())) return; const t0 = now(), budget = moving ? 2.5 : 7, f = fabU.uFocus.value; let made = false;
      while (fab.queue.length && (end ? now() < end : now() - t0 < budget)) {
        const q = fab.queue.shift(); if (fab.chunks.has(q.k) || fabDist(q, f) > f.w + CS * 2) continue;     // made already, or the view has moved on
        const c = fab.gen.chunk(q.ix, q.iz); if (!c.nb && !c.nt) { fab.chunks.set(q.k, { ix: q.ix, iz: q.iz }); continue; }
        if (!fab.slots.length) { fab.queue.length = 0; break; }
        const slot = fab.slots.pop(), m = fab.gl.mesh(c, slot); placeData[(TW + slot) * 4] = 0; for (const mm of [m.b, m.t]) if (mm) landG.add(mm);
        fab.chunks.set(q.k, { ix: q.ix, iz: q.iz, slot, b: m.b, t: m.t, g: 0, nb: c.nb, nt: c.nt }); fab.live++; fab.nb += c.nb; fab.nt += c.nt; made = true;
      }
      if (made) { needs = true; kick(); }
      if (fab.live > FAB_MAX) { const far = [...fab.chunks].filter(e => e[1].slot != null).map(e => [fabDist(e[1], f), e]).sort((a, b) => b[0] - a[0]); for (let i = 0; i < far.length && fab.live > FAB_MAX * 0.8; i++) fabDrop(far[i][1][0], far[i][1][1]); }
      if (fab.queue.length && !fab.timer && !byFrame()) fab.timer = setTimeout(fabPump, 0);
    }
    // the real buildings' chunks: made the same way, a few milliseconds at a time; the furthest dropped when there are many
    const RCS = RB ? RB.CS : 6, RB_MAX = 56, TALL_D = [650, 900]; // RB_MAX: under the 60 slots the tall groups leave the chunks (72 less 12), so the furthest are dropped before the slots run out; TALL_D: the camera's distances at which the tall real buildings have risen, and from which they start to rise (the first screen is further off)
    const rbDist = (ch, f) => Math.hypot((ch.ix + 0.5) * RCS - f.x, (ch.iz + 0.5) * RCS - f.y);
    function rbDrop(k, ch) { if (ch.m) { landG.remove(ch.m); ch.m.geometry.dispose(); placeData[(TW + ch.slot) * 4] = 0; rb.slots.push(ch.slot); rb.live--; rb.n -= ch.n; rb.tris -= ch.tris; } rb.chunks.delete(k); }
    function rbPump(end) {
      if (!end) rb.timer = 0; if (dead || !rb.gen || (!end && byFrame())) return; const t0 = now(), budget = moving ? 2.5 : 6, f = fabU.uFocus.value; let made = false;
      try {
        while (rb.queue.length && (end ? now() < end : now() - t0 < budget)) {
          const q = rb.queue.shift(); if (rb.chunks.has(q.k) || rbDist(q, f) > f.w + RCS * 2) continue;
          const c = rb.gen.chunk(q.ix, q.iz); if (!c) { rb.chunks.set(q.k, { ix: q.ix, iz: q.iz }); continue; }
          if (!rb.slots.length) { rb.queue.length = 0; break; }
          const slot = rb.slots.pop(), m = rb.gl.mesh(c, slot); placeData[(TW + slot) * 4] = 0; placeTex.needsUpdate = true; landG.add(m);
          rb.chunks.set(q.k, { ix: q.ix, iz: q.iz, slot, m, g: 0, n: c.count, tris: c.idx.length / 3, half: c.half, quarter: c.quarter }); rb.live++; rb.n += c.count; rb.tris += c.idx.length / 3; made = true;
        }
      } catch (e) { rbGiveUp(e); made = true; }
      if (made) { needs = true; kick(); }
      if (rb.live > RB_MAX) { const far = [...rb.chunks].filter(e => e[1].m).map(e => [rbDist(e[1], f), e]).sort((a, b) => b[0] - a[0]); for (let i = 0; i < far.length && rb.live > RB_MAX * 0.8; i++) rbDrop(far[i][1][0], far[i][1][1]); }
      if (rb.queue.length && !rb.timer && !byFrame()) rb.timer = setTimeout(rbPump, 0);
    }
    // the tall real buildings (real.js tall): made once, a group at a time, a few milliseconds a turn, when the map first comes to the city-wide view; then kept
    function tallPump(end) {
      if (!end) rb.tallTimer = 0; if (dead || !rb.gen || !rb.tallGl || (!end && byFrame()) || (end && !rb.tallGo)) return; const t0 = now(), budget = moving ? 2.5 : 6; let made = false;
      try {
        while (rb.tallNext < rb.gen.tallCount && (end ? now() < end : now() - t0 < budget) && rb.slots.length) {
          const c = rb.gen.tall(rb.tallNext++); if (!c) continue;
          const slot = rb.slots.pop(), m = rb.tallGl.mesh(c, slot), g = m.geometry; placeData[(TW + slot) * 4] = 0; placeTex.needsUpdate = true;
          g.computeBoundingSphere(); g.boundingSphere.radius += (c.y1 - c.y0) * 1.7 + LIFT + 1; m.visible = false; landG.add(m); // (it grows from its ground as far as the landmarks do: uRise)
          rb.tall.push({ m, slot, g: 0, n: c.count, tris: c.idx.length / 3 }); made = true;
        }
      } catch (e) { rbGiveUp(e); return; }
      if (made) { needs = true; kick(); }
      if (rb.gen && rb.tallNext < rb.gen.tallCount && rb.slots.length && !rb.tallTimer && !byFrame()) rb.tallTimer = setTimeout(tallPump, 0);
    }
    let pumpI = 0; // the pump that goes first in the next frame's turn
    function pumpTurn() { const end = now() + 2.5, P3 = [fabPump, rbPump, tallPump], r0 = raf, l0 = lastT; for (let q = 0; q < 3; q++) P3[(pumpI + q) % 3](end); pumpI = (pumpI + 1) % 3; if (raf !== r0) { cancelAnimationFrame(raf); raf = r0; lastT = l0; } } // (a chunk made asks for a frame: draw asks for it itself, once)
    const pumpWork = () => !!((fab.gen && fab.queue.length) || (rb.gen && (rb.queue.length || (rb.tallGo && rb.tallGl && rb.tallNext < rb.gen.tallCount && rb.slots.length)))); // a queue the pumps can still work on
    function pumpsGo() { if (fab.queue.length && !fab.timer) fab.timer = setTimeout(fabPump, 0); if (rb.queue.length && !rb.timer) rb.timer = setTimeout(rbPump, 0); if (rb.tallGo && rb.gen && rb.tallNext < rb.gen.tallCount && rb.slots.length && !rb.tallTimer) rb.tallTimer = setTimeout(tallPump, 0); } // at rest again: the timers of the queues with work
    // the real buildings fail while they are made: they are all taken away, and the fabric made so far with them (it kept clear of
    // them) is made again, now in their place (its wrappers of solid and dense answer "nothing real here" from now on)
    function rbGiveUp(e) {
      console.warn('3D map, the real buildings stopped: ' + (e && e.stack || e)); rb.queue.length = 0; rb.gen = null; rb.key = '';
      for (const [k, ch] of [...rb.chunks]) rbDrop(k, ch); for (const t of rb.tall) { landG.remove(t.m); t.m.geometry.dispose(); placeData[(TW + t.slot) * 4] = 0; rb.slots.push(t.slot); } rb.tall.length = 0; placeTex.needsUpdate = true;
      for (const [k, ch] of [...fab.chunks]) fabDrop(k, ch); fab.queue.length = 0; fab.key = ''; shadowDirty = true;
    }
    // each frame: how far the fabric stands for the zoom, the circle of ground it stands in (a little ahead of the middle of a
    // tilted view), which chunks that asks for, and each chunk's own rise when it is new
    function fabStep(dt, c) {
      if (RL) lineUp.value = 0.04;                                      // a line laid on the relief is drawn as deep as a point a little above it: the ground's own triangles never cut it
      if ((!fab.gl && !rb.gl) || fineBusy) return false;                 // (the fabric waits for the ground it will stand on)
      const k = kNow(), tgt = quiz ? 0 : smooth(k, FK0, FK1) * (Q.fab > 0 ? 1 : 0), U = fabU; let anim = false;
      if (tgt !== U.uGrow.value) { U.uGrow.value = tgt; shadowDirty = true; }
      const R1 = clamp(c.d * (2 + 2.4 * smooth(c.ph, 0.9, 1.4)), 26, 84), fx = cur.cx, fz = cur.cz;
      U.uFocus.value.set(fx, fz, R1 * 0.86, R1); lineUp.value = Math.max(RL ? 0.04 : 0, tgt * Math.min(1, 0.2 / Math.max(0.05, Math.sin(c.ph) * Math.cos(c.ph)))); // a line shows over a house that stands 0.2 or more in front of it (the fabric keeps that street clear), and no further through a wall
      if (k > FK0 * 0.75 && !quiz && Q.fab > 0) {
        const i0 = Math.floor((fx - R1) / CS), i1 = Math.floor((fx + R1) / CS), j0 = Math.floor((fz - R1) / CS), j1 = Math.floor((fz + R1) / CS), key = [i0, i1, j0, j1].join(',');
        if (fab.gl && key !== fab.key) { fab.key = key; const q = []; for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const d = Math.hypot((i + 0.5) * CS - fx, (j + 0.5) * CS - fz), kk = i * 65536 + j; if (d > R1 + CS * 0.7 || fab.chunks.has(kk) || !fabLand(i, j)) continue; q.push({ k: kk, ix: i, iz: j, d }); } q.sort((a, b) => a.d - b.d); fab.queue = q; }
        if (fab.queue.length && !fab.timer && !byFrame()) fab.timer = setTimeout(fabPump, 0);
        if (rb.gen) { const a0 = Math.floor((fx - R1) / RCS), a1 = Math.floor((fx + R1) / RCS), b0 = Math.floor((fz - R1) / RCS), b1 = Math.floor((fz + R1) / RCS), rk = [a0, a1, b0, b1].join(',');
          if (rk !== rb.key) { rb.key = rk; const q = []; for (let i = a0; i <= a1; i++) for (let j = b0; j <= b1; j++) { const d = Math.hypot((i + 0.5) * RCS - fx, (j + 0.5) * RCS - fz), kk = i * 65536 + j; if (d > R1 + RCS * 0.7 || rb.chunks.has(kk) || !rb.gen.has(i, j)) continue; q.push({ k: kk, ix: i, iz: j, d }); } q.sort((a, b) => a.d - b.d); rb.queue = q; }
          if (rb.queue.length && !rb.timer && !byFrame()) rb.timer = setTimeout(rbPump, 0); }
      }
      const f = U.uFocus.value;
      for (const ch of fab.chunks.values()) {
        if (ch.slot == null) continue;
        if (ch.g < 1 && tgt > 0) { ch.g = RM.matches ? 1 : Math.min(1, ch.g + dt / 450); placeData[(TW + ch.slot) * 4] = 1 - Math.pow(1 - ch.g, 3); placeTex.needsUpdate = true; anim = true; shadowDirty = true; }
        const vis = tgt > 0 && fabDist(ch, f) < R1 + CS;
        if (ch.b) { ch.b.visible = vis; ch.b.geometry.instanceCount = Math.ceil(ch.nb * Q.fab); ch.b.castShadow = Q.fabShadow; }
        if (ch.t) { ch.t.visible = vis; ch.t.geometry.instanceCount = Math.ceil(ch.nt * Q.fab); ch.t.castShadow = Q.fabShadow; }
      }
      for (const ch of rb.chunks.values()) { // the real buildings: the same rise; a lighter picture keeps the tallest half, then quarter, of each chunk
        if (!ch.m) continue;
        if (ch.g < 1 && tgt > 0) { ch.g = RM.matches ? 1 : Math.min(1, ch.g + dt / 450); placeData[(TW + ch.slot) * 4] = 1 - Math.pow(1 - ch.g, 3); placeTex.needsUpdate = true; anim = true; shadowDirty = true; }
        ch.m.visible = tgt > 0 && rbDist(ch, f) < R1 + RCS; ch.m.castShadow = Q.fabShadow; ch.m.geometry.setDrawRange(0, Q.fab >= 1 ? Infinity : Q.fab >= 0.5 ? ch.half : ch.quarter);
      }
      // the tall real buildings: from the city-wide view inwards (they rise between these distances), everywhere they are, each group grown in when it is new
      if (rb.tallGl) { const tt = quiz ? 0 : 1 - smooth(Math.log(c.d), Math.log(TALL_D[0]), Math.log(TALL_D[1]));
        if (tt !== rb.tallU.uGrow.value) { rb.tallU.uGrow.value = tt; shadowDirty = true; }
        if (tt > 0 && rb.gen && rb.tallNext < rb.gen.tallCount) { rb.tallGo = true; if (!rb.tallTimer && !byFrame()) rb.tallTimer = setTimeout(tallPump, 0); }
        for (const t of rb.tall) { if (t.g < 1 && tt > 0) { t.g = RM.matches ? 1 : Math.min(1, t.g + dt / 450); placeData[(TW + t.slot) * 4] = 1 - Math.pow(1 - t.g, 3); placeTex.needsUpdate = true; anim = true; shadowDirty = true; }
          t.m.visible = tt > 0.02; t.m.castShadow = Q.fabShadow; } }
      return anim;
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
      // sand along the open ocean: the shore west of a line drawn just inland of the Pacific coast, from Bodega Bay to Pescadero
      { if (!wcv.sand) { const line = [[38.5, -123.02], [38.0, -122.8], [37.9, -122.62], [37.835, -122.5], [37.78, -122.503], [37.7, -122.495], [37.6, -122.488], [37.5, -122.455], [37.2, -122.375]].map(q => { const p = proj([q[1], q[0]]); return [p[1], p[0]]; });
          const west = (x, y) => { for (let i = 1; i < line.length; i++) if (y >= line[i - 1][0] && y <= line[i][0]) return x < lerp(line[i - 1][1], line[i][1], (y - line[i - 1][0]) / (line[i][0] - line[i - 1][0])); return false; };
          wcv.sand = new Path2D(); for (const l of wcv.shore) { let on = false; for (const p of l) { if (west(p[0], p[1])) { if (on) wcv.sand.lineTo(p[0], p[1]); else wcv.sand.moveTo(p[0], p[1]); on = true; } else on = false; } } }
        c.strokeStyle = L.sand; c.globalAlpha = 0.5; c.lineWidth = 3.4; c.stroke(wcv.sand); c.globalAlpha = 0.9; c.lineWidth = 1.9; c.stroke(wcv.sand); }
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
      placeData[i * 4] = top[0]; placeData[i * 4 + 1] = top[1]; placeData[i * 4 + 2] = top[2]; placeTex.needsUpdate = true;
      const K = tileS.kind, S = tileS.shade, A = tileCol.array;
      for (let v = t.v0; v < t.v1; v++) { const k = K[v], c = k === 0 ? top : k === 1 ? bev : wall, s = S[v]; A[v * 3] = c[0] * s; A[v * 3 + 1] = c[1] * s; A[v * 3 + 2] = c[2] * s; }
      if (t.fine && fineMesh) { const f = t.fine, K2 = fineS.kind, S2 = fineS.shade, A2 = fineCol.array; for (let v = f.v0; v < f.v1; v++) { const k = K2[v], c = k === 0 ? top : k === 1 ? bev : wall, s2 = S2[v]; A2[v * 3] = c[0] * s2; A2[v * 3 + 1] = c[1] * s2; A2[v * 3 + 2] = c[2] * s2; } fineCol.needsUpdate = true; }
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
      const L = LK; renderer.setClearColor(L.haze, 1); scene.fog.color.set(L.haze); paintAll = true;
      if (sky) { sky.U.uHorizon.value.set(L.haze); sky.U.uZenith.value.set(L.zenith); sky.U.uGlow.value.set(L.skyGlow).multiplyScalar(L.glowK); sky.U.uFlat.value = L.lights ? 1 : 0; }
      if (waterU) { waterU.uSunC.value.set(L.key.c); waterU.uGlint.value = L.glint; }
      fabU.uPale.value.set(L.pale); fabU.uRoofK.value = L.roofK; fabU.uWallK.value = L.wallK; fabU.uTree.value.set(L.tree); fabU.uTreeK.value = L.treeK; fabU.uWin.value.set(L.win);
      applyAir();
      { const a = landMesh.geometry.attributes.color, c = L.land; for (let v = 0; v < landS.n; v++) { a.array[v * 3] = c[0] * landS.shade[v]; a.array[v * 3 + 1] = c[1] * landS.shade[v]; a.array[v * 3 + 2] = c[2] * landS.shade[v]; } a.needsUpdate = true; }
      farMat.color.set(L.landHex); inlandMat.color.set(L.water); rim.material.color.set(P.paper);
      const wk = [L.water, L.deep, L.shallow, L.rim, L.shore, L.sand, Math.round(L.key.az / 6), Math.round(L.key.el / 5)].join('|'); if (wk !== waterKey) { waterKey = wk; paintWater(); }
      tileMat.roughness = L.tileRough; builtMat.roughness = L.builtRough; waterMat.roughness = L.waterRough; waterMat.metalness = L.waterMetal; builtMat.emissiveIntensity = L.glow; paneU.uPaneK.value = L.pane; paneU.uAmb.value = L.amb;
      hemi.color.set(L.hemi.sky); hemi.groundColor.set(L.hemi.ground); hemi.intensity = L.hemi.i; key.color.set(L.key.c); key.intensity = L.key.i; key.shadow.radius = L.shadowR;
      paintBuilt(); for (const m of secMeshes.values()) m.dirty = true; selKey = ''; for (const [i, e] of edgeMeshes) { drop(e.mesh); edgeMeshes.delete(i); }
      if (L.lights) buildNight(); lightSets.forEach(p => { p.visible = L.lights; }); if (beam) beam.visible = L.lights;
      shadowDirty = true; needs = true;
    }

    // ---- lifting the selected place ----
    const rimY = (t, h) => { const a = rimPos.array; for (let k = t.r0; k < t.r1; k++) a[k * 3 + 1] = rimBase[k] + h; rimPos.needsUpdate = true; // 4 vertices to a segment of 4 numbers: the same count
      if (t.fine && rimF) { const f = t.fine, q = rimF.geometry.attributes.position; for (let k = f.r0; k < f.r1; k++) q.array[k * 3 + 1] = rimFBase[k] + h; q.needsUpdate = true; } };
    function liftLights(i) { const t = tiles[i]; if (!scatter || t.l0 == null) return; const a = scatter.geometry.attributes.position; for (let k = t.l0; k < t.l1; k++) a.array[k * 3 + 1] = scatterY[k] + liftV[i]; a.needsUpdate = true; }
    function setLift(i, h) {
      liftV[i] = h; placeData[i * 4 + 3] = h; placeTex.needsUpdate = true; const t = tiles[i], K = tileS.kind, A = tilePos.array;
      for (let v = t.v0; v < t.v1; v++) if (K[v] !== 3 && K[v] !== 4) A[v * 3 + 1] = baseY[v] + h;
      if (t.fine && fineMesh) { const f = t.fine, K2 = fineS.kind, A2 = finePos.array; for (let v = f.v0; v < f.v1; v++) if (K2[v] !== 3 && K2[v] !== 4) A2[v * 3 + 1] = fineBaseY[v] + h; finePos.needsUpdate = true; }
      tilePos.needsUpdate = true; rimY(t, h); liftLights(i); shadowDirty = true;
    }
    function stepLifts(t) { // the selected place rises with a small overshoot; the one it replaces settles back
      for (let i = 0; i < HOODS.length; i++) { const to = i === sel ? LIFT : 0, a = liftAnim.get(i); if (Math.abs((a ? a.to : liftV[i]) - to) > 1e-4) liftAnim.set(i, { from: liftV[i], to, t0: t }); } // (liftV keeps single floats: LIFT comes back from it a hair off)
      let anim = false;
      for (const [i, a] of liftAnim) { const p = RM.matches ? 1 : clamp((t - a.t0) / (a.to ? 520 : 260), 0, 1); if (p >= 1) { setLift(i, a.to); liftAnim.delete(i); } else { setLift(i, a.to ? a.from + (a.to - a.from) * backOut(p) : a.from * Math.pow(1 - p, 3)); anim = true; } }
      return anim;
    }

    // ---- sections: lines on the flat top of a place, the selected one outlined ----
    // A line is a ribbon lying on the top, as wide on screen as a stroke: each vertex is moved sideways in the shader by a width in
    // pixels times the ground a pixel covers at the centre.
    const lineW = { value: 1 }, lineUp = { value: 0 }, secMeshes = new Map(), edgeMeshes = new Map(); let selKey = '', selMeshes = [];
    function lineMat(hex, opacity) {
      const m = new THREE.MeshBasicMaterial({ color: hex, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide });
      m.onBeforeCompile = s => { s.uniforms.uW = lineW; s.uniforms.uUp = lineUp; s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aOff;\nuniform float uW;\nuniform float uUp;').replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed += aOff * uW;')
        .replace('#include <project_vertex>', '#include <project_vertex>\n{ vec4 up = projectionMatrix * modelViewMatrix * vec4(transformed + vec3(0.0, uUp, 0.0), 1.0); gl_Position.z = up.z / up.w * gl_Position.w; }'); }; // drawn where it lies, but as deep as a point uUp above it: the low houses do not cut a line, a tower does
      return m;
    }
    function ribbon(segs, y, px, hs) { // segs: [ax, ay, bx, by, ...] in map units; px: the stroke's width; hs: the ground at each end of each segment (y is then above it)
      const n = segs.length / 4, Pp = new Float32Array(n * 12), Of = new Float32Array(n * 12), I = new Uint32Array(n * 6);
      for (let s = 0; s < n; s++) {
        const ax = segs[s * 4], ay = segs[s * 4 + 1], bx = segs[s * 4 + 2], by = segs[s * 4 + 3], l = Math.hypot(bx - ax, by - ay) || 1, dx = (bx - ax) / l * px / 2, dy = (by - ay) / l * px / 2;
        [[ax, ay, -dx + dy, -dy - dx], [ax, ay, -dx - dy, -dy + dx], [bx, by, dx + dy, dy - dx], [bx, by, dx - dy, dy + dx]].forEach((q, k) => { const p = (s * 4 + k) * 3; Pp[p] = q[0]; Pp[p + 1] = hs ? y + hs[s * 2 + (k >> 1)] : y; Pp[p + 2] = q[1]; Of[p] = q[2]; Of[p + 2] = q[3]; });
        I.set([s * 4, s * 4 + 1, s * 4 + 2, s * 4 + 1, s * 4 + 3, s * 4 + 2], s * 6);
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(Pp, 3)); g.setAttribute('aOff', new THREE.BufferAttribute(Of, 3)); g.setIndex(new THREE.BufferAttribute(I, 1)); g.computeBoundingSphere(); return g;
    }
    const ringSegs = rings => { const s = []; for (const r of rings) for (let a = 0, b = r.length - 1; a < r.length; b = a++) s.push(r[b][0], r[b][1], r[a][0], r[a][1]); return s; };
    const drop = m => { secG.remove(m); m.geometry.dispose(); m.material.dispose(); };
    // a ribbon on place i's ground, y above it: laid over the relief where the place has one, else on its flat top
    const ribbonOn = (i, segs, y, px) => { if (RL && RL.has(i)) { const d = RL.drape(i, segs); return ribbon(d.segs, y, px, d.hs); } return ribbon(segs, HT[i] + y, px); };
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
        if (!m || m.dirty) { if (m) { drop(m.lines); if (m.gold) drop(m.gold); } const s = sectionLines(i); m = { lines: new THREE.Mesh(ribbonOn(i, s.segs, 0.012, 1.4), lineMat(P.subLine, 1)), gold: s.gold.length ? new THREE.Mesh(ribbonOn(i, s.gold, 0.014, 2.4), lineMat(P.star, 1)) : null }; m.lines.renderOrder = 2; secG.add(m.lines); if (m.gold) { m.gold.renderOrder = 3; secG.add(m.gold); } secMeshes.set(i, m); }
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
          add(ribbonOn(sel, ringSegs(tc[selSub]), 0.016, ph ? 2.8 : 1.8), lineMat(P.accent, 1), 4);
          if (ph && !sp.star) { const Pp = [], I = []; for (const r of tc[selSub]) { const b = Pp.length / 3; if (RL && RL.has(sel)) { let f = null; try { f = RL.fill(sel, r); } catch (e) {} if (f) { for (let q = 0; q < f.pos.length; q += 3) Pp.push(f.pos[q], f.pos[q + 1] + 0.008, f.pos[q + 2]); for (const t of f.idx) I.push(b + t); } continue; }
              let f = []; try { f = land.tri2(r, []); } catch (e) {} for (const p of r) Pp.push(p[0], HT[sel] + 0.008, p[1]); for (const t of f) I.push(b + t[0], b + t[1], b + t[2]); }
            const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Pp), 3)); g.setAttribute('aOff', new THREE.BufferAttribute(new Float32Array(Pp.length), 3)); g.setIndex(I); g.computeBoundingSphere(); add(g, lineMat(P.accent, .16), 1); }
        }
        if (hv) add(ribbonOn(sel, ringSegs(tc[hoverSub]), 0.015, 1.2), lineMat(P.ink, 1), 4);
      }
      for (const m of selMeshes) m.position.y = sel >= 0 ? liftV[sel] : 0;
      // a place's own outline, round the edge of its top: the accent on the selected one (thinner on the phone once a section is
      // picked, as in the flat map), the quiz's green or red, the ink under the pointer or a finger about to pick
      for (let i = 0; i < HOODS.length; i++) {
        const f = flagNow[i], o2 = edgeMeshes.get(i), want = !f ? '' : f & 1 ? P.accent + '|' + (sp && ph ? 1.4 : 2.2) : f & 8 ? P.okInk + '|2.6' : f & 16 ? P.noInk + '|2.6' : f & 4 ? P.ink + '|2.6' : P.ink + '|1.4';
        if (o2 && o2.key !== want) { drop(o2.mesh); edgeMeshes.delete(i); }
        if (want && !edgeMeshes.has(i)) { const [hex, px] = want.split('|'), sg = [], hs = []; rimSegs(fineOn && tiles[i].fine ? tiles[i].fine.rim : tiles[i].rim, sg, hs); const m = new THREE.Mesh(ribbon(sg, 0.018, +px, hs), lineMat(hex, 1)); m.renderOrder = 5; secG.add(m); edgeMeshes.set(i, { mesh: m, key: want }); } // (the rim of the mesh that is drawn)
        if (want) edgeMeshes.get(i).mesh.position.y = liftV[i];
      }
    }
    // how strongly a place's sections show, as in the flat map: from 300 px across, or as soon as it is selected and big enough
    function subFactor(i) { if (quiz) return 0; const px = hoodPx(i); let f = smooth(px, 300, 560); if (i === sel) f = Math.max(f, px > (isPhone() ? 110 : 150) ? 1 : 0); return f > 0 && subsOf(i) ? f : 0; }

    // ---- one frame of the scene ----
    const lightDir = new THREE.Vector3(), lightCam = new THREE.OrthographicCamera(), m4 = new THREE.Matrix4(), qt = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3(), v3 = new THREE.Vector3(), yAxis = new THREE.Vector3(0, 1, 0), xAxis = new THREE.Vector3(1, 0, 0), q2 = new THREE.Quaternion();
    let C = null, viewBB = [0, 0, 0, 0], subF = [];
    function updateScene(t, vx, dt) {
      const c = C, L = LK;
      camera.position.set(c.px, c.py, c.pz); camera.up.set(0, 1, 0); camera.lookAt(cur.cx, FOCUS_Y, cur.cz);
      camera.near = Math.max(0.5, c.d * 0.05); camera.far = c.d * 14 + 600; camera.aspect = W / H; camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
      { const low = smooth(c.ph, 1.05, 1.45); scene.fog.near = c.d * lerp(L.fog[0], 0.75, low); scene.fog.far = c.d * lerp(L.fog[1], 3.4, low); } // a low view looks a long way: the haze comes nearer, and the far land fades into it
      // the air: the sky behind a tilted view, the water's ripples (gentler from far off), the wash, the fog, what moves
      if (sky) sky.set(c, W, H);
      if (waterU) { waterU.uT.value = ambT; waterU.uD.value = c.d; waterU.uWave.value = L.wave * lerp(1, 0.4, smooth(Math.log(c.d), Math.log(150), Math.log(900))); }
      if (wash) { wash.U.uT.value = ambT; wash.U.uK.value = L.washK * smooth(kNow(), 1.2, 5); wash.mesh.visible = wash.U.uK.value > 0.01; }
      if (fogBank) { const U = fogBank.U; U.uT.value = ambT; U.uK.value = quiz ? 0 : L.fogK * (fogLens ? 1.7 : 1) * lerp(0.5, 1, smooth(kNow(), 0.8, 3.5)); U.uHaze.value.set(c.d * 2.4, c.d * 7); fogBank.group.visible = U.uK.value > 0; }
      if (Math.abs(vx - vex) > 0.003) { vex = vx; landG.scale.y = vex; shadowDirty = true; }
      c.vex = vex;
      // the landmarks grow a little as the map zooms out, so the skyline reads from across the bay; each stands on its block
      const k = clamp(Math.pow(c.d / 150, 0.7), 1, 2.6); if (Math.abs(k - lmScale) > 0.004) { lmScale = k; shadowDirty = true; }
      fabU.uRise.value = lmScale / vex;                                 // the real buildings stand at the landmarks' scale, near or far (js/map3d/real.js V)
      const show = !quiz; // the quiz hides the landmarks and the skylines, as the flat map hides its glyphs: they are hints
      for (const ic of icons) { // a model a few pixels tall is not drawn at all (nor its shadow): with some seventy of them that is most of them, most of the time
        const y = ic.y + (ic.hood >= 0 ? liftV[ic.hood] : 0), zc = (ic.x - c.px) * c.fx + (y * vex - c.py) * c.fy + (ic.z - c.pz) * c.fz; ic.px = zc > 0 ? ic.h * lmScale * c.g / zc : 0;
        const vis = show && ic.px >= (ic.mesh.visible ? 4 : 5.5); if (ic.mesh.visible !== vis) { ic.mesh.visible = vis; shadowDirty = true; }
        ic.mesh.scale.set(lmScale, lmScale / vex, lmScale); ic.mesh.position.y = y; }
      for (const p of cityParts) { p.mesh.visible = show; const sy = (1 + (lmScale - 1) * 0.6) / vex; p.mesh.scale.y = sy; p.mesh.position.y = p.hood >= 0 ? (p.g0 != null ? p.g0 : HT[p.hood]) * (1 - sy) + liftV[p.hood] : 0; } // stretched from the ground it stands on (its block's top), not from the water
      // flags and bookmarks hold their size on screen, within limits, and face the reader; seen from above (the far zoom) they lean
      // back, so a pole is never seen end on
      const marks = quiz || !o.marks ? [] : o.marks(); let nf = 0, nb = 0, pop = false; qt.setFromAxisAngle(yAxis, cur.th).multiply(q2.setFromAxisAngle(xAxis, -Math.max(0, Math.PI / 2 - c.ph - 0.6)));
      for (let i = 0; i < HOODS.length; i++) {
        const m = marks[i]; if (!m) continue; const h = HOODS[i], y = anchY(i), zc = (h.cx - c.px) * c.fx + (y * vex - c.py) * c.fy + (h.cy - c.pz) * c.fz; if (zc <= 0) continue;
        let s = clamp((m === 'flag' ? 20 : 17) * zc / c.g, 0.5, MARK_MAX);
        if (markAnim[i]) { const p = (t - markAnim[i]) / 420; if (p < 1) { s *= 1 + Math.sin(p * Math.PI) * .6 * (1 - p); pop = true; } else delete markAnim[i]; }
        m4.compose(ps.set(h.cx, y, h.cy), qt, sc.set(s, s / vex, s)); const im = m === 'flag' ? flags : books, j = m === 'flag' ? nf++ : nb++, ia = im.instanceMatrix.array, me4 = m4.elements; // (sent to the GPU only when a matrix or the count changed)
        for (let k = 0; k < 16; k++) if (ia[j * 16 + k] !== Math.fround(me4[k])) { im.setMatrixAt(j, m4); im.instanceMatrix.needsUpdate = true; break; }
      }
      if (flags.count !== nf || books.count !== nb) { shadowDirty = true; flags.instanceMatrix.needsUpdate = books.instanceMatrix.needsUpdate = true; }
      flags.count = nf; books.count = nb;
      // sections
      if (fineMesh) { const kk = kNow(), want = fineOn ? kk > 2.2 : kk > 2.8; if (want !== fineOn) setFine(want); }   // the full relief from the scale of the city inwards (with some slack, so it does not flicker between the two)
      lineW.value = 1 / kNow(); updateSections(subF); rim.material.opacity = (dark ? .5 : .55) * smooth(kNow(), 1.5, 6); rim.visible = rim.material.opacity > .01; if (rimF) rimF.visible = rim.visible && fineOn;
      if (ferries.length) stepLife();
      const fabAnim = fabStep(dt || 16, c);
      // the key light's shadow box is fitted to what the camera sees (the ground under the screen, out to a few view distances, and
      // the height of the tallest things), in the light's own fixed frame; its size moves in steps and its edges snap to whole shadow
      // texels, so a pan moves the shadows by whole texels (nothing crawls) and a zoom changes them only at a step
      { const az = L.key.az * Math.PI / 180, el = L.key.el * Math.PI / 180, A = area.r;
        lightDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)); if (waterU) waterU.uSun.value.copy(lightDir); if (sky) sky.U.uSun.value.copy(lightDir);
        if (!lightBasis || lightBasis.az !== az || lightBasis.el !== el || lightBasis.A !== A) {
          const ax = (A[0] + A[2]) / 2, az2 = (A[1] + A[3]) / 2;
          key.target.position.set(ax, 0, az2); key.position.set(ax + lightDir.x * 4000, lightDir.y * 4000, az2 + lightDir.z * 4000); key.target.updateMatrixWorld(); key.updateMatrixWorld();
          lightCam.position.copy(key.position); lightCam.up.set(0, 1, 0); lightCam.lookAt(key.target.position); lightCam.updateMatrixWorld(); lightBasis = { az, el, A, inv: lightCam.matrixWorldInverse.clone() }; shadowDirty = true;
        }
        const reach = c.d * 2.4, hTop = Math.max(7, HMAX) * vex, pts = [];
        for (const [sx, sy] of [[0, 0], [W / 2, 0], [W, 0], [0, H / 2], [W, H / 2], [0, H], [W / 2, H], [W, H]]) {
          let g = planeAt(c, sx, sy, FOCUS_Y); const dx = g[0] - cur.cx, dz = g[1] - cur.cz, l = Math.hypot(dx, dz); if (l > reach) g = [cur.cx + dx / l * reach, cur.cz + dz / l * reach];
          pts.push(g);
        }
        let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        for (const g of pts) for (const y of [0, hTop]) { v3.set(g[0], y, g[1]).applyMatrix4(lightBasis.inv); x0 = Math.min(x0, v3.x); x1 = Math.max(x1, v3.x); y0 = Math.min(y0, v3.y); y1 = Math.max(y1, v3.y); z0 = Math.min(z0, v3.z); z1 = Math.max(z1, v3.z); }
        const Wb = Math.pow(1.12, Math.ceil(Math.log(Math.max(x1 - x0, y1 - y0, 4) + 2) / Math.log(1.12))), tx = Wb / key.shadow.mapSize.x;
        const L0 = Math.floor((x0 + x1 - Wb) / 2 / tx) * tx, B0 = Math.floor((y0 + y1 - Wb) / 2 / tx) * tx, N0 = Math.max(1, Math.floor((-z1 - 40) / 50) * 50), F0 = Math.ceil((-z0 + 40) / 50) * 50;
        const box = (l, b, w, n, f, t, loose) => { sh = { l, b, w, n, f, loose }; const sc2 = key.shadow.camera;
          sc2.left = l; sc2.right = l + w; sc2.bottom = b; sc2.top = b + w; sc2.near = n; sc2.far = f; sc2.updateProjectionMatrix();
          key.shadow.normalBias = t * 2.2; key.shadow.bias = -0.0006; renderer.shadowMap.needsUpdate = true; shadowDirty = false; shT = now(); stat.shadowDraws++; };
        // while the map moves the box is kept, and the shadows not drawn again, as long as what is needed lies inside it and it is not much too
        // big; else a box 1.3 times as wide (quantised and snapped as above, a step of 50 more each side in depth). What stands in it changing
        // draws them again at most every 100 ms; the first frame at rest fits tightly again (m3d-shadowhold=off, tune shadowHold false: every frame as at rest)
        if (moving && SW.hold && T.shadowHold !== false) {
          if (!(sh.w && x0 >= sh.l && x1 <= sh.l + sh.w && y0 >= sh.b && y1 <= sh.b + sh.w && N0 >= sh.n && F0 <= sh.f && sh.w <= Wb * 1.6)) { const w2 = Math.pow(1.12, Math.ceil(Math.log(Wb * 1.3) / Math.log(1.12))), t2 = w2 / key.shadow.mapSize.x; box(Math.floor((x0 + x1 - w2) / 2 / t2) * t2, Math.floor((y0 + y1 - w2) / 2 / t2) * t2, w2, Math.max(1, N0 - 50), F0 + 50, t2, true); }
          else if (shadowDirty && now() - shT >= 100) { renderer.shadowMap.needsUpdate = true; shadowDirty = false; shT = now(); stat.shadowDraws++; }
        } else if (L0 !== sh.l || B0 !== sh.b || Wb !== sh.w || N0 !== sh.n || F0 !== sh.f || shadowDirty) box(L0, B0, Wb, N0, F0, tx, false);
      }
      lightMat.uniforms.uScale.value = H * pr / (2 * Math.tan(FOV * Math.PI / 360)); lightMat.uniforms.uMin.value = 1.4 * pr;
      return pop || fabAnim;
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
    // Names behind a hill: is the anchor of a name (x, z on the map, y the height it stands at) hidden from the eye by real ground
    // between them? The line from the camera to a point OCC_UP above it is walked over the ground of each place it passes over
    // below that place's highest point (relief.js ray; the plateaus of the flat land never hid a name, nor do they now). An answer is
    // kept while the camera and the anchor stay where they are; at most OCC_MS a frame goes on new answers, the rest keep their last
    // one until their turn (a name that goes behind a hill fades out as any name does)
    const OCC_UP = 0.1, OCC_MS = 0.3, occ = new Map(); let occCam = '', occSpent = 0;
    function behind(id, x, z, y) {
      const c = C, key = occCam + '|' + y, e = occ.get(id); if (e && e.k === key) return e.v;
      if (occSpent >= OCC_MS) return e ? e.v : false;
      const t0 = now(), ex = x - c.px, ey = y * c.vex + OCC_UP - c.py, ez = z - c.pz, bx0 = Math.min(c.px, x), bx1 = Math.max(c.px, x), bz0 = Math.min(c.pz, z), bz1 = Math.max(c.pz, z); let v = false;
      for (let j = 0; j < HOODS.length && !v; j++) {
        const b = BB[j]; if (b[2] < bx0 || b[0] > bx1 || b[3] < bz0 || b[1] > bz1 || !RL.has(j)) continue;
        let ta = 0, tb = 1 - 1e-4; const top = HT[j] * c.vex; if (ey < 0) ta = Math.max(ta, (top - c.py) / ey); else if (c.py > top) continue;   // where the line is below the place's highest point
        for (const [o, d, lo, hi] of [[c.px, ex, b[0], b[2]], [c.pz, ez, b[1], b[3]]]) { if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) ta = 2; continue; } const u = (lo - o) / d, w = (hi - o) / d; ta = Math.max(ta, Math.min(u, w)); tb = Math.min(tb, Math.max(u, w)); } // and over its box
        if (ta < tb && RL.ray(j, c.px, c.py, c.pz, ex, ey, ez, ta, tb, 0, c.vex) >= 0) v = true;
      }
      occSpent += now() - t0; if (occ.size > 4000) occ.clear(); occ.set(id, { k: key, v }); return v;
    }
    function drawOverlay(t, dt) {
      const c = C, k = kNow(), phone = isPhone(), fsz = phone ? 10.5 : 11.5, I = insets(); let anim = false;
      occCam = c.px + ',' + c.py + ',' + c.pz + ',' + c.vex; occSpent = 0;
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
        const h = hi != null ? gAt(hi, l.x, l.y) : 0, p = at(l.x, l.y, h), on = p[2] > 0 && p[0] > -60 && p[0] < W + 60 && p[1] > -60 && p[1] < H + 60;
        const tg = on && !far && ready ? lmF : 0; if (Math.abs(tg - lmA[j]) < .01) lmA[j] = tg; else { lmA[j] += (tg - lmA[j]) * (1 - Math.exp(-dt / 180)); anim = true; }
        if (!(lmA[j] > .01) || !on) return;
        const box = [p[0] - lmH * (l.w || 1) / 2, p[1] - lmH, p[0] + lmH * (l.w || 1) / 2, p[1]]; glyphs.push([l, j, p]);
        if (lmA[j] > .3) placed.push([box[0] - 2, box[1] - 2, box[2] + 2, box[3] + 2]); if (lmA[j] > .5) lmBox[j] = box;
      });
      // flags and bookmarks stand at the anchors: names keep clear of them
      const anchor = HOODS.map((h, i) => { const b = BB[i]; return b[2] > viewBB[0] && b[0] < viewBB[2] && b[3] > viewBB[1] && b[1] < viewBB[3] ? at(h.cx, h.cy, anchY(i)) : null; });
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
          if (!hot && anchor[i][2] > c.d * 3.2) continue;                       // far off in a low view: in the haze, unnamed
          if (!hot && RL && behind('h' + i, h.cx, h.cy, anchY(i))) continue;    // behind a hill
          if (farOn && region !== 'all' && h.region !== region && !hot) continue;
          const side = DETAIL[i] > 1; if (!side && subF[i] > .6) continue;       // its sections are named instead
          const name = SHORT[h.name] || h.name, text = farNames ? name.toUpperCase() : name, size = hot ? lsz * 1.1 : lsz, st = STAR[i] ? size * 1.15 : 0;
          const tw = measure(text, 600, size) + text.length * size * ls + st, th = size * 1.2, p = anchor[i], kl = c.g / p[2], px = SIZE[i] * kl * Math.max(.6, cosT), id = 'h' + i + (farNames ? 'F' : ''), on = lblA.get(id) > .5;
          if (!hot && !side && px < ((marks[i] || STAR[i]) ? 22 : Math.max(farNames ? 40 : 30, tw * (on ? .7 : .82)))) continue;
          const cx = side ? at(SIDE_X[i], h.cy, anchY(i))[0] + 12 + tw / 2 : p[0], cy = p[1] + (marks[i] && !side ? size * 1.25 : 0), gx = phone ? 4 : 2, gy = phone ? 1 : 0;
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
        const hi = hoodOf(sp.x, sp.y), p = at(sp.x, sp.y, hi >= 0 ? gAt(hi, sp.x, sp.y) : 0); if (p[2] <= 0 || p[0] < -20 || p[0] > W + 20 || p[1] < -20 || p[1] > H + 20) { sp._s = null; continue; }
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
          const tw = measure(cell.name, wt, ss) + sw, th = ss * 1.2, gy = gAt(i, cell.c[0], cell.c[1]), p = at(cell.c[0], cell.c[1], gy); if (p[2] <= 0 || (!hot && p[2] > c.d * 1.9) || p[0] < -40 || p[0] > W + 40 || p[1] < -20 || p[1] > H + 20) continue;
          if (!hot && RL && behind('c' + i + ':' + j, cell.c[0], cell.c[1], gy)) continue;
          const kl = c.g / p[2], box = [p[0] - tw / 2 - 2, p[1] - th / 2, p[0] + tw / 2 + 2, p[1] + th / 2];
          const fits = (cell.bbox[2] - cell.bbox[0]) * kl >= tw * .8 && (cell.bbox[3] - cell.bbox[1]) * kl * cosT >= th * 1.1;
          if (!(cell.star || fits || hot) || clash(box) || !(hot || inView(box))) continue;
          placed.push(box); put('c' + i + ':' + j, { text: cell.name, x: (box[0] + box[2]) / 2 + sw / 2, y: p[1], size: ss, ls: 0, weight: wt, color: hot && !cell.star ? P.accent : P.label, a: hot ? 1 : smooth(subF[i], .2, .8), star: sw ? [box[0] + 2 + ss * .525, ss * 1.05] : null });
        }
      }
      // the landmarks' own names, close in, under each model, only where no place or section name stands, and once: not when a name
      // placed this frame is the same, or within ten map units (at least 160 px) shares a word of four letters or more with it ("Welcome Sign" and the Welcome
      // to Fabulous Las Vegas sign). The names placed are read once a landmark is big enough to be named
      let said = null; const near = Math.max(160, 10 * kNow()), words = t => (String(t || '').toLowerCase().match(/[a-z]{4,}/g) || []).filter(w => !LM_STOP.has(w));
      if (!quiz && ready) for (const ic of icons) {
        if (!ic.label || !(ic.px >= 40) || !ic.mesh.visible) continue; const a = at(ic.x, ic.z, ic.mesh.position.y); if (a[2] <= 0 || a[2] > c.d * 2.3) continue;
        if (!said) said = [...want.values()].filter(r => r.text).map(r => ({ x: r.x, y: r.y, t: r.text.toLowerCase(), w: new Set(words(r.text)) }));
        const lt = ic.label.toLowerCase(); if (said.some(r => r.t === lt) || words(ic.label).some(w => said.some(r => r.w.has(w) && Math.hypot(r.x - a[0], r.y - a[1]) <= near))) continue;
        const size = fsz - 0.5, tw = measure(ic.label, 500, size), bx = [a[0] - tw / 2 - 3, a[1] + 3, a[0] + tw / 2 + 3, a[1] + 4 + size * 1.25];
        if (bx[2] < 0 || bx[0] > W || bx[3] < 0 || bx[1] > H || !inView(bx) || clash(bx)) continue;
        placed.push(bx); put('L' + ic.id, { text: ic.label, x: a[0], y: (bx[1] + bx[3]) / 2, size, ls: 0, weight: 500, color: P.ink2 });
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
        else { ctx.fillStyle = P.paper; ctx.fill(); ctx.strokeStyle = hot ? P.ink : 'rgba(0,0,0,.25)'; ctx.lineWidth = hot ? 1.5 : 1; ctx.stroke(); ctx.beginPath(); ctx.arc(sx, sy, r * .55, 0, Math.PI * 2); const cc = spotColor(sp.c); if (sp.status === 'want') { ctx.strokeStyle = cc; ctx.lineWidth = 1.6; ctx.stroke(); } else { ctx.fillStyle = cc; ctx.fill(); } }
        if (k > 16 && sp.name) { const tw = measure(sp.name, 500, fsz), box = [sx + r + 3, sy - 7, sx + r + 3 + tw + 4, sy + 7]; if (!clash(box, 'dot') || hot) { placed.push(box); haloText(sp.name, sx + r + 5, sy, fsz, P.label); } }
      }
      if (quiz && ready) anim = quizBadges(I, t) || anim;
      if (me) { const hi = hoodOf(me[0], me[1]), q = at(me[0], me[1], hi >= 0 ? gAt(hi, me[0], me[1]) : 0); if (q[2] > 0) { const ph = ((t - meT0) % 1800) / 1800; ctx.globalAlpha = .4 * (1 - ph); ctx.fillStyle = P.want; ctx.beginPath(); ctx.arc(q[0], q[1], 6 + 12 * ph, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(q[0], q[1], 5, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = P.paper; ctx.lineWidth = 2; ctx.stroke(); } }
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
        const h = HOODS[m.i], colr = m.ok ? P.okInk : P.noInk, p = at(h.cx, h.cy, anchY(m.i)); if (p[2] <= 0) continue; let sx = p[0], sy = p[1];
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

    // ---- the governor: when frames run long while the map moves, something is given up, in this order: what moves (1), the
    // shadows of the fabric and of the real buildings (2), every shadow (3), half the fabric and the lower half of the real
    // buildings in each chunk (4), three quarters of both and a coarser picture (5), a coarser one still (6); when they run well
    // for a while, one step back, and not again to a step that failed twice ----
    const gov = { ts: [], good: 0, at: 0, skip: 0, fresh: false, fails: [], was: false, min: Infinity };
    function setQuality(n) {
      n = clamp(n, 0, 6); if (n === Q.level) return; qSet(n);
      key.castShadow = Q.shadows; setPR(prOf()); shadowDirty = true; needs = true; gov.ts.length = 0; gov.good = 0; gov.skip = 10; gov.at = now();
      if (SW.q < 0) try { sessionStorage.setItem('sbs-map3d-q', String(n)); } catch (e) {}
    }
    function qSet(n) { Q.level = n; Q.life = n < 1; Q.fabShadow = n < 2; Q.shadows = n < 3 && SW.shadows; Q.fab = n < 4 ? 1 : n < 5 ? 0.5 : 0.25; Q.cap = n < 5 ? [2, 3] : n < 6 ? [1.5, 2] : [1, 1.5]; Object.assign(Q, TQ); }
    // gap: the time since the frame before (draw's own clock, not reset by input), when both were frames of a moving map; judged by
    // the middle one of every 24, against the shortest gap seen: a screen held to 30 frames a second (Low Power Mode) is not a slow
    // device. A step up stays fresh until its first judgement: a slow one counts it as failed
    function govern(gap, mv) {
      const was = gov.was; gov.was = mv; if (!mv || !was || gap > 100 || SW.q >= 0) return; if (gap > 4) gov.min = Math.min(gov.min, gap); if (gov.skip > 0) { gov.skip--; return; } // over 100 ms: a finger at rest, not a frame
      const ref = Math.min(gov.min, 34) * 1.3, fail = () => { if (gov.fresh) gov.fails[Q.level] = (gov.fails[Q.level] || 0) + 1; gov.fresh = false; }; // (no screen runs slower than 30 a second: frames longer than that are slow)
      gov.ts.push(gap); if (gov.ts.length === 8 && Math.min.apply(null, gov.ts) > Math.max(40, ref)) { gov.ts.length = 0; gov.last = 41; fail(); return setQuality(Q.level + 2); } // eight very long frames in a row: two steps at once
      if (gov.ts.length < 24) return; const m = gov.ts.slice().sort((a, b) => a - b)[12]; gov.ts.length = 0; gov.last = +m.toFixed(1);
      if (m > 21 && m > ref) { fail(); setQuality(Q.level + 1); }
      else if (m < Math.max(18, ref * 0.85) && Q.level > 0) { gov.fresh = false; gov.good += 24; if (gov.good >= 240 && now() - gov.at > 8000 && (gov.fails[Q.level - 1] || 0) < 2) { setQuality(Q.level - 1); gov.fresh = true; } }
      else gov.good = 0;
    }

    // the next frame of ambient motion: a thirtieth of a second after the last frame drawn, whatever drew it
    function ambArm(ms) { ambTimer = setTimeout(() => { ambTimer = 0; if (!ambOn() || dead) return; const left = AMB_GAP - 5 - (now() - (stat.drawn || 0)); if (left > 3) return ambArm(left); ambTick = true; kick(); }, Math.max(0, ms)); }

    // ---- the frame loop: drawn on demand ----
    function kick() { if (!raf) { lastT = now(); raf = requestAnimationFrame(frame); } }
    function prOf() { const f = T.pr || SW.pr; return f ? Math.min(dpr, clamp(f, 1, 3)) : Math.min(dpr, Q.cap[moving ? 0 : 1]); } // the pixel ratio for the frame: the speed test's when it set one, else the governor's cap (lighter while the map moves)
    function setPR(p) { if (p === pr) return; pr = p; renderer.setPixelRatio(pr); renderer.setSize(W, H, false); lbl.width = Math.round(W * pr); lbl.height = Math.round(H * pr); needs = true; }
    // until a frame has drawn, an error in one is a 3D map that cannot run here: the flat map instead (giveUp); after that, as any error
    function frame(t, direct) { if (dead) { raf = 0; return; } if (stat.firstFrame) return draw(t, direct); try { draw(t, direct); } catch (e) { giveUp(e); } } // direct: drawn in this task (resize, warm-up), not at a screen refresh
    function draw(t, direct) {
      raf = 0; const gap = t - lastT, dt = Math.min(50, gap || 16), fgap = direct ? Infinity : t - govT; lastT = t; if (!direct) govT = t; let busy = false; // fgap: the time between two screen refreshes that drew, for the governor (kick resets lastT on every touch)
      if (g2 && g2.dirty && ptrs.size >= 2) twoFingers();
      if (mode === 'fly' && fly) { stepFly(t); busy = true; }
      else if (mode === 'smooth') { const a = 1 - Math.exp(-dt / 90); let d = 0; for (const p of ['cx', 'cz']) { const dd = goal[p] - cur[p]; d += Math.abs(dd) / cur.w; cur[p] += dd * a; } for (const p of ['th', 'off']) { const dd = goal[p] - cur[p]; d += Math.abs(dd); cur[p] += dd * a; } const lw = Math.log(goal.w / cur.w); d += Math.abs(lw); cur.w *= Math.exp(lw * a); if (d < 0.0005) { Object.assign(cur, goal); mode = 'still'; } else busy = true; }
      else if (mode === 'inertia') { const f = Math.exp(-dt / 320); cur.cx += vel.x * dt; cur.cz += vel.z * dt; limit(cur); Object.assign(goal, cur); userMoved = true; vel.x *= f; vel.z *= f; if (Math.hypot(vel.x, vel.z) * kNow() < 0.02) mode = 'still'; else busy = true; }
      if (colAnim) { const a = 1 - Math.exp(-dt / 140); let left = false; for (let i = 0; i < HOODS.length; i++) { const c = colNow[i], g = colTo[i]; for (let j = 0; j < 3; j++) { const d = g[j] - c[j]; if (Math.abs(d) > 1) { c[j] += d * a; left = true; } else c[j] = g[j]; } } colAnim = left; busy = busy || left; paintAll = true; }
      if (busy) needs = true; sync();
      const turned = Math.abs(cur.th) > 0.02 || Math.abs(cur.off) > 0.02; if (north.hidden === turned) { north.hidden = !turned; } if (turned) north.firstChild.style.transform = `rotate(${-cur.th * 180 / Math.PI}deg)`;
      if (!ready) { if (busy) raf = requestAnimationFrame(frame); if (busy && o.onMove) o.onMove(); return; }
      const t0 = now(); C = camOf(cur); const vx = C.vex; C.vex = vex; // names and hits use the stretch the scene was last drawn with
      // ambient motion has its own seconds, which stand still when it stops; the light theme's sun is looked up again every few minutes
      const amb = ambOn(), tick = ambTick; ambTick = false; if (amb) { if (ambLast) ambT += Math.min(0.1, (t - ambLast) / 1000); ambLast = t; } else ambLast = 0;
      if (!dark && !busy && !ptrs.size && t - sunAt > 240000) { sunAt = t; const k0 = sunKey; refreshPalette(); if (sunKey !== k0) applyLook(); }
      let anim = prepare(dt), why = (busy ? 1 : 0) | (anim ? 2 : 0) | (needs ? 4 : 0); if (stepLifts(t)) { anim = true; needs = true; why |= 8; }
      const mv = busy || ptrs.size > 0; govern(fgap, mv); if (mv !== moving) { moving = mv; setPR(prOf()); if (!mv && (sh.loose || shadowDirty || (SW.hold && T.shadowHold !== false))) needs = true; if (!mv && !SW.pumpOld) pumpsGo(); } // a lighter frame while the map moves, the full one when it rests
      const only = tick && amb && !needs && !busy && !anim && !olAnim;      // a frame of ambient motion alone: the scene is drawn, the names stand as they are
      if (needs || (tick && amb)) { needs = false; if (updateScene(t, vx, dt)) { anim = true; needs = true; why |= 16; } renderer.render(scene, camera); stat.frames++; stat.drawn = now(); if (only) stat.amb++; if (!stat.firstFrame) stat.firstFrame = now(); if (onDraw) onDraw(t, mv || !!anim, only); }
      if (!only) { olAnim = drawOverlay(t, dt); anim = olAnim || anim; } if (byFrame()) pumpTurn(); stat.lastMs = now() - t0; stat.why = why | (olAnim ? 32 : 0) | (me ? 64 : 0) | (tick ? 128 : 0);
      if (busy || anim || needs || (byFrame() && pumpWork())) raf = requestAnimationFrame(frame); // (a finger at rest on the map: the pumps' turns go on while there is work)
      else { if (me && !meTimer) meTimer = setTimeout(() => { meTimer = 0; if (!dead) kick(); }, 33); if (amb && !ambTimer) ambArm(AMB_GAP - 5); } // the location dot's pulse alone: a frame every 33 ms at most, and the ambient motion goes on
      if (busy && o.onMove) o.onMove();
    }

    // ---- hit testing: the same hits, in the same order, as the flat map ----
    function hitTest(sx, sy, touch) {
      const spots = drawnSpots;
      if (touch) { let best = null, bd = 20; for (let q = spots.length - 1; q >= 0; q--) { const sp = spots[q]; if (!sp._s || sp.status === 'pending') continue; const d = Math.hypot(sp._s[0] - sx, sp._s[1] - sy); if (d < bd) { best = sp; bd = d; } } if (best) return { type: 'spot', id: best.id, hood: best.hood }; }
      else for (let q = spots.length - 1; q >= 0; q--) { const sp = spots[q]; if (sp._s && Math.hypot(sp._s[0] - sx, sp._s[1] - sy) < 11 && sp.status !== 'pending') return { type: 'spot', id: sp.id, hood: sp.hood }; }
      for (let j = LANDS.length - 1; j >= 0; j--) { const b = lmBox[j]; if (b && sx >= b[0] - 3 && sx <= b[2] + 3 && sy >= b[1] - 3 && sy <= b[3] + 3) return { type: 'landmark', landmark: LANDS[j], hood: LANDS[j].hood }; }
      const c = camNow(), p = pick(c, sx, sy), fogFar = c.d * lerp(LK.fog[1], 3.4, smooth(c.ph, 1.05, 1.45)); // as updateScene sets the haze
      if (p.i >= 0 && Math.hypot(p.x - c.px, p.y - c.pz) <= fogFar) { const px = hoodPx(p.i), sub = (px > 300 || p.i === sel) ? base.subIndexAt(p.i, p.x, p.y) : -1; return { type: 'hood', i: p.i, hood: HOODS[p.i].name, sub, x: p.x, y: p.y }; }
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
      poke(); kick(); o.onGestureStart && o.onGestureStart();
    }, { signal: sig });
    stage.addEventListener('pointermove', e => {
      const r = stage.getBoundingClientRect();
      if (ptrs.has(e.pointerId)) {
        const p = ptrs.get(e.pointerId), px = p.x, py = p.y; p.x = e.clientX; p.y = e.clientY; poke();
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
      if (e.pointerType !== 'touch') poke();
      if (e.pointerType !== 'touch' && o.onHover) { const h = hitTest(e.clientX - r.left, e.clientY - r.top); o.onHover(h, e.clientX - r.left, e.clientY - r.top); }
    }, { signal: sig });
    const release = e => {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.delete(e.pointerId); poke();
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
    stage.addEventListener('pointerup', release, { signal: sig }); stage.addEventListener('pointercancel', release, { signal: sig });
    stage.addEventListener('pointerleave', () => { if (!ptrs.size && o.onHover) o.onHover(null); }, { signal: sig });
    stage.addEventListener('contextmenu', e => e.preventDefault(), { signal: sig });
    stage.addEventListener('wheel', e => {
      e.preventDefault(); poke(); const r = stage.getBoundingClientRect();
      let d = e.deltaY; if (e.deltaMode === 1) d *= 16; else if (e.deltaMode === 2) d *= 120; d = clamp(d, -160, 160);
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(d * (e.ctrlKey ? 0.01 : 0.0028)));
    }, { passive: false, signal: sig });
    north.addEventListener('click', () => { poke(); const to = Object.assign({}, goal, { th: 0, off: 0 }); let th = cur.th % (Math.PI * 2); if (th > Math.PI) th -= Math.PI * 2; if (th < -Math.PI) th += Math.PI * 2; cur.th = th; startFly(viewOf(to), 600); });
    // out of sight: the ambient motion stops at once; back in sight within its time, it picks up where it stood
    document.addEventListener('visibilitychange', () => { if (document.hidden) { clearTimeout(ambTimer); ambTimer = 0; } else if (ambOn()) { ambTick = true; kick(); } }, { signal: sig });
    glc.addEventListener('webglcontextlost', e => e.preventDefault());
    glc.addEventListener('webglcontextrestored', () => { shadowDirty = true; shT = -1e9; needs = true; kick(); });

    // ---- resize ----
    function resize() {
      const r = stage.getBoundingClientRect(), w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height)), d = Math.min(window.devicePixelRatio || 1, 3);
      if (w === W && h === H && d === dpr) return;
      const first = W <= 1, W0 = W, H0 = H; W = w; H = h; dpr = d; pr = prOf(); camV++;
      renderer.setPixelRatio(pr); renderer.setSize(W, H, false); lbl.width = Math.round(W * pr); lbl.height = Math.round(H * pr);
      // the tilt is nearly straight down from the distance of the first screen (the bay core, as the flat map lands on it)
      const all = base.regionBBox('all'); dFar = Math.max(400, dOf(Math.max(all[2] - all[0], (all[3] - all[1]) * W / H) * 1.06));
      if (!first) { const refit = s => { s.w = s.w * W / W0; return limit(s); }; refit(cur); refit(goal); if (fly) { refit(fly.from); refit(fly.to); } } // keep scale and centre through the new box
      sync(); needs = true;
      // the new size has just cleared both canvases: draw them again in this task, not at the next animation frame, so a resize never
      // shows a black stage (before the scene is ready: its water)
      if (ready) { if (raf) { cancelAnimationFrame(raf); raf = 0; } lastT = now(); frame(lastT, true); } else { renderer.clear(); kick(); }
    }
    (ro = new ResizeObserver(resize)).observe(stage);
    (function watchDpr() { try { const mq = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`); mq.addEventListener('change', () => { resize(); watchDpr(); }, { once: true, signal: sig }); } catch (e) {} })();
    refreshPalette(); resize(); build();

    let gpu = null; const gpuName = () => { if (gpu == null) try { const gl = renderer.getContext(), x = gl.getExtension('WEBGL_debug_renderer_info'); gpu = String(x && gl.getParameter(x.UNMASKED_RENDERER_WEBGL) || gl.getParameter(gl.RENDERER) || ''); } catch (e) { gpu = ''; } return gpu; }; // for stats(): the GPU's name, where the browser gives it
    return {
      is3d: true,
      get cam() { return cam; }, get k() { return kNow(); }, get W() { return W; }, get H() { return H; },
      get userMoved() { return userMoved; }, set userMoved(v) { userMoved = v; },
      resize, redraw: () => { needs = true; kick(); }, invalidate: () => { paintAll = true; needs = true; kick(); },
      refreshPalette: () => { refreshPalette(); if (ready) applyLook(); needs = true; kick(); },
      fitView, hitTest, hoodBBox: i => BB[i], regionBBox: r => base.regionBBox(r), subs: subsOf, subIndexAt: base.subIndexAt, landmarks: LANDS, bbox: BB,
      // a map point on screen, at the height of what stands there; the map point under a screen point. v: a view from fitView (default: the view on screen)
      // box: at the top of the tallest block in that box instead (as fitView frames it), for the top edge of a place as drawn
      toScreen(x, y, v, box) { const c = camFor(v), p = project(c, x, (box ? topIn(box) : surfaceAt(x, y, .15)) * c.vex, y); return [p[0], p[1]]; },
      toMap(sx, sy, v) { const p = pick(camFor(v), sx, sy); return [p.x, p.y]; },
      flyTo(bb, pad, minWv, dur) { const v = fitView(bb[0], bb[1], bb[2], bb[3], pad, minWv); userMoved = false; poke(); startFly(v, dur); },
      flyToView(v, dur) { userMoved = false; poke(); startFly(v, dur); },
      jumpTo(v) { poke(); const s = stateOf(v), a = areaObj(s.cx, s.cz); if (a !== area) { s.th = 0; s.off = 0; } area = a; Object.assign(cur, limit(s)); Object.assign(goal, cur); fly = null; mode = 'still'; sync(); shadowDirty = true; needs = true; kick(); },
      get area() { return area.id; }, areaAt: base.areaAt, areas: AREAS,
      zoom(f) { poke(); zoomAt(W / 2, H / 2, f); },
      setColors(colors, animate) { fogLens = colors.some(c => /--fog\d/.test(String(c))); colors.forEach((c, i) => { const rgb = hex2rgb(cssColor(c)); colTo[i] = rgb; if (!animate) colNow[i] = rgb.slice(); }); colAnim = !!animate; paintAll = true; needs = true; kick(); },
      setState(s) { if (s.region !== undefined) region = s.region; if (s.sel !== undefined) sel = s.sel; if (s.selSub !== undefined) selSub = s.selSub; if (s.quiz !== undefined) { quiz = s.quiz; press = -1; } needs = true; kick(); },
      setHover(i, sub, spot) { if (i === hover && sub === hoverSub && spot === hoverSpot) return; hover = i; hoverSub = sub; hoverSpot = spot; needs = true; kick(); },
      pop(i) { markAnim[i] = now(); needs = true; kick(); },
      setMe(xy) { me = xy; meT0 = now(); kick(); },
      subsShowing(i) { return subsOf(i) && (hoodPx(i) > 560 || i === sel); },
      hoodPx,
      // for tests and the console: what was built and how long it took, what a frame draws, and the cost of frames along a flight
      stats(lite) { const info = renderer.info; let tris = 0; const seen = q => { for (let p = q; p; p = p.parent) if (!p.visible) return false; return true; }; if (!lite) scene.traverse(q => { if ((q.isMesh || q.isPoints) && seen(q) && q.geometry) { const g = q.geometry, n = q.isPoints ? 0 : Math.min(g.drawRange.count, g.index ? g.index.count : g.attributes.position.count) / 3; tris += n * (q.isInstancedMesh ? q.count : g.isInstancedBufferGeometry ? g.instanceCount : 1); } });
        return { ready, blocks: stat.blocks, build: stat.build, firstFrame: stat.firstFrame ? Math.round(stat.firstFrame - stat.t0) : 0, sinceNav: stat.firstFrame ? Math.round(stat.firstFrame) : 0, frames: stat.frames, lastMs: +stat.lastMs.toFixed(2), sceneTriangles: Math.round(tris), calls: info.render.calls, triangles: info.render.triangles, pr, size: [W, H], dark, area: area.id, quality: Q.level, gov: { last: gov.last || 0, good: gov.good, fails: gov.fails.slice() }, fog: fogBank ? +fogBank.U.uK.value.toFixed(3) : 0, land: { relief: !!RL, close: fineOn, closeReady: !!fineMesh, places: RL ? RL.fineList.length : 0 }, real: { on: !!rb.gen, chunks: rb.live, buildings: rb.n, triangles: rb.tris, queue: rb.queue.length, tall: { groups: rb.tall.length, of: rb.gen ? rb.gen.tallCount : 0, buildings: rb.tall.reduce((s, t) => s + t.n, 0), triangles: rb.tall.reduce((s, t) => s + t.tris, 0), rise: rb.tallU ? +rb.tallU.uGrow.value.toFixed(2) : 0 } }, fabric: { chunks: fab.live, buildings: fab.nb, trees: fab.nt, grow: +fabU.uGrow.value.toFixed(2), queue: fab.queue.length }, why: stat.why, ambient: { on: ambOn(), t: +ambT.toFixed(2), frames: stat.amb, left: Math.max(0, Math.round(ambUntil - now())), ferry: ferries[0] ? [+ferries[0].mesh.position.x.toFixed(3), +ferries[0].mesh.position.z.toFixed(3)] : null }, view: Object.assign({ ph: +camOf(cur).ph.toFixed(3) }, cur),
          shadows: Q.shadows, fab: Q.fab, dpr, gpu: gpuName(), moving, shadowDraws: stat.shadowDraws, tune: Object.assign({}, T, TQ) }; },
      bench(n = 60) { // n frames spread along the flight in progress or, at rest, a small orbit; each forced to finish on the GPU
        const gl = renderer.getContext(), px = new Uint8Array(4), keep = Object.assign({}, cur), times = [], mv0 = moving; moving = true; // (drawn as moving frames: the shadow rule and the rest as under a finger)
        for (let i = 0; i < n; i++) { cur.th = keep.th + Math.sin(i / n * Math.PI * 2) * 0.12; cur.w = keep.w * (1 + 0.25 * Math.sin(i / n * Math.PI)); cur.cx = keep.cx + Math.sin(i * 0.2) * keep.w * 0.05; const t0 = now(); C = camOf(cur); const vx = C.vex; C.vex = vex; prepare(16); updateScene(t0, vx, 16); renderer.render(scene, camera); drawOverlay(t0, 16); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); times.push(now() - t0); }
        Object.assign(cur, keep); moving = mv0; needs = true; kick(); const list = times.map(x => +x.toFixed(2)); times.sort((a, b) => a - b);
        return { n, avg: +(times.reduce((s, x) => s + x, 0) / n).toFixed(2), p50: +times[n >> 1].toFixed(2), p95: +times[Math.floor(n * .95)].toFixed(2), max: +times[n - 1].toFixed(2), times: list }; },
      // the speed test's settings, until set again: pr (0 or null: the normal rule), shadows, fabShadow, fab, life (as in Q; null: the level's own),
      // shadowHold (false: the shadow rule before the speed fixes), plain (one plain material for everything: the cost without the lighting)
      tune(o) { o = o || {}; if ('pr' in o) T.pr = +o.pr > 0 ? clamp(+o.pr, 1, 3) : 0; for (const k of ['shadowHold', 'plain']) if (k in o) { if (o[k] == null) delete T[k]; else T[k] = !!o[k]; }
        for (const k of ['shadows', 'fabShadow', 'fab', 'life']) if (k in o) { if (o[k] == null) delete TQ[k]; else TQ[k] = k === 'fab' ? clamp(+o[k], 0, 1) : !!o[k]; }
        qSet(Q.level); key.castShadow = Q.shadows; scene.overrideMaterial = T.plain ? plainMat || (plainMat = new THREE.MeshBasicMaterial({ color: 0x9a9a9a })) : null; setPR(prOf()); shadowDirty = true; needs = true; kick(); return Object.assign({}, T, TQ); },
      get onDraw() { return onDraw; }, set onDraw(f) { onDraw = typeof f === 'function' ? f : null; }, // (t, moving or animating, a frame of ambient motion alone) after every frame drawn
    };
    } catch (e) { // the 3D map cannot be made here: the flat canvas back, the 3D canvases, the north button, listeners and renderer gone
      console.error('3D map: ' + (e && e.stack || e)); dead = true; ac.abort(); if (ro) ro.disconnect();
      canvas.hidden = false; const nb = lbl.nextElementSibling; if (nb && nb.classList.contains('m3d-north')) nb.remove(); glc.remove(); lbl.remove();
      try { renderer.dispose(); } catch (err) {} return null;
    }
  };
})();
