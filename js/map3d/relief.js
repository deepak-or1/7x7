// Seven by Seven, the 3D map: the land's real shape. Loaded only when the 3D map is wanted (index.html), after js/map3d/land.js and
// js/map3d/terrain.js. With it each place keeps its own piece (its outline, its wall, the hairline to its neighbours: land.js), but
// the top of the piece is the real ground instead of one flat height.
//
// One height function is the source of everything: heightAt(x, z), in world units, from the two grids of js/map3d/terrain.js (the
// fine grid of San Francisco where it covers, about 56 m; the 250 m grid of the bay elsewhere; the first faded into the second over MARGIN
// units at its edge, so there is no step), read bilinearly in metres and mapped through curve(): the old TOP0 + KH * metres^KP,
// moved along by M0 metres so that it starts with a finite slope (a flat shore stays flat, and the grid's one-metre steps do not
// show), and retuned so the hills stand about where the plateaus did. Las Vegas has no grid: its places stay plateaus.
//
// A place reads that function on a lattice of its own (S apart: 0.4 units in San Francisco and the Marin Headlands, 1.6 to 6.4
// further out), and its ground is the lattice's triangles: h(i, x, z) is exactly the surface that is drawn, so what stands on a
// slope, and a tap on it, meet the ground where it is. Two neighbours read the same function, so across the hairline the ground
// meets. The places inside the fine grid have two meshes: one from every fourth point of the lattice for the far views (made
// before the first frame, with everything else), and the full one, made after it, a place at a time.
//
// World frame: x = map x, z = map y (south), y = up; one unit is one map unit, about 143 m. Defines window.M3D.relief.
(function () {
  'use strict';
  const M3D = window.M3D, land = M3D && M3D.land; if (!land) return;
  const G = window.GEO, Geom = window.Geom, REG = window.REGIONS || {}, HOODS = G.hoods;
  const TOP0 = land.TOP0, FLOOR = land.FLOOR, LAND_TOP = land.LAND_TOP, BEV = land.BEV, KIND = land.KIND;
  // ---- the numbers ----
  const KH = 0.068, KP = 0.7, M0 = 15;    // height above TOP0 = KH * ((metres + M0)^KP - M0^KP): 10 m 0.15, 100 m 1.1, Twin Peaks (281 m) 2.5, Mount Tam 5.3
  const MARGIN = 5;                       // the fine grid fades into the coarse one over this many units inside its edge
  const SF = 0.4, SC = 1.6;               // a fine place's lattice, and the spacing of its far mesh (every fourth point)
  const NK = 1.5;                         // how much of a slope the light sees (1: all of it): softer, so a shaded slope keeps its place's colour
  const OX = 0.137, OZ = 0.071;           // the lattices' common origin: off the hundredths the outlines are written in
  const P0 = Math.pow(M0, KP), curve = m => TOP0 + KH * (Math.pow(m + M0, KP) - P0);
  const CT = new Float32Array(4002); for (let k = 0; k < CT.length; k++) CT[k] = curve(k * 0.5);   // the same by table, every half metre
  const curveT = m => { const f = m < 0 ? 0 : m > 2000 ? 4000 : m * 2, k = f | 0; return CT[k] + (CT[k + 1] - CT[k]) * (f - k); };
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  // map units to lon/lat (as js/geom.js)
  const NX = G.nx, NY = G.ny, LON0 = G.bbox[0], LAT0 = G.bbox[1], LON1 = G.bbox[2], LAT1 = G.bbox[3];
  const mercY = lat => { const r = lat * Math.PI / 180; return Math.log(Math.tan(r) + 1 / Math.cos(r)); }, MY0 = mercY(LAT1), MY1 = mercY(LAT0);
  const lonOf = x => LON0 + x / NX * (LON1 - LON0), latOf = y => Math.atan(Math.sinh(MY0 + y / NY * (MY1 - MY0))) * 180 / Math.PI;
  const xOf = lon => (lon - LON0) / (LON1 - LON0) * NX, yOf = lat => (mercY(lat) - MY0) / (MY1 - MY0) * NY;

  // one grid of js/map3d/terrain.js, in metres; blur: where the ground is nearly level a light 1-2-1 pass each way takes the steps
  // out of a coarse grid's bytes (a plain would show them as terraces); ridges and valleys keep what the grid has
  function grid(g, blur) {
    if (!g || !(g.w > 1) || !(g.h > 1) || !(g.step > 0) || !g.bbox || typeof g.data !== 'string') throw new Error('the height grid is not there');
    const bin = atob(g.data), w = g.w, h = g.h, n = w * h; if (bin.length !== n) throw new Error('the height grid is cut short: ' + bin.length + ' of ' + n);
    let m = new Float32Array(n); for (let k = 0; k < n; k++) m[k] = bin.charCodeAt(k) * g.step;
    if (blur) { const t = new Float32Array(n), lo = g.step * 0.6, hi = g.step * 2.2;
      for (let r = 0; r < h; r++) for (let c = 0, k = r * w; c < w; c++, k++) t[k] = (m[c ? k - 1 : k] + 2 * m[k] + m[c < w - 1 ? k + 1 : k]) / 4;
      for (let r = 0; r < h; r++) for (let c = 0, k = r * w; c < w; c++, k++) { const b = (t[r ? k - w : k] + 2 * t[k] + t[r < h - 1 ? k + w : k]) / 4, d = Math.abs(m[k] - b), q = d <= lo ? 0 : d >= hi ? 1 : (d - lo) / (hi - lo); m[k] = b + (m[k] - b) * q * q * (3 - 2 * q); } }
    return { w, h, m, lon0: g.bbox[0], lat1: g.bbox[3], kx: (w - 1) / (g.bbox[2] - g.bbox[0]), ky: (h - 1) / (g.bbox[3] - g.bbox[1]), box: [xOf(g.bbox[0]), yOf(g.bbox[3]), xOf(g.bbox[2]), yOf(g.bbox[1])] };
  }
  function read(g, lon, lat) {
    const c = clamp((lon - g.lon0) * g.kx, 0, g.w - 1.0001), r = clamp((g.lat1 - lat) * g.ky, 0, g.h - 1.0001), i = c | 0, j = r | 0, fx = c - i, fy = r - j, k = j * g.w + i, m = g.m;
    const a = m[k] + (m[k + 1] - m[k]) * fx, b = m[k + g.w] + (m[k + g.w + 1] - m[k + g.w]) * fx; return a + (b - a) * fy;
  }

  // the triangles of a lattice at a point
  function hL(L, x, z) {
    const nx = L.nx, mx = nx - 1, mz = L.nz - 1; let fx = (x - L.x0) / L.S, fz = (z - L.z0) / L.S;
    fx = fx < 0 ? 0 : fx > mx ? mx : fx; fz = fz < 0 ? 0 : fz > mz ? mz : fz; let i = fx | 0, j = fz | 0; if (i >= mx) i = mx - 1; if (j >= mz) j = mz - 1; fx -= i; fz -= j;
    const k = j * nx + i, H = L.H, b = H[k + 1], c = H[k + nx];
    if (fx + fz <= 1) { const a = H[k]; return a + (b - a) * fx + (c - a) * fz; }
    const d = H[k + nx + 1]; return d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
  }
  // the normal the light sees there: the slope across two cells, softened
  function nL(L, x, z, out) {
    const e = L.S, gx = (hL(L, x + e, z) - hL(L, x - e, z)) / (2 * e) * NK, gz = (hL(L, x, z + e) - hL(L, x, z - e)) / (2 * e) * NK, l = Math.sqrt(gx * gx + 1 + gz * gz);
    out[0] = -gx / l; out[1] = 1 / l; out[2] = -gz / l; return out;
  }

  // ---- a polygon cut along a lattice ----
  // rings: [[x, z], ...] each, the solid on the left of the direction of travel (land.js). Every ring gets a point wherever it
  // crosses a line of the lattice, so each of its segments lies in one cell; a cell the outline does not touch is two triangles or
  // nothing; in a cell it passes through, the pieces of outline (chains) are joined along the cell's sides into the polygons of
  // solid ground there, and those are cut into triangles. Returns P (x, z of every vertex), T (triangles: counter-clockwise as
  // land.js counts area, which is clockwise seen from above), R (per ring: the ids of its points in order, and where each came
  // from: the ring's point before it and how far along the edge to the next), LV (the lattice points used: P's id by lattice index)
  function tess(L, rings) {
    const S = L.S, x0 = L.x0, z0 = L.z0, nx = L.nx, nz = L.nz, cx = nx - 1, cz = nz - 1, P = [], T = [], R = [], LV = new Int32Array(nx * nz).fill(-1);
    const lat = (i, j) => { const k = j * nx + i; let v = LV[k]; if (v < 0) { v = LV[k] = P.length / 2; P.push(x0 + i * S, z0 + j * S); } return v; };
    const cellOf = (x, z) => clamp(Math.floor((z - z0) / S), 0, cz - 1) * cx + clamp(Math.floor((x - x0) / S), 0, cx - 1);
    const cells = new Map(), whole = [], ts = [];
    for (const r of rings) {
      const n = r.length, ids = [], src = [];
      for (let a = 0; a < n; a++) {
        const p = r[a], q = r[(a + 1) % n]; ids.push(P.length / 2); src.push(a, 0); P.push(p[0], p[1]); ts.length = 0;
        for (let ax = 0; ax < 2; ax++) { const f0 = (p[ax] - (ax ? z0 : x0)) / S, f1 = (q[ax] - (ax ? z0 : x0)) / S, lo = Math.min(f0, f1), hi = Math.max(f0, f1); for (let li = Math.ceil(lo); li <= hi; li++) { const t = (li - f0) / (f1 - f0); if (t > 1e-9 && t < 1 - 1e-9) ts.push(t); } }
        if (ts.length > 1) ts.sort((u, v) => u - v);
        let last = 0; for (const t of ts) { if (t - last < 1e-9) continue; last = t; ids.push(P.length / 2); src.push(a, t); P.push(p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t); }
      }
      R.push({ ids, src });
      const m = ids.length, seg = new Int32Array(m); for (let k = 0; k < m; k++) { const a = ids[k] * 2, b = ids[(k + 1) % m] * 2; seg[k] = cellOf((P[a] + P[b]) / 2, (P[a + 1] + P[b + 1]) / 2); }
      let s0 = -1; for (let k = 0; k < m; k++) if (seg[k] !== seg[(k + m - 1) % m]) { s0 = k; break; }
      if (s0 < 0) { whole.push({ cell: seg[0], ids }); continue; }                       // a ring inside one cell
      for (let k = 0; k < m;) { const a = s0 + k, c = seg[a % m]; let len = 1; while (k + len < m && seg[(a + len) % m] === c) len++;
        const v = new Array(len + 1); for (let q = 0; q <= len; q++) v[q] = ids[(a + q) % m];
        let list = cells.get(c); if (!list) cells.set(c, list = []); list.push({ v, ui: 0, uo: 0, used: false }); k += len; }
    }
    // cut a simple polygon (ids of P, counter-clockwise) into triangles by its ears; a corner that lies on a straight run is never
    // dropped, only joined by a triangle with no area in plan (it may have one in height: the ground stays closed)
    const X = (a, b, c) => (P[b * 2] - P[a * 2]) * (P[c * 2 + 1] - P[b * 2 + 1]) - (P[b * 2 + 1] - P[a * 2 + 1]) * (P[c * 2] - P[b * 2]);
    function ears(v) {
      let guard = 0;
      while (v.length > 3 && guard++ < 4000) {
        const n = v.length; let cut = -1;
        for (let i = 0; i < n && cut < 0; i++) {
          const a = v[(i + n - 1) % n], b = v[i], c = v[(i + 1) % n]; if (!(X(a, b, c) > 1e-12)) continue;
          let ok = true; for (let k = 0; k < n && ok; k++) { const p = v[k]; if (p === a || p === b || p === c) continue; if (X(a, b, p) > 1e-12 && X(b, c, p) > 1e-12 && X(c, a, p) > 1e-12) ok = false; }
          if (ok) cut = i;
        }
        if (cut < 0) { let bm = Infinity; for (let i = 0; i < n; i++) { const m = Math.abs(X(v[(i + n - 1) % n], v[i], v[(i + 1) % n])); if (m < bm) { bm = m; cut = i; } } }
        const a = v[(cut + n - 1) % n], b = v[cut], c = v[(cut + 1) % n]; if (X(a, b, c) >= 0) T.push(a, b, c); v.splice(cut, 1);   // (never a triangle the wrong way round)
      }
      if (v.length === 3 && X(v[0], v[1], v[2]) >= 0) T.push(v[0], v[1], v[2]);
    }
    // a hole joined into the polygon round it (both lists of ids; the hole runs the other way): by the shortest join between a
    // point of each that crosses no edge of either, walked there and back
    const side = (a, b, p) => (P[b * 2] - P[a * 2]) * (P[p * 2 + 1] - P[a * 2 + 1]) - (P[b * 2 + 1] - P[a * 2 + 1]) * (P[p * 2] - P[a * 2]);
    const crossed = (a, b, ring) => { for (let k = 0, n = ring.length; k < n; k++) { const u = ring[k], w = ring[(k + 1) % n]; if (u === a || u === b || w === a || w === b) continue; if (side(a, b, u) * side(a, b, w) < 0 && side(u, w, a) * side(u, w, b) < 0) return true; } return false; };
    function bridge(poly, hole) {
      let bp = -1, bh = -1, bd = Infinity;
      for (let hi = 0; hi < hole.length; hi++) for (let pi = 0; pi < poly.length; pi++) { const a = hole[hi], b = poly[pi], d = (P[a * 2] - P[b * 2]) ** 2 + (P[a * 2 + 1] - P[b * 2 + 1]) ** 2; if (d < bd && !crossed(a, b, poly) && !crossed(a, b, hole)) { bd = d; bp = pi; bh = hi; } }
      if (bp < 0) return poly;
      const out = poly.slice(0, bp + 1); for (let k = 0; k <= hole.length; k++) out.push(hole[(bh + k) % hole.length]); for (let k = bp; k < poly.length; k++) out.push(poly[k]); return out;
    }
    const inPoly = (poly, x, z) => { let c = false; for (let k = 0, q = poly.length - 1; k < poly.length; q = k++) { const xi = P[poly[k] * 2], zi = P[poly[k] * 2 + 1], xj = P[poly[q] * 2], zj = P[poly[q] * 2 + 1]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
    // rings that lie inside one cell, by cell: islands (polygons of their own) and holes (cut out of the polygon round them)
    const isles = new Map(), holes = new Map();
    for (const w of whole) { let a = 0; for (let k = 0, n = w.ids.length; k < n; k++) { const p = w.ids[k] * 2, q = w.ids[(k + 1) % n] * 2; a += P[p] * P[q + 1] - P[q] * P[p + 1]; } const M = a > 0 ? isles : holes; if (!M.has(w.cell)) M.set(w.cell, []); M.get(w.cell).push(w.ids); }
    const finish = (c, polys) => { for (const hl of holes.get(c) || []) { const k = polys.findIndex(pl => inPoly(pl, P[hl[0] * 2], P[hl[0] * 2 + 1])); if (k >= 0) polys[k] = bridge(polys[k], hl); } polys.forEach(ears); };
    // the cells the outline passes through. A cell's sides, walked with the cell on the left: corner 0 (i, j), 1 (i + 1, j),
    // 2 (i + 1, j + 1), 3 (i, j + 1); u: how far round, 0 to 4
    for (const [c, list] of cells) {
      const i = c % cx, j = (c - i) / cx, ax = x0 + i * S, az = z0 + j * S;
      const uOf = id => { const x = (P[id * 2] - ax) / S, z = (P[id * 2 + 1] - az) / S, d0 = z, d1 = 1 - x, d2 = 1 - z, d3 = x, m = Math.min(d0, d1, d2, d3); return m === d0 ? clamp(x, 0, 1) : m === d1 ? 1 + clamp(z, 0, 1) : m === d2 ? 2 + clamp(1 - x, 0, 1) : 3 + clamp(1 - z, 0, 1); };
      for (const ch of list) { ch.ui = uOf(ch.v[0]); ch.uo = uOf(ch.v[ch.v.length - 1]); }
      const polys = (isles.get(c) || []).map(r => r.slice());
      for (const c0 of list) {
        if (c0.used) continue; const poly = []; let ch = c0, guard = 0;
        while (ch && !ch.used && guard++ < 500) {
          ch.used = true; for (let q = poly.length && poly[poly.length - 1] === ch.v[0] ? 1 : 0; q < ch.v.length; q++) poly.push(ch.v[q]);
          // along the side from where this chain leaves to the nearest point where a chain comes in (its own start closes the polygon)
          let best = null, bd = 9; for (const o of list) { let d = o.ui - ch.uo; d -= Math.floor(d / 4) * 4; if (d > 4 - 1e-7) d = 0; if (d < bd) { bd = d; best = o; } }
          for (let k = Math.floor(ch.uo + 1e-7) + 1; k < ch.uo + bd - 1e-7; k++) { const q = k & 3; poly.push(lat(i + (q === 1 || q === 2 ? 1 : 0), j + (q >= 2 ? 1 : 0))); }
          ch = best;
        }
        if (poly.length > 1 && poly[0] === poly[poly.length - 1]) poly.pop();
        polys.push(poly);
      }
      finish(c, polys);
    }
    // the cells with such rings that the outline does not pass through: whole (by a corner: is it in the place?) or empty round them
    const special = new Set();
    for (const c of new Set([...isles.keys(), ...holes.keys()])) {
      special.add(c); if (cells.has(c)) continue;
      const i = c % cx, j = (c - i) / cx, qx = x0 + i * S + 1e-7, qz = z0 + j * S + 1e-7, polys = (isles.get(c) || []).map(r => r.slice()); let ins = false;
      for (const r of rings) for (let k = 0, q = r.length - 1; k < r.length; q = k++) if ((r[k][1] > qz) !== (r[q][1] > qz) && qx < (r[q][0] - r[k][0]) * (qz - r[k][1]) / (r[q][1] - r[k][1]) + r[k][0]) ins = !ins;
      if (ins) polys.push([lat(i, j), lat(i + 1, j), lat(i + 1, j + 1), lat(i, j + 1)]);
      finish(c, polys);
    }
    // every other cell: whole or empty, by its middle (a scan line a row)
    const rows = Array.from({ length: cz }, () => []);
    for (const r of rings) for (let k = 0, q = r.length - 1; k < r.length; q = k++) {
      const a = r[q], b = r[k]; if (a[1] === b[1]) continue; const lo = Math.min(a[1], b[1]), hi = Math.max(a[1], b[1]);
      for (let j = Math.max(0, Math.ceil((lo - z0) / S - 0.5)); j < cz; j++) { const z = z0 + (j + 0.5) * S; if (z >= hi) break; if (z < lo) continue; rows[j].push(a[0] + (z - a[1]) * (b[0] - a[0]) / (b[1] - a[1])); }
    }
    for (let j = 0; j < cz; j++) {
      const xs = rows[j]; if (xs.length < 2) continue; xs.sort((u, v) => u - v);
      for (let m = 0; m + 1 < xs.length; m += 2) for (let i = Math.max(0, Math.ceil((xs[m] - x0) / S - 0.5)); i < cx && x0 + (i + 0.5) * S < xs[m + 1]; i++) {
        const c = j * cx + i; if (cells.has(c) || special.has(c)) continue;
        const a = lat(i, j), b = lat(i + 1, j), d = lat(i + 1, j + 1), e = lat(i, j + 1); T.push(a, b, e, b, d, e);
      }
    }
    return { P, T, R, LV };
  }

  // ---- one place's piece on a lattice: the ground, then the rounded edge and the wall hung from its rim ----
  // S: land.js's sink. rings: the block's outline (the outer ring, then its holes). nb: segments in the rounded edge.
  // Returns tops (the outline of the top, as land.js's addBlock gives it) and edge (the rim as it lies: [x, y, z] per point, per ring)
  const N3 = [0, 1, 0];
  function addPiece(S, L, rings, tid, nb) {
    const frames = rings.map(r => {
      const n = r.length, nm = new Array(n), mi = new Array(n);
      for (let i = 0; i < n; i++) {
        const a = r[(i - 1 + n) % n], p = r[i], b = r[(i + 1) % n];
        let ex = p[0] - a[0], ey = p[1] - a[1], fx = b[0] - p[0], fy = b[1] - p[1]; const le = Math.hypot(ex, ey) || 1, lf = Math.hypot(fx, fy) || 1; ex /= le; ey /= le; fx /= lf; fy /= lf;
        let mx = ey + fy, my = -ex - fx; const ml = Math.hypot(mx, my); if (ml < 1e-6) { mx = ey; my = -ex; } else { mx /= ml; my /= ml; }
        nm[i] = [mx, my]; mi[i] = 1 / Math.max(0.55, mx * ey - my * ex);
      }
      return { r, nm, mi };
    });
    // (where the inset outline would run backwards, at a sharp corner between two near points, that edge is closed to a point)
    const tops = frames.map(f => { const r = f.r, n = r.length, t = r.map((p, i) => { const q = BEV * f.mi[i]; return [p[0] - f.nm[i][0] * q, p[1] - f.nm[i][1] * q]; });
      for (let i = 0; i < n; i++) { const j = (i + 1) % n; if ((t[j][0] - t[i][0]) * (r[j][0] - r[i][0]) + (t[j][1] - t[i][1]) * (r[j][1] - r[i][1]) <= 0) { const mx = (t[i][0] + t[j][0]) / 2, mz = (t[i][1] + t[j][1]) / 2; t[i] = [mx, mz]; t[j] = [mx, mz]; } }
      return t; });
    const t = tess(L, tops), P = t.P, base = S.n, nP = P.length / 2;
    for (let v = 0; v < nP; v++) { const x = P[v * 2], z = P[v * 2 + 1]; nL(L, x, z, N3); S.v(x, hL(L, x, z), z, N3[0], N3[1], N3[2], tid, 1, KIND.top); }
    for (let k = 0; k < t.T.length; k += 3) S.idx.push(base + t.T[k], base + t.T[k + 2], base + t.T[k + 1]);       // facing up
    const edge = [];
    frames.forEach((f, ri) => {
      const { r, nm, mi } = f, n = r.length, ids = t.R[ri].ids, src = t.R[ri].src, m = ids.length, ring3 = new Array(m);
      // rows from the rim down to the foot of the wall: [inset, drop below the rim, normal-out share, normal-up share, kind, shade]
      const rows = []; for (let k = nb; k >= 0; k--) { const th = k / nb * Math.PI / 2; rows.push([BEV * (1 - Math.cos(th)), BEV * (1 - Math.sin(th)), Math.cos(th), Math.sin(th), k ? KIND.bevel : KIND.wallTop, 1]); }
      rows.push([0, -1, 1, 0, KIND.contact, 0.86], [0, -2, 1, 0, KIND.foot, 0.6]);
      const NR = rows.length, rid = rows.map(() => new Int32Array(m));
      for (let q = 0; q < m; q++) {
        const a = src[q * 2], tt = src[q * 2 + 1], b = (a + 1) % n, v = ids[q], x = P[v * 2], z = P[v * 2 + 1], y = S.pos[(base + v) * 3 + 1];
        const nx = S.nor[(base + v) * 3], ny = S.nor[(base + v) * 3 + 1], nz = S.nor[(base + v) * 3 + 2];
        let ox = nm[a][0] + (nm[b][0] - nm[a][0]) * tt, oz = nm[a][1] + (nm[b][1] - nm[a][1]) * tt; const ol = Math.hypot(ox, oz) || 1; ox /= ol; oz /= ol;
        // the outline's own point under this rim point, and from it each row's
        const pa = r[a], pb = r[b], qa = mi[a], qb = mi[b], na = nm[a], nb2 = nm[b];
        ring3[q] = [x, y, z]; rid[0][q] = S.v(x, y, z, nx, ny, nz, tid, 1, rows[0][4]);
        for (let k = 1; k < NR; k++) {
          const row = rows[k], d = row[0], drop = row[1], co = row[2], up = row[3], xa = pa[0] - na[0] * d * qa, za = pa[1] - na[1] * d * qa, xb = pb[0] - nb2[0] * d * qb, zb = pb[1] - nb2[1] * d * qb;
          const yy = drop === -1 ? Math.min(y - BEV - 0.02, LAND_TOP + 0.16) : drop === -2 ? FLOOR : y - drop, ax = ox * co + nx * up, ay = ny * up, az = oz * co + nz * up, al = Math.sqrt(ax * ax + ay * ay + az * az) || 1;
          rid[k][q] = S.v(xa + (xb - xa) * tt, yy, za + (zb - za) * tt, ax / al, ay / al, az / al, tid, row[5], row[4]);
        }
      }
      // winding: as land.js's addBlock, by the longest step of the wall
      let flip = false;
      { let best = 0, bi = 0; for (let q = 0; q < m; q++) { const a = ring3[q], b = ring3[(q + 1) % m], l = Math.hypot(b[0] - a[0], b[2] - a[2]); if (l > best) { best = l; bi = q; } }
        const j = (bi + 1) % m, Pp = S.pos, v = id => [Pp[id * 3], Pp[id * 3 + 1], Pp[id * 3 + 2]], a = v(rid[nb][bi]), b = v(rid[nb + 1][bi]), c = v(rid[nb][j]);
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], wx = u[1] * w[2] - u[2] * w[1], wz = u[0] * w[1] - u[1] * w[0];
        const a0 = src[bi * 2], tt = src[bi * 2 + 1], b0 = (a0 + 1) % n; flip = wx * (nm[a0][0] + (nm[b0][0] - nm[a0][0]) * tt) + wz * (nm[a0][1] + (nm[b0][1] - nm[a0][1]) * tt) < 0; }
      for (let k = 0; k + 1 < rid.length; k++) { const U = rid[k], D = rid[k + 1]; for (let q = 0; q < m; q++) { const j = (q + 1) % m; if (flip) S.idx.push(U[q], U[j], D[q], U[j], D[j], D[q]); else S.idx.push(U[q], D[q], U[j], U[j], D[q], D[j]); } }
      edge.push(ring3);
    });
    return { tops, edge, tris: t.T.length / 3 };
  }

  // ---- the relief of the map: every place's lattice, and the meshes made from them ----
  // TD: js/map3d/terrain.js's data. BB: each place's box in map units (the flat map's). Throws when the grids are not whole.
  function make(TD, BB) {
    const bay = grid(TD && TD.bay, true), sf = grid(TD && TD.sf, false), sb = sf.box;
    const metres = (x, y) => { const lon = lonOf(x), la = latOf(y), d = Math.min(x - sb[0], sb[2] - x, y - sb[1], sb[3] - y); if (d <= 0) return read(bay, lon, la); const m = read(sf, lon, la); if (d >= MARGIN) return m; const w = d / MARGIN, s = w * w * (3 - 2 * w), b = read(bay, lon, la); return b + (m - b) * s; };
    const heightAt = (x, z) => curve(metres(x, z));
    const SFC = Geom.proj([-122.44, 37.76]), n = HOODS.length, LAT = new Array(n).fill(null), FAR = new Array(n).fill(null), max = new Float32Array(n), min = new Float32Array(n), fine = new Uint8Array(n), near = new Uint8Array(n);   // near: in or beside the city (its edge is rounded in two steps, further out in one)
    function lattice(b, S) {
      const pad = 1.3 + S, x0 = OX + Math.floor((b[0] - pad - OX) / SC) * SC, z0 = OZ + Math.floor((b[1] - pad - OZ) / SC) * SC; let nx = Math.ceil((b[2] + pad - x0) / S) + 1, nz = Math.ceil((b[3] + pad - z0) / S) + 1;
      if (S === SF) { nx += (4 - (nx - 1) % 4) % 4; nz += (4 - (nz - 1) % 4) % 4; }                      // so that every fourth point makes a whole lattice
      const H = new Float32Array(nx * nz), lons = new Float64Array(nx); for (let i = 0; i < nx; i++) lons[i] = lonOf(x0 + i * S);
      const inSf = x0 > sb[0] + MARGIN && x0 + (nx - 1) * S < sb[2] - MARGIN && z0 > sb[1] + MARGIN && z0 + (nz - 1) * S < sb[3] - MARGIN, out = x0 + (nx - 1) * S < sb[0] || x0 > sb[2] || z0 + (nz - 1) * S < sb[1] || z0 > sb[3];
      for (let j = 0, k = 0; j < nz; j++) { const z = z0 + j * S, la = latOf(z); for (let i = 0; i < nx; i++, k++) H[k] = curveT(inSf ? read(sf, lons[i], la) : out ? read(bay, lons[i], la) : metres(x0 + i * S, z)); }
      return { S, x0, z0, nx, nz, H };
    }
    HOODS.forEach((hd, i) => {
      const b = BB[i]; if (!b || (REG[hd.region] && REG[hd.region].away)) return;                          // no grid there: a plateau, as before
      // fine: the places the fine grid covers (three tenths of their box or more: the Headlands reach past its edge); the rest by how far from the city they are, and never too coarse for their size
      const ov = Math.max(0, Math.min(b[2], sb[2] - MARGIN) - Math.max(b[0], sb[0] + MARGIN)) * Math.max(0, Math.min(b[3], sb[3] - MARGIN) - Math.max(b[1], sb[1] + MARGIN)), area = (b[2] - b[0]) * (b[3] - b[1]) || 1;
      const inFine = ov / area >= 0.3, d = Math.hypot(hd.cx - SFC[0], hd.cy - SFC[1]), side = Math.sqrt(area);
      let S = inFine ? SF : d < 95 ? 1.6 : d < 230 ? 3.2 : 6.4; while (S > 1.6 && side < 7 * S) S /= 2;
      if (S > 1.6) { let lo = Infinity, hi = -Infinity; for (let q = 0; q <= 8; q++) for (let r = 0; r <= 8; r++) { const v = heightAt(b[0] + (b[2] - b[0]) * q / 8, b[1] + (b[3] - b[1]) * r / 8); if (v < lo) lo = v; if (v > hi) hi = v; } if (hi - lo > (d < 260 ? 3.4 : 5.5)) S /= 2; } // hill country is read more closely than a plain
      const L = LAT[i] = lattice(b, S); fine[i] = inFine ? 1 : 0; near[i] = inFine || d < 95 ? 1 : 0;
      if (inFine) { const cnx = (L.nx - 1) / 4 + 1, cnz = (L.nz - 1) / 4 + 1, H = new Float32Array(cnx * cnz); for (let j = 0; j < cnz; j++) for (let k = 0; k < cnx; k++) H[j * cnx + k] = L.H[j * 4 * L.nx + k * 4]; FAR[i] = { S: SC, x0: L.x0, z0: L.z0, nx: cnx, nz: cnz, H }; }
      let lo = Infinity, hi = -Infinity; for (let k = 0; k < L.H.length; k++) { const v = L.H[k]; if (v < lo) lo = v; if (v > hi) hi = v; } min[i] = lo; max[i] = hi;
    });
    const has = i => !!LAT[i], h = (i, x, z) => hL(LAT[i], x, z);
    // the blocks of every place, as land.js's buildTiles gives them, the places with a far mesh last (so they can be left undrawn
    // while their full meshes are): tiles[i] also carries edge (the rim as it lies) and, for those, far: true. split: the index
    // count before them
    function buildTiles(o) {
      const S = land.sink(), tiles = new Array(n); let split = 0;
      const one = i => {
        const L = FAR[i] || LAT[i], t = { i, H: L ? max[i] : land.topOf(i), v0: S.n, i0: S.idx.length, tops: [], edge: [], rim: [], far: !!FAR[i], relief: !!L }; let hi = -Infinity;
        for (const rings of o.blocks[i] || []) {
          if (!L) { try { const top = land.addBlock(S, rings, t.H, i); t.tops.push(top); t.edge.push(...top); top.forEach(r => t.rim.push(r.map(p => [p[0], t.H, p[1]]))); } catch (e) { /* a ring the triangulator refuses: that piece is left out */ } continue; }
          const pc = addPiece(S, L, rings, i, near[i] ? 2 : 1); t.tops.push(pc.tops); t.edge.push(...pc.tops); t.rim.push(...pc.edge);
        }
        if (L && !FAR[i]) { for (let v = t.v0; v < S.n; v++) if (S.kind[v] === KIND.top && S.pos[v * 3 + 1] > hi) hi = S.pos[v * 3 + 1]; if (hi > -Infinity) max[i] = t.H = hi; }   // the top of the piece itself (the lattice reaches past it)
        t.v1 = S.n; t.i1 = S.idx.length; tiles[i] = t;
      };
      for (let i = 0; i < n; i++) if (!FAR[i]) one(i); split = S.idx.length; for (let i = 0; i < n; i++) if (FAR[i]) one(i);
      return { tiles, mesh: S, split };
    }
    // the full piece of a fine place, into a sink of its own: { v0, v1, i0, i1, rim }
    function buildFine(S, i, blocks) {
      const out = { v0: S.n, i0: S.idx.length, rim: [] }; let hi = -Infinity;
      for (const rings of blocks[i] || []) out.rim.push(...addPiece(S, LAT[i], rings, i, 1).edge);
      for (let v = out.v0; v < S.n; v++) if (S.kind[v] === KIND.top && S.pos[v * 3 + 1] > hi) hi = S.pos[v * 3 + 1]; if (hi > -Infinity) max[i] = hi;
      out.v1 = S.n; out.i1 = S.idx.length; return out;
    }
    // lines laid on a place's ground: segs [ax, az, bx, bz, ...] cut wherever they cross a line or a diagonal of its lattice, so
    // each piece lies in one triangle. Returns { segs, hs: the height at each end }
    function drape(i, segs) {
      const L = LAT[i], S = L.S, out = [], hs = [], ts = [];
      for (let s = 0; s < segs.length; s += 4) {
        const ax = segs[s], az = segs[s + 1], bx = segs[s + 2], bz = segs[s + 3], fa = [(ax - L.x0) / S, (az - L.z0) / S], fb = [(bx - L.x0) / S, (bz - L.z0) / S]; fa.push(fa[0] + fa[1]); fb.push(fb[0] + fb[1]); ts.length = 0;
        for (let q = 0; q < 3; q++) { const lo = Math.min(fa[q], fb[q]), hi = Math.max(fa[q], fb[q]); for (let li = Math.ceil(lo); li <= hi; li++) { const t = (li - fa[q]) / (fb[q] - fa[q]); if (t > 1e-6 && t < 1 - 1e-6) ts.push(t); } }
        ts.sort((u, v) => u - v); ts.push(1); let px = ax, pz = az, ph = hL(L, ax, az);
        for (const t of ts) { const x = ax + (bx - ax) * t, z = az + (bz - az) * t, hh = hL(L, x, z); if (Math.abs(x - px) + Math.abs(z - pz) > 1e-7) { out.push(px, pz, x, z); hs.push(ph, hh); } px = x; pz = z; ph = hh; }
      }
      return { segs: out, hs };
    }
    // a polygon laid on a place's ground (a section's tint): { pos: [x, y, z, ...], idx }
    function fill(i, ring) {
      const L = LAT[i]; let a = 0; for (let k = 0, q = ring.length - 1; k < ring.length; q = k++) a += ring[q][0] * ring[k][1] - ring[k][0] * ring[q][1];
      const t = tess(L, [a > 0 ? ring : ring.slice().reverse()]), pos = [], idx = [];
      for (let v = 0; v < t.P.length; v += 2) pos.push(t.P[v], hL(L, t.P[v], t.P[v + 1]), t.P[v + 1]);
      for (let k = 0; k < t.T.length; k += 3) idx.push(t.T[k], t.T[k + 2], t.T[k + 1]);
      return { pos, idx };
    }
    // where a ray first goes under place i's ground between ta and tb (the point (ox, oy, oz) + t (dx, dy, dz); the ground stands
    // lift higher and is stretched by vex, as the scene draws it): walked from one line or diagonal of the lattice to the next, so
    // within each step the ground is one triangle and the crossing is exact. -1: it stays above
    function ray(i, ox, oy, oz, dx, dy, dz, ta, tb, lift, vex) {
      const L = LAT[i], S = L.S, g = t => oy + dy * t - (hL(L, ox + dx * t, oz + dz * t) + lift) * vex; let t = ta, gp = g(t); if (gp <= 0) return ta;
      const a0 = (ox - L.x0) / S, a1 = (oz - L.z0) / S, a2 = a0 + a1, d0 = dx / S, d1 = dz / S, d2 = d0 + d1;
      const next = (a, d) => { if (Math.abs(d) < 1e-12) return Infinity; const v = a + d * t, k = d > 0 ? Math.floor(v + 1e-9) + 1 : Math.ceil(v - 1e-9) - 1; return (k - a) / d; };
      for (let q = 0; q < 30000; q++) {
        let tn = Math.min(next(a0, d0), next(a1, d1), next(a2, d2)); if (!(tn < tb)) tn = tb; const gn = g(tn);
        if (gn <= 0) return t + (tn - t) * gp / (gp - gn); if (tn >= tb) return -1; t = tn; gp = gn;
      }
      return -1;
    }
    const fineList = []; for (let i = 0; i < n; i++) if (FAR[i]) fineList.push(i);
    return { heightAt, has, h, max, min, fine, fineList, step: i => LAT[i].S, ray, buildTiles, buildFine, drape, fill, lattices: LAT };
  }

  M3D.relief = { make, tess, curve, KH, KP, M0 };
})();
