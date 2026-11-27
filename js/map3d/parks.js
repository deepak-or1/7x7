// Seven by Seven, the 3D map: the parks. Loaded by js/map3d.js itself after the first 3D frame (with js/map3d/parkdata.js, from
// OpenStreetMap), never in the page's own chain: the first frame does not wait for it.
// Every park, reserve, garden, golf course, cemetery and recreation ground of the data is its real outline at its real place:
// - the park ground: the outlines painted into a few textures (San Francisco fine, the near bay, the whole bay, the Strip), which
//   the land's own materials read in their shader (js/map3d.js, pkU): a green laid on the real ground of every block and of
//   the quiet land between them, so it follows the relief exactly, stops at the shore (the water is not land), costs no triangles
//   and reads the same from every distance (calm areas from afar, the real edge close in, softened by the texture's own filtering);
// - the question the building generators ask (inPark): is a point in a park, so no made-up house stands in one;
// - the trees: chosen by kind (dense groves in reserves and woods, clumps and a ring along the edges in a city park, a few on a
//   golf course, rows in a cemetery), by square of the map (a chunk) as the camera comes near, a few milliseconds at a time, all
//   drawn as one instanced mesh that rises and sinks with the city fabric (its uniforms: js/map3d/fabric.js).
// Two halves, as the fabric has. make(data, env) unpacks and answers (plain numbers, no THREE); gl(THREE, U) draws.
// World frame: x = map x, z = map y (south), y = up; one unit is one map unit, about 143 m. Defines window.M3D.parks.
(function () {
  'use strict';
  const M3D = window.M3D, land = M3D && M3D.land; if (!land) return;
  const Geom = window.Geom, K = 1 / land.UNIT_M;
  const CS = 6;                                   // the side of a chunk of trees, in map units
  const CELL = 2;                                 // the grid that answers "is this point in a park"
  const NT = 8;                                   // numbers per tree: x, y, z, radius, height over radius, place, tint, kind
  const LAKES = { 'Lakeside Park': 85 };          // a park whose outline holds its lake (and neither the map nor the data has the water): the lake drawn inside it, the park this many metres wide round it (Lake Merritt: approximate)
  const HUGE = 2000;                              // a reserve this large (hectares): its outline is coarse (simplified to about 300 m). It is drawn green all over, and clears houses and has its trees only on the land it holds
                                                  // that is no town of its own: on the quiet land between places, and on a place whose middle lies outside it (the edge of Sausalito by US 101 that the Golden Gate
                                                  // reserve's outline takes in); a place whose middle lies inside it (Bolinas and Inverness in Point Reyes, the Marin Headlands) keeps its own (town)
  // the textures: [name, west, south, east, north (degrees), width, height in pixels]; the first that holds a point is read there
  const BOXES = [['sf', -122.530, 37.700, -122.350, 37.836, 1536, 1536], ['vegas', -115.215, 36.040, -115.090, 36.190, 512, 768], ['near', -122.580, 37.660, -122.080, 38.000, 1024, 1024], ['bay', null, null, null, null, 768, 1024]];
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v)), lerp = (a, b, t) => a + (b - a) * t;
  const mix32 = (a, b, c) => { let h = (a ^ Math.imul(b | 0, 0x9E3779B1) ^ Math.imul(c | 0, 0x85EBCA77)) >>> 0; h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D); h ^= h >>> 12; h = Math.imul(h, 0x297A2D39); h ^= h >>> 15; return h >>> 0; };
  function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const lat = (i, j, s) => mix32(s, i, j) / 4294967296;
  function noise(x, y, s) { const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy); return lerp(lerp(lat(i, j, s), lat(i + 1, j, s), u), lerp(lat(i, j + 1, s), lat(i + 1, j + 1, s), u), v); }
  // the groves: where the woods of a park stand (two octaves of noise, 0 to 1), the same for the ground's deeper green and the trees
  const grove = (x, z, s) => noise(x * 0.42, z * 0.42, s) * 0.68 + noise(x * 1.3, z * 1.3, s + 11) * 0.32;
  const pip = (p, n, x, z) => { let c = false; for (let i = 0, j = n - 1; i < n; j = i++) { const xi = p[i * 2], zi = p[i * 2 + 1], xj = p[j * 2], zj = p[j * 2 + 1]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
  // the same two answers for a park (P: { p, n, z0, z1 }) from only the edges that can matter: its edges filed by bands of z once (bands, the first time it is asked, for one of 25 points or more), so a
  // point's test reads the edges of its own band (inP) and a distance up to R those of the bands within R (nearD2: the least squared distance to
  // those edges, or Infinity; compared with R * R it answers as edgeD2 does)
  function bands(P) { const n = P.n, nb = Math.min(64, Math.ceil(n / 8)), h = (P.z1 - P.z0) / nb || 1, B = Array.from({ length: nb }, () => []), bk = z => Math.min(nb - 1, Math.max(0, Math.floor((z - P.z0) / h)));
    for (let i = 0, j = n - 1; i < n; j = i++) { const a = P.p[i * 2 + 1], b = P.p[j * 2 + 1]; for (let k = bk(Math.min(a, b)); k <= bk(Math.max(a, b)); k++) B[k].push(i); }
    P.bd = { B: B.map(l => Int32Array.from(l)), bk }; }
  function inP(P, x, z) { if (!P.bd) { if (P.n < 25) return pip(P.p, P.n, x, z); bands(P); } const p = P.p, n = P.n, l = P.bd.B[P.bd.bk(z)]; let c = false;
    for (let q = 0; q < l.length; q++) { const i = l[q], j = i ? i - 1 : n - 1, xi = p[i * 2], zi = p[i * 2 + 1], xj = p[j * 2], zj = p[j * 2 + 1]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; }
  function nearD2(P, x, z, R) { if (!P.bd) { if (P.n < 25) return edgeD2(P.p, P.n, x, z); bands(P); } const p = P.p, n = P.n, k0 = P.bd.bk(z - Math.abs(R)), k1 = P.bd.bk(z + Math.abs(R)); let m = Infinity;
    for (let k = k0; k <= k1; k++) { const l = P.bd.B[k]; for (let q = 0; q < l.length; q++) { const i = l[q], j = i ? i - 1 : n - 1, ax = p[j * 2], az = p[j * 2 + 1], dx = p[i * 2] - ax, dz = p[i * 2 + 1] - az, l2 = dx * dx + dz * dz; let t = l2 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t; const ex = ax + dx * t - x, ez = az + dz * t - z, d = ex * ex + ez * ez; if (d < m) m = d; } } return m; }
  const edgeD2 = (p, n, x, z) => { let m = Infinity; for (let i = 0, j = n - 1; i < n; j = i++) { const ax = p[j * 2], az = p[j * 2 + 1], dx = p[i * 2] - ax, dz = p[i * 2 + 1] - az, l2 = dx * dx + dz * dz; let t = l2 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t; const ex = ax + dx * t - x, ez = az + dz * t - z, d = ex * ex + ez * ez; if (d < m) m = d; } return m; };

  // one area of js/map3d/parkdata.js (its header gives the format), read a few milliseconds at a time: read(ms) adds shapes
  // { kind, name, ha, p: [x, z, ...] in map units, n } to out and says when the area is done; a shape that cannot be read ends the
  // area there (the shapes before it stand)
  function unpack(area, names, out) {
    if (!area || typeof area.data !== 'string' || !Array.isArray(area.origin)) throw new Error('a park area is not whole');
    let s = null, n = 0, i = 0, px = 0, py = 0, done = false; const o = area.origin, kx = 1 / (111320 * Math.cos(o[1] * Math.PI / 180)), t0 = out.length;   // (s: the bytes, decoded in the first read)
    const uv = () => { let v = 0, m = 1, b; do { if (i >= n) throw new Error('the park data is cut short'); b = s[i++]; v += (b & 127) * m; m *= 128; } while (b & 128); return v; };
    const sv = () => { const u = uv(); return u & 1 ? -(u + 1) / 2 : u / 2; };
    return ms => { if (done) return true; const t1 = performance.now();
    try {
      if (!s) { const bin = atob(area.data); n = bin.length; s = new Uint8Array(n); for (let k = 0; k < n; k++) s[k] = bin.charCodeAt(k); }
      while (i < n && performance.now() - t1 < ms) {
        const kind = uv(), name = names[uv()] || '', ha = uv() / 10, np = uv(); if (!(np >= 3 && np <= 5000) || kind > 5) throw new Error('a park shape is not whole');
        const p = new Float32Array(np * 2); let x = px + sv(), y = py + sv(); px = x; py = y;
        for (let k = 0; k < np; k++) { if (k) { x += sv(); y += sv(); } if (!(Math.abs(x) < 1e6 && Math.abs(y) < 1e6)) throw new Error('a park shape lies off the map'); const q = Geom.proj([o[0] + x * kx, o[1] + y / 111320]); p[k * 2] = q[0]; p[k * 2 + 1] = q[1]; }
        out.push({ kind, name, ha, p, n: np, area: area.name });
      }
    } catch (e) { console.warn('3D map, the parks of ' + area.name + ' after ' + (out.length - t0) + ' shapes left out: ' + (e && e.message || e)); i = n; }
    return (done = i >= n); };
  }

  // env: { HOODS, hoodAt(x, z): the place whose block stands there or -1, inTop(i, x, z), hAt(i, x, z), landAt(x, z): the quiet
  //   land is there (not water), landY(x): its height there, solid(x, z, r): a real building stands there (optional), road(x, z, r)
  //   (optional), avoid: [[x, z, r], ...] (the landmarks) }
  // make returns { prep(ms) }: call it until it answers true (every area read, a few milliseconds a call), then the rest is there
  function make(data, env) {
    if (!data || !Array.isArray(data.areas) || !Array.isArray(data.names)) throw new Error('the park data is not there');
    const parks = [], readers = data.areas.map(a => unpack(a, data.names, parks)), out = { prep(ms) { const t0 = performance.now(); if (readers.length) { while (readers.length) { if (!readers[0](Math.max(0.5, ms - (performance.now() - t0)))) return false; readers.shift(); } return false; } finish(); out.prep = () => true; return true; } };   // (the last read and the sorting in turns of their own)
    return out;
    function finish() {
    if (!parks.length) throw new Error('no park could be read');
    // each park's box, its seed, its kind of trees; the largest first (a smaller one painted over a larger is the one that holds there); one whose box is wider than
    // about 400 units (57 km: no park is) left out, a corrupt shape
    parks.forEach((p, k) => { let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (let q = 0; q < p.n; q++) { const x = p.p[q * 2], z = p.p[q * 2 + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; } Object.assign(p, { x0, z0, x1, z1, seed: mix32(k, p.n, Math.round(p.ha * 10)), huge: p.kind === 1 && p.ha >= HUGE, lake: p.area === 'bay' && LAKES[p.name] ? LAKES[p.name] * K : 0 }); });
    for (let k = parks.length - 1; k >= 0; k--) { const p = parks[k]; if (!(p.x1 - p.x0 < 400 && p.z1 - p.z0 < 400)) { console.warn('3D map, a park shape left out: ' + p.name); parks.splice(k, 1); } }
    parks.sort((a, b) => b.ha - a.ha); parks.forEach((p, k) => { p.id = k; });
    // two grids: the parks up to 16 units across on cells of CELL, the larger ones (the reserves of the bay) on cells of 16
    const grid = new Map(), wide = new Map(), gk = (i, j) => i * 8192 + j;
    for (const p of parks) { const big = Math.max(p.x1 - p.x0, p.z1 - p.z0) > 16, C = big ? 16 : CELL, G = big ? wide : grid; for (let i = Math.floor(p.x0 / C); i <= Math.floor(p.x1 / C); i++) for (let j = Math.floor(p.z0 / C); j <= Math.floor(p.z1 / C); j++) { const k = gk(i, j); let l = G.get(k); if (!l) G.set(k, l = []); l.push(p); } }
    for (const G of [grid, wide]) for (const l of G.values()) l.reverse();   // the smallest first
    const near = (x, z) => [grid.get(gk(Math.floor(x / CELL), Math.floor(z / CELL))), wide.get(gk(Math.floor(x / 16), Math.floor(z / 16)))];   // the parks that may hold a point (the smaller ones first)
    // the park at a point (the smallest that holds it), or null. all: also the huge reserves
    // (a huge reserve p at a point of place i: is the place a town of its own inside it, its middle inside the outline; kept per reserve and place)
    const towns = new Map(), H = env.HOODS || [], town = (p, i) => { if (!(i >= 0) || !H[i]) return true; const k = p.id * 8192 + i; let v = towns.get(k); if (v === undefined) towns.set(k, v = inP(p, H[i].cx, H[i].cy)); return v; };
    const reserve = (p, x, z) => { const i = env.hoodAt ? env.hoodAt(x, z) : -1; return i >= 0 && !town(p, i); };
    function at(x, z, all) { for (const l of near(x, z)) if (l) for (const p of l) { if ((p.huge && !all) || x < p.x0 || x > p.x1 || z < p.z0 || z > p.z1) continue; if (inP(p, x, z)) return p; } return null; }
    // the generators' question: is the circle r round (x, z) in a park (its middle inside, or within r of the inside)
    function inPark(x, z, r) {
      if (at(x, z)) return true;
      for (const l of near(x, z)) if (l) for (const p of l) { if (!p.huge || x + r < p.x0 || x - r > p.x1 || z + r < p.z0 || z - r > p.z1) continue; if ((inP(p, x, z) || (r > 0 && nearD2(p, x, z, r) < r * r)) && reserve(p, x, z)) return true; }   // (a huge reserve: on its land that is no town, town)
      if (!(r > 0)) return false;
      for (const l of near(x, z)) if (l) for (const p of l) { if (p.huge || x + r < p.x0 || x - r > p.x1 || z + r < p.z0 || z - r > p.z1) continue; if (nearD2(p, x, z, r) < r * r) return true; } return false;
    }
    const chunks = new Set(); for (const p of parks) { if (p.huge && !env.landAt) continue; for (let i = Math.floor(p.x0 / CS); i <= Math.floor(p.x1 / CS); i++) for (let j = Math.floor(p.z0 / CS); j <= Math.floor(p.z1 / CS); j++) chunks.add(i * 65536 + j); }

    // ---- the ground: the textures (canvas, box in map units); a pixel's red is park and lawn, green the deeper green of reserves and
    // of the woods inside a park, blue the paler greens of golf and of gardens; a cemetery is green and blue (its grey green) ----
    const COL = [[1, 0, 0], [0, 1, 0], [0.45, 0, 0.55], [0, 0, 1], [0, 0.5, 0.5], [0.8, 0, 0.2]];  // by kind: park, reserve, garden, golf, cemetery, recreation
    function boxes() {
      const out = [];
      for (const [name, w, s, e, n, pw, ph] of BOXES) {
        let x0, z0, x1, z1;
        if (w == null) { x0 = Infinity; z0 = Infinity; x1 = -Infinity; z1 = -Infinity; for (const p of parks) if (p.area === 'bay') { x0 = Math.min(x0, p.x0); z0 = Math.min(z0, p.z0); x1 = Math.max(x1, p.x1); z1 = Math.max(z1, p.z1); } if (!(x1 > x0)) continue; }
        else { const a = Geom.proj([w, n]), b = Geom.proj([e, s]); x0 = a[0]; z0 = a[1]; x1 = b[0]; z1 = b[1]; }
        out.push({ name, box: [x0, z0, x1, z1], w: env.lean ? Math.min(pw, 1024) : pw, h: env.lean ? Math.min(ph, 1024) : ph });   // (lean: a touch screen's, San Francisco's 1024 square, not 1536)
      }
      return out;
    }
    // paint one texture, a few milliseconds a call: paint(b, canvas) returns step(ms), true once every park that reaches into it is
    // painted (the largest first; the woods of the big city parks as soft deeper patches)
    function paint(b, canvas) {
      const c = canvas.getContext('2d'), [x0, z0, x1, z1] = b.box, sx = b.w / (x1 - x0), sz = b.h / (z1 - z0);
      canvas.width = b.w; canvas.height = b.h; c.setTransform(1, 0, 0, 1, 0, 0); c.fillStyle = '#000'; c.fillRect(0, 0, b.w, b.h); c.setTransform(sx, 0, 0, sz, -x0 * sx, -z0 * sz);
      const px = 1 / sx;   // a pixel in map units
      // the woods: in a park or a garden of the city (from 3 hectares), where the trees stand thick (grove, as the trees use it), the ground
      // is the deeper green: worked out in plain numbers on a grid of half the texture's resolution, then laid over the parks in one draw
      const ww = b.w >> 1, wh = b.h >> 1, wk = ww / (x1 - x0), wd = px < 0.2 ? new Uint8ClampedArray(ww * wh * 4) : null;
      const job = (function* () { // (a park a step; a park's woods a row of them a step)
        for (const p of parks) {
          if (p.x1 < x0 || p.x0 > x1 || p.z1 < z0 || p.z0 > z1 || (p.x1 - p.x0) < px * 0.6 && (p.z1 - p.z0) < px * 0.6) continue;
          const k = COL[p.kind] || COL[0]; c.fillStyle = `rgb(${k[0] * 255 | 0},${k[1] * 255 | 0},${k[2] * 255 | 0})`; c.beginPath();
          for (let q = 0; q < p.n; q++) { if (q) c.lineTo(p.p[q * 2], p.p[q * 2 + 1]); else c.moveTo(p.p[0], p.p[1]); } c.closePath(); c.fill();
          if (p.lake) { c.save(); c.clip(); c.fillStyle = '#fff'; c.fill(); c.strokeStyle = c.fillStyle = `rgb(${k[0] * 255 | 0},${k[1] * 255 | 0},${k[2] * 255 | 0})`; c.lineWidth = p.lake * 2; c.lineJoin = 'round'; c.stroke(); c.restore(); }   // the lake: the shape in water, its rim in park
          else if (wd && (p.kind === 0 || p.kind === 2) && p.ha >= 3) { const cut = woodCut(p), i0 = Math.max(0, Math.floor((p.x0 - x0) * wk)), i1 = Math.min(ww - 1, Math.ceil((p.x1 - x0) * wk)), j0 = Math.max(0, Math.floor((p.z0 - z0) * wk)), j1 = Math.min(wh - 1, Math.ceil((p.z1 - z0) * wk));
            for (let j = j0; j <= j1; j++) { const z = z0 + (j + 0.5) / wk; for (let i = i0; i <= i1; i++) { const x = x0 + (i + 0.5) / wk, g = grove(x, z, p.seed); if (g < cut || !inP(p, x, z) || at(x, z, true) !== p) continue; const q = (j * ww + i) * 4; wd[q + 1] = Math.max(wd[q + 1], clamp((g - cut) / 0.12, 0, 1) * 140); wd[q + 3] = 255; } yield; } }
          yield;
        }
        if (wd) { const wc = document.createElement('canvas'); wc.width = ww; wc.height = wh; wc.getContext('2d').putImageData(new ImageData(wd, ww, wh), 0, 0); yield;
          const ky = b.h / wh; for (let y0 = 0; y0 < wh; y0 += 64) { const y1 = Math.min(wh, y0 + 64), s0 = Math.max(0, y0 - 1), s1 = Math.min(wh, y1 + 1);   // (a band of rows a step, drawn from a row more each side, clipped to the band: the same soft edges as one draw)
            c.save(); c.setTransform(1, 0, 0, 1, 0, 0); c.beginPath(); c.rect(0, y0 * ky, b.w, (y1 - y0) * ky); c.clip(); c.globalCompositeOperation = 'lighter'; c.imageSmoothingEnabled = true; c.drawImage(wc, 0, s0, ww, s1 - s0, 0, s0 * ky, b.w, (s1 - s0) * ky); c.restore(); yield; } }
      })();
      return ms => { const t0 = performance.now(); while (performance.now() - t0 < ms) if (job.next().done) return true; return false; };
    }
    // how much of a park is woods: GG Park and the Presidio are mostly trees; a square in town is lawn under a few
    const woodCut = p => p.kind === 1 ? 0.3 : p.ha >= 100 ? 0.38 : p.ha >= 20 ? 0.5 : p.ha >= 5 ? 0.6 : 0.72;

    // ---- the trees of a chunk: [x, y, z, r, h/r, place, tint, kind] each ----
    // sizes in metres, as the real trees: a city tree's crown 8 to 14 m across; a grove of them, one shape, 30 to 60 m; heights about
    // twice the crown's radius (the buildings' heights are drawn HX times, js/map3d/land.js: a tree is not, so it does not read as a pole)
    const M = K;   // metres to map units
    const av = env.avoid || [];
    function stand(x, z) { // the ground under a tree and the place it stands on (-1: the quiet land), or null where nothing may stand
      const i = env.hoodAt(x, z);
      if (i >= 0) { if (!env.inTop(i, x, z)) return null; return [env.hAt(i, x, z), i]; }
      if (env.landAt && env.landAt(x, z)) return [env.landY(x, z), -1];
      return null;
    }
    let avc = av; const clear = (x, z, r) => { if (env.solid && env.solid(x, z, r * 0.6)) return false; if (env.road && env.road(x, z, r * 0.8 + 0.03)) return false; for (const a of avc) { const dx = x - a[0], dz = z - a[1], rr = a[2] + r * 0.5; if (dx * dx + dz * dz < rr * rr) return false; } return true; };
    // (a generator: it gives the turn back after each park and every 64 steps of its loops, js/map3d.js pkPump; its value at the end is the chunk)
    function* chunk(ix, iz) {
      const x0 = ix * CS, z0 = iz * CS, x1 = x0 + CS, z1 = z0 + CS, T = []; let tested = 0, w = 0;
      const own = (x, z) => x >= x0 && x < x1 && z >= z0 && z < z1; avc = av.filter(a => a[0] + a[2] + 1 > x0 && a[0] - a[2] - 1 < x1 && a[1] + a[2] + 1 > z0 && a[1] - a[2] - 1 < z1);   // (the landmarks that can reach into this chunk)
      const put = (p, x, z, rm, hk, tint) => { // a tree of crown radius rm metres in park p, if it may stand there: in p, on land, clear of what is built
        const r = rm * M; tested++; if (!own(x, z) || !inP(p, x, z) || (p.lake && nearD2(p, x, z, p.lake - r) > (p.lake - r) * (p.lake - r))) return false; const inner = at(x, z, true); if (inner && inner !== p && inner.ha < p.ha) return false;   // (a smaller park inside this one plants its own)
        if (!clear(x, z, r)) return false; const g = stand(x, z); if (!g || (p.huge && g[1] >= 0 && town(p, g[1]))) return false;
        if (env.over && g[0] + r * hk > env.over(x, z, r)) return false;   // (under a raised deck: none taller than its underside)
        T.push(x, g[0], z, r, hk, g[1], tint, p.kind); return true;
      };
      const l = new Set(); for (const [G, C] of [[grid, CELL], [wide, 16]]) for (let i = Math.floor(x0 / C); i <= Math.floor((x1 - 1e-6) / C); i++) for (let j = Math.floor(z0 / C); j <= Math.floor((z1 - 1e-6) / C); j++) for (const p of G.get(gk(i, j)) || []) l.add(p);
      for (const p of l) {
        if (p.x1 < x0 || p.x0 > x1 || p.z1 < z0 || p.z0 > z1) continue; yield; w = 0;   // (a park a step)
        const k = p.kind, s = p.seed, cut = woodCut(p);
        if (k === 3) { // golf: a few trees along the roughs, in short lines (the noise's ridges), the fairways clear
          const st = 0.17; for (let gx = Math.floor(Math.max(x0, p.x0) / st); gx * st < Math.min(x1, p.x1); gx++) for (let gz = Math.floor(Math.max(z0, p.z0) / st); gz * st < Math.min(z1, p.z1); gz++) {
            if (++w > 63) { w = 0; yield; } const R = rng(mix32(s, gx, gz)), x = (gx + 0.2 + R() * 0.6) * st, z = (gz + 0.2 + R() * 0.6) * st, g = noise(x * 2.2, z * 2.2, s); if (Math.abs(g - 0.5) > 0.045 || R() > 0.55) continue; put(p, x, z, 5 + R() * 3, 2 + R() * 0.6, R()); }
          continue;
        }
        if (k === 4) { // a cemetery: rows of small dark trees along its paths
          const st = 0.1; for (let gx = Math.floor(Math.max(x0, p.x0) / st); gx * st < Math.min(x1, p.x1); gx++) for (let gz = Math.floor(Math.max(z0, p.z0) / (st * 3)); gz * st * 3 < Math.min(z1, p.z1); gz++) {
            if (++w > 63) { w = 0; yield; } const R = rng(mix32(s, gx, gz)); if (R() > 0.45) continue; put(p, (gx + 0.5) * st, (gz + 0.5) * st * 3, 3.5 + R() * 1.5, 2.6 + R(), 0.15 + R() * 0.2); }
          continue;
        }
        // the woods: groves where the noise is high (one shape a grove, a reserve's further apart and larger), single trees at their rims
        const big = k === 1 || p.ha >= 20, gs = k === 1 ? 0.5 : big ? 0.36 : 0.28;
        for (let gx = Math.floor(Math.max(x0, p.x0) / gs); gx * gs < Math.min(x1, p.x1); gx++) for (let gz = Math.floor(Math.max(z0, p.z0) / gs); gz * gs < Math.min(z1, p.z1); gz++) {
          if (++w > 63) { w = 0; yield; } const R = rng(mix32(s ^ 0x5bd1, gx, gz)), x = (gx + 0.15 + R() * 0.7) * gs, z = (gz + 0.15 + R() * 0.7) * gs, g = grove(x, z, s); if (g < cut) continue;
          const t = clamp((g - cut) / 0.16, 0, 1);
          if (k === 1) put(p, x, z, 24 + 14 * t + R() * 8, 1.15 + R() * 0.4, 0.5 + R() * 0.5);
          else if (t > 0.3 && big) put(p, x, z, 15 + 9 * t + R() * 6, 1.3 + R() * 0.5, 0.4 + R() * 0.6);
          else put(p, x, z, 7 + R() * 4, 1.7 + R() * 0.6, R());
        }
        // single trees: along the edge, a ring of them a little inside (gaps where the noise says), and a few over the lawns
        if (k !== 1 || p.ha < 60) {
          const st = 0.13, ins = 0.06;
          for (let q = 0, j = p.n - 1; q < p.n; j = q++) {
            if (++w > 63) { w = 0; yield; } const ax = p.p[j * 2], az = p.p[j * 2 + 1], bx = p.p[q * 2], bz = p.p[q * 2 + 1], dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz); if (L < 1e-6) continue;
            if (Math.max(ax, bx) < x0 - 0.2 || Math.min(ax, bx) > x1 + 0.2 || Math.max(az, bz) < z0 - 0.2 || Math.min(az, bz) > z1 + 0.2) continue;
            const nx = -dz / L, nz = dx / L, m = Math.max(1, Math.round(L / st));
            for (let e = 0; e < m; e++) { if (++w > 63) { w = 0; yield; } const f = (e + 0.5) / m, x = ax + dx * f, z = az + dz * f; if (!own(x, z)) continue; const R = rng(mix32(s ^ 0x77, Math.round(x * 50), Math.round(z * 50))); if (noise(x * 1.6, z * 1.6, s + 5) < 0.38) continue;
              const d = ins * (0.7 + R() * 0.6); if (!put(p, x + nx * d, z + nz * d, 5.5 + R() * 3.5, 1.8 + R() * 0.6, R())) put(p, x - nx * d, z - nz * d, 5.5 + R() * 3.5, 1.8 + R() * 0.6, R()); }
          }
          const ls = 0.24; for (let gx = Math.floor(Math.max(x0, p.x0) / ls); gx * ls < Math.min(x1, p.x1); gx++) for (let gz = Math.floor(Math.max(z0, p.z0) / ls); gz * ls < Math.min(z1, p.z1); gz++) {
            if (++w > 63) { w = 0; yield; } const R = rng(mix32(s ^ 0x1234, gx, gz)); if (R() > (p.ha >= 20 ? 0.05 : 0.16)) continue; const x = (gx + R()) * ls, z = (gz + R()) * ls; if (grove(x, z, s) >= cut) continue; put(p, x, z, 6 + R() * 3, 1.8 + R() * 0.5, R()); }
        }
      }
      // the groves first (a crown of 12 m radius or more), then the single trees: a chunk far from the middle of the view draws its groves only (nb of them)
      const big = [], small = []; for (let q = 0; q < T.length; q += NT) (T[q + 3] >= 12 * M ? big : small).push(...T.slice(q, q + NT));
      return { ix, iz, t: new Float32Array(big.concat(small)), n: T.length / NT, nb: big.length / NT, tested };
    }
    Object.assign(out, { parks, at, inPark, chunk, has: (ix, iz) => chunks.has(ix * 65536 + iz), boxes, paint, CS });
    }
  }

  // ---- drawing the trees: one instanced mesh for every tree near the camera; its buffer is filled again when the chunks near the camera change ----
  // U: the fabric's uniforms (uPlace: the places' colours and lifts by texel; uTexW; uGrow: how far the fabric stands; uFocus: where it sinks away)
  // plus uTreeA, uTreeB (the trees' two greens), uPkNow (the time, for a chunk's own rise), uPkWood (the woods' green)
  function gl(THREE, U, cap) {
    const HEAD = `
attribute vec4 aT; attribute vec4 aU;
uniform sampler2D uPlace; uniform float uTexW; uniform float uGrow; uniform vec4 uFocus; uniform float uPkNow;
float pkGrow() { return uGrow * clamp((uPkNow - aU.w) / 450.0, 0.0, 1.0) * (1.0 - smoothstep(uFocus.z, uFocus.w, distance(aT.xz, uFocus.xy))); }
vec4 pkPlace() { return aU.y < 0.0 ? vec4(0.0) : texture2D(uPlace, vec2((aU.y + 0.5) / uTexW, 0.25)); }`;
    // the crown: the unit shape (y from 0 to 1, radius 1) stood on its ground, as tall as its own h/r, grown from a point
    const POS = `
float g = pkGrow(); vec4 pl = pkPlace(); float e = g * g * (3.0 - 2.0 * g);
vec3 transformed = vec3(position.x * aT.w, position.y * aT.w * aU.x, position.z * aT.w) * e * step(0.02, g) + vec3(aT.x, aT.y + pl.a - 0.004, aT.z);`;
    const uni = s => { for (const k in U) s.uniforms[k] = U[k]; };
    const mat = new THREE.MeshStandardMaterial({ metalness: 0, roughness: 0.95 }); mat.customProgramCacheKey = () => 'm3d-pk-t';
    mat.onBeforeCompile = s => { uni(s);
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>' + HEAD + '\nuniform vec3 uTreeA; uniform vec3 uTreeB; uniform vec3 uPkWood;\nvarying vec3 vPk;')
        .replace('#include <begin_vertex>', POS + `
float tn = fract(aU.z * 7.13), kd = aU.z >= 1.0 ? floor(aU.z) : 0.0; vec3 c = mix(uTreeA, uTreeB, fract(aU.z));
if (kd == 1.0) c = mix(uPkWood, uTreeB, tn * 0.5); else if (kd == 4.0) c = mix(uPkWood, uTreeA, 0.3) * 0.9;
vPk = c * (0.78 + 0.3 * smoothstep(0.1, 0.95, position.y));`);
      s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vPk;').replace('#include <color_fragment>', 'diffuseColor.rgb = vPk;');
    };
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }); depth.customProgramCacheKey = () => 'm3d-pk-td';
    depth.onBeforeCompile = s => { uni(s); s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>' + HEAD).replace('#include <begin_vertex>', POS); };
    // the unit crown, 12 faces on 8 points: a point near the ground, a ring of six at two fifths of the height, a top; the normals of a
    // rounded crown (out from a point inside it), so it is lit soft as a canopy, not cut as a gem
    const geo = (() => { const P = [0, 0.06, 0, 0, 1, 0], N = [0, -1, 0, 0, 1, 0], I = [];
      for (let j = 0; j < 6; j++) { const a = j / 6 * Math.PI * 2, x = Math.cos(a), z = Math.sin(a); P.push(x, 0.42, z); const l = Math.hypot(x, 0.25, z); N.push(x / l, 0.25 / l, z / l); }
      for (let j = 0; j < 6; j++) { const a = 2 + j, b = 2 + (j + 1) % 6; I.push(1, b, a, 0, a, b); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3)); g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(N), 3)); g.setIndex(I); return g; })();
    const data = new Float32Array(cap * NT), g = new THREE.InstancedBufferGeometry(); for (const k of ['position', 'normal']) g.setAttribute(k, geo.attributes[k]); if (geo.index) g.setIndex(geo.index);
    const ib = new THREE.InstancedInterleavedBuffer(data, NT); ib.setUsage(THREE.DynamicDrawUsage); g.setAttribute('aT', new THREE.InterleavedBufferAttribute(ib, 4, 0)); g.setAttribute('aU', new THREE.InterleavedBufferAttribute(ib, 4, 4)); g.instanceCount = 0;
    const mesh = new THREE.Mesh(g, mat); mesh.customDepthMaterial = depth; mesh.castShadow = mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.matrixAutoUpdate = false;
    // fill: the trees of the chunks given ([{ t, n, born, use }]: use, how many of its trees, from the first), up to the cap; returns the count
    function fill(list) {
      let n = 0;
      for (const c of list) { const m = Math.min(c.use != null ? c.use : c.n, cap - n); if (m <= 0) continue;
        for (let i = 0; i < m; i++) { const a = i * NT, b = (n + i) * NT, t = c.t; data[b] = t[a]; data[b + 1] = t[a + 1]; data[b + 2] = t[a + 2]; data[b + 3] = t[a + 3]; data[b + 4] = t[a + 4]; data[b + 5] = t[a + 5]; data[b + 6] = t[a + 7] + t[a + 6] * 0.999; data[b + 7] = c.born; }
        n += m; }
      ib.needsUpdate = true; g.instanceCount = n; mesh.visible = n > 0; return n;
    }
    return { mesh, fill, mats: { mat, depth }, tris: (geo.index ? geo.index.count : geo.attributes.position.count) / 3 };
  }

  M3D.parks = { make, gl, CS, NT };
})();
