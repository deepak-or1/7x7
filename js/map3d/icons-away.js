// More 3D landmarks for the 3D map (beta): the rest of the Bay and Las Vegas. Each entry is pushed onto window.M3D.extra and taken up by js/map3d/models.js.
(() => {
  const X = window.M3D.extra = window.M3D.extra || [];
  const D = Math.PI / 180, CELL = 1 / 8;
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const MATS = { // new colours: [paper, night]
    awGold: ['#d8b56c', '#8d7443'], awEmerald: ['#86b49c', '#3f6a58'], awPatina: ['#93b9a8', '#4c6b62'], awBrick: ['#bf7d62', '#71493c'],
    awPink: ['#e6a9b2', '#8e5f68'], awBlue: ['#86a6c8', '#465f7c'], awBlueGlass: ['#a3bfd2', '#3e5a72'], awRedGlass: ['#c47a6c', '#74443c'],
    awCopper: ['#c29a6c', '#7a5e40'], awGreen: ['#b4cc98', '#4a6340'], awTree: ['#7d9f72', '#33503a'], awWood: ['#8c6a50', '#45352a'],
    awSpray: ['#f2f8fa', '#d6ecff'], awLed: ['#cdb0dc', '#c896ff'], awNeon: ['#efae88', '#ff9a6a'], awPeach: ['#efdcc2', '#7e705e'],
    awVeer: ['#e3d39a', '#7c7148'], awCream: ['#f0e3c2', '#7d735c'], awRoofRed: ['#ad6653', '#5c372e'], awArena: ['#bba283', '#6b5a47'],
    awTrunk: ['#a3907a', '#51473c'], awSeat: ['#7f9e86', '#3a5444'],
  };
  // add(entry, build): the entry's build gets the builder and the entry (for at() below)
  function add(e, build) { e.mats = MATS; e.build = b => build(b, e); X.push(e); }
  // the local metres (x east, z south) of a real position, from an entry's own origin: a part placed there stands where it really is
  function at(e, lon, lat) { const a = Geom.proj([e.lon, e.lat]), p = Geom.proj([lon, lat]); return [(p[0] - a[0]) * Geom.UNIT_M / e.ex, (p[1] - a[1]) * Geom.UNIT_M / e.ex]; }
  // a flat face of 3 or 4 local points; its normal points towards `look`
  function face(b, mat, pts, look, o = {}) {
    const m = b.id(mat), P = pts.map(p => b.X(p)), L = b.X(look), c = P.reduce((s, p) => [s[0] + p[0] / P.length, s[1] + p[1] / P.length, s[2] + p[2] / P.length], [0, 0, 0]);
    let N = cross(sub(P[1], P[0]), sub(P[2], P[0])); if (dot(N, sub(L, c)) < 0) { P.reverse(); N = [-N[0], -N[1], -N[2]]; } N = norm(N);
    const u = o.lit ? [CELL / 2, CELL / 2] : [0, 0], g = o.lit ? -o.lit : 0;
    for (let i = 1; i < P.length - 1; i++) b.tri(m, P[0], P[i], P[i + 1], N, N, N, u, u, u, g);
  }
  const win = (w, h) => [Math.max(2, Math.round(w / 5)), Math.max(2, Math.round(h / 6))];
  // a rounded rectangle in plan (superellipse), radii rx, rz
  const rrect = (x, y, z, rx, rz, n, e = 4) => Array.from({ length: n }, (_, j) => { const a = j / n * Math.PI * 2 + Math.PI / n, c = Math.cos(a), s = Math.sin(a), k = Math.pow(Math.pow(Math.abs(c), e) + Math.pow(Math.abs(s), e), -1 / e); return [x + c * k * rx, y, z + s * k * rz]; });
  // a curved slab in n straight pieces: centre of the curve (cx, cz), radius R, depth d, from angle a0 to a1 (degrees, 0 = east,
  // 90 = south), each piece from y0 to hOf(i); o.roof: a low hipped cap in that material
  function arc(b, mat, cx, cz, R, d, a0, a1, n, y0, hOf, o = {}) {
    const P = (r, t, y) => [cx + Math.cos(t) * r, y, cz + Math.sin(t) * r], seg = 2 * R * Math.sin(Math.abs(a1 - a0) * D / n / 2);
    for (let i = 0; i < n; i++) {
      const t0 = (a0 + (a1 - a0) * i / n) * D, t1 = (a0 + (a1 - a0) * (i + 1) / n) * D, h = hOf(i);
      const ring = (y, k) => { const rm = R, tm = (t0 + t1) / 2, q = (r, t) => { const p = P(r, t, y), c = P(rm, tm, y); return [c[0] + (p[0] - c[0]) * k, y, c[2] + (p[2] - c[2]) * k]; }; return [q(R - d / 2, t0), q(R + d / 2, t0), q(R + d / 2, t1), q(R - d / 2, t1)]; };
      b.loft(mat, [ring(y0, 1), ring(h, 1)], { flat: true, win: o.win === false ? undefined : [Math.max(2, Math.round(seg / 5)), Math.max(2, Math.round((h - y0) / 6))] });
      if (o.roof) b.loft(o.roof, [ring(h, 1.0), ring(h + o.rh, 0.62)], { flat: true });
    }
  }
  // a wing from the centre outwards along angle a (degrees, 0 = east, 90 = south), from radius r0 to r1, w wide, from y0 to y1
  function wing(b, mat, a, r0, r1, w, y0, y1, o = {}) { const c = Math.cos(a * D), s = Math.sin(a * D), r = (r0 + r1) / 2; b.box(mat, (o.x || 0) + c * r, y0, (o.z || 0) + s * r, r1 - r0, w, y1 - y0, Object.assign({ ry: -a }, o.win === false ? {} : { win: win(r1 - r0, y1 - y0) })); }
  // a gabled roof over sx by sz, the ridge along local x, turned ry degrees
  function gable(b, mat, x, y, z, sx, sz, h, ry = 0) {
    const c = Math.cos(ry * D), s = Math.sin(ry * D), R = (px, pz) => [x + px * c + pz * s, z - px * s + pz * c];
    const tri = px => { const [ax, az] = R(px, -sz / 2), [bx, bz] = R(px, sz / 2), [mx, mz] = R(px, 0); return [[ax, y, az], [bx, y, bz], [mx, y + h, mz]]; };
    b.loft(mat, [tri(-sx / 2), tri(sx / 2)], { flat: true, cap0: true });
  }
  // a palm: a leaning trunk and six fronds
  function palm(b, x, z, h, y0 = -3) {
    const tx = x + h * 0.04; b.rod('awTrunk', [x, y0, z], [tx, h, z], h * 0.035, h * 0.022, 5);
    for (let k = 0; k < 6; k++) { const a = k * 60 * D + 0.3; b.beam('awTree', [tx, h, z], [tx + Math.cos(a) * h * 0.34, h - h * 0.15, z + Math.sin(a) * h * 0.34], h * 0.09, h * 0.02); }
  }
  const jet = (b, x, z, h, r = 2.4) => b.cyl('awSpray', x, -1, z, r, r * 0.2, h + 1, 5, { lit: 0.9 });
  const pond = (b, mat, x, z, rx, rz, n = 16, top = 1.2) => b.loft(mat, [b.circ(x, -1.5, z, rx, n, 0, rz), b.circ(x, top, z, rx, n, 0, rz)]);

  // ================= Las Vegas =================
  // the Welcome to Fabulous Las Vegas sign, 7.6 m: the white diamond on two posts, its gold rim, the red star, on the median with palms
  add({ id: 'welcome', lon: -115.1728, lat: 36.082, ex: 12, ry: 0, label: 'Welcome to Fabulous Las Vegas sign' }, b => {
    b.box('stone', 0, -3, 0, 20, 6.5, 3.25);
    for (const s of [-1, 1]) b.box('white', s * 1.15, -3, 0, 0.42, 0.42, 6.3);
    const hex = (k, z) => [[-3.8, 0], [-1.4, 2.0], [1.4, 2.0], [3.8, 0], [1.4, -2.0], [-1.4, -2.0]].map(([px, py]) => [px * k, 4.8 + py * k, z]);
    b.loft('awGold', [hex(1.09, -0.12), hex(1.09, 0.12)], { flat: true, cap0: true, lit: 0.5 });
    b.loft('white', [hex(1, -0.22), hex(1, 0.22)], { flat: true, cap0: true });
    b.box('red', 0, 5.5, 0, 3.4, 0.5, 0.5); b.box('awBlue', 0, 4.75, 0, 2.3, 0.5, 0.36); b.box('red', 0, 3.75, 0, 4.4, 0.5, 0.62);
    const star = z => Array.from({ length: 16 }, (_, j) => { const a = -Math.PI / 2 + j * Math.PI / 8, r = j % 2 ? 0.42 : 0.95; return [Math.cos(a) * r, 7.55 + Math.sin(a) * r, z]; });
    b.loft('red', [star(-0.1), star(0.1)], { flat: true, cap0: true });
    palm(b, -7.4, 0.6, 10); palm(b, 7.6, -0.4, 9);
    b.light([0, 4.8, 1.4], 'gold', 2.2); b.light([0, 4.8, -1.4], 'gold', 2.2); b.light([0, 7.6, 0.3], 'red', 1.2);
  });

  // Bellagio, 155 m: the curved cream tower stepping down at its ends under tiled roofs, the lake in front with its fountains
  add({ id: 'bellagio', lon: -115.1765, lat: 36.1127, ex: 2.2, ry: 0, label: 'Bellagio' }, b => {
    b.box('awPeach', -34, -20, 0, 64, 176, 36);
    const H = [78, 104, 128, 155, 155, 128, 104, 78];
    arc(b, 'awPeach', 112, 0, 112, 22, 132, 228, 8, -20, i => H[i], { roof: 'dome', rh: 4.5 });
    pond(b, 'lagoon', 64, 0, 34, 92, 20);
    for (let i = 0; i <= 12; i++) { const t = i / 12, z = -74 + t * 148, x = 56 + Math.cos((t - 0.5) * 2.4) * 14; jet(b, x, z, 26 + 36 * Math.pow(Math.sin(Math.PI * t), 2)); }
    jet(b, 74, -10, 70, 3); jet(b, 74, 10, 70, 3);
    b.light([62, 40, 0], 'cool', 2); b.light([62, 30, -50], 'cool', 1.5); b.light([62, 30, 50], 'cool', 1.5);
  });

  // Caesars Palace, 120 m: white towers with classical crowns, the forecourt of fountains between a colonnade and rows of cypress
  add({ id: 'caesars', lon: -115.1745, lat: 36.1162, ex: 2.2, ry: 0, label: 'Caesars Palace' }, b => {
    const tw = (x, z, sx, sz, h) => { b.box('white', x, -20, z, sx, sz, h + 20, { win: win(Math.max(sx, sz), h) }); b.box('white', x, h, z, sx + 3, sz + 3, 3); b.box('white', x, h + 3, z, sx * 0.7, sz * 0.7, 7); b.light([x, h + 12, z], 'warm', 1.2); };
    tw(-62, -56, 84, 28, 118); tw(-104, 10, 28, 100, 106); tw(-150, 58, 74, 26, 100);
    b.box('white', -32, -20, 6, 30, 96, 36, { win: [3, 2], glow: 0.7 });
    for (let i = 0; i < 9; i++) b.cyl('white', -15, -20, -40 + i * 10, 1.5, 1.5, 34, 6);
    b.box('white', -15, 14, 6, 4, 86, 3); gable(b, 'white', -15, 17, 6, 4, 40, 6, 90);
    pond(b, 'lagoon', 30, 0, 17, 17, 14); jet(b, 30, 0, 16, 2.6); for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) jet(b, 30 + dx * 9, dz * 9, 8, 1.6);
    for (let i = 0; i < 9; i++) { const a = (112 + i * 17) * D; b.cyl('white', 30 + Math.cos(a) * 34, -20, Math.sin(a) * 34, 1.7, 1.5, 34, 6); }
    const ring = Array.from({ length: 9 }, (_, i) => { const a = (112 + i * 17) * D; return [30 + Math.cos(a) * 34, Math.sin(a) * 34]; });
    b.loft('white', ring.map(([x, z]) => { const k = 1 / 34, nx = (x - 30) * k, nz = z * k; return [[x - nx * 2, 14, z - nz * 2], [x + nx * 2, 14, z + nz * 2], [x + nx * 2, 17.5, z + nz * 2], [x - nx * 2, 17.5, z - nz * 2]]; }), { flat: true, cap0: true });
    for (const s of [-1, 1]) for (let i = 0; i < 5; i++) b.cyl('awTree', 8 + i * 13, -2, s * 27, 2.8, 0.2, 18, 6);
    b.light([30, 18, 0], 'cool', 1.6); b.light([-120, 124, -50], 'warm', 1.4); b.light([-78, 116, 42], 'warm', 1.4);
  });

  // New York-New York, 160 m: a crowd of little Manhattan towers, the Empire State and the Chrysler tallest, the Statue of Liberty and a coaster
  add({ id: 'nyny', lon: -115.1745, lat: 36.1022, ex: 2.2, ry: 0, label: 'New York-New York' }, b => {
    b.box('awBrick', 2, -20, 0, 34, 104, 34, { win: [12, 3], glow: 0.8 });
    // the Empire State Building
    b.box('sand', -36, -20, 0, 30, 30, 90, { win: win(30, 90) }); b.box('sand', -36, 70, 0, 24, 24, 42, { win: win(24, 42) }); b.box('sand', -36, 112, 0, 17, 17, 20, { win: win(17, 20) });
    b.frustum('sand', -36, 132, 0, 11, 11, 7, 7, 10); b.cyl('metal', -36, 142, 0, 2.2, 0.4, 24, 6); b.light([-36, 167, 0], 'red', 1.3);
    // the Chrysler Building: a silver crown of stacked arches and a needle
    b.box('stone', -6, -20, 30, 18, 18, 120, { win: win(18, 120) });
    [[100, 17, 13, 9], [109, 13, 9, 7], [116, 9, 5, 6]].forEach(([y, a, c, h]) => b.frustum('metal', -6, y, 30, a, a, c, c, h, { win: [3, 1], glow: 1.5 }));
    b.cyl('metal', -6, 122, 30, 1.6, 0.2, 20, 5);
    b.box('glassDark', -66, -20, -30, 22, 28, 125, { win: win(28, 125) });
    b.box('stoneShade', -64, -20, 30, 22, 22, 115, { win: win(22, 115) }); b.frustum('awGold', -64, 95, 30, 22, 22, 1, 1, 16);
    b.box('white', -26, -20, -38, 20, 20, 100, { win: win(20, 100) }); b.box('white', -26, 80, -38, 13, 13, 12);
    b.box('awBrick', -84, -20, 0, 20, 30, 90, { win: win(30, 90) });
    b.box('stone', -46, -20, 38, 18, 18, 80, { win: win(18, 80) });
    // the Statue of Liberty, facing the Strip
    b.place(44, 0, 8, 0, 1.45, () => {
      b.frustum('stone', 0, -14, 0, 11, 11, 8, 8, 28);
      b.lathe('awPatina', 0, 0, [[3.4, 14], [3.2, 22], [2.7, 29], [2.0, 33], [1.3, 35]], 8, { cap: false });
      b.lathe('awPatina', 0, 0, [[0, 35], [1.3, 35.8], [1.5, 37.6], [1.0, 39.4], [0, 40]], 8, { cap: false });
      b.rod('awPatina', [0.2, 33.4, 1.7], [0.5, 41.5, 2.2], 0.6, 0.5, 5);
      b.cyl('awGold', 0.5, 41.5, 2.2, 0.8, 1.3, 2.2, 6, { lit: 1.2 }); b.light([0.5, 44.5, 2.2], 'gold', 1.4);
    });
    // the Big Apple Coaster round the towers
    const pts = Array.from({ length: 29 }, (_, i) => { const t = i / 28 * Math.PI * 2; return [-32 + Math.cos(t) * 66, 34 + 18 * Math.sin(t * 3) + 6 * Math.cos(t), Math.sin(t) * 60]; });
    b.tube('red', pts, 1.6, 4);
    for (let i = 0; i < 28; i += 4) b.beam('metal', [pts[i][0], -10, pts[i][2]], pts[i], 1.2);
  });

  // Excalibur, 80 m: white towers with red roofs behind a fairy-tale castle of round turrets capped red, blue and gold
  add({ id: 'excalibur', lon: -115.1754, lat: 36.0993, ex: 2.2, ry: 0, label: 'Excalibur' }, b => {
    for (const [cz, a] of [[-26, -32], [20, 32]]) {
      const cx = -95; b.box('white', cx, -20, cz, 92, 20, 100, { ry: -a, win: win(92, 80) }); b.frustum('red', cx, 80, cz, 92, 20, 70, 2, 9, { ry: -a });
      for (const s of [-1, 1]) { const ex = cx + Math.cos(a * D) * 46 * s, ez = cz + Math.sin(a * D) * 46 * s; b.box('white', ex, -20, ez, 13, 13, 108, { ry: -a }); b.frustum('red', ex, 88, ez, 14, 14, 0.5, 0.5, 14, { ry: -a }); }
    }
    b.box('white', 40, -20, 0, 62, 70, 44);
    [[12, -32, 7, 38, 'red'], [12, 32, 7, 38, 'awBlue'], [68, -30, 6, 32, 'awBlue'], [68, 30, 6, 32, 'red'], [40, -40, 5, 30, 'awGold'], [40, 40, 5, 30, 'awGold'],
      [30, -10, 8, 54, 'red'], [32, 13, 6.5, 47, 'awBlue'], [54, 0, 6.5, 43, 'awGold'], [86, -12, 4.5, 27, 'red'], [86, 12, 4.5, 27, 'awBlue']].forEach(([x, z, r, h, m]) => {
      b.cyl('white', x, -20, z, r, r, h + 20, 8); b.cyl(m, x, h, z, r * 1.25, 0, r * 2.4, 8); b.light([x, h + r * 2.4 + 1, z], 'gold', 0.9);
    });
  });

  // MGM Grand, 89 m: the emerald-green tower of four wings, and the golden lion on its pedestal at the corner
  add({ id: 'mgm', lon: -115.1695, lat: 36.1024, ex: 2.0, ry: 0, label: 'MGM Grand' }, (b, e) => {
    b.box('stone', 0, -20, 0, 60, 60, 34, { ry: 15 });
    b.box('awEmerald', 0, -20, 0, 28, 28, 119, { ry: 15, win: win(28, 119) }); b.box('awEmerald', 0, 99, 0, 18, 18, 6, { ry: 15 });
    for (let k = 0; k < 4; k++) { const a = -15 + k * 90; wing(b, 'awEmerald', a, 12, 60, 22, -20, 89); wing(b, 'awEmerald', a, 60, 76, 22, -20, 68); }
    const [lx, lz] = at(e, -115.1712, 36.1027);
    b.place(lx, 0, lz, 135, 2.2, () => {
      b.box('stone', 0, -20, 0, 18, 11, 27.6);
      b.box('awGold', -2, 7.6, 0, 12, 6, 6); b.frustum('awGold', -6, 7.6, 0, 5, 6.4, 4, 5, 7.5); b.frustum('awGold', 3.5, 7.6, 0, 4, 5, 3, 4.4, 9);
      b.lathe('awGold', 4.5, 0, [[0, 12.8], [4, 13.8], [4.6, 16.4], [4, 19.4], [2.5, 21], [0, 21.6]], 8, { cap: false }); b.box('awGold', 7.6, 14.6, 0, 3.4, 3, 2.8);
      b.light([5, 24, 0], 'gold', 1.4);
    });
  });

  // the Venetian and the Palazzo, 145 and 196 m: cream towers under red roofs, and on the Strip the brick campanile, the Doge's Palace and the Rialto
  add({ id: 'venetian', lon: -115.169, lat: 36.1222, ex: 2.2, ry: 0, label: 'The Venetian' }, b => {
    b.box('stone', 0, -20, 10, 90, 120, 36);
    b.box('stone', 10, -20, 10, 26, 26, 168, { win: win(26, 168) }); b.frustum('dome', 10, 148, 10, 27, 27, 6, 6, 9);
    for (const a of [-90, 30, 150]) { wing(b, 'stone', a, 12, 62, 21, -20, 140, { x: 10, z: 10 }); const c = Math.cos(a * D), s = Math.sin(a * D); b.frustum('dome', 10 + c * 37, 140, 10 + s * 37, 50, 22, 40, 3, 7, { ry: -a }); }
    b.box('awCream', 30, -20, -92, 70, 24, 205, { win: win(70, 205) }); b.box('awCream', 30, 185, -92, 54, 18, 7); b.frustum('dome', 30, 192, -92, 54, 18, 40, 4, 5);
    b.place(-62, 0, 0, 0, 1.3, () => {
      pond(b, 'lagoon', -18, 0, 6, 55, 8);
      b.box('white', 4, -20, 32, 21, 64, 28); b.box('awPink', 4, -20, 32, 20, 63, 40, { win: [10, 2], glow: 0.7 }); b.box('stoneShade', 4, 20, 32, 18, 61, 1.4);
      // the Rialto Bridge over the canal
      b.loft('white', [-14, -7, 0, 7, 14].map(x => { const y = 3 + 7 * (1 - Math.pow(x / 14, 2)); return [[-18 + x, -2, -53], [-18 + x, -2, -39], [-18 + x, y, -39], [-18 + x, y, -53]]; }), { flat: true, cap0: true });
      b.box('white', -18, 9, -46, 10, 7, 5); gable(b, 'dome', -18, 14, -46, 11, 8, 3.5, 90);
      // the campanile
      b.box('awBrick', 0, -20, -16, 11, 11, 75); b.box('whiteShade', 0, 55, -16, 11.5, 11.5, 9, { win: [3, 1], glow: 1.3 }); b.box('white', 0, 64, -16, 12.6, 12.6, 2); b.box('white', 0, 66, -16, 10, 10, 7);
      b.frustum('awPatina', 0, 73, -16, 10, 10, 0.6, 0.6, 20); b.rod('awGold', [0, 93, -16], [0, 97.5, -16], 0.7, 0.3, 5); b.light([0, 60, -16], 'warm', 1.2);
    });
  });

  // Wynn and Encore, 187 and 192 m: two bronze glass slabs, each a gentle curve, with the green mountain of the Lake of Dreams in front
  add({ id: 'wynn', lon: -115.1655, lat: 36.1272, ex: 2.2, ry: 0, label: 'Wynn and Encore' }, (b, e) => {
    const [ex, ez] = at(e, -115.1638, 36.1287);
    b.box('stone', 15, -20, 0, 90, 90, 32, { ry: 15 }); b.box('stone', ex + 10, -20, ez, 70, 70, 30, { ry: 15 });
    const slab = (x, z, H) => b.place(x, 0, z, 15, 1, () => arc(b, 'awCopper', -150, 0, 150, 22, -22, 22, 8, -20, i => H - (i === 0 || i === 7 ? 9 : 0)));
    slab(0, 0, 187); slab(ex, ez, 192);
    b.lathe('awTree', -62, 34, [[34, -2], [27, 10], [14, 24], [3, 30], [0, 30.5]], 9);
    pond(b, 'lagoon', -40, 6, 22, 30, 12);
    b.light([0, 190, 0], 'warm', 1.4); b.light([ex, 195, ez], 'warm', 1.4);
  });

  // Mandalay Bay, 147 m: the gold glass tower of three wings stepping down outwards, the beach and wave pool beside it
  add({ id: 'mandalay', lon: -115.1768, lat: 36.0904, ex: 2.0, ry: 0, label: 'Mandalay Bay' }, b => {
    b.box('stone', 10, -20, 10, 90, 90, 34);
    b.cyl('awGold', 0, -20, 0, 17, 17, 177, 6, { win: [18, 26] }); b.cyl('awGold', 0, 157, 0, 11, 6, 9, 6);
    for (const a of [20, 140, 255]) { wing(b, 'awGold', a, 6, 42, 22, -20, 147); wing(b, 'awGold', a, 42, 62, 22, -20, 128); wing(b, 'awGold', a, 62, 80, 22, -20, 106); }
    b.loft('sand', [b.circ(-78, -1.5, -8, 38, 14, 0, 30), b.circ(-78, 0.8, -8, 38, 14, 0, 30)]); pond(b, 'lagoon', -82, -8, 25, 19, 14, 1.3);
    b.light([0, 168, 0], 'gold', 1.6);
  });

  // Aria, 183 m: two curved slabs of silver-blue glass set against each other
  add({ id: 'aria', lon: -115.1766, lat: 36.1073, ex: 2.2, ry: 0, label: 'Aria' }, b => {
    b.box('stone', -6, -20, 10, 96, 120, 32);
    arc(b, 'glass', 104, 10, 104, 24, 152, 208, 6, -20, i => [168, 177, 183, 183, 177, 168][i]);
    arc(b, 'glass', -118, -36, 104, 22, -28, 28, 6, -20, i => [150, 157, 161, 161, 157, 150][i]);
    b.light([0, 186, 10], 'cool', 1.4);
  });

  // the Veer Towers, 146 m: a pair of yellow-patterned glass towers leaning five degrees away from each other
  add({ id: 'veer', lon: -115.1737, lat: 36.1081, ex: 2.2, ry: 0, label: 'Veer Towers' }, b => {
    for (const s of [-1, 1]) { const cx = s < 0 ? -18 : 22, cz = s < 0 ? -12 : 22, l = 14; b.loft('awVeer', [b.rect(cx, -20, cz, 28, 28), b.rect(cx + s * l, 146, cz + s * l, 28, 28)], { flat: true, win: [6, 25] }); b.loft('white', [b.rect(cx + s * l, 145, cz + s * l, 29.5, 29.5), b.rect(cx + s * l * 1.02, 150, cz + s * l * 1.02, 29.5, 29.5)], { flat: true }); b.light([cx + s * l, 148, cz + s * l], 'red', 1); }
  });

  // the Cosmopolitan, 184 m: two slim dark glass towers side by side with angled tops, and its tall LED marquee on the Strip
  add({ id: 'cosmo', lon: -115.1740, lat: 36.1098, ex: 2.2, ry: 0, label: 'The Cosmopolitan' }, b => {
    b.box('stone', 0, -20, 0, 70, 84, 34);
    const hx = (x, y, z, k) => [[-28, 0], [-19, -12], [19, -12], [28, 0], [19, 12], [-19, 12]].map(([px, pz]) => [x + px * k, y, z + pz * k]);
    for (const z of [-25, 25]) { b.loft('glassDark', [hx(-4, -20, z, 1), hx(-4, 178, z, 1)], { flat: true, win: [4, 33] }); b.loft('glassTop', [hx(-4, 178, z, 1), hx(-9, 194, z, 0.62)], { flat: true, lit: 0.35 }); }
    b.box('awLed', 34, -20, 34, 5, 17, 78, { lit: 0.9 }); b.light([34, 50, 34], 'violet', 1.6);
  });

  // Paris Las Vegas, 105 m: the cream hotel under blue-grey mansard roofs, the Arc de Triomphe on the Strip and the balloon
  add({ id: 'paris', lon: -115.1691, lat: 36.1116, ex: 2.2, ry: 0, label: 'Paris Las Vegas' }, (b, e) => {
    b.box('awCream', 0, -20, 0, 24, 100, 125, { win: win(100, 105) }); b.frustum('roof', 0, 105, 0, 24, 100, 12, 86, 11);
    b.frustum('roof', 0, 105, 0, 30, 28, 12, 12, 17);
    b.box('awCream', -32, -20, 8, 48, 22, 110, { win: win(48, 90) }); b.frustum('roof', -32, 90, 8, 48, 22, 38, 9, 9);
    b.box('stone', -10, -20, 6, 64, 116, 34);
    const [ax, az] = at(e, -115.1720, 36.1145);
    b.place(ax, 0, az, 0, 1.3, () => { b.box('stone', 0, -20, -10.5, 15, 9, 42); b.box('stone', 0, -20, 10.5, 15, 9, 42); b.box('stone', 0, 22, 0, 15, 30, 11); b.box('stoneShade', 0, 33, 0, 15.6, 30.6, 1.2); });
    const [bx, bz] = at(e, -115.1702, 36.1104);
    b.place(bx, 0, bz, 0, 1.6, () => {
      b.box('stone', 0, -20, 0, 10, 10, 31); b.frustum('awGold', 0, 11, 0, 4, 4, 2.4, 2.4, 5);
      b.lathe('awBlue', 0, 0, [[0, 15], [3, 16], [7, 19], [10.5, 25], [12, 31.5], [11, 37], [8, 42], [4, 44.6], [0, 45.4]], 12, { cap: false, lit: 0.35 });
      b.lathe('awGold', 0, 0, [[12.15, 29.6], [12.15, 33.2]], 12, { cap: false, lit: 0.6 }); b.light([0, 32, 0], 'gold', 1.6);
    });
  });

  // Planet Hollywood, 135 m: the dark glass tower with its lit sign on top, and the LED front of the Miracle Mile on the Strip
  add({ id: 'planethw', lon: -115.1714, lat: 36.1100, ex: 2.2, ry: 0, label: 'Planet Hollywood' }, b => {
    b.box('stone', -8, -20, 38, 54, 100, 40);
    b.loft('glassDark', [[[6, -20, 0], [30, -20, 6], [30, -20, 78], [6, -20, 84], [0, -20, 42]], [[6, 135, 0], [30, 135, 6], [30, 135, 78], [6, 135, 84], [0, 135, 42]]], { flat: true, win: [6, 22] });
    for (const z of [3, 81]) b.box('white', 18, -20, z, 26, 4, 160);
    b.box('awLed', 16, 135, 42, 12, 44, 14, { lit: 0.9 });
    b.box('awLed', -36, 2, 38, 2.4, 80, 14, { lit: 0.9 }); b.light([-38, 12, 38], 'pink', 1.6); b.light([18, 146, 42], 'violet', 1.4);
  });

  // the Flamingo, 92 m: the pink tower and its white partner, and the neon plume of pink and orange feathers at the front
  add({ id: 'flamingo', lon: -115.1712, lat: 36.1160, ex: 2.0, ry: 0, label: 'Flamingo' }, b => {
    b.box('stone', -12, -20, -6, 44, 92, 34);
    b.box('awPink', 10, -20, -16, 22, 108, 112, { win: win(108, 92) }); b.box('awPink', 10, 92, -16, 15, 60, 6);
    b.box('white', 40, -20, -8, 18, 64, 90, { win: win(64, 70) });
    b.cyl('awNeon', -36, -20, 22, 6, 6, 32, 10, { lit: 1 });
    b.lathe('awNeon', -36, 22, [[6, 12], [11, 15], [16, 22], [16.5, 26], [10, 29]], 12, { lit: 1.1, cap: false });
    b.light([-36, 30, 22], 'pink', 1.8);
  });

  // Fontainebleau, 224 m: the tallest on the Strip, a long crescent of blue glass
  add({ id: 'fontainebleau', lon: -115.1594, lat: 36.1378, ex: 2.2, ry: 0, label: 'Fontainebleau' }, b => {
    b.box('stone', 30, -20, 0, 70, 130, 34);
    const H = [204, 213, 220, 224, 224, 220, 213, 204];
    arc(b, 'awBlueGlass', -180, 0, 180, 30, -24, 24, 8, -20, i => H[i]);
    b.light([0, 227, 0], 'red', 1.3);
  });

  // Resorts World, 207 m: two long towers of copper-red glass side by side, and the huge LED screen on the Strip
  add({ id: 'resortsworld', lon: -115.1670, lat: 36.1348, ex: 2.2, ry: 0, label: 'Resorts World' }, b => {
    b.box('stone', 30, -20, 0, 110, 110, 32);
    b.box('awRedGlass', -18, -20, -14, 84, 26, 227, { win: win(84, 207) }); b.box('awRedGlass', 14, -20, 18, 84, 26, 210, { win: win(84, 190) });
    b.box('awRedGlass', -26, 207, -14, 56, 20, 10); b.box('awRedGlass', 22, 190, 18, 56, 20, 10);
    b.box('awLed', 86, -20, 0, 3, 64, 52, { lit: 0.9 }); b.light([88, 22, 0], 'violet', 1.8);
  });

  // Treasure Island, 110 m: the beige V-shaped tower, and the pirate ship in Sirens' Cove on the Strip
  add({ id: 'tisland', lon: -115.1722, lat: 36.1247, ex: 2.2, ry: 0, label: 'Treasure Island' }, b => {
    b.box('stone', -20, -20, 0, 90, 110, 32);
    b.box('sand', -50, -20, 0, 24, 24, 138, { win: win(24, 138) });
    for (const a of [-36, 36]) { wing(b, 'sand', a, 8, 84, 21, -20, 130, { x: -50 }); }
    pond(b, 'lagoon', 50, -6, 28, 44, 16);
    b.place(52, 0, -6, 0, 1.6, () => {
      const st = [[-23, 1.5, 8.5], [-15, 5, 6], [0, 6, 5.2], [15, 5, 6], [23, 2, 9]];
      b.loft('awWood', st.map(([z, w, y]) => [[-w, y, z], [w, y, z], [w * 0.8, 1, z], [0, -3, z], [-w * 0.8, 1, z]]), { flat: true, cap0: true });
      for (const [z, h] of [[-8, 38], [7, 33]]) { b.rod('awWood', [0, 5, z], [0, h, z], 0.6, 0.4, 5); b.box('white', 0, 12, z, 12, 0.9, 10); b.box('white', 0, 23.5, z, 9.5, 0.9, 8.5); }
    });
    b.light([52, 14, -6], 'warm', 1.4);
  });

  // Circus Circus: the pink and white big top on the Strip, the white towers banded pink behind it
  add({ id: 'circus', lon: -115.1640, lat: 36.1373, ex: 2.2, ry: 0, label: 'Circus Circus' }, b => {
    const cx = 25, cz = 10, prof = [[48, -20], [48, 0], [46, 8], [38, 18], [24, 28], [10, 36], [3, 40]], n = 16;
    for (let k = 0; k < n; k++) {
      const a0 = k / n * Math.PI * 2, a1 = (k + 1) / n * Math.PI * 2, m = k % 2 ? 'white' : 'awPink', P = (r, y, a) => [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
      for (let i = 0; i < prof.length - 1; i++) { const [r0, y0] = prof[i], [r1, y1] = prof[i + 1]; face(b, m, [P(r0, y0, a0), P(r0, y0, a1), P(r1, y1, a1), P(r1, y1, a0)], P(r0 * 3 + 10, (y0 + y1) / 2 + 30, (a0 + a1) / 2)); }
    }
    b.cyl('awPink', cx, 39.5, cz, 3.2, 0, 7, 8); b.rod('metal', [cx, 46, cz], [cx, 52, cz], 0.4, 0.2, 4); b.light([cx, 30, cz], 'pink', 1.8);
    b.box('white', -62, -20, -30, 26, 92, 140, { win: win(92, 120) }); b.box('awPink', -62, 98, -30, 27, 93, 7);
    b.box('white', -40, -20, 52, 84, 24, 116, { win: win(84, 96) }); b.box('awPink', -40, 78, 52, 85, 25, 6);
  });

  // T-Mobile Arena, 40 m: a rounded box of bronze fins with a tall glass corner facing the Strip
  add({ id: 'tmobile', lon: -115.1785, lat: 36.1027, ex: 1.8, ry: 0, label: 'T-Mobile Arena' }, b => {
    b.loft('awArena', [rrect(0, -20, 0, 70, 58, 24, 3.2), rrect(0, 34, 0, 70, 58, 24, 3.2)], { flat: true, win: [40, 6], glow: 0.5 });
    b.loft('roof', [rrect(0, 34, 0, 66, 54, 24, 3.2), rrect(0, 38, 0, 55, 44, 24, 3.2)], { flat: true });
    b.box('glass', 44, -20, -38, 40, 24, 64, { ry: 40, win: [9, 7], glow: 1.2 });
    b.light([50, 46, -40], 'cool', 1.4);
  });

  // ================= the Bay Area outside San Francisco =================
  // Sather Tower (the Campanile), Berkeley, 94 m: a granite shaft, clocks, the open belfry and a pointed green roof
  add({ id: 'campanile', lon: -122.2578, lat: 37.8721, ex: 4.0, ry: 0, label: 'Sather Tower' }, b => {
    b.box('stone', 0, -20, 0, 16, 16, 28); b.frustum('stone', 0, 8, 0, 11.8, 11.8, 11.2, 11.2, 50);
    for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) b.rod('clock', [dx * 5.5, 51, dz * 5.5], [dx * 6.1, 51, dz * 6.1], 2.4, 2.4, 10, { lit: 1.5 });
    b.box('stone', 0, 58, 0, 12.8, 12.8, 2); b.box('whiteShade', 0, 60, 0, 11, 11, 11, { win: [3, 1], glow: 1.3 }); b.box('stone', 0, 71, 0, 12.8, 12.8, 2.6);
    for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) b.frustum('stone', dx * 5.6, 73.6, dz * 5.6, 1.8, 1.8, 0.2, 0.2, 5);
    b.frustum('awPatina', 0, 73.6, 0, 10, 10, 0.7, 0.7, 18); b.rod('metal', [0, 91.6, 0], [0, 94.5, 0], 0.4, 0.15, 5);
    b.light([0, 65, 0], 'warm', 1.4); b.light([0, 95, 0], 'red', 0.9);
  });

  // the Tribune Tower, Oakland, 93 m: a salmon brick shaft, clock faces and red neon, a green copper chateau roof with corner turrets
  add({ id: 'tribune', lon: -122.268, lat: 37.8039, ex: 4.0, ry: 0, label: 'Tribune Tower' }, b => {
    b.box('awBrick', 2, -20, 15, 22, 24, 50, { win: [4, 5], glow: 0.8 });
    b.box('awBrick', 0, -20, 0, 16, 16, 87, { win: [3, 14], glow: 0.8 }); b.box('stone', 0, 67, 0, 17.4, 17.4, 2); b.box('awBrick', 0, 69, 0, 15, 15, 7);
    for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) { b.rod('clock', [dx * 7.3, 72.5, dz * 7.3], [dx * 7.9, 72.5, dz * 7.9], 2.6, 2.6, 10, { lit: 1.5 }); b.box('red', dx * 8.3, 62, dz * 8.3, dz ? 9 : 0.6, dx ? 9 : 0.6, 2.4, { lit: 1.2 }); }
    b.frustum('awPatina', 0, 76, 0, 15, 15, 7, 7, 10);
    for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { b.cyl('awPatina', dx * 7, 76, dz * 7, 1.9, 1.9, 6, 8); b.cyl('awPatina', dx * 7, 82, dz * 7, 2.3, 0, 6, 8); }
    b.frustum('awPatina', 0, 86, 0, 7, 7, 1, 1, 4); b.rod('metal', [0, 90, 0], [0, 94, 0], 0.3, 0.15, 4);
    b.light([0, 62, 8.6], 'red', 1.1); b.light([0, 95, 0], 'red', 0.8);
  });

  // the Port of Oakland cranes, 85 m: white container cranes on four legs, their booms raised over the water like giraffes, boxes stacked behind
  add({ id: 'portcranes', lon: -122.3199, lat: 37.8116, ex: 2.5, ry: 45, label: 'Port of Oakland cranes' }, b => {
    for (const cx of [-48, 0, 48]) {
      for (const [lx, lz] of [[-9, -15], [9, -15], [-9, 15], [9, 15]]) b.beam('white', [cx + lx, -10, lz], [cx + lx, 47, lz], 2.4);
      for (const lx of [-9, 9]) b.beam('white', [cx + lx, 45, -15], [cx + lx, 45, 15], 2.4, 3.2);
      for (const lz of [-15, 15]) b.beam('white', [cx - 9, 24, lz], [cx + 9, 24, lz], 1.6);
      for (const lx of [-4, 4]) b.beam('white', [cx + lx, 50, 32], [cx + lx, 50, -82], 2.2, 3.4);
      for (const lx of [-9, 9]) { b.beam('white', [cx + lx, 47, -15], [cx + lx * 0.45, 86, 2], 1.8); b.beam('white', [cx + lx, 47, 15], [cx + lx * 0.45, 86, 2], 1.8); }
      for (const lx of [-4, 4]) { b.beam('metal', [cx + lx, 86, 2], [cx + lx, 51.5, -80], 0.7); b.beam('metal', [cx + lx, 86, 2], [cx + lx, 51.5, 30], 0.7); }
      b.box('white', cx, 51.6, 24, 11, 14, 7); b.box('dark', cx, 38, -20, 5, 6, 6); b.light([cx, 88, 2], 'red', 1.1);
    }
    [['p0', -60], ['red', -36], ['p3', -12], ['p6', 12], ['p2', 36], ['p5', 60]].forEach(([m, x], i) => b.box(m, x, -10, 50 + (i % 2) * 14, 16, 12, 10 + (i % 3) * 3));
  });

  // the Oakland California Temple, 52 m: white granite on a terrace, a tall central spire and four corner spires
  add({ id: 'oaktemple', lon: -122.1974, lat: 37.8061, ex: 4.0, ry: 0, label: 'Oakland California Temple' }, b => {
    b.box('awGreen', 0, -20, 0, 76, 76, 21.5); b.box('white', 0, -20, 0, 54, 54, 26);
    b.box('white', 0, 6, 0, 36, 36, 14, { win: [6, 2], glow: 0.7 });
    b.box('white', 0, 20, 0, 11, 11, 14); b.frustum('white', 0, 34, 0, 11, 11, 0.5, 0.5, 18, { lit: 0.3 });
    for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) { b.box('white', dx * 14, 20, dz * 14, 6.5, 6.5, 7); b.frustum('white', dx * 14, 27, dz * 14, 6.5, 6.5, 0.4, 0.4, 12, { lit: 0.3 }); }
    b.light([0, 53, 0], 'gold', 1.4); for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) b.light([dx * 14, 40, dz * 14], 'gold', 0.9);
  });

  // Hoover Tower, Stanford, 87 m: a buff sandstone shaft, the open observation deck and a red-tiled dome
  add({ id: 'hoover', lon: -122.1667, lat: 37.4275, ex: 4.0, ry: 0, label: 'Hoover Tower' }, b => {
    b.box('sand', 0, -20, 0, 24, 18, 34, { win: [5, 2], glow: 0.7 }); b.box('sand', 0, -20, 0, 12.5, 12.5, 84, { win: [3, 12], glow: 0.6 });
    b.box('sand', 0, 64, 0, 14, 14, 1.6); b.box('whiteShade', 0, 65.6, 0, 12.5, 12.5, 6.4, { win: [3, 1], glow: 1.3 }); b.box('sand', 0, 72, 0, 14, 14, 2);
    b.cyl('sand', 0, 74, 0, 5.6, 5.6, 2.5, 12); b.lathe('dome', 0, 0, [[5.8, 76.5], [5.4, 79], [4, 81.4], [2, 82.8], [0, 83.2]], 12, { cap: false });
    b.cyl('sand', 0, 83, 0, 1.2, 1.0, 3, 6); b.light([0, 69, 0], 'warm', 1.3);
  });

  // Memorial Church, Stanford, 34 m: a sandstone cross under red tile, its gold mosaic front facing north onto the Main Quad
  add({ id: 'memchu', lon: -122.1702, lat: 37.4270, ex: 4.0, ry: 0, label: 'Memorial Church' }, b => {
    b.box('sand', 0, -20, 8, 22, 56, 36); gable(b, 'dome', 0, 16, 8, 57, 23.5, 8, 90);
    b.box('sand', 0, -20, 14, 48, 18, 34); gable(b, 'dome', 0, 14, 14, 49, 19.5, 7);
    b.box('sand', 0, 16, 14, 15, 15, 11); b.frustum('dome', 0, 27, 14, 16.4, 16.4, 1, 1, 8);
    b.box('awGold', 0, -2, -20.4, 17, 1.2, 19, { lit: 0.4 }); b.loft('awGold', [[[-8.5, 17, -20.4], [8.5, 17, -20.4], [0, 23, -20.4]], [[-8.5, 17, -21.6], [8.5, 17, -21.6], [0, 23, -21.6]]], { flat: true, cap0: true, lit: 0.4 });
    for (const s of [-1, 1]) { b.box('sand', s * 40, -20, -17, 46, 9, 27, { win: [8, 1], glow: 0.6 }); gable(b, 'dome', s * 40, 7, -17, 47, 10, 3); }
    b.light([0, 10, -24], 'warm', 1.2);
  });

  // Apple Park, Cupertino: the ring, 461 m across and four floors high, glass walls under a white canopy, the green inside, the Steve Jobs Theater
  add({ id: 'applepark', lon: -122.0090, lat: 37.3349, ex: 1.25, ry: 0, label: 'Apple Park' }, (b, e) => {
    const n = 44, ri = 182, ro = 228, P = (r, a, y) => [Math.cos(a) * r, y, Math.sin(a) * r];
    for (let i = 0; i < n; i++) {
      const a0 = i / n * Math.PI * 2, a1 = (i + 1) / n * Math.PI * 2, q = (r0, r1, y) => [P(r0, a0, y), P(r1, a0, y), P(r1, a1, y), P(r0, a1, y)];
      b.loft('glass', [q(ri, ro, -15), q(ri, ro, 26)], { flat: true, cap: false, win: [2, 5], glow: 1 });
      b.loft('white', [q(ri - 6, ro + 6, 26), q(ri - 6, ro + 6, 30)], { flat: true });
    }
    b.loft('awGreen', [b.circ(0, -2, 0, 178, 30), b.circ(0, 1, 0, 178, 30)]); pond(b, 'lagoon', 48, -40, 30, 18, 12, 1.6);
    for (let i = 0; i < 9; i++) { const a = i * 2.4, r = 60 + (i % 3) * 38; b.cyl('awTree', Math.cos(a) * r, -1, Math.sin(a) * r, 11, 0, 22, 6); }
    const [tx, tz] = at(e, -122.0060, 37.3307);
    b.cyl('glass', tx, -10, tz, 23, 23, 17, 16, { win: [16, 1], glow: 1.2 }); b.cyl('white', tx, 7, tz, 26, 26, 2.2, 16);
    b.light([0, 32, -205], 'warm', 1.4); b.light([0, 32, 205], 'warm', 1.4); b.light([205, 32, 0], 'warm', 1.4); b.light([-205, 32, 0], 'warm', 1.4);
  });

  // Levi's Stadium, Santa Clara: the bowl of red seats round a green field, the tall glass suite tower on the west under its solar roof
  add({ id: 'levis', lon: -121.9700, lat: 37.4033, ex: 1.8, ry: 12, label: "Levi's Stadium" }, b => {
    b.box('awGreen', 0, -2, 0, 72, 118, 3.2);
    const n = 32, I = rrect(0, 4, 0, 50, 74, n, 3), O = rrect(0, 0, 0, 104, 122, n, 3), top = p => 26 + 18 * Math.max(0, -p[0] / 104);
    for (let j = 0; j < n; j++) {
      const k = (j + 1) % n, i0 = I[j], i1 = I[k], o0 = [O[j][0], top(O[j]), O[j][2]], o1 = [O[k][0], top(O[k]), O[k][2]];
      face(b, 'red', [i0, i1, o1, o0], [0, 300, 0]);
      face(b, 'concrete', [o0, o1, [o1[0], -10, o1[2]], [o0[0], -10, o0[2]]], [O[j][0] * 3, 0, O[j][2] * 3]);
      face(b, 'concrete', [i0, i1, [i1[0], -1, i1[2]], [i0[0], -1, i0[2]]], [0, 2, 0]);
    }
    b.box('glass', -116, -20, 0, 30, 190, 82, { win: [30, 10], glow: 1 }); b.box('dark', -112, 62, 0, 42, 200, 3);
    for (const s of [-1, 1]) b.box('dark', 0, 26, s * 128, 46, 4, 18, { win: [6, 2], glow: 1.4 });
    b.light([0, 70, -60], 'white', 2); b.light([0, 70, 60], 'white', 2);
  });

  // Marin County Civic Center, San Rafael: Frank Lloyd Wright's long tiered wings under blue roofs, the blue dome and the gold spire
  add({ id: 'marincivic', lon: -122.5311, lat: 38.0003, ex: 2.0, ry: 0, label: 'Marin County Civic Center' }, b => {
    const wingOf = (a, len) => [[46, -20, 8], [35, 8, 16], [23, 16, 23]].forEach(([w, y0, y1]) => { wing(b, 'awCream', a, 22, len, w, y0, y1, { win: false }); wing(b, 'awBlue', a, 21, len + 1.5, w + 3, y1, y1 + 1.6, { win: false }); });
    wingOf(-96, 150); wingOf(110, 200);
    b.cyl('awCream', 0, -20, 0, 26, 26, 40, 16, { win: [24, 2], glow: 0.7 }); b.lathe('awBlue', 0, 0, [[27, 20], [25, 25], [18, 30], [0, 32.5]], 16, { cap: false });
    b.frustum('awGold', -40, -20, 22, 10, 10, 0.5, 0.5, 78); b.light([-40, 59, 22], 'gold', 1.2);
  });

  // the Winchester Mystery House, San Jose: a rambling cream Victorian of crossing gables, a round tower and a cupola
  add({ id: 'winchester', lon: -121.9505, lat: 37.3184, ex: 5.0, ry: 0, label: 'Winchester Mystery House' }, b => {
    [[0, 0, 26, 18, 14, 0], [20, -10, 16, 14, 18, 90], [-18, 6, 14, 16, 12, 90], [8, 16, 18, 12, 10, 0], [-6, -16, 14, 12, 16, 0], [28, 10, 12, 12, 8, 0]].forEach(([x, z, sx, sz, h, ry]) => {
      b.box('awCream', x, -20, z, sx, sz, 20 + h, { ry, win: [3, 2], glow: 0.8 }); gable(b, 'awRoofRed', x, h, z, sx + 1.2, sz + 1.4, 6, ry);
    });
    b.cyl('awCream', -13, -20, -5, 4, 4, 43, 8); b.cyl('awRoofRed', -13, 23, -5, 5, 0, 9, 8);
    b.box('awCream', 13, -20, 3, 6, 6, 45); b.frustum('awRoofRed', 13, 25, 3, 7.5, 7.5, 0.6, 0.6, 6); b.cyl('awCream', 13, 31, 3, 1, 1, 2, 6);
    palm(b, -30, 22, 14, -2); palm(b, 38, -14, 12, -2); b.cyl('awTree', -30, -2, -18, 6, 3, 9, 7);
    b.light([0, 20, 10], 'warm', 1);
  });

  // San Jose City Hall, 85 m: Richard Meier's white tower and the glass rotunda in front of it
  add({ id: 'sjcityhall', lon: -121.8853, lat: 37.3377, ex: 3.5, ry: 0, label: 'San Jose City Hall' }, b => {
    b.box('stone', 0, -20, 20, 110, 70, 20.4);
    b.box('white', 0, -20, -25, 62, 20, 105, { win: [14, 18] }); b.box('white', 0, 85, -25, 64, 22, 1.2);
    b.cyl('glass', -12, -20, 22, 17, 17, 40, 16, { win: [16, 3], glow: 1.3 }); b.cyl('white', -12, 19, 22, 17.6, 17.6, 1.6, 16);
    b.lathe('glassTop', -12, 22, [[17, 20.6], [16, 26], [12, 31.5], [6, 35.5], [0, 37]], 16, { cap: false, lit: 0.35 });
    b.box('white', 32, -20, 24, 30, 26, 34, { win: [6, 2], glow: 0.8 });
    b.light([-12, 30, 22], 'cool', 1.4);
  });

  // the Oakland Coliseum and the Arena: the oval bowl with the tall Mount Davis stand at its east end, the round arena beside it
  add({ id: 'coliseum', lon: -122.2006, lat: 37.7516, ex: 2.0, ry: 0, label: 'Oakland Coliseum and Arena' }, (b, e) => {
    b.loft('awGreen', [b.circ(0, -2, 0, 56, 20, 0, 74), b.circ(0, 1, 0, 56, 20, 0, 74)]);
    const n = 30, I = b.circ(0, 3, 0, 62, n, 0, 82), O = b.circ(0, 0, 0, 108, n, 0, 124), top = p => 26 + 20 * Math.max(0, p[0] / 108 - 0.35) / 0.65;
    for (let j = 0; j < n; j++) {
      const k = (j + 1) % n, i0 = I[j], i1 = I[k], o0 = [O[j][0], top(O[j]), O[j][2]], o1 = [O[k][0], top(O[k]), O[k][2]];
      face(b, 'awSeat', [i0, i1, o1, o0], [0, 300, 0]);
      face(b, 'concrete', [o0, o1, [o1[0], -10, o1[2]], [o0[0], -10, o0[2]]], [O[j][0] * 3, 0, O[j][2] * 3]);
    }
    const [ax, az] = at(e, -122.2033, 37.7503);
    b.cyl('concreteLight', ax, -20, az, 56, 56, 46, 18, { win: [24, 2], glow: 0.6 }); b.lathe('roof', ax, az, [[57, 26], [52, 30], [36, 34], [0, 36]], 18, { cap: false });
    b.light([0, 60, -90], 'white', 1.6); b.light([0, 60, 90], 'white', 1.6);
  });

  // Muir Woods: a grove of coast redwoods, 60 to 80 m tall, rust trunks under narrow dark crowns
  add({ id: 'muirwoods', lon: -122.5800, lat: 37.8985, ex: 2.2, ry: 0, label: 'Muir Woods' }, b => {
    let s = 7; const R = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < 24; i++) { const a = R() * Math.PI * 2, d = Math.sqrt(R()) * 72, x = Math.cos(a) * d * 1.4, z = Math.sin(a) * d, h = 52 + R() * 28; b.cyl('awWood', x, -12, z, 2.6, 1.3, h * 0.5 + 12, 5); b.cyl('awTree', x, h * 0.26, z, 7.5 + h * 0.04, 0, h * 0.74, 6); }
  });

  // the Ford Assembly Building, Richmond: Albert Kahn's long factory under a sawtooth roof, the tall glass Craneway at the water's end
  add({ id: 'fordcraneway', lon: -122.3647, lat: 37.9105, ex: 2.0, ry: 0, label: 'Ford Assembly Building' }, b => {
    b.box('stone', 0, -20, -92, 110, 190, 34, { win: [24, 2], glow: 0.7 });
    for (let k = 0; k < 10; k++) {
      const z0 = -187 + k * 19, z1 = z0 + 19;
      face(b, 'glassRoof', [[-55, 14, z0], [55, 14, z0], [55, 22, z0], [-55, 22, z0]], [0, 18, z0 - 50], { lit: 0.25 });
      face(b, 'roof', [[-55, 22, z0], [55, 22, z0], [55, 14, z1], [-55, 14, z1]], [0, 80, z0 + 20]);
      for (const sx of [-55, 55]) face(b, 'stone', [[sx, 14, z0], [sx, 22, z0], [sx, 14, z1]], [sx * 3, 16, z0 + 6]);
    }
    b.box('glass', 0, -20, 24, 110, 44, 46, { win: [20, 4], glow: 1.1 }); b.box('roof', 0, 26, 24, 112, 46, 1.6);
    b.light([0, 20, 48], 'warm', 1.4);
  });
})();
