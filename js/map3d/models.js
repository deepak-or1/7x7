// Seven by Seven, the 3D map: everything built. Loaded only when the 3D map is wanted (index.html), after js/map3d/land.js.
// A small mesh builder (lofts, boxes, tubes, all in code) and the stylised models made with it: the bridges, the San Francisco
// icons, the Las Vegas Strip icons, a generic skyline and the Strip's resorts, and the flag and the bookmark that mark a place.
// Dimensions are the real ones in metres, then enlarged per model so each reads on the map (see PLACED below).
// World frame: x = map x, z = map y (south), y = up; one unit is one map unit, about 143 m. Needs THREE. Defines window.M3D.models.
(function () {
  'use strict';
  const T = window.M3D.land, proj = T.proj, K = 1 / T.UNIT_M; // K: world units per metre
  const lerp = (a, b, t) => a + (b - a) * t, clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const RD_OFF = /[?&]m3d-roads=off(?:&|$)/.test(location.search);
  const HS = T.HX / 2.5;   // the heights' factor (js/map3d/land.js HX, ?m3d-tall) against the 2.5 the made-up skylines were drawn for
  // the bridges' heights: 2.2 times life beside buildings at 2.5, and HS to the power BE of that beside lower ones. Their decks meet blocks that stand 0.5 above
  // the water at sea level, higher on a hill (js/map3d/land.js), which do not come down: the lower a deck, the more ends run into the land.
  // ?m3d-tall-bridge=<BE>: another power (0: 2.2 always; 1: in proportion with the buildings)
  const BE = (m => m && +m[1] >= 0 && +m[1] <= 2 ? +m[1] : 0.5)(/[?&]m3d-tall-bridge=([0-9.]+)(?:&|$)/.exec(location.search)), BV = 2.2 * Math.pow(HS, BE);   // ?m3d-roads=off (js/map3d.js): no roads, and the seven bridges where they stood before the roads came (bridges below)
  const sstep = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = a => Math.hypot(a[0], a[1], a[2]), norm = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const cen = r => { const c = [0, 0, 0]; for (const p of r) { c[0] += p[0]; c[1] += p[1]; c[2] += p[2]; } return mul(c, 1 / r.length); };
  function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const hash = str => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };

  // ---------- the builder: flat triangles with a material name, a window UV and a glow factor per vertex ----------
  const CELL = 1 / 8; // the window texture is 8 x 8 cells; cell (0, 0) is always lit (solid glows sample its middle)
  class Builder {
    constructor() { this.pos = []; this.nor = []; this.uv = []; this.glow = []; this.mat = []; this.sh = []; this.names = []; this.lights = []; this.stack = []; this.M = new THREE.Matrix4(); this.v3 = new THREE.Vector3(); }
    id(name) { let i = this.names.indexOf(name); if (i < 0) { i = this.names.length; this.names.push(name); } return i; }
    push(m) { this.stack.push(this.M.clone()); this.M.multiply(m); } pop() { this.M.copy(this.stack.pop()); }
    // place(x, y, z, ryDeg, scale, fn): build inside a moved, turned and scaled frame
    place(x, y, z, ry, s, fn) { const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry * Math.PI / 180), new THREE.Vector3(s, s, s)); this.push(m); fn(); this.pop(); }
    X(p) { const v = this.v3.set(p[0], p[1], p[2]).applyMatrix4(this.M); return [v.x, v.y, v.z]; }
    tri(m, a, b, c, na, nb, nc, ua, ub, uc, g, sa = 1, sb = 1, sc = 1) {
      this.sh.push(sa, sb, sc);
      this.pos.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]); this.nor.push(na[0], na[1], na[2], nb[0], nb[1], nb[2], nc[0], nc[1], nc[2]);
      this.uv.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1]); this.glow.push(g, g, g); this.mat.push(m, m, m);
    }
    // rings of the same point count, skinned in order. o: { flat, cap (last ring, default true), cap0 (first ring), win: [across, up], lit: glow of a solid light }
    loft(mat, rings, o = {}) {
      const m = this.id(mat), R = rings.map(r => r.map(p => this.X(p))), n = R[0].length, nr = R.length, C = R.map(cen);
      let flip = false, found = false;
      for (let i = 0; i < nr - 1 && !found; i++) for (let j = 0; j < n && !found; j++) {
        const A = R[i][j], B = R[i][(j + 1) % n], D = R[i + 1][(j + 1) % n], N = cross(sub(B, A), sub(D, A)); if (len(N) < 1e-12) continue;
        const out = sub(mul(add(add(A, B), D), 1 / 3), mul(add(C[i], C[i + 1]), 0.5)); if (len(out) < 1e-9) continue;
        flip = dot(N, out) < 0; found = true;
      }
      const lit = o.lit != null, g = lit ? -o.lit : o.win ? (o.glow != null ? o.glow : 1) : 0, solid = [CELL / 2, CELL / 2]; // a negative glow marks a solid light, tinted by its own colour
      const along = [0]; for (let i = 1; i < nr; i++) along.push(along[i - 1] + len(sub(C[i], C[i - 1]))); const tot = along[nr - 1] || 1;
      const ao = o.ao, shOf = i => ao ? lerp(ao[0], ao[1], along[i] / tot) : 1;
      const uvOf = (i, j, side) => lit ? solid : o.win ? [(o.flat ? side * o.win[0] : j * o.win[0] / n) * CELL, along[i] / tot * o.win[1] * CELL] : [0, 0];
      // face normals, summed per vertex for the smooth case
      const acc = o.flat ? null : R.map(() => Array.from({ length: n }, () => [0, 0, 0]));
      const faces = [];
      for (let i = 0; i < nr - 1; i++) for (let j = 0; j < n; j++) {
        const k = (j + 1) % n, A = R[i][j], B = R[i][k], Cc = R[i + 1][k], D = R[i + 1][j];
        let N1 = cross(sub(B, A), sub(Cc, A)), N2 = cross(sub(Cc, A), sub(D, A)); if (flip) { N1 = mul(N1, -1); N2 = mul(N2, -1); }
        faces.push([i, j, k, N1, N2]);
        if (acc) { for (const [ii, jj] of [[i, j], [i, k], [i + 1, k]]) acc[ii][jj] = add(acc[ii][jj], N1); for (const [ii, jj] of [[i, j], [i + 1, k], [i + 1, j]]) acc[ii][jj] = add(acc[ii][jj], N2); }
      }
      for (const [i, j, k, N1, N2] of faces) {
        const A = R[i][j], B = R[i][k], Cc = R[i + 1][k], D = R[i + 1][j];
        const fn = norm(add(N1, N2)), nA = acc ? norm(acc[i][j]) : fn, nB = acc ? norm(acc[i][k]) : fn, nC = acc ? norm(acc[i + 1][k]) : fn, nD = acc ? norm(acc[i + 1][j]) : fn;
        const uA = uvOf(i, j, 0), uB = uvOf(i, j + 1, 1), uC = uvOf(i + 1, j + 1, 1), uD = uvOf(i + 1, j, 0);
        const s0 = shOf(i), s1 = shOf(i + 1);
        if (len(N1) > 1e-12) { if (flip) this.tri(m, A, Cc, B, nA, nC, nB, uA, uC, uB, g, s0, s1, s0); else this.tri(m, A, B, Cc, nA, nB, nC, uA, uB, uC, g, s0, s0, s1); }
        if (len(N2) > 1e-12) { if (flip) this.tri(m, A, D, Cc, nA, nD, nC, uA, uD, uC, g, s0, s1, s1); else this.tri(m, A, Cc, D, nA, nC, nD, uA, uC, uD, g, s0, s1, s1); }
      }
      const capAt = (i, other) => {
        const r = R[i], c = C[i]; let N = [0, 0, 0]; for (let j = 0; j < n; j++) N = add(N, cross(sub(r[j], c), sub(r[(j + 1) % n], c))); if (len(N) < 1e-12) return;
        let dir = sub(c, C[other]); if (len(dir) < 1e-9) dir = N; const f = dot(N, dir) < 0; N = norm(f ? mul(N, -1) : N);
        const u = lit ? solid : [0, 0], gg = lit ? g : 0;
        for (let j = 0; j < n; j++) { const a = r[j], b = r[(j + 1) % n]; if (f) this.tri(m, c, b, a, N, N, N, u, u, u, gg); else this.tri(m, c, a, b, N, N, N, u, u, u, gg); }
      };
      if (o.cap !== false) capAt(nr - 1, nr - 2); if (o.cap0) capAt(0, 1);
    }
    // a rectangle in plan, sx by sz, turned ry degrees about its centre
    rect(x, y, z, sx, sz, ry = 0) { const c = Math.cos(ry * Math.PI / 180), s = Math.sin(ry * Math.PI / 180); return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => { const px = a * sx / 2, pz = b * sz / 2; return [x + px * c + pz * s, y, z - px * s + pz * c]; }); }
    frustum(mat, x, y, z, sx0, sz0, sx1, sz1, h, o = {}) { this.loft(mat, [this.rect(x, y, z, sx0, sz0, o.ry), this.rect(x, y + h, z, sx1, sz1, o.ry)], Object.assign({ flat: true }, o)); }
    box(mat, x, y, z, sx, sz, h, o) { this.frustum(mat, x, y, z, sx, sz, sx, sz, h, o); }
    circ(x, y, z, r, n, ph = 0, rz = r) { return Array.from({ length: n }, (_, j) => { const a = ph + j / n * Math.PI * 2; return [x + Math.cos(a) * r, y, z + Math.sin(a) * rz]; }); }
    // a rounded square (superellipse) in plan
    sq(x, y, z, r, n, e = 4) { return Array.from({ length: n }, (_, j) => { const a = j / n * Math.PI * 2 + Math.PI / n, c = Math.cos(a), s = Math.sin(a), k = Math.pow(Math.pow(Math.abs(c), e) + Math.pow(Math.abs(s), e), -1 / e); return [x + c * k * r, y, z + s * k * r]; }); }
    cyl(mat, x, y, z, r0, r1, h, n = 10, o = {}) { this.loft(mat, [this.circ(x, y, z, r0, n), this.circ(x, y + h, z, r1, n)], o); }
    // revolve a profile [[r, y], ...] about the vertical through (x, z)
    lathe(mat, x, z, prof, n = 12, o = {}) { this.loft(mat, prof.map(([r, y]) => this.circ(x, y, z, r, n)), o); }
    frameOf(d) { let up = [0, 1, 0]; if (Math.abs(dot(norm(d), up)) > 0.97) up = [1, 0, 0]; const s = norm(cross(d, up)), u = norm(cross(s, d)); return [s, u]; }
    // a straight member of rectangular section from p to q
    beam(mat, p, q, w, h = w, o = {}) { const [s, u] = this.frameOf(sub(q, p)), a = mul(s, w / 2), b = mul(u, h / 2), ring = c => [sub(sub(c, a), b), sub(add(c, a), b), add(add(c, a), b), add(sub(c, a), b)]; this.loft(mat, [ring(p), ring(q)], Object.assign({ flat: true, cap0: true }, o)); }
    // a round member through points (cables, rings)
    tube(mat, pts, r, sides = 5, o = {}) {
      const rings = pts.map((p, i) => { const d = sub(pts[Math.min(pts.length - 1, i + 1)], pts[Math.max(0, i - 1)]), [s, u] = this.frameOf(d); return Array.from({ length: sides }, (_, j) => { const a = j / sides * Math.PI * 2; return add(p, add(mul(s, Math.cos(a) * r), mul(u, Math.sin(a) * r))); }); });
      this.loft(mat, rings, Object.assign({ cap: false }, o));
    }
    // a round member between two points with a radius at each end (columns at an angle, spokes, discs)
    rod(mat, p, q, r0, r1 = r0, sides = 8, o = {}) { const [s, u] = this.frameOf(sub(q, p)), ring = (c, r) => Array.from({ length: sides }, (_, j) => { const a = j / sides * Math.PI * 2; return add(c, add(mul(s, Math.cos(a) * r), mul(u, Math.sin(a) * r))); }); this.loft(mat, [ring(p, r0), ring(q, r1)], Object.assign({ cap0: true }, o)); }
    light(p, kind, size = 1) { const q = this.X(p); this.lights.push({ x: q[0], y: q[1], z: q[2], kind, size }); }
    finish() {
      const g = new THREE.BufferGeometry(), n = this.pos.length / 3;
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.pos), 3)); g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.nor), 3));
      g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.uv), 2)); g.setAttribute('glow', new THREE.BufferAttribute(new Float32Array(this.glow), 1));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      g.computeBoundingSphere(); g.computeBoundingBox();
      return { geometry: g, mat: Uint8Array.from(this.mat), shade: Float32Array.from(this.sh), names: this.names.slice(), lights: this.lights, tris: n / 3 };
    }
  }

  // ---------- the bridges ----------
  // A bridge frame: x metres along the line from A to B, lat metres to the left (widened by wex), heights in metres above the
  // water (raised by vex) or above the deck. The deck meets the ground at an end where the ground is below it; where the hill is
  // higher it runs into the hillside, as the real roads do.
  function bridgeFrame(a, b, wex, vex, ground) {
    const A = proj(a), B = proj(b), Lw = Math.hypot(B[0] - A[0], B[1] - A[1]), u = [(B[0] - A[0]) / Lw, (B[1] - A[1]) / Lw], n = [-u[1], u[0]];
    const f = { A, B, L: Lw / K, u, n, vex, wex };
    f.P = (x, lat, y) => [A[0] + u[0] * x * K + n[0] * lat * wex * K, y, A[1] + u[1] * x * K + n[1] * lat * wex * K];
    // the deck's height along it. At an end that reaches land: where the land's top at the shore stands above the deck (a block stands 0.5 above
    // the water even at sea level), the deck rises to it over its last stretch, eased, at about RG (so the road on the land meets it, as one
    // surface); where the land is lower, the deck comes to the ground at its end as before (blendA, blendB). Beyond the point where it runs into
    // the land it goes on just under the ground (so it never comes out again on the far side of a hill: deckRaw, js/map3d/roads.js, is the
    // height it would have, for the portal where it goes in). shores: per end, the shore's distance from that end and the rise there (metres, map units)
    f.setDeck = (zr, blendA, blendB) => {
      const g0 = x => { const p = f.P(x, 0, 0); return ground(p[0], p[2]); }, base = x => zr(x) * vex * K, RG = 0.06, LOW = T.LAND_TOP + 0.005;
      const ends = [0, 1].map(e => { const at = d => e ? f.L - d : d; let xs = null; for (let d = 0; d < f.L / 2; d += 10) if (g0(at(d)) <= LOW) { xs = d; break; }
        if (xs === 0) { for (let d = 10; d <= 300; d += 10) { const x = e ? f.L + d : -d; if (g0(x) > LOW) { let gL = -Infinity; for (let q = d; q <= d + 30; q += 10) gL = Math.max(gL, g0(e ? f.L + q : -q)); const rise = gL - 0.005 - base(at(0)); return rise > 0.005 ? { rise, xs: 0, R: clamp(rise / K / RG, 150, f.L * 0.4) } : { rise: 0 }; } } return { rise: 0 }; }   // (the end in the water short of the shore, as the Bay Bridge's at Oakland: the land just beyond it)
        if (!xs) return { rise: 0 };   // (none)
        let gS = -Infinity; for (let d = Math.max(0, xs - 30); d < xs; d += 10) gS = Math.max(gS, g0(at(d)));
        const rise = gS - 0.005 - base(at(xs)); if (!(rise > 0.005)) return { rise: 0, xs };
        return { rise, xs, R: clamp(rise / K / RG, 150, f.L * 0.4) }; });
      const yA = base(0), yB = base(f.L), gA = Math.min(ground(A[0], A[1]) - 0.03, yA + 0.3), gB = Math.min(ground(B[0], B[1]) - 0.03, yB + 0.3), [eA, eB] = ends;
      const raw = x => base(x) + (eA.rise ? eA.rise * (1 - sstep((x - eA.xs) / eA.R)) : blendA ? (gA - yA) * (1 - sstep(x / blendA)) : 0) + (eB.rise ? eB.rise * sstep((x - (f.L - eB.xs - eB.R)) / eB.R) : blendB ? (gB - yB) * sstep((x - (f.L - blendB)) / blendB) : 0);
      // (where it is in the land: from each end inwards up to the first point clear of the ground, the ground every 10 m)
      const cut = [0, 1].map(e => { const gs = []; for (let d = 0; d < f.L / 2; d += 10) { const x = e ? f.L - d : d, g = g0(x); if (g <= LOW || g <= raw(x) - 0.02) return { d, gs }; gs.push(g); } return { d: 0, gs: [] }; });
      const under = (e, d) => { const c = cut[e]; if (!(d < c.d)) return Infinity; const i = d / 10, j = Math.min(c.gs.length - 1, Math.floor(i)), t = Math.min(1, i - j); return lerp(c.gs[j], c.gs[Math.min(c.gs.length - 1, j + 1)], t) - 0.03; };
      f.deckRaw = raw; f.shores = ends.map(o => o.xs != null ? [o.xs, o.rise / K] : null);
      f.deck = x => Math.min(raw(x), under(0, x), under(1, f.L - x));
    };
    f.H = (x, lat, hm) => f.P(x, lat, hm * vex * K);               // a height above the water
    f.D = (x, lat, dm) => f.P(x, lat, f.deck(x) + dm * vex * K);   // a height above the deck
    return f;
  }
  const range = (a, b, step) => { const n = Math.max(1, Math.round((b - a) / step)); return Array.from({ length: n + 1 }, (_, i) => a + (b - a) * i / n); };
  // a deck slab between stations: lat half-width hw, from `under` below the deck to its top, with a darker road on it
  function deckSlab(b, f, mat, x0, x1, hw, under, step, road) {
    const xs = range(x0, x1, step); f.hw = Math.max(f.hw || 0, hw);   // (hw: the deck's half width, for the roads that meet it, js/map3d/roads.js)
    b.loft(mat, xs.map(x => [f.D(x, -hw, -under), f.D(x, hw, -under), f.D(x, hw, 0), f.D(x, -hw, 0)]), { flat: true, cap0: true });
    if (road) b.loft(road, xs.map(x => [f.D(x, -hw * 0.72, 0.2), f.D(x, hw * 0.72, 0.2), f.D(x, hw * 0.72, 1.4), f.D(x, -hw * 0.72, 1.4)]), { flat: true, cap0: true });
  }
  const bbox = (b, f, mat, x0, x1, l0, l1, p0, p1, o) => b.loft(mat, [[p0(x0, l0), p0(x1, l0), p0(x1, l1), p0(x0, l1)], [p1(x0, l0), p1(x1, l0), p1(x1, l1), p1(x0, l1)]], Object.assign({ flat: true, cap0: true }, o));
  // a hanging cable from p to q (world points), sagging `sag` world units below the straight line at the middle
  const cablePts = (p, q, sag, n) => Array.from({ length: n + 1 }, (_, i) => { const t = i / n; return [lerp(p[0], q[0], t), lerp(p[1], q[1], t) - sag * 4 * t * (1 - t), lerp(p[2], q[2], t)]; });
  const cableY = (p, q, sag, t) => lerp(p[1], q[1], t) - sag * 4 * t * (1 - t);

  function goldenGate(b, ground) {
    const f = bridgeFrame([-122.4773, 37.8095], [-122.4790, 37.8335], 2.6, BV, ground), L = f.L;
    const xS = 0.19 * L, xN = xS + 1280, mid = (xS + xN) / 2, xa0 = xS - 343, xa1 = xN + 343;
    f.setDeck(x => Math.max(62, 75 - 5 * Math.pow((x - mid) / 640, 2)), xS - 120, L - xN - 120);
    deckSlab(b, f, 'gg', 0, L, 13.7, 9, 70, 'road');
    for (const x of [xS, xN]) {
      // two legs that step in at each portal, four portals, a concrete pier
      const sec = [[13, 118, 22, 5.2], [118, 170, 18, 4.4], [170, 227, 14.5, 3.6]];
      for (const s of [-1, 1]) { for (const [h0, h1, w, t] of sec) bbox(b, f, 'gg', x - w / 2, x + w / 2, s * 13.7 - t, s * 13.7 + t, (xx, l) => f.H(xx, l, h0), (xx, l) => f.H(xx, l, h1)); bbox(b, f, 'gg', x - 5, x + 5, s * 13.7 - 2.6, s * 13.7 + 2.6, (xx, l) => f.H(xx, l, 227), (xx, l) => f.H(xx, l, 231)); }
      for (const zc of [50, 118, 157, 191, 222]) bbox(b, f, 'ggShade', x - 5.5, x + 5.5, -11, 11, (xx, l) => f.H(xx, l, zc - 4.5), (xx, l) => f.H(xx, l, zc + 4.5));
      bbox(b, f, 'concrete', x - 17, x + 17, -22, 22, (xx, l) => f.H(xx, l, -4), (xx, l) => f.H(xx, l, 13));
      b.light(f.H(x, -13.7, 234), 'red', 1.5); b.light(f.H(x, 13.7, 234), 'red', 1.5);
      for (const hh of [60, 110, 160, 205]) b.light(f.H(x, 0, hh), 'warm', 2.2);
    }
    const top = 226 * f.vex * K, r = 0.05;
    for (const s of [-1, 1]) {
      const lat = s * 13.7, a0 = f.D(xa0, lat, 3), a1 = f.D(xa1, lat, 3), tS = f.P(xS, lat, top), tN = f.P(xN, lat, top), low = f.deck(mid) + 4 * f.vex * K;
      const sagMain = top - low, runs = [[a0, tS, 0.12, 8, xa0, xS], [tS, tN, sagMain, 26, xS, xN], [tN, a1, 0.12, 8, xN, xa1]];
      for (const [p, q, sag, n, x0, x1] of runs) {
        b.tube('ggCable', cablePts(p, q, sag, n), r, 5);
        for (const x of range(x0, x1, 53).slice(1, -1)) { const t = (x - x0) / (x1 - x0), y = cableY(p, q, sag, t), d = f.D(x, lat, 0); if (y - d[1] > 0.12) b.beam('ggCable', d, [d[0], y, d[2]], 0.028); }
        for (const x of range(x0, x1, 64)) { const t = (x - x0) / (x1 - x0), d = f.D(x, lat, 0); b.light([d[0], cableY(p, q, sag, t) + 0.03, d[2]], 'warm', 0.8); }
      }
      // the anchorage pylons at the ends of the side spans
      for (const x of [xa0, xa1]) bbox(b, f, 'gg', x - 7, x + 7, lat - 3, lat + 3, (xx, l) => f.D(xx, l, -30), (xx, l) => f.D(xx, l, 22));
      for (const x of range(0, L, 90)) b.light(f.D(x, lat, 3), 'warm', 0.55);
    }
    return f;
  }

  function bayWest(b, ground) {
    const f = bridgeFrame([-122.38932, 37.78746], [-122.3668, 37.8085], 2.6, BV, ground), L = f.L;   // (its west end on the real I-80, js/map3d/roaddata.js: it stood 80 m south-east of it, and the road met no deck)
    const a0 = Math.max(60, (L - 2824) * 0.55), W2 = a0 + 354, W3 = W2 + 704, W4 = W3 + 354, W5 = W4 + 354, W6 = W5 + 704, a1 = W6 + 354;
    const zr = x => x <= W2 ? lerp(50, 70, sstep(x / W2)) : 70;
    f.setDeck(zr, a0 + 120, 0);
    deckSlab(b, f, 'steel', 0, L, 10.2, 10, 80, 'road');
    for (const [x, H] of [[W2, 144], [W3, 158], [W5, 158], [W6, 144]]) {
      for (const s of [-1, 1]) bbox(b, f, 'steel', x - 6.5, x + 6.5, s * 11.5 - 2.6, s * 11.5 + 2.6, (xx, l) => f.H(xx, l, 4), (xx, l) => f.H(xx, l, H + 3));
      // struts and the X bracing between the legs, above the roadway
      const zd = zr(x), lv = [zd + 22, zd + 22 + (H - zd - 22) / 2, H - 3];
      for (const zc of [zd - 16, lv[0], lv[1], lv[2]]) bbox(b, f, 'steelShade', x - 3, x + 3, -10, 10, (xx, l) => f.H(xx, l, zc - 2.5), (xx, l) => f.H(xx, l, zc + 2.5));
      for (let i = 0; i < 2; i++) for (const s of [-1, 1]) b.beam('steelShade', f.H(x, s * 10, lv[i] + 2), f.H(x, -s * 10, lv[i + 1] - 2), 0.035, 0.05);
      bbox(b, f, 'concrete', x - 12, x + 12, -17, 17, (xx, l) => f.H(xx, l, -4), (xx, l) => f.H(xx, l, 8));
      b.light(f.H(x, 0, H + 6), 'red', 1.3);
    }
    // the centre anchorage, a concrete monolith, and the San Francisco anchorage
    const za = zr(W4);
    b.loft('concrete', [[f.H(W4 - 33, -17, -4), f.H(W4 + 33, -17, -4), f.H(W4 + 33, 17, -4), f.H(W4 - 33, 17, -4)], [f.H(W4 - 30, -15, za - 9), f.H(W4 + 30, -15, za - 9), f.H(W4 + 30, 15, za - 9), f.H(W4 - 30, 15, za - 9)]], { flat: true });
    for (const s of [-1, 1]) b.loft('concrete', [[f.H(W4 - 26, s * 11.5 - 3, za - 9), f.H(W4 + 26, s * 11.5 - 3, za - 9), f.H(W4 + 26, s * 11.5 + 3, za - 9), f.H(W4 - 26, s * 11.5 + 3, za - 9)], [f.H(W4 - 8, s * 11.5 - 2.4, za + 17), f.H(W4 + 8, s * 11.5 - 2.4, za + 17), f.H(W4 + 8, s * 11.5 + 2.4, za + 17), f.H(W4 - 8, s * 11.5 + 2.4, za + 17)]], { flat: true });
    bbox(b, f, 'concrete', a0 - 30, a0 + 14, -15, 15, (xx, l) => f.H(xx, l, -4), (xx, l) => f.D(xx, l, -9));
    const r = 0.042, tp = (x, lat, h) => f.H(x, lat, h);
    for (const s of [-1, 1]) {
      const lat = s * 11.5, run = [[f.D(a0, lat, 3), tp(W2, lat, 143), 0.05, a0, W2, 8], [tp(W2, lat, 143), tp(W3, lat, 157), 0, W2, W3, 20], [tp(W3, lat, 157), tp(W4, lat, za + 16), 0.05, W3, W4, 8], [tp(W4, lat, za + 16), tp(W5, lat, 157), 0.05, W4, W5, 8], [tp(W5, lat, 157), tp(W6, lat, 143), 0, W5, W6, 20], [tp(W6, lat, 143), f.D(a1, lat, 3), 0.05, W6, a1, 8]];
      for (const [p, q, sg, x0, x1, n] of run) {
        let sag = sg; if (!sag) sag = (p[1] + q[1]) / 2 - (f.deck((x0 + x1) / 2) + 3.5 * f.vex * K);
        b.tube('steelCable', cablePts(p, q, sag, n), r, 5);
        for (const x of range(x0, x1, 50).slice(1, -1)) { const t = (x - x0) / (x1 - x0), y = cableY(p, q, sag, t), d = f.D(x, lat, 0); if (y - d[1] > 0.1) { b.beam('steelCable', d, [d[0], y, d[2]], 0.024); if (s > 0) for (let k = 1; k <= 3; k++) { const yy = lerp(d[1], y, k / 3.4); if (yy - d[1] > 0.08) b.light([d[0], yy, d[2]], 'white', 0.75); } } } // the Bay Lights: white lights up the hangers of the north cable
        for (const x of range(x0, x1, 60)) { const t = (x - x0) / (x1 - x0), d = f.D(x, lat, 0); b.light([d[0], cableY(p, q, sag, t) + 0.03, d[2]], 'white', 0.8); }
      }
      for (const x of range(0, L, 100)) b.light(f.D(x, lat, 3), 'warm', 0.5);
    }
    return f;
  }

  function bayEast(b, ground, off) {
    const f = off ? bridgeFrame([-122.3590, 37.8135], [-122.3200, 37.8230], 1.7, BV, ground) : bridgeFrame([-122.3641, 37.8110], [-122.3277, 37.8220], 1.7, BV, ground), L = f.L;   // (?m3d-roads=off: where it stood before the roads, RD_OFF)
    const W2 = 300, Tx = 480, E2 = 865, sk1 = Math.min(L - 300, E2 + 160 * 13);
    const zr = x => x <= E2 ? 52 : x <= sk1 ? lerp(52, 12, sstep((x - E2) / (sk1 - E2))) : lerp(12, 6, (x - sk1) / (L - sk1));
    f.setDeck(zr, 0, 420);
    deckSlab(b, f, 'white', 0, E2, 36, 6, 80, 'roadLight'); deckSlab(b, f, 'concreteLight', E2, L, 36, 5, 110, 'roadLight');
    for (const x of range(E2, sk1, 160).slice(1)) if (zr(x) > 14) bbox(b, f, 'concreteLight', x - 5, x + 5, -22, 22, (xx, l) => f.H(xx, l, -4), (xx, l) => f.D(xx, l, -5));
    for (const x of [W2, E2]) bbox(b, f, 'concreteLight', x - 7, x + 7, -30, 30, (xx, l) => f.H(xx, l, -4), (xx, l) => f.D(xx, l, -6));
    // the single white tower and its cable, looped down to both edges of the deck
    const H = 160; b.loft('white', [[f.H(Tx - 6.5, -5, 0), f.H(Tx + 6.5, -5, 0), f.H(Tx + 6.5, 5, 0), f.H(Tx - 6.5, 5, 0)], [f.H(Tx - 3.6, -3, H), f.H(Tx + 3.6, -3, H), f.H(Tx + 3.6, 3, H), f.H(Tx - 3.6, 3, H)]], { flat: true });
    bbox(b, f, 'concreteLight', Tx - 16, Tx + 16, -12, 12, (xx, l) => f.H(xx, l, -4), (xx, l) => f.H(xx, l, 6));
    b.light(f.H(Tx, 0, H + 5), 'red', 1.3);
    for (const s of [-1, 1]) {
      const top = f.H(Tx, s * 1.5, H - 3);
      for (const [xe, sag] of [[E2 - 12, 0.3], [W2 + 8, 0.08]]) {
        const e = f.D(xe, s * 37, 2), pts = cablePts(top, e, sag, 14); b.tube('whiteCable', pts, 0.04, 5);
        for (let i = 2; i < pts.length - 1; i += 1) { const t = i / (pts.length - 1), x = lerp(Tx, xe, t), d = f.D(x, s * 37, 0); if (pts[i][1] - d[1] > 0.1) b.beam('whiteCable', d, pts[i], 0.02); b.light(pts[i], 'white', 0.8); }
      }
      for (const x of range(0, L, 110)) b.light(f.D(x, s * 36, 3), 'white', 0.5);
    }
    return f;
  }

  // the other crossings, kept simple: a deck on piers that climbs over its shipping channel, with a truss or towers there
  function plainBridge(b, ground, a, c, o) {
    const f = bridgeFrame(a, c, o.wex || 2.4, BV, ground), L = f.L, humps = o.humps || [];
    const zr = x => { let z = o.low || 9; for (const [fr, w, h] of humps) z = Math.max(z, lerp(o.low || 9, h, sstep(1 - Math.abs(x / L - fr) / w))); return z; };
    f.setDeck(zr, Math.min(500, L * 0.2), Math.min(500, L * 0.2));
    deckSlab(b, f, o.mat || 'concreteLight', 0, L, 12, 4, Math.max(120, L / 40), 'roadLight');
    for (const x of range(0, L, o.pier || 320).slice(1, -1)) bbox(b, f, 'concrete', x - 5, x + 5, -8, 8, (xx, l) => f.H(xx, l, -4), (xx, l) => f.D(xx, l, -4));
    for (const [fr, w, h] of humps) {
      const x0 = (fr - w * 0.55) * L, x1 = (fr + w * 0.55) * L;
      if (o.towers) { // a suspension span
        const xa = (fr - w * 0.3) * L, xb = (fr + w * 0.3) * L, top = (h + 75) * f.vex * K;
        for (const x of [xa, xb]) { for (const s of [-1, 1]) bbox(b, f, 'steel', x - 5, x + 5, s * 12 - 2.4, s * 12 + 2.4, (xx, l) => f.H(xx, l, 0), (xx, l) => f.P(xx, l, top)); bbox(b, f, 'steelShade', x - 3, x + 3, -10, 10, (xx, l) => f.P(xx, l, top - 0.12), (xx, l) => f.P(xx, l, top - 0.03)); b.light(f.P(x, 0, top + 0.05), 'red', 1); }
        for (const s of [-1, 1]) { const lat = s * 12, P0 = f.D(x0, lat, 2), P1 = f.P(xa, lat, top), P2 = f.P(xb, lat, top), P3 = f.D(x1, lat, 2); b.tube('steelCable', cablePts(P0, P1, 0.04, 5), 0.04, 5); b.tube('steelCable', cablePts(P1, P2, top - f.deck((xa + xb) / 2) - 0.04, 14), 0.04, 5); b.tube('steelCable', cablePts(P2, P3, 0.04, 5), 0.04, 5); }
      } else { // a through truss: an arched top chord over the channel, with a few posts
        for (const s of [-1, 1]) {
          const xs = range(x0, x1, (x1 - x0) / 10), pts = xs.map((x, i) => { const t = i / 10; return f.D(x, s * 12, 6 + 34 * Math.sin(Math.PI * t)); });
          b.tube(o.truss || 'steel', pts, 0.045, 4);
          xs.forEach((x, i) => { if (i % 2 === 1) b.beam(o.truss || 'steel', f.D(x, s * 12, 0), pts[i], 0.03); });
        }
      }
    }
    for (const s of [-1, 1]) for (const x of range(0, L, 220)) b.light(f.D(x, s * 12, 3), 'warm', 0.45);
    return f;
  }

  function bridges(ground, off) { // off: where they stood before the roads (?m3d-roads=off, or the roads not there: js/map3d.js)
    if (off == null) off = RD_OFF; const b = new Builder();
    const out = { frames: {} };
    out.frames.gg = goldenGate(b, ground); out.frames.bayWest = bayWest(b, ground); out.frames.bayEast = bayEast(b, ground, off);
    out.list = [out.frames.gg, out.frames.bayWest, out.frames.bayEast]; // every deck, for the soft shadows painted on the water
    if (off) { // where they stood before the roads (the real network's ends, below, came with js/map3d/roads.js)
    out.list.push(plainBridge(b, ground, [-122.4800, 37.9405], [-122.3960, 37.9345], { humps: [[0.3, 0.09, 56], [0.62, 0.09, 56]] }));  // Richmond-San Rafael
    out.list.push(plainBridge(b, ground, [-122.2560, 37.5660], [-122.1200, 37.6080], { humps: [[0.12, 0.08, 41]], pier: 420 }));         // San Mateo
    out.list.push(plainBridge(b, ground, [-122.1290, 37.4980], [-122.1100, 37.5118], { humps: [[0.5, 0.3, 26]], pier: 260 }));           // Dumbarton
    out.list.push(plainBridge(b, ground, [-122.2262, 38.0562], [-122.2285, 38.0662], { humps: [[0.5, 0.42, 46]], towers: true, pier: 500 })); // Carquinez
    out.list.push(plainBridge(b, ground, [-122.1230, 38.0335], [-122.1265, 38.0470], { humps: [[0.5, 0.3, 42]], pier: 240 }));           // Benicia-Martinez
    out.list.push(plainBridge(b, ground, [-121.7518, 38.0122], [-121.7495, 38.0345], { humps: [[0.45, 0.3, 41]], pier: 300 }));          // Antioch
    return Object.assign(out, b.finish()); }
    out.list.push(plainBridge(b, ground, [-122.4778, 37.9426], [-122.4053, 37.9324], { humps: [[0.3, 0.09, 56], [0.62, 0.09, 56]] }));  // Richmond-San Rafael
    out.list.push(plainBridge(b, ground, [-122.2632, 37.5729], [-122.1557, 37.6168], { humps: [[0.12, 0.08, 41]], pier: 420 }));         // San Mateo
    out.list.push(plainBridge(b, ground, [-122.1301, 37.4980], [-122.1084, 37.5141], { humps: [[0.5, 0.3, 26]], pier: 260 }));           // Dumbarton
    out.list.push(plainBridge(b, ground, [-122.2282, 38.0523], [-122.2267, 38.0659], { humps: [[0.5, 0.42, 46]], towers: true, pier: 500 })); // Carquinez
    out.list.push(plainBridge(b, ground, [-122.1171, 38.0326], [-122.1287, 38.0480], { humps: [[0.5, 0.3, 42]], pier: 240 }));           // Benicia-Martinez
    out.list.push(plainBridge(b, ground, [-121.7515, 38.0167], [-121.7516, 38.0427], { humps: [[0.45, 0.3, 41]], pier: 300 }));          // Antioch
    return Object.assign(out, b.finish());
  }

  // ---------- the icons (local metres: x east, z south, y up, origin on the ground) ----------
  const ICONS = {
    // Transamerica Pyramid, 260 m: a slim four-sided pyramid on a flared base, two wings on the upper floors, an aluminium spire
    pyramid(b) {
      b.frustum('stone', 0, -30, 0, 62, 62, 58, 58, 42);
      b.frustum('white', 0, 12, 0, 53, 53, 6.5, 6.5, 200, { win: [9, 34] });
      for (const s of [-1, 1]) b.frustum('white', s * 9.5, 120, 0, 10, 10, 9, 9.6, 86);
      b.frustum('metal', 0, 212, 0, 6.5, 6.5, 0.8, 0.8, 48);
      b.light([0, 262, 0], 'red', 1.4);
    },
    // Salesforce Tower, 326 m: a rounded square that tapers to a soft crown
    salesforce(b) {
      const prof = [[26, -30], [26, 150], [25.2, 215], [23.3, 268], [20.5, 305], [17.8, 326]];
      b.loft('glass', prof.map(([r, y]) => b.sq(0, y, 0, r, 20, 4.5)), { win: [36, 56] });
      b.loft('glassTop', [b.sq(0, 304, 0, 20.8, 20, 4.5), b.sq(0, 327, 0, 18, 20, 4.5)], { lit: 0.45, cap: true });
      b.light([0, 330, 0], 'cool', 2.2);
    },
    // Coit Tower, 64 m: a fluted column on a square base, an arcade under a narrower crown
    coit(b) {
      b.frustum('white', 0, -20, 0, 30, 30, 28, 28, 30);
      const flute = (y, r) => Array.from({ length: 24 }, (_, j) => { const a = j / 24 * Math.PI * 2, rr = r * (j % 2 ? 0.93 : 1); return [Math.cos(a) * rr, y, Math.sin(a) * rr]; });
      b.loft('white', [flute(10, 6.6), flute(49, 6.0)], { flat: true, cap: false });
      b.cyl('white', 0, 49, 0, 6.9, 6.9, 2.4, 14);
      b.cyl('whiteShade', 0, 51.4, 0, 5.7, 5.7, 6.4, 14, { win: [10, 1], glow: 1.2 });
      b.cyl('white', 0, 57.8, 0, 6.4, 6.2, 2, 14);
      b.cyl('white', 0, 59.8, 0, 4.7, 4.5, 4.6, 12);
    },
    // Sutro Tower, 298 m: three legs that pinch at a waist and open again, three masts banded red and white
    sutro(b) {
      const leg = (a, r, y) => [Math.cos(a) * r, y, Math.sin(a) * r], A = [0, 1, 2].map(i => Math.PI / 2 + i * Math.PI * 2 / 3);
      for (const a of A) {
        b.beam('white', leg(a, 46, -25), leg(a, 14, 150), 8, 8);
        b.beam('white', leg(a, 14, 150), leg(a, 19, 232), 6.5, 6.5);
        for (let i = 0; i < 5; i++) b.rod(i % 2 ? 'white' : 'red', leg(a, 19, 232 + i * 13.2), leg(a, 19, 232 + (i + 1) * 13.2), 2.6, 2.6, 6);
        b.light(leg(a, 19, 300), 'red', 1.2);
      }
      for (let i = 0; i < 3; i++) { const a = A[i], c = A[(i + 1) % 3]; b.beam('red', leg(a, 30, 72), leg(c, 30, 72), 3.6, 5); b.beam('white', leg(a, 16.3, 190), leg(c, 16.3, 190), 3.2, 4.5); }
      b.loft('red', [A.map(a => leg(a, 21, 143)), A.map(a => leg(a, 21, 153))], { flat: true, cap0: true });
      b.loft('red', [A.map(a => leg(a, 25, 228)), A.map(a => leg(a, 25, 236))], { flat: true, cap0: true });
    },
    // Ferry Building: the long hall with its skylight ridge and the 75 m clock tower
    ferry(b) {
      b.box('stone', 0, -20, 0, 200, 46, 37);
      b.frustum('roof', 0, 17, 0, 198, 44, 196, 14, 7);
      b.frustum('glassRoof', 0, 24, 0, 170, 10, 170, 3, 3.5);
      b.box('stone', 0, -20, -6, 16, 16, 66);
      b.box('stone', 0, 46, -6, 12.5, 12.5, 15, { win: [1, 1], glow: 0 });
      for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) b.rod('clock', [dx * 6.3, 53.5, -6 + dz * 6.3], [dx * 6.9, 53.5, -6 + dz * 6.9], 4.4, 4.4, 12, { lit: 1.6 });
      b.box('stone', 0, 61, -6, 15, 15, 1.8);
      b.box('stoneShade', 0, 62.8, -6, 9.5, 9.5, 8.5, { win: [2, 1], glow: 1.3 });
      b.frustum('roof', 0, 71.3, -6, 11, 11, 3.2, 3.2, 5);
      b.box('stone', 0, 76.3, -6, 3, 3, 3.5);
      b.rod('metal', [0, 79.8, -6], [0, 90, -6], 0.5, 0.3, 5);
    },
    // Alcatraz: the cellhouse along the crown of the island, the lighthouse in front of it, the water tower, the old workshops
    alcatraz(b) {
      b.box('white', 0, -25, 0, 150, 46, 46);
      b.box('whiteShade', 0, 21, 0, 126, 30, 6);
      b.box('white', -112, -25, -6, 42, 30, 38);
      b.box('stone', 60, -25, 62, 110, 24, 37);
      // the lighthouse
      b.cyl('white', -22, -25, 52, 6.4, 3.6, 77, 8, { flat: true });
      b.cyl('dark', -22, 52, 52, 5.2, 5.2, 1.6, 10);
      b.cyl('lamp', -22, 53.6, 52, 3.3, 3.3, 7, 10, { lit: 2.2 });
      b.cyl('dark', -22, 60.6, 52, 4.4, 0, 6, 10);
      b.light([-22, 57, 52], 'beam', 5);
      // the water tower
      for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) b.beam('rust', [118 + dx * 7, -25, -22 + dz * 7], [118 + dx * 5, 34, -22 + dz * 5], 1.8);
      b.cyl('rust', 118, 34, -22, 9, 9, 13, 10); b.cyl('rust', 118, 47, -22, 9, 0, 4, 10);
    },
    // the Painted Ladies: seven gabled houses in a row, facing the park (west)
    ladies(b) {
      const cols = ['p0', 'p1', 'p2', 'p3', 'p4', 'p5', 'p6'], w = 8.4;
      for (let i = 0; i < 7; i++) {
        const z = (i - 3) * w, y0 = (3 - i) * 0.9, m = cols[i]; // the street climbs a little to the north
        b.box(m, 0, -20, z, 15, w - 0.6, 30.5 + y0, { win: [3, 2], glow: 0.9 });
        b.loft('roof', [[[-7.9, 10.5 + y0, z - w / 2 + 0.1], [-7.9, 10.5 + y0, z + w / 2 - 0.1], [-7.9, 16.8 + y0, z]], [[7.6, 10.5 + y0, z - w / 2 + 0.1], [7.6, 10.5 + y0, z + w / 2 - 0.1], [7.6, 16.8 + y0, z]]], { flat: true, cap0: true });
        b.box('trim', -8.6, -20, z + 1.3, 2.4, 3.6, 28.6 + y0);
        b.frustum('roof', -8.6, 8.6 + y0, z + 1.3, 2.8, 4, 0.4, 2.4, 1.6);
        b.box('trim', -8.3, -20, z - 2.2, 1.6, 1.8, 22.6 + y0);
      }
    },
    // the Palace of Fine Arts: the open rotunda under its dome, the colonnade curving behind it, the lagoon in front
    palace(b) {
      const n = 8;
      for (let i = 0; i < n; i++) { const a = (i + 0.5) / n * Math.PI * 2; b.box('ochre', Math.cos(a) * 17.5, -15, Math.sin(a) * 17.5, 6.5, 6.5, 41, { ry: -a * 180 / Math.PI }); }
      b.cyl('ochre', 0, 24, 0, 21.5, 21.5, 8, 16, { cap: false }); b.cyl('ochreShade', 0, 23.5, 0, 14, 14, 0.5, 16);
      b.lathe('ochre', 0, 0, [[21.5, 32], [20, 33.5]], 16, { cap: false });
      b.lathe('dome', 0, 0, [[20, 33.5], [18.6, 39], [15, 44], [9.5, 47.6], [0, 49.5]], 16, { cap: false });
      for (let i = 0; i < 15; i++) { const a = Math.PI * (0.62 + i / 14 * 0.76), x = Math.cos(a) * 62, z = Math.sin(a) * 62 - 2; b.cyl('ochre', x, -15, z, 2.3, 2.1, 33, 6); }
      const arc = Array.from({ length: 15 }, (_, i) => { const a = Math.PI * (0.62 + i / 14 * 0.76); return [Math.cos(a) * 62, 20, Math.sin(a) * 62 - 2]; });
      b.loft('ochre', arc.map(p => [[p[0] * 0.95, 18, p[2] * 0.95 - 0.1], [p[0] * 1.05, 18, p[2] * 1.05 + 0.1], [p[0] * 1.05, 23, p[2] * 1.05 + 0.1], [p[0] * 0.95, 23, p[2] * 0.95 - 0.1]]), { flat: true, cap0: true });
      b.loft('lagoon', [b.circ(-6, 0.6, -46, 44, 18, 0, 20), b.circ(-6, 1.0, -46, 44, 18, 0, 20)], { cap: true });
    },
    // Sphere, 112 m high and 157 m wide
    sphere(b) {
      const R = 78.5, cy = 112 - R, prof = []; for (let i = 0; i <= 10; i++) { const a = lerp(-Math.asin((cy + 6) / R), Math.PI / 2, i / 10); prof.push([Math.cos(a) * R, cy + Math.sin(a) * R]); }
      b.lathe('sphere', 0, 0, prof, 24, { lit: 0.85, cap: false });
      b.cyl('dark', 0, -6, 0, 62, 62, 7, 24);
      b.light([0, cy, 0], 'sphere', 9);
    },
    // the Eiffel Tower at Paris Las Vegas, 165 m: four legs sweeping in to one shaft, two platforms
    eiffel(b) {
      const half = y => y < 35 ? lerp(31, 17, y / 35) : y < 70 ? lerp(17, 9.5, (y - 35) / 35) : lerp(9.5, 2.2, Math.pow((y - 70) / 80, 0.8));
      const ys = [-8, 12, 24, 35, 50, 62, 70];
      for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) for (let i = 0; i < ys.length - 1; i++) b.beam('bronze', [sx * half(ys[i]), ys[i], sz * half(ys[i])], [sx * half(ys[i + 1]), ys[i + 1], sz * half(ys[i + 1])], lerp(8, 5.5, i / 5), lerp(8, 5.5, i / 5));
      b.box('bronzeShade', 0, 33.5, 0, 42, 42, 4); b.box('bronzeShade', 0, 68.5, 0, 25, 25, 3.5);
      b.loft('bronze', [70, 90, 110, 130, 150].map(y => b.rect(0, y, 0, half(y) * 2 + 2.4, half(y) * 2 + 2.4)), { flat: true });
      b.box('bronzeShade', 0, 148, 0, 9, 9, 4); b.frustum('bronze', 0, 152, 0, 5, 5, 1, 1, 9); b.rod('bronze', [0, 161, 0], [0, 170, 0], 0.6, 0.3, 5);
      for (const y of [36, 71, 150]) for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) b.light([sx * (half(y) + 3), y + 3, sz * (half(y) + 3)], 'gold', 1.6);
      b.light([0, 172, 0], 'gold', 2.4);
    },
    // the High Roller, 167 m: a thin rim, cables, 28 cabins, on a braced leg each side
    highroller(b) {
      const R = 79, cy = 88, n = 36, rim = Array.from({ length: n + 1 }, (_, i) => { const a = i / n * Math.PI * 2; return [0, cy + Math.sin(a) * R, Math.cos(a) * R]; });
      b.tube('wheel', rim, 2.6, 6);
      for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2, p = [0, cy + Math.sin(a) * R, Math.cos(a) * R]; b.beam('wheelShade', [0, cy, 0], p, 0.9); }
      for (let i = 0; i < 28; i++) { const a = (i + 0.5) / 28 * Math.PI * 2, y = cy + Math.sin(a) * (R + 5), z = Math.cos(a) * (R + 5); b.lathe('cabin', 0, z, [[0, y - 3.8], [3.5, y - 2.2], [4.1, y], [3.5, y + 2.2], [0, y + 3.8]], 6, { cap: false, lit: 0.7 }); }
      b.rod('wheelShade', [-9, cy, 0], [9, cy, 0], 5, 5, 10);
      for (const s of [-1, 1]) { b.beam('wheel', [s * 9, cy, 0], [s * 34, -10, 30], 4.5); b.beam('wheel', [s * 9, cy, 0], [s * 34, -10, -30], 4.5); }
      b.beam('wheel', [0, cy, 0], [58, -10, 0], 3.6);
      for (let i = 0; i < 28; i += 1) { const a = (i + 0.5) / 28 * Math.PI * 2; b.light([0, cy + Math.sin(a) * R, Math.cos(a) * R], i % 2 ? 'pink' : 'violet', 1.5); }
    },
    // the STRAT, 350 m: three concrete legs into one shaft, the pod, the mast
    strat(b) {
      for (let i = 0; i < 3; i++) { const a = Math.PI / 2 + i * Math.PI * 2 / 3; b.beam('white', [Math.cos(a) * 24, -20, Math.sin(a) * 24], [Math.cos(a) * 6, 96, Math.sin(a) * 6], 10, 10); }
      b.cyl('white', 0, 80, 0, 9.5, 8, 150, 10);
      b.lathe('white', 0, 0, [[8, 228], [15, 236], [26, 246], [29, 254]], 16, { cap: false });
      b.lathe('glassDark', 0, 0, [[29, 254], [29.5, 262], [26, 270]], 16, { cap: false, win: [30, 2], glow: 1.4 });
      b.lathe('white', 0, 0, [[26, 270], [16, 278], [7, 283], [4, 300]], 16, {});
      b.rod('red', [0, 300, 0], [0, 350, 0], 2, 0.8, 6);
      b.light([0, 352, 0], 'red', 2); b.light([0, 262, 0], 'gold', 5);
    },
    // Luxor, 107 m: the black glass pyramid, the sphinx in front of it on the east, its head towards the Strip
    luxor(b) {
      b.frustum('luxor', 0, -20, 0, 196, 196, 183, 183, 20);
      b.frustum('luxor', 0, 0, 0, 183, 183, 1, 1, 107, { win: [22, 14], glow: 0.35 });
      b.box('sand', 130, -20, 0, 62, 30, 34); b.box('sand', 150, 14, 0, 22, 22, 22); b.frustum('sand', 152, 36, 0, 22, 24, 14, 16, 8);
      b.light([0, 109, 0], 'beam', 6);
    },
  };
  // where each icon stands: [id, lon, lat, enlargement, turn in degrees, label]. Positions are the app's (data/landmarks.js).
  const LM = Object.fromEntries((window.LANDMARKS || []).map(l => [l.id, l]));
  const at = (id, lon, lat) => LM[id] ? [LM[id].lon, LM[id].lat] : [lon, lat];
  const PLACED = [
    ['pyramid', ...at('pyramid', -122.4028, 37.7952), 2.5, 9, 'Transamerica Pyramid'],
    ['salesforce', ...at('salesforce', -122.3969, 37.7897), 2.5, 45, 'Salesforce Tower'],
    ['coit', ...at('coit', -122.4058, 37.8024), 5.2, 9, 'Coit Tower'],
    ['sutro', ...at('sutro', -122.4525, 37.7552), 2.6, 12, 'Sutro Tower'],
    ['ferry', ...at('ferry', -122.3937, 37.7955), 3.4, 62, 'Ferry Building'],
    ['alcatraz', ...at('alcatraz', -122.423, 37.8267), 1.7, 38, 'Alcatraz'],
    ['ladies', -122.4329, 37.7763, 6.5, 9, 'Painted Ladies'],
    ['palace', ...at('palace', -122.4487, 37.802), 5.5, 100, 'Palace of Fine Arts'],
    ['sphere', ...at('sphere', -115.1621, 36.1212), 2.6, 0, 'Sphere'],
    ['eiffel', ...at('eiffel', -115.1722, 36.1125), 4.2, 0, 'Eiffel Tower'],
    ['highroller', ...at('highroller', -115.1681, 36.1176), 3.8, 0, 'High Roller'],
    ['strat', ...at('strat', -115.1556, 36.1475), 2.6, 0, 'The STRAT'],
    ['luxor', ...at('luxor', -115.1761, 36.0955), 3.0, 0, 'Luxor'],
  ];
  // more landmarks, from the files loaded after this one (js/map3d/icons-*.js): each pushes { id, lon, lat, ex, ry, label, build(b),
  // mats: { name: [paper colour, night colour] } } onto window.M3D.extra; taken up once, before the icons or the skylines are made
  let adopted = false;
  function adopt() { if (adopted) return; adopted = true; (window.M3D.extra || []).forEach(e => { if (!e || ICONS[e.id] || typeof e.build !== 'function') return; ICONS[e.id] = e.build; PLACED.push([e.id, e.lon, e.lat, e.ex, e.ry || 0, e.label, !!e.flat]); }); }   // (flat: a park, not a tower: it keeps its size on the map and is named by its width)
  // ground(x, z): the ground there. near(x, z, x0, z0): the ground at (x, z) where it is the same place's top as at (x0, z0), else
  // null. A model stands on the ground at its own point; on a slope the uphill side of its base is in the hill, as a real
  // building's is, and where the ground under its plan falls away further than its base reaches down (what it has built below
  // its own ground level), it is set down until the base still meets the lowest of it
  function icons(ground, near) {
    adopt();
    return PLACED.map(([id, lon, lat, ex, ry, label, flat]) => {
      const b = new Builder(), p = proj([lon, lat]);
      b.place(0, 0, 0, ry, ex * K, () => ICONS[id](b));
      const out = b.finish(); out.geometry.computeBoundingBox(); const bb = out.geometry.boundingBox;
      let y = ground(p[0], p[1]);
      if (near) { let low = y; for (const [fx, fz] of [[bb.min.x, bb.min.z], [bb.max.x, bb.min.z], [bb.max.x, bb.max.z], [bb.min.x, bb.max.z], [bb.min.x, 0], [bb.max.x, 0], [0, bb.min.z], [0, bb.max.z]]) { const g = near(p[0] + fx * 0.8, p[1] + fz * 0.8, p[0], p[1]); if (g != null && g < low) low = g; } y = Math.min(y, low + Math.max(0, -bb.min.y) * 0.85); }
      return Object.assign(out, { id, label, x: p[0], z: p[1], y, h: bb.max.y, r: Math.max(bb.max.x, bb.max.z, -bb.min.x, -bb.min.z), flat: !!flat });
    });
  }

  // ---------- a generic skyline and the Strip's resorts ----------
  // Deliberate, not a scatter of boxes: fewer and cleaner masses in the palette's off-whites, laid out on the street grid of
  // their district, lower towards the edge of the cluster, a few with stepped tops (setbacks) and a slim crown, a faint window
  // rhythm, and every filler well below the named towers (Salesforce 326 m, Transamerica 260 m), which stand clear of them.
  function tower(b, m, x, g, z, w, dp, h, ry, R, kind) {
    const fl = 0.1 * HS, rows = k => Math.max(2, Math.round(k / fl)), cols = k => Math.max(2, Math.round(k / 0.12)), base = g - 0.5;
    if (kind === 'stepped' && h > 1.3 * HS) { // two setbacks and a slim crown
      const h1 = h * 0.58, h2 = h * 0.26, h3 = h - h1 - h2;
      b.box(m, x, base, z, w, dp, 0.5 + h1, { ry, win: [cols(w), rows(h1)], ao: [0.62, 1] });
      b.box(m, x, g + h1, z, w * 0.78, dp * 0.78, h2, { ry, win: [cols(w * 0.78), rows(h2)], ao: [0.9, 1] });
      b.frustum(m, x, g + h1 + h2, z, w * 0.56, dp * 0.56, w * 0.4, dp * 0.4, h3, { ry, win: [cols(w * 0.56), rows(h3)], ao: [0.94, 1] });
    } else if (kind === 'podium' && h > 1.0 * HS) { // a wide low base and a slimmer shaft
      const pd = 0.34 * HS; b.box('bldg1', x, base, z, w * 1.25, dp * 1.25, 0.5 + pd, { ry, win: [cols(w * 1.25), 3], ao: [0.62, 1] });
      b.box(m, x, g + pd, z, w * 0.8, dp * 0.8, h - pd, { ry, win: [cols(w * 0.8), rows(h - pd)], ao: [0.86, 1] });
      b.box('roofTop', x, g + h, z, w * 0.44, dp * 0.44, 0.06 * HS, { ry });
    } else { // a clean prism with a thin roof plate
      b.box(m, x, base, z, w, dp, 0.5 + h, { ry, win: [cols(w), rows(h)], ao: [0.62, 1] });
      if (R() < 0.6) b.box('roofTop', x, g + h, z, w * 0.5, dp * 0.42, 0.05 * HS, { ry });
    }
  }
  // placeAt(x, z): the name of the place there, or null; vegas: the Strip's sections by place (data/subareas.js), or null; lms: the
  // landmarks as icons() made them, or none. Returns one mesh per place that carries anything ({ place, geometry, ... }), so each
  // can rise with its block.
  // real: the real buildings are drawn (js/map3d/real.js): no filler towers in San Francisco or Oakland, no made-up resorts on the Strip
  function city(placeAt, ground, vegas, lms, real) {
    adopt();
    const parts = {}, of = place => parts[place] || (parts[place] = new Builder()), stand = (place, g) => { const b = of(place); b.gs = (b.gs || 0) + g; b.gn = (b.gn || 0) + 1; return b; }, placed = PLACED.map(p => proj([p[1], p[2]])), K25 = 2.5 * K * HS, foot = [];   // (K25: the fillers drawn whole at the buildings' HX, plan and height, as they were at 2.5) // foot: [x, z, radius] of everything stood here, for the city fabric to keep clear of
    // a filler (a circle of radius r at x, z) stands clear of what each landmark has built: its plan box, at its own size, grown by 1.3
    const built = (lms || []).map(l => { const b = l.geometry.boundingBox; return [l.x + b.min.x * 1.3, l.z + b.min.z * 1.3, l.x + b.max.x * 1.3, l.z + b.max.z * 1.3]; });
    const onLm = (x, z, r) => built.some(b => Math.hypot(x - Math.min(b[2], Math.max(b[0], x)), z - Math.min(b[3], Math.max(b[1], z))) < r);
    const clusters = [
      { c: [-122.3990, 37.7918], r: 6.4, n: 40, hi: 205, lo: 42, ok: ['Financial District', 'South of Market', 'Downtown/Civic Center', 'Chinatown'], seed: 7, grid: 9, soma: 45, real: true },
      { c: [-122.2712, 37.8050], r: 4.4, n: 10, hi: 95, lo: 32, ok: ['Oakland'], seed: 11, grid: 26, real: true },
      { c: [-121.8890, 37.3335], r: 4.4, n: 9, hi: 80, lo: 30, ok: ['San Jose'], seed: 19, grid: 30 },
    ];
    const mats = ['bldg0', 'bldg0', 'bldg1', 'bldg2', 'bldg3'];
    for (const cl of clusters) {
      if (real && cl.real) continue;
      const R = rng(cl.seed), c = proj(cl.c), got = []; let tries = 0;
      while (got.length < cl.n && tries++ < 5000) {
        const a = R() * Math.PI * 2, d = Math.pow(R(), 0.9) * cl.r, x = c[0] + Math.cos(a) * d, z = c[1] + Math.sin(a) * d * 0.85;
        const t = placeAt(x, z); if (!t || !cl.ok.includes(t)) continue;
        const fall = 1 - d / cl.r, h = (cl.lo + (cl.hi - cl.lo) * Math.pow(fall, 0.95) * (0.45 + 0.55 * R())) * K25;
        const w = (19 + R() * 11 + Math.min(8, h / HS * 2.5)) * K25, dp = w * (0.75 + R() * 0.35), r = Math.max(w, dp) * 0.62;
        if (got.some(g => Math.hypot(g[0] - x, g[1] - z) < g[2] + r + 0.06) || placed.some(g => Math.hypot(g[0] - x, g[1] - z) < 1.25 + r) || onLm(x, z, r)) continue;
        if ([[0.45, 0], [-0.45, 0], [0, 0.45], [0, -0.45]].some(([dx, dz]) => placeAt(x + dx, z + dz) !== t)) continue; // clear of the block's edge
        got.push([x, z, r]); foot.push([x, z, r + 0.12]);
        const ry = (cl.soma && t === 'South of Market' ? cl.soma : cl.grid), kind = h > 2.2 * HS && R() < 0.4 ? 'stepped' : h > 1.4 * HS && R() < 0.35 ? 'podium' : 'prism';
        let g = ground(x, z); for (const [p, q] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) if (placeAt(x + p * w * 0.45, z + q * dp * 0.45) === t) g = Math.min(g, ground(x + p * w * 0.45, z + q * dp * 0.45)); // on a slope it stands on the lowest ground under it (its base is half a unit deeper still)
        tower(stand(t, g), mats[Math.floor(R() * mats.length)], x, g, z, w, dp, h, ry, R, kind);
      }
    }
    // the Strip: one tower on a podium for each resort (data/subareas_vegas.json): slabs, curved pairs and stepped tops in
    // white, cream and champagne glass
    if (vegas && !real) {
      const skip = ['The STRAT', 'Luxor', 'Sphere', 'Paris', 'The LINQ', 'LINQ'];
      Object.keys(vegas).forEach(place => vegas[place].forEach(s => {
        const p = proj([s.lon, s.lat]), R = rng(hash(s.name)), w = 0.95 + R() * 0.6; // the podium is w * 1.1 by w * 0.8: a circle of 0.68 w round it
        if (skip.some(k => s.name.indexOf(k) >= 0) || placed.some(g => Math.hypot(g[0] - p[0], g[1] - p[1]) < 1.5) || onLm(p[0], p[1], w * 0.68)) return;
        foot.push([p[0], p[1], 1.25]);
        const g = ground(p[0], p[1]), b = stand(place, g), dp = 0.26 + R() * 0.08, h = (1.3 + R() * 1.7) * HS, ry = [0, 90, 28, -28, 60][Math.floor(R() * 5)], m = 'resort' + Math.floor(R() * 5);
        b.box('podium', p[0], g - 0.6, p[1], w * 1.1, w * 0.8, 0.6 + 0.16, { ry, ao: [0.7, 1] });
        const cs = Math.cos(ry * Math.PI / 180), sn = Math.sin(ry * Math.PI / 180), rows = k => Math.round(k / 0.1), win = (ww, hh) => [Math.round(ww / 0.12), rows(hh)];
        if (R() < 0.45) { for (const k of [-1, 1]) { const hh = h * (k > 0 ? 1 : 0.86); b.box(m, p[0] + cs * 0.22 * k, g + 0.16, p[1] - sn * 0.22 * k, w * 0.62, dp, hh, { ry: ry + k * 22, win: win(w * 0.62, hh), ao: [0.85, 1] }); b.box('roofTop', p[0] + cs * 0.22 * k, g + 0.16 + hh, p[1] - sn * 0.22 * k, w * 0.5, dp * 0.6, 0.05, { ry: ry + k * 22 }); } }
        else { const h1 = h * 0.82; b.box(m, p[0], g + 0.16, p[1], w, dp, h1, { ry, win: win(w, h1), ao: [0.85, 1] }); b.box(m, p[0], g + 0.16 + h1, p[1], w * 0.62, dp * 0.8, h - h1, { ry, win: win(w * 0.62, h - h1), ao: [0.95, 1] }); }
      }));
    }
    const blvd = [[-115.15383, 36.1505], [-115.15497, 36.1475], [-115.15682, 36.1445], [-115.15878, 36.1415], [-115.16075, 36.1385], [-115.16271, 36.1355], [-115.16467, 36.1325], [-115.16664, 36.1295], [-115.16862, 36.1265], [-115.1705, 36.1235], [-115.17193, 36.1205], [-115.17265, 36.1175], [-115.17287, 36.1145], [-115.17294, 36.1115], [-115.17298, 36.1085], [-115.17297, 36.1055], [-115.17296, 36.1025], [-115.17293, 36.0995], [-115.17291, 36.0965], [-115.17289, 36.0935], [-115.17287, 36.0905], [-115.17285, 36.0875], [-115.17281, 36.0845], [-115.17275, 36.0815], [-115.17273, 36.0795]].map(proj); // js/map.js ROADS
    const strip = blvd.map((p, i) => { const a = blvd[Math.max(0, i - 1)], c = blvd[Math.min(blvd.length - 1, i + 1)], d = [c[0] - a[0], c[1] - a[1]], l = Math.hypot(d[0], d[1]), n = [-d[1] / l * 0.14, d[0] / l * 0.14], y = ground(p[0], p[1]); return [[p[0] - n[0], y - 0.05, p[1] - n[1]], [p[0] + n[0], y - 0.05, p[1] + n[1]], [p[0] + n[0], y + 0.035, p[1] + n[1]], [p[0] - n[0], y + 0.035, p[1] - n[1]]]; });
    // the boulevard, cut where it passes from one place to the next
    const on = blvd.map(p => placeAt(p[0], p[1]) || ''); let i0 = 0;
    for (let i = 1; i <= blvd.length; i++) if (i === blvd.length || on[i] !== on[i0]) { const run = strip.slice(i0, Math.min(blvd.length, i + 1)); if (run.length > 1) of(on[i0]).loft('boulevard', run, { flat: true, cap0: true }); i0 = i; }
    blvd.forEach((p, i) => of(on[i]).light([p[0], ground(p[0], p[1]) + 0.12, p[1]], 'gold', 1.1));
    blvd.forEach((p, i) => { if (i) for (let t = 0; t < 1; t += 0.2) foot.push([blvd[i - 1][0] + (p[0] - blvd[i - 1][0]) * t, blvd[i - 1][1] + (p[1] - blvd[i - 1][1]) * t, 0.3]); });
    const out = Object.keys(parts).map(place => Object.assign(parts[place].finish(), { place, g0: parts[place].gn ? parts[place].gs / parts[place].gn : null })); out.foot = foot; out.strip = blvd; return out; // g0: the ground its towers stand on, about (its heights stretch from there)
  }

  // ---------- the flag and the bookmark (unit size: about one unit tall; scaled on the map to hold their size on screen) ----------
  function flag() {
    const b = new Builder();
    b.cyl('pole', 0, -0.05, 0, 0.022, 0.016, 1.1, 6); b.lathe('pole', 0, 0, [[0, 1.02], [0.035, 1.05], [0, 1.085]], 6, { cap: false });
    b.cyl('poleBase', 0, -0.02, 0, 0.09, 0.06, 0.05, 10);
    // a pennant with a soft wave, two faces
    const n = 7, rows = []; for (let i = 0; i <= n; i++) { const t = i / n, x = 0.02 + t * 0.56, wz = Math.sin(t * Math.PI * 1.7) * 0.035 * t, half = 0.17 * (1 - t * 0.9); rows.push([[x, 0.84 - half, wz - 0.006], [x, 0.84 + half, wz - 0.006], [x, 0.84 + half, wz + 0.006], [x, 0.84 - half, wz + 0.006]]); }
    b.loft('flag', rows, { flat: true, cap0: true });
    return b.finish();
  }
  // want to go: a bookmark, the ribbon with its notch, on a short pole (the app's flat mark, stood up)
  function bookmark() {
    const b = new Builder();
    b.cyl('pole', 0, -0.05, 0, 0.02, 0.016, 0.5, 6); b.cyl('poleBase', 0, -0.02, 0, 0.08, 0.055, 0.045, 10);
    const w = 0.2, y0 = 0.42, y1 = 1.02, t = 0.022, half = (x0, x1, yn0, yn1) => b.loft('ribbon', [[[x0, yn0, -t], [x0, y1, -t], [x0, y1, t], [x0, yn0, t]], [[x1, yn1, -t], [x1, y1, -t], [x1, y1, t], [x1, yn1, t]]], { flat: true, cap0: true });
    half(-w, 0, y0, y0 + 0.17); half(0, w, y0 + 0.17, y0);
    return b.finish();
  }

  window.M3D.models = { Builder, bridges, icons, city, flag, bookmark, PLACED };
})();
