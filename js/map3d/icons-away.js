// More 3D landmarks for the 3D map (beta): the rest of the Bay and Las Vegas. Each entry is pushed onto window.M3D.extra and taken up by js/map3d/models.js.
(() => {
  const X = window.M3D.extra = window.M3D.extra || [];
  // the true sizes (js/map3d.js lmTrue; the list and its rule are in icons-sf.js): js/map3d/models.js's own Strip models, and where a model here is not its real size times ex
  const RD = Math.sqrt(2.5);   // (a round or steep one keeps its shape: drawn as a whole RD times its true size)
  window.M3D.lmTrue = Object.assign(window.M3D.lmTrue || {}, {
    sphere: [RD / 2.6, RD / 2.6], // Sphere: 112 m tall, 157 m across, round
    eiffel: [RD / 4.2, RD / 4.2], // the Eiffel Tower at Paris Las Vegas: 165 m, half the real one; its shape kept
    highroller: [RD / 3.8, RD / 3.8], // High Roller: 168 m, a wheel
    strat: 1 / 2.6,         // The STRAT: 350 m
    luxor: [RD / 3, RD / 3], // Luxor: 107 m on a 183 m base, a pyramid: its slope kept
    muirwoods: [1, 1],      // Muir Woods: a few redwoods stand for a forest 2 km long: it keeps its size
  });
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
    awPHGlass: ['#686e98', '#2b3058'], awMagenta: ['#d98cb8', '#ff6fc2'], awVeerY: ['#e2c25e', '#8c7330'], awEmGlass: ['#5fa486', '#2c6a52'],
    awAriaGlass: ['#b6cad8', '#3d5871'], awHotPink: ['#e48ea4', '#9c5068'], awDomeGlass: ['#86b0cc', '#5c9fd2'], awField: ['#a2c77f', '#40683a'],
    awSeatG: ['#6c8c7a', '#2e4a3d'], awSky: ['#bcd8ea', '#7cc0ee'],
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
  // 90 = south), each piece from y0 to hOf(i); o.roof: a low hipped cap in that material; o.lit: a solid light instead of windows;
  // o.dOf(f): the depth at the fraction f along the curve (a blade that thins towards its ends)
  function arc(b, mat, cx, cz, R, d, a0, a1, n, y0, hOf, o = {}) {
    const P = (r, t, y) => [cx + Math.cos(t) * r, y, cz + Math.sin(t) * r], seg = 2 * R * Math.sin(Math.abs(a1 - a0) * D / n / 2);
    for (let i = 0; i < n; i++) {
      const t0 = (a0 + (a1 - a0) * i / n) * D, t1 = (a0 + (a1 - a0) * (i + 1) / n) * D, h = hOf(i), d0 = o.dOf ? o.dOf(i / n) : d, d1 = o.dOf ? o.dOf((i + 1) / n) : d;
      const ring = (y, k) => { const rm = R, tm = (t0 + t1) / 2, q = (r, t) => { const p = P(r, t, y), c = P(rm, tm, y); return [c[0] + (p[0] - c[0]) * k, y, c[2] + (p[2] - c[2]) * k]; }; return [q(R - d0 / 2, t0), q(R + d0 / 2, t0), q(R + d1 / 2, t1), q(R - d1 / 2, t1)]; };
      b.loft(mat, [ring(y0, 1), ring(h, 1)], o.lit != null ? { flat: true, lit: o.lit } : { flat: true, win: o.win === false ? undefined : [Math.max(2, Math.round(seg / 5)), Math.max(2, Math.round((h - y0) / 6))] });
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

  // Caesars Palace, 120 m: white towers under classical crowns (a gold frieze, a pilastered attic, pediments at the ends), and on the Strip
  // the temple portico, the round colonnade, statues on plinths and the fountain pools lined with cypress
  add({ id: 'caesars', lon: -115.1745, lat: 36.1162, ex: 2.2, ry: 0, label: 'Caesars Palace' }, b => {
    const tw = (x, z, sx, sz, h) => {
      const long = sx >= sz, L = Math.max(sx, sz), S = Math.min(sx, sz), n = Math.round(L / 9);
      b.box('white', x, -20, z, sx, sz, h + 20, { win: win(L, h) }); b.box('white', x, h, z, sx + 4, sz + 4, 2.5);
      b.box('awGold', x, h + 2.5, z, sx + 2, sz + 2, 2.2, { lit: 0.6 }); b.box('whiteShade', x, h + 4.7, z, sx - 1, sz - 1, 9, { win: [n, 1], glow: 1.3 });
      for (let i = 0; i <= n; i++) {
        const t = -L / 2 + 1.5 + (L - 3) * i / n;
        for (const s of [-1, 1]) {
          const o = s * ((S - 1) / 2 + 0.4), P = (u, y) => long ? [x + t + u, y, z + o] : [x + o, y, z + t + u];
          face(b, 'white', [P(-1, h + 4.7), P(1, h + 4.7), P(1, h + 13.7), P(-1, h + 13.7)], long ? [x + t, h + 9, z + o * 3] : [x + o * 3, h + 9, z + t]);
        }
      }
      b.box('white', x, h + 13.7, z, sx + 3, sz + 3, 2); gable(b, 'whiteShade', x, h + 15.7, z, L + 3, S + 3, 11, long ? 0 : 90);
      b.light([x, h + 20, z], 'warm', 1.2);
    };
    tw(-62, -56, 84, 28, 118); tw(-104, 10, 28, 100, 106); tw(-150, 58, 74, 26, 100);
    b.box('white', -32, -20, 6, 30, 96, 36, { win: [3, 2], glow: 0.7 });
    // the temple portico on the casino front: six columns, the gold-banded entablature and a pediment facing the Strip
    for (let i = 0; i < 6; i++) b.cyl('white', -12, -20, -25 + i * 10, 2.7, 2.3, 38, 6);
    b.box('white', -20, 18, 0, 20, 60, 4.5); b.box('awGold', -20, 22.5, 0, 20.6, 60.6, 1.4, { lit: 0.5 }); gable(b, 'white', -20, 23.9, 0, 20, 62, 12, 0);
    // the round colonnade and its fountain, a statue on a tall plinth in the middle
    pond(b, 'lagoon', 30, 0, 21, 21, 14);
    for (let k = 0; k < 6; k++) { const a = k * 60 * D; jet(b, 30 + Math.cos(a) * 13, Math.sin(a) * 13, 14, 2); }
    for (let i = 0; i < 9; i++) { const a = (112 + i * 17) * D; b.cyl('white', 30 + Math.cos(a) * 34, -20, Math.sin(a) * 34, 2.2, 1.9, 38, 6); }
    const ring = Array.from({ length: 9 }, (_, i) => { const a = (112 + i * 17) * D; return [30 + Math.cos(a) * 34, Math.sin(a) * 34]; });
    b.loft('white', ring.map(([x, z]) => { const k = 1 / 34, nx = (x - 30) * k, nz = z * k; return [[x - nx * 2.6, 18, z - nz * 2.6], [x + nx * 2.6, 18, z + nz * 2.6], [x + nx * 2.6, 22, z + nz * 2.6], [x - nx * 2.6, 22, z - nz * 2.6]]; }), { flat: true, cap0: true });
    const statue = (x, z, k, p) => { b.box('white', x, -20, z, 5 * k, 5 * k, 20 + p); const y = p; b.frustum('awGold', x, y, z, 3 * k, 2.4 * k, 1.6 * k, 1.4 * k, 7 * k, { lit: 0.4 }); b.cyl('awGold', x, y + 7 * k, z, 1.1 * k, 0.9 * k, 2.4 * k, 6, { lit: 0.4 }); b.rod('awGold', [x + 0.5 * k, y + 6 * k, z], [x + 1.6 * k, y + 11 * k, z], 0.4 * k, 0.3 * k, 4, { lit: 0.4 }); };
    statue(30, 0, 1.7, 9); statue(62, -20, 1.5, 6); statue(62, 20, 1.5, 6);
    // the long pools beside the drive, their jets, and the cypress rows
    for (const s of [-1, 1]) {
      b.box('lagoon', 52, -1.5, s * 27, 28, 8, 2.8); for (let i = 0; i < 3; i++) jet(b, 43 + i * 9, s * 27, 11, 1.7);
      for (let i = 0; i < 4; i++) b.cyl('awTree', 14 + i * 16, -2, s * 38, 3, 0.2, 20, 5);
    }
    b.light([30, 18, 0], 'cool', 1.8); b.light([-12, 26, 0], 'gold', 1.4); b.light([-120, 132, -50], 'warm', 1.4); b.light([-78, 124, 42], 'warm', 1.4);
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

  // MGM Grand, 89 m: the emerald-glass tower of four wings with white edges, and the big golden lion on its pedestal at the Tropicana corner
  add({ id: 'mgm', lon: -115.1695, lat: 36.1024, ex: 2.0, ry: 0, label: 'MGM Grand' }, b => {
    b.box('stone', 0, -20, 0, 60, 60, 34, { ry: 15 });
    b.box('awEmGlass', 0, -20, 0, 28, 28, 119, { ry: 15, win: win(28, 119) }); b.box('white', 0, 99, 0, 30, 30, 1.6, { ry: 15 }); b.box('awEmGlass', 0, 100.6, 0, 18, 18, 7, { ry: 15 });
    for (let k = 0; k < 4; k++) {
      const a = -15 + k * 90; wing(b, 'awEmGlass', a, 12, 60, 22, -20, 89); wing(b, 'awEmGlass', a, 60, 76, 22, -20, 68);
      wing(b, 'white', a, 12, 61, 23.6, 89, 90.6, { win: false }); wing(b, 'white', a, 60, 77, 23.6, 68, 69.6, { win: false });
    }
    // the lion (45 ft on a 25 ft pedestal, drawn larger), seated on the Strip front facing the boulevard, clear of the wings and the neighbours
    b.place(-98, 0, -12, 180, 2.5, () => {
      b.cyl('stone', 0, -20, 0, 9.5, 9, 28.5, 12); b.cyl('awGold', 0, 7.2, 0, 9.6, 9.6, 1.4, 12, { lit: 0.5 });
      const y = 8.6;
      b.loft('awGold', [[[-6.5, y, -3.8], [-6.5, y, 3.8], [-6.5, y + 6.5, 3.8], [-6.5, y + 6.5, -3.8]], [[-2, y, -4], [-2, y, 4], [-2, y + 9, 4], [-2, y + 9, -4]], [[2.6, y, -3.2], [2.6, y, 3.2], [2.6, y + 13.5, 3.2], [2.6, y + 13.5, -3.2]]], { flat: true, cap0: true });
      for (const s of [-1, 1]) b.beam('awGold', [4.4, y, s * 1.9], [3.6, y + 9, s * 1.9], 2.3);
      b.lathe('awGold', 3.4, 0, [[0, y + 10.5], [3.8, y + 11.4], [4.9, y + 14], [4.5, y + 17], [2.8, y + 18.8], [0, y + 19.3]], 10, { cap: false });
      b.box('awGold', 7.2, y + 12.6, 0, 3.6, 3.2, 3);
      b.tube('awGold', [[-6.4, y + 1, 2.6], [-8.6, y + 2.2, 4], [-9.4, y + 5, 3.4], [-8.6, y + 7, 2]], 0.55, 4);
      b.light([5, y + 22, 0], 'gold', 1.6);
    });
  });

  // the Venetian and the Palazzo, 145 and 196 m: cream towers under red roofs, and along the Strip the brick campanile, the Doge's Palace
  // (white arcades under its pink wall) and the Rialto Bridge over the canal with its black gondolas
  add({ id: 'venetian', lon: -115.169, lat: 36.1222, ex: 2.2, ry: 0, label: 'The Venetian' }, b => {
    b.box('stone', 17, -20, 10, 56, 120, 36);
    b.box('stone', 10, -20, 10, 26, 26, 168, { win: win(26, 168) }); b.frustum('dome', 10, 148, 10, 27, 27, 6, 6, 9);
    for (const [a, L] of [[-90, 62], [30, 62], [150, 32]]) { wing(b, 'stone', a, 12, L, 21, -20, 140, { x: 10, z: 10 }); const c = Math.cos(a * D), s = Math.sin(a * D), r = (12 + L) / 2; b.frustum('dome', 10 + c * r, 140, 10 + s * r, L - 12, 22, L - 22, 3, 7, { ry: -a }); }
    b.box('awCream', 30, -20, -92, 70, 24, 205, { win: win(70, 205) }); b.box('awCream', 30, 185, -92, 54, 18, 7); b.frustum('dome', 30, 192, -92, 54, 18, 40, 4, 5);
    // the front, turned to run along the Strip: x across (the canal on the Strip side), z along it from north to south
    b.place(-38, 0, 0, -19, 1.6, () => {
      pond(b, 'lagoon', -16, 5, 6, 57, 10);
      // the Doge's Palace: two storeys of white arcades, the pink wall above, a white cresting
      b.box('white', 6, -20, 36, 12, 52, 29); b.box('awPink', 6, 9, 36, 12, 52, 9.5, { win: [10, 1], glow: 0.7 }); b.box('white', 6, 18.5, 36, 12.8, 52.8, 1.4);
      const arches = (n, y0, y1, k) => { for (let i = 0; i < n; i++) { const z = 10 + (i + 0.5) * 52 / n, hw = 52 / n * k; face(b, 'dark', [[-0.15, y0, z - hw], [-0.15, y0, z + hw], [-0.15, y1, z + hw], [-0.15, y1, z - hw]], [-5, (y0 + y1) / 2, z]); } };
      arches(9, 0.3, 4.6, 0.32); arches(18, 5.6, 8.4, 0.3);
      for (let i = 0; i < 3; i++) { const x = 2 + i * 4; face(b, 'dark', [[x - 1.3, 0.3, 62.15], [x + 1.3, 0.3, 62.15], [x + 1.3, 4.6, 62.15], [x - 1.3, 4.6, 62.15]], [x, 2.5, 68]); }
      // the campanile: the brick shaft, the open belfry, the attic and the green spire with its gold angel
      b.box('awBrick', 4, -20, -10, 11, 11, 70); b.box('whiteShade', 4, 50, -10, 11.6, 11.6, 9, { win: [3, 1], glow: 1.3 }); b.box('white', 4, 59, -10, 12.8, 12.8, 2); b.box('white', 4, 61, -10, 10, 10, 6);
      b.frustum('awPatina', 4, 67, -10, 10, 10, 0.6, 0.6, 18); b.rod('awGold', [4, 85, -10], [4, 89, -10], 0.7, 0.3, 5); b.light([4, 55, -10], 'warm', 1.3);
      // the Rialto Bridge: one arch over the canal, the arched pavilion at its crown, rows of shops on its two flights
      b.loft('white', [-11, -8, -5, -2.5, 0, 2.5, 5, 8, 11].map(x => { const yt = 3.5 + 6 * (1 - Math.pow(x / 11, 2)), yb = -2 + 7.5 * Math.max(0, 1 - Math.pow(x / 7.5, 2)); return [[-16 + x, yb, -42], [-16 + x, yb, -28], [-16 + x, yt, -28], [-16 + x, yt, -42]]; }), { flat: true, cap0: true });
      b.box('white', -16, 9, -35, 5, 14, 5.5); gable(b, 'dome', -16, 14.5, -35, 6, 15, 3.4, 0);
      for (const s of [-1, 1]) { b.box('white', -16 + s * 5.6, 6.5, -35, 4.2, 12, 3); gable(b, 'dome', -16 + s * 5.6, 9.5, -35, 4.8, 12.6, 2.2, 0); }
      // gondolas on the canal
      const gondola = (x, z, r) => b.place(x, 0, z, r, 1, () => b.loft('dark', [[-6.5, 0.15, 1.6, 3.4], [-4.5, 1.3, 1.1, 2.3], [0, 1.6, 0.9, 2.1], [4.5, 1.3, 1.1, 2.3], [6.5, 0.15, 1.6, 3.6]].map(([gz, w, y0, y1]) => [[-w, y0, gz], [w, y0, gz], [w, y1, gz], [-w, y1, gz]]), { flat: true, cap0: true }));
      gondola(-17.5, -14, 6); gondola(-14.5, 12, -4); gondola(-17, 34, 3); gondola(-15, 52, -6);
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

  // Aria, 183 m: two tall crescents of silver-blue glass curving against each other, each thinning to a blade at its ends, under a white crown line
  add({ id: 'aria', lon: -115.1766, lat: 36.1073, ex: 2.2, ry: 0, label: 'Aria' }, b => {
    b.box('stone', -6, -20, 10, 96, 120, 32);
    const tower = (cx, cz, a0, a1, d, top) => {
      const n = 10, hOf = i => top - (i === 0 || i === n - 1 ? 12 : i === 1 || i === n - 2 ? 5 : 0), dOf = f => d * (0.3 + 0.7 * Math.sin(Math.PI * f));
      arc(b, 'awAriaGlass', cx, cz, 130, d, a0, a1, n, -20, hOf, { dOf });
      for (let i = 0; i < n; i++) arc(b, 'white', cx, cz, 130, d, a0 + (a1 - a0) * i / n, a0 + (a1 - a0) * (i + 1) / n, 1, hOf(i) - 1, () => hOf(i) + 2.5, { win: false, dOf: f => dOf((i + f) / n) + 1.6 });
      // white bands across both faces every 40 m
      for (const yb of [34, 74, 114, 154]) for (let i = 0; i < n; i++) {
        if (yb > hOf(i) - 6) continue;
        const t0 = (a0 + (a1 - a0) * i / n) * D, t1 = (a0 + (a1 - a0) * (i + 1) / n) * D, e0 = dOf(i / n) / 2 + 0.3, e1 = dOf((i + 1) / n) / 2 + 0.3, tm = (t0 + t1) / 2;
        for (const sd of [-1, 1]) { const Q = (t, dd, y) => [cx + Math.cos(t) * (130 + sd * dd), y, cz + Math.sin(t) * (130 + sd * dd)]; face(b, 'white', [Q(t0, e0, yb), Q(t1, e1, yb), Q(t1, e1, yb + 3.5), Q(t0, e0, yb + 3.5)], [cx + Math.cos(tm) * (130 + sd * 60), yb, cz + Math.sin(tm) * (130 + sd * 60)]); }
      }
    };
    b.place(-10, 0, -13, 45, 1, () => { tower(140, 27, 153, 207, 26, 183); tower(-140, -27, -27, 27, 24, 161); b.light([10, 188, 27], 'cool', 1.4); b.light([-10, 166, -27], 'cool', 1.2); });
  });

  // the Veer Towers, 146 m: two glass towers checkered in yellow, leaning away from each other (five degrees in life, drawn steeper to read)
  add({ id: 'veer', lon: -115.1737, lat: 36.1081, ex: 2.2, ry: 0, label: 'Veer Towers' }, b => {
    const H = 150, y0 = -20, w = 14, NC = 4, NR = 10, E = [[-w, -w, w, -w], [w, -w, w, w], [w, w, -w, w], [-w, w, -w, -w]];
    for (const s of [-1, 1]) {
      const cx = s < 0 ? -20 : 22, cz = s < 0 ? -10 : 22, L = 26 * s;
      const P = (u, v, y) => { const t = (y - y0) / (H - y0); return [cx + L * 0.8 * t + u, y, cz + L * 0.6 * t + v]; };
      b.box('stone', cx, -20, cz, 36, 36, 26);
      E.forEach(([u0, v0, u1, v1], f) => {
        for (let i = 0; i < NC; i++) for (let j = 0; j < NR; j++) {
          const U = k => [u0 + (u1 - u0) * k, v0 + (v1 - v0) * k], [ua, va] = U(i / NC), [ub, vb] = U((i + 1) / NC), [um, vm] = U((i + 0.5) / NC);
          const ya = y0 + (H - y0) * j / NR, yb = y0 + (H - y0) * (j + 1) / NR, yel = (i + j + f) % 2 === 0;
          face(b, yel ? 'awVeerY' : 'glassTop', [P(ua, va, ya), P(ub, vb, ya), P(ub, vb, yb), P(ua, va, yb)], P(um * 3, vm * 3, (ya + yb) / 2), yel ? {} : { lit: 0.3 });
        }
      });
      face(b, 'white', [P(-w, -w, H), P(w, -w, H), P(w, w, H), P(-w, w, H)], P(0, 0, H + 10));
      b.light(P(0, 0, H + 3), 'red', 1);
    }
  });

  // the Cosmopolitan, 184 m: two slim dark glass towers side by side with white spines, each under a slanted crown that lights up, and
  // the tall LED marquee on the Strip
  add({ id: 'cosmo', lon: -115.1740, lat: 36.1098, ex: 2.2, ry: 0, label: 'The Cosmopolitan' }, b => {
    b.box('stone', 0, -20, 0, 70, 84, 34);
    const hx = (x, y, z, k) => [[0, -24], [10, -16], [10, 16], [0, 24], [-10, 16], [-10, -16]].map(([px, pz]) => [x + px * k, y, z + pz * k]);
    for (const x of [-22, 14]) {
      b.loft('glassDark', [hx(x, -20, -4, 1), hx(x, 168, -4, 1)], { flat: true, win: [4, 31] });
      b.loft('white', [hx(x, 168, -4, 1.05), hx(x, 171, -4, 1.05)], { flat: true });
      b.loft('awSky', [hx(x, 171, -4, 1), hx(x, 196, -11, 0.5)], { flat: true, lit: 0.8 });
      for (const s of [-1, 1]) b.box('white', x, -20, -4 + s * 24.6, 4, 2.2, 191);
      b.light([x, 186, -8], 'cool', 1.3);
    }
    b.box('dark', 44, -20, 30, 34, 6, 98); b.box('awLed', 44, 10, 30, 30, 7.4, 64, { lit: 0.9 });
    b.light([44, 42, 36], 'violet', 1.8);
  });

  // Paris Las Vegas, 105 m: the cream hotel under blue-grey mansard roofs, the Arc de Triomphe on the Strip and the balloon sign
  add({ id: 'paris', lon: -115.1691, lat: 36.1116, ex: 2.2, ry: 0, label: 'Paris Las Vegas' }, (b, e) => {
    b.box('awCream', 0, -20, 0, 24, 100, 125, { win: win(100, 105) }); b.frustum('roof', 0, 105, 0, 24, 100, 12, 86, 11);
    b.frustum('roof', 0, 105, 0, 30, 28, 12, 12, 17);
    b.box('awCream', -32, -20, 8, 48, 22, 110, { win: win(48, 90) }); b.frustum('roof', -32, 90, 8, 48, 22, 38, 9, 9);
    b.box('stone', -10, -20, 6, 64, 116, 34);
    // the Arc, drawn three times its size and turned to show its great arch to the usual north-up view
    const [ax, az] = at(e, -115.1720, 36.1141);
    b.place(ax, 0, az, 90, 3.0, () => {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('stone', sx * 4.7, -20, sz * 10.5, 5.6, 9, 42);
      b.box('stone', 0, 22, 0, 15, 30, 11); b.box('stoneShade', 0, 33, 0, 15.6, 30.6, 1.2); b.box('stone', 0, 34.2, 0, 13.4, 28.4, 2.6);
      b.light([0, 18, 0], 'warm', 1.2);
    });
    const [bx, bz] = at(e, -115.1701, 36.1106); // a little north-east of its spot, clear of Planet Hollywood's tower
    b.place(bx, 0, bz, 0, 2.3, () => {
      b.box('stone', 0, -20, 0, 10, 10, 31); b.frustum('awGold', 0, 11, 0, 4, 4, 2.4, 2.4, 5);
      b.lathe('awBlue', 0, 0, [[0, 15], [3, 16], [7, 19], [10.5, 25], [12, 31.5], [11, 37], [8, 42], [4, 44.6], [0, 45.4]], 12, { cap: false, lit: 0.35 });
      b.lathe('awGold', 0, 0, [[12.15, 29.6], [12.15, 33.2]], 12, { cap: false, lit: 0.6 }); b.light([0, 32, 0], 'gold', 1.6);
    });
  });

  // Planet Hollywood, 135 m: the tower striped top to bottom with bright white fins under its lit crown and sign, and on the Strip the
  // Miracle Mile podium with the big curved LED wall, the marquee and the ringed planet
  add({ id: 'planethw', lon: -115.1714, lat: 36.1100, ex: 2.2, ry: 0, label: 'Planet Hollywood' }, b => {
    const T = 135;
    b.box('stone', -8, -20, 38, 54, 100, 40, { win: [10, 2], glow: 0.7 });
    b.box('awPHGlass', 20, -20, 42, 28, 80, T + 20, { win: [6, 22] });
    for (let i = 0; i < 10; i++) for (const s of [-1, 1]) b.box('white', 20 + s * 14.4, -20, 6 + i * 8, 2.4, 2.8, T + 14);
    for (let i = 0; i < 4; i++) for (const s of [-1, 1]) b.box('white', 9.5 + i * 7, -20, 42 + s * 40.4, 2.8, 2.4, T + 14);
    b.box('awMagenta', 20, T - 8, 42, 31.6, 83.6, 10, { lit: 0.8 }); b.box('awMagenta', 5, T + 2, 42, 2.6, 48, 16, { lit: 0.9 });
    // the curved LED wall round the front of the podium, the marquee and the planet with its ring
    arc(b, 'awMagenta', 80, 38, 120, 3.5, 156, 204, 8, -20, () => 27, { lit: 0.9 });
    b.box('dark', -42, -20, 80, 6, 6, 68); b.box('awMagenta', -42, 14, 80, 7.4, 13, 24, { lit: 0.9 });
    const py = 59; b.lathe('awLed', -42, 80, [[0, py - 10], [5, py - 8.7], [8.7, py - 5], [10, py], [8.7, py + 5], [5, py + 8.7], [0, py + 10]], 12, { cap: false, lit: 0.7 });
    b.tube('awGold', Array.from({ length: 17 }, (_, j) => { const a = j / 16 * Math.PI * 2; return [-42 + Math.cos(a) * 15.5, py + Math.sin(a) * 15.5 * 0.36, 80 + Math.sin(a) * 15.5 * 0.93]; }), 1.1, 4, { lit: 0.6 });
    b.light([-40, 12, 38], 'pink', 2); b.light([20, T + 8, 42], 'violet', 1.6); b.light([-42, py, 80], 'violet', 1.4);
  });

  // the Flamingo, 92 m: the hot-pink tower and its pink partner, and on the Strip corner the neon plume, a column bursting into pink and orange feathers
  add({ id: 'flamingo', lon: -115.1712, lat: 36.1160, ex: 2.0, ry: 0, label: 'Flamingo' }, b => {
    b.box('stone', -12, -20, -6, 44, 92, 34);
    b.box('awHotPink', 10, -20, -16, 22, 108, 112, { win: win(108, 92) }); b.box('white', 10, 92, -16, 24, 110, 2); b.box('awHotPink', 10, 94, -16, 15, 60, 6);
    b.box('awPink', 40, -20, -8, 18, 64, 90, { win: win(64, 70) }); b.box('white', 40, 70, -8, 20, 66, 2);
    // the plume, drawn half as large again
    b.place(-38, 0, 22, 0, 1.4, () => {
      b.cyl('awNeon', 0, -20, 0, 6, 6, 44, 10, { lit: 1 });
      b.lathe('awMagenta', 0, 0, [[6, 16], [11, 19], [15, 26], [15.5, 30], [10, 33]], 12, { lit: 1.1, cap: false });
      for (let k = 0; k < 10; k++) { const a = (k * 36 + 18) * D; b.beam(k % 2 ? 'awNeon' : 'awMagenta', [Math.cos(a) * 6, 20, Math.sin(a) * 6], [Math.cos(a) * 24, 54, Math.sin(a) * 24], 6, 1.6, { lit: 1.1 }); }
      b.light([0, 34, 0], 'pink', 2); b.light([0, 52, 0], 'pink', 1.4);
    });
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

  // T-Mobile Arena, 40 m: a rounded box wrapped in layered bands of copper and glass, the tall glass front on the plaza and the big LED screen above it
  add({ id: 'tmobile', lon: -115.1785, lat: 36.1027, ex: 1.8, ry: 0, label: 'T-Mobile Arena' }, b => {
    const R = (y, k) => rrect(0, y, 0, 70 * k, 58 * k, 24, 3.2);
    b.loft('awCopper', [R(-20, 1), R(10, 1)], { flat: true });
    b.loft('glass', [R(10, 0.97), R(19, 0.97)], { flat: true, win: [40, 2], glow: 1.2 });
    b.loft('awCopper', [R(19, 1.04), R(26, 1.04)], { flat: true });
    b.loft('glass', [R(26, 1), R(31, 1)], { flat: true, win: [40, 1], glow: 1.1 });
    b.loft('awCopper', [R(31, 1.07), R(36, 1.07)], { flat: true });
    b.loft('white', [R(36, 1.02), R(41, 0.8)], { flat: true });
    // the glass front facing the plaza (north-east), crossed by copper ledges, and the LED screen
    b.box('glass', 54, -20, -43, 30, 58, 56, { ry: 40, win: [10, 6], glow: 1.3 });
    for (const y of [2, 13, 24]) b.box('awCopper', 55.5, y, -44.3, 34, 62, 2.2, { ry: 40 });
    b.box('awCopper', 54, 36, -43, 32, 60, 2.6, { ry: 40 });
    b.box('awLed', 67, 8, -53.9, 2.4, 40, 22, { ry: 40, lit: 0.9 });
    b.light([74, 20, -58], 'violet', 1.6); b.light([54, 40, -43], 'cool', 1.2);
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

  // Memorial Church, Stanford, 34 m: a sandstone church under red tile with its big gold mosaic front facing north, and round the courtyard
  // before it the Main Quad: low sandstone ranges under red-tiled roofs, arcaded on the courtyard side
  add({ id: 'memchu', lon: -122.1702, lat: 37.4270, ex: 4.0, ry: 0, label: 'Memorial Church' }, b => {
    b.box('sand', 0, -20, 8, 22, 56, 36); gable(b, 'dome', 0, 16, 8, 57, 23.5, 8, 90);
    b.box('sand', 0, -20, 14, 48, 18, 34); gable(b, 'dome', 0, 14, 14, 49, 19.5, 7);
    b.box('sand', 0, 16, 14, 15, 15, 11); b.frustum('dome', 0, 27, 14, 16.4, 16.4, 1, 1, 8);
    // the front: a tall gabled wall carrying the gold mosaic, three dark portals below it
    b.box('sand', 0, -20, -21.5, 30, 4, 45); b.loft('sand', [[[-15, 25, -23.5], [15, 25, -23.5], [0, 34, -23.5]], [[-15, 25, -19.5], [15, 25, -19.5], [0, 34, -19.5]]], { flat: true, cap0: true });
    b.box('awGold', 0, 6.5, -23.9, 23, 0.8, 18, { lit: 0.6 }); face(b, 'awGold', [[-11, 25.3, -23.8], [11, 25.3, -23.8], [0, 32.2, -23.8]], [0, 28, -40], { lit: 0.6 });
    b.box('awBlue', 0, 13, -24.4, 15, 0.4, 4, { lit: 0.4 });
    for (const x of [-8, 0, 8]) face(b, 'dark', [[x - 2.2, 0, -23.8], [x + 2.2, 0, -23.8], [x + 2.2, x ? 5 : 6, -23.8], [x - 2.2, x ? 5 : 6, -23.8]], [x, 3, -40]);
    // the Main Quad round the courtyard: ranges 9 m deep, 12 m to the eaves, arcades facing in
    const H = 12, range = (cx, cz, sx, sz, ix, iz) => {
      const along = sx >= sz, L = Math.max(sx, sz); b.box('sand', cx, -20, cz, sx, sz, 20 + H); gable(b, 'dome', cx, H, cz, L + 1, Math.min(sx, sz) + 1.8, 4.5, along ? 0 : 90);
      const n = Math.floor(L / 6.5);
      for (let i = 0; i < n; i++) {
        const t = -L / 2 + (i + 0.5) * L / n, P = (u, y) => along ? [cx + t + u, y, cz + iz * (sz / 2 + 0.2)] : [cx + ix * (sx / 2 + 0.2), y, cz + t + u];
        face(b, 'ochreShade', [P(-1.8, 0), P(1.8, 0), P(1.8, 7.5), P(-1.8, 7.5)], along ? [cx + t, 4, cz + iz * 20] : [cx + ix * 20, 4, cz + t]);
      }
    };
    for (const s of [-1, 1]) { range(s * 30.5, -19.5, 29, 9, 0, -1); range(s * 40.5, -62, 9, 76, -s, 0); }
    range(0, -104.5, 90, 9, 0, 1); b.box('sand', 0, -20, -104.5, 16, 11, 38); gable(b, 'dome', 0, 18, -104.5, 17, 12, 5);
    for (const [x, z] of [[-18, -48], [18, -48], [-18, -80], [18, -80]]) b.cyl('awTree', x, -1, z, 5, 4, 7, 7);
    b.light([0, 12, -27], 'warm', 1.4);
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

  // Marin County Civic Center, San Rafael: Frank Lloyd Wright's long wings stepping up in arcaded tiers under blue roofs, the round
  // blue dome on its gold ring, and the gold spire
  add({ id: 'marincivic', lon: -122.5311, lat: 38.0003, ex: 2.0, ry: 0, label: 'Marin County Civic Center' }, b => {
    const tiers = [[46, -20, 8, 10], [35, 8, 16, 7], [24, 16, 23, 7]];
    const wingOf = (a, len) => {
      const c = Math.cos(a * D), s = Math.sin(a * D), P = (r, o, y) => [c * r - s * o, y, s * r + c * o];
      tiers.forEach(([w, y0, y1, step], t) => {
        wing(b, 'awCream', a, 22, len, w, y0, y1, { win: false }); wing(b, 'awBlue', a, 20, len + 3, w + 5, y1, y1 + 2.6, { win: false });
        const n = Math.floor((len - 28) / step), ya = t ? y0 + 1.2 : 0.4, yb = y1 - 1.4;
        for (let i = 0; i < n; i++) { const r = 28 + step * (i + 0.5), hw = step * 0.3; for (const sd of [-1, 1]) { const o = sd * (w / 2 + 0.25); face(b, 'dark', [P(r - hw, o, ya), P(r + hw, o, ya), P(r + hw, o, yb), P(r - hw, o, yb)], P(r, o * 3, (ya + yb) / 2)); } }
      });
    };
    wingOf(-96, 150); wingOf(110, 200);
    b.cyl('awCream', 0, -20, 0, 28, 28, 40, 16, { win: [24, 2], glow: 0.7 }); b.cyl('awGold', 0, 20, 0, 29.4, 29.4, 1.8, 16, { lit: 0.4 });
    b.lathe('awBlue', 0, 0, [[30, 21.8], [28.5, 26], [22.5, 31.5], [12, 35], [0, 36]], 16, { cap: false }); b.cyl('awGold', 0, 35.6, 0, 2.2, 0.6, 4, 6);
    b.box('awCream', -40, -20, 22, 16, 16, 30); b.frustum('awGold', -40, 10, 22, 13, 13, 0.8, 0.8, 66, { lit: 0.3 }); b.light([-40, 78, 22], 'gold', 1.4);
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

  // San Jose City Hall, 85 m: Richard Meier's white tower and, in front of it, the glass rotunda: a tall glass drum under a glass dome traced by white ribs
  add({ id: 'sjcityhall', lon: -121.8853, lat: 37.3377, ex: 3.5, ry: 0, label: 'San Jose City Hall' }, b => {
    b.box('stone', 0, -20, 20, 110, 70, 20.4);
    b.box('white', 0, -20, -25, 62, 20, 105, { win: [14, 18] }); b.box('white', 0, 85, -25, 64, 22, 1.2);
    const rx = -12, rz = 24, r = 19, prof = [[r, 25.6], [r * 0.94, 31.5], [r * 0.77, 37.5], [r * 0.5, 42.2], [r * 0.2, 44.6], [0, 45.2]];
    b.cyl('awDomeGlass', rx, -20, rz, r, r, 44, 16, { win: [16, 4], glow: 1.3 }); b.cyl('white', rx, 24, rz, r + 0.9, r + 0.9, 1.8, 16);
    b.lathe('awDomeGlass', rx, rz, prof, 16, { cap: false, lit: 0.5 });
    for (let k = 0; k < 8; k++) { const a = (k * 45 + 22.5) * D; b.tube('white', prof.map(([pr, y]) => [rx + Math.cos(a) * (pr + 0.4), y + 0.3, rz + Math.sin(a) * (pr + 0.4)]), 0.75, 3); }
    for (let k = 0; k < 12; k++) { const a = k * 30 * D; b.box('white', rx + Math.cos(a) * (r + 0.3), -20, rz + Math.sin(a) * (r + 0.3), 1.3, 1.3, 44, { ry: -k * 30 }); }
    b.box('white', 32, -20, 24, 30, 26, 34, { win: [6, 2], glow: 0.8 });
    b.light([rx, 32, rz], 'cool', 1.6);
  });

  // the Oakland Coliseum and the Arena: the oval bowl of seats round a bright green field and its baseball diamond, the tall Mount Davis
  // stand at the east end, light towers round the rim, and beside it the round glass arena under its white roof
  add({ id: 'coliseum', lon: -122.2006, lat: 37.7516, ex: 2.0, ry: 0, label: 'Oakland Coliseum and Arena' }, (b, e) => {
    b.loft('awField', [b.circ(0, -2, 0, 63, 20, 0, 83), b.circ(0, 1.2, 0, 63, 20, 0, 83)]);
    b.box('ochre', -28, -1, 0, 30, 30, 2.6, { ry: 45 }); b.box('awField', -28, -1, 0, 19, 19, 2.8, { ry: 45 });
    const n = 30, I = b.circ(0, 3, 0, 62, n, 0, 82), O = b.circ(0, 0, 0, 108, n, 0, 124), top = p => 26 + 20 * Math.max(0, p[0] / 108 - 0.35) / 0.65;
    for (let j = 0; j < n; j++) {
      const k = (j + 1) % n, i0 = I[j], i1 = I[k], o0 = [O[j][0], top(O[j]), O[j][2]], o1 = [O[k][0], top(O[k]), O[k][2]];
      face(b, 'awSeatG', [i0, i1, o1, o0], [0, 300, 0]);
      face(b, 'concrete', [o0, o1, [o1[0], -10, o1[2]], [o0[0], -10, o0[2]]], [O[j][0] * 3, 0, O[j][2] * 3]);
    }
    for (let k = 0; k < 6; k++) {
      const a = (k * 60 + 30) * D, x = Math.cos(a) * 112, z = Math.sin(a) * 128, h = top([x]) + 34;
      b.rod('metal', [x, -10, z], [x, h, z], 1.6, 1, 5); b.box('lamp', x, h, z, 12, 2.5, 6, { ry: -(k * 60 + 30 + 90), lit: 1 }); b.light([x, h + 3, z], 'white', 0.9);
    }
    const [ax, az] = at(e, -122.2033, 37.7503);
    b.cyl('glass', ax, -20, az, 54, 54, 44, 18, { win: [24, 3], glow: 1.1 });
    for (let k = 0; k < 12; k++) { const a = k * 30 * D; b.box('white', ax + Math.cos(a) * 54.6, -20, az + Math.sin(a) * 54.6, 2.4, 2.4, 44, { ry: -k * 30 }); }
    b.cyl('white', ax, 24, az, 58, 58, 2.6, 18); b.lathe('white', ax, az, [[58, 26.6], [51, 30], [34, 33.5], [0, 35]], 18, { cap: false });
  });

  // Muir Woods: a grove of coast redwoods, 60 to 80 m tall, rust trunks under narrow dark crowns
  add({ id: 'muirwoods', lon: -122.5800, lat: 37.8985, ex: 2.2, ry: 0, label: 'Muir Woods' }, b => {
    let s = 7; const R = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < 24; i++) { const a = R() * Math.PI * 2, d = Math.sqrt(R()) * 72, x = Math.cos(a) * d * 1.4, z = Math.sin(a) * d, h = 52 + R() * 28; b.cyl('awWood', x, -12, z, 2.6, 1.3, h * 0.5 + 12, 5); b.cyl('awTree', x, h * 0.26, z, 7.5 + h * 0.04, 0, h * 0.74, 6); }
  });

  // the Ford Assembly Building, Richmond: Albert Kahn's long factory under a sawtooth roof (its glass faces north, a dark line marks each
  // ridge from the south), and the tall glass Craneway hall framed in white on its pier at the water's end
  add({ id: 'fordcraneway', lon: -122.3647, lat: 37.9105, ex: 2.0, ry: 0, label: 'Ford Assembly Building' }, b => {
    b.box('concreteLight', 0, -20, -92, 110, 190, 34, { win: [24, 2], glow: 0.7 });
    for (let k = 0; k < 10; k++) {
      const z0 = -187 + k * 19, z1 = z0 + 19;
      face(b, 'awSky', [[-55, 14, z0], [55, 14, z0], [55, 26, z0], [-55, 26, z0]], [0, 18, z0 - 50], { lit: 0.5 });
      face(b, 'dark', [[-55, 26, z0], [55, 26, z0], [55, 24.4, z0 + 2.6], [-55, 24.4, z0 + 2.6]], [0, 80, z0 + 20]);
      face(b, 'roof', [[-55, 24.4, z0 + 2.6], [55, 24.4, z0 + 2.6], [55, 14, z1], [-55, 14, z1]], [0, 80, z0 + 20]);
      for (const sx of [-55, 55]) face(b, 'concreteLight', [[sx, 14, z0], [sx, 26, z0], [sx, 14, z1]], [sx * 3, 16, z0 + 6]);
    }
    b.box('awSky', 0, -20, 24, 110, 44, 48, { win: [22, 5], glow: 1.3 });
    for (let i = 0; i <= 10; i++) face(b, 'white', [[-55 + i * 11 - 0.8, 0, 46.3], [-55 + i * 11 + 0.8, 0, 46.3], [-55 + i * 11 + 0.8, 28, 46.3], [-55 + i * 11 - 0.8, 28, 46.3]], [-55 + i * 11, 10, 60]);
    for (const sx of [-1, 1]) for (let i = 0; i <= 4; i++) face(b, 'white', [[sx * 55.3, 0, 2 + i * 11 - 0.8], [sx * 55.3, 0, 2 + i * 11 + 0.8], [sx * 55.3, 28, 2 + i * 11 + 0.8], [sx * 55.3, 28, 2 + i * 11 - 0.8]], [sx * 70, 10, 2 + i * 11]);
    b.box('white', 0, 28, 24, 113, 47, 1.8); b.box('awSky', 0, 29.8, 24, 100, 12, 6, { lit: 0.4 }); b.box('white', 0, 35.8, 24, 102, 14, 1.2);
    b.box('concrete', 0, -20, 60, 116, 26, 21);
    b.light([0, 20, 50], 'warm', 1.4); b.light([0, 30, -92], 'cool', 1.2);
  });
})();
