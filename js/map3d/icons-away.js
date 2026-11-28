// More 3D landmarks for the 3D map (beta): the rest of the Bay (Las Vegas is js/map3d/icons-lv2.js). Each entry is pushed onto window.M3D.extra and taken up by js/map3d/models.js.
(() => {
  const X = window.M3D.extra = window.M3D.extra || [];
  // the true sizes (js/map3d.js lmTrue; the list and its rule are in icons-sf.js): js/map3d/models.js's own Strip models, and where a model here is not its real size times ex
  const V = window.M3D.hx(), RD = Math.sqrt(V);   // (V: how many times its real height everything built is drawn, js/map3d/land.js HX; a round or steep one keeps its shape: drawn as a whole RD times its true size)
  window.M3D.lmTrue = Object.assign(window.M3D.lmTrue || {}, {
    sphere: [RD / 2.6, RD / 2.6], // Sphere: 112 m tall, 157 m across, round
    // the Strip's three below stand among towers drawn V times as tall (js/map3d/icons-lv2.js): each is drawn tall enough to keep its real
    // place among them (taller than Paris' hotel, than Harrah's, than the Luxor's own towers), its plan kept to its real ground
    eiffel: [RD / 4.2, V / 4.2], // the Eiffel Tower at Paris Las Vegas: 165 m, half the real one, its legs 62 m apart: drawn RD times in plan, its heights V times as the towers round it
    highroller: [Math.max(RD, 0.8 * V) / 3.8, Math.max(RD, 0.8 * V) / 3.8], // High Roller: 168 m, a wheel: its shape kept, drawn RD times its size as a round one is, and never under 0.8 V times (it stays taller than Harrah's 109 m, drawn V times)
    strat: 1 / 2.6,         // The STRAT: 350 m
    luxor: [1 / 3, 0.84 * V / 3], // Luxor: 107 m on a 183 m base, a pyramid: its true base (its towers stand 4 m off it), 0.84 V times its height (above its 80 m towers, drawn V times): steeper than the real 51 degrees
    muirwoods: [1, 1],      // Muir Woods: a few redwoods stand for a forest 2 km long: it keeps its size
  });
  const D = Math.PI / 180, CELL = 1 / 8;
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const MATS = { // new colours: [paper, night]
    awGold: ['#d8b56c', '#8d7443'], awPatina: ['#93b9a8', '#4c6b62'], awBrick: ['#bf7d62', '#71493c'], awBlue: ['#86a6c8', '#465f7c'],
    awGreen: ['#b4cc98', '#4a6340'], awTree: ['#7d9f72', '#33503a'], awWood: ['#8c6a50', '#45352a'], awSpray: ['#f2f8fa', '#d6ecff'],
    awCream: ['#f0e3c2', '#7d735c'], awRoofRed: ['#ad6653', '#5c372e'], awArena: ['#bba283', '#6b5a47'], awTrunk: ['#a3907a', '#51473c'], awSeat: ['#7f9e86', '#3a5444'],
    awDomeGlass: ['#86b0cc', '#5c9fd2'], awField: ['#a2c77f', '#40683a'], awSeatG: ['#6c8c7a', '#2e4a3d'], awSky: ['#bcd8ea', '#7cc0ee'],
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
  const pond = (b, mat, x, z, rx, rz, n = 16, top = 1.2) => b.loft(mat, [b.circ(x, -1.5, z, rx, n, 0, rz), b.circ(x, top, z, rx, n, 0, rz)]);

  // (Las Vegas: js/map3d/icons-lv2.js)

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
