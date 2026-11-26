// Seven by Seven, 3D map concept: the land.
// Turns the app's real boundaries (data/geo.js: window.GEO, window.HP) into geometry: one extruded tile per place with a
// rounded top edge and a domed top that rises to the place's real high point, the quiet base land around them, and the
// inland water. World frame: x = map x, z = map y (south), y = up; one unit is one map unit, about 143 m.
// Needs THREE (for its polygon triangulator) and js/geom.js (the app's projection). Defines window.M3D.terrain.
(function () {
  'use strict';
  const G = window.GEO, HP = window.HP, Geom = window.Geom, INFO = window.INFO, REG = window.REGIONS, VIBES = window.VIBES;
  const proj = Geom.proj, pip = Geom.pip;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v)), lerp = (a, b, t) => a + (b - a) * t;
  const slug = n => String(n).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); // the app's own rule (js/app.js)

  // ---- heights (world units). Real metres are about 0.007 units each; the land is exaggerated about 2.5 times at
  // Twin Peaks and a little less at the summits, so Mount Tam does not swallow the map. ----
  const BASE = 0.62;               // the edge of every place at the water, and the top of the flattest one
  const LAND_TOP = 0.26;           // the quiet land outside the places
  const BOTTOM = -2.2;             // tile walls reach below the water, so a lifted tile shows no gap
  const dome = t => { const a = t * (2 - t), b = t * t * (3 - 2 * t); return a * 0.45 + b * 0.55; };

  // ---- ring helpers (map units) ----
  const sArea = r => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1]; return a / 2; };
  function segDist2(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy; let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + dx * t - px, qy = ay + dy * t - py; return qx * qx + qy * qy;
  }
  function ringDist2(r, px, py) { let m = Infinity; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const d = segDist2(px, py, r[j][0], r[j][1], r[i][0], r[i][1]); if (d < m) m = d; } return m; }
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
  const inRings = (rings, x, y) => pip(rings[0], x, y) && !rings.slice(1).some(h => pip(h, x, y));

  // Inset every vertex of a ring towards the solid by b (a mitre, capped). With `rings` given, a vertex whose inset point would
  // leave the solid or come too close to another edge (a narrow neck, a sharp notch) is pulled back in halves.
  function insetRing(r, b, rings) {
    const n = r.length, pts = new Array(n), outN = new Array(n);
    for (let i = 0; i < n; i++) {
      const p0 = r[(i - 1 + n) % n], p = r[i], p1 = r[(i + 1) % n];
      let ax = p[0] - p0[0], ay = p[1] - p0[1], bx = p1[0] - p[0], by = p1[1] - p[1];
      const la = Math.hypot(ax, ay) || 1, lb = Math.hypot(bx, by) || 1; ax /= la; ay /= la; bx /= lb; by /= lb;
      const n1x = -ay, n1y = ax, n2x = -by, n2y = bx; let mx = n1x + n2x, my = n1y + n2y; const ml = Math.hypot(mx, my);
      if (ml < 1e-6) { mx = n1x; my = n1y; } else { mx /= ml; my /= ml; }
      const c = Math.max(0.42, mx * n1x + my * n1y); let len = b / c, q = [p[0] + mx * len, p[1] + my * len];
      if (rings) {
        let need = b * 0.55, ok = false;
        for (let k = 0; k < 5; k++) {
          q = [p[0] + mx * len, p[1] + my * len];
          if (inRings(rings, q[0], q[1])) { let d2 = Infinity; for (const rr of rings) d2 = Math.min(d2, ringDist2(rr, q[0], q[1])); if (d2 >= need * need) { ok = true; break; } }
          len *= 0.5; need *= 0.5;
        }
        if (!ok) q = [p[0], p[1]];
      }
      pts[i] = q; outN[i] = [-mx, -my];
    }
    // where two neighbours have swapped places (a notch narrower than the inset), bring both to their middle
    for (let pass = 0; pass < 4; pass++) { let fixed = 0; for (let i = 0; i < n; i++) { const j = (i + 1) % n, ex = r[j][0] - r[i][0], ey = r[j][1] - r[i][1], fx = pts[j][0] - pts[i][0], fy = pts[j][1] - pts[i][1]; if (ex * fx + ey * fy < 0) { const m = [(pts[i][0] + pts[j][0]) / 2, (pts[i][1] + pts[j][1]) / 2]; pts[i] = m; pts[j] = [m[0], m[1]]; fixed++; } } if (!fixed) break; }
    return { pts, outN };
  }

  // Split every edge longer than L at its midpoint until none is left (a conforming refinement: both triangles on an edge agree).
  function refine(verts, tris, L, maxPass, keep) {
    const L2 = L * L;
    for (let pass = 0; pass < maxPass; pass++) {
      const mid = new Map(), out = []; let split = false;
      const m = (a, b) => {
        const dx = verts[a][0] - verts[b][0], dy = verts[a][1] - verts[b][1]; if (dx * dx + dy * dy <= L2 || (keep && keep(a, b))) return -1;
        const key = a < b ? a * 1048576 + b : b * 1048576 + a; let v = mid.get(key);
        if (v === undefined) { v = verts.length; verts.push([(verts[a][0] + verts[b][0]) / 2, (verts[a][1] + verts[b][1]) / 2]); mid.set(key, v); }
        return v;
      };
      for (let t = 0; t < tris.length; t += 3) {
        const a = tris[t], b = tris[t + 1], c = tris[t + 2], ab = m(a, b), bc = m(b, c), ca = m(c, a), k = (ab >= 0) + (bc >= 0) + (ca >= 0);
        if (!k) { out.push(a, b, c); continue; }
        split = true;
        if (k === 3) out.push(a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca);
        else if (k === 1) { if (ab >= 0) out.push(a, ab, c, ab, b, c); else if (bc >= 0) out.push(a, b, bc, a, bc, c); else out.push(a, b, ca, ca, b, c); }
        else if (ab < 0) out.push(ca, bc, c, a, b, bc, a, bc, ca);       // bc and ca split
        else if (bc < 0) out.push(a, ab, ca, ab, b, c, ab, c, ca);       // ab and ca split
        else out.push(ab, b, bc, a, ab, bc, a, bc, c);                   // ab and bc split
      }
      tris = out; if (!split) break;
    }
    return tris;
  }

  // points added along a ring so that no edge is longer than L
  function resample(r, L) {
    const out = [];
    for (let i = 0; i < r.length; i++) { const p = r[i], q = r[(i + 1) % r.length], n = Math.max(1, Math.ceil(Math.hypot(q[0] - p[0], q[1] - p[1]) / L)); for (let k = 0; k < n; k++) out.push([p[0] + (q[0] - p[0]) * k / n, p[1] + (q[1] - p[1]) * k / n]); }
    return out;
  }

  // Even out a refined mesh: each inner vertex moves to the middle of its neighbours (the edge vertices stay), a few times.
  function relax(verts, tris, nFixed, passes) {
    const nb = verts.map(() => []);
    for (let t = 0; t < tris.length; t += 3) { const a = tris[t], b = tris[t + 1], c = tris[t + 2]; nb[a].push(b, c); nb[b].push(a, c); nb[c].push(a, b); }
    for (let p = 0; p < passes; p++) for (let i = nFixed; i < verts.length; i++) { const n = nb[i]; if (n.length < 3) continue; let x = 0, y = 0; for (const j of n) { x += verts[j][0]; y += verts[j][1]; } verts[i] = [lerp(verts[i][0], x / n.length, 0.7), lerp(verts[i][1], y / n.length, 0.7)]; }
  }

  // ---- mesh sink ----
  function sink() {
    const o = { pos: [], nor: [], idx: [], tid: [], shade: [], kind: [], n: 0 };
    o.v = (x, y, z, nx, ny, nz, tid, shade, kind) => { o.pos.push(x, y, z); o.nor.push(nx, ny, nz); o.tid.push(tid); o.shade.push(shade); o.kind.push(kind); return o.n++; };
    return o;
  }
  // The height field of one solid's top. E: height of each edge vertex above `base`; inside, the edge heights are blended by
  // distance and a dome rises on top of them towards the place's high point (relief s above base), leaning to its higher edges.
  function fieldOf(ins, E, o) {
    const pts = [], ev = [], len = [];
    ins.forEach((r, k) => { const n = r.length; for (let i = 0; i < n; i++) { const p = r[i], a = r[(i - 1 + n) % n], b = r[(i + 1) % n]; pts.push(p); ev.push(E ? E[k][i] : 0); len.push((Math.hypot(p[0] - a[0], p[1] - a[1]) + Math.hypot(b[0] - p[0], b[1] - p[1])) / 2); } });
    let eMax = 0; for (const e of ev) if (e > eMax) eMax = e;
    const f = { ins, pts, ev, len, eMax, R: 0, k: 1, s: o.s, base: o.base, flat: !(o.s > 0.08) };
    // edge blend and distance to the edge at a point
    f.sample = (x, y) => {
      let m = Infinity; for (const r of ins) { const d = ringDist2(r, x, y); if (d < m) m = d; }
      let e = 0; if (eMax > 0) { let sw = 0, se = 0; for (let i = 0; i < pts.length; i++) { const dx = pts[i][0] - x, dy = pts[i][1] - y, w = len[i] / Math.pow(dx * dx + dy * dy + 0.01, 1.5); sw += w; se += w * ev[i]; } e = se / sw; }
      return [Math.sqrt(m), e];
    };
    f.height = (d, e) => {
      if (f.flat || !(f.R > 0.05)) return f.base + e;
      const lean = f.eMax > 0.2 ? 0.4 + 0.6 * e / f.eMax : 1, amp = Math.min(f.s - e, 0.85 * f.R) * f.k;
      return f.base + e + Math.max(0, amp) * dome(clamp(d / f.R, 0, 1)) * lean;
    };
    return f;
  }
  // kinds of vertex: 0 top, 1 top of the rounded edge, 2 foot of the rounded edge (also the top of the wall), 3 foot of the wall
  // One solid: rings = [outer, ...holes] in map units, wound solid-left.
  //   o: { tid, base, s, E (per ring, per vertex), bev, drop, L, Rref, validate, ref (the ground the wall darkens towards) }
  function addSolid(S, rings, o) {
    // inset the rings and triangulate the top; where the inset folds over itself (thin piers, sharp notches) the triangles no
    // longer cover the shape, so try again with a narrower edge
    let ins, verts, ringOf, ringN, insRings, tris, bev = o.bev, cov = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      ins = rings.map(r => insetRing(r, bev, o.validate ? rings : null)); insRings = ins.map(q => q.pts);
      verts = []; ringOf = []; ringN = []; ins.forEach((q, k) => q.pts.forEach(p => { verts.push(p); ringOf.push(k); ringN.push(q.pts.length); }));
      const faces = THREE.ShapeUtils.triangulateShape(ins[0].pts.map(p => new THREE.Vector2(p[0], p[1])), ins.slice(1).map(q => q.pts.map(p => new THREE.Vector2(p[0], p[1]))));
      tris = []; let covered = 0; for (const f of faces) { tris.push(f[0], f[1], f[2]); const a = verts[f[0]], b = verts[f[1]], c = verts[f[2]]; covered += Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2; }
      const want = insRings.reduce((sum, r, k) => sum + (k ? -Math.abs(sArea(r)) : sArea(r)), 0);
      cov = [attempt, +covered.toFixed(3), +want.toFixed(3), +bev.toFixed(3)];
      if (Math.abs(covered - want) <= 0.003 * Math.abs(want) + 0.004) break;
      if (attempt === 4) { (addSolid.bad = addSolid.bad || []).push([o.tid, +covered.toFixed(2), +want.toFixed(2)]); break; }
      bev = attempt === 3 ? 0.004 : bev * 0.55;
    }
    const nB = verts.length, F = fieldOf(insRings, o.E, o);
    const edgeOfRing = (a, b) => a < nB && b < nB && ringOf[a] === ringOf[b] && (Math.abs(a - b) === 1 || Math.abs(a - b) === ringN[a] - 1);
    if (!F.flat) { tris = refine(verts, tris, o.L, 9, edgeOfRing); relax(verts, tris, nB, 4); }
    const d = new Float32Array(verts.length), e = new Float32Array(verts.length), h = new Float32Array(verts.length);
    for (let i = 0; i < nB; i++) e[i] = F.ev[i];
    if (!F.flat) {
      for (let i = nB; i < verts.length; i++) { const q = F.sample(verts[i][0], verts[i][1]); d[i] = q[0]; e[i] = q[1]; if (d[i] > F.R) F.R = d[i]; }
      F.k = Math.pow(Math.min(1, F.R / o.Rref), 0.8);
    }
    for (let i = 0; i < verts.length; i++) h[i] = F.height(d[i], e[i]);
    if (!F.flat) { // the distance to the edge has ridges along the middle of long shapes: soften them
      const nb = verts.map(() => []); for (let t = 0; t < tris.length; t += 3) { const a = tris[t], b = tris[t + 1], c = tris[t + 2]; nb[a].push(b, c); nb[b].push(a, c); nb[c].push(a, b); }
      for (let pass = 0; pass < 3; pass++) { const g = Float32Array.from(h); for (let i = nB; i < verts.length; i++) { const n = nb[i]; if (!n.length) continue; let sum = 0; for (const j of n) sum += g[j]; h[i] = lerp(g[i], sum / n.length, 0.6); } }
    }
    // top normals from the mesh itself
    const nx = new Float32Array(verts.length), ny = new Float32Array(verts.length), nz = new Float32Array(verts.length);
    for (let t = 0; t < tris.length; t += 3) {
      let a = tris[t], b = tris[t + 1], c = tris[t + 2];
      const cr = (verts[b][0] - verts[a][0]) * (verts[c][1] - verts[a][1]) - (verts[b][1] - verts[a][1]) * (verts[c][0] - verts[a][0]);
      if (cr > 0) { tris[t + 1] = c; tris[t + 2] = b; const sw = b; b = c; c = sw; } // faces up
      const ux = verts[b][0] - verts[a][0], uy = h[b] - h[a], uz = verts[b][1] - verts[a][1], vx = verts[c][0] - verts[a][0], vy = h[c] - h[a], vz = verts[c][1] - verts[a][1];
      const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
      nx[a] += fx; ny[a] += fy; nz[a] += fz; nx[b] += fx; ny[b] += fy; nz[b] += fz; nx[c] += fx; ny[c] += fy; nz[c] += fz;
    }
    const base = S.n;
    for (let i = 0; i < verts.length; i++) {
      let x = 0, y = 1, z = 0; const l = Math.hypot(nx[i], ny[i], nz[i]); if (l > 1e-9) { x = nx[i] / l; y = ny[i] / l; z = nz[i] / l; }
      S.v(verts[i][0], h[i], verts[i][1], x, y, z, o.tid, 1, 0);
    }
    for (let t = 0; t < tris.length; t++) S.idx.push(base + tris[t]);
    // the rounded edge and the wall, ring by ring
    let off = 0;
    rings.forEach((r, k) => {
      const q = ins[k], n = r.length, vt = [], vf = [], vb = [];
      for (let i = 0; i < n; i++) {
        const ox = q.outN[i][0], oz = q.outN[i][1], yTop = h[off + i], yFoot = yTop - o.drop;
        const sFoot = 0.8, sWall = sFoot - (sFoot - 0.5) * (yFoot - BOTTOM) / Math.max(0.05, yFoot - o.ref);
        let tn = [nx[off + i], ny[off + i], nz[off + i]], tl = Math.hypot(tn[0], tn[1], tn[2]); if (tl < 1e-9) { tn = [0, 1, 0]; tl = 1; } const l2 = Math.hypot(ox, 0.6, oz);
        vt.push(S.v(q.pts[i][0], yTop, q.pts[i][1], tn[0] / tl, tn[1] / tl, tn[2] / tl, o.tid, 1, 1));
        vf.push(S.v(r[i][0], yFoot, r[i][1], ox / l2, 0.6 / l2, oz / l2, o.tid, sFoot, 2));
        vb.push(S.v(r[i][0], BOTTOM, r[i][1], ox, 0, oz, o.tid, sWall, 3));
      }
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        // the solid is on the left of i -> j, so seen from outside the ring runs right to left: (foot j, foot i, top i) faces out
        S.idx.push(vf[j], vf[i], vt[i], vf[j], vt[i], vt[j]);
        S.idx.push(vb[j], vb[i], vf[i], vb[j], vf[i], vf[j]);
      }
      off += n;
    });
    return { rings, field: F, cov };
  }

  // ---- build everything ----
  const EDGE = 0.42;   // a shared edge sits at this share of the lower neighbour's relief
  const RELIEF = 0.07; // world units per metre^0.8: Twin Peaks (281 m) stands 6.4 units, about 3.2 times its true height; Mount Tam 2.8 times
  function build() {
    const t0 = performance.now();
    const S = sink(), tiles = [];
    // pass 1: every place's rings and relief
    G.hoods.forEach((hd, i) => {
      const info = INFO[hd.name] || {}, low = REG[hd.region] && REG[hd.region].low ? REG[hd.region].low.m : 0;
      const m = Math.max(0, hd.max - low), s = RELIEF * Math.pow(m, 0.8);
      let parts = HP[i].polys.map(poly => poly.map((ring, k) => cleanRing(ring, 0.03, k > 0))).map(rs => rs[0] ? rs.filter(Boolean) : null).filter(Boolean);
      const areas = parts.map(rs => rs.reduce((a, r) => a + sArea(r), 0)), areaMax = Math.max.apply(null, areas), area = areas.reduce((a, b) => a + b, 0);
      const L = clamp(0.4 * Math.sqrt(areaMax) / 2.5, 1.3, 16);
      parts = parts.map(rs => rs.map(r => resample(r, L)));
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; parts.forEach(rs => rs[0].forEach(q => { if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1]; }));
      tiles.push({ i, name: hd.name, region: hd.region, slug: slug(hd.name), tone: info.tone || (VIBES[info.vibe] || {}).cls || 'v-fog', vibe: info.vibe, line: info.line || '', max: hd.max, s, peak: BASE + s, cx: hd.cx, cy: hd.cy, area, areas, areaMax, L, cells: hd.cells, bbox: [x0, y0, x1, y1], rings: parts, parts: [] });
    });
    const at = (x, y, not) => { for (const t of tiles) { if (t === not) continue; const b = t.bbox; if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue; for (const rs of t.rings) if (inRings(rs, x, y)) return t; } return null; };
    // pass 2: edge heights from the neighbours, then the geometry
    for (const t of tiles) {
      t.v0 = S.n; t.i0 = S.idx.length;
      const bev = clamp(0.021 * Math.sqrt(t.areaMax), 0.17, 0.9), Rref = 0.3 * Math.sqrt(t.areaMax);
      t.rings.forEach((rs, k) => {
        const small = t.areas[k] < 0.4, b = small ? 0.04 : Math.min(bev, 0.22 * Math.sqrt(t.areas[k]));
        const E = rs.map(r => {
          const n = r.length, q = insetRing(r, 1, null); let e = new Float32Array(n);
          for (let i = 0; i < n; i++) { const ox = q.outN[i][0], oy = q.outN[i][1]; const nb = at(r[i][0] + ox * 0.3, r[i][1] + oy * 0.3, t) || at(r[i][0] + ox * 1.0, r[i][1] + oy * 1.0, t); e[i] = nb ? EDGE * Math.min(t.s, nb.s) : 0; }
          for (let pass = 0; pass < 5; pass++) { const f = new Float32Array(n); for (let i = 0; i < n; i++) f[i] = 0.5 * e[i] + 0.25 * (e[(i - 1 + n) % n] + e[(i + 1) % n]); e = f; }
          return e;
        });
        t.parts.push(addSolid(S, rs, { tid: t.i, base: BASE, s: t.s, E, bev: b, drop: Math.min(b * 0.85, 0.24), L: t.L, Rref, validate: true, ref: 0.12 }));
      });
      t.v1 = S.n; t.i1 = S.idx.length;
      t.top = topAt(t, t.cx, t.cy);
    }
    const tTiles = performance.now();
    // the quiet land: the county filler, low and flat, with the same rounded edge in small
    const L = sink();
    G.other.forEach(poly => { const rs = poly.map((ring, k) => cleanRing(ring, 0.45, k > 0)); if (!rs[0]) return; addSolid(L, rs.filter(Boolean), { tid: 0, base: LAND_TOP, s: 0, E: null, bev: 0.1, drop: 0.09, L: 99, Rref: 1, validate: false, ref: -0.3 }); });
    // inland water (straits, river mouths, lakes): flat shapes just above the quiet land
    const W = { pos: [], idx: [], n: 0 };
    (G.water || []).forEach(poly => {
      const rs = poly.map((ring, k) => cleanRing(ring, 0.18, k > 0)); if (!rs[0]) return; const rings = rs.filter(Boolean);
      const verts = []; rings.forEach(r => r.forEach(p => verts.push(p)));
      const faces = THREE.ShapeUtils.triangulateShape(rings[0].map(p => new THREE.Vector2(p[0], p[1])), rings.slice(1).map(r => r.map(p => new THREE.Vector2(p[0], p[1]))));
      const base = W.n; verts.forEach(p => { W.pos.push(p[0], LAND_TOP + 0.012, p[1]); W.n++; });
      for (const f of faces) { const a = verts[f[0]], b = verts[f[1]], c = verts[f[2]], cr = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]); if (cr > 0) W.idx.push(base + f[0], base + f[2], base + f[1]); else W.idx.push(base + f[0], base + f[1], base + f[2]); }
    });
    for (const t of tiles) for (const rs of t.rings) for (const hole of rs.slice(1)) {
      const q = insetRing(hole, 0.2, null), c = [hole[0][0] + q.outN[0][0] * 0.2, hole[0][1] + q.outN[0][1] * 0.2]; // a point just inside the hole
      if (at(c[0], c[1], t)) continue;
      const faces = THREE.ShapeUtils.triangulateShape(hole.map(p => new THREE.Vector2(p[0], p[1])), []), base = W.n; hole.forEach(p => { W.pos.push(p[0], LAND_TOP + 0.03, p[1]); W.n++; });
      for (const f of faces) { const a = hole[f[0]], b = hole[f[1]], cc = hole[f[2]], cr = (b[0] - a[0]) * (cc[1] - a[1]) - (b[1] - a[1]) * (cc[0] - a[0]); if (cr > 0) W.idx.push(base + f[0], base + f[2], base + f[1]); else W.idx.push(base + f[0], base + f[1], base + f[2]); }
    }
    // shore lines (open polylines) for the water texture, and the extent of everything drawn
    const shore = G.outline.flat().map(l => l.map(proj));
    let bx0 = 0, by0 = 0, bx1 = Geom.NX, by1 = Geom.NY; for (let k = 0; k < L.pos.length; k += 3) { const x = L.pos[k], y = L.pos[k + 2]; if (x < bx0) bx0 = x; if (x > bx1) bx1 = x; if (y < by0) by0 = y; if (y > by1) by1 = y; }
    const far = proj([-121.3, 42.5]), far2 = proj([-114, 34.5]);
    return { tiles, mesh: S, land: L, inland: W, bad: addSolid.bad || [], shore, bounds: [bx0, by0, bx1, by1], farLand: [far[0], far[1], far2[0], far2[1]], ms: { tiles: tTiles - t0, rest: performance.now() - tTiles } };
  }

  // height of a tile's top at a map point (its edge height where the point is on the rounded edge)
  function topAt(t, x, y) {
    for (const p of t.parts) {
      if (!inRings(p.rings, x, y)) continue;
      const q = p.field.sample(x, y);
      return inRings(p.field.ins, x, y) ? p.field.height(q[0], q[1]) : p.field.base + q[1];
    }
    return BASE;
  }
  function tileAt(tiles, x, y) { for (const t of tiles) { const b = t.bbox; if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue; for (const p of t.parts) if (inRings(p.rings, x, y)) return t; } return null; }
  function heightAt(tiles, x, y) { const t = tileAt(tiles, x, y); return t ? topAt(t, x, y) : LAND_TOP; }

  window.M3D = window.M3D || {};
  // round one's draped tiles: kept as the `?tiles=smooth` variant; m3d-plateau.js replaces build and the height lookups otherwise
  window.M3D.terrain = { build, topAt, tileAt, heightAt, inRings, proj, slug, BASE, LAND_TOP, BOTTOM, UNIT_M: Geom.UNIT_M, variant: 'smooth',
    _: { sArea, segDist2, ringDist2, simplify, cleanRing, insetRing, resample, sink } };
})();
