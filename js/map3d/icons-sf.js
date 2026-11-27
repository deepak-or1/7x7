// More 3D landmarks for the 3D map (beta): San Francisco. Each entry is pushed onto window.M3D.extra and taken up by js/map3d/models.js.
(() => {
  const X = window.M3D.extra = window.M3D.extra || [];
  // Each landmark at its true size close in (js/map3d.js lmTrue): the factor that takes a model as built (its real size times its ex) to its
  // real plan, its heights then drawn as the real buildings' are; [plan, heights] where a model is not its real size times ex. A model of
  // this file or icons-away.js left out of the list is built to its real size, checked against the real dimensions: 1 / ex. The real sizes:
  // the first 13 are js/map3d/models.js's own models (their ex is in its list PLACED). A round one (a dome, a wheel, a sphere) would turn into
  // an egg if its heights alone were drawn 2.5 times: it keeps its shape, drawn as a whole sqrt(2.5) = 1.58 times its true size (RD)
  const RD = Math.sqrt(2.5);
  window.M3D.lmTrue = Object.assign(window.M3D.lmTrue || {}, {
    pyramid: 1 / 2.5,       // Transamerica Pyramid: 260 m to its spire, 53 m at the base
    salesforce: 1 / 2.5,    // Salesforce Tower: 326 m
    coit: 1 / 5.2,          // Coit Tower: 64 m, 11 m across the shaft
    sutro: 1 / 2.6,         // Sutro Tower: 298 m
    ferry: 1 / 3.4,         // Ferry Building: 200 m long, the clock tower 75 m
    alcatraz: [1, 1],       // the island is a block of the map at its own real size: the cell house and lighthouse on it stay as drawn
    ladies: 1 / 6.5,        // Painted Ladies: seven houses 7.6 m wide, about 13 m to the ridge, 53 m in all
    palace: [RD / 5.5, RD / 5.5], // Palace of Fine Arts: the rotunda 49 m, round: its shape kept (the model's colonnades run shorter than the real 300 m arc)
    pier39: [0.93, 0.76],   // Pier 39: the model is the head of the pier; the real one is 300 m long, its buildings two storeys
    teagarden: [0.6, 0.54], // Japanese Tea Garden: the model gathers its gate and pagoda (15 m) on 50 m; the real garden is 140 m across
    bison: [0.9, 0.62],     // Bison Paddock: about 300 m long in life, the model's 82 m paddock drawn four times
    windmill: [RD / 5.5, RD / 5.5], // Dutch Windmill: the tower 23 m, its sails a circle 31 m across: its shape kept
  });
  // where a model stands when landmarks are at their true size (?m3d-scale=true, the default), where that is not where it stands as drawn
  // large: the Palace of Fine Arts as built stands south of the rotunda, over its lagoon; at true size it would stand off its own place, beside
  // the real rotunda's outline (js/map3d/real.js), so it stands on the rotunda (OpenStreetMap)
  window.M3D.lmAt = Object.assign(window.M3D.lmAt || {}, { palace: [-122.44836, 37.80292] });
  const D2R = Math.PI / 180, lerp = (a, b, t) => a + (b - a) * t;
  // the colours this file adds: [paper, night]
  const M = {
    sfGold: ['#d6b25c', '#a3833f'], sfDome: ['#c2cbc6', '#56626e'], sfLawn: ['#aac190', '#3d5142'], sfTurf: ['#90b27b', '#3a5a3e'], sfSeat: ['#5f7a74', '#28383b'],
    sfHedge: ['#8aa877', '#33483a'], sfTree: ['#7d9a6c', '#2e4034'], sfJade: ['#78a891', '#3e5e53'], sfMaroon: ['#9b4b44', '#5c3030'], sfCopper: ['#a28b6b', '#55493a'],
    sfPatina: ['#8db3a0', '#46645a'], sfGranite: ['#715b58', '#372e31'], sfRose: ['#5e6c82', '#e2aa6a'], sfWood: ['#b9a385', '#584b3d'], sfSign: ['#f3ecda', '#ffe2a8'],
    sfStucco: ['#e3cfb2', '#5e564b'], sfRock: ['#8e7c6b', '#3d3732'],
    ttLawn: ['#b3c692', '#40574a'], ttMeadow: ['#cbc893', '#4f5946'], ttPath: ['#f0e6d0', '#7a7362'], ttTile: ['#c9705a', '#7c4a40'],
    sfR1: ['#d9614f', '#b4473b'], sfR2: ['#e8964f', '#c27639'], sfR3: ['#ecd06a', '#c6ac4e'], sfR4: ['#79b071', '#548c55'], sfR5: ['#5f8fc4', '#40699c'], sfR6: ['#8c6fb3', '#674f8c'],
  };
  const mats = (...names) => Object.fromEntries(names.map(n => [n, M[n]]));
  // a gabled roof along x (ridge h above the eaves at y, half-width hw), and one along z
  const gableX = (b, m, x0, x1, y, z, hw, h) => b.loft(m, [[[x0, y, z - hw], [x0, y, z + hw], [x0, y + h, z]], [[x1, y, z - hw], [x1, y, z + hw], [x1, y + h, z]]], { flat: true, cap0: true });
  const gableZ = (b, m, z0, z1, y, x, hw, h) => b.loft(m, [[[x - hw, y, z0], [x + hw, y, z0], [x, y + h, z0]], [[x - hw, y, z1], [x + hw, y, z1], [x, y + h, z1]]], { flat: true, cap0: true });
  // a rounded rectangle (superellipse) in plan, half sizes rx by rz
  const se = (x, y, z, rx, rz, n, e = 4) => Array.from({ length: n }, (_, j) => { const a = j / n * Math.PI * 2 + Math.PI / n, c = Math.cos(a), s = Math.sin(a), k = Math.pow(Math.pow(Math.abs(c), e) + Math.pow(Math.abs(s), e), -1 / e); return [x + c * k * rx, y, z + s * k * rz]; });
  // a lathe about any axis from p towards q: prof [[radius, metres along the axis], ...]
  function axial(b, m, p, q, prof, n, o) {
    const d = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], L = Math.hypot(d[0], d[1], d[2]), u = d.map(v => v / L), [s, w] = b.frameOf(d);
    b.loft(m, prof.map(([r, t]) => Array.from({ length: n }, (_, j) => { const a = j / n * Math.PI * 2, c = Math.cos(a) * r, si = Math.sin(a) * r; return [0, 1, 2].map(k => p[k] + u[k] * t + s[k] * c + w[k] * si); })), o || {});
  }
  // a thin sheet through rows of points (both faces), t thick, straight down
  const sheet = (b, m, G, t, o) => b.loft(m, G.map(row => [...row, ...row.slice().reverse().map(p => [p[0], p[1] - t, p[2]])]), Object.assign({ flat: true, cap: false }, o));
  // a round tree crown on a short trunk
  const tree = (b, x, z, r, h, y0 = 0, m = 'sfTree') => b.lathe(m, x, z, [[0.3, y0], [r * 0.8, y0 + h * 0.3], [r, y0 + h * 0.6], [r * 0.6, y0 + h * 0.9], [0, y0 + h]], 6, { cap: false });
  const lawn = (b, m, x, z, rx, rz, n = 14) => b.loft(m, [se(x, -1, z, rx, rz, n, 2.4), se(x, 0.5, z, rx, rz, n, 2.4)]);
  // a flat one-sided panel through a ring of points (a fan from its middle), turned to face n
  const panel = (b, m, pts, n, o) => {
    const c = [0, 1, 2].map(k => pts.reduce((s, p) => s + p[k], 0) / pts.length); let d = 0;
    pts.forEach((p, j) => { const q = pts[(j + 1) % pts.length], u = [0, 1, 2].map(k => p[k] - c[k]), v = [0, 1, 2].map(k => q[k] - c[k]); d += (u[1] * v[2] - u[2] * v[1]) * n[0] + (u[2] * v[0] - u[0] * v[2]) * n[1] + (u[0] * v[1] - u[1] * v[0]) * n[2]; });
    const r = d < 0 ? pts.slice().reverse() : pts; b.loft(m, [r, r], o || {});
  };
  // an upright arch outline through (x, z) along (ax, az): straight sides from y0 to y1 and a half circle of radius r on top (y0 = y1: the half circle only)
  const archP = (x, z, ax, az, y0, y1, r, n = 6) => [...(y1 > y0 ? [[x - ax * r, y0, z - az * r], [x + ax * r, y0, z + az * r]] : []), ...Array.from({ length: n + 1 }, (_, i) => { const a = i / n * Math.PI, c = Math.cos(a) * r; return [x + ax * c, y1 + Math.sin(a) * r, z + az * c]; })];
  // an upright rectangle centred on (x, y, z), w wide along (ax, az) and h tall
  const vrect = (x, y, z, ax, az, w, h) => [[x - ax * w / 2, y - h / 2, z - az * w / 2], [x + ax * w / 2, y - h / 2, z + az * w / 2], [x + ax * w / 2, y + h / 2, z + az * w / 2], [x - ax * w / 2, y + h / 2, z - az * w / 2]];

  // ---------- Golden Gate Park and the ocean edge ----------
  X.push({ id: 'windmill', lon: -122.5085, lat: 37.7707, ex: 5.5, ry: 45, label: 'Dutch Windmill', mats: mats('sfLawn'),
    // the Dutch Windmill, 23 m tower and 31 m sails: a tapering octagonal smock tower on a brick base, a dark cap, four white sails turned to the sea
    build(b) {
      lawn(b, 'sfLawn', 0, 0, 16, 16);
      b.cyl('rust', 0, -20, 0, 8.6, 8.2, 25, 8, { flat: true });
      b.cyl('stone', 0, 5, 0, 7.4, 4.6, 16, 8, { flat: true, win: [8, 2], glow: 0.5 });
      b.lathe('roof', 0, 0, [[5.4, 21], [5.2, 23], [3.6, 25.4], [0, 26.4]], 8, { cap: false });
      const hub = [-6.2, 23.2, 0]; b.rod('dark', [-4.2, 23.2, 0], hub, 0.9, 0.9, 6);
      for (let k = 0; k < 4; k++) {
        const a = Math.PI / 4 + k * Math.PI / 2, dy = Math.sin(a), dz = Math.cos(a), P = (r, o) => [hub[0] - 0.3, hub[1] + dy * r + dz * o, hub[2] + dz * r - dy * o];
        b.beam('dark', hub, P(15.6, 0), 0.5, 0.7);
        b.beam('trim', P(3.4, 1.8), P(15.4, 1.8), 0.3, 3.4);
      }
      b.light([-6.6, 23.2, 0], 'warm', 1.2);
    } });

  X.push({ id: 'conservatory', lon: -122.4603, lat: 37.7725, ex: 4.2, ry: 0, label: 'Conservatory of Flowers', mats: mats('sfLawn', 'sfHedge'),
    // the Conservatory of Flowers, 18 m: a white Victorian glasshouse, the domed central pavilion with its cupola, two long wings ending in pavilions, the flower beds in front
    build(b) {
      b.box('stone', 0, -20, 0, 84, 24, 21);
      b.lathe('white', 0, 0, [[11.5, 1], [11.5, 8.5]], 16, { cap: false, win: [16, 2], glow: 0.8 });
      b.lathe('white', 0, 0, [[12.2, 8.5], [12.2, 9.4], [11, 9.6], [10.4, 12.5], [8.6, 15.4], [5.6, 17.6], [2.6, 18.6]], 16, { cap: false });
      b.cyl('white', 0, 18.5, 0, 2.6, 2.3, 2.4, 8, { win: [8, 1], glow: 1 });
      b.lathe('white', 0, 0, [[2.8, 20.9], [1.6, 22], [0.2, 22.8]], 8, { cap: false });
      b.rod('metal', [0, 22.6, 0], [0, 25, 0], 0.25, 0.1, 4);
      for (const s of [-1, 1]) {
        b.box('white', s * 23, 1, 0, 23, 10, 6, { win: [7, 1], glow: 0.8 });
        const arc = x => Array.from({ length: 7 }, (_, j) => { const a = j / 6 * Math.PI; return [x, 7 + Math.sin(a) * 3.6, Math.cos(a) * 5]; });
        b.loft('glassRoof', [arc(s * 11.5), arc(s * 34.5)], { flat: true, cap0: true });
        b.box('white', s * 38, 1, 0, 9, 14, 7.5, { win: [3, 1], glow: 0.8 });
        b.frustum('glassRoof', s * 38, 8.5, 0, 9.6, 14.6, 3, 7, 4.2);
      }
      b.box('white', 0, 1, 13, 7, 5, 6.5); gableZ(b, 'white', 10.5, 15.8, 7.5, 0, 3.8, 2.4);
      b.box('sfLawn', 0, -20, 31, 70, 20, 21.2);
      b.box('dome', -14, 1, 30, 20, 2.6, 0.5); b.box('sfR3', 14, 1, 30, 20, 2.6, 0.5); b.box('sfHedge', 0, 1, 30, 3, 10, 0.7);
    } });

  X.push({ id: 'cliffhouse', lon: -122.5138, lat: 37.7784, ex: 3.4, ry: 0, label: 'Cliff House & Sutro Baths', mats: mats('sfRock'),
    // the Cliff House and the Sutro Baths: the white 1909 Cliff House with its glass wing on the edge of a rock headland above the ocean, the little Camera Obscura on the terrace below it, the rectangular pool foundations of the ruined baths at the foot of the cliff to the north and Seal Rocks offshore (the block top is about 83 m above the water here)
    build(b) {
      const W = -83; // the water, in model metres below the block top
      const head = [[-27, -42], [-12, -44], [0, -30], [6, -10], [4, 10], [-6, 22], [-16, 24], [-24, 14], [-28, 0], [-30, -22]];
      b.loft('sfRock', [[W - 15, 1.28], [W + 30, 1.12], [-12, 1.02], [-1.5, 0.94]].map(([y, k], i) => head.map(([x, z], j) => [-14 + (x + 14) * k + ((j * 7 + i * 3) % 5 - 2) * 0.9, y, z * k + ((j * 3 + i) % 3 - 1) * 0.8])), { flat: true });
      b.box('white', -2, -20, -4, 24, 24, 31, { win: [6, 2], glow: 1 });
      b.box('whiteShade', -2, 11, -4, 25.4, 25.4, 1.1);
      b.box('white', -3, 12.1, -4, 15, 13, 2.6, { win: [5, 1], glow: 0.8 });
      b.box('glass', 17, -20, -3, 14, 22, 28, { win: [4, 2], glow: 1.1 }); b.box('concreteLight', 17, 8, -3, 15, 23, 1);
      b.box('concreteLight', -21, -8, -4, 8, 24, 7.6);
      b.box('stone', -23, -6, 11, 6, 6, 9.5); b.frustum('dark', -23, 3.5, 11, 3.4, 3.4, 1.8, 1.8, 2.4); b.rod('dark', [-23, 5.2, 11], [-25.6, 5.9, 11], 0.8, 0.8, 6); // the Camera Obscura
      // the baths: a rock shelf at the foot of the cliff with three pools of seawater in their concrete walls
      const zb = -58, ledge = [[-62, -86], [-36, -88], [-20, -72], [-18, -44], [-28, -31], [-52, -29], [-66, -46]];
      b.loft('sfRock', [[W - 15, 1.12], [W + 12, 1]].map(([y, k], i) => ledge.map(([x, z], j) => [-40 + (x + 40) * k + ((j + i) % 3 - 1), y, zb + (z - zb) * k])), { flat: true });
      const yb = W + 12;
      for (const [x, z, w, d] of [[-46, -64, 22, 30], [-28, -64, 7, 30], [-42, -38, 26, 9]]) {
        b.box('lagoon', x, yb - 1, z, w, d, 1.5);
        b.box('concreteLight', x, yb - 1, z - d / 2 - 1, w + 4, 2, 2.6); b.box('concreteLight', x, yb - 1, z + d / 2 + 1, w + 4, 2, 2.6);
        b.box('concreteLight', x - w / 2 - 1, yb - 1, z, 2, d, 2.6); b.box('concreteLight', x + w / 2 + 1, yb - 1, z, 2, d, 2.6);
      }
      for (const [x, z, w] of [[-57, -50, 8], [-50, -79, 12]]) b.box('concrete', x, yb, z, w, 1.6, 6);
      for (const [x, z, r, h] of [[-82, -4, 6, W + 13], [-73, 10, 4.2, W + 9], [-90, 8, 3.6, W + 7]]) b.lathe('sfRock', x, z, [[r * 1.3, W - 15], [r, h - 6], [r * 0.6, h], [0, h + 1.6]], 6, { cap: false });
      b.light([-15, 6, -4], 'warm', 1.2);
    } });

  // ---------- Nob Hill, Civic Center, Japantown ----------
  X.push({ id: 'gracecathedral', lon: -122.413, lat: 37.7919, ex: 3.2, ry: 9, label: 'Grace Cathedral', mats: mats('sfRose'),
    // Grace Cathedral, towers 53 m: a long French Gothic nave and transept, the twin square towers of the east front with the rose window, a slim flèche over the crossing
    build(b) {
      b.box('stone', -4, -20, 0, 80, 16, 46, { win: [14, 1], glow: 0.9 });
      gableX(b, 'roof', -44, 38, 26, 0, 8.6, 9);
      for (const s of [-1, 1]) { b.box('stoneShade', -4, -20, s * 12, 76, 8, 34, { win: [14, 1], glow: 0.7 }); b.box('roof', -4, 14, s * 12, 76, 8.6, 1); }
      b.box('stone', -16, -20, 0, 16, 46, 46, { win: [3, 1], glow: 0.9 });
      gableZ(b, 'roof', -23.5, 23.5, 26, -16, 8.6, 9);
      b.cyl('stone', -44, -20, 0, 8, 8, 46, 8, { flat: true, win: [8, 1], glow: 0.9 }); b.lathe('roof', -44, 0, [[8.6, 26], [0, 34]], 8, { cap: false });
      b.box('roof', -16, 30, 0, 5.5, 5.5, 7); b.frustum('roof', -16, 37, 0, 5, 5, 0.3, 0.3, 30);
      for (const s of [-1, 1]) {
        b.box('stone', 42, -20, s * 10.5, 12, 12, 66);
        b.box('stoneShade', 42, 34, s * 10.5, 12.4, 12.4, 9, { win: [2, 1], glow: 1 });
        b.box('stone', 42, 46, s * 10.5, 12.8, 12.8, 1.5);
        for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) b.cyl('stone', 42 + dx * 5.6, 47.5, s * 10.5 + dz * 5.6, 0.9, 0.1, 5.5, 4);
      }
      b.box('stone', 42, -20, 0, 10, 9.5, 51); gableX(b, 'stone', 37, 47, 31, 0, 4.8, 6);
      b.rod('sfRose', [46.8, 21, 0], [48, 21, 0], 4, 4, 12, { lit: 1.1 });
      b.light([49, 21, 0], 'warm', 1.4);
    } });

  X.push({ id: 'cityhall', lon: -122.4193, lat: 37.7793, ex: 2.9, ry: 9, label: 'City Hall', mats: mats('sfGold', 'sfDome'),
    // San Francisco City Hall, 94 m: a long Beaux-Arts block with corner pavilions and columned porticos east and west, the colonnaded drum and the tall dome with gilded ribs and lantern
    build(b) {
      b.box('stone', 0, -20, 0, 80, 118, 43, { win: [16, 4], glow: 0.6 });
      b.box('stoneShade', 0, 23, 0, 70, 108, 2.5);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.box('stone', sx * 33, -20, sz * 52, 17, 17, 47, { win: [3, 4], glow: 0.6 });
      for (const s of [-1, 1]) {
        b.box('stoneShade', s * 44, -20, 0, 8, 42, 23.5);
        for (let i = 0; i < 6; i++) b.cyl('white', s * 45.5, 3.5, -17.5 + i * 7, 1.3, 1.2, 18, 5);
        b.box('stone', s * 44, 21.5, 0, 7, 42, 3);
        b.loft('stone', [[[s * 40.5, 24.5, -21], [s * 40.5, 24.5, 21], [s * 40.5, 31, 0]], [[s * 47.5, 24.5, -21], [s * 47.5, 24.5, 21], [s * 47.5, 31, 0]]], { flat: true, cap0: true });
      }
      b.cyl('stone', 0, 23, 0, 23, 23, 7, 16);
      b.cyl('stoneShade', 0, 30, 0, 17.5, 17.5, 15, 16, { win: [16, 1], glow: 1 });
      for (let i = 0; i < 12; i++) { const a = (i + 0.5) / 12 * Math.PI * 2; b.cyl('white', Math.cos(a) * 19.5, 30, Math.sin(a) * 19.5, 1, 0.95, 15, 5); }
      b.cyl('stone', 0, 45, 0, 21, 21, 3, 16);
      b.cyl('stone', 0, 48, 0, 18.5, 18, 4.5, 16);
      const dome = [[17.2, 52.5], [16.6, 57.5], [14.8, 63], [11.6, 68], [7, 72], [3.7, 73.6]];
      b.lathe('sfDome', 0, 0, dome, 16, { cap: false });
      for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2; b.tube('sfGold', dome.map(([r, y]) => [Math.cos(a) * (r + 0.3), y, Math.sin(a) * (r + 0.3)]), 0.55, 3); }
      b.cyl('stone', 0, 73.6, 0, 3.8, 3.6, 6.5, 8, { win: [8, 1], glow: 1.2 });
      b.lathe('sfGold', 0, 0, [[4.2, 80.1], [3, 82.5], [1, 84.5], [0.6, 85.5]], 8, { cap: false });
      b.rod('sfGold', [0, 85.3, 0], [0, 94, 0], 0.55, 0.15, 5);
      for (let i = 0; i < 4; i++) { const a = (i + 0.5) / 4 * Math.PI * 2; b.light([Math.cos(a) * 24, 50, Math.sin(a) * 24], 'gold', 2.2); }
      b.light([0, 80, 0], 'gold', 1.6);
    } });

  X.push({ id: 'peacepagoda', lon: -122.4300, lat: 37.7852, ex: 4.6, ry: 9, label: 'Peace Pagoda',
    // the Peace Pagoda, Japantown, 30 m: five concrete tiers under wide dark roofs and a bronze spire, on the paved Peace Plaza
    build(b) {
      b.box('concreteLight', 0, -20, 0, 34, 30, 20.6);
      b.box('concreteLight', 0, 0.6, 0, 11, 11, 1.6);
      for (let i = 0; i < 5; i++) {
        const s = 7.4 - i * 0.85, y = 2.2 + i * 4.9;
        b.box('white', 0, y, 0, s, s, 3.2, { win: [2, 1], glow: 0.6 });
        b.frustum('dark', 0, y + 3.2, 0, s + 5.2, s + 5.2, s * 0.7, s * 0.7, 1.7);
      }
      b.cyl('bronze', 0, 26.4, 0, 0.9, 0.7, 1.4, 6);
      b.rod('bronze', [0, 27.8, 0], [0, 33, 0], 0.45, 0.2, 5);
      for (const y of [28.8, 30, 31.2]) b.cyl('bronze', 0, y, 0, 1, 1, 0.35, 6);
      b.light([0, 33.5, 0], 'warm', 0.8);
    } });

  X.push({ id: 'stmarys', lon: -122.4256, lat: 37.7845, ex: 2.6, ry: 9, label: 'Cathedral of Saint Mary', mats: mats('sfRose'),
    // the Cathedral of Saint Mary of the Assumption, 58 m and a 16 m cross: eight white hyperbolic-paraboloid shells whose sections run from a square at the base to a cross at the top, a stained-glass strip up the middle of each face
    build(b) {
      b.box('concreteLight', 0, -20, 0, 84, 84, 21.5);
      b.box('glass', 0, 1.5, 0, 77, 77, 7, { win: [16, 1], glow: 0.9 });
      const S = 38.5, a = 30, e = 2.6, y0 = 8.5, y1 = 58;
      const base = [], top = [];
      for (let k = 0; k < 4; k++) {
        const c = Math.cos(k * Math.PI / 2), s = Math.sin(k * Math.PI / 2), R = ([x, z]) => [x * c - z * s, z * c + x * s];
        for (const [bp, tp] of [[[S, 0], [a, 0]], [[S, S / 2], [(a + e) / 2, e / 2]], [[S, S], [e, e]], [[S / 2, S], [e / 2, (a + e) / 2]]]) { base.push(R(bp)); top.push(R(tp)); }
      }
      const rings = [0, 0.25, 0.5, 0.72, 0.88, 1].map(t => base.map((p, i) => [lerp(p[0], top[i][0], t), lerp(y0, y1, t), lerp(p[1], top[i][1], t)]));
      b.loft('white', rings, { flat: true });
      for (let k = 0; k < 4; k++) { const c = Math.round(Math.cos(k * Math.PI / 2)), s = Math.round(Math.sin(k * Math.PI / 2)); b.beam('sfRose', [c * (S + 0.4), y0, s * (S + 0.4)], [c * (a + 0.5), y1 + 0.4, s * (a + 0.5)], 2.4, 0.8, { lit: 0.9 }); }
      b.box('metal', 0, y1, 0, 1.4, 1.4, 16); b.box('metal', 0, y1 + 10, 0, 7, 1.2, 1.2);
    } });

  // ---------- Russian Hill, the waterfront ----------
  X.push({ id: 'lombard', lon: -122.4187, lat: 37.8021, ex: 2.6, ry: 9, label: 'Lombard Street', mats: mats('sfHedge'),
    // the crooked block of Lombard Street, 180 m: the red brick road in eight hairpins down a planted slope from Hyde to Leavenworth, low houses either side
    build(b) {
      const y = x => x < -88 ? 24 : 24 * (88 - x) / 176;
      const sec = (x, w) => [[x, -20, -w], [x, -20, w], [x, y(x), w], [x, y(x), -w]];
      b.loft('sfHedge', [sec(-104, 19), sec(-88, 19), sec(92, 19)], { flat: true, cap0: true });
      const pts = [[-104, 0]]; for (let i = 0; i <= 8; i++) pts.push([-88 + i * 22, i === 0 || i === 8 ? 0 : i % 2 ? -11 : 11]); pts.push([104, 0]);
      const P = ([x, z]) => [x, Math.max(0, y(Math.min(x, 88))) + 0.6, z];
      for (let i = 0; i < pts.length - 1; i++) b.beam('rust', P(pts[i]), P(pts[i + 1]), 6, 1.4);
      for (let i = 1; i < pts.length - 1; i++) { const p = P(pts[i]); b.cyl('rust', p[0], p[1] - 1.2, p[2], 3.3, 3.3, 1.9, 8); }
      const cols = ['p4', 'white', 'p0', 'p1', 'whiteShade', 'p2'];
      for (const s of [-1, 1]) for (let i = 0; i < 6; i++) { const x = -86 + i * 34, h = 7 + ((i * 7 + (s > 0 ? 3 : 0)) % 4) * 1.2; b.box(cols[(i + (s > 0 ? 2 : 0)) % 6], x, -20, s * 27, 22, 12, y(Math.min(x, 88)) + 20 + h, { win: [4, 2], glow: 0.8 }); }
    } });

  X.push({ id: 'ghirardelli', lon: -122.4229, lat: 37.8058, ex: 3.4, ry: 9, label: 'Ghirardelli Square', mats: mats('sfSign'),
    // Ghirardelli Square: the old brick chocolate works around a square, the clock tower, and the big lit GHIRARDELLI sign on the roof facing the bay
    build(b) {
      b.box('rust', 0, -20, 24, 76, 22, 36, { win: [12, 3], glow: 0.8 });
      for (const s of [-1, 1]) b.box('rust', s * 29, -20, -1, 18, 30, 31, { win: [3, 2], glow: 0.8 });
      b.box('rust', -4, -20, -24, 68, 16, 35, { win: [11, 3], glow: 0.8 });
      b.box('concreteLight', 0, -20, 0, 42, 30, 21.2);
      b.box('roof', 0, 16, 24, 74, 20, 1); b.box('roof', -4, 15, -24, 66, 14, 1);
      b.box('rust', 33, -20, -26, 10, 10, 54);
      for (const [dx, dz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) b.rod('clock', [33 + dx * 5, 28, -26 + dz * 5], [33 + dx * 5.5, 28, -26 + dz * 5.5], 2.6, 2.6, 10, { lit: 1.4 });
      b.frustum('roof', 33, 34, -26, 11, 11, 1, 1, 11);
      for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) b.cyl('roof', 33 + dx * 5, 34, -26 + dz * 5, 1.3, 0, 5, 5);
      b.box('dark', -4, 16, -30, 56, 1.2, 1);
      for (const x of [-30, -4, 22]) b.box('dark', x, 16, -30, 1, 1, 8);
      const L = 'GHIRARDELLI'; for (let i = 0; i < L.length; i++) b.box('sfSign', -4 + (i - 5) * 4.8, 17, -30.6, L[i] === 'I' ? 1.4 : 3.6, 0.8, 6.5, { lit: 1.5 });
      b.light([-4, 24, -32], 'warm', 2.2);
    } });

  X.push({ id: 'cablecar', lon: -122.4205, lat: 37.8065, ex: 6.5, ry: 9, label: 'Powell-Hyde cable car', mats: mats('sfMaroon'),
    // a Powell-Hyde cable car on the turntable at Hyde and Beach: maroon and cream, an open bench at each end, the closed cabin in the middle, a clerestory roof, the track running up Hyde
    build(b) {
      b.cyl('concrete', 0, -1, 0, 5.4, 5.4, 1.5, 16);
      for (const s of [-0.75, 0.75]) b.beam('metal', [s, 0.55, 5.4], [s, 0.55, 40], 0.3, 0.2);
      b.box('roadLight', 0, -1, 23, 6, 34, 1.45);
      b.box('dark', 0, 0.5, 0, 2.1, 7.4, 0.7);
      b.box('sfMaroon', 0, 1.2, 0, 2.5, 8.4, 1.1);
      b.box('trim', 0, 2.3, 0, 2.5, 4, 1.3, { win: [4, 1], glow: 1.1 });
      for (const zz of [-4, -2.4, 2.4, 4]) for (const xx of [-1.1, 1.1]) b.box('trim', xx, 2.3, zz, 0.25, 0.25, 1.3);
      b.box('sfMaroon', 0, 3.6, 0, 2.8, 8.8, 0.35);
      b.box('trim', 0, 3.95, 0, 1.3, 6.6, 0.45, { win: [6, 1], glow: 1 });
      b.light([0, 3, -4.4], 'warm', 0.6); b.light([0, 3, 4.4], 'warm', 0.6);
    } });

  X.push({ id: 'pier39', lon: -122.4064, lat: 37.8089, ex: 3.3, ry: 5, label: 'Pier 39', mats: mats('sfWood', 'sfR1', 'sfR3', 'sfR5'),
    // Pier 39: two rows of two-storey weathered-timber shops down the pier under brown shingle roofs, flags along the walk, the double-decker carousel near the end, the sea lions hauled out on the K-dock floats in the marina on the west side, the PIER 39 sign at the entrance
    build(b) {
      b.box('sfWood', -0.5, -20, 0, 17, 106, 20.8);
      b.box('lagoon', -6.6, 0.8, -28, 4.6, 46, 0.2);
      for (const z of [-46, -35, -24, -13]) {
        b.box('concrete', -6.6, 1, z, 3.6, 8, 0.4);
        for (const [dx, dz, a] of [[-0.6, -2.4, 0.4], [0.7, 0.2, -0.3], [-0.4, 2.6, 0.1]]) { const p = [-6.6 + dx, 1.9, z + dz]; b.rod('bronzeShade', [p[0] - 1.6 * Math.sin(a), p[1], p[2] - 1.6 * Math.cos(a)], [p[0] + 1.6 * Math.sin(a), p[1] + 0.9, p[2] + 1.6 * Math.cos(a)], 0.9, 0.5, 4); }
      }
      const shop = (x, z, w, l, h) => { b.box('sfWood', x, 0.8, z, w, l, h, { win: [Math.round(l / 3), 2], glow: 0.8 }); gableZ(b, 'bronze', z - l / 2 - 0.3, z + l / 2 + 0.3, h + 0.8, x, w / 2 + 0.5, 2.8); };
      for (const [z, l, h] of [[44, 13, 7.6], [29, 14, 8.4], [14, 13, 7.2], [1, 10, 7.8]]) shop(-4.6, z, 7.6, l, h);
      for (const [z, l, h] of [[-13, 12, 7.2], [-26, 9, 6.8]]) shop(-1.6, z, 3.6, l, h);
      for (const [z, l, h] of [[44, 13, 8], [30, 12, 7.4], [16, 13, 8.4], [2, 12, 7.6], [-12, 12, 7.8], [-25, 10, 7.2]]) shop(4.6, z, 5, l, h);
      // the carousel
      b.cyl('trim', 2, 0.8, -43, 4.8, 4.8, 3.6, 10, { win: [10, 1], glow: 1.3 }); b.lathe('red', 2, -43, [[5.6, 4.4], [3.4, 5.8]], 10, { cap: false });
      b.cyl('trim', 2, 5.6, -43, 3.4, 3.4, 2.4, 10, { win: [10, 1], glow: 1.3 }); b.lathe('red', 2, -43, [[4, 8], [1.2, 9.8], [0, 10.2]], 10, { cap: false });
      b.rod('sfR3', [2, 10, -43], [2, 11.6, -43], 0.35, 0.1, 4);
      b.light([2, 4, -43], 'gold', 1.6);
      // flags down the walk
      ['sfR1', 'sfR5', 'sfR3', 'sfR1', 'sfR5'].forEach((m, i) => { const z = 38 - i * 13; b.rod('dark', [1.3, 0.8, z], [1.3, 13, z], 0.16, 0.12, 4); for (const f of [-1, 1]) panel(b, m, vrect(2.6, 12.1, z + f * 0.03, 1, 0, 2.6, 1.6), [0, 0, f]); });
      // the PIER 39 sign over the entrance
      for (const x of [-3.6, 3.6]) b.box('dark', x, 0.8, 52, 0.5, 0.5, 9.6);
      b.box('sfR5', 0, 8.6, 52, 9.4, 0.6, 2.8);
      [-3.4, -2.3, -1.2, -0.1, 1.6, 2.9].forEach(x => panel(b, 'trim', vrect(x, 10, 52.32, 1, 0, 0.75, 1.8), [0, 0, 1], { lit: 0.9 }));
    } });

  X.push({ id: 'balclutha', lon: -122.4177, lat: 37.8100, ex: 2.6, ry: 45, label: 'Balclutha',
    // Balclutha, 1886, 92 m: a three-masted square-rigged ship, black hull with a white band, masts 44 m with their yards, moored in its slip (shown on the Pier 45 finger of the wharf block: Hyde Street Pier itself is open water in this map, hidden behind the Russian Hill block)
    build(b) {
      const zs = [40, 34, 20, 0, -20, -32, -40, -45], ws = [3.6, 5.2, 6, 6.1, 6, 4.8, 2.4, 0.3], ys = [6.5, 5.4, 5, 5, 5.1, 5.6, 6.4, 7.2];
      b.loft('dark', zs.map((z, i) => { const w = ws[i], y = ys[i]; return [[-w, y, z], [w, y, z], [w * 0.88, -1, z], [w * 0.45, -14, z], [-w * 0.45, -14, z], [-w * 0.88, -1, z]]; }), { flat: true, cap0: true });
      b.loft('white', zs.map((z, i) => { const w = ws[i] + 0.06, y = ys[i] - 1.6; return [[-w, y, z], [w, y, z], [w, y + 0.9, z], [-w, y + 0.9, z]]; }), { flat: true, cap0: true });
      b.loft('sfWood', zs.slice(0, 7).map((z, i) => { const w = ws[i] - 0.4, y = ys[i]; return [[-w, y - 0.2, z], [w, y - 0.2, z], [w, y + 0.15, z], [-w, y + 0.15, z]]; }), { flat: true, cap0: true });
      b.rod('bronze', [0, 6.5, -44], [0, 13, -60], 0.5, 0.2, 5);
      for (const [z, h] of [[-22, 46], [-1, 48], [20, 42]]) {
        b.rod('bronze', [0, 4, z], [0, h, z], 0.55, 0.22, 5);
        [0.27, 0.42, 0.57, 0.72, 0.86].forEach((t, i) => { const yy = lerp(4, h, t), w = lerp(23, 10, i / 4) * (h / 48); b.beam('bronze', [-w / 2, yy, z], [w / 2, yy, z], 0.4, 0.4); });
      }
      b.tube('dark', [[0, 46, -22], [0, 13, -60]], 0.15, 3); b.tube('dark', [[0, 48, -1], [0, 40, -22]], 0.15, 3); b.tube('dark', [[0, 42, 20], [0, 6.5, 40]], 0.15, 3);
      b.box('lagoon', 0, -20, -2, 18, 100, 20.6);
      b.light([0, 49, -1], 'warm', 0.7);
    } });

  X.push({ id: 'wharfsign', lon: -122.4157, lat: 37.8080, ex: 8.5, ry: 9, label: "Fisherman's Wharf sign",
    // the Fisherman's Wharf sign: a wooden ship's wheel with its eight handles round a blue face, the big red crab at the hub with its claws raised, on its post at Jefferson and Taylor
    build(b) {
      b.cyl('stone', 0, -20, 0, 1.6, 1.6, 20.8, 8);
      b.rod('dark', [0, 0.8, 0], [0, 6, 0], 0.5, 0.42, 6);
      b.rod('p0', [0, 9.4, -0.3], [0, 9.4, 0.3], 3.2, 3.2, 16);
      b.tube('sfWood', Array.from({ length: 17 }, (_, i) => { const a = i / 16 * Math.PI * 2; return [Math.cos(a) * 3.45, 9.4 + Math.sin(a) * 3.45, 0]; }), 0.5, 5);
      for (let i = 0; i < 8; i++) { const a = (i + 0.5) / 8 * Math.PI * 2; b.rod('sfWood', [Math.cos(a) * 3.4, 9.4 + Math.sin(a) * 3.4, 0], [Math.cos(a) * 4.9, 9.4 + Math.sin(a) * 4.9, 0], 0.36, 0.55, 5); }
      // the crab: a wide shell on both faces, two raised claws with open pincers, three legs a side, eyes on stalks
      for (const f of [-1, 1]) {
        b.push(new THREE.Matrix4().compose(new THREE.Vector3(0, 9.2, 0), new THREE.Quaternion(), new THREE.Vector3(1.35, 0.9, 1)));
        axial(b, 'red', [0, 0, f * 0.25], [0, 0, f * 1.6], [[1.75, 0], [1.6, 0.6], [1.05, 1.1], [0, 1.35]], 8, { cap: false });
        b.pop();
      }
      for (const s of [-1, 1]) {
        b.beam('red', [s * 1.9, 9.7, 0.7], [s * 2.6, 11.2, 0.7], 0.6, 0.6);
        b.beam('red', [s * 2.6, 11.2, 0.7], [s * 2.2, 12.6, 0.7], 0.7, 0.55); b.beam('red', [s * 2.6, 11.2, 0.7], [s * 3.4, 12.3, 0.7], 0.6, 0.5);
        for (let k = 0; k < 3; k++) b.beam('red', [s * 2, 9 - k * 0.5, 0.6], [s * 3.1, 8.3 - k * 0.75, 0.6], 0.32, 0.32);
        b.rod('dark', [s * 0.5, 10.1, 1.2], [s * 0.6, 10.8, 1.3], 0.16, 0.24, 4);
      }
      b.light([0, 9.4, 1.8], 'warm', 1);
    } });

  // ---------- Chinatown, North Beach, the Financial District ----------
  X.push({ id: 'dragongate', lon: -122.4058, lat: 37.7908, ex: 6, ry: 9, label: 'Dragon Gate', mats: mats('sfJade', 'sfGold'),
    // the Dragon Gate, Chinatown, 11 m: three openings in a pale stone gate, each under a green-tiled roof with upturned eaves, the middle one higher, facing south down Grant Avenue
    build(b) {
      for (const x of [-8.2, -3.4, 3.4, 8.2]) b.box('stone', x, -20, 0, 1.8, 2.6, Math.abs(x) > 5 ? 26 : 28.5);
      b.box('stone', 0, 5.6, 0, 8.6, 1.8, 3);
      for (const s of [-1, 1]) b.box('stone', s * 5.8, 4.8, 0, 6.4, 1.6, 1.2);
      b.box('sfJade', 0, 6.4, 0.95, 4, 0.2, 1.6, { lit: 0.4 });
      const roof = (x, y, w, d, h) => { b.frustum('sfJade', x, y, 0, w + 1.4, d + 0.8, w, d, 0.5); b.frustum('sfJade', x, y + 0.5, 0, w + 1, d + 0.4, w * 0.62, 0.5, h); b.box('sfGold', x, y + 0.5 + h, 0, w * 0.62, 0.5, 0.4); for (const s of [-1, 1]) b.cyl('sfGold', x + s * w * 0.31, y + 0.5 + h, 0, 0.35, 0.1, 1, 4); };
      roof(0, 8.6, 9.6, 4.2, 2.4);
      for (const s of [-1, 1]) roof(s * 5.8, 6, 5.6, 3.6, 1.8);
      b.light([0, 7, 2], 'warm', 1);
    } });

  X.push({ id: 'sentinel', lon: -122.4049, lat: 37.7963, ex: 4.4, ry: 9, label: 'Columbus Tower', mats: mats('sfPatina'),
    // Columbus Tower (the Sentinel Building), 1907, 8 floors: a green copper-clad flatiron at the fork of Columbus Avenue and Kearny Street, its round prow capped by a cupola
    build(b) {
      const ring = (y, g) => [[7 + g, y, -18 - g], [7 + g, y, 10], [6.4 + g, y, 12.8 + g * 0.6], [4.6 + g * 0.7, y, 14.6 + g], [2 + g * 0.3, y, 15.2 + g], [-0.4 - g * 0.5, y, 14.2 + g * 0.8], [-1.8 - g, y, 12], [-11 - g, y, -18 - g]];
      b.loft('stone', [ring(-20, 0.3), ring(4.5, 0.3)], { flat: true, win: [2, 1], glow: 0.9 });
      b.loft('sfPatina', [ring(4.5, 0), ring(27, 0)], { flat: true, win: [3, 6], glow: 0.8 });
      b.loft('white', [ring(27, 0.5), ring(28.4, 0.5)], { flat: true });
      b.cyl('sfPatina', 2.4, 28.4, 11.4, 3.4, 3.4, 4.2, 10, { win: [10, 1], glow: 0.9 });
      b.lathe('sfPatina', 2.4, 11.4, [[3.8, 32.6], [3.2, 34.4], [1.8, 35.8], [0, 36.6]], 10, { cap: false });
      b.rod('sfPatina', [2.4, 36.4, 11.4], [2.4, 38.6, 11.4], 0.3, 0.12, 4);
    } });

  X.push({ id: 'ca555', lon: -122.4036, lat: 37.7920, ex: 1.5, ry: 9, label: '555 California Street', mats: mats('sfGranite'),
    // 555 California Street, 237 m: a dark red granite tower whose walls fold into narrow bay windows on every side, with a stepped, notched top
    build(b) {
      const zig = (y, x0, rx, rz, nx, nz) => { const C = [[x0 - rx, -rz], [x0 + rx, -rz], [x0 + rx, rz], [x0 - rx, rz]], out = []; for (let k = 0; k < 4; k++) { const a = C[k], c = C[(k + 1) % 4], nb = k % 2 ? nz : nx, L = Math.hypot(c[0] - a[0], c[1] - a[1]), n = [(c[1] - a[1]) / L, -(c[0] - a[0]) / L]; for (let i = 0; i < nb; i++) { const t = i / nb, m = (i + 0.5) / nb; out.push([lerp(a[0], c[0], t), y, lerp(a[1], c[1], t)]); out.push([lerp(a[0], c[0], m) - n[0] * 1.8, y, lerp(a[1], c[1], m) - n[1] * 1.8]); } } return out; };
      b.loft('sfGranite', [zig(-20, 0, 27, 21, 8, 6), zig(196, 0, 27, 21, 8, 6)], { flat: true, win: [1, 52], glow: 0.7 });
      b.loft('sfGranite', [zig(196, -6, 21, 21, 6, 6), zig(218, -6, 21, 21, 6, 6)], { flat: true, win: [1, 6], glow: 0.7 });
      b.loft('sfGranite', [zig(218, -13, 14, 15, 4, 4), zig(237, -13, 14, 15, 4, 4)], { flat: true, win: [1, 5], glow: 0.7 });
      b.light([-13, 240, 0], 'red', 1.2);
    } });

  X.push({ id: 'cupidsspan', lon: -122.3909, lat: 37.7910, ex: 6.2, ry: -40, label: "Cupid's Span", mats: mats('sfLawn', 'sfGold'),
    // Cupid's Span, Rincon Park, 18 m: a giant gold bow sunk to its grip in the lawn, its two thick arms rising to a taut white string, the red arrow driven into the ground with its feathers high (parts thickened so they read from afar)
    build(b) {
      lawn(b, 'sfLawn', 0, 0, 17, 10);
      b.push(new THREE.Matrix4().makeRotationX(-18 * D2R));
      const arm = Array.from({ length: 11 }, (_, i) => { const x = -13 + i * 2.6; return [x, -5 + 22 * Math.pow(x / 13, 2), 0]; });
      b.tube('sfGold', arm, 1.7, 6, { cap: true, cap0: true });
      b.tube('white', [arm[0], arm[10]], 0.5, 4);
      b.rod('red', [0, -3, 0], [0, 24, 0], 1, 1, 6);
      b.beam('red', [0, 17.5, 0], [0, 24.8, 0], 4.4, 0.35); b.beam('red', [0, 17.5, 0], [0, 24.8, 0], 0.35, 4.4);
      b.pop();
      b.light([0, 17, -6], 'warm', 1);
    } });

  // ---------- South of Market, Mission Bay ----------
  X.push({ id: 'sfmoma', lon: -122.4008, lat: 37.7857, ex: 2.6, ry: -45, label: 'SFMOMA', mats: mats('sfRose'),
    // SFMOMA: Botta's stepped red-brick front on Third Street with the striped, sliced cylinder skylight, and the white rippled tower of the 2016 extension behind
    build(b) {
      b.box('rust', 0, -20, 0, 36, 36, 52, { win: [4, 3], glow: 0.6 });
      for (const s of [-1, 1]) { b.box('rust', s * 25, -20, 2, 14, 32, 41, { win: [2, 3], glow: 0.6 }); b.box('rust', s * 37, -20, 4, 10, 28, 34, { win: [2, 2], glow: 0.6 }); }
      for (let i = 0; i < 5; i++) b.cyl(i % 2 ? 'white' : 'dark', 0, 32 + i * 2, 6, 8.5, 8.5, 2, 14, { cap: false });
      b.loft('dark', [b.circ(0, 42, 6, 8.5, 14), b.circ(0, 42, 6, 8.5, 14).map(p => [p[0], 43 + (6 - p[2]) * 0.45, p[2]])], { cap: false });
      b.loft('glassRoof', [b.circ(0, 42, 6, 8.5, 14).map(p => [p[0], 43 + (6 - p[2]) * 0.45, p[2]]), b.circ(0, 42, 6, 8.5, 14).map(p => [p[0], 43.1 + (6 - p[2]) * 0.45, p[2]])], { lit: 0.6 });
      b.loft('white', Array.from({ length: 13 }, (_, i) => { const y = i ? 2 + i * 5.8 : -20, g = i % 2 ? 1.2 : 0; return se(4, y, -42, 37 + g - i * 0.25, 17 + g - i * 0.2, 12, 6); }), { win: [14, 12], glow: 0.7 });
      b.light([0, 47, 6], 'warm', 1.4);
    } });

  X.push({ id: 'oraclepark', lon: -122.3898, lat: 37.7790, ex: 1.8, ry: 0, label: 'Oracle Park', mats: mats('sfTurf', 'sfSeat'),
    // Oracle Park: the ballpark on the water, home plate at Third and King and the outfield open to the bay, the brick stands and clock tower, light towers, the big Coke bottle and glove in left field
    build(b) {
      const H = [-92, 0], dir = th => [Math.cos(th * D2R), Math.sin(th * D2R)], at = (th, r, y) => { const d = dir(th); return [H[0] + d[0] * r, y, H[1] + d[1] * r]; };
      const W = [[-45, 103], [-30, 108], [-15, 116], [0, 122], [15, 126], [27, 128], [37, 115], [45, 95]];
      const field = y => [[H[0] - 8, y, 0], ...W.map(([t, r]) => at(t, r, y))];
      b.loft('sfTurf', [field(-20), field(0.8)], { flat: true });
      b.box('sand', H[0] + 19.4, -1, 0, 31, 31, 2.1, { ry: 45 }); b.box('sfTurf', H[0] + 19.4, -1, 0, 21, 21, 2.25, { ry: 45 });
      // the stands: lower and upper decks in one brick bowl from the left-field pole round behind home to the right-field pole
      const path = [];
      for (const t of [106, 75, 45, 18]) path.push([...at(-45, t, 0).filter((_, i) => i !== 1), dir(-135)]);
      for (const a of [-135, -157.5, 180, 157.5, 135]) path.push([...at(a, 14, 0).filter((_, i) => i !== 1), dir(a)]);
      for (const t of [18, 45, 75, 97]) path.push([...at(45, t, 0).filter((_, i) => i !== 1), dir(135)]);
      for (let i = 0; i < path.length; i++) if (i < 4 || i > 8) { const p = path[i], n = p[2]; p[0] += n[0] * 10; p[1] += n[1] * 10; } // along the lines the stands sit back from foul ground
      const Pp = (p, o, y) => [p[0] + p[2][0] * o, y, p[1] + p[2][1] * o];
      b.loft('rust', path.map(p => [Pp(p, 0, -20), Pp(p, 36, -20), Pp(p, 36, 33), Pp(p, 32, 33), Pp(p, 2, 3)]), { flat: true, cap0: true, win: [1, 3], glow: 0.5 });
      b.loft('sfSeat', path.map(p => [Pp(p, 2.4, 3.6), Pp(p, 31.6, 33.5), Pp(p, 31.6, 34.2), Pp(p, 2.4, 4.3)]), { flat: true, cap0: true });
      for (const i of [1, 3, 6, 10, 12]) { const p = path[i], q = Pp(p, 34, 33); b.rod('metal', q, [q[0], 58, q[2]], 0.9, 0.6, 5); b.box('lamp', q[0], 56, q[2], 6, 6, 3.2, { lit: 1.3 }); b.light([q[0], 58, q[2]], 'white', 2.4); }
      // the outfield: the wall, the bleachers in left, the high brick wall on McCovey Cove in right, the scoreboard in right-centre
      for (let i = 0; i < W.length - 1; i++) { const hi = i >= 6; b.beam(hi ? 'rust' : 'sfSeat', at(W[i][0], W[i][1], hi ? 4 : 2), at(W[i + 1][0], W[i + 1][1], hi ? 4 : 2), 1.2, hi ? 9 : 5); }
      const bl = [-45, -30, -15, 0, 8].map(t => { const r = W.find(w => w[0] >= t)[1] + 2, d = dir(t); return [H[0] + d[0] * r, H[1] + d[1] * r, d]; });
      b.loft('rust', bl.map(p => [Pp(p, 0, -20), Pp(p, 18, -20), Pp(p, 18, 11), Pp(p, 0, 3)]), { flat: true, cap0: true });
      b.loft('sfSeat', bl.map(p => [Pp(p, 0.6, 3.5), Pp(p, 17, 11.3), Pp(p, 17, 11.9), Pp(p, 0.6, 4.1)]), { flat: true, cap0: true });
      { const [x, , z] = at(30, 146, 0); b.box('dark', x, -20, z, 3, 34, 46, { ry: -30 }); const [x2, , z2] = at(30, 144.3, 0); b.box('glassDark', x2, 10, z2, 0.6, 30, 14, { ry: -30, lit: 0.8 }); }
      // the Coca-Cola bottle and the old-time glove behind the left-field bleachers
      { const p = at(-33, 140, -2), q = at(-33, 100, 30); axial(b, 'red', p, q, [[0, 0], [3.3, 0.4], [3.7, 4], [3.2, 9], [3, 12], [3.4, 15], [2.9, 18.5], [1.5, 22], [1.2, 25], [1.5, 25.6], [0, 26]], 10, { cap: false }); }
      { const [x, , z] = at(-17, 146, 0); b.lathe('ochreShade', x, z, [[0, 3], [5.5, 4.5], [7, 8], [6.4, 11.5], [4, 14], [0, 15]], 8, { cap: false }); for (let k = 0; k < 4; k++) b.rod('ochreShade', [x - 4.5 + k * 3, 12, z], [x - 5.5 + k * 3.6, 17.5, z - 1], 1.5, 1.3, 5); b.rod('ochreShade', [x + 5, 7, z], [x + 9, 11, z + 1], 1.7, 1.4, 5); }
      // the clock tower over the main gate behind home plate, at Third and King
      { const [x, , z] = at(180, 54, 0); b.box('rust', x, -20, z, 10, 10, 62); for (const [dx, dz] of [[1, 0], [0, 1], [0, -1]]) b.rod('clock', [x + dx * 5, 36, z + dz * 5], [x + dx * 5.5, 36, z + dz * 5.5], 2.8, 2.8, 10, { lit: 1.3 }); b.frustum('roof', x, 42, z, 11, 11, 2, 2, 7); b.rod('metal', [x, 49, z], [x, 56, z], 0.3, 0.1, 4); }
    } });

  X.push({ id: 'chasecenter', lon: -122.3877, lat: 37.7688, ex: 2.1, ry: 0, label: 'Chase Center', mats: mats('sfTree'),
    // Chase Center, 41 m: a rounded arena wrapped in layered white bands that swoop up and down round its dark glass body and roll over into a low white roof, the tall glass entrance on its plaza to the south-west (set at the north of its site so the higher Potrero block in front does not hide it)
    build(b) {
      const N = 24, ring = (y0, amp, ph, rx, rz) => se(0, 0, 0, rx, rz, N).map(([x, , z], j) => { const a = j / N * Math.PI * 2 + Math.PI / N; return [x, y0 + amp * Math.sin(2 * a + ph), z]; });
      b.loft('concreteLight', [se(-8, -20, 8, 100, 82, 20), se(-8, 0.6, 8, 100, 82, 20)]);
      b.loft('glassDark', [se(0, -20, 0, 74, 59, N), se(0, 39, 0, 72, 57, N)], { win: [36, 6], glow: 1.1, cap: false });
      [[11, 4.4, 0.2], [19.5, 5, 1.5], [28, 4.2, 2.8], [35.5, 2.2, 4]].forEach(([y, amp, ph], k) => {
        const rx = 76 - k * 0.8, rz = 61 - k * 0.8;
        b.loft('white', [ring(y - 2.4, amp, ph, rx, rz), ring(y, amp, ph, rx + 3.8, rz + 3.8), ring(y + 2.4, amp, ph, rx + 0.6, rz + 0.6)], { cap: false });
      });
      b.loft('white', [[38.4, 73, 58], [41, 62, 49], [43, 40, 31], [44, 12, 9]].map(([y, rx, rz]) => se(0, y, 0, rx, rz, N)));
      b.box('glass', -68, -20, 55, 36, 12, 46, { ry: -45, win: [9, 4], glow: 1.3 });
      b.box('white', -69, 26, 56, 42, 17, 1.4, { ry: -45 });
      for (const [x, z] of [[-98, 18], [-80, 76], [-44, 92]]) tree(b, x, z, 5, 12, 0.6);
      for (let i = 0; i < 8; i++) { const a = (i + 0.5) / 8 * Math.PI * 2; b.light([Math.cos(a) * 84, 18, Math.sin(a) * 68], 'cool', 2.2); }
    } });

  // ---------- the Castro, the Mission ----------
  X.push({ id: 'castrotheatre', lon: -122.4349, lat: 37.7620, ex: 3.8, ry: 0, label: 'Castro Theatre', mats: mats('sfStucco', 'sfR3'),
    // the Castro Theatre, 1922: the Spanish Colonial Baroque front on Castro Street (pilasters, the great arched window, an ornate stepped crest with urn finials) on a cream stucco auditorium and stage house, the V-shaped lit marquee over the sidewalk, and the tall vertical CASTRO sign, red letters on cream, standing out over the street and above the crest
    build(b) {
      b.box('sfStucco', -19, -20, 0, 36, 24, 34);
      b.frustum('dome', -19, 14, 0, 36, 24, 32, 9, 3.4);
      b.box('sfStucco', -33, -20, 0, 9, 26, 40); b.box('dome', -33, 20, 0, 9.4, 26.4, 0.6);
      const half = [[13, -20], [13, 20.6], [12, 21.4], [10.4, 21.4], [9, 21.9], [7, 23.1], [5, 24.4], [3.2, 25], [2.2, 26.9], [1, 27.9], [0, 28.3]];
      const out = [...half, ...half.slice(0, -1).reverse().map(([z, y]) => [-z, y])];
      b.loft('stone', [0, 2.4].map(x => out.map(([z, y]) => [x, y, z])), { flat: true, cap0: true });
      for (const z of [-12, -6.4, 6.4, 12]) b.box('trim', 2.6, 0, z, 0.5, 1.6, Math.abs(z) > 10 ? 21.4 : 22.8);
      for (const z of [-12.2, -7, 7, 12.2]) { const y = Math.abs(z) > 10 ? 21.4 : 23.1; b.lathe('stone', 1.2, z, [[0.8, y], [1, y + 0.9], [0.45, y + 1.9], [0, y + 2.6]], 6, { cap: false }); }
      b.lathe('stone', 1.2, 0, [[1.3, 28], [1.5, 29.1], [0.6, 30.2], [0, 31.4]], 6, { cap: false });
      panel(b, 'trim', archP(2.45, 0, 0, 1, 8.4, 17.4, 4.7), [1, 0, 0]);
      panel(b, 'glassDark', archP(2.5, 0, 0, 1, 9, 17.4, 3.9), [1, 0, 0], { lit: 0.8 });
      b.box('glassDark', 2.5, 0, 0, 0.3, 14, 4.4, { win: [5, 1], glow: 1.2 });
      const V = y => [[2.5, y, -11], [2.5, y, 11], [10, y, 0]];
      b.loft('lamp', [V(4.6), V(7.4)], { flat: true, cap0: true, lit: 1.2 });
      b.loft('red', [V(7.4), V(8.1)].map(r => r.map(p => [p[0] + 0.2, p[1], p[2] * 1.03])), { flat: true, lit: 0.5 });
      // the vertical sign: a cream blade edged in red, CASTRO in red stroke letters down both faces
      b.box('red', 5.2, 8.4, 0, 5, 0.7, 26.2, { lit: 0.4 }); b.box('white', 5.2, 8.6, 0, 4.6, 0.9, 25.8);
      const F = { C: [[2, 4, 0, 4], [0, 4, 0, 0], [0, 0, 2, 0]], A: [[0, 0, 1, 4], [1, 4, 2, 0], [0.5, 1.6, 1.5, 1.6]], S: [[2, 4, 0, 4], [0, 4, 0, 2], [0, 2, 2, 2], [2, 2, 2, 0], [2, 0, 0, 0]], T: [[0, 4, 2, 4], [1, 4, 1, 0]], R: [[0, 0, 0, 4], [0, 4, 2, 4], [2, 4, 2, 2], [2, 2, 0, 2], [0.7, 2, 2, 0]], O: [[0, 0, 0, 4], [0, 4, 2, 4], [2, 4, 2, 0], [2, 0, 0, 0]] };
      for (const f of [-1, 1]) [...'CASTRO'].forEach((ch, i) => F[ch].forEach(([u0, v0, u1, v1]) => {
        const P = (u, v) => [5.2 + f * (u - 1) * 1.2, 30.4 - i * 4.15 + v * 0.8, f * 0.47], p = P(u0, v0), q = P(u1, v1), L = Math.hypot(q[0] - p[0], q[1] - p[1]), d = [(q[0] - p[0]) / L * 0.3, (q[1] - p[1]) / L * 0.3], n = [-d[1], d[0]];
        panel(b, 'red', [[p[0] - d[0] + n[0], p[1] - d[1] + n[1], p[2]], [p[0] - d[0] - n[0], p[1] - d[1] - n[1], p[2]], [q[0] + d[0] - n[0], q[1] + d[1] - n[1], p[2]], [q[0] + d[0] + n[0], q[1] + d[1] + n[1], p[2]]], [0, 0, f], { lit: 1.3 });
      }));
      b.lathe('sfR3', 5.2, 0, [[0.9, 34.4], [1.2, 35.2], [0, 36.4]], 6, { cap: false, lit: 0.8 });
      b.light([7, 6, 0], 'warm', 1.6); b.light([6, 26, 0], 'red', 1.2);
    } });

  X.push({ id: 'rainbowflag', lon: -122.4352, lat: 37.7626, ex: 5.5, ry: 0, label: 'Rainbow flag, Harvey Milk Plaza', mats: mats('sfR1', 'sfR2', 'sfR3', 'sfR4', 'sfR5', 'sfR6'),
    // the rainbow flag over Harvey Milk Plaza: a 21 m pole and a 9 by 6 m flag of six stripes, flying east on the ocean wind
    build(b) {
      b.cyl('stone', 0, -20, 0, 3.6, 3.6, 21.2, 8);
      b.cyl('metal', 0, 1, 0, 0.35, 0.2, 21.5, 6);
      const cols = ['sfR1', 'sfR2', 'sfR3', 'sfR4', 'sfR5', 'sfR6'];
      for (let k = 0; k < 6; k++) {
        const y1 = 21.6 - k, y0 = y1 - 1;
        b.loft(cols[k], Array.from({ length: 7 }, (_, i) => { const t = i / 6, x = 0.3 + t * 9, z = Math.sin(t * Math.PI * 1.6) * 0.9 * t; return [[x, y0, z - 0.12], [x, y1, z - 0.12], [x, y1, z + 0.12], [x, y0, z + 0.12]]; }), { flat: true, cap0: true, lit: 0.35 });
      }
      b.light([0, 23, 0], 'white', 0.8);
    } });

  X.push({ id: 'missiondolores', lon: -122.4270, lat: 37.7642, ex: 4.2, ry: 0, label: 'Mission Dolores', mats: mats('sfGold', 'sfRose'),
    // Mission Dolores: the small whitewashed adobe mission of 1791 (red tile roof, four thick columns, three bells in its gable) dwarfed by the 1918 basilica beside it to the north, its ornate cream front with rose window and two tall belfry towers under tiled domes; both face Dolores Street
    build(b) {
      const zm = 16; // the mission
      b.box('white', -17, -20, zm, 34, 10, 27, { win: [6, 1], glow: 0.5 });
      gableX(b, 'dome', -35, 0.4, 7, zm, 6.3, 3.6);
      const mf = [[6, -20], [6, 7.6], [4.6, 8.6], [2.6, 11.2], [1.2, 12.6], [0, 13]], mo = [...mf, ...mf.slice(0, -1).reverse().map(([z, y]) => [-z, y])];
      b.loft('white', [0, 1.4].map(x => mo.map(([z, y]) => [x, y, zm + z])), { flat: true, cap0: true });
      for (const s of [-1, 1]) b.beam('dome', [0.7, 7.7, zm + s * 6.4], [0.7, 13.3, zm], 2, 0.7);
      for (const dz of [-4.4, -1.5, 1.5, 4.4]) b.cyl('whiteShade', 2.1, 0, zm + dz, 0.7, 0.62, 7.6, 6);
      b.box('white', 1.8, 7.4, zm, 2.6, 12.2, 0.9);
      for (const dz of [-2.4, 0, 2.4]) panel(b, 'dark', archP(1.45, zm + dz, 0, 1, 8.8, 9.9, 0.7, 4), [1, 0, 0]);
      panel(b, 'dark', archP(1.45, zm, 0, 1, 0, 3, 1.2, 4), [1, 0, 0], { lit: 0.5 });
      const zb = -15; // the basilica
      b.box('stone', -24, -20, zb, 46, 24, 37, { win: [8, 2], glow: 0.8 });
      gableX(b, 'dome', -47, -1, 17, zb, 12.8, 6.5);
      const bf = [[8.8, -20], [8.8, 21], [7, 22], [4.8, 24.6], [2.4, 25.4], [1.2, 27.6], [0, 28]], bo = [...bf, ...bf.slice(0, -1).reverse().map(([z, y]) => [-z, y])];
      b.loft('stone', [-1, 1.4].map(x => bo.map(([z, y]) => [x, y, zb + z])), { flat: true });
      for (const dz of [-6, 6]) b.box('trim', 1.6, 0, zb + dz, 0.5, 1.2, 22);
      panel(b, 'trim', archP(1.45, zb, 0, 1, 0, 6.4, 3.4), [1, 0, 0]); panel(b, 'glassDark', archP(1.5, zb, 0, 1, 0, 6, 2.6), [1, 0, 0], { lit: 0.6 });
      b.rod('sfRose', [1.3, 15.6, zb], [1.9, 15.6, zb], 2.8, 2.8, 10, { lit: 1 });
      for (const s of [-1, 1]) {
        const z = zb + s * 12.4;
        b.box('stone', 0.2, -20, z, 6.8, 6.8, 52, { win: [2, 4], glow: 0.6 });
        b.box('trim', 0.2, 32, z, 7.8, 7.8, 1);
        b.box('stoneShade', 0.2, 33, z, 6, 6, 6, { win: [2, 1], glow: 1.1 });
        b.box('trim', 0.2, 39, z, 7.2, 7.2, 0.8);
        for (const [dx, dz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) b.cyl('stone', 0.2 + dx * 3.1, 39.8, z + dz * 3.1, 0.6, 0, 2.4, 4);
        b.cyl('stone', 0.2, 39.8, z, 2.6, 2.6, 2.4, 8, { win: [8, 1], glow: 1 });
        b.lathe('dome', 0.2, z, [[3.3, 42.2], [3.1, 43.8], [2.3, 45.4], [1.1, 46.5], [0, 46.9]], 8, { cap: false });
        b.cyl('stone', 0.2, 46.7, z, 0.7, 0.7, 1.4, 6); b.lathe('dome', 0.2, z, [[0.9, 48.1], [0, 49]], 6, { cap: false });
        b.box('sfGold', 0.2, 48.8, z, 0.35, 0.35, 3); b.box('sfGold', 0.2, 50.4, z, 0.35, 1.6, 0.35);
        b.light([3, 36, z], 'warm', 0.8);
      }
      b.light([4, 8, zm], 'warm', 0.9);
    } });

  // ---------- Golden Gate Park: the Music Concourse ----------
  X.push({ id: 'deyoung', lon: -122.4686, lat: 37.7715, ex: 1.9, ry: 0, label: 'de Young Museum', mats: mats('sfCopper'),
    // the de Young, tower 44 m: a long, low perforated-copper body of three parallel gallery bars round planted courts, each under a flat roof with deep overhangs and a great canopy over the entrance, and the copper tower that twists (exaggerated here to 65 degrees) as it rises to its glass lookout
    build(b) {
      for (const [x, z, w, d] of [[-8, -33, 124, 17], [4, -3, 136, 19], [-6, 27, 118, 16]]) {
        b.box('sfCopper', x, -20, z, w, d, 30, { win: [30, 2], glow: 0.5 });
        b.box('sfCopper', x, 10, z, w + 6, d + 1.4, 1.3);
      }
      b.box('sfCopper', 78, 10, 8, 26, 44, 1.3);
      for (const [z, d] of [[-18, 9], [12.25, 9.5]]) b.box('sfLawn', -4, -20, z, 112, d, 20.7);
      for (const [x, z] of [[-40, -18], [-6, 12.25], [22, -18]]) tree(b, x, z, 3.6, 9, 0.7);
      const twist = y => -72 * Math.max(0, y) / 54;
      b.loft('sfCopper', [-20, 0, 9, 18, 27, 36, 45, 50].map(y => b.rect(46, y, -30, 30, 13, twist(y))), { flat: true, win: [6, 12], glow: 0.6 });
      b.loft('glass', [50, 54].map(y => b.rect(46, y, -30, 30, 13, twist(y))), { flat: true, win: [8, 1], glow: 1.2 });
      b.box('sfCopper', 46, 54, -30, 31.5, 14.5, 0.8, { ry: twist(54) });
    } });

  X.push({ id: 'calacademy', lon: -122.4661, lat: 37.7699, ex: 1.8, ry: 0, label: 'California Academy of Sciences', mats: mats('sfLawn'),
    // the California Academy of Sciences: one flat glass-walled block, 11 m, under a wide canopy whose green living roof swells into seven domes, the planetarium and the rainforest the largest
    build(b) {
      b.box('glass', 0, -20, 0, 136, 100, 30, { win: [26, 2], glow: 1 });
      b.box('glassRoof', 0, 10, 0, 154, 118, 1);
      b.box('sfLawn', 0, 10.6, 0, 140, 104, 0.8);
      b.box('glassRoof', 0, 11, 0, 22, 30, 0.6, { lit: 0.4 });
      const dome = (x, z, R, h, n) => b.lathe('sfLawn', x, z, [[R, 11.2], [R * 0.9, 11.2 + h * 0.45], [R * 0.66, 11.2 + h * 0.8], [R * 0.34, 11.2 + h * 0.97], [0, 11.2 + h]], n, { cap: false });
      dome(-32, -4, 26, 15, 12); dome(32, -4, 26, 15, 12);
      for (const [x, z, R, h] of [[-50, 34, 11, 6], [-18, 34, 12, 6.5], [16, 36, 10, 5.5], [50, 32, 11, 6], [0, -38, 10, 5]]) dome(x, z, R, h, 8);
    } });

  X.push({ id: 'teagarden', lon: -122.4703, lat: 37.7701, ex: 4.6, ry: 0, label: 'Japanese Tea Garden', mats: mats('sfLawn', 'sfTree', 'sfHedge'),
    // the Japanese Tea Garden: the five-storey red pagoda, 13 m, and the high arched drum bridge over the pond, among pines
    build(b) {
      b.box('sfHedge', 6, -20, 3, 50, 36, 20.4);
      b.loft('lagoon', [b.circ(14, 0, 8, 12, 12, 0, 7), b.circ(14, 0.7, 8, 12, 12, 0, 7)]);
      b.box('stone', -6, -20, -6, 7, 7, 21.4);
      for (let i = 0; i < 5; i++) { const s = 5.2 - i * 0.6, y = 1.4 + i * 2.25; b.box('red', -6, y, -6, s, s, 1.5); b.frustum('dark', -6, y + 1.5, -6, s + 3, s + 3, s * 0.55, s * 0.55, 0.75); }
      b.rod('sfGold', [-6, 12.6, -6], [-6, 15.5, -6], 0.25, 0.1, 4);
      const arc = Array.from({ length: 9 }, (_, i) => { const a = i / 8 * Math.PI; return [14 - Math.cos(a) * 5.5, 0.6 + Math.sin(a) * 3.6]; });
      b.loft('bronze', arc.map(([x, y]) => [[x, y, 6.8], [x, y, 9.2], [x, y + 0.45, 9.2], [x, y + 0.45, 6.8]]), { flat: true, cap0: true });
      for (const z of [6.8, 9.2]) b.tube('red', arc.map(([x, y]) => [x, y + 1.3, z]), 0.12, 3);
      for (const [x, z, r, h] of [[-16, 10, 3.4, 7], [-14, -16, 3, 8], [4, -12, 3.6, 6.5], [26, -6, 3.2, 7.5], [27, 17, 3, 6]]) tree(b, x, z, r, h, 0.4);
    } });

  X.push({ id: 'legion', lon: -122.5008, lat: 37.7845, ex: 2.9, ry: 0, label: 'Legion of Honor',
    // the Legion of Honor: a white Beaux-Arts palace round the open Court of Honor, the six-column portico at its head, deep Ionic colonnades in shadow down both sides of the court, the triumphal-arch gateway with its attic and paired columns on the east, and the glass pyramid in the court
    build(b) {
      b.box('white', -32, -20, 0, 24, 76, 40, { win: [10, 2], glow: 0.6 });
      b.box('whiteShade', -32, 20, 0, 20, 66, 1.4); b.box('white', -33, 21.4, 0, 12, 24, 3.4);
      b.box('stoneShade', -20.4, 1, 0, 0.6, 26, 15);
      for (let i = 0; i < 6; i++) b.cyl('white', -17.8, 1, -11 + i * 4.4, 1.15, 1, 15, 6);
      b.box('white', -18.6, 16, 0, 5, 27, 2.4); b.loft('white', [[[-21, 18.4, -13.5], [-21, 18.4, 13.5], [-21, 23.4, 0]], [[-16.2, 18.4, -13.5], [-16.2, 18.4, 13.5], [-16.2, 23.4, 0]]], { flat: true, cap0: true });
      b.box('concreteLight', 8, -20, 0, 56, 50, 20.5);
      for (const s of [-1, 1]) {
        b.box('white', 8, -20, s * 31, 54, 12, 32, { win: [8, 1], glow: 0.6 });
        b.box('stoneShade', 8, 1, s * 24.7, 52, 0.4, 10);
        for (let i = 0; i < 11; i++) b.cyl('white', -16 + i * 4.8, 1, s * 19.6, 1, 0.9, 10, 6);
        b.box('white', 8, 11, s * 22, 54, 6.6, 1.8); b.box('whiteShade', 8, 12.8, s * 22.2, 54, 6, 0.5);
      }
      b.frustum('glassRoof', 6, 0.5, 0, 9, 9, 0.4, 0.4, 5.5, { lit: 0.5 });
      // the gateway: two piers and the arch block under a cornice and attic, the arch open below its springing, paired columns on the east face
      for (const s of [-1, 1]) b.box('white', 37, -20, s * 10.6, 10, 12.4, 44);
      b.box('white', 37, 10, 0, 10, 8.8, 14);
      for (const f of [-1, 1]) panel(b, 'dark', archP(37 + f * 5.03, 0, 0, 1, 10, 10, 4.4), [f, 0, 0]);
      b.box('whiteShade', 37, 24, 0, 11, 34, 1.2); b.box('white', 37, 25.2, 0, 9, 24, 5.5);
      for (const z of [-13.4, -7.8, 7.8, 13.4]) b.cyl('white', 42.8, 1, z, 1, 0.9, 23, 6);
      b.light([32, 6, 0], 'warm', 1.2);
    } });

  X.push({ id: 'fortpoint', lon: -122.4770, lat: 37.81015, ex: 3.8, ry: 0, label: 'Fort Point', mats: mats('sfRock'),
    // Fort Point, 1861: a hollow four-tier fort under the south end of the Golden Gate Bridge, granite below and brick above, cut square on the landward side, its open courtyard ringed by three tiers of arched casemates, a small lighthouse on the roof, standing on its granite seawall at the water (the block top is about 68 m above the water here)
    build(b) {
      const O = [[-37, 24], [37, 24], [37, -8], [20, -24], [-20, -24], [-37, -8]], I = [[-27, 14], [27, 14], [27, -4], [15.5, -14], [-15.5, -14], [-27, -4]];
      const at = (P, y) => P.map(([x, z]) => [x, y, z]), mix = (p, q, t) => [lerp(p[0], q[0], t), lerp(p[1], q[1], t)];
      b.loft('sfRock', [-80, 0.4].map(y => at(O.map(([x, z]) => [x * 1.06, z * 1.08]), y)), { flat: true });
      b.loft('concreteLight', [at(I, -20), at(I, 0.6)], { flat: true });
      for (let i = 0; i < 6; i++) {
        const j = (i + 1) % 6, q = [O[i], O[j], I[j], I[i]], r = [O[i], O[j], mix(O[j], I[j], 0.14), mix(O[i], I[i], 0.14)];
        b.loft('stoneShade', [at(q, -20), at(q, 5)], { flat: true, win: [7, 1], glow: 0.4 });
        b.loft('rust', [at(q, 5), at(q, 14.5)], { flat: true, win: [7, 2], glow: 0.4 });
        b.loft('stoneShade', [at(r, 14.5), at(r, 16.4)], { flat: true });
        // the casemates on the courtyard side: three tiers of dark arches
        const A = I[i], B2 = I[j], L = Math.hypot(B2[0] - A[0], B2[1] - A[1]), t = [(B2[0] - A[0]) / L, (B2[1] - A[1]) / L], m = [(A[0] + B2[0]) / 2, (A[1] + B2[1]) / 2];
        let n = [-t[1], t[0]]; if (n[0] * -m[0] + n[1] * -m[1] < 0) n = [-n[0], -n[1]];
        const k = Math.max(3, Math.round(L / 5.2));
        for (let tier = 0; tier < 3; tier++) for (let c = 0; c < k; c++) { const s = (c + 0.5) / k * L, y0 = 1 + tier * 4.5; panel(b, 'dark', archP(A[0] + t[0] * s + n[0] * 0.12, A[1] + t[1] * s + n[1] * 0.12, t[0], t[1], y0, y0 + 2.2, 1.45, 3), [n[0], 0, n[1]]); }
      }
      b.cyl('white', 12, 14.5, -19, 1.9, 1.5, 8.5, 6); b.cyl('dark', 12, 23, -19, 2.3, 2.3, 0.6, 6);
      b.cyl('lamp', 12, 23.6, -19, 1.4, 1.4, 1.8, 6, { lit: 2 }); b.cyl('dark', 12, 25.4, -19, 1.9, 0, 1.7, 6);
      b.light([12, 24.5, -19], 'beam', 2);
    } });

  // ---------- the hills, the outer neighbourhoods, the shipyard ----------
  X.push({ id: 'davidsoncross', lon: -122.4538, lat: 37.7381, ex: 4, ry: 9, label: 'Mount Davidson cross', mats: mats('sfTree'),
    // the Mount Davidson cross, 31 m: a plain concrete cross on the city's highest hill, among eucalyptus
    build(b) {
      b.box('concrete', 0, -20, 0, 7, 7, 21);
      b.box('concreteLight', 0, 1, 0, 3, 3, 30.5);
      b.box('concreteLight', 0, 21, 0, 13, 3, 3);
      for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2 + 0.4, r = 14 + (i * 5) % 9; tree(b, Math.cos(a) * r, Math.sin(a) * r, 3.2 + (i % 3) * 0.6, 13 + (i * 3) % 6); }
      b.light([0, 18, 5], 'warm', 1.4);
    } });

  X.push({ id: 'haightashbury', lon: -122.4469, lat: 37.7700, ex: 5.4, ry: 9, label: 'Haight & Ashbury', mats: mats('sfJade'),
    // Haight and Ashbury: the crossing with its big green street-sign blades on one post (HAIGHT east-west, ASHBURY north-south), painted Victorians on the corners (Queen Annes with round corner turrets and front gables, Italianates with angled bay windows, white trim and false fronts), and the fishnet-stocking legs in red heels kicking out of an upper window (Piedmont Boutique)
    build(b) {
      b.box('roadLight', 0, -1, 0, 84, 9, 1.4); b.box('roadLight', 0, -1, 0, 9, 84, 1.41);
      // a Victorian w wide, d deep, eaves at h, its front on z = zf facing s (1 south, -1 north), angled bays at bays[], a white cornice, a front gable or a flat false front
      const vic = (x, zf, s, w, d, h, col, gable, bays) => {
        b.box(col, x, -20, zf - s * d / 2, w, d, h + 20, { win: [3, 3], glow: 0.8 });
        for (const bx of bays) {
          const ring = (y, g) => [[bx - 2 - g, y, zf], [bx - 1.2 - g * 0.6, y, zf + s * (1.3 + g)], [bx + 1.2 + g * 0.6, y, zf + s * (1.3 + g)], [bx + 2 + g, y, zf]];
          b.loft(col, [ring(1.2, 0), ring(h - 1.6, 0)], { flat: true, win: [3, 2], glow: 0.9 });
          b.loft('trim', [ring(h - 1.6, 0.35), ring(h - 0.9, 0.35)], { flat: true });
        }
        b.box('trim', x, h - 0.3, zf + s * 0.4, w + 0.8, 1.2, 1.3);
        if (gable) { gableZ(b, 'roof', zf - s * d, zf + s * 0.2, h + 1, x, w / 2 + 0.4, 5); panel(b, col, [[x - w / 2 + 0.4, h + 1, zf + s * 0.5], [x + w / 2 - 0.4, h + 1, zf + s * 0.5], [x, h + 5.4, zf + s * 0.5]], [0, 0, s]); }
        else b.box('trim', x, h + 1, zf + s * 0.2, w + 0.4, 1, 1.5);
      };
      const turret = (x, z, r, h, col) => { b.cyl(col, x, -20, z, r, r, h + 20, 8, { win: [8, 4], glow: 0.9 }); b.cyl('trim', x, h, z, r + 0.4, r + 0.4, 0.8, 8); b.lathe('roof', x, z, [[r + 0.5, h + 0.8], [r * 0.45, h + 5.4], [0, h + 7.6]], 8, { cap: false }); };
      vic(12, -5.5, 1, 12, 18, 12.5, 'p5', true, [14.6]); turret(6.9, -6.9, 2.9, 15.5, 'p5');
      vic(21.5, -5.5, 1, 7, 18, 11.5, 'p1', false, [20.4]);
      vic(28.5, -5.5, 1, 7, 18, 12, 'p2', false, [27]);
      vic(35.5, -5.5, 1, 7, 18, 11, 'p6', true, [34]);
      vic(-12, -5.5, 1, 12, 18, 12, 'p0', false, [-15, -9]);
      vic(-12, 5.5, -1, 12, 18, 12.5, 'p3', true, [-14.6]); turret(-6.9, 6.9, 2.9, 15.5, 'p3');
      // the legs: fishnet stockings and red heels kicking out of the upper window of the pink house
      b.box('trim', 30.5, 6.8, -5.3, 2.8, 0.5, 2.8); panel(b, 'dark', vrect(30.5, 8.2, -5.0, 1, 0, 2.1, 2.2), [0, 0, 1]);
      for (const [dx, k] of [[-0.55, -0.5], [0.6, 0.7]]) { const p = [30.5 + dx, 8, -4.9], q = [30.5 + dx * 1.6 + k, 3.4, -1.1]; b.rod('dark', p, q, 0.62, 0.4, 6); b.beam('red', [q[0], q[1] + 0.2, q[2] - 0.3], [q[0], q[1] - 0.4, q[2] + 1.7], 0.8, 0.65); b.beam('red', [q[0], q[1], q[2] - 0.4], [q[0], q[1] - 1.5, q[2] - 0.5], 0.2, 0.2); }
      // the signs: one post at the south-east corner, two long green blades with white lettering on both faces
      b.rod('dark', [5.4, 0, 5.4], [5.4, 14.2, 5.4], 0.42, 0.34, 6);
      b.box('sfJade', 5.4, 11.6, 5.4, 12.4, 0.44, 2.4, { lit: 0.3 }); b.box('sfJade', 5.4, 8.8, 5.4, 0.44, 12.4, 2.4, { lit: 0.3 });
      for (const f of [-1, 1]) {
        [...'HAIGHT'].forEach((_, i) => { const t = (i - 2.5) * 1.75; panel(b, 'sfSign', vrect(5.4 + f * t, 12.8, 5.4 + f * 0.23, 1, 0, 1.15, 1.45), [0, 0, f], { lit: 1 }); });
        [...'ASHBURY'].forEach((_, i) => { const t = (i - 3) * 1.6; panel(b, 'sfSign', vrect(5.4 + f * 0.23, 10, 5.4 - f * t, 0, 1, 1.05, 1.45), [f, 0, 0], { lit: 1 }); });
      }
      b.light([5.4, 14.6, 5.4], 'warm', 0.8); b.light([30.5, 6, -2], 'warm', 0.8);
    } });

  X.push({ id: 'bison', lon: -122.4998, lat: 37.7697, ex: 4, ry: 0, label: 'Bison paddock', mats: mats('sfLawn', 'sfTree'),
    // the bison paddock, Golden Gate Park: a fenced meadow with a small herd
    build(b) {
      lawn(b, 'sfLawn', 0, 0, 40, 22);
      b.tube('sfWood', [...se(0, 1.6, 0, 40, 22, 20, 2.4), se(0, 1.6, 0, 40, 22, 20, 2.4)[0]], 0.25, 4);
      for (const [x, z, a] of [[-18, -6, 20], [-8, 4, -30], [4, -8, 60], [14, 6, 10], [24, -2, -70], [-26, 8, 100], [6, 12, 160]]) b.place(x, 0, z, a, 1, () => {
        b.box('bronzeShade', 0, 0.5, 0, 5.4, 2.6, 2.8); b.box('bronzeShade', 1.6, 2.6, 0, 2.6, 2.4, 1.4); b.box('bronzeShade', 3.4, 1.4, 0, 1.4, 1.6, 1.6);
      });
      for (const [x, z] of [[-34, -26], [-10, -28], [22, -27], [38, 24], [-30, 26]]) tree(b, x, z, 4, 10);
    } });

  X.push({ id: 'gantry', lon: -122.3636, lat: 37.7234, ex: 3.2, ry: 0, label: 'Hunters Point gantry crane',
    // the great gantry crane at Hunters Point, 1947, about 60 m: four braced legs straddling the dry dock, the long box girder across their tops with its trolley and machinery house
    build(b) {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.beam('rust', [sx * 24, -20, sz * 12], [sx * 20, 50, sz * 9], 3.4, 3.4);
      for (const sx of [-1, 1]) { b.beam('rust', [sx * 22.5, 12, -11], [sx * 22.5, 12, 11], 1.6, 1.6); b.beam('rust', [sx * 23.5, -2, -11.5], [sx * 21, 40, 10], 1.2, 1.2); b.beam('rust', [sx * 23.5, -2, 11.5], [sx * 21, 40, -10], 1.2, 1.2); }
      b.box('rust', 0, 48, 0, 96, 12, 7);
      b.box('rust', 0, 55, 0, 96, 3, 1.2);
      b.box('metal', -12, 55, 0, 14, 10, 7, { win: [3, 1], glow: 0.8 });
      b.box('dark', 20, 46, 0, 6, 8, 3); b.rod('dark', [20, 46, 0], [20, 22, 0], 0.25, 0.25, 4); b.box('dark', 20, 20.5, 0, 2.4, 2.4, 1.5);
      b.light([-48, 56, 0], 'red', 1.1); b.light([48, 56, 0], 'red', 1.1);
    } });
  // Presidio Tunnel Tops (opened 2022): the park laid over the Presidio Parkway's Main Post tunnels, between the Main Post and
  // Crissy Field, at its true size (drawn 1:1, always: flat). Its frame is the tunnels' own: the middle between the four portals where
  // the data's tunnel stretches of US 101 begin and end (js/map3d/roaddata.js), x along the tunnels (east, 11.6 degrees north of it),
  // z towards the Main Post (south). Its outline is the data's own (js/map3d/parkdata.js, Presidio Tunnel Tops, 5.7 ha), written here in
  // that frame (the model is made before the data loads). The lid over the two bores stands level with the Main Post at its south edge
  // and clear of the roadway; north of the tunnels the bluff steps down in three terraces to the Outpost at the foot. Heights follow the
  // real ground under it (M3D.land.heightAt; flat land: a low mound); what lies below the ground is hidden in it, so where the Main Post
  // rises above the lawn the two meet flush. Each bore's mouth is at its own portal.
  if (!/[?&]m3d-parks=off(?:&|$)/.test(location.search)) {   // (it goes with the parks: ?m3d-parks=off leaves it out, as before the parks came)
    const land = window.M3D.land, S = 1 / land.UNIT_M, O0 = [-122.455857, 37.802935], RY = 11.64;
    // the outline, metres in the frame; the four portals [x, z] (bores A, the southern, eastbound, and B)
    const OL = [[-142.3, -24.5], [-129.9, -26], [-122.3, -4], [-160.7, 1.3], [-161.3, 23.6], [-229.2, 35.1], [-206.9, 59.1], [-169.8, 64.7], [-57.6, 131.7], [14.8, 49.7], [82.3, 89.1], [90.4, 88.7], [160.5, -80.4], [159.9, -96.8], [148.3, -104.3], [-134.8, -114.7]];
    const PORT = [[-164, 11.1, -1], [-128, -11.1, -1], [141.3, 13.8, 1], [150.6, -13.8, 1]];   // [x, z, which end]
    const O = land.proj(O0), cr = Math.cos(RY * D2R), sr = Math.sin(RY * D2R);
    // one set of mouths at each end: the west ones are the park's (the road meets them on the ground); at the east end the road arrives on its
    // structure (js/map3d/roads.js), so with the roads' structure on the road's own portal stands there and the park draws no mouths of its
    // own (lids: the part of the park that covers the road's mouths, map units, for js/map3d.js); with ?m3d-roads=off or flat, all four are the park's
    const RS = !/[?&]m3d-roads=(off|flat)(?:&|$)/.test(location.search), SIDE = (x, z, r) => [O[0] + (x * cr + z * sr) * S, O[1] + (-x * sr + z * cr) * S, r * S];
    X.push({ lids: RS ? [SIDE(-146, 0, 90)] : null, id: 'tunneltops', lon: O0[0], lat: O0[1], ex: 1, ry: RY, label: 'Tunnel Tops', flat: true, mats: mats('ttLawn', 'ttMeadow', 'ttPath', 'ttTile', 'sfTree', 'sfWood', 'sfRock', 'sfStucco', 'sfTurf'),
      build(b) {
        const hA = land.heightAt, g0 = hA ? hA(O[0], O[1]) : 0, G = (x, z) => hA ? (hA(O[0] + (x * cr + z * sr) * S, O[1] + (-x * sr + z * cr) * S) - g0) / S : (z > -20 ? 4 : 0);   // the real ground at a point, in metres above the ground at the middle
        const over = (x0, x1, z0, z1) => { let m = -Infinity; for (let i = 0; i <= 8; i++) for (let j = 0; j <= 6; j++) m = Math.max(m, G(lerp(x0, x1, i / 8), lerp(z0, z1, j / 6))); return m; };
        const DEEP = -34, ZN = -30, BW = 8.2;                                                                      // the slabs' foot (in the ground), the lid's north edge (the bluff's lip), half a bore's width
        const road = PORT.map(([x, z]) => G(x, z)), Yt = Math.max(lerp(G(-60, 56), G(20, 56), 0.5), Math.max(...road) + 13.5);   // the lawn: level with the Main Post at the south edge, 13.5 m clear of the roadway
        // ---- plan helpers: a polygon cut by a half-plane z >= c (or <= c), and cut into triangles by its ears ----
        const cut = (P, c, up) => { const out = [], ins = p => up ? p[1] >= c : p[1] <= c; for (let i = 0; i < P.length; i++) { const a = P[i], q = P[(i + 1) % P.length]; if (ins(a)) out.push(a); if (ins(a) !== ins(q)) { const t = (c - a[1]) / (q[1] - a[1]); out.push([a[0] + (q[0] - a[0]) * t, c]); } } return out; };
        const ears = P => { const v = P.map((_, i) => i), T = [], X2 = (a, b2, c) => (P[b2][0] - P[a][0]) * (P[c][1] - P[a][1]) - (P[b2][1] - P[a][1]) * (P[c][0] - P[a][0]); let ar = 0; for (let i = 0; i < P.length; i++) { const q = P[(i + 1) % P.length]; ar += P[i][0] * q[1] - q[0] * P[i][1]; } const sg = ar > 0 ? 1 : -1; let guard = 0;
          while (v.length > 3 && guard++ < 2000) { const n = v.length; let k = -1; for (let i = 0; i < n && k < 0; i++) { const a = v[(i + n - 1) % n], b2 = v[i], c = v[(i + 1) % n]; if (X2(a, b2, c) * sg <= 1e-9) continue; let ok = true; for (const q of v) { if (q === a || q === b2 || q === c) continue; if (X2(a, b2, q) * sg > 0 && X2(b2, c, q) * sg > 0 && X2(c, a, q) * sg > 0) { ok = false; break; } } if (ok) k = i; } if (k < 0) k = 0; T.push([v[(k + n - 1) % n], v[k], v[(k + 1) % n]]); v.splice(k, 1); }
          if (v.length === 3) T.push(v.slice()); return T; };
        const inP = (P, x, z) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i][1] > z) !== (P[j][1] > z) && x < (P[j][0] - P[i][0]) * (z - P[i][1]) / (P[j][1] - P[i][1]) + P[i][0]) c = !c; return c; };
        // a triangle facing nd (local), and a slab: the polygon's flat top at y and its walls down to y0, every face turned out
        const tri3 = (m, A, B2, C, nd) => { const a = b.X(A), c2 = b.X(B2), e = b.X(C), u = [c2[0] - a[0], c2[1] - a[1], c2[2] - a[2]], w = [e[0] - a[0], e[1] - a[1], e[2] - a[2]], n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], o = b.X([A[0] + nd[0], A[1] + nd[1], A[2] + nd[2]]), f = n[0] * (o[0] - a[0]) + n[1] * (o[1] - a[1]) + n[2] * (o[2] - a[2]) < 0, l = Math.hypot(n[0], n[1], n[2]) || 1, N = n.map(v => v / l * (f ? -1 : 1)), z0 = [0, 0], id = b.id(m); if (f) b.tri(id, a, e, c2, N, N, N, z0, z0, z0, 0); else b.tri(id, a, c2, e, N, N, N, z0, z0, z0, 0); };
        const slab = (m, P, y, y0 = DEEP, wall = m) => { if (P.length < 3) return; for (const t of ears(P)) tri3(m, [P[t[0]][0], y, P[t[0]][1]], [P[t[1]][0], y, P[t[1]][1]], [P[t[2]][0], y, P[t[2]][1]], [0, 1, 0]);
          for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length], dx = q[0] - p[0], dz = q[1] - p[1], l = Math.hypot(dx, dz); if (l < 1e-3) continue; let nx = dz / l, nz = -dx / l; if (inP(P, (p[0] + q[0]) / 2 + nx * 0.05, (p[1] + q[1]) / 2 + nz * 0.05)) { nx = -nx; nz = -nz; } const nd = [nx, 0, nz]; tri3(wall, [p[0], y0, p[1]], [q[0], y0, q[1]], [q[0], y, q[1]], nd); tri3(wall, [p[0], y0, p[1]], [q[0], y, q[1]], [p[0], y, p[1]], nd); } };
        const box = (m, x0, x1, z0, z1, y0, y1, o) => b.loft(m, [[[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]]], Object.assign({ flat: true }, o));
        const strip = (m, pts, w, t) => b.loft(m, pts.map((p, i) => { const a = pts[Math.max(0, i - 1)], c = pts[Math.min(pts.length - 1, i + 1)], l = Math.hypot(c[0] - a[0], c[2] - a[2]) || 1, nx = -(c[2] - a[2]) / l * w / 2, nz = (c[0] - a[0]) / l * w / 2; return [[p[0] - nx, p[1], p[2] - nz], [p[0] + nx, p[1], p[2] + nz], [p[0] + nx, p[1] + t, p[2] + nz], [p[0] - nx, p[1] + t, p[2] - nz]]; }), { flat: true, cap0: true });
        const oval = (x, z, rx, rz, n, a0 = 0, a1 = Math.PI * 2) => Array.from({ length: n + 1 }, (_, i) => { const a = lerp(a0, a1, i / n); return [x + Math.cos(a) * rx, z + Math.sin(a) * rz]; });
        const span = (P, z) => { const xs = []; for (let i = 0; i < P.length; i++) { const p = P[i], q = P[(i + 1) % P.length]; if ((p[1] > z) !== (q[1] > z)) xs.push(p[0] + (q[0] - p[0]) * (z - p[1]) / (q[1] - p[1])); } xs.sort((a, c) => a - c); return xs; };   // where the line z crosses the outline (pairs: inside between)
        // ---- the lid and the bluff: the outline cut into bands, each a level slab; the terraces never below the ground they stand on ----
        const ZS = [ZN, ZN - 22, ZN - 44, ZN - 66], yFoot = over(-130, 150, -116, ZS[3]) + 0.4, Y = [Yt]; let prev = Yt;
        for (let i = 1; i < 4; i++) { const y = Math.min(prev - 1.2, Math.max(lerp(Yt, yFoot, i / 3.6), over(-130, 150, ZS[i], ZS[i - 1]) + 0.6)); Y.push(y); prev = y; }
        slab('ttLawn', cut(OL, ZS[0], true), Yt);
        for (let i = 1; i < 4; i++) slab(i === 2 ? 'ttMeadow' : 'ttLawn', cut(cut(OL, ZS[i - 1], false), ZS[i], true), Y[i]);
        slab('ttMeadow', cut(OL, ZS[3], false), yFoot, DEEP);
        // stone walls along each lip (the Cliff Walk's at the lid), the Presidio Steps down the middle of the bluff
        for (let i = 0; i < 4; i++) { const xs = span(OL, ZS[i]); for (let k = 0; k + 1 < xs.length; k += 2) box('stoneShade', xs[k], xs[k + 1], ZS[i] - 1.1, ZS[i], DEEP, Y[i] + 1); }
        for (let i = 0; i < 4; i++) { const yA = Y[i], yB = i < 3 ? Y[i + 1] : yFoot; for (let k = 0; k < 5; k++) { const z0 = ZS[i] - 1.1 - (k + 1) * 4, z1 = ZS[i] - 1.1 - k * 4; box('concreteLight', -14, 14, z0, z1, DEEP, lerp(yA, yB, (k + 1) / 5) + 0.2); } }
        for (let i = 1; i < 4; i++) for (const sx of [-1, 1]) { const xs = span(OL, ZS[i] + 9); if (xs.length >= 2) strip('ttPath', [[sx > 0 ? 18 : xs[0] + 8, Y[i], ZS[i] + 9], [sx > 0 ? xs[xs.length - 1] - 8 : -18, Y[i], ZS[i] + 9]], 3, 0.25); }   // a path along each terrace
        // the overlooks: three decks out over the bluff from the Cliff Walk, the western one turned to the Golden Gate
        for (const [x, r] of [[-100, 11], [-48, 9], [70, 10]]) { const ring = oval(x, ZN - 1, r, r * 0.85, 12, Math.PI, Math.PI * 2); b.loft('ttPath', [ring.map(q => [q[0], Yt - 1.4, q[1]]), ring.map(q => [q[0], Yt + 0.3, q[1]])], {}); strip('concreteLight', ring.map(q => [q[0], Yt + 0.3, q[1]]), 0.6, 1.1); }
        // on the lid: the Cliff Walk, a loop round the main lawn with two paths across, the plaza at the Main Post's edge, the campfire circle
        { const xs = span(OL, ZN + 6); if (xs.length >= 2) strip('ttPath', [[xs[0] + 3, Yt, ZN + 6], [xs[xs.length - 1] - 3, Yt, ZN + 6]], 4.4, 0.3); }
        strip('ttPath', oval(-40, 8, 62, 24, 26).map(q => [q[0], Yt, q[1]]), 3.8, 0.3);
        { const r = oval(-40, 8, 54, 17, 22).slice(0, 22); b.loft('sfTurf', [r.map(q => [q[0], Yt - 0.4, q[1]]), r.map(q => [q[0], Yt + 0.2, q[1]])], {}); }
        strip('ttPath', [[-96, Yt, ZN + 6], [-92, Yt, 20], [-120, Yt, 50]], 3.4, 0.3); strip('ttPath', [[22, Yt, ZN + 6], [26, Yt, 18], [-6, Yt, 40]], 3.4, 0.3); strip('ttPath', [[40, Yt, ZN + 6], [70, Yt, 10], [100, Yt, 20]], 3.2, 0.3);
        box('ttPath', -34, 2, 26, 40, Yt - 1, Yt + 0.3);                                                          // the plaza by the Main Post
        for (const x of [-28, -18, -8]) box(x % 4 ? 'sfWood' : 'white', x - 3, x + 3, 30, 34, Yt + 0.3, Yt + 3);  // carts and tables on it
        { const cx = 95, cz = 2; b.cyl('stone', cx, Yt - 0.5, cz, 7.5, 7.5, 1, 14); b.cyl('ttPath', cx, Yt + 0.5, cz, 6, 6, 0.1, 14); b.cyl('sfRock', cx, Yt + 0.5, cz, 1.6, 1.2, 0.9, 8); }
        // trees: a row along the Main Post side, a few at the ends and on the terraces (only where the outline holds them)
        const R = (() => { let s = 20220717; return () => (s = (s * 16807) % 2147483647) / 2147483647; })(), T = (x, z, r, h, y) => { if (inP(OL, x, z)) tree(b, x, z, r, h, Math.max(y, G(x, z))); };
        for (let i = 0; i < 16; i++) { const x = -200 + i * 22 + (R() - 0.5) * 8, xs = span(OL, 40); T(x, 44 + R() * 30, 4.5 + R() * 2, 10 + R() * 5, Yt); }
        for (let i = 0; i < 10; i++) T(-150 + R() * 300, ZS[1] + 4 + R() * 12, 4 + R() * 2, 9 + R() * 4, Y[1]);
        for (let i = 0; i < 8; i++) T(-120 + R() * 260, ZS[2] + 4 + R() * 12, 4 + R() * 2, 9 + R() * 4, Y[2]);
        // at the foot of the bluff: the Outpost (logs, boulders, a nest on sand, a mound) and the Field Station beside it
        { const x0 = -118, x1 = -48, z0 = -112, z1 = ZS[3] - 3, y = yFoot, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
          b.loft('sand', [se(cx, DEEP, cz, (x1 - x0) / 2, (z1 - z0) / 2, 14, 3), se(cx, y + 0.3, cz, (x1 - x0) / 2, (z1 - z0) / 2, 14, 3)], {});
          b.rod('sfWood', [cx - 24, y + 1.6, cz - 3], [cx - 6, y + 2.1, cz + 3], 1.6, 1.3, 7); b.rod('sfWood', [cx + 6, y + 1.4, cz + 5], [cx + 22, y + 1.4, cz - 2], 1.4, 1.2, 7);
          for (const [dx, dz, r] of [[-18, 6, 2.6], [-2, -5, 3.2], [12, -6, 2.2], [26, 4, 2.8]]) b.lathe('sfRock', cx + dx, cz + dz, [[r, y - 0.5], [r * 0.85, y + r * 0.45], [r * 0.4, y + r * 0.8], [0, y + r * 0.9]], 7, { cap: false });
          b.cyl('sfWood', cx + 2, y, cz + 1, 3.4, 2.9, 5.5, 9); b.cyl('ttTile', cx + 2, y + 5.5, cz + 1, 4.2, 0, 3.4, 9); b.loft('ttLawn', [b.circ(cx - 12, y - 0.5, cz - 1, 5.5, 10), b.circ(cx - 12, y + 2.2, cz - 1, 2.2, 10)], {});
          const fx = 2, fz = cz + 1; box('sfStucco', fx - 15, fx + 15, fz - 6, fz + 6, DEEP, y + 6, { win: [7, 1], glow: 0.7 }); gableX(b, 'ttTile', fx - 16, fx + 16, y + 6, fz, 7, 3.6); }
        // the four mouths, each at its own portal: the bore's dark inside, the headwall over it (to the lawn), wing walls along the roadway, the
        // lid carried out over the bore where the portal lies beyond the park's outline
        for (const [px, pz, e] of PORT) { if (RS && e > 0) continue;   // (the east mouths: the road's, above)
          const ry2 = G(px, pz), yo = ry2 + 7.5, z0 = pz - BW, z1 = pz + BW, top = Math.max(Yt, yo + 3), xin = px - e * 18;
          box('dark', Math.min(px, xin), Math.max(px, xin), z0, z1, DEEP, yo);                                     // inside: dark
          box('concreteLight', Math.min(px, px + e * 1.4), Math.max(px, px + e * 1.4), z0 - 2.5, z0, DEEP, top + 1); box('concreteLight', Math.min(px, px + e * 1.4), Math.max(px, px + e * 1.4), z1, z1 + 2.5, DEEP, top + 1);
          box('concreteLight', Math.min(px, px + e * 1.4), Math.max(px, px + e * 1.4), z0 - 2.5, z1 + 2.5, yo, top + 1);   // the headwall: two piers, the lintel and its parapet
          const xs = span(OL, pz), edge = e > 0 ? (xs.length ? xs[xs.length - 1] : px) : (xs.length ? xs[0] : px);
          if ((px - edge) * e > 1) box('ttLawn', Math.min(edge, px), Math.max(edge, px), z0 - 2.5, z1 + 2.5, yo, top);       // the lid out to the portal
          for (const sd of [-1, 1]) { const zw = pz + sd * (BW + 1.4), yr = Math.min(yo, G(px + e * 22, zw) + 0.8); b.loft('concreteLight', [[[px, DEEP, zw - 0.7], [px + e * 22, DEEP, zw - 0.7], [px + e * 22, DEEP, zw + 0.7], [px, DEEP, zw + 0.7]], [[px, yo + 2, zw - 0.7], [px + e * 22, yr, zw - 0.7], [px + e * 22, yr, zw + 0.7], [px, yo + 2, zw + 0.7]]], { flat: true }); }   // wing walls that fall away along the roadway
        }
        // on the Main Post, beyond the park: two of the post's white buildings under red roofs (the visitor centre, the transit centre)
        for (const [x, z, w] of [[-118, 118, 22], [50, 96, 18]]) { const y = over(x - w, x + w, z - 8, z + 8) + 0.4; box('white', x - w, x + w, z - 7, z + 7, DEEP, y + 8, { win: [10, 2], glow: 0.7 }); gableX(b, 'ttTile', x - w - 1, x + w + 1, y + 8, z, 8, 4.4); }
      } });
  }
})();
