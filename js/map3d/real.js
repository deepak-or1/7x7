// Seven by Seven, the 3D map: the real buildings. Loaded only when the 3D map is wanted (index.html), after js/map3d/land.js and
// js/map3d/buildings.js. In the four areas that file covers (the core of San Francisco, the city's tall buildings, downtown
// Oakland, the Las Vegas Strip) every outline is stood up from its footprint to its height, on the ground where it is, in place
// of what js/map3d/fabric.js and the filler towers of js/map3d/models.js make up there.
// Two halves, as the fabric has. make(data, env) unpacks the outlines, sorts them by square of the map (a chunk) and answers the
// fabric's questions (is a point built on, is it in the part of town where every building is real); chunk(ix, iz) makes one
// square's buildings as one merged shape: plain numbers in typed arrays, no THREE in it. gl(THREE, U) draws a chunk with the
// fabric's own uniforms: a building's colour is read from the texture of place colours (so a lens, a fade or the quiz recolours it
// for nothing), mixed towards the pale of the look, further for a tower; it grows from the ground as the map comes close; its
// windows are lit at night. Heights: metres times V (see below) on a map where one unit is about 143 m.
// The looks (env.look, the look given to gl; ?m3d-look=a|b|c, '0' or none: the plain buildings they were): a flat roof is cut as a
// fan from its middle where the outline allows (every edge seen from the middle), each roof vertex carrying its distance from the
// roof's edge, so the shader draws a coping and an inset top for no triangles; plant rooms on the large roofs, a stepped or a
// chamfered crown and a mast on the tallest; walls of four kinds chosen per building from its tint (punched windows, vertical
// ribs, horizontal bands, a glass face), a base band at the street and a cornice, each lit in its own way at night.
// World frame: x = map x, z = map y (south), y = up. Defines window.M3D.real.
(function () {
  'use strict';
  const M3D = window.M3D, land = M3D && M3D.land; if (!land) return;
  const Geom = window.Geom, K = 1 / land.UNIT_M;
  const CS = 6;                                   // the side of a chunk, in map units
  const V = 2.5;                                  // heights are drawn at two and a half times the map's scale: the downtown landmark models' own enlargement (Salesforce Tower, the Pyramid), so they stand among their real neighbours as in life (and as the models grow from afar, uRise, these grow with them)
  const TALL = 60;                                // a building this tall (metres) or taller stands from the city-wide view inwards (tall below), the rest arrive by chunk as the camera comes near
  const CELL = 1.5;                               // the grid that answers "is this point built on"
  const FAR = 300;                                // an outline further than this from its area's origin, in map units (about 43 km), is not a building of that area
  let RX = new Float64Array(66), RZ = new Float64Array(66);   // a ring's points, for the roofs of the looks (shape below)
  const NV = 3, NB = 4, NW = 4;                   // numbers per vertex: position; aB [the ground it grows from, place, tint, the chunk's slot]; aW [along the wall, above the ground, 1 wall / 0 roof, the building's height]

  // one area of js/map3d/buildings.js (its header gives the format): [{ h, base, roof, pts: [x, y, ...] metres east and north }];
  // an outline of fewer than 3 or more than 4000 points is read past and left out (out.read counts every outline read)
  function unpack(area) {
    const bin = atob(area.data), n = bin.length, s = new Uint8Array(n); for (let k = 0; k < n; k++) s[k] = bin.charCodeAt(k);
    let i = 0, px = 0, py = 0; const out = [];
    const uv = () => { let v = 0, m = 1, b; do { if (i >= n) throw new Error('the building data is cut short'); b = s[i++]; v += (b & 127) * m; m *= 128; } while (b & 128); return v; };
    const sv = () => { const u = uv(); return u & 1 ? -(u + 1) / 2 : u / 2; };
    let read = 0;
    while (i < n) {
      const h = uv(), base = uv(), roof = uv(), np = uv(); read++;
      if (np * 2 > n - i) throw new Error('the building data is not whole');   // (every point takes two bytes at least: a count past what is left cannot be read past)
      if (!(np >= 3 && np <= 4000)) { if (np >= 1) { px += sv(); py += sv(); for (let k = 1; k < np && i < n; k++) { sv(); sv(); } } continue; }   // (the next outline starts from this one's first point)
      const pts = new Float64Array(np * 2); let x = px + sv(), y = py + sv(); px = x; py = y; pts[0] = x; pts[1] = y;
      for (let k = 1; k < np; k++) { x += sv(); y += sv(); pts[k * 2] = x; pts[k * 2 + 1] = y; }
      out.push({ h, base, roof, pts });
    }
    out.read = read; return out;
  }
  const inRing = (p, n, x, z) => { let c = false; for (let i = 0, j = n - 1; i < n; j = i++) { const xi = p[i * 2], zi = p[i * 2 + 1], xj = p[j * 2], zj = p[j * 2 + 1]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
  // a simple polygon (x, z pairs, counter-clockwise as land.js counts area) cut into triangles by its ears: indices into it
  function ears(p, n, out) {
    const v = []; for (let i = 0; i < n; i++) v.push(i);
    const X = (a, b, c) => (p[b * 2] - p[a * 2]) * (p[c * 2 + 1] - p[b * 2 + 1]) - (p[b * 2 + 1] - p[a * 2 + 1]) * (p[c * 2] - p[b * 2]); let guard = 0;
    while (v.length > 3 && guard++ < 5000) {
      const m = v.length; let cut = -1;
      for (let i = 0; i < m && cut < 0; i++) { const a = v[(i + m - 1) % m], b = v[i], c = v[(i + 1) % m]; if (!(X(a, b, c) > 1e-12)) continue; let ok = true; for (let k = 0; k < m && ok; k++) { const q = v[k]; if (q === a || q === b || q === c) continue; if (X(a, b, q) > 1e-12 && X(b, c, q) > 1e-12 && X(c, a, q) > 1e-12) ok = false; } if (ok) cut = i; }
      if (cut < 0) { let bm = Infinity; for (let i = 0; i < m; i++) { const q = Math.abs(X(v[(i + m - 1) % m], v[i], v[(i + 1) % m])); if (q < bm) { bm = q; cut = i; } } }
      const a = v[(cut + m - 1) % m], b = v[cut], c = v[(cut + 1) % m]; if (X(a, b, c) >= 0) out.push(a, b, c); v.splice(cut, 1);
    }
    if (v.length === 3 && X(v[0], v[1], v[2]) >= 0) out.push(v[0], v[1], v[2]);
  }

  // env: { inTop(x, z): the place whose block's top holds the point, or -1; inTopOf(i, x, z); hAt(i, x, z): the ground of place i
  // there; boxes: [[x0, z0, x1, z1], ...] the plans of the landmark models (a model wins over the outline at its spot);
  // look: the look of the buildings, read as each shape is made ('0' or none: plain); road(x, z, r): is the circle on a road (optional) }
  function make(data, env) {
    if (!data || !Array.isArray(data.areas) || !data.areas.length) throw new Error('the building data is not there');
    const chunks = new Map(), grid = new Map(), dens = new Map(), groups = [], ck = (x, z) => Math.floor(x / CELL) * 8192 + Math.floor(z / CELL); let total = 0;
    // an area that cannot be read is left out, the others stand; an outline that is not a building's (its box wider than a chunk, or
    // not near its area at all: a corrupt step) is left out, the rest of its area stands
    let areas = 0;
    for (const a of data.areas) {
      const tallOf = [];
      let list, O;
      try { list = unpack(a); if (a.count != null && list.read !== a.count) throw new Error('the building data is cut short: ' + list.read + ' of ' + a.count);
        if (!a.origin || !isFinite(a.origin[0]) || !isFinite(a.origin[1])) throw new Error('the area has no origin'); O = Geom.proj(a.origin); }
      catch (e) { console.warn('3D map, the real buildings of ' + (a && a.name) + ' left out: ' + (e && e.message || e)); continue; }
      areas++;
      const o = a.origin, kx = 1 / (111320 * Math.cos(o[1] * Math.PI / 180)), core = a.name === 'sf-core';
      for (const b of list) {
        const n = b.pts.length / 2, p = new Float32Array(n * 2); let ar = 0, cx = 0, cz = 0, x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
        for (let k = 0; k < n; k++) { const q = Geom.proj([o[0] + b.pts[k * 2] * kx, o[1] + b.pts[k * 2 + 1] / 111320]); p[k * 2] = q[0]; p[k * 2 + 1] = q[1]; cx += q[0]; cz += q[1]; if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < z0) z0 = q[1]; if (q[1] > z1) z1 = q[1]; }
        if (!(x1 - x0 <= CS && z1 - z0 <= CS) || !(Math.abs(x0 - O[0]) < FAR && Math.abs(x1 - O[0]) < FAR && Math.abs(z0 - O[1]) < FAR && Math.abs(z1 - O[1]) < FAR)) continue;
        for (let k = 0, j = n - 1; k < n; j = k++) ar += p[j * 2] * p[k * 2 + 1] - p[k * 2] * p[j * 2 + 1];
        if (ar < 0) { for (let k = 0; k < n >> 1; k++) { const j = n - 1 - k, tx = p[k * 2], tz = p[k * 2 + 1]; p[k * 2] = p[j * 2]; p[k * 2 + 1] = p[j * 2 + 1]; p[j * 2] = tx; p[j * 2 + 1] = tz; } ar = -ar; }   // the solid on the left, as land.js winds its rings
        if (!(ar > 1e-5) || !(b.h > 0)) continue;
        const rec = { p, n, h: b.h, base: b.base, roof: b.roof, cx: cx / n, cz: cz / n, x0, z0, x1, z1, area: ar / 2, tint: ((total * 2654435761) >>> 0) / 4294967296, place: undefined }; total++;
        const key = Math.floor(rec.cx / CS) * 65536 + Math.floor(rec.cz / CS); if (b.h >= TALL) { rec.key = key; tallOf.push(rec); } else { let l = chunks.get(key); if (!l) chunks.set(key, l = []); l.push(rec); }
        for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) { const g = i * 8192 + j; let q = grid.get(g); if (!q) grid.set(g, q = []); q.push(rec); }
        if (core) { const g = ck(rec.cx, rec.cz); dens.set(g, (dens.get(g) || 0) + 1); }
      }
      // the area's tall buildings, by chunk, in groups of about fifty (each group one shape: tall below)
      tallOf.sort((u, v) => u.key - v.key); for (let k = 0; k < tallOf.length; k += 50) groups.push(tallOf.slice(k, k + 50));
    }
    if (!areas) throw new Error('no area of the building data could be read');
    // is the circle r round a point built on (by any outline, kept or not: nothing made up stands there either)
    function solid(x, z, r) {
      for (let i = Math.floor((x - r) / CELL); i <= Math.floor((x + r) / CELL); i++) for (let j = Math.floor((z - r) / CELL); j <= Math.floor((z + r) / CELL); j++) {
        const l = grid.get(i * 8192 + j); if (!l) continue;
        for (const b of l) { if (x + r < b.x0 || x - r > b.x1 || z + r < b.z0 || z - r > b.z1) continue; if (inRing(b.p, b.n, x, z)) return true;
          for (let k = 0, q = b.n - 1; k < b.n; q = k++) { const ax = b.p[q * 2], az = b.p[q * 2 + 1], dx = b.p[k * 2] - ax, dz = b.p[k * 2 + 1] - az, l2 = dx * dx + dz * dz; let t = l2 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t; const ex = ax + dx * t - x, ez = az + dz * t - z; if (ex * ex + ez * ez < r * r) return true; } }
      }
      return false;
    }
    // the part of town where every building is real (the core of San Francisco): nothing is made up there, built or not
    const dense = (x, z) => (dens.get(ck(x, z)) || 0) >= 2;
    // where a building stands: not under a landmark's plan, and on the top of one place
    function settle(b) {
      b.place = -1;
      for (const q of env.boxes || []) { if (b.cx > q[0] && b.cx < q[2] && b.cz > q[1] && b.cz < q[3]) return; const mx = (q[0] + q[2]) / 2, mz = (q[1] + q[3]) / 2; if (mx > b.x0 && mx < b.x1 && mz > b.z0 && mz < b.z1 && inRing(b.p, b.n, mx, mz)) return; }
      if (env.road) { if (env.road(b.cx, b.cz, 0.04)) return; for (let k = 0, j = b.n - 1; k < b.n; j = k++) if (env.road(b.p[k * 2], b.p[k * 2 + 1], 0) || env.road((b.p[k * 2] + b.p[j * 2]) / 2, (b.p[k * 2 + 1] + b.p[j * 2 + 1]) / 2, 0)) return; }   // a road runs here (js/map3d/roads.js): its middle, a corner or the middle of a wall is on it
      const i = env.inTop(b.cx, b.cz); if (i < 0) return; let on = 0; for (let k = 0; k < b.n; k++) if (env.inTopOf(i, b.p[k * 2], b.p[k * 2 + 1])) on++;
      if (on >= b.n * 0.7) b.place = i;
    }
    const has = (ix, iz) => chunks.has(ix * 65536 + iz);
    // one chunk's buildings (the ones under TALL) as one shape, the tallest first (a lighter picture draws the first part of it):
    // null when it has none. tall(g): the same for a group of the tall buildings (tallCount of them)
    const chunk = (ix, iz) => shape(chunks.get(ix * 65536 + iz), ix, iz);
    const tall = g => { const l = groups[g]; return l ? shape(l, Math.floor(l[0].cx / CS), Math.floor(l[0].cz / CS)) : null; };
    function shape(list, ix, iz) {
      if (!list) return null;
      const keep = []; for (const b of list) { if (b.place === undefined) settle(b); if (b.place >= 0) keep.push(b); } if (!keep.length) return null;
      keep.sort((a, b) => b.h - a.h);
      const pos = [], nor = [], aB = [], aW = [], idx = [], tri = [], cuts = []; let nv = 0, y0 = Infinity, y1 = -Infinity;
      const vert = (x, y, z, nx, ny, nz, g, b, u, v, wall, bh) => { pos.push(x, y, z); nor.push(nx, ny, nz); aB.push(g, b.place, b.tint, 0); aW.push(u, v, wall, bh); if (y < y0) y0 = y; if (y > y1) y1 = y; return nv++; };
      keep.forEach((b, bi) => {
        const p = b.p, n = b.n, i = b.place, gc = env.hAt(i, b.cx, b.cz); let g = gc; for (let k = 0; k < n; k++) { const q = env.hAt(i, p[k * 2], p[k * 2 + 1]); if (q < g) g = q; }
        // on a slope it stands on the lowest ground under its outline and is as tall above the ground at its middle as on the flat; a part that starts above the ground (base) hangs from there
        const hh = b.h * K * V, top = gc + hh, bot = b.base > 0 && b.base < b.h ? gc + b.base * K * V : g - 0.02, u0 = b.tint * 9;
        const ring = (q, s, y, lift) => { // walls up from a ring (q scaled by s about the middle) from y to y + lift, and a flat lid on them
          let acc = u0; const at = k => [b.cx + (q[k * 2] - b.cx) * s, b.cz + (q[k * 2 + 1] - b.cz) * s];
          for (let k = 0; k < n; k++) { const a = at(k), c = at((k + 1) % n), dx = c[0] - a[0], dz = c[1] - a[1], l = Math.hypot(dx, dz); if (l < 1e-6) continue; const nx = dz / l, nz = -dx / l;
            const v0 = vert(a[0], y, a[1], nx, 0, nz, g, b, acc, y - gc, 1, hh), v1 = vert(c[0], y, c[1], nx, 0, nz, g, b, acc + l, y - gc, 1, hh), v2 = vert(c[0], y + lift, c[1], nx, 0, nz, g, b, acc + l, y + lift - gc, 1, hh), v3 = vert(a[0], y + lift, a[1], nx, 0, nz, g, b, acc, y + lift - gc, 1, hh);
            idx.push(v0, v2, v1, v0, v3, v2); acc += l; }
          const base = nv; for (let k = 0; k < n; k++) { const a = at(k); vert(a[0], y + lift, a[1], 0, 1, 0, g, b, 0, y + lift - gc, 0, hh); }
          return base;
        };
        const lid = base => { tri.length = 0; ears(p, n, tri); for (let k = 0; k < tri.length; k += 3) idx.push(base + tri[k], base + tri[k + 2], base + tri[k + 1]); };
        const span = Math.sqrt(b.area);
        const plain = () => {
        const base = ring(p, 1, bot, top - bot); let convex = n <= 12; for (let k = 0; k < n && convex; k++) { const a = k, c = (k + 1) % n, d = (k + 2) % n; if ((p[c * 2] - p[a * 2]) * (p[d * 2 + 1] - p[c * 2 + 1]) - (p[c * 2 + 1] - p[a * 2 + 1]) * (p[d * 2] - p[c * 2]) < -1e-9) convex = false; }
        if (b.roof === 1 || b.roof === 2 || b.roof === 3 || b.roof === 4 || b.roof === 6 || b.roof === 7) {
          // a roof that rises to the middle: one tier for a pyramid, a gable or a hip (low), two for a dome
          const round = b.roof === 2 || b.roof === 6 || b.roof === 7, rh = Math.min(round ? 0.5 * span : 0.28 * span, 0.7), tiers = round ? [[0.66, 0.68], [0, 1]] : [[0, 1]]; let ps = 1, py = 0;
          for (const [s, f] of tiers) { for (let k = 0; k < n; k++) { const c = (k + 1) % n, A = [b.cx + (p[k * 2] - b.cx) * ps, top + rh * py, b.cz + (p[k * 2 + 1] - b.cz) * ps], B = [b.cx + (p[c * 2] - b.cx) * ps, top + rh * py, b.cz + (p[c * 2 + 1] - b.cz) * ps], C = [b.cx + (p[c * 2] - b.cx) * s, top + rh * f, b.cz + (p[c * 2 + 1] - b.cz) * s], D = [b.cx + (p[k * 2] - b.cx) * s, top + rh * f, b.cz + (p[k * 2 + 1] - b.cz) * s];
              let nx = (C[1] - A[1]) * (B[2] - A[2]) - (C[2] - A[2]) * (B[1] - A[1]), ny = (C[2] - A[2]) * (B[0] - A[0]) - (C[0] - A[0]) * (B[2] - A[2]), nz = (C[0] - A[0]) * (B[1] - A[1]) - (C[1] - A[1]) * (B[0] - A[0]); const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l; if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
              const a0 = vert(A[0], A[1], A[2], nx, ny, nz, g, b, 0, A[1] - gc, 0, hh), b0 = vert(B[0], B[1], B[2], nx, ny, nz, g, b, 0, B[1] - gc, 0, hh), c0 = vert(C[0], C[1], C[2], nx, ny, nz, g, b, 0, C[1] - gc, 0, hh); idx.push(a0, c0, b0);
              if (s > 0) { const d0 = vert(D[0], D[1], D[2], nx, ny, nz, g, b, 0, D[1] - gc, 0, hh); idx.push(a0, d0, c0); } }
            ps = s; py = f; }
        } else {
          lid(base);
          // a tower with a plain flat top gets what stands on such roofs: a set-back storey, and on the tallest a plant room on that
          if (convex && b.h >= 40 && span > 0.12) { const c1 = ring(p, 0.72, top, Math.min(0.09, hh * 0.05) + 0.02 * b.tint); lid(c1); if (b.h >= 110) lid(ring(p, 0.4, top + Math.min(0.09, hh * 0.05) + 0.02 * b.tint, 0.07 + 0.05 * b.tint)); }
        }
        };
        // the looks: walls, then a roof that reads as one. (C: the middle of the outline's area; star: every edge is seen from it, so
        // the roof is a fan about it and a ring drawn in towards it stays inside; r0: how far the nearest edge is from it)
        const styled = () => {
          let sx = 0, sz = 0, s2 = 0; for (let k = 0, j = n - 1; k < n; j = k++) { const cr = p[j * 2] * p[k * 2 + 1] - p[k * 2] * p[j * 2 + 1]; s2 += cr; sx += (p[j * 2] + p[k * 2]) * cr; sz += (p[j * 2 + 1] + p[k * 2 + 1]) * cr; }
          const Cx = s2 > 1e-9 ? sx / (3 * s2) : b.cx, Cz = s2 > 1e-9 ? sz / (3 * s2) : b.cz; let star = n <= 64, r0 = Infinity, long = 0, lx = 1, lz = 0;
          for (let k = 0; k < n; k++) { const c = (k + 1) % n, dx = p[c * 2] - p[k * 2], dz = p[c * 2 + 1] - p[k * 2 + 1], l = Math.hypot(dx, dz); if (l < 1e-6) continue; const he = (dx * (Cz - p[k * 2 + 1]) - dz * (Cx - p[k * 2])) / l; if (!(he > 2e-3)) star = false; if (he < r0) r0 = he; if (l > long) { long = l; lx = dx / l; lz = dz / l; } }
          // the outline drawn in by s about C, into RX, RZ (kept for the calls that follow)
          const ring = s => { if (RX.length < n + 1) { RX = new Float64Array(n * 2 + 2); RZ = new Float64Array(n * 2 + 2); } for (let k = 0; k < n; k++) { RX[k] = Cx + (p[k * 2] - Cx) * s; RZ[k] = Cz + (p[k * 2 + 1] - Cz) * s; } RX[n] = RX[0]; RZ[n] = RZ[0]; };
          // walls up from that outline, from y to y + lift (kind 1: with windows; 2: bare)
          const walls = (s, y, lift, kind) => { let acc = u0; ring(s);
            for (let k = 0; k < n; k++) { const ax = RX[k], az = RZ[k], cx = RX[k + 1], cz = RZ[k + 1], dx = cx - ax, dz = cz - az, l = Math.hypot(dx, dz); if (l < 1e-6) continue; const nx = dz / l, nz = -dx / l;
              const v0 = vert(ax, y, az, nx, 0, nz, g, b, acc, y - gc, kind, hh), v1 = vert(cx, y, cz, nx, 0, nz, g, b, acc + l, y - gc, kind, hh), v2 = vert(cx, y + lift, cz, nx, 0, nz, g, b, acc + l, y + lift - gc, kind, hh), v3 = vert(ax, y + lift, az, nx, 0, nz, g, b, acc, y + lift - gc, kind, hh);
              idx.push(v0, v2, v1, v0, v3, v2); acc += l; } };
          // a flat roof on that outline at y: the fan (the outline's points, and for each edge a point at the middle that is as far from the edge as it is), else cut by its ears with no edge to draw
          const flat = (s, y) => { ring(s); const base = nv;
            if (star) { for (let k = 0; k < n; k++) vert(RX[k], y, RZ[k], 0, 1, 0, g, b, 0, y - gc, 0, hh);
              for (let k = 0; k < n; k++) { const dx = RX[k + 1] - RX[k], dz = RZ[k + 1] - RZ[k], l = Math.hypot(dx, dz); if (l < 1e-6) continue; idx.push(base + k, vert(Cx, y, Cz, 0, 1, 0, g, b, (dx * (Cz - RZ[k]) - dz * (Cx - RX[k])) / l, y - gc, 0, hh), base + (k + 1) % n); } return; }
            for (let k = 0; k < n; k++) vert(RX[k], y, RZ[k], 0, 1, 0, g, b, 9, y - gc, 0, hh);
            tri.length = 0; ears(p, n, tri); for (let k = 0; k < tri.length; k += 3) idx.push(base + tri[k], base + tri[k + 2], base + tri[k + 1]);
          };
          // a box on the roof (a plant room, a lift's head), turned to the longest wall: bare walls and a top
          const box = (x, z, hx, hz, y, h) => { const q = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([e, f]) => [x + e * hx * lx - f * hz * lz, z + e * hx * lz + f * hz * lx]);
            for (let k = 0; k < 4; k++) { const a = q[k], c = q[(k + 1) % 4], dx = c[0] - a[0], dz = c[1] - a[1], l = Math.hypot(dx, dz) || 1, nx = dz / l, nz = -dx / l;
              const v0 = vert(a[0], y, a[1], nx, 0, nz, g, b, 0, y - gc, 2, hh), v1 = vert(c[0], y, c[1], nx, 0, nz, g, b, l, y - gc, 2, hh), v2 = vert(c[0], y + h, c[1], nx, 0, nz, g, b, l, y + h - gc, 2, hh), v3 = vert(a[0], y + h, a[1], nx, 0, nz, g, b, 0, y + h - gc, 2, hh); idx.push(v0, v2, v1, v0, v3, v2); }
            const t = q.map(a => vert(a[0], y + h, a[1], 0, 1, 0, g, b, 9, y + h - gc, 0, hh)); idx.push(t[0], t[2], t[1], t[0], t[3], t[2]); };
          const r1 = (b.tint * 91.7) % 1, r2 = (b.tint * 517.3) % 1, r3 = (b.tint * 2731.1) % 1, tower = star && b.h >= 40 && span > 0.12 && r0 > 0.05;
          if (b.roof === 1 || b.roof === 2 || b.roof === 3 || b.roof === 4 || b.roof === 6 || b.roof === 7) {
            // a roof that rises to the middle, as it was (no edge to draw on it)
            walls(1, bot, top - bot, 1);
            const round = b.roof === 2 || b.roof === 6 || b.roof === 7, rh = Math.min(round ? 0.5 * span : 0.28 * span, 0.7), tiers = round ? [[0.66, 0.68], [0, 1]] : [[0, 1]]; let ps = 1, py = 0;
            for (const [s, f] of tiers) { for (let k = 0; k < n; k++) { const c = (k + 1) % n, A = [b.cx + (p[k * 2] - b.cx) * ps, top + rh * py, b.cz + (p[k * 2 + 1] - b.cz) * ps], B = [b.cx + (p[c * 2] - b.cx) * ps, top + rh * py, b.cz + (p[c * 2 + 1] - b.cz) * ps], C = [b.cx + (p[c * 2] - b.cx) * s, top + rh * f, b.cz + (p[c * 2 + 1] - b.cz) * s], D = [b.cx + (p[k * 2] - b.cx) * s, top + rh * f, b.cz + (p[k * 2 + 1] - b.cz) * s];
                let nx = (C[1] - A[1]) * (B[2] - A[2]) - (C[2] - A[2]) * (B[1] - A[1]), ny = (C[2] - A[2]) * (B[0] - A[0]) - (C[0] - A[0]) * (B[2] - A[2]), nz = (C[0] - A[0]) * (B[1] - A[1]) - (C[1] - A[1]) * (B[0] - A[0]); const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l; if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
                const a0 = vert(A[0], A[1], A[2], nx, ny, nz, g, b, 9, A[1] - gc, 0, hh), b0 = vert(B[0], B[1], B[2], nx, ny, nz, g, b, 9, B[1] - gc, 0, hh), c0 = vert(C[0], C[1], C[2], nx, ny, nz, g, b, 9, C[1] - gc, 0, hh); idx.push(a0, c0, b0);
                if (s > 0) { const d0 = vert(D[0], D[1], D[2], nx, ny, nz, g, b, 9, D[1] - gc, 0, hh); idx.push(a0, d0, c0); } }
              ps = s; py = f; }
          } else if (tower && b.h >= 150 && r1 < 0.6 && !(b.base > 0)) {
            // one of the tallest: the shaft steps in twice below its top, and some carry a mast
            const hc = Math.min(0.2 * hh, 0.55), y1 = top - hc, y2 = top - hc * 0.42;
            walls(1, bot, y1 - bot, 1); flat(1, y1); walls(0.8, y1, y2 - y1, 1); flat(0.8, y2); walls(0.58, y2, top - y2, 1); flat(0.58, top);
            if (b.h >= 180 && r2 < 0.5) box(Cx, Cz, 0.012, 0.012, top, 0.22 + 0.2 * r3);
          } else if (tower) {
            walls(1, bot, top - bot, 1); flat(1, top); const st = Math.min(0.09, hh * 0.05) + 0.02 * b.tint;
            if (b.h >= 90 && r1 > 0.62) { // a chamfered crown: the walls lean in to a smaller top
              const s1 = 0.8, y1 = top + st * 1.5; ring(1);
              for (let k = 0; k < n; k++) { const ax = RX[k], az = RZ[k], cx = RX[k + 1], cz = RZ[k + 1], dx = cx - ax, dz = cz - az, l = Math.hypot(dx, dz); if (l < 1e-6) continue;
                const he = (dx * (Cz - az) - dz * (Cx - ax)) / l * (1 - s1), m = Math.hypot(he, y1 - top) || 1, nx = dz / l * (y1 - top) / m, nz = -dx / l * (y1 - top) / m, ny = he / m, ex = Cx + (ax - Cx) * s1, ez = Cz + (az - Cz) * s1, fx = Cx + (cx - Cx) * s1, fz = Cz + (cz - Cz) * s1;
                const v0 = vert(ax, top, az, nx, ny, nz, g, b, 0, top - gc, 2, hh), v1 = vert(cx, top, cz, nx, ny, nz, g, b, l, top - gc, 2, hh), v2 = vert(fx, y1, fz, nx, ny, nz, g, b, l, y1 - gc, 2, hh), v3 = vert(ex, y1, ez, nx, ny, nz, g, b, 0, y1 - gc, 2, hh); idx.push(v0, v2, v1, v0, v3, v2); }
              flat(s1, y1);
            } else { // a set-back storey, and on the tallest a plant room on that (as the plain towers have)
              walls(0.72, top, st, 1); flat(0.72, top + st); if (b.h >= 110) { walls(0.4, top + st, 0.07 + 0.05 * b.tint, 2); flat(0.4, top + st + 0.07 + 0.05 * b.tint); } }
          } else {
            walls(1, bot, top - bot, 1); flat(1, top);
            // what stands on a large flat roof: one to three plant rooms about its middle
            if (star && b.h >= 9 && r0 >= 0.06 && r1 > 0.2) { const nb = r0 > 0.17 ? 3 : r0 > 0.1 ? 2 : 1;
              for (let q = 0; q < nb; q++) { const a = (r2 + q / nb) * 6.2832, d = (nb > 1 ? 0.42 : 0.25 * r3) * r0, hs = Math.min(0.085, (0.2 + 0.1 * ((r3 * (q + 2) * 3.7) % 1)) * r0 * (nb > 1 ? 0.8 : 1.15));
                box(Cx + Math.cos(a) * d, Cz + Math.sin(a) * d, hs, hs * (0.55 + 0.4 * ((r1 * (q + 3) * 5.3) % 1)), top, (q === 0 ? 0.034 : 0.02) + 0.02 * ((r2 * (q + 1) * 7.9) % 1)); } }
          }
        };
        if (env.look && env.look !== '0') { const m = [pos.length, nor.length, aB.length, aW.length, idx.length, nv, y0, y1];
          try { styled(); } catch (e) { pos.length = m[0]; nor.length = m[1]; aB.length = m[2]; aW.length = m[3]; idx.length = m[4]; nv = m[5]; y0 = m[6]; y1 = m[7]; plain(); } } // (a building the new roof fails on stands as the plain one)
        else plain();
        if (bi + 1 === Math.ceil(keep.length * 0.25)) cuts[0] = idx.length; if (bi + 1 === Math.ceil(keep.length * 0.5)) cuts[1] = idx.length;
      });
      return { ix, iz, count: keep.length, n: nv, pos: new Float32Array(pos), nor: new Float32Array(nor), aB: new Float32Array(aB), aW: new Float32Array(aW), idx: nv > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), quarter: cuts[0] || idx.length, half: cuts[1] || idx.length, y0, y1 };
    }
    return { chunk, has, solid, dense, total, CS, tall, tallCount: groups.length, TALL };
  }

  // ---- drawing ----
  // U: the fabric's uniforms (js/map3d/fabric.js gl): the texture of place colours and lifts (row 0) and of each chunk's growth
  // (row 1), how far the fabric stands, the circle it stands in, what it is mixed towards, the colour of lit windows; and uRise,
  // how much further than the ground's own stretch heights are drawn (the landmark models' growth from afar)
  function gl(THREE, U, look) {
    const HEAD = `
attribute vec4 aB; attribute vec4 aW;
uniform sampler2D uPlace; uniform float uTexW; uniform float uGrow; uniform vec4 uFocus; uniform float uRise;`;
    const POS = `
vec4 fpl = texture2D(uPlace, vec2((aB.y + 0.5) / uTexW, 0.25));
float fg = uGrow * texture2D(uPlace, vec2((aB.w + 0.5) / uTexW, 0.75)).r * (1.0 - smoothstep(uFocus.z, uFocus.w, distance(position.xz, uFocus.xy)));
vec3 transformed = step(0.02, fg) * vec3(position.x, aB.x + (position.y - aB.x) * fg * uRise + fpl.a, position.z);`;
    const uni = s => { for (const k in U) s.uniforms[k] = U[k]; };
    const mat = new THREE.MeshStandardMaterial({ metalness: 0, roughness: 0.84 });
    const NEW = look === 'a' || look === 'b' || look === 'c'; mat.customProgramCacheKey = () => 'm3d-real' + (NEW ? '-' + look : '');
    // the looks. K: how strongly the windows are drawn; G: how far a glass face goes to the glass colour; R: how dark the line
    // inside a roof's coping; c keeps the plain walls' faint floors and takes the roofs only
    const LK = { a: { K: 1, G: 0.5, R: 0.13 }, b: { K: 1.7, G: 0.8, R: 0.2 }, c: { K: 0, G: 0, R: 0.13 } }[look] || {}, fl = v => v.toFixed(3);
    const styled = s => {
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>' + HEAD + '\nuniform vec3 uPale; uniform float uRoofK; uniform float uWallK; uniform vec3 uGlass;\nvarying vec3 vFab; varying vec4 vWin; varying vec4 vBld;')
        .replace('#include <begin_vertex>', POS + `
bool top = aW.z < 0.5; float ft = aB.z, tall = smoothstep(0.3, 1.7, aW.w), r1 = fract(ft * 13.37);
// the kind of wall, by building: 3 a glass face (the taller the likelier), 1 vertical ribs, 2 horizontal bands, 0 punched windows
float pg = ${LK.G > 0 ? '0.03 + 0.47 * tall' : '0.0'}, pr = 0.12 + 0.16 * tall, st = r1 < pg ? 3.0 : r1 < pg + pr ? 1.0 : r1 < pg + pr + 0.27 ? 2.0 : 0.0;
vec3 fc = mix(fpl.rgb, uPale, top ? uRoofK + (0.82 - uRoofK) * 0.7 * tall : uWallK + (0.86 - uWallK) * 0.72 * tall) * (0.9 + 0.2 * fract(ft * 7.31));
if (st > 2.5 && !top) fc = mix(fc, uGlass * (0.92 + 0.16 * fract(ft * 7.31)), ${fl(LK.G)});
if (top && fract(ft * 3.17) > 0.8) fc = mix(fc, fpl.rgb * 0.8, 0.55 * (1.0 - tall));
if (!top) fc *= 0.84 + 0.16 * smoothstep(0.0, 0.26, aW.y);
vFab = fc; vWin = vec4(aW.x, aW.y, aW.z, tall); vBld = vec4(ft, aW.w, st, 0.0);`);
      s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vFab; varying vec4 vWin; varying vec4 vBld; uniform vec3 uWin;
// how much of a cell's stretch a to b a pixel covers (f: where in the cell, w: the cell's share of a pixel): soft at its ends, and its plain average once the cell is too small to draw
float m3dBox(float f, float a, float b, float w) { float e = min(w, 0.3) + 0.0001; return mix(b - a, smoothstep(a - e, a + e, f) * (1.0 - smoothstep(b - e, b + e, f)), 1.0 - clamp(w * 1.7 - 0.2, 0.0, 1.0)); }`)
        .replace('#include <color_fragment>', `diffuseColor.rgb = vFab;
{ float st = vBld.z, hh = vBld.y, y = vWin.y, fy = fwidth(y) + 0.00001;
  if (vWin.z < 0.5) { // a roof: the coping round its edge, a line of shade inside it, the top itself a little inset
    float d = vWin.x, e = fwidth(d) + 0.00001, see = 1.0 - clamp(e / 0.011 - 0.5, 0.0, 1.0), cop = 1.0 - smoothstep(0.011 - e, 0.011 + e, d), ln = (1.0 - cop) * (1.0 - smoothstep(0.019 - e, 0.019 + e, d));
    diffuseColor.rgb *= 1.0 + see * (0.06 * cop - ${fl(LK.R)} * ln - 0.035 * (1.0 - cop) * (1.0 - ln));
  } else if (vWin.z < 1.5) { // a wall: the street's band, the cornice, and between them the windows of its kind
    float big = step(0.2, hh), base = big * (1.0 - smoothstep(0.062 - fy, 0.062 + fy, y)), belt = big * (1.0 - base) * (1.0 - smoothstep(0.072 - fy, 0.072 + fy, y)), crown = smoothstep(hh - 0.022 - fy, hh - 0.022 + fy, y), mid = (1.0 - base) * (1.0 - belt) * (1.0 - crown);
    float seeY = 1.0 - clamp(fy / 0.012 - 0.6, 0.0, 1.0);
    diffuseColor.rgb *= 1.0 + seeY * (0.05 * belt - 0.1 * base + (st > 2.5 ? -0.06 : 0.045) * crown * step(0.12, hh));
${LK.K > 0 ? `    float cw = st > 0.5 && st < 1.5 ? 0.05 : 0.075; vec2 wc = vec2(vWin.x / cw, y / 0.058), wf = fract(wc), fw = vec2(fwidth(wc.x), fwidth(wc.y)); float dk;
    if (st < 0.5) dk = 0.17 * m3dBox(wf.x, 0.24, 0.76, fw.x) * m3dBox(wf.y, 0.3, 0.76, fw.y);
    else if (st < 1.5) dk = 0.2 * m3dBox(wf.x, 0.28, 0.72, fw.x) * (0.55 + 0.45 * m3dBox(wf.y, 0.12, 0.94, fw.y));
    else if (st < 2.5) dk = 0.2 * m3dBox(wf.y, 0.34, 0.78, fw.y) * (0.7 + 0.3 * m3dBox(wf.x, 0.04, 0.96, fw.x));
    else { dk = 0.1 * m3dBox(wf.x, 0.06, 0.94, fw.x) * m3dBox(wf.y, 0.07, 0.93, fw.y) - 0.07; diffuseColor.rgb *= 0.93 + 0.14 * clamp(y / max(hh, 0.05), 0.0, 1.0); }   // glass: the frame lighter than the panes, the face lighter towards the sky
    float wk = ${fl(LK.K)} * (st > 2.5 ? 1.0 : 0.45 + 0.55 * max(vWin.w, step(0.2, hh) * 0.6));   // (fainter on a small building)
    diffuseColor.rgb *= 1.0 - wk * dk * mid * (1.0 - clamp(max(fw.x, fw.y) * 1.7 - 0.9, 0.0, 1.0));` : `    { float fl = y / 0.058, fw = fwidth(fl); diffuseColor.rgb *= 1.0 - 0.085 * smoothstep(0.36, 0.5, abs(fract(fl) - 0.5)) * (1.0 - clamp(fw * 1.7 - 0.2, 0.0, 1.0)) * (0.3 + 0.7 * vWin.w) * mid; }`}
  } }`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
if (uWin.r + uWin.g + uWin.b > 0.0 && vWin.z > 0.5 && vWin.z < 1.5) { float st = ${LK.K > 0 ? 'vBld.z' : '0.0'}, hh = vBld.y, y = vWin.y, cw = st > 0.5 && st < 1.5 ? 0.05 : 0.075;
  vec2 wc = vec2(vWin.x / cw, y / 0.058), wi = floor(wc), wf = wc - wi, lo = vec2(0.22, 0.3), hi = vec2(0.78, 0.74), hk = wi; float thr = 0.6 - 0.12 * vWin.w; vec3 wcol = uWin;
  // each kind lit in its own way: single windows; slim strips three floors high; runs of three bays along a floor; a glass face, a little more of it lit, cooler
  if (st > 2.5) { lo = vec2(0.14, 0.28); hi = vec2(0.86, 0.74); hk = vec2(floor(wi.x / 2.0), wi.y); thr -= 0.04; wcol = uWin * vec3(0.8, 0.94, 1.16); }
  else if (st > 1.5) { lo = vec2(0.1, 0.36); hi = vec2(0.9, 0.7); hk = vec2(floor(wi.x / 3.0), wi.y); thr += 0.1; }
  else if (st > 0.5) { lo = vec2(0.34, 0.1); hi = vec2(0.66, 0.9); hk = vec2(wi.x, floor(wi.y / 3.0)); thr += 0.08; }
  float mid = step(0.2, hh) > 0.5 ? step(0.074, y) * step(y, hh - 0.022) : 1.0;
  float lit = step(thr, fract(sin(dot(hk + floor(vBld.x * 64.0), vec2(12.9898, 78.233))) * 43758.5453)) * step(lo.x, wf.x) * step(wf.x, hi.x) * step(lo.y, wf.y) * step(wf.y, hi.y) * mid;
  float fw = max(fwidth(wc.x), fwidth(wc.y)); totalEmissiveRadiance += wcol * mix(lit, 0.11 + 0.05 * vWin.w, clamp(fw * 1.4 - 0.25, 0.0, 1.0));
  // the street's band glows a little, in runs of shopfronts
  float sb = vWin.x / 0.22, sf = fract(sb); totalEmissiveRadiance += uWin * 0.5 * step(0.2, hh) * step(0.012, y) * step(y, 0.05) * step(0.12, sf) * step(sf, 0.88) * step(0.45, fract(sin(floor(sb) * 91.7 + vBld.x * 40.0) * 4375.85)) * (1.0 - clamp(fwidth(sb) * 3.0 - 0.3, 0.0, 1.0)); }`);
    };
    mat.onBeforeCompile = s => { uni(s);
      if (NEW) return styled(s);
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>' + HEAD + '\nuniform vec3 uPale; uniform float uRoofK; uniform float uWallK;\nvarying vec3 vFab; varying vec4 vWin;')
        .replace('#include <begin_vertex>', POS + `
bool top = aW.z < 0.5; float ft = aB.z, tall = smoothstep(0.3, 1.7, aW.w);
// the place's colour towards the pale of the look: a house keeps most of its place, a tower stands pale among them
vec3 fc = mix(fpl.rgb, uPale, top ? uRoofK + (0.82 - uRoofK) * 0.7 * tall : uWallK + (0.86 - uWallK) * 0.72 * tall) * (0.9 + 0.2 * fract(ft * 7.31));
if (top && fract(ft * 3.17) > 0.8) fc = mix(fc, fpl.rgb * 0.8, 0.55 * (1.0 - tall));
if (!top) fc *= 0.84 + 0.16 * smoothstep(0.0, 0.26, aW.y);   // a little darker at its foot, where its neighbours stand close
vFab = fc; vWin = vec4(aW.x, aW.y, top ? 0.0 : 1.0, tall);`);
      s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vFab; varying vec4 vWin; uniform vec3 uWin;')
        .replace('#include <color_fragment>', `diffuseColor.rgb = vFab;
{ float fl = vWin.y / 0.058, fw = fwidth(fl); // the floors of a tall building, as faint bands, gone before they could shimmer
  diffuseColor.rgb *= 1.0 - 0.085 * smoothstep(0.36, 0.5, abs(fract(fl) - 0.5)) * (1.0 - clamp(fw * 1.7 - 0.2, 0.0, 1.0)) * vWin.z * (0.3 + 0.7 * vWin.w); }`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
if (uWin.r + uWin.g + uWin.b > 0.0) { vec2 wc = vWin.xy / vec2(0.075, 0.058), wi = floor(wc), wf = wc - wi;
  float lit = step(0.6 - 0.12 * vWin.w, fract(sin(dot(wi, vec2(12.9898, 78.233))) * 43758.5453)) * step(0.22, wf.x) * step(wf.x, 0.78) * step(0.3, wf.y) * step(wf.y, 0.74);
  float fw = max(fwidth(wc.x), fwidth(wc.y)); totalEmissiveRadiance += uWin * mix(lit, 0.11 + 0.05 * vWin.w, clamp(fw * 1.4 - 0.25, 0.0, 1.0)) * vWin.z; }`);
    };
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }); depth.customProgramCacheKey = () => 'm3d-real-d';
    depth.onBeforeCompile = s => { uni(s); s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>' + HEAD).replace('#include <begin_vertex>', POS); };
    // a chunk's mesh, growing with its slot in the texture
    function mesh(c, slot) {
      for (let i = 0; i < c.n; i++) c.aB[i * NB + 3] = slot;
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(c.pos, NV)); g.setAttribute('normal', new THREE.BufferAttribute(c.nor, 3)); g.setAttribute('aB', new THREE.BufferAttribute(c.aB, NB)); g.setAttribute('aW', new THREE.BufferAttribute(c.aW, NW)); g.setIndex(new THREE.BufferAttribute(c.idx, 1));
      const up = isFinite(c.y0) ? (c.y1 - c.y0) / 2 : 0; g.boundingSphere = new THREE.Sphere(new THREE.Vector3((c.ix + 0.5) * CS, isFinite(c.y0) ? (c.y0 + c.y1) / 2 : 0, (c.iz + 0.5) * CS), CS * 0.75 + 2 + up + 1);
      const m = new THREE.Mesh(g, mat); m.customDepthMaterial = depth; m.castShadow = m.receiveShadow = true; m.matrixAutoUpdate = false; return m;
    }
    return { mesh, mats: { mat, depth } };
  }

  M3D.real = { make, gl, CS, V };
})();
