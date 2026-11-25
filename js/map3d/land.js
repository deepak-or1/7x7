// Seven by Seven, the 3D map: the land. Loaded only when the 3D map is wanted (index.html), before js/map3d.js builds its scene.
// Each place is one plateau block, like a piece of a precision-cut wooden relief puzzle: a flat top at a height taken from its real
// high point, an even rounded edge all the way round, a straight wall down to the ground, and a hairline gap to its neighbours.
// The outline of a block comes from a signed distance field of the place's real boundary (data/geo.js): opened and closed with the
// same radius everywhere (so piers and slivers narrower than the radius go, every corner is rounded, and two neighbours stay apart
// by construction), then traced at a small inset, the gap. That takes about a second, so tools/blocks3d.js does it ahead of time
// into js/map3d/blocks.js (window.M3D_BLOCKS); outlines() here is the same code, run in the page when that file is missing or was
// made from other boundaries (its signature says which). World frame: x = map x, z = map y (south), y = up; one unit is one map
// unit, about 143 m. Needs js/geom.js; the mesh builders (not the outlines) need THREE for its polygon triangulator.
(function () {
  'use strict';
  const G = window.GEO, HP = window.HP, Geom = window.Geom, REG = window.REGIONS || {};
  const proj = Geom.proj, pip = Geom.pip;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const HOODS = G.hoods, POLYS = []; { const idx = {}; HOODS.forEach((h, i) => { idx[h.name] = i; }); HP.forEach(h => { if (idx[h.name] != null) POLYS[idx[h.name]] = h.polys; }); } // lon/lat, by place index (as js/map.js pairs them)

  // ---- the numbers (world units) ----
  const VERSION = 2;       // of the outline recipe below: part of the signature
  const LAND_TOP = 0.16;   // the quiet land around and under the blocks (the floor seen in the gaps)
  const FLOOR = -0.06;     // wall feet: just under the water and the land, so a lifted block shows no seam
  const TOP0 = 0.5;        // the top of a block at sea level
  const KH = 0.085, KP = 0.6; // block height above TOP0 = KH * metres^KP: 10 m 0.34, 100 m 1.34, Twin Peaks (281 m) 2.5, Mount Tam 4.9
  const GAP = 0.1;         // the hairline between two blocks (each block gives half)
  const BEV = 0.085;       // the radius of the rounded top edge
  const NB = 2;            // segments in the rounded edge
  const SFC = proj([-122.44, 37.76]);
  // the top of place i: from its high point above its region's floor (sea level; an away region's own)
  const topOf = i => { const hd = HOODS[i], low = REG[hd.region] && REG[hd.region].low ? REG[hd.region].low.m : 0; return TOP0 + KH * Math.pow(Math.max(0, hd.max - low), KP); };

  // ---- ring helpers (map units) ----
  const sArea = r => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1]; return a / 2; };
  function segDist2(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy; let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + dx * t - px, qy = ay + dy * t - py; return qx * qx + qy * qy;
  }
  function simplify(r, tol) {
    if (r.length < 5 || !(tol > 0)) return r;
    let k = 0, md = -1; for (let i = 1; i < r.length; i++) { const d = (r[i][0] - r[0][0]) ** 2 + (r[i][1] - r[0][1]) ** 2; if (d > md) { md = d; k = i; } }
    const keep = new Uint8Array(r.length); keep[0] = keep[k] = 1; const t2 = tol * tol, n = r.length;
    const stack = [[0, k], [k, n]];
    while (stack.length) {
      const [a, b] = stack.pop(), A = r[a], B = r[b % n]; let mi = -1, m = t2;
      for (let i = a + 1; i < b; i++) { const d = segDist2(r[i][0], r[i][1], A[0], A[1], B[0], B[1]); if (d > m) { m = d; mi = i; } }
      if (mi >= 0) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
    }
    return r.filter((_, i) => keep[i]);
  }
  // lon/lat ring -> map units, without the closing point or near-duplicates, simplified, wound so the solid is on the left
  function cleanRing(ll, tol, hole) {
    let r = ll.map(proj);
    if (r.length > 1 && Math.hypot(r[0][0] - r[r.length - 1][0], r[0][1] - r[r.length - 1][1]) < 1e-6) r.pop();
    const out = []; for (const p of r) { const q = out[out.length - 1]; if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.02) out.push(p); }
    r = simplify(out, tol);
    if (r.length < 3) return null;
    const a = sArea(r); if (Math.abs(a) < 0.02) return null;
    if ((a > 0) === !!hole) r.reverse();
    return r;
  }
  // a mesh sink: positions, normals, indices, and per vertex the place it belongs to, a baked shade and its kind
  function sink() {
    const o = { pos: [], nor: [], idx: [], tid: [], shade: [], kind: [], n: 0 };
    o.v = (x, y, z, nx, ny, nz, tid, shade, kind) => { o.pos.push(x, y, z); o.nor.push(nx, ny, nz); o.tid.push(tid); o.shade.push(shade); o.kind.push(kind); return o.n++; };
    return o;
  }

  // ---- signed distance on a grid, banded: |f| is exact up to B from the line, B beyond; negative inside ----
  function grid(bb, h, B) {
    const p = B + 2 * h, x0 = bb[0] - p, y0 = bb[1] - p;
    return { x0, y0, h, B, nx: Math.ceil((bb[2] + p - x0) / h) + 1, ny: Math.ceil((bb[3] + p - y0) / h) + 1 };
  }
  // the inside of a set of rings (even-odd), by scanlines: -B inside, +B outside
  function insideOf(g, rings) {
    const f = new Float32Array(g.nx * g.ny).fill(g.B), rows = Array.from({ length: g.ny }, () => []);
    for (const r of rings) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const a = r[j], b = r[i]; if (a[1] === b[1]) continue;
      const ya = Math.min(a[1], b[1]), yb = Math.max(a[1], b[1]), j0 = Math.max(0, Math.ceil((ya - g.y0) / g.h)), j1 = Math.min(g.ny - 1, Math.ceil((yb - g.y0) / g.h) - 1);
      for (let k = j0; k <= j1; k++) { const y = g.y0 + k * g.h; rows[k].push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1])); }
    }
    for (let k = 0; k < g.ny; k++) {
      const xs = rows[k]; if (xs.length < 2) continue; xs.sort((p, q) => p - q);
      for (let m = 0; m + 1 < xs.length; m += 2) { const i0 = Math.max(0, Math.ceil((xs[m] - g.x0) / g.h)), i1 = Math.min(g.nx - 1, Math.floor((xs[m + 1] - g.x0) / g.h)); for (let i = i0; i <= i1; i++) f[k * g.nx + i] = -g.B; }
    }
    return f;
  }
  // the inside of a level set of another field, as -B / +B
  function insideBelow(g, f, lv) { const o = new Float32Array(f.length); for (let k = 0; k < f.length; k++) o[k] = f[k] < lv ? -g.B : g.B; return o; }
  // distances to segments [ax, ay, bx, by, ...] within the band, keeping each node's sign
  function distTo(g, f, segs, band) {
    const { x0, y0, h, nx, ny } = g, B = Math.min(g.B, band || g.B);
    for (let s = 0; s < segs.length; s += 4) {
      const ax = segs[s], ay = segs[s + 1], bx = segs[s + 2], by = segs[s + 3], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1e-12;
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - B - x0) / h)), i1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx) + B - x0) / h));
      const j0 = Math.max(0, Math.floor((Math.min(ay, by) - B - y0) / h)), j1 = Math.min(ny - 1, Math.ceil((Math.max(ay, by) + B - y0) / h));
      for (let j = j0; j <= j1; j++) {
        const py = y0 + j * h, row = j * nx;
        for (let i = i0; i <= i1; i++) {
          const px = x0 + i * h; let t = ((px - ax) * dx + (py - ay) * dy) / l2; t = t < 0 ? 0 : t > 1 ? 1 : t;
          const qx = ax + dx * t - px, qy = ay + dy * t - py, d2 = qx * qx + qy * qy, k = row + i, v = f[k], av = v < 0 ? -v : v;
          if (d2 < av * av) { const d = Math.sqrt(d2); f[k] = v < 0 ? -d : d; }
        }
      }
    }
    return f;
  }
  // marching squares: the line f = lv as pairs of grid-edge ids, and the point on each edge
  function contour(g, f, lv) {
    const { x0, y0, h, nx, ny } = g, pairs = [], pts = new Map();
    const P = e => { let p = pts.get(e); if (p) return p; const k = e >> 1, i = k % nx, j = (k - i) / nx, a = f[k];
      if (e & 1) { const t = (lv - a) / (f[k + nx] - a); p = [x0 + i * h, y0 + (j + t) * h]; } else { const t = (lv - a) / (f[k + 1] - a); p = [x0 + (i + t) * h, y0 + j * h]; }
      pts.set(e, p); return p; };
    for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const k = j * nx + i, cs = (f[k] < lv ? 1 : 0) | (f[k + 1] < lv ? 2 : 0) | (f[k + nx + 1] < lv ? 4 : 0) | (f[k + nx] < lv ? 8 : 0);
      if (!cs || cs === 15) continue;
      const Te = k * 2, Be = (k + nx) * 2, Le = k * 2 + 1, Re = (k + 1) * 2 + 1;
      switch (cs) {
        case 1: case 14: pairs.push(Le, Te); break;
        case 2: case 13: pairs.push(Te, Re); break;
        case 3: case 12: pairs.push(Le, Re); break;
        case 4: case 11: pairs.push(Re, Be); break;
        case 6: case 9: pairs.push(Te, Be); break;
        case 7: case 8: pairs.push(Le, Be); break;
        case 5: case 10: { const mid = (f[k] + f[k + 1] + f[k + nx + 1] + f[k + nx]) / 4 < lv; if ((cs === 5) === mid) pairs.push(Te, Re, Be, Le); else pairs.push(Le, Te, Re, Be); break; }
      }
    }
    return { pairs, P };
  }
  function loopsOf(c) {
    const adj = new Map(), out = [], seen = new Set();
    for (let q = 0; q < c.pairs.length; q += 2) { const a = c.pairs[q], b = c.pairs[q + 1]; if (!adj.has(a)) adj.set(a, []); if (!adj.has(b)) adj.set(b, []); adj.get(a).push(b); adj.get(b).push(a); }
    for (const start of adj.keys()) {
      if (seen.has(start)) continue; const loop = []; let prev = -1, cur = start;
      while (cur !== undefined && !seen.has(cur)) { seen.add(cur); const p = c.P(cur), q = loop[loop.length - 1]; if (!q || Math.abs(p[0] - q[0]) + Math.abs(p[1] - q[1]) > 1e-5) loop.push(p); const nb = adj.get(cur), nx = nb[0] !== prev ? nb[0] : nb[1]; prev = cur; cur = nx; }
      if (loop.length >= 4) out.push(loop);
    }
    return out;
  }
  // the contour's segments for a distance pass: as loops, lightly simplified (straight runs become one segment)
  const segsLite = (c, tol) => loopsOf(c).flatMap(l => { const r = l.length >= 5 ? simplify(l, tol) : l; return r.flatMap((p, i) => { const q = r[(i + 1) % r.length]; return [p[0], p[1], q[0], q[1]]; }); });

  // ---- the outline of one piece of a place, in two passes ----
  // Pass 1 opens it (erode by rho, grow back): piers and slivers narrower than 2 rho go and every outward corner is rounded; a
  // bigger place gets a bigger rho (smoother, fewer points), so rho differs between neighbours. Pass 2 closes it (grow by rho,
  // erode back: notches fill, inward corners round) but never within GAP / 2 of a neighbour's opened shape, so two blocks can
  // not overlap whatever their radii; the line is then traced GAP / 2 inside.
  const ringSegs = rings => rings.flatMap(r => r.flatMap((p, i) => { const q = r[(i + 1) % r.length]; return [p[0], p[1], q[0], q[1]]; }));
  function openPiece(rings, bb, area, city, far) {
    const rho = clamp(0.0045 * Math.sqrt(area) + far * 0.25, city ? 0.17 : 0.26, 0.7), h = clamp(rho / 3.3, 0.05, 0.17), g = grid(bb, h, 2 * rho + 0.25), lt = h * 0.04;
    const f0 = distTo(g, insideOf(g, rings), ringSegs(rings), rho + 2 * h);
    const f1 = distTo(g, insideBelow(g, f0, -rho), segsLite(contour(g, f0, -rho), lt), 2 * rho + 2 * h);   // the eroded shape; f1 - rho is the opened one
    const open = contour(g, f1, rho), grown = contour(g, f1, 2 * rho);               // its outline, and grown by rho more
    const openLoops = loopsOf(open).map(l => l.length >= 5 ? simplify(l, lt) : l), grownLoops = loopsOf(grown).map(l => l.length >= 5 ? simplify(l, lt) : l);
    const ob = [Infinity, Infinity, -Infinity, -Infinity]; for (const l of openLoops) for (const p of l) { ob[0] = Math.min(ob[0], p[0]); ob[1] = Math.min(ob[1], p[1]); ob[2] = Math.max(ob[2], p[0]); ob[3] = Math.max(ob[3], p[1]); }
    return { g, rho, h, area, far, grownLoops, grownSegs: ringSegs(grownLoops), openLoops, openSegs: ringSegs(openLoops), ob };
  }
  function closePiece(pc, others) {
    const { g, rho, h } = pc, B = g.B, gx1 = g.x0 + g.nx * h, gy1 = g.y0 + g.ny * h;
    const tol = 0.012 + h * 0.25 + 0.001 * Math.sqrt(pc.area) + pc.far * 0.16, lv = -(GAP / 2 + tol * 0.5);
    const f2 = distTo(g, insideOf(g, pc.grownLoops), pc.grownSegs, rho + GAP + tol + 2 * h);                     // f2 + rho: the closed shape
    const near = others.filter(o => o !== pc && o.ob[0] < gx1 + B && o.ob[2] > g.x0 - B && o.ob[1] < gy1 + B && o.ob[3] > g.y0 - B);
    if (near.length) {
      const dN = distTo(g, insideOf(g, near.flatMap(o => o.openLoops)), near.flatMap(o => o.openSegs), GAP + tol + 2 * h);
      for (let k = 0; k < f2.length; k++) { const a = f2[k] + rho, b = -dN[k]; f2[k] = a > b ? a : b; }
    } else for (let k = 0; k < f2.length; k++) f2[k] += rho;
    const loops = loopsOf(contour(g, f2, lv)).map(l => simplify(l, tol)).filter(l => l.length >= 4 && Math.abs(sArea(l)) > 0.03);
    // outers and holes by nesting depth
    const depth = loops.map((l, a) => loops.reduce((n, o, b) => n + (a !== b && pip(o, l[0][0], l[0][1]) ? 1 : 0), 0));
    loops.forEach((l, a) => { const outer = depth[a] % 2 === 0; if ((sArea(l) > 0) !== outer) l.reverse(); });
    const out = [];
    loops.forEach((l, a) => { if (depth[a] % 2 === 0) out.push({ outer: l, holes: [], A: Math.abs(sArea(l)) }); });
    loops.forEach((l, a) => { if (depth[a] % 2 === 1) { let best = null; for (const o of out) if (pip(o.outer, l[0][0], l[0][1]) && (!best || o.A < best.A)) best = o; if (best) best.holes.push(l); } });
    return out;
  }

  // Where two places claim the same ground (Tiburon's boundary takes in Angel Island, which is also a place of its own), the later
  // place in the list keeps it, as the flat map paints later places over earlier ones: the earlier place's piece gets no block.
  // covered()[i]: which of place i's pieces (by their order in its boundary) lie under a later place
  let COVERED = null;
  function covered() {
    if (COVERED) return COVERED;
    const P = HOODS.map((hd, i) => (POLYS[i] || []).map(poly => { const r = poly[0].map(proj); return { r, c: Geom.centroid(r), bb: Geom.bboxOf([r]) }; }));
    const inside = (a, b) => a.c[0] >= b.bb[0] && a.c[0] <= b.bb[2] && a.c[1] >= b.bb[1] && a.c[1] <= b.bb[3] && pip(b.r, a.c[0], a.c[1]); // a's centre in b
    return COVERED = P.map((list, i) => { const out = new Set(); list.forEach((a, k) => { for (let j = i + 1; j < P.length && !out.has(k); j++) if (P[j].some(b => inside(a, b) && inside(b, a))) out.add(k); }); return out; });
  }
  // what the outlines were made from: the canvas, every place's name, region and anchor, and the size and first point of every ring
  function signature() {
    let h = 2166136261; const eat = s => { for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } };
    eat([VERSION, G.nx, G.ny, G.bbox.join(','), HOODS.length].join('|'));
    HOODS.forEach((hd, i) => { eat(hd.name + '|' + hd.region + '|' + Math.round(hd.cx) + ',' + Math.round(hd.cy)); (POLYS[i] || []).forEach(poly => poly.forEach(r => eat(r.length + ':' + r[0][0] + ',' + r[0][1]))); });
    return (h >>> 0).toString(36);
  }
  // Every block's outline: per place, its pieces, each [outer, hole, ...] of [x, y] in map units, the outer wound with the solid on
  // its left. About a second of work (see the head of this file).
  function outlines() {
    const cov = covered(), pcs = HOODS.map((hd, i) => {
      const parts = (POLYS[i] || []).map((poly, q) => cov[i].has(q) ? [] : poly.map((ring, k) => cleanRing(ring, 0.008, k > 0))).map(rs => rs[0] ? rs.filter(Boolean) : null).filter(Boolean);
      // how far from San Francisco: places seen only from across the bay are traced more loosely
      const far = REG[hd.region] && REG[hd.region].away ? 0 : clamp((Math.hypot(hd.cx - SFC[0], hd.cy - SFC[1]) - 45) / 260, 0, 1), city = hd.region === 'sf' || !!(REG[hd.region] && REG[hd.region].away);
      return parts.map(rs => {
        const b = [Infinity, Infinity, -Infinity, -Infinity]; rs[0].forEach(q => { b[0] = Math.min(b[0], q[0]); b[1] = Math.min(b[1], q[1]); b[2] = Math.max(b[2], q[0]); b[3] = Math.max(b[3], q[1]); });
        return openPiece(rs, b, Math.max(0.05, rs.reduce((a, r) => a + sArea(r), 0)), city, far);
      });
    });
    const all = pcs.flat();
    return { sig: signature(), blocks: pcs.map(list => list.flatMap(pc => closePiece(pc, all).map(p => [p.outer].concat(p.holes)))) };
  }
  // the outlines as small integers (hundredths of a unit; each ring its first point, then steps), and back
  const Q = 100;
  function pack(o) {
    const ring = r => { const out = []; let px = 0, py = 0, n = 0; for (const p of r) { const x = Math.round(p[0] * Q), y = Math.round(p[1] * Q); if (n && x === px && y === py) continue; out.push(x - px, y - py); px = x; py = y; n++; } return out; };
    return { sig: o.sig, q: Q, blocks: o.blocks.map(pieces => pieces.map(rings => rings.map(ring))) };
  }
  function unpack(d) {
    const q = d.q || Q, ring = a => { const out = []; let x = 0, y = 0; for (let k = 0; k < a.length; k += 2) { x += a[k]; y += a[k + 1]; out.push([x / q, y / q]); } if (out.length > 1 && out[0][0] === out[out.length - 1][0] && out[0][1] === out[out.length - 1][1]) out.pop(); return out; };
    return { sig: d.sig, blocks: d.blocks.map(pieces => pieces.map(rings => rings.map(ring).filter(r => r.length >= 3)).filter(rs => rs.length)) };
  }
  // the outlines to build from: the file made ahead of time when it matches these boundaries, else made here
  function blocks() {
    const d = window.M3D_BLOCKS;
    if (d && d.sig === signature() && d.blocks && d.blocks.length === HOODS.length) { try { return Object.assign(unpack(d), { from: 'file' }); } catch (e) { /* made here instead */ } }
    return Object.assign(outlines(), { from: 'page' });
  }

  // ---- one block: rounded edge rings, the wall with its contact shade, the flat top ----
  // vertex kinds: 0 top, 1 the rounded edge, 2 top of the wall, 3 foot of the wall, 4 the contact band near the ground
  // (3 and 4 stay down when a block is lifted)
  const KIND = { top: 0, bevel: 1, wallTop: 2, foot: 3, contact: 4 };
  const tri2 = (outer, holes) => THREE.ShapeUtils.triangulateShape(outer.map(p => new THREE.Vector2(p[0], p[1])), holes.map(h => h.map(p => new THREE.Vector2(p[0], p[1]))));
  function addBlock(S, rings, H, tid) {
    const tops = [];
    const yC = Math.min(H - BEV - 0.02, LAND_TOP + 0.16);
    for (const r of rings) {
      const n = r.length, nm = new Array(n), mi = new Array(n);
      for (let i = 0; i < n; i++) {
        const a = r[(i - 1 + n) % n], p = r[i], b = r[(i + 1) % n];
        let ex = p[0] - a[0], ey = p[1] - a[1], fx = b[0] - p[0], fy = b[1] - p[1]; const le = Math.hypot(ex, ey) || 1, lf = Math.hypot(fx, fy) || 1; ex /= le; ey /= le; fx /= lf; fy /= lf;
        // solid on the left of the direction of travel: outward is the right-hand normal (dy, -dx)
        let mx = ey + fy, my = -ex - fx; const ml = Math.hypot(mx, my); if (ml < 1e-6) { mx = ey; my = -ex; } else { mx /= ml; my /= ml; }
        nm[i] = [mx, my]; mi[i] = 1 / Math.max(0.55, mx * ey - my * ex);
      }
      // rows from the top of the rounded edge down to the foot of the wall: [inset, y, normal-out share, normal-up share, kind, shade]
      const rows = [];
      for (let k = NB; k >= 0; k--) { const th = k / NB * Math.PI / 2; rows.push([BEV * (1 - Math.cos(th)), H - BEV + BEV * Math.sin(th), Math.cos(th), Math.sin(th), k ? KIND.bevel : KIND.wallTop, 1]); }
      rows.push([0, yC, 1, 0, KIND.contact, 0.86], [0, FLOOR, 1, 0, KIND.foot, 0.6]);
      const ids = rows.map(([d, y, co, up, kind, sh]) => { const row = []; for (let i = 0; i < n; i++) { const p = r[i], m = nm[i], q = d * mi[i]; row.push(S.v(p[0] - m[0] * q, y, p[1] - m[1] * q, m[0] * co, up, m[1] * co, tid, sh, kind)); } return row; });
      // winding: the quad (upper i, lower i, upper j) faces out when its normal agrees with the outward normal
      let flip = false;
      { let best = 0, bi = 0; for (let i = 0; i < n; i++) { const j = (i + 1) % n, l = Math.hypot(r[j][0] - r[i][0], r[j][1] - r[i][1]); if (l > best) { best = l; bi = i; } }
        const j = (bi + 1) % n, P = S.pos, v = id => [P[id * 3], P[id * 3 + 1], P[id * 3 + 2]], a = v(ids[NB][bi]), b = v(ids[NB + 1][bi]), c = v(ids[NB][j]);
        const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], nx = u[1] * w[2] - u[2] * w[1], nz = u[0] * w[1] - u[1] * w[0];
        flip = nx * nm[bi][0] + nz * nm[bi][1] < 0; }
      for (let k = 0; k + 1 < ids.length; k++) { const U = ids[k], D = ids[k + 1]; for (let i = 0; i < n; i++) { const j = (i + 1) % n; if (flip) S.idx.push(U[i], U[j], D[i], U[j], D[j], D[i]); else S.idx.push(U[i], D[i], U[j], U[j], D[i], D[j]); } }
      tops.push(r.map((p, i) => { const q = BEV * mi[i]; return [p[0] - nm[i][0] * q, p[1] - nm[i][1] * q]; }));
    }
    // the flat top
    const faces = tri2(tops[0], tops.slice(1)), flat = tops.flat(), base = S.n; for (const p of flat) S.v(p[0], H, p[1], 0, 1, 0, tid, 1, KIND.top);
    for (const f of faces) { const a = flat[f[0]], b = flat[f[1]], c = flat[f[2]], ny = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]); if (ny < 0) S.idx.push(base + f[0], base + f[2], base + f[1]); else S.idx.push(base + f[0], base + f[1], base + f[2]); }
    return tops;
  }
  // every block in one mesh; tiles[i]: the vertex and index range of place i, its top, and the outline of its flat top (tops: per piece, the outer ring then its holes; edge: every ring)
  function buildTiles(o) {
    const S = sink(), tiles = [];
    HOODS.forEach((hd, i) => {
      const t = { i, H: topOf(i), v0: S.n, i0: S.idx.length, tops: [], edge: [] };
      for (const rings of o.blocks[i] || []) { try { const top = addBlock(S, rings, t.H, i); t.tops.push(top); t.edge.push(...top); } catch (e) { /* a ring the triangulator refuses: that piece is left out */ } }
      t.v1 = S.n; t.i1 = S.idx.length; tiles.push(t);
    });
    return { tiles, mesh: S };
  }

  // ---- the quiet land: flat counties, low, with a soft rounded shoulder down to the water along the coast only ----
  function buildLand() {
    const L = sink(), rings = G.other.map(p => cleanRing(p[0], 0.3, false)).filter(Boolean), bbs = rings.map(r => { const a = [1e9, 1e9, -1e9, -1e9]; for (const p of r) { a[0] = Math.min(a[0], p[0]); a[1] = Math.min(a[1], p[1]); a[2] = Math.max(a[2], p[0]); a[3] = Math.max(a[3], p[1]); } return a; });
    const inOther = (x, y, self) => rings.some((r, k) => k !== self && x >= bbs[k][0] && x <= bbs[k][2] && y >= bbs[k][1] && y <= bbs[k][3] && pip(r, x, y));
    const SH = [[0, LAND_TOP, 0.35, 1, 1], [0.12, LAND_TOP - 0.06, 0.8, 0.6, 0.97], [0.55, -0.3, 0.6, 0.8, 0.93]]; // [out, y, normal-out, normal-up, shade]
    rings.forEach((r, self) => {
      const n = r.length, base = L.n;
      for (const p of r) L.v(p[0], LAND_TOP, p[1], 0, 1, 0, 0, 1, 0);
      for (const f of tri2(r, [])) { const a = r[f[0]], b = r[f[1]], c = r[f[2]], ny = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]); if (ny < 0) L.idx.push(base + f[0], base + f[2], base + f[1]); else L.idx.push(base + f[0], base + f[1], base + f[2]); }
      const coast = new Uint8Array(n), nm = new Array(n);
      for (let i = 0; i < n; i++) { const p = r[i], q = r[(i + 1) % n], dx = q[0] - p[0], dy = q[1] - p[1], l = Math.hypot(dx, dy) || 1; coast[i] = inOther((p[0] + q[0]) / 2 + dy / l * 0.6, (p[1] + q[1]) / 2 - dx / l * 0.6, self) ? 0 : 1; }
      for (let i = 0; i < n; i++) { const a = r[(i - 1 + n) % n], p = r[i], b = r[(i + 1) % n]; const ex = p[0] - a[0], ey = p[1] - a[1], fx = b[0] - p[0], fy = b[1] - p[1], le = Math.hypot(ex, ey) || 1, lf = Math.hypot(fx, fy) || 1; const mx = ey / le + fy / lf, my = -ex / le - fx / lf, ml = Math.hypot(mx, my) || 1; nm[i] = [mx / ml, my / ml]; }
      for (let i = 0; i < n; i++) {
        if (!coast[i]) continue; const j = (i + 1) % n, row = [];
        for (const [o, y, no, nu, sh] of SH) { const l = Math.hypot(no, nu); row.push([i, j].map(k => L.v(r[k][0] + nm[k][0] * o, y, r[k][1] + nm[k][1] * o, nm[k][0] * no / l, nu / l, nm[k][1] * no / l, 0, sh, 1))); }
        for (let k = 0; k + 1 < row.length; k++) { const [a, b] = row[k], [c, d] = row[k + 1]; L.idx.push(a, b, c, b, d, c); } // solid on the left: this winding faces out and up
      }
    });
    return L;
  }
  // inland water (straits, river mouths, lakes): flat shapes just above the quiet land; and the holes in places that no other place
  // fills. inPlace(x, y, i): some place other than i is there
  function buildInland(inPlace) {
    const W = { pos: [], idx: [], n: 0 };
    const flatPoly = (rings, y) => { const verts = rings.flat(), faces = tri2(rings[0], rings.slice(1)), base = W.n; verts.forEach(p => { W.pos.push(p[0], y, p[1]); W.n++; });
      for (const f of faces) { const a = verts[f[0]], b = verts[f[1]], c = verts[f[2]], cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); if (cr > 0) W.idx.push(base + f[0], base + f[2], base + f[1]); else W.idx.push(base + f[0], base + f[1], base + f[2]); } };
    (G.water || []).forEach(poly => { const rs = poly.map((ring, k) => cleanRing(ring, 0.18, k > 0)); if (rs[0]) flatPoly(rs.filter(Boolean), LAND_TOP + 0.012); });
    HOODS.forEach((hd, i) => (POLYS[i] || []).forEach(poly => poly.slice(1).forEach(ll => {
      const hole = cleanRing(ll, 0.008, true); if (!hole) return;
      let cx = 0, cy = 0; for (const p of hole) { cx += p[0]; cy += p[1]; } cx /= hole.length; cy /= hole.length;
      if (!pip(hole, cx, cy) || inPlace(cx, cy, i)) return; flatPoly([hole], LAND_TOP + 0.02);
    })));
    return W;
  }
  // shore lines (open polylines) for the water texture, the extent of the land drawn, and the far land's box (as js/map.js has it)
  function extent(L) {
    const shore = G.outline.flat().map(l => l.map(proj));
    let bx0 = 0, by0 = 0, bx1 = Geom.NX, by1 = Geom.NY; for (let k = 0; k < L.pos.length; k += 3) { const x = L.pos[k], y = L.pos[k + 2]; if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
    const far = proj([-121.3, 42.5]), far2 = proj([-114, 34.5]);
    return { shore, bounds: [bx0, by0, bx1, by1], farLand: [far[0], far[1], far2[0], far2[1]] };
  }

  window.M3D = window.M3D || {};
  window.M3D.land = { topOf, signature, covered, outlines, pack, unpack, blocks, buildTiles, buildLand, buildInland, extent, tri2, proj, KIND, LAND_TOP, TOP0, FLOOR, GAP, BEV, UNIT_M: Geom.UNIT_M };
})();
