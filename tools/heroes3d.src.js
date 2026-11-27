// Seven by Seven, the 3D map: the named buildings of downtown San Francisco. Loaded only when the 3D map is wanted (index.html), with
// Made by tools/heroes3d.js from tools/heroes3d.src.js: edit that file, then run node tools/heroes3d.js (do not edit this one by hand).
// js/map3d/real.js, which calls it at three places (match, put, shade below) and stands without it.
// A table of real buildings, each given its own shape, top, colour and walls in place of the plain outline js/map3d/real.js would
// stand up there. A building of the table is still one of its chunk's buildings: its triangles go into the chunk's own mesh through
// real.js's own vert(), so there is no mesh, no draw call and no shader of its own, it rises and fades with its neighbours, and a
// tap finds what it found before. Nothing is added to what a vertex carries: a material's number (a whole number from 1, a byte's worth) rides in
// the whole part of the tint real.js already sends (the tint itself stays in the fraction), and the look's vertex shader, given one
// line here (shade), reads the colour and the kind of wall from a small table of its own (uHero) when that whole part is not 0.
// Each outline is named by what stays the same when js/map3d/buildings.js is made again: [lon, lat of a point inside it, its
// height in metres, its count of points, its area in square metres]. An outline that is not found (the data changed), or a
// building whose shape fails as it is made, stands as the plain outline it was. ?m3d-heroes=off: none of this.
// Heights: the data's own (H below), unless the entry's options give the height of its tallest outline in life (H: metres; every
// outline of the entry's own list is drawn that share taller, the outlines that go with it as they are); a spire or a mast may stand
// above it. Drawn as real.js draws every height: times the factor it hands over (put's s). Shapes: from memory of each building, no survey.
// Defines window.M3D.heroes.
(function () {
  'use strict';
  const M3D = window.M3D = window.M3D || {}, Geom = window.Geom; if (!Geom || !Geom.UNIT_M) return;
  const ON = !/[?&]m3d-heroes=off(?:&|$)/.test(location.search), K = 1 / Geom.UNIT_M, UP = [0, 1, 0];
  // the materials: [red, green, blue as shares of the look's pale (1: as pale as the palest tower; the hour's light and the night
  // colour them as they do the others), the kind of wall the look draws: 0 punched windows, 1 vertical ribs, 2 bands, 3 a glass face]
  const MAT = {
    rf: [0.6, 0.62, 0.65, 0], wh: [1.12, 1.12, 1.1, 0], gb: [0.4, 0.62, 0.92, 3], gd: [0.13, 0.24, 0.42, 3], gs: [0.66, 0.86, 1.04, 3], gg: [0.42, 0.76, 0.8, 2], gl: [0.44, 0.78, 0.86, 3],
    gz: [0.22, 0.16, 0.12, 3], gv: [0.76, 0.88, 0.84, 1], cc: [1.05, 1.04, 1.0, 1], cb: [1.03, 1.0, 0.93, 2], cp: [0.98, 0.94, 0.86, 0], pk: [1.02, 0.82, 0.73, 0], gr: [0.84, 0.84, 0.82, 0],
    tc: [1.04, 0.86, 0.58, 1], sp: [0.88, 0.7, 0.46, 1], pb: [0.98, 0.96, 0.9, 1], mk: [0.92, 0.92, 0.9, 1], dk: [0.36, 0.34, 0.33, 1], gy: [0.64, 0.64, 0.65, 1], bk: [0.62, 0.27, 0.19, 0], tn: [0.86, 0.64, 0.42, 0],
    st: [0.86, 0.82, 0.7, 0], gn: [0.3, 0.6, 0.24, 0], cu: [0.36, 0.7, 0.56, 0], mm: [1.04, 0.84, 0.72, 2], mg: [0.3, 0.5, 0.72, 3], rs: [0.78, 0.48, 0.42, 2], fx: [0.42, 0.4, 0.38, 2],
    sv: [0.8, 0.86, 0.92, 2], ad: [1.04, 0.94, 0.72, 1], rg: [0.7, 0.4, 0.34, 0], gp: [0.62, 0.86, 0.74, 3], tg: [0.16, 0.42, 0.18, 0], bz: [0.42, 0.34, 0.27, 0] };
  const MI = {}, PAL = []; Object.keys(MAT).forEach((k, i) => { MI[k] = i; PAL.push(MAT[k][0], MAT[k][1], MAT[k][2], MAT[k][3]); });
  const NM = PAL.length / 4, U = { value: new Float32Array(PAL) };

  // ---- rings: [[x, z], ...] in map units, the solid on the left as real.js winds its outlines ----
  const area = r => { let s = 0; for (let k = 0, j = r.length - 1; k < r.length; j = k++) s += r[j][0] * r[k][1] - r[k][0] * r[j][1]; return s / 2; };
  const fix = r => area(r) < 0 ? r.slice().reverse() : r;
  function cen(r) { let s = 0, x = 0, z = 0; for (let k = 0, j = r.length - 1; k < r.length; j = k++) { const c = r[j][0] * r[k][1] - r[k][0] * r[j][1]; s += c; x += (r[j][0] + r[k][0]) * c; z += (r[j][1] + r[k][1]) * c; } return Math.abs(s) > 1e-12 ? [x / (3 * s), z / (3 * s)] : r[0]; }
  const scl = (r, s, c) => { c = c || cen(r); return r.map(q => [c[0] + (q[0] - c[0]) * s, c[1] + (q[1] - c[1]) * s]); };
  function hull(r) { const p = r.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]), X = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]), h = [];
    for (const q of p) { while (h.length >= 2 && X(h[h.length - 2], h[h.length - 1], q) <= 0) h.pop(); h.push(q); } const t = h.length + 1;
    for (let i = p.length - 2; i >= 0; i--) { const q = p[i]; while (h.length >= t && X(h[h.length - 2], h[h.length - 1], q) <= 0) h.pop(); h.push(q); } h.pop(); return fix(h); }
  // the ring drawn in by d (never past four fifths of the way from its nearest edge to its middle)
  function inset(r, d) { const n = r.length, out = [], C = cen(r); let r0 = Infinity; if (!(d > 0)) return r;
    for (let k = 0; k < n; k++) { const a = r[k], c = r[(k + 1) % n], dx = c[0] - a[0], dz = c[1] - a[1], l = Math.hypot(dx, dz); if (l > 1e-7) r0 = Math.min(r0, (dx * (C[1] - a[1]) - dz * (C[0] - a[0])) / l); }
    if (!(r0 > 0)) return scl(r, 0.8, C); d = Math.min(d, r0 * 0.8);
    for (let k = 0; k < n; k++) { const p0 = r[(k + n - 1) % n], p1 = r[k], p2 = r[(k + 1) % n]; let ax = p1[0] - p0[0], az = p1[1] - p0[1], bx = p2[0] - p1[0], bz = p2[1] - p1[1]; const la = Math.hypot(ax, az) || 1, lb = Math.hypot(bx, bz) || 1; ax /= la; az /= la; bx /= lb; bz /= lb;
      const den = 1 + ax * bx + az * bz; out.push(den > 0.2 ? [p1[0] + (-az - bz) * d / den, p1[1] + (ax + bx) * d / den] : [p1[0] - az * d, p1[1] + ax * d]); }
    const A0 = area(r), A1 = area(out); return A1 > A0 * 0.02 && A1 < A0 ? out : scl(r, 1 - d / r0, C); }
  // its corners cut by d
  function cham(r, d) { const n = r.length, out = []; for (let k = 0; k < n; k++) { const p0 = r[(k + n - 1) % n], p1 = r[k], p2 = r[(k + 1) % n], la = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]), lb = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]); if (la < 1e-7 || lb < 1e-7) continue; const e = Math.min(d, la * 0.33) / la, f = Math.min(d, lb * 0.33) / lb;
      out.push([p1[0] + (p0[0] - p1[0]) * e, p1[1] + (p0[1] - p1[1]) * e], [p1[0] + (p2[0] - p1[0]) * f, p1[1] + (p2[1] - p1[1]) * f]); } return out; }

  // ---- one building being made (B). Lengths given to B are metres; heights are metres above the ground at the outline's middle; rings are in map units.
  // One building at a time: b, real.js's record of the outline, and what real.js hands over with it (put below), are set by begin ----
  let b, vert, idx, ears, g, gc, sc, ring, u0, bot, px;
  const Y = m => gc + m * sc;
  function begin(rec, v, ix, er, gr, gm, s, H) { b = rec; vert = v; idx = ix; ears = er; g = gr; gc = gm; sc = s; ring = []; for (let k = 0; k < b.n; k++) ring.push([b.p[k * 2], b.p[k * 2 + 1]]); u0 = b.tint * 9; bot = (g - 0.02 - gc) / sc; px = []; B.ring = ring; B.H = H; B.bot = bot; return B; }
  // a material's number, and what real.js's vert() reads of a building for it: the place, and the tint with the number in its whole part
  const M = mat => { const m = MI[mat]; if (m == null) throw new Error('no material ' + mat); return px[m] || (px[m] = { place: b.place, tint: m + 1.25 + b.tint * 0.5 }); };
  // a flat face of four corners (x, y, z each, in turn round it), turned towards (wx, wy, wz); q: M(material); ua, ub: along the wall at the first and the second corner
  function quad(x0, y0, z0, x1, y1, z1, x2, y2, z2, x3, y3, z3, wx, wy, wz, q, kind, hh, ua, ub) {
    let ex = x2 - x0, ey = y2 - y0, ez = z2 - z0, nx = (y1 - y0) * ez - (z1 - z0) * ey, ny = (z1 - z0) * ex - (x1 - x0) * ez, nz = (x1 - x0) * ey - (y1 - y0) * ex, l = Math.hypot(nx, ny, nz);
    if (!(l > 1e-14)) { nx = ey * (z3 - z0) - ez * (y3 - y0); ny = ez * (x3 - x0) - ex * (z3 - z0); nz = ex * (y3 - y0) - ey * (x3 - x0); l = Math.hypot(nx, ny, nz); if (!(l > 1e-14)) return; }
    nx /= l; ny /= l; nz /= l; const back = nx * wx + ny * wy + nz * wz < 0; if (back) { nx = -nx; ny = -ny; nz = -nz; }
    const a = vert(x0, y0, z0, nx, ny, nz, g, q, ua, y0 - gc, kind, hh), c = vert(x1, y1, z1, nx, ny, nz, g, q, ub, y1 - gc, kind, hh), d = vert(x2, y2, z2, nx, ny, nz, g, q, ub, y2 - gc, kind, hh), e = vert(x3, y3, z3, nx, ny, nz, g, q, ua, y3 - gc, kind, hh);
    if (back) idx.push(a, d, c, a, e, d); else idx.push(a, c, d, a, d, e); }
  // a flat face of three or more corners [x, y, z], turned towards want; us: along the wall (or from the roof's edge) per corner
  function face(pts, want, mat, kind, hh, us) { const q = M(mat), a = pts[0], p = pts[1], c = pts[2]; let nx = (p[1] - a[1]) * (c[2] - a[2]) - (p[2] - a[2]) * (c[1] - a[1]), ny = (p[2] - a[2]) * (c[0] - a[0]) - (p[0] - a[0]) * (c[2] - a[2]), nz = (p[0] - a[0]) * (c[1] - a[1]) - (p[1] - a[1]) * (c[0] - a[0]);
    const l = Math.hypot(nx, ny, nz); if (!(l > 1e-14)) return; nx /= l; ny /= l; nz /= l; const back = nx * want[0] + ny * want[1] + nz * want[2] < 0; if (back) { nx = -nx; ny = -ny; nz = -nz; }
    let i0 = -1, ip = -1; for (let k = 0; k < pts.length; k++) { const i = vert(pts[k][0], pts[k][1], pts[k][2], nx, ny, nz, g, q, us ? us[k] : 0, pts[k][1] - gc, kind, hh); if (k === 0) i0 = i; else if (k > 1) { if (back) idx.push(i0, i, ip); else idx.push(i0, ip, i); } ip = i; } }
  // walls from ring r at m0 up to m1 (a number, or a height for each point); o: { top: the ring they rise to (as many points), or s: r drawn in by this
  // share about c; kind: 1 with windows (the default), 2 bare; hh: the height its cornice is drawn at }
  function wall(r, m0, m1, mat, o) { o = o || {}; const t = o.top || (o.s != null ? scl(r, o.s, o.c) : r), n = r.length, f0 = typeof m0 === 'function' ? m0 : null, f1 = typeof m1 === 'function' ? m1 : null, q = M(mat), kind = o.kind || 1; let acc = u0, hh = o.hh;
    if (hh == null) { if (f1) { hh = -1e9; for (const p of t) hh = Math.max(hh, f1(p)); } else hh = m1; } hh *= sc; const ya = f0 ? 0 : Y(m0), yb = f1 ? 0 : Y(m1);
    if (t === r && !f0 && !f1) { const va = ya - gc, vb = yb - gc;   // (upright walls of one height, the most of them: the wall's own way out is its normal)
      for (let k = 0; k < n; k++) { const a = r[k], c = r[k + 1 < n ? k + 1 : 0], ax = a[0], az = a[1], cx = c[0], cz = c[1], dx = cx - ax, dz = cz - az, l = Math.hypot(dx, dz); if (l < 1e-7) continue; const nx = dz / l, nz = -dx / l, ub = acc + l;
        const v0 = vert(ax, ya, az, nx, 0, nz, g, q, acc, va, kind, hh), v1 = vert(cx, ya, cz, nx, 0, nz, g, q, ub, va, kind, hh), v2 = vert(cx, yb, cz, nx, 0, nz, g, q, ub, vb, kind, hh), v3 = vert(ax, yb, az, nx, 0, nz, g, q, acc, vb, kind, hh); idx.push(v0, v2, v1, v0, v3, v2); acc = ub; } return; }
    for (let k = 0; k < n; k++) { const a = r[k], c = r[k + 1 < n ? k + 1 : 0], ta = t[k], tc = t[k + 1 < n ? k + 1 : 0], dx = c[0] - a[0], dz = c[1] - a[1], l = Math.hypot(dx, dz); if (l < 1e-7) continue;
      quad(a[0], f0 ? Y(f0(a)) : ya, a[1], c[0], f0 ? Y(f0(c)) : ya, c[1], tc[0], f1 ? Y(f1(tc)) : yb, tc[1], ta[0], f1 ? Y(f1(ta)) : yb, ta[1], dz / l, 0, -dx / l, q, kind, hh, acc, acc + l); acc += l; } }
  // a roof on ring r at m: a fan about its middle with the look's coping where every edge is seen from there, else cut by its ears
  function lid(r, m, mat, o) { const n = r.length, f = typeof m === 'function' ? m : null, C = cen(r), he = [], hh = (f ? f(C) : m) * sc, q = M(mat), plain = o && o.plain, y = f ? 0 : Y(m); let star = n <= 48;
    for (let k = 0; k < n; k++) { const a = r[k], c = r[k + 1 < n ? k + 1 : 0], dx = c[0] - a[0], dz = c[1] - a[1], l = Math.hypot(dx, dz), h = l > 1e-7 ? (dx * (C[1] - a[1]) - dz * (C[0] - a[0])) / l : NaN; he.push(h); if (h <= 2e-3) star = false; }
    if (star) { const yc = f ? Y(f(C)) : y; let i0 = -1;   // (the outline's points once, and the middle once for each edge, as far from the edge as it is)
      for (let k = 0; k < n; k++) { const a = r[k], i = vert(a[0], f ? Y(f(a)) : y, a[1], 0, 1, 0, g, q, plain ? 9 : 0, (f ? Y(f(a)) : y) - gc, 0, hh); if (k === 0) i0 = i; }
      for (let k = 0; k < n; k++) if (he[k] > 0) idx.push(i0 + k, vert(C[0], yc, C[1], 0, 1, 0, g, q, plain ? 9 : he[k], yc - gc, 0, hh), i0 + (k + 1 < n ? k + 1 : 0)); return; }
    const fl = [], tri = []; for (const p of r) fl.push(p[0], p[1]); ears(fl, n, tri); const P = i => [r[i][0], f ? Y(f(r[i])) : y, r[i][1]];
    for (let k = 0; k + 2 < tri.length; k += 3) face([P(tri[k]), P(tri[k + 1]), P(tri[k + 2])], UP, mat, 0, hh, [9, 9, 9]); }
  const ext = (r, m0, m1, mat, o) => { wall(r, m0, m1, mat, o); lid(o && o.top || (o && o.s != null ? scl(r, o.s, o.c) : r), m1, o && o.r || 'rf', o); };
  // the longest edge of r: its middle (or c), the way along it, the way in from it
  function fr(r, c) { let bl = -1, f = null; for (let k = 0; k < r.length; k++) { const a = r[k], d = r[(k + 1) % r.length], dx = d[0] - a[0], dz = d[1] - a[1], l = Math.hypot(dx, dz); if (l > bl) { bl = l; f = { m: c || [(a[0] + d[0]) / 2, (a[1] + d[1]) / 2], u: [dx / l, dz / l], w: [-dz / l, dx / l], l: l / K }; } } return f; }
  const at = (f, a, c) => [f.m[0] + (a * f.u[0] + c * f.w[0]) * K, f.m[1] + (a * f.u[1] + c * f.w[1]) * K];
  const box = (f, a, c, ha, hc) => fix([at(f, a - ha, c - hc), at(f, a + ha, c - hc), at(f, a + ha, c + hc), at(f, a - ha, c + hc)]);
  const ngon = (c, rad, n, rot) => { const q = []; for (let k = 0; k < n; k++) { const t = (rot || 0) + k / n * 6.283185307; q.push([c[0] + Math.cos(t) * rad * K, c[1] + Math.sin(t) * rad * K]); } return fix(q); };
  // a flat bar w wide from a to c ([x, y, z]) lying on a wall that faces nr
  function beam(a, c, w, nr, mat) { const dx = c[0] - a[0], dy = c[1] - a[1], dz = c[2] - a[2]; let tx = nr[1] * dz - nr[2] * dy, ty = nr[2] * dx - nr[0] * dz, tz = nr[0] * dy - nr[1] * dx; const l = Math.hypot(tx, ty, tz) || 1, h = w * K / 2 / l, e = 0.5 * K; tx *= h; ty *= h; tz *= h;
    const ox = nr[0] * e, oz = nr[2] * e; face([[a[0] - tx + ox, a[1] - ty, a[2] - tz + oz], [c[0] - tx + ox, c[1] - ty, c[2] - tz + oz], [c[0] + tx + ox, c[1] + ty, c[2] + tz + oz], [a[0] + tx + ox, a[1] + ty, a[2] + tz + oz]], nr, mat, 2, 0); }
  // half a disc of radius R standing on the line through at(f, a, c) at height m, facing sg times the way in
  function fan(f, a, c, m, R, sg, mat) { const pts = [], p0 = at(f, a, c); pts.push([p0[0], Y(m), p0[1]]); for (let k = 0; k <= 12; k++) { const t = k / 12 * Math.PI, q = at(f, a + Math.cos(t) * R, c); pts.push([q[0], Y(m + Math.sin(t) * R), q[1]]); } face(pts, [f.w[0] * sg, 0, f.w[1] * sg], mat, 2, 0); }
  // the outline as it is, in a material, with what the options add: o: { m: the walls, r: the roof, hull: its dents filled, c: corners cut by this,
  // fl: [share, m]: the foot spread to that share up to m, st: [[share of H, drawn in by m, material], ...]: the steps of its top, from the lowest }
  function skin(o, r, H) { r = r || ring; H = H || B.H; if (o.hull) r = hull(r); if (o.c) r = cham(r, o.c * K);
    const st = o.st || []; let m0 = b.base > 0 && b.base < H ? b.base : bot, cur = r, mat = o.m;
    if (o.fl) { wall(scl(r, o.fl[0]), m0, o.fl[1], mat, { top: r, hh: H }); m0 = o.fl[1]; }
    for (let i = 0; i <= st.length; i++) { const m1 = i < st.length ? st[i][0] * H : H; ext(cur, m0, m1, mat, { r: o.r }); if (i < st.length) { cur = inset(r, st[i][1] * K); m0 = m1; mat = st[i][2] || o.m; } }
    return cur; }
  const B = { ring: null, H: 0, bot: 0, Y, face, wall, lid, ext, fr, at, box, ngon, beam, fan, skin };

  // ---- the shapes that are more than a skin: f(B, r: the outline, H: its height in the data, o: the entry's options) ----
  const F = {
    // 181 Fremont: the shaft leaning in on every side, the zig-zag of its braces outside the glass, the faces folding to a point and the spire
    f181(B, r, H) { r = hull(r); const c = cen(r), n = r.length, Hr = H * 0.84, pt = (k, m) => { const q = r[(k % n + n) % n], s = 1 - 0.2 * m / Hr; return [c[0] + (q[0] - c[0]) * s, B.Y(m), c[1] + (q[1] - c[1]) * s]; };
      B.wall(r, B.bot, Hr, 'gs', { s: 0.8, c });
      for (let k = 0; k < n; k++) { const a = r[k], d = r[(k + 1) % n], l = Math.hypot(d[0] - a[0], d[1] - a[1]), nr = [(d[1] - a[1]) / l, 0, -(d[0] - a[0]) / l]; for (let i = 0; i < 5; i++) B.beam(pt(k + (i & 1), Hr * i / 5), pt(k + 1 - (i & 1), Hr * (i + 1) / 5), 3, nr, 'wh'); }
      const t = scl(r, 0.8, c); B.wall(t, Hr, H * 0.9, 'gs', { s: 0.4, c, hh: Hr }); B.lid(scl(t, 0.4, c), H * 0.9, 'wh', { plain: 1 }); B.wall(B.ngon(c, 1.7, 4), H * 0.9, H, 'wh', { s: 0.05, kind: 2 }); },
    // a top cut on the slant, the high end at one end of the longest side (One Rincon Hill)
    slant(B, r, H, o) { const f = B.fr(r), c = cen(r), pr = q => (q[0] - c[0]) * f.u[0] + (q[1] - c[1]) * f.u[1]; let lo = Infinity, hi = -Infinity; for (const q of r) { const t = pr(q); lo = Math.min(lo, t); hi = Math.max(hi, t); }
      const top = q => H * (1 - o.d * (hi - pr(q)) / (hi - lo)); B.wall(r, B.bot, top, o.m, { hh: H }); B.lid(r, top, 'rf', { plain: 1 }); },
    // a glass roof leaning up against a tower at o.to (the atrium of 101 California)
    lean(B, r, H, o) { const p = Geom.proj(o.to); let far = 0; const d = q => Math.hypot(q[0] - p[0], q[1] - p[1]); for (const q of r) far = Math.max(far, d(q)); const top = q => o.h1 - (o.h1 - o.h0) * Math.min(1, d(q) / far); B.wall(r, B.bot, top, o.m, { hh: o.h1 }); B.lid(r, top, o.m, { plain: 1 }); },
    // a spire of 345 California: the data's small square carried up to a point
    spire(B, r, H) { B.wall(r, H * 0.7, H, 'pk', { kind: 2 }); B.wall(r, H, H + 36, 'wh', { s: 0.05, kind: 2 }); },
    // the Hyatt Regency's tallest part and the drum of the restaurant that turned on its roof
    hyatt(B, r, H) { B.skin({ m: 'cb' }); B.ext(B.ngon(cen(r), 12, 20), H, H + 6.5, 'cb'); },
    // the Marriott Marquis: the stepped middle and the fan windows of its top (the "jukebox")
    marriott(B, r, H) { const f = B.fr(r, cen(r)); B.ext(r, B.bot, H * 0.6, 'mm');
      const tier = (hu, hw, m0, m1, R) => { B.ext(B.box(f, 0, 0, hu, hw), m0, m1, 'mm'); for (const sg of [1, -1]) B.fan(f, 0, sg * (hw + 0.4), m1 - R - 2, R, sg, 'mg'); };
      tier(27, 15, H * 0.6, H * 0.84, 11); tier(17, 11, H * 0.84, H, 9); },
    // 140 New Montgomery: the L of its floors, and over the middle of its long front the tower stepping in three times
    pacbell(B, r, H) { const f = B.fr(r); B.ext(r, B.bot, H * 0.74, 'pb'); B.ext(B.box(f, 0, 8, 12, 7), H * 0.74, H * 0.89, 'pb'); B.ext(B.box(f, 0, 8, 9, 5.5), H * 0.89, H * 0.97, 'pb'); B.ext(B.box(f, 0, 8, 5.5, 4), H * 0.97, H, 'pb'); },
    // the Salesforce Transit Center: the white skin round its sides, the park on its roof and the park's trees
    deck(B, r, H) { const f = B.fr(r, cen(r)), n = Math.floor(f.l / 26); B.wall(r, 4, H, 'wh', { kind: 2 }); B.lid(r, H, 'gn');
      for (let i = 0; i < n; i++) { const q = B.ngon(B.at(f, (i + 0.5 - n / 2) * 26, i & 1 ? 9 : -9), 5, 5, i); B.wall(q, H, H + 5, 'tg', { s: 0.1, kind: 2 }); } },
    // One Maritime Plaza: the dark slab and the crossed braces outside its long sides
    xbrace(B, r, H) { B.skin({ m: 'gz' }); const n = r.length, P = (q, m) => [q[0], B.Y(m), q[1]];
      for (let k = 0; k < n; k++) { const a = r[k], d = r[(k + 1) % n], l = Math.hypot(d[0] - a[0], d[1] - a[1]), nr = [(d[1] - a[1]) / l, 0, -(d[0] - a[0]) / l], w = l / K > 50 ? 2 : 1;
        for (let i = 0; i < 4; i++) for (let j = 0; j < w; j++) { const p = [a[0] + (d[0] - a[0]) * j / w, a[1] + (d[1] - a[1]) * j / w], q = [a[0] + (d[0] - a[0]) * (j + 1) / w, a[1] + (d[1] - a[1]) * (j + 1) / w]; B.beam(P(p, H * i / 4), P(q, H * (i + 1) / 4), 1.6, nr, 'bz'); B.beam(P(q, H * i / 4), P(p, H * (i + 1) / 4), 1.6, nr, 'bz'); } } },
    // a tower under a pointed roof (Hills Plaza)
    pyr(B, r, H, o) { B.skin({ m: o.m }); B.wall(r, H, H + o.up, o.r, { s: 0.03, kind: 2 }); },
    // the banking hall at the foot of One Sansome: stone walls and the glass roof put over it
    hall(B, r, H) { B.ext(r, B.bot, H, 'st'); const q = inset(r, 3 * K); B.wall(q, H, H + 5, 'gs', { s: 0.45, kind: 2 }); B.lid(scl(q, 0.45), H + 5, 'gs', { plain: 1 }); },
  };

  // ---- the table: [name, the outline or outlines that take the shape, the shape (a skin's options, or [a shape of F, options], or 0: not
  // drawn), and what else goes with it: [[outline or outlines, shape], ...]] ----
  const T101 = [-122.39798, 37.79289];
  const TABLE = [
    ['181 Fremont', K(6788), ['f181']],
    ['Millennium Tower', K(5948), { m: 'gb', hull: 1, c: 5, st: [[0.955, 2.5]] }, [[K(5949), { m: 'gb' }]]],
    ['One Rincon Hill', KS(6646, 6647), ['slant', { m: 'gd', d: 0.09 }]],
    ['One Embarcadero Center', KS(5855-5859), { m: 'cc' }],
    ['Two Embarcadero Center', KS(5849-5851), { m: 'cc' }],
    ['Three Embarcadero Center', KS(5852-5854), { m: 'cc' }],
    ['Four Embarcadero Center', KS(6842-6846), { m: 'cc', H: 174 }],   // (the data: 144 m; in life 571 ft)
    ['Hyatt Regency', KS(5819-5823, 5825-5837), { m: 'cb' }, [[K(5824), ['hyatt']]]],
    ['101 California', K(6933), { m: 'gv', hull: 1, st: [[0.965, 3]] }, [[K(6931), { m: 'gv' }], [K(6932), ['lean', { m: 'gs', to: T101, h0: 6, h1: 22 }]]]],
    ['345 California Center', KS(6822, 6825-6827), { m: 'pk' }, [[KS(6821, 6823), ['spire']]]],
    ['44 Montgomery', K(5914), { m: 'gy' }],
    ['One Market Plaza', KS(6194, 6195), { m: 'cc', c: 4, st: [[0.96, 3]] }, [[K(6197), { m: 'bk' }]]],
    ['50 Fremont (Salesforce West)', K(6733), { m: 'pk', st: [[0.8, 3], [0.88, 6], [0.95, 10]] }],
    ['Park Tower at Transbay', KS(6839-6841), { m: 'gs' }],
    ['Salesforce East (350 Mission)', K(6477), { m: 'gb', st: [[0.97, 2.5]] }],
    ['The Avery', K(6853), { m: 'gs' }],
    ['LUMINA', KS(6947, 6948), { m: 'gl', st: [[0.96, 2.5]] }],
    ['The Infinity', KS(6766, 6767), { m: 'gg', st: [[0.96, 3]] }],
    ['Four Seasons (757 Market)', K(6315), { m: 'st', st: [[0.93, 3]] }],
    ['Marriott Marquis', K(5783), ['marriott']],
    ['140 New Montgomery', K(6016), ['pacbell', { H: 133 }]],   // (the data: 83 m; in life 435 ft)
    ['Russ Building', K(6174), { m: 'tc', st: [[0.9, 1.5], [0.955, 3.5]] }, [[KS(6169, 6171-6173, 6175), { m: 'tc' }]]],
    ['Shell Building', K(6582), { m: 'sp', st: [[0.74, 2], [0.84, 4.5], [0.93, 7.5]] }],
    ['One Sansome', K(5906), { m: 'gr', st: [[0.13, 2.5], [0.955, 5.5]] }, [[KS(5904, 5907-5909), 0], [K(5910), ['hall']]]],
    ['McKesson Plaza (One Post)', K(5893), { m: 'mk', fl: [1.22, 14], st: [[0.965, 2]] }],
    ['100 First Plaza', K(6019), { m: 'sv', st: [[0.74, 2.5], [0.83, 5.5], [0.91, 9]] }],
    ['333 Bush', K(6190), { m: 'gr', st: [[0.9, 2], [0.96, 4]] }],
    ['45 Fremont', K(5887), { m: 'gz', st: [[0.97, 3]] }],
    ['201 Spear', K(6374), { m: 'rs', c: 5, st: [[0.86, 2.5], [0.93, 5.5]] }],
    // lower, or not asked for by name
    ['Salesforce Transit Center', K(6805), ['deck']],
    ['One Maritime Plaza', K(5817), ['xbrace'], [[K(5818), 0]]],
    ['388 Market', K(6930), { m: 'rg' }],
    ['One Bush Plaza', K(6027), { m: 'gl' }],
    ['555 Mission', K(6013), { m: 'gp' }],
    ['Hilton Union Square', K(5638), { m: 'cc' }, [[KS(5639, 5640), { m: 'cp' }]]],
    ['Westin St. Francis', K(5586), { m: 'st' }, [[K(5585), { m: 'dk' }]]],
    ['Flood Building', K(5747), { m: 'st' }],
    ['Palace Hotel', K(6979), { m: 'tn' }],
    ['Old Mint', K(2814), { m: 'st' }],
    ['Federal Building (7th and Mission)', K(10505), { m: 'sv' }],
    ['Market Square (1355 Market)', KS(41, 42), { m: 'ad' }],
    ['Fox Plaza', K(36), { m: 'fx' }],
    ['100 Van Ness', K(60), { m: 'gb' }],
    ['War Memorial Opera House and Veterans Building', KS(23, 27), { m: 'st' }],
    ['Davies Symphony Hall', K(26), { m: 'cp' }],
    ['Asian Art Museum and the Main Library', KS(2, 0, 1), { m: 'st' }],
    ['Bill Graham Civic Auditorium', K(14), { m: 'st' }],
    ['Moscone West', K(2802), { m: 'mg' }],
    ['Metreon', K(5810), { m: 'sv' }],
    ['Rincon Center towers', KS(5872, 5874), { m: 'mm' }],
    ['Hills Plaza', KS(6993, 6995-6997), { m: 'bk' }, [[K(6994), ['pyr', { m: 'bk', r: 'cu', up: 14 }]]]],
  ];

  // ---- the three calls of js/map3d/real.js ----
  const found = []; let ok = null;   // ok: whether the look's vertex shader can read the table (shade), null until it has been asked: no building is made here before it is true
  // the shape of an entry's own outlines: with its height in life (H), its options also carry the share (k) its outlines are drawn taller by, from the tallest of them
  const own = e => { const sh = e[2], o = Array.isArray(sh) ? sh[1] : sh; if (!o || !(o.H > 0)) return sh; const ks = typeof e[1][0] === 'number' ? [e[1]] : e[1], k = o.H / Math.max(...ks.map(q => q[2]));
    return Array.isArray(sh) ? [sh[0], Object.assign({}, o, { k })] : Object.assign({}, o, { k }); };
  // match(grid, ck): once, as real.js has sorted the outlines; grid.get(ck(x, z)): the outlines about a point. Each outline of the table gets its shape (b.hero).
  // Should it fail as a whole (not one entry: that entry alone is left out), no outline keeps a shape
  function match(grid, ck) { found.length = 0; if (!ON) return; const find = (x, z) => grid.get(ck(x, z)); for (const l of grid.values()) for (const b of l) b.hero = undefined;   // (every record gets the member, so they all stay of one kind for the engine)
    const inRing = (p, n, x, z) => { let c = false; for (let i = 0, j = n - 1; i < n; j = i++) { const xi = p[i * 2], zi = p[i * 2 + 1], xj = p[j * 2], zj = p[j * 2 + 1]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
    const one = (k, shape, row) => { const p = Geom.proj(k), l = find(p[0], p[1]) || []; let best = null, bd = 0.12; row.want++;
      for (const b of l) { if (b.h !== k[2] || b.n !== k[3] || b.hero !== undefined || !inRing(b.p, b.n, p[0], p[1])) continue; const d = Math.abs(b.area / (K * K) / k[4] - 1); if (d < bd) { bd = d; best = b; } }
      if (best) { best.hero = shape; row.got++; } };
    const all = (ks, shape, row) => { if (typeof ks[0] === 'number') one(ks, shape, row); else for (const k of ks) one(k, shape, row); };
    try { for (const e of TABLE) { const row = { name: e[0], want: 0, got: 0 }; try { all(e[1], own(e), row); for (const x of e[3] || []) all(x[0], x[1], row); } catch (err) { row.err = String(err && err.message || err); } found.push(row); } }
    catch (e) { ok = false; for (const l of grid.values()) for (const b of l) b.hero = undefined; console.warn('3D map, the named buildings left out: ' + (e && e.message || e)); }
  }
  // put(b, …): as real.js makes the shape of outline b (b.hero set): true when the building is made here (or is not drawn), false to have the outline as the look
  // makes it; a shape that fails throws, into real.js's own catch (b.hero null: real.js makes it as the look makes an outline).
  // vert, idx, ears: real.js's own; g: the ground it grows from; gc: the ground at its middle; s: map units of height per metre (real.js's K times its factor)
  function put(b, vert, idx, ears, g, gc, s) { const h = b.hero; if (!ON || ok !== true || h == null) return false; if (h === 0) return true;
    const o = Array.isArray(h) ? h[1] || {} : h, H = b.h * (o.k || 1);
    try { begin(b, vert, idx, ears, g, gc, s, H); if (Array.isArray(h)) F[h[0]](B, B.ring, H, o); else B.skin(h); return true; }
    catch (e) { b.hero = null; console.warn('3D map, a named building stands as its outline: ' + (e && e.message || e)); throw e; } }   // (real.js takes back what was made of it and makes it again as any outline)
  // shade(s): the look's shaders as real.js has written them, given the table of materials and the line that reads it. real.js asks it once on its own copy of
  // the look's shader text as soon as it makes the look's material, before any building is made, then again as each program is made. Should that text not
  // have everything the line reads (or real.js give no height factor), the named buildings are left out (said once) and every outline stands as the look makes it.
  // The line: a named building's colour, as a real building's, is the look's pale (here times its material's colour) with the same share of its place's colour
  // (a lens, the quiz, a selection and a fade move it as they move its neighbours); its walls a little darker below about 15 m, as real.js's are
  const NEED = ['#include <common>', 'vFab = ', 'float ft', 'bool top', 'tall = ', 'st = r1', 'vec3 fc = ', 'vec4 fpl', ' aW = ', 'uniform vec3 uPale', 'uniform float uRoofK', 'uniform float uWallK'];
  function shade(s) { if (!ON) return;
    try { const v = s && s.vertexShader, V = M3D.real && M3D.real.V, miss = NEED.filter(t => typeof v !== 'string' || v.indexOf(t) < 0);
      if (miss.length || !(V > 0)) throw new Error('the look\'s vertex shader has no ' + (miss.length ? miss.join(', ') : 'height factor'));
      const vs = v.replace('#include <common>', '#include <common>\nuniform vec4 uHero[' + NM + '];')
        .replace('vFab = ', 'if (ft >= 1.0) { vec4 hm = uHero[int(ft) - 1]; ft = fract(ft); st = hm.a; fc = mix(fpl.rgb, uPale * hm.rgb, top ? uRoofK + (0.82 - uRoofK) * 0.7 * tall : uWallK + (0.86 - uWallK) * 0.72 * tall) * (top ? 1.0 : 0.86 + 0.14 * smoothstep(0.0, ' + (14.85 * K * V).toFixed(3) + ', aW.y)); }\nvFab = ');
      if (ok === false) return; s.vertexShader = vs; if (s.uniforms) s.uniforms.uHero = U; ok = true; }
    catch (e) { if (ok !== false) console.warn('3D map, the named buildings left out: ' + (e && e.message || e)); ok = false;
      // (a building made here before this is known carries a material's number in its tint: where the text allows, the line that drops it, so it stands in the look's own colours)
      try { const v = s.vertexShader; if (v.indexOf('vFab = ') >= 0 && v.indexOf('float ft') >= 0) s.vertexShader = v.replace('vFab = ', 'if (ft >= 1.0) ft = fract(ft);\nvFab = '); } catch (e2) {} } }

  M3D.heroes = { on: ON, match, put, shade, found, TABLE, MAT, F, pal: U, get ok() { return ok; } };
})();
