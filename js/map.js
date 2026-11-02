// The map: a Canvas 2D renderer with a camera, gestures with inertia, animated colors and labels,
// semantic zoom (neighborhood sections and landmarks appear as you get close), and hit testing.
// Everything is vector, drawn fresh each frame only while something moves, so there is never a blurry
// "settle" repaint. Geometry lives in map units (GEO.nx x GEO.ny); k = pixels per unit.
(function () {
  const G = window.GEO, Geom = window.Geom, NX = Geom.NX, NY = Geom.NY, proj = Geom.proj;
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
  const OUTLINE = Geom.pathOf(G.outline.flat().map(r => r.map(proj)));
  const REGION_BB = Object.assign({ all: [0, 0, NX, NY] }, G.regions);
  const SUB = []; // per hood: [{name, line, known, tags, rings, path, bbox, c}] computed lazily
  function subsOf(i) {
    if (SUB[i] !== undefined) return SUB[i];
    const def = SUBD[HOODS[i].name]; if (!def || def.length < 2) { SUB[i] = null; return null; }
    const seeds = def.map(s => proj([s.lon, s.lat]));
    const cells = Geom.cells(PP[i], seeds);
    SUB[i] = cells.map((c, j) => Object.assign({}, def[j], { rings: c.rings, path: Geom.pathOf(c.rings), bbox: c.bbox, c: c.c, area: c.a }));
    return SUB[i];
  }
  const subIndexAt = (i, x, y) => { const s = subsOf(i); if (!s) return -1; return s.findIndex(c => c.rings.some(r => Geom.pip(r, x, y))); };

  // ---- bridges: side views laid along their spans (precomputed, strokes sized in px at draw time) ----
  const BRIDGES = [
    { name: 'Golden Gate Bridge', pts: [[-122.4773, 37.8095], [-122.4790, 37.8335]], lbl: [-122.4905, 37.8235], kind: 'suspension', cable: [[0, 0], [.265, 1], [.735, 1], [1, 0]], h: .083, gg: true },
    { name: 'Bay Bridge', pts: [[-122.3886, 37.7870], [-122.3668, 37.8085]], lbl: [-122.3700, 37.7955], kind: 'suspension', cable: [[0, 0], [.15, 1], [.38, 1], [.5, 0], [.62, 1], [.85, 1], [1, 0]], h: .06 },
    { name: '', pts: [[-122.3590, 37.8135], [-122.3200, 37.8230]], kind: 'suspension', cable: [[.06, 0], [.3, 1], [.56, 0]], h: .075 },
    { name: 'Richmond–San Rafael Bridge', pts: [[-122.4800, 37.9405], [-122.3960, 37.9345]], lbl: [-122.4380, 37.9500], kind: 'truss', humps: [.3, .62], w: .09, h: .035 },
    { name: 'San Mateo Bridge', pts: [[-122.2560, 37.5660], [-122.1200, 37.6080]], lbl: [-122.2000, 37.6000], kind: 'truss', humps: [.12], w: .08, h: .028 },
  ].map(b => {
    const A = proj(b.pts[0]), B = proj(b.pts[1]), L = Math.hypot(B[0] - A[0], B[1] - A[1]), u = [(B[0] - A[0]) / L, (B[1] - A[1]) / L];
    let n = [-u[1], u[0]]; if (n[1] > 0.3 || (Math.abs(n[1]) <= 0.3 && n[0] > 0)) n = [-n[0], -n[1]];
    const P = (f, k) => [A[0] + u[0] * f * L + n[0] * k * L, A[1] + u[1] * f * L + n[1] * k * L];
    const path = pts => { const p = new Path2D(); pts.forEach((q, k) => k ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1])); return p; };
    const out = { gg: !!b.gg, deck: path([A, B]), towers: new Path2D(), cable: new Path2D(), hang: new Path2D(), humps: new Path2D(), lbl: b.name ? { text: b.name, p: proj(b.lbl) } : null };
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
  const WATER_LBL = [['Pacific Ocean', -122.66, 37.60], ['San Francisco Bay', -122.25, 37.63], ['San Pablo Bay', -122.40, 38.06]].map(([t, lon, lat]) => ({ t: t.toUpperCase(), p: proj([lon, lat]) }));

  // ---- palette from CSS variables ----
  const P = {};
  const VARS = { water: '--water', paper: '--paper', ink: '--ink', muted: '--muted', land: '--land', landOther: '--land-other', coast: '--coast', wlbl: '--wlbl', steel: '--steel', gg: '--gg', accent: '--accent', want: '--want', label: '--label', labelHalo: '--label-halo', subLine: '--sub-line', face: '--glyph-face', shade: '--glyph-shade', roof: '--glyph-roof', line2: '--line-2' };
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
    const lblA = HOODS.map(() => 0), subA = {}, lmA = LANDS.map(() => 0), bridgeLblA = [0], waterLblA = [0];
    const markAnim = {}; let me = null, meT0 = 0;
    const measureCache = new Map();
    // widths scale linearly with size for a given face, so measure once at 20px and scale
    function measure(text, weight, size) { const key = weight + '|' + text; let w = measureCache.get(key); if (w == null) { ctx.font = `${weight} 20px Figtree, system-ui, sans-serif`; w = ctx.measureText(text).width; measureCache.set(key, w); } return w * size / 20; }
    function haloText(text, x, y, size, color) { if (!lite) { const r = Math.max(1, size * .11); ctx.fillStyle = P.labelHalo; for (let q = 0; q < 6; q++) { const a = q * Math.PI / 3; ctx.fillText(text, x + Math.cos(a) * r, y + Math.sin(a) * r); } } ctx.fillStyle = color; ctx.fillText(text, x, y); }

    // ---- camera helpers ----
    function clampCam(c) { c.w = clamp(c.w, NX * 0.012, NX * 2.2); const h = c.w * H / W; c.x = clamp(c.x, -c.w * .55, NX - c.w * .45); c.y = clamp(c.y, -h * .55, NY - h * .45); return c; }
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
      const w = clamp(base.w * factor, NX * 0.012, NX * 2.2), k2 = W / w;
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
    function subFactor(i) { if (quiz) return 0; const px = hoodPx(i); let f = smooth(px, 300, 560); if (i === sel) f = Math.max(f, px > 150 ? 1 : 0); return subsOf(i) ? f : 0; }
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
      c.fillStyle = P.landOther; c.fill(OTHER); tick('t-other');
      c.strokeStyle = P.coast; for (const [wpx, a] of [[14, .05], [8, .08], [3, .16]]) { c.globalAlpha = a; c.lineWidth = wpx / k; c.stroke(OUTLINE); } c.globalAlpha = 1; tick('t-halo');
      const vis = [], subF = [], x1 = x + (W + 2 * mw) / k, y1 = y + (H + 2 * mh) / k;
      for (let i = 0; i < HOODS.length; i++) { const bb = BB[i]; if (bb[2] < x || bb[0] > x1 || bb[3] < y || bb[1] > y1) continue; vis.push(i); subF[i] = subFactor(i); }
      for (const i of vis) {
        const far = region !== 'all' && HOODS[i].region !== region && i !== sel;
        const a = (o.alphaFor ? o.alphaFor(i) : 1) * (far ? .32 : 1);
        c.globalAlpha = a; c.fillStyle = rgbStr(colNow[i]); c.fill(PATH[i]);
        if (subF[i] > 0.01) { const cells = subsOf(i), base = colNow[i], white = [255, 255, 255], black = [20, 30, 40]; c.globalAlpha = a * subF[i]; cells.forEach((cell, j) => { const m = j % 3; c.fillStyle = rgbStr(m === 0 ? mix(base, .09, white) : m === 1 ? base : mix(base, .07, black)); c.fill(cell.path); }); }
      }
      tick('t-fills'); c.strokeStyle = P.paper; c.lineWidth = 1 / k;
      for (const i of vis) { const far = region !== 'all' && HOODS[i].region !== region; c.globalAlpha = far ? .35 : .9; c.stroke(PATH[i]); }
      c.strokeStyle = P.subLine; c.lineWidth = .8 / k;
      for (const i of vis) if (subF[i] > 0.01) { c.globalAlpha = subF[i] * .9; subsOf(i).forEach(cell => c.stroke(cell.path)); }
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
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const s = k / cache.k, bw = tc.width / cache.cd * s, bh = tc.height / cache.cd * s;
      if (s !== 1 || cache.cd !== dpr) { ctx.fillStyle = P.water; ctx.fillRect(0, 0, W, H); }
      ctx.drawImage(tc, (cache.x - cam.x) * k, (cache.y - cam.y) * k, bw, bh);
      if (need) { const cost = now() - t0; cache.cost = cache.cost * .6 + cost * .4; } // includes the flush of the offscreen raster
      tick('terrain');
      // live strokes: hover and selection
      ctx.setTransform(k * dpr, 0, 0, k * dpr, -cam.x * k * dpr, -cam.y * k * dpr); ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      if (hover >= 0 && hover !== sel && !quiz) { ctx.strokeStyle = P.ink; ctx.lineWidth = 1.4 / k; ctx.stroke(PATH[hover]); }
      if (sel >= 0) {
        ctx.strokeStyle = P.accent; ctx.lineWidth = 2.2 / k; ctx.stroke(PATH[sel]);
        if (selSub >= 0 && subsOf(sel)) { ctx.lineWidth = 1.8 / k; ctx.stroke(subsOf(sel)[selSub].path); }
        if (hoverSub >= 0 && hoverSub !== selSub && hover === sel && subsOf(sel)) { ctx.strokeStyle = P.ink; ctx.lineWidth = 1.2 / k; ctx.stroke(subsOf(sel)[hoverSub].path); }
      }
      const vis = [], subF = [];
      for (let i = 0; i < HOODS.length; i++) { if (!visible(BB[i], k, 40)) { subF[i] = 0; continue; } vis.push(i); subF[i] = subFactor(i); }
      tick('live');
      // ---- screen space ----
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.textBaseline = 'middle';
      // water & bridge names
      anim = fade(waterLblA, 0, k < 5.5 && !quiz ? 1 : 0, dt) || anim;
      if (waterLblA[0] > 0.01) { ctx.globalAlpha = waterLblA[0]; ctx.fillStyle = P.wlbl; ctx.textAlign = 'center'; const fs = isPhone() ? 9.5 : 10.5; ctx.font = `500 ${fs}px Figtree, system-ui, sans-serif`; if (supportsLS) ctx.letterSpacing = '0.3em'; for (const wl of WATER_LBL) { const [sx, sy] = toScreen(wl.p[0], wl.p[1]); if (sx > -200 && sx < W + 200 && sy > -40 && sy < H + 40) ctx.fillText(wl.t, sx, sy); } if (supportsLS) ctx.letterSpacing = '0px'; ctx.globalAlpha = 1; }
      anim = fade(bridgeLblA, 0, k > 3.2 && k < 40 && !quiz ? 1 : 0, dt) || anim;
      if (bridgeLblA[0] > 0.01) { ctx.globalAlpha = bridgeLblA[0]; ctx.textAlign = 'center'; ctx.font = `500 ${isPhone() ? 9.5 : 10.5}px Figtree, system-ui, sans-serif`; for (const b of BRIDGES) if (b.lbl) { const [sx, sy] = toScreen(b.lbl.p[0], b.lbl.p[1]); if (sx > -100 && sx < W + 100 && sy > -20 && sy < H + 20) { ctx.fillStyle = P.water; for (let q = 0; q < 6; q++) { const a = q * Math.PI / 3; ctx.fillText(b.lbl.text, sx + Math.cos(a) * 1.2, sy + Math.sin(a) * 1.2); } ctx.fillStyle = P.muted; ctx.fillText(b.lbl.text, sx, sy); } } ctx.globalAlpha = 1; }

      tick('waterlbl');
      // labels: hoods first (priority order, no overlaps), then sections, then spot names
      const placed = [];
      const clash = b => placed.some(q => b[0] < q[2] && b[2] > q[0] && b[1] < q[3] && b[3] > q[1]);
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
      const base = Math.round((isPhone() ? 10.5 : 11.5) * clamp(Math.pow(NX / cam.w, 0.22), 1, 1.32) * 4) / 4;
      const marks = o.marks ? o.marks() : [];
      const prio = i => (i === sel ? 1e9 : 0) + (i === hover ? 5e8 : 0) + (marks[i] ? 1e7 : 0) + HOODS[i].cells;
      const order = vis.slice().sort((a, b) => prio(b) - prio(a));
      const labelFont = s => `600 ${s.toFixed(1)}px Figtree, system-ui, sans-serif`;
      const show = [];
      for (const i of order) {
        const h = HOODS[i], far = region !== 'all' && h.region !== region && i !== sel && i !== hover;
        let target = 0, box = null, size = base, ghost = false;
        if (!quiz && !far) {
          const hot = i === sel || i === hover, text = (window.SHORT[h.name] || h.name).toUpperCase();
          ghost = subF[i] > 0.6 && !hot;
          size = ghost ? base * 1.55 : hot ? base * 1.15 : base;
          const tw = measure(text, 600, size) + text.length * size * (ghost ? .14 : .05), th = size * 1.2;
          const [cx, cy0] = toScreen(h.cx, h.cy); const cy = cy0 + (marks[i] && !ghost ? size * 1.25 : 0);
          const at = y => [cx - tw / 2 - 2, y - th / 2, cx + tw / 2 + 2, y + th / 2];
          box = at(cy);
          const fits = (BB[i][2] - BB[i][0]) * k >= tw * .72 && (BB[i][3] - BB[i][1]) * k >= th;
          const keep = hot || marks[i] || h.cells < 10;
          if (!ghost && (fits || keep) && clash(box)) { for (const dy of [th * 1.15, -th * 1.15, th * 2.2]) { const alt = at(cy + dy); if (!clash(alt)) { box = alt; break; } } }
          target = ghost ? (fits ? .32 : 0) : (hot || ((fits || keep) && !clash(box))) ? 1 : 0;
          if (target && !ghost) placed.push(box);
        }
        anim = fade(lblA, i, target, dt, 160) || anim;
        if (lblA[i] > 0.01 && box) show.push({ i, box, size, ghost, hot: i === sel || i === hover });
      }
      for (const s of show) {
        const h = HOODS[s.i], text = (window.SHORT[h.name] || h.name).toUpperCase(), cx = (s.box[0] + s.box[2]) / 2, cy = (s.box[1] + s.box[3]) / 2;
        ctx.globalAlpha = lblA[s.i]; ctx.textAlign = 'center'; ctx.font = labelFont(s.size);
        if (supportsLS) ctx.letterSpacing = s.ghost ? '0.14em' : '0.05em';
        if (s.ghost) { ctx.fillStyle = P.label; ctx.fillText(text, cx, cy); } else haloText(text, cx, cy, s.size, s.hot ? P.accent : P.label);
      }
      if (supportsLS) ctx.letterSpacing = '0px';
      ctx.globalAlpha = 1; tick('hoodlbl');
      // section labels
      const subSize = isPhone() ? 10.5 : 11.5, subFont = `500 ${subSize}px Figtree, system-ui, sans-serif`;
      for (const i of vis) {
        const cells = subsOf(i); if (!cells) continue;
        cells.forEach((c, j) => {
          const key = i + ':' + j; let target = 0, box = null;
          if (subF[i] > 0.01) {
            const tw = measure(c.name, 500, subSize), th = subSize * 1.2, [cx, cy] = toScreen(c.c[0], c.c[1]);
            box = [cx - tw / 2 - 2, cy - th / 2, cx + tw / 2 + 2, cy + th / 2];
            const fits = (c.bbox[2] - c.bbox[0]) * k >= tw * .8 && (c.bbox[3] - c.bbox[1]) * k >= th * 1.1;
            const hot = i === sel && j === selSub;
            if ((fits || hot) && !clash(box)) { target = subF[i]; placed.push(box); }
          }
          anim = fade(subA, key, target, dt, 160) || anim;
          if (subA[key] > 0.01 && box) {
            ctx.globalAlpha = subA[key]; ctx.textAlign = 'center'; ctx.font = subFont;
            haloText(c.name, (box[0] + box[2]) / 2, (box[1] + box[3]) / 2, subSize, (i === sel && j === selSub) ? P.accent : P.label);
          }
        });
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
        else { ctx.fillStyle = P.want; ctx.strokeStyle = P.paper; ctx.lineWidth = 1.2; ctx.beginPath(); for (let q = 0; q < 10; q++) { const r = q % 2 ? 3.4 : 7.5, a = -Math.PI / 2 + q * Math.PI / 5; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); } ctx.closePath(); ctx.fill(); ctx.stroke(); }
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
      const spots = o.spots ? o.spots() : [], pinFont = `500 ${isPhone() ? 10.5 : 11.5}px Figtree, system-ui, sans-serif`;
      const pinScale = clamp(k / 12, .75, 1.15);
      for (const sp of spots) {
        const [sx, sy] = toScreen(sp.x, sp.y); if (sx < -20 || sx > W + 20 || sy < -20 || sy > H + 20) { sp._s = null; continue; }
        sp._s = [sx, sy];
        const hot = sp.id === hoverSpot || sp.id === o.selectedSpot?.(); const r = (hot ? 6.5 : 5) * pinScale;
        ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2);
        if (sp.status === 'pending') { ctx.fillStyle = P.paper; ctx.fill(); ctx.setLineDash([2, 1.5]); ctx.strokeStyle = P.accent; ctx.lineWidth = 1.5; ctx.stroke(); ctx.setLineDash([]); }
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
      const spots = o.spots ? o.spots() : [];
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
      const cx = cam.x + cam.w / 2, cy = cam.y + cam.w * H / W / 2, kOld = W / cam.w;
      W = w; H = h; canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); dirty = true;
      if (kOld && isFinite(kOld) && W > 1) { cam.w = W / kOld; cam.x = cx - cam.w / 2; cam.y = cy - cam.w * H / W / 2; clampCam(cam); Object.assign(goal, cam); }
      kick();
    }
    new ResizeObserver(resize).observe(stage);
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
