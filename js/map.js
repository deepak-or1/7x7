// The map: a Canvas 2D renderer with a camera, gestures with inertia, animated colors and labels,
// semantic zoom (neighborhood sections and landmarks appear as you get close), and hit testing.
// Everything is vector, drawn fresh each frame only while something moves, so there is never a blurry
// "settle" repaint. Geometry lives in map units (GEO.nx x GEO.ny); k = pixels per unit.
(function () {
  const G = window.GEO, Geom = window.Geom, NX = Geom.NX, NY = Geom.NY, proj = Geom.proj;
  const U = 400; // zoom-in limit and label growth are tuned in map units, where the first (SF-and-close-Bay) canvas was 400 wide
  const HOODS = G.hoods, IDX = Object.fromEntries(HOODS.map((h, i) => [h.name, i]));
  const SUBD = window.SUBAREAS || {}, LANDS = (window.LANDMARKS || []).map(l => { const [x, y] = proj([l.lon, l.lat]); return Object.assign({ x, y }, l); });
  const now = () => performance.now();
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const smooth = (v, a, b) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  const easeOut = t => 1 - Math.pow(1 - t, 4);
  const lerp = (a, b, t) => a + (b - a) * t;

  // ---- geometry in map units ----
  const PP = [], PATH = [], BB = [];
  window.HP.forEach(h => {
    const i = IDX[h.name]; const polys = h.polys.map(poly => poly.map(ring => ring.map(proj)));
    PP[i] = polys; PATH[i] = Geom.pathOf(polys.flat()); BB[i] = Geom.bboxOf(polys.flat());
  });
  const OTHER = Geom.pathOf(G.other.flat().map(r => r.map(proj)));
  // the Central Valley and the Sierra east of the county filler: land, so a wide zoomed-out view has no false sea there
  const FAR_LAND = (() => { const p = new Path2D(), a = proj([-121.3, 42.5]), b = proj([-114, 34.5]); p.rect(a[0], a[1], b[0] - a[0], b[1] - a[1]); return p; })();
  const WATER = Geom.pathOf((G.water || []).flat().map(r => r.map(proj))); // straits, bays and river mouths inside the county filler
  const OUTLINE = new Path2D(); G.outline.flat().forEach(l => l.forEach((p, k) => { const q = proj(p); if (k) OUTLINE.lineTo(q[0], q[1]); else OUTLINE.moveTo(q[0], q[1]); })); // shore polylines: open, never closed
  const REGION_BB = Object.assign({ all: [0, 0, NX, NY] }, G.regions);
  // landing frames the bay core (SF plus the inner ring of places), not the whole nine counties; zooming out still shows all of it
  const CORE = ['Novato', 'Richmond', 'Oakland', 'Hayward', 'San Mateo', 'Pacifica', 'Bolinas'], CORE_I = HOODS.map((h, i) => BB[i] && (h.region === 'sf' || CORE.includes(h.name)) ? i : -1).filter(i => i >= 0);
  if (CORE_I.length) REGION_BB.all = CORE_I.reduce((b, i) => [Math.min(b[0], BB[i][0]), Math.min(b[1], BB[i][1]), Math.max(b[2], BB[i][2]), Math.max(b[3], BB[i][3])], [Infinity, Infinity, -Infinity, -Infinity]);
  const SUB = [], LEAK = []; // per hood: [{name, line, known, tags, rings, path, bbox, c}] computed lazily; LEAK[i]: some cell edge runs outside the place
  function subsOf(i) {
    if (SUB[i] !== undefined) return SUB[i];
    const def = SUBD[HOODS[i].name]; if (!def || def.length < 2) { SUB[i] = null; return null; }
    const seeds = def.map(s => proj([s.lon, s.lat]));
    const cells = Geom.cells(PP[i], seeds, def.map(s => !!s.star)); // starred sections label at their seed (curated to sit on the thing itself)
    LEAK[i] = cells.some(c => c.leak);
    SUB[i] = cells.map((c, j) => Object.assign({}, def[j], { rings: c.rings, path: Geom.pathOf(c.rings), bbox: c.bbox, c: c.c, area: c.a }));
    return SUB[i];
  }
  // run draw() with the canvas clipped to place i, when its section cells have edges outside it
  const clipTo = (c, i, draw) => { if (!LEAK[i]) return draw(); c.save(); c.clip(PATH[i]); draw(); c.restore(); };
  // starred: a section may carry "star": "<reason>"; a place is starred when any of its sections is
  const STAR = HOODS.map(h => (SUBD[h.name] || []).some(s => s && s.star));
  function starPath(c, x, y, r) { c.beginPath(); for (let q = 0; q < 10; q++) { const rr = q % 2 ? r * .45 : r, a = -Math.PI / 2 + q * Math.PI / 5; c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } c.closePath(); }
  const subIndexAt = (i, x, y) => { const s = subsOf(i); if (!s) return -1; return s.findIndex(c => c.rings.some(r => Geom.pip(r, x, y))); };

  // ---- bridges: side views laid along their spans (precomputed, strokes sized in px at draw time) ----
  const BRIDGES = [
    { name: 'Golden Gate Bridge', pts: [[-122.4773, 37.8095], [-122.4790, 37.8335]], lbl: [-122.4905, 37.8235], kind: 'suspension', cable: [[0, 0], [.265, 1], [.735, 1], [1, 0]], h: .083, gg: true },
    { name: 'Bay Bridge', pts: [[-122.3886, 37.7870], [-122.3668, 37.8085]], lbl: [-122.3700, 37.7955], kind: 'suspension', cable: [[0, 0], [.15, 1], [.38, 1], [.5, 0], [.62, 1], [.85, 1], [1, 0]], h: .06 },
    { name: '', pts: [[-122.3590, 37.8135], [-122.3200, 37.8230]], kind: 'suspension', cable: [[.06, 0], [.3, 1], [.56, 0]], h: .075 },
    { name: 'Richmond–San Rafael Bridge', pts: [[-122.4800, 37.9405], [-122.3960, 37.9345]], lbl: [-122.4380, 37.9500], kind: 'truss', humps: [.3, .62], w: .09, h: .035 },
    { name: 'San Mateo Bridge', pts: [[-122.2560, 37.5660], [-122.1200, 37.6080]], lbl: [-122.2000, 37.6000], kind: 'truss', humps: [.12], w: .08, h: .028 },
    { name: 'Dumbarton Bridge', pts: [[-122.1290, 37.4980], [-122.1100, 37.5118]], lbl: [-122.1300, 37.5120], kind: 'truss', humps: [.5], w: .1, h: .04 },
    { name: 'Carquinez Bridge', pts: [[-122.2262, 38.0562], [-122.2285, 38.0662]], lbl: [-122.2450, 38.0600], kind: 'suspension', cable: [[0, 0], [.2, 1], [.8, 1], [1, 0]], h: .12 },
    { name: 'Benicia–Martinez Bridge', pts: [[-122.1230, 38.0335], [-122.1265, 38.0470]], lbl: [-122.1350, 38.0380], kind: 'truss', humps: [.5], w: .18, h: .05 },
    { name: 'Antioch Bridge', pts: [[-121.7518, 38.0122], [-121.7495, 38.0345]], lbl: [-121.7750, 38.0250], kind: 'truss', humps: [.45], w: .12, h: .04 },
  ].map(b => {
    const A = proj(b.pts[0]), B = proj(b.pts[1]), L = Math.hypot(B[0] - A[0], B[1] - A[1]), u = [(B[0] - A[0]) / L, (B[1] - A[1]) / L];
    let n = [-u[1], u[0]]; if (n[1] > 0.3 || (Math.abs(n[1]) <= 0.3 && n[0] > 0)) n = [-n[0], -n[1]];
    const P = (f, k) => [A[0] + u[0] * f * L + n[0] * k * L, A[1] + u[1] * f * L + n[1] * k * L];
    const path = pts => { const p = new Path2D(); pts.forEach((q, k) => k ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1])); return p; };
    const out = { a: A, b: B, gg: !!b.gg, deck: path([A, B]), towers: new Path2D(), cable: new Path2D(), hang: new Path2D(), humps: new Path2D(), lbl: b.name ? { text: b.name, p: proj(b.lbl) } : null };
    if (b.kind === 'suspension') {
      const h = b.h, dip = h * 0.18, c = b.cable;
      const heightAt = (f, p, q) => { const s = (f - p[0]) / (q[0] - p[0]); if (p[1] && q[1]) { const ctl = 2 * dip - h; return (1 - s) * (1 - s) * h + 2 * (1 - s) * s * ctl + s * s * h; } return (p[1] ? h : 0) * (1 - s) + (q[1] ? h : 0) * s; };
      c.forEach((node, i) => {
        const y = node[1] ? h : 0, pt = P(node[0], y);
        if (!i) out.cable.moveTo(pt[0], pt[1]);
        else { const prev = c[i - 1]; if (prev[1] && node[1]) { const m = P((prev[0] + node[0]) / 2, 2 * dip - h); out.cable.quadraticCurveTo(m[0], m[1], pt[0], pt[1]); } else out.cable.lineTo(pt[0], pt[1]); }
        if (node[1]) { const a = P(node[0], -h * .06), bb = P(node[0], h); out.towers.moveTo(a[0], a[1]); out.towers.lineTo(bb[0], bb[1]); }
        if (i) { const prev = c[i - 1], step = .042; for (let f = prev[0] + step; f < node[0] - step / 2; f += step) { const a = P(f, 0), bb = P(f, heightAt(f, prev, node)); out.hang.moveTo(a[0], a[1]); out.hang.lineTo(bb[0], bb[1]); } }
      });
    } else b.humps.forEach(f => { const a = P(f - b.w, 0), m = P(f, b.h * 2), bb = P(f + b.w, 0); out.humps.moveTo(a[0], a[1]); out.humps.quadraticCurveTo(m[0], m[1], bb[0], bb[1]); });
    return out;
  });
  const WATER_LBL = [['Pacific Ocean', -122.80, 37.35], ['San Francisco Bay', -122.25, 37.63, .8], ['San Pablo Bay', -122.40, 38.06, .8], ['Suisun Bay', -122.05, 38.08, 1.2], ['Tomales Bay', -122.89, 38.17, 1.2], ['South Bay', -122.06, 37.48, 1.2]].map(([t, lon, lat, kMin]) => ({ t: t.toUpperCase(), p: proj([lon, lat]), kMin: kMin || 0 })); // kMin: the bays are too narrow to name in the whole-Bay view

  // San Francisco's 38 small hoods rarely win a label at Bay Area scale: the city gets one name of its own there
  const SF_LBL = (() => { let w = 0, x = 0, y = 0; HOODS.forEach(h => { if (h.region === 'sf') { w += h.cells; x += h.cx * h.cells; y += h.cy * h.cells; } }); return w ? [x / w, y / w] : null; })();

  // ---- palette from CSS variables ----
  const P = {};
  const VARS = { water: '--water', paper: '--paper', dot: '--dot', ink: '--ink', muted: '--muted', land: '--land', landOther: '--land-other', coast: '--coast', wlbl: '--wlbl', steel: '--steel', gg: '--gg', accent: '--accent', want: '--want', label: '--label', cityLabel: '--city-label', labelHalo: '--label-halo', subLine: '--sub-line', face: '--glyph-face', shade: '--glyph-shade', roof: '--glyph-roof', line2: '--line-2', star: '--star', starInk: '--star-ink' };
  function refreshPalette() { const cs = getComputedStyle(document.documentElement); for (const k in VARS) P[k] = cs.getPropertyValue(VARS[k]).trim() || '#888'; }
  const hex2rgb = h => { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); const n = parseInt(h, 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  const rgbStr = c => `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`;
  const mix = (c, t, towards) => c.map((v, i) => v + (towards[i] - v) * t);
  const cssColor = cs => { cs = cs.trim(); if (cs.startsWith('var(')) { const name = cs.slice(4, -1).trim(); return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); } return cs; };

  window.MapView = function (canvas, o) {
    const ctx = canvas.getContext('2d', { alpha: false });
    const stage = canvas.parentElement;
    let W = 1, H = 1, dpr = 1;
    const cam = { x: 0, y: 0, w: NX };            // on screen now
    const goal = { x: 0, y: 0, w: NX };           // where smooth zoom is heading
    let mode = 'still';                            // still | smooth | fly | drag | inertia
    let fly = null, vel = { x: 0, y: 0 }, raf = 0, lastT = 0, userMoved = false;
    let lite = false, frameCost = 6;
    const isPhone = () => window.innerWidth <= 880;
    const kNow = () => W / cam.w;
    const supportsLS = 'letterSpacing' in ctx;

    // state from the app
    let region = 'all', sel = -1, selSub = -1, hover = -1, hoverSub = -1, hoverSpot = null, quiz = false;
    const colNow = HOODS.map(() => [200, 200, 200]), colTo = HOODS.map(() => [200, 200, 200]); let colAnim = false;
    const lblA = HOODS.map(() => 0), subA = {}, lmA = LANDS.map(() => 0), bridgeLblA = [0], waterLblA = [0], sfA = [0], starA = {};
    const markAnim = {}; let me = null, meT0 = 0;
    const measureCache = new Map(); let drawnSpots = [];
    // widths measured before the webfont arrives belong to the fallback face: measure again once it loads
    if (document.fonts && document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', () => { measureCache.clear(); dirty = true; kick(); });
    // widths scale linearly with size for a given face, so measure once at 20px and scale
    function measure(text, weight, size) { const key = weight + '|' + text; let w = measureCache.get(key); if (w == null) { ctx.font = `${weight} 20px Figtree, system-ui, sans-serif`; w = ctx.measureText(text).width; if (!document.fonts || document.fonts.status !== 'loading') measureCache.set(key, w); } return w * size / 20; }
    function haloText(text, x, y, size, color) { if (!lite) { const r = Math.max(1, size * .11); ctx.fillStyle = P.labelHalo; for (let q = 0; q < 6; q++) { const a = q * Math.PI / 3; ctx.fillText(text, x + Math.cos(a) * r, y + Math.sin(a) * r); } } ctx.fillStyle = color; ctx.fillText(text, x, y); }
    // the gold star beside a starred label: a vector glyph (same on every platform) with the label halo around it
    function haloStar(x, y, size, halo = true) { const r = size * .5; starPath(ctx, x, y, r); if (halo && !lite) { ctx.strokeStyle = P.labelHalo; ctx.lineWidth = Math.max(2, size * .26); ctx.lineJoin = 'round'; ctx.stroke(); } ctx.fillStyle = P.star; ctx.fill(); }

    // ---- camera helpers ----
    const maxW = () => Math.max(NX, NY * W / H) * 2.2; // zoomed out: the whole canvas fits either way, with room
    function clampCam(c) { c.w = clamp(c.w, U * 0.012, maxW()); const h = c.w * H / W; c.x = clamp(c.x, -c.w * .55, NX - c.w * .45); c.y = clamp(c.y, -h * .55, NY - h * .45); return c; }
    function insets() { return o.insets ? o.insets() : { top: 0, right: 0, bottom: 0, left: 0 }; }
    function fitView(x0, y0, x1, y1, pad, minW) {
      const I = insets(), vw = Math.max(80, W - I.left - I.right), vh = Math.max(80, H - I.top - I.bottom);
      let wVis = Math.max(minW || 0, (x1 - x0) * pad, (y1 - y0) * pad * vw / vh);
      const w = wVis * W / vw, k = W / w, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
      return clampCam({ x: cx - (I.left + vw / 2) / k, y: cy - (I.top + vh / 2) / k, w });
    }
    function toScreen(x, y) { const k = kNow(); return [(x - cam.x) * k, (y - cam.y) * k]; }
    function toMap(sx, sy) { const k = kNow(); return [cam.x + sx / k, cam.y + sy / k]; }
    function visible(bb, k, m = 0) { return bb[2] > cam.x - m / k && bb[0] < cam.x + (W + m) / k && bb[3] > cam.y - m / k && bb[1] < cam.y + (H + m) / k; }
    function hoodPx(i) { return (BB[i][2] - BB[i][0]) * kNow(); }

    function startFly(to, dur) {
      const from = { x: cam.x, y: cam.y, w: cam.w }; clampCam(to);
      const d = Math.hypot((to.x + to.w / 2) - (from.x + from.w / 2), (to.y + to.w * H / W / 2) - (from.y + from.w * H / W / 2));
      const wArc = Math.max(from.w, to.w, d * 1.1), bump = Math.max(0, Math.log(wArc) - Math.max(Math.log(from.w), Math.log(to.w))) * .9;
      const ratio = Math.abs(Math.log(to.w / from.w)), dist = d / Math.max(from.w, to.w);
      fly = { from, to, t0: now(), dur: dur || clamp(380 + ratio * 160 + dist * 260, 380, 900), bump };
      mode = 'fly'; Object.assign(goal, to); kick();
    }
    function stepFly(t) {
      const e = easeOut(clamp((t - fly.t0) / fly.dur, 0, 1)), f = fly.from, g = fly.to;
      const lw = lerp(Math.log(f.w), Math.log(g.w), e) + fly.bump * Math.sin(Math.PI * e);
      const w = Math.exp(lw), ar = H / W;
      const cx = lerp(f.x + f.w / 2, g.x + g.w / 2, e), cy = lerp(f.y + f.w * ar / 2, g.y + g.w * ar / 2, e);
      cam.x = cx - w / 2; cam.y = cy - w * ar / 2; cam.w = w;
      if (e >= 1) { Object.assign(cam, g); fly = null; mode = 'still'; }
    }
    function zoomAt(sx, sy, factor, instant) { // keep the map point under (sx,sy) fixed
      const base = instant ? cam : goal, k = W / base.w, mx = base.x + sx / k, my = base.y + sy / k;
      const w = clamp(base.w * factor, U * 0.012, maxW()), k2 = W / w;
      const n = clampCam({ x: mx - sx / k2, y: my - sy / k2, w });
      if (instant) { Object.assign(cam, n); Object.assign(goal, n); mode = 'drag'; } else { Object.assign(goal, n); if (mode !== 'smooth') { fly = null; mode = 'smooth'; } }
      userMoved = true; kick();
    }
    function panBy(dx, dy) { const k = kNow(); cam.x -= dx / k; cam.y -= dy / k; clampCam(cam); Object.assign(goal, cam); userMoved = true; }

    // ---- the frame loop ----
    function kick() { if (!raf) { lastT = now(); raf = requestAnimationFrame(frame); } }
    function frame(t) {
      raf = 0; const dt = Math.min(50, t - lastT || 16); lastT = t;
      let busy = false;
      if (mode === 'fly' && fly) { stepFly(t); busy = true; }
      else if (mode === 'smooth') { const a = 1 - Math.exp(-dt / 90); let d = 0; for (const p of ['x', 'y', 'w']) { const dd = goal[p] - cam[p]; d += Math.abs(dd) / cam.w; cam[p] += dd * a; } if (d < 0.0005) { Object.assign(cam, goal); mode = 'still'; } else busy = true; }
      else if (mode === 'inertia') { const f = Math.exp(-dt / 320); panBy(vel.x * dt, vel.y * dt); vel.x *= f; vel.y *= f; if (Math.hypot(vel.x, vel.y) < 0.02) mode = 'still'; else busy = true; }
      if (colAnim) { const a = 1 - Math.exp(-dt / 140); let left = false; for (let i = 0; i < HOODS.length; i++) { const c = colNow[i], g = colTo[i]; for (let j = 0; j < 3; j++) { const d = g[j] - c[j]; if (Math.abs(d) > 1) { c[j] += d * a; left = true; } else c[j] = g[j]; } } colAnim = left; busy = busy || left; }
      const t0 = now();
      const anim = draw(dt);
      const cost = now() - t0; frameCost = frameCost * .8 + cost * .2;
      if (busy) lite = frameCost > 13; else lite = false;
      if (busy || anim || me) raf = requestAnimationFrame(frame); else if (lite) { lite = false; raf = requestAnimationFrame(frame); }
      if (busy && o.onMove) o.onMove();
    }
    // fade a value toward a target; returns true while still moving
    function fade(obj, key, target, dt, ms = 140) { const v = obj[key] || 0; if (Math.abs(target - v) < 0.01) { obj[key] = target; return false; } obj[key] = v + (target - v) * (1 - Math.exp(-dt / ms)); return true; }

    // ---- drawing ----
    const prof = {}; let pt0 = 0; const tick = name => { if (!window.__PROFILE) return; const t = performance.now(); prof[name] = (prof[name] || 0) + (t - pt0); pt0 = t; }; window.__prof = prof;
    // The terrain (land, fills, sections, borders, bridges) is rasterized into an offscreen bitmap a little larger
    // than the viewport. Pans just blit it; zooms re-rasterize when the scale drifts past a small tolerance, and
    // between re-renders the bitmap is scaled, which at ~1% drift is invisible. Labels and markers are always live.
    const tc = document.createElement('canvas'), tctx = tc.getContext('2d', { alpha: false });
    const cache = { valid: false, k: 0, x: 0, y: 0, mw: 0, mh: 0, t: 0, cost: 4 };
    let dirty = true; // something other than the camera changed (colors, selection, region, filters)
    function subFactor(i) { if (quiz) return 0; const px = hoodPx(i); let f = smooth(px, 300, 560); if (i === sel) f = Math.max(f, px > (isPhone() ? 110 : 150) ? 1 : 0); return subsOf(i) ? f : 0; }
    let stipKey = '', stipPat = null;
    function stipplePattern(cd) {
      const key = P.dot + '|' + cd; if (key === stipKey && stipPat) return stipPat;
      const t = document.createElement('canvas'), px = Math.max(1, Math.round(5 * cd)); t.width = t.height = px;
      const g = t.getContext('2d'); g.fillStyle = P.dot; g.beginPath(); g.arc(px / 2, px / 2, Math.max(.5, .75 * cd), 0, Math.PI * 2); g.fill();
      stipKey = key; stipPat = tctx.createPattern(t, 'repeat'); return stipPat;
    }
    function renderTerrain(k) {
      // slow devices get a lower-resolution terrain bitmap (labels stay crisp: they are drawn live)
      const cd = cache.cost > 60 ? Math.min(dpr, 1) : cache.cost > 28 ? Math.min(dpr, 1.5) : dpr;
      const mw = Math.round(Math.min(W * .22, 200)), mh = Math.round(Math.min(H * .22, 200));
      const cw = Math.round((W + 2 * mw) * cd), ch = Math.round((H + 2 * mh) * cd);
      if (tc.width !== cw || tc.height !== ch) { tc.width = cw; tc.height = ch; }
      const x = cam.x - mw / k, y = cam.y - mh / k, c = tctx;
      c.setTransform(cd, 0, 0, cd, 0, 0); c.fillStyle = P.water; c.fillRect(0, 0, W + 2 * mw, H + 2 * mh);
      c.setTransform(k * cd, 0, 0, k * cd, -x * k * cd, -y * k * cd);
      c.lineJoin = 'round'; c.lineCap = 'round';
      c.fillStyle = P.landOther; c.fill(FAR_LAND); c.fill(OTHER);
      // stipple on the land outside the places: a fixed 5 px screen pitch whatever the zoom, like a printed atlas
      c.save(); const stip = new Path2D(); stip.addPath(FAR_LAND); stip.addPath(OTHER); c.clip(stip); c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = stipplePattern(cd); c.fillRect(0, 0, tc.width, tc.height); c.restore();
      c.setTransform(k * cd, 0, 0, k * cd, -x * k * cd, -y * k * cd); c.fillStyle = P.water; c.fill(WATER); tick('t-other');
      c.strokeStyle = P.coast; for (const [wpx, a] of [[14, .05], [8, .08], [3, .16]]) { c.globalAlpha = a; c.lineWidth = wpx / k; c.stroke(OUTLINE); } c.globalAlpha = 1; tick('t-halo');
      const vis = [], subF = [], x1 = x + (W + 2 * mw) / k, y1 = y + (H + 2 * mh) / k, gold = hex2rgb(P.star);
      for (let i = 0; i < HOODS.length; i++) { const bb = BB[i]; if (bb[2] < x || bb[0] > x1 || bb[3] < y || bb[1] > y1) continue; vis.push(i); subF[i] = subFactor(i); }
      for (const i of vis) {
        const far = region !== 'all' && HOODS[i].region !== region && i !== sel;
        const a = (o.alphaFor ? o.alphaFor(i) : 1) * (far ? .32 : 1);
        c.globalAlpha = a; c.fillStyle = rgbStr(colNow[i]); c.fill(PATH[i]);
        if (subF[i] > 0.01) { const cells = subsOf(i), base = colNow[i], white = [255, 255, 255], black = [20, 30, 40]; c.globalAlpha = a * subF[i]; clipTo(c, i, () => cells.forEach((cell, j) => { const m = j % 3; c.fillStyle = rgbStr(cell.star ? mix(base, .12, gold) : m === 0 ? mix(base, .09, white) : m === 1 ? base : mix(base, .07, black)); c.fill(cell.path); })); }
      }
      tick('t-fills'); c.strokeStyle = P.paper; c.lineWidth = 1 / k;
      for (const i of vis) { const far = region !== 'all' && HOODS[i].region !== region; c.globalAlpha = far ? .35 : .9; c.stroke(PATH[i]); }
      c.strokeStyle = P.subLine; c.lineWidth = .8 / k;
      for (const i of vis) if (subF[i] > 0.01) { c.globalAlpha = subF[i] * .9; clipTo(c, i, () => subsOf(i).forEach(cell => c.stroke(cell.path))); }
      // starred sections: a gold band just inside the cell edge, with a dark-gold rim, so it reads on any base colour
      for (const i of vis) if (STAR[i] && subF[i] > 0.01) { c.globalAlpha = subF[i]; clipTo(c, i, () => subsOf(i).forEach(cell => { if (!cell.star) return; c.save(); c.clip(cell.path); c.strokeStyle = P.star; c.lineWidth = 6 / k; c.stroke(cell.path); c.strokeStyle = P.starInk; c.lineWidth = 2 / k; c.stroke(cell.path); c.restore(); })); }
      c.globalAlpha = 1; tick('t-borders');
      for (const b of BRIDGES) {
        const col = b.gg ? P.gg : P.steel; c.strokeStyle = col;
        c.lineWidth = 3 / k; c.stroke(b.deck); c.strokeStyle = P.paper; c.lineWidth = 1 / k; c.stroke(b.deck);
        c.strokeStyle = col; c.lineWidth = 2.6 / k; c.stroke(b.towers); c.lineWidth = 1.4 / k; c.stroke(b.cable); c.lineWidth = 1.6 / k; c.stroke(b.humps);
        c.globalAlpha = .55; c.lineWidth = .8 / k; c.stroke(b.hang); c.globalAlpha = 1;
      }
      tick('t-bridges'); Object.assign(cache, { valid: true, k, x, y, mw, mh, cd, t: now() }); dirty = false;
    }
    function draw(dt) {
      const k = kNow(), I = insets(); let anim = false; pt0 = performance.now(); prof.frames = (prof.frames || 0) + 1;
      // terrain: reuse, scale, or re-render
      const drift = cache.valid ? Math.abs(k / cache.k - 1) : 1;
      const inside = cache.valid && cam.x >= cache.x && cam.y >= cache.y && cam.x + W / k <= cache.x + (W + 2 * cache.mw) / cache.k && cam.y + H / k <= cache.y + (H + 2 * cache.mh) / cache.k;
      const minGap = clamp(cache.cost * 2.2, 32, 400), sinceT = now() - cache.t;
      const need = !cache.valid || dirty || colAnim || !inside || drift > 0.25 || (drift > 0.004 && sinceT >= minGap) || (drift > 0.0005 && mode === 'still' && sinceT >= 40);
      const t0 = now();
      if (need) { renderTerrain(k); anim = anim || colAnim; }
      const s = k / cache.k, bw = tc.width / cache.cd * s, bh = tc.height / cache.cd * s;
      let ox = (cache.x - cam.x) * k, oy = (cache.y - cam.y) * k, tx = 0, ty = 0;
      if (s === 1 && cache.cd === dpr) { // a 1:1 blit lands on the device grid, or it resamples soft; the remainder shifts the live strokes with it
        const sx = Math.round(ox * dpr) / dpr, sy = Math.round(oy * dpr) / dpr; tx = (sx - ox) * dpr; ty = (sy - oy) * dpr; ox = sx; oy = sy;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (s !== 1 || cache.cd !== dpr) { ctx.fillStyle = P.water; ctx.fillRect(0, 0, W, H); }
      ctx.drawImage(tc, ox, oy, bw, bh);
      if (need) { const cost = now() - t0; cache.cost = cache.cost * .6 + cost * .4; } // includes the flush of the offscreen raster
      tick('terrain');
      // live strokes: hover and selection
      ctx.setTransform(k * dpr, 0, 0, k * dpr, -cam.x * k * dpr + tx, -cam.y * k * dpr + ty); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      if (hover >= 0 && hover !== sel && !quiz) { ctx.strokeStyle = P.ink; ctx.lineWidth = 1.4 / k; ctx.stroke(PATH[hover]); }
      if (sel >= 0) {
        const cells = subsOf(sel), sp = selSub >= 0 && cells ? cells[selSub] : null, ph = isPhone();
        clipTo(ctx, sel, () => { if (sp && ph && !sp.star) { ctx.globalAlpha = .16; ctx.fillStyle = P.accent; ctx.fill(sp.path); ctx.globalAlpha = 1; } }); // phone: the selected section is tinted and outlined harder than its place (a starred one keeps its gold band instead)
        ctx.strokeStyle = P.accent; ctx.lineWidth = (sp && ph ? 1.4 : 2.2) / k; ctx.stroke(PATH[sel]);
        clipTo(ctx, sel, () => {
          if (sp) { ctx.strokeStyle = P.accent; ctx.lineWidth = (ph ? 2.8 : 1.8) / k; ctx.stroke(sp.path); }
          if (hoverSub >= 0 && hoverSub !== selSub && hover === sel && subsOf(sel)) { ctx.strokeStyle = P.ink; ctx.lineWidth = 1.2 / k; ctx.stroke(subsOf(sel)[hoverSub].path); }
        });
      }
      const vis = [], subF = [];
      for (let i = 0; i < HOODS.length; i++) { if (!visible(BB[i], k, 40)) { subF[i] = 0; continue; } vis.push(i); subF[i] = subFactor(i); }
      tick('live');
      // ---- screen space ----
      ctx.setTransform(dpr, 0, 0, dpr, tx, ty);
      ctx.textBaseline = 'middle';
      // water & bridge names
      anim = fade(waterLblA, 0, k < 5.5 && !quiz ? 1 : 0, dt) || anim;
      const waterBoxes = []; // phone: place labels avoid the water names
      if (waterLblA[0] > 0.01) { ctx.globalAlpha = waterLblA[0]; ctx.fillStyle = P.wlbl; ctx.textAlign = 'center'; const fs = isPhone() ? 9.5 : 10.5; ctx.font = `500 ${fs}px Figtree, system-ui, sans-serif`; if (supportsLS) ctx.letterSpacing = '0.3em'; for (const wl of WATER_LBL) { if (k < wl.kMin) continue; const [sx, sy] = toScreen(wl.p[0], wl.p[1]); if (sx > -200 && sx < W + 200 && sy > -40 && sy < H + 40) { ctx.fillText(wl.t, sx, sy); if (isPhone() && waterLblA[0] > .3) { const ww = (measure(wl.t, 500, fs) + wl.t.length * fs * .3) / 2; waterBoxes.push([sx - ww, sy - fs * .7, sx + ww, sy + fs * .7]); } } } if (supportsLS) ctx.letterSpacing = '0px'; ctx.globalAlpha = 1; }
      anim = fade(bridgeLblA, 0, k > 3.2 && k < 40 && !quiz ? 1 : 0, dt) || anim;
      if (bridgeLblA[0] > 0.01) { ctx.globalAlpha = bridgeLblA[0]; ctx.textAlign = 'center'; ctx.font = `500 ${isPhone() ? 9.5 : 10.5}px Figtree, system-ui, sans-serif`; for (const b of BRIDGES) if (b.lbl) { const [sx, sy] = toScreen(b.lbl.p[0], b.lbl.p[1]); if (sx > -100 && sx < W + 100 && sy > -20 && sy < H + 20 && (!isPhone() || Math.abs(sx - W / 2) + measure(b.lbl.text, 500, 9.5) / 2 < W / 2 - 2)) { ctx.fillStyle = P.water; for (let q = 0; q < 6; q++) { const a = q * Math.PI / 3; ctx.fillText(b.lbl.text, sx + Math.cos(a) * 1.2, sy + Math.sin(a) * 1.2); } ctx.fillStyle = P.muted; ctx.fillText(b.lbl.text, sx, sy); } } ctx.globalAlpha = 1; }

      tick('waterlbl');
      // labels: hoods first (priority order, no overlaps), then sections, then spot names
      const placed = [];
      const clash = (b, self) => placed.some(q => (q.own == null || q.own !== self) && b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1]);
      if (o.occluders) for (const b of o.occluders()) placed.push(b); // floating chrome over the canvas (phone)
      for (const b of waterBoxes) placed.push(b);
      const marks = o.marks ? o.marks() : [];
      // landmark glyphs cannot move, so their footprints are reserved first (they are drawn later, above the fills)
      const lmF = quiz ? 0 : smooth(k, 7, 10.5), lmH = clamp(k * 1.7, 16, 44);
      LANDS.forEach((l, j) => {
        const hi = IDX[l.hood]; const far = region !== 'all' && hi != null && HOODS[hi].region !== region;
        const [sx, sy] = toScreen(l.x, l.y); const onScreen = sx > -60 && sx < W + 60 && sy > -60 && sy < H + 60;
        anim = fade(lmA, j, onScreen && !far ? lmF : 0, dt, 180) || anim;
        l._s = onScreen ? [sx, sy] : null;
        l._box = (lmA[j] > 0.01 && onScreen) ? [sx - lmH * (l.w || 1) / 2, sy - lmH, sx + lmH * (l.w || 1) / 2, sy] : null;
        if (l._box && lmA[j] > 0.3) placed.push([l._box[0] - 2, l._box[1] - 2, l._box[2] + 2, l._box[3] + 2]);
      });
      // flags and want marks are fixed too: reserve their footprints so neighbouring labels move or hide (a place's own label starts below its mark)
      if (!quiz) for (const i of vis) if (marks[i]) { const [sx, sy] = toScreen(HOODS[i].cx, HOODS[i].cy); placed.push(marks[i] === 'flag' ? [sx - 4, sy - 19, sx + 14, sy + 3] : [sx - 6, sy - 10, sx + 6, sy + 5]); }
      // bridge decks: small boxes along each span, so place names do not sit on a bridge
      if (!quiz) for (const b of BRIDGES) { const [ax, ay] = toScreen(b.a[0], b.a[1]), [bx, by] = toScreen(b.b[0], b.b[1]), n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 10)); for (let q = 0; q <= n; q++) { const x = ax + (bx - ax) * q / n, y = ay + (by - ay) * q / n; if (x > -10 && x < W + 10 && y > -10 && y < H + 10) placed.push([x - 4, y - 4, x + 4, y + 4]); } }
      // Bay Area view: one name for San Francisco, placed before the per-place labels
      const sfOn = !quiz && region === 'all' && sel < 0 && SF_LBL && (REGION_BB.sf[2] - REGION_BB.sf[0]) * k < 170;
      anim = fade(sfA, 0, sfOn ? 1 : 0, dt, 160) || anim;
      let sfBox = null; const sfSize = Math.round((isPhone() ? 10.5 : 11.5) * 1.1 * 4) / 4;
      if (sfA[0] > 0.01 && SF_LBL) { // on the city if there is room, else just west of it over the ocean, or below
        const [sx, sy] = toScreen(SF_LBL[0], SF_LBL[1]), tw = measure('SAN FRANCISCO', 800, sfSize) + 13 * sfSize * .05, th = sfSize * 1.2;
        sfBox = [[0, 0], [-tw / 2 - 14, 0], [-tw / 2 - 14, th], [0, th * 1.3]].map(([dx, dy]) => [sx + dx - tw / 2 - 2, sy + dy - th / 2, sx + dx + tw / 2 + 2, sy + dy + th / 2]).find(b => !clash(b)) || null;
        if (sfBox && sfOn) placed.push(sfBox); }
      const base = Math.round((isPhone() ? 10.5 : 11.5) * clamp(Math.pow(U / cam.w, 0.22), 1, 1.32) * 4) / 4;
      const prio = i => (i === sel ? 1e9 : 0) + (i === hover ? 5e8 : 0) + (STAR[i] ? 2e7 : 0) + (marks[i] ? 1e7 : 0) + HOODS[i].cells; // starred places outrank marks: the user asked for them to stand out
      const order = vis.slice().sort((a, b) => prio(b) - prio(a));
      const labelFont = s => `800 ${s.toFixed(1)}px Figtree, system-ui, sans-serif`;
      const show = [];
      for (const i of order) {
        const h = HOODS[i], far = region !== 'all' && h.region !== region && i !== sel && i !== hover;
        let target = 0, box = null, size = base, ghost = false, st = 0;
        if (!quiz && !far) {
          const hot = i === sel || i === hover, text = (window.SHORT[h.name] || h.name).toUpperCase();
          ghost = subF[i] > 0.6 && (isPhone() ? i === sel : !hot); // phone: only the selected place becomes a watermark (its sections get the room); neighbours keep normal labels
          size = ghost ? base * 1.55 : hot ? base * 1.15 : base;
          st = STAR[i] ? size * (ghost ? .75 : .85) + size * .3 : 0; // a starred place: a small gold star after its name, inside the label's box
          const tw = measure(text, 800, size) + text.length * size * (ghost ? .14 : .05) + st, th = size * 1.2;
          const [cx, cy0] = toScreen(h.cx, h.cy); const cy = cy0 + (marks[i] && !ghost ? size * 1.25 : 0);
          const gx = isPhone() ? 4 : 2, gy = isPhone() ? 1 : 0; // phone labels keep wider clearance
          const at = y => [cx - tw / 2 - gx, y - th / 2 - gy, cx + tw / 2 + gx, y + th / 2 + gy];
          box = at(cy);
          const fits = (BB[i][2] - BB[i][0]) * k >= tw * .72 && (BB[i][3] - BB[i][1]) * k >= th;
          const keep = hot || marks[i] || STAR[i] || h.cells < 10;
          const onOwn = b => { if (!isPhone()) return true; const [x0, y0] = toScreen(BB[i][0], BB[i][1]), [x1, y1] = toScreen(BB[i][2], BB[i][3]), my = (b[1] + b[3]) / 2; return my >= Math.min(y0, y1) - th * .6 && my <= Math.max(y0, y1) + th * .6; }; // phone: never move a label off its own place; hide it instead
          if (!ghost && (fits || keep) && clash(box, i)) { for (const dy of [th * 1.15, -th * 1.15, th * 2.2]) { const alt = at(cy + dy); if (onOwn(alt) && !clash(alt, i)) { box = alt; break; } } }
          const inView = b => !isPhone() || hot || (b[0] >= 2 && b[2] <= W - 2 && b[1] >= 0 && b[3] <= H); // phone: no labels sliced by the screen edge
          target = ghost ? (i === sel ? .5 : (fits ? .32 : 0)) : (hot || ((fits || keep) && !clash(box, i) && inView(box))) ? 1 : 0;
          if (target && !ghost) placed.push(box);
        }
        anim = fade(lblA, i, target, dt, 160) || anim;
        if (lblA[i] > 0.01 && box) show.push({ i, box, size, ghost, st, gx: isPhone() ? 4 : 2, hot: i === sel || i === hover });
        // a starred place whose name lost the room still shows its gold star, if 18 px are free at its anchor
        if (STAR[i]) { let sb = null; if (!quiz && !far && !target) { const [sx, sy] = toScreen(h.cx, h.cy); sb = (sx < 0 || sx > W || sy < 0 || sy > H) ? null : [[0, 0], [0, 14], [-14, 4], [14, 8]].map(([dx, dy]) => [sx + dx - 9, sy + dy - 9, sx + dx + 9, sy + dy + 9]).find(b => !clash(b)) || null; if (sb) placed.push(sb); } // beside a flag, if the anchor itself is taken
          anim = fade(starA, i, sb ? 1 : 0, dt, 160) || anim; if (sb) starA['b' + i] = sb; }
      }
      // the star after a starred place's name: centred in the room the label box saved for it
      const placeStar = (s, dy = 0) => { if (!s.st) return; const ss = s.size * (s.ghost ? .75 : .85); haloStar(s.box[2] - s.gx - ss / 2, (s.box[1] + s.box[3]) / 2 + dy - s.size * .06, ss, !s.ghost); };
      let wm = null; // phone: the selected place's watermark is placed after its section labels, in a clear spot
      if (sfBox && sfA[0] > 0.01) { ctx.globalAlpha = sfA[0]; ctx.textAlign = 'center'; ctx.font = labelFont(sfSize); if (supportsLS) ctx.letterSpacing = '0.05em'; ctx.fillStyle = P.cityLabel; ctx.fillText('SAN FRANCISCO', (sfBox[0] + sfBox[2]) / 2, (sfBox[1] + sfBox[3]) / 2); if (supportsLS) ctx.letterSpacing = '0px'; ctx.globalAlpha = 1; }
      for (const key in starA) { if (key[0] === 'b' || starA[key] <= 0.01 || !starA['b' + key]) continue; const b = starA['b' + key]; ctx.globalAlpha = starA[key]; haloStar((b[0] + b[2]) / 2, (b[1] + b[3]) / 2, base * 1.1); ctx.globalAlpha = 1; }
      for (const s of show) {
        if (s.ghost && s.i === sel && isPhone()) { wm = s; continue; }
        const h = HOODS[s.i], text = (window.SHORT[h.name] || h.name).toUpperCase(), cx = (s.box[0] + s.box[2]) / 2 - s.st / 2, cy = (s.box[1] + s.box[3]) / 2;
        ctx.globalAlpha = lblA[s.i]; ctx.textAlign = 'center'; ctx.font = labelFont(s.size);
        if (supportsLS) ctx.letterSpacing = s.ghost ? '0.14em' : '0.05em';
        if (s.ghost) { ctx.fillStyle = s.i === sel ? P.accent : P.label; ctx.fillText(text, cx, cy); } else { ctx.fillStyle = s.hot ? P.accent : P.cityLabel; ctx.fillText(text, cx, cy); }
        placeStar(s);
      }
      if (supportsLS) ctx.letterSpacing = '0px';
      ctx.globalAlpha = 1; tick('hoodlbl');
      // section labels
      const subSize = isPhone() ? 10.5 : 11.5, subFont = `500 ${subSize}px Figtree, system-ui, sans-serif`, sgx = 2;
      const hotSize = subSize * 1.25, hotFont = `600 ${hotSize}px Figtree, system-ui, sans-serif`; // phone: the selected section's name leads
      // the selected section's label claims its room first, then starred sections, then the rest
      const hotL = [], secs = [], plain = [];
      for (const i of vis) { const cells = subsOf(i); if (cells) cells.forEach((c, j) => (i === sel && j === selSub ? hotL : c.star ? secs : plain).push([i, j, c])); }
      for (const [i, j, c] of hotL.concat(secs, plain)) {
          const key = i + ':' + j; let target = 0, box = null, sw = 0;
          if (subF[i] > 0.01) {
            const hot = i === sel && j === selSub, big = hot && isPhone(), ss = big ? hotSize : subSize;
            sw = c.star ? ss * 1.05 + 3 : 0; // the star glyph and its gap, in front of the name
            const tw = measure(c.name, big ? 600 : 500, ss) + sw, th = ss * 1.2, [cx, cy] = toScreen(c.c[0], c.c[1]);
            box = [cx - tw / 2 - sgx, cy - th / 2, cx + tw / 2 + sgx, cy + th / 2];
            const fits = (c.bbox[2] - c.bbox[0]) * k >= tw * .8 && (c.bbox[3] - c.bbox[1]) * k >= th * 1.1;
            // in a starred place, a label that clashes looks for the nearest clear, on-screen spot whose centre stays in its own section
            let moved = false;
            if (STAR[i] && (c.star || fits) && clash(box)) {
              const inScr = b => { const dx = Math.max(0, 2 - b[0]) + Math.min(0, W - 2 - b[2]); return [b[0] + dx, b[1], b[2] + dx, b[3]]; };
              const inCell = b => { const [mx, my] = toMap((b[0] + b[2]) / 2, (b[1] + b[3]) / 2); return c.rings.some(r => Geom.pip(r, mx, my)); };
              search: for (const dy of [0, th * 1.15, -th * 1.15, th * 2.3, -th * 2.3]) for (const dx of [0, -tw * .5, tw * .5, -tw, tw]) { const alt = inScr([box[0] + dx, box[1] + dy, box[2] + dx, box[3] + dy]); if (!clash(alt) && inCell(alt)) { box = alt; moved = true; break search; } }
            }
            if ((c.star && !clash(box)) || ((fits || hot || moved) && !clash(box) && (hot || !isPhone() || (box[0] >= 2 && box[2] <= W - 2 && box[1] >= 0 && box[3] <= H)))) { target = subF[i]; placed.push(box); }
          }
          anim = fade(subA, key, target, dt, 160) || anim;
          if (subA[key] > 0.01 && box) {
            const big = i === sel && j === selSub && isPhone(), ss = big ? hotSize : subSize, my = (box[1] + box[3]) / 2;
            ctx.globalAlpha = subA[key]; ctx.textAlign = 'center'; ctx.font = big ? hotFont : subFont;
            haloText(c.name, (box[0] + box[2]) / 2 + sw / 2, my, ss, (i === sel && j === selSub && !c.star) ? P.accent : P.label); // a selected starred section keeps ink text: accent on its gold reads poorly
            if (sw) haloStar(box[0] + sgx + ss * .525, my - ss * .05, ss * 1.05);
          }
      }
      if (wm) {
        const text = (window.SHORT[HOODS[wm.i].name] || HOODS[wm.i].name).toUpperCase(), th = wm.size * 1.2, b = wm.box;
        const hit = q => placed.some(p => q[0] < p[2] && q[2] > p[0] && q[1] < p[3] && q[3] > p[1]);
        const dy = [0, th * 1.4, -th * 1.4, th * 2.8, -th * 2.8, th * 4.2, -th * 4.2].find(d => !hit([b[0], b[1] + d, b[2], b[3] + d]));
        if (dy != null) { ctx.globalAlpha = lblA[wm.i]; ctx.textAlign = 'center'; ctx.font = labelFont(wm.size); if (supportsLS) ctx.letterSpacing = '0.14em'; ctx.fillStyle = P.accent; ctx.fillText(text, (b[0] + b[2]) / 2 - wm.st / 2, (b[1] + b[3]) / 2 + dy); if (supportsLS) ctx.letterSpacing = '0px'; placeStar(wm, dy); }
      }
      ctx.globalAlpha = 1; tick('sublbl');

      // flags & stars at centroids
      const t = now();
      for (const i of vis) {
        const m = marks[i]; if (!m) continue;
        const [sx, sy] = toScreen(HOODS[i].cx, HOODS[i].cy);
        let s = 1; if (markAnim[i]) { const p = (t - markAnim[i]) / 420; if (p < 1) { s = 1 + Math.sin(p * Math.PI) * .6 * (1 - p); anim = true; } else delete markAnim[i]; }
        ctx.save(); ctx.translate(sx, sy); ctx.scale(s, s);
        if (m === 'flag') { ctx.fillStyle = 'rgba(0,0,0,.25)'; ctx.beginPath(); ctx.ellipse(0, 0, 3, 1.5, 0, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = P.labelHalo; ctx.lineWidth = 3.4; ctx.beginPath(); ctx.moveTo(0, .5); ctx.lineTo(0, -17); ctx.stroke(); ctx.strokeStyle = P.ink; ctx.lineWidth = 1.7; ctx.stroke(); ctx.fillStyle = P.accent; ctx.strokeStyle = P.labelHalo; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(0, -17); ctx.lineTo(12, -13); ctx.lineTo(0, -9); ctx.closePath(); ctx.fill(); ctx.stroke(); }
        else { ctx.fillStyle = P.want; ctx.strokeStyle = P.paper; ctx.lineWidth = 1.2; ctx.lineJoin = 'round'; ctx.beginPath(); ctx.moveTo(-4.5, -8.5); ctx.lineTo(4.5, -8.5); ctx.lineTo(4.5, 4); ctx.lineTo(0, .5); ctx.lineTo(-4.5, 4); ctx.closePath(); ctx.fill(); ctx.stroke(); } // want to go: a bookmark (the gold star means a friend's pick)
        ctx.restore();
      }
      tick('marks');
      // landmarks
      LANDS.forEach((l, j) => {
        if (!l._box || lmA[j] <= 0.01) return; const [sx, sy] = l._s;
        ctx.globalAlpha = lmA[j];
        ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.beginPath(); ctx.ellipse(sx, sy + 1, lmH * (l.w || 1) * .42, lmH * .07, 0, 0, Math.PI * 2); ctx.fill();
        window.drawGlyph(ctx, l, sx, sy, lmH, { ink: P.ink, face: P.face, shade: P.shade, roof: P.roof, accent: P.accent, lw: lmH < 24 ? 1 : 1.25 });
      });
      ctx.globalAlpha = 1; tick('landmarks');
      // spots
      const spots = drawnSpots = o.spots ? o.spots() : [], pinFont = `500 ${isPhone() ? 10.5 : 11.5}px Figtree, system-ui, sans-serif`;
      const pinScale = clamp(k / 12, .75, 1.15);
      for (const sp of spots) {
        const [sx, sy] = toScreen(sp.x, sp.y); if (sx < -20 || sx > W + 20 || sy < -20 || sy > H + 20) { sp._s = null; continue; }
        sp._s = [sx, sy];
        const hot = sp.id === hoverSpot || sp.id === o.selectedSpot?.(); const r = (hot ? 6.5 : 5) * pinScale;
        ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2);
        if (sp.status === 'pending' && isPhone()) { ctx.beginPath(); ctx.arc(sx, sy, r * 1.5, 0, Math.PI * 2); ctx.globalAlpha = .22; ctx.fillStyle = P.accent; ctx.fill(); ctx.globalAlpha = 1; ctx.setLineDash([3, 2]); ctx.strokeStyle = P.accent; ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]); ctx.beginPath(); ctx.arc(sx, sy, r * .45, 0, Math.PI * 2); ctx.fillStyle = P.accent; ctx.fill(); } // phone: a dashed accent ring that reads in both themes
        else if (sp.status === 'pending') { ctx.fillStyle = P.paper; ctx.fill(); ctx.setLineDash([2, 1.5]); ctx.strokeStyle = P.accent; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]); }
        else { ctx.fillStyle = P.paper; ctx.fill(); ctx.strokeStyle = hot ? P.ink : 'rgba(0,0,0,.25)'; ctx.lineWidth = hot ? 1.5 : 1; ctx.stroke(); ctx.beginPath(); ctx.arc(sx, sy, r * .55, 0, Math.PI * 2); const c = cssColor(sp.c); if (sp.status === 'want') { ctx.strokeStyle = c; ctx.lineWidth = 1.6; ctx.stroke(); } else { ctx.fillStyle = c; ctx.fill(); } }
        if (k > 16 && sp.name && !quiz) { const ps = isPhone() ? 10.5 : 11.5, tw = measure(sp.name, 500, ps), box = [sx + r + 3, sy - 7, sx + r + 3 + tw + 4, sy + 7]; if (!clash(box) || hot) { placed.push(box); ctx.textAlign = 'left'; ctx.font = pinFont; haloText(sp.name, sx + r + 5, sy, ps, P.label); } }
      }
      tick('spots');
      // me
      if (me) { const [sx, sy] = toScreen(me[0], me[1]); const p = ((t - meT0) % 1800) / 1800; ctx.globalAlpha = .4 * (1 - p); ctx.fillStyle = P.want; ctx.beginPath(); ctx.arc(sx, sy, 6 + 12 * p, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(sx, sy, 5, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = P.paper; ctx.lineWidth = 2; ctx.stroke(); }
      return anim;
    }

    // ---- hit testing ----
    function hitTest(sx, sy) {
      const spots = drawnSpots; // the objects draw() positioned, not a fresh list
      for (let q = spots.length - 1; q >= 0; q--) { const sp = spots[q]; if (sp._s && Math.hypot(sp._s[0] - sx, sp._s[1] - sy) < 11 && sp.status !== 'pending') return { type: 'spot', id: sp.id, hood: sp.hood }; }
      for (let j = LANDS.length - 1; j >= 0; j--) { const b = LANDS[j]._box; if (b && lmA[j] > .5 && sx >= b[0] - 3 && sx <= b[2] + 3 && sy >= b[1] - 3 && sy <= b[3] + 3) return { type: 'landmark', landmark: LANDS[j], hood: LANDS[j].hood }; }
      const [mx, my] = toMap(sx, sy), k = kNow();
      for (let i = 0; i < HOODS.length; i++) {
        const bb = BB[i]; if (mx < bb[0] || mx > bb[2] || my < bb[1] || my > bb[3]) continue;
        if (Geom.inPolys(PP[i], mx, my)) { const px = hoodPx(i); const sub = (px > 300 || i === sel) ? subIndexAt(i, mx, my) : -1; return { type: 'hood', i, hood: HOODS[i].name, sub, x: mx, y: my }; }
      }
      return { type: 'water', x: mx, y: my };
    }

    // ---- gestures ----
    const ptrs = new Map(); let drag = null, pinch = null, lastTap = null, hoverHit = null;
    stage.addEventListener('pointerdown', e => {
      if (e.target !== canvas && e.target !== stage) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      try { stage.setPointerCapture(e.pointerId); } catch (err) {}
      ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      fly = null; if (mode === 'fly' || mode === 'smooth') Object.assign(goal, cam); mode = 'drag'; vel = { x: 0, y: 0 };
      if (ptrs.size === 1) drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t: now(), moved: 0, pinched: false };
      else if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 }; if (drag) drag.pinched = true; }
      o.onGestureStart && o.onGestureStart();
    });
    stage.addEventListener('pointermove', e => {
      if (ptrs.has(e.pointerId)) {
        ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const r = stage.getBoundingClientRect();
        if (ptrs.size >= 2 && pinch) {
          const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y), mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          if (d > 0 && pinch.d > 0) zoomAt(mx - r.left, my - r.top, pinch.d / d, true);
          panBy(mx - pinch.mx, my - pinch.my); pinch = { d, mx, my }; mode = 'drag'; kick();
        } else if (drag && ptrs.size === 1) {
          const dx = e.clientX - drag.x, dy = e.clientY - drag.y, t = now(), dt = Math.max(1, t - drag.t);
          drag.moved += Math.abs(dx) + Math.abs(dy);
          if (drag.moved > 5) { stage.classList.add('dragging'); panBy(dx, dy); const a = .35; vel.x = vel.x * (1 - a) + (dx / dt) * a; vel.y = vel.y * (1 - a) + (dy / dt) * a; if (o.onHover) o.onHover(null); kick(); }
          drag.x = e.clientX; drag.y = e.clientY; drag.t = t;
        }
        return;
      }
      if (e.pointerType !== 'touch' && o.onHover) { const r = stage.getBoundingClientRect(); const h = hitTest(e.clientX - r.left, e.clientY - r.top); o.onHover(h, e.clientX - r.left, e.clientY - r.top); }
    });
    const release = e => {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.delete(e.pointerId);
      const r = stage.getBoundingClientRect();
      if (ptrs.size === 1 && pinch) { pinch = null; const [p] = [...ptrs.values()]; drag = { x: p.x, y: p.y, x0: p.x, y0: p.y, t: now(), moved: 99, pinched: true }; mode = 'still'; kick(); return; }
      if (ptrs.size === 0) {
        stage.classList.remove('dragging'); pinch = null;
        if (drag && drag.moved <= 5 && !drag.pinched && e.type === 'pointerup') {
          const sx = e.clientX - r.left, sy = e.clientY - r.top, t = now();
          mode = 'still'; // before the callbacks: a tap may start a fly or a zoom
          if (lastTap && t - lastTap.t < 320 && Math.hypot(lastTap.x - sx, lastTap.y - sy) < 28) { lastTap = null; zoomAt(sx, sy, 1 / 1.9); }
          else { lastTap = { t, x: sx, y: sy }; if (o.onTap) o.onTap(hitTest(sx, sy), sx, sy); }
        } else if (drag && drag.moved > 5) {
          const speed = Math.hypot(vel.x, vel.y); if (speed > 0.08 && now() - drag.t < 80) { mode = 'inertia'; kick(); } else mode = 'still';
        } else mode = 'still';
        drag = null;
        o.onGestureEnd && o.onGestureEnd();
      }
    };
    stage.addEventListener('pointerup', release); stage.addEventListener('pointercancel', release);
    stage.addEventListener('pointerleave', e => { if (!ptrs.size && o.onHover) o.onHover(null); });
    stage.addEventListener('contextmenu', e => e.preventDefault());
    stage.addEventListener('wheel', e => {
      e.preventDefault(); const r = stage.getBoundingClientRect();
      let d = e.deltaY; if (e.deltaMode === 1) d *= 16; else if (e.deltaMode === 2) d *= 120; d = clamp(d, -160, 160);
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(d * (e.ctrlKey ? 0.01 : 0.0028)));
    }, { passive: false });

    // ---- resize ----
    function resize() {
      const r = stage.getBoundingClientRect(); const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
      dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      if (w === W && h === H && canvas.width === Math.round(w * dpr)) return;
      const first = W <= 1, W0 = W, H0 = H;
      W = w; H = h; canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); dirty = true;
      if (!first) { // keep scale and centre through the new box; a flight in progress is re-aimed the same way
        const refit = c => { const cx = c.x + c.w / 2, cy = c.y + c.w * H0 / W0 / 2, k0 = W0 / c.w; c.w = W / k0; c.x = cx - c.w / 2; c.y = cy - c.w * H / W / 2; return clampCam(c); };
        refit(cam); refit(goal); if (fly) { refit(fly.from); refit(fly.to); }
      }
      kick();
    }
    new ResizeObserver(resize).observe(stage);
    (function watchDpr() { try { const mq = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`); mq.addEventListener('change', () => { resize(); watchDpr(); }, { once: true }); } catch (e) {} })();
    refreshPalette(); resize();

    return {
      get cam() { return cam; }, get k() { return kNow(); }, get W() { return W; }, get H() { return H; },
      get userMoved() { return userMoved; }, set userMoved(v) { userMoved = v; },
      resize, redraw: kick, invalidate: () => { dirty = true; kick(); }, refreshPalette: () => { refreshPalette(); dirty = true; kick(); },
      fitView, toScreen, toMap, hitTest, hoodBBox: i => BB[i], regionBBox: r => REGION_BB[r] || REGION_BB.all, subs: subsOf, subIndexAt,
      landmarks: LANDS, bbox: BB,
      flyTo(bb, pad, minW, dur) { const v = fitView(bb[0], bb[1], bb[2], bb[3], pad, minW); userMoved = false; startFly(v, dur); },
      flyToView(v, dur) { userMoved = false; startFly(v, dur); },
      jumpTo(v) { Object.assign(cam, clampCam(v)); Object.assign(goal, cam); fly = null; mode = 'still'; kick(); },
      zoom(f) { zoomAt(W / 2, H / 2, f); },
      setColors(colors, animate) { colors.forEach((c, i) => { const rgb = hex2rgb(cssColor(c)); colTo[i] = rgb; if (!animate) colNow[i] = rgb.slice(); }); colAnim = !!animate; dirty = true; kick(); },
      setState(s) { if (s.region !== undefined) region = s.region; if (s.sel !== undefined) sel = s.sel; if (s.selSub !== undefined) selSub = s.selSub; if (s.quiz !== undefined) quiz = s.quiz; dirty = true; kick(); },
      setHover(i, sub, spot) { if (i === hover && sub === hoverSub && spot === hoverSpot) return; hover = i; hoverSub = sub; hoverSpot = spot; kick(); },
      pop(i) { markAnim[i] = now(); kick(); },
      setMe(xy) { me = xy; meT0 = now(); kick(); },
      subsShowing(i) { return subsOf(i) && (hoodPx(i) > 560 || i === sel); },
      hoodPx,
    };
  };
})();
