// More 3D landmarks for the 3D map (beta): San Francisco. Each entry is pushed onto window.M3D.extra and taken up by js/map3d/models.js.
(() => {
  const X = window.M3D.extra = window.M3D.extra || [];
  const D2R = Math.PI / 180, lerp = (a, b, t) => a + (b - a) * t;
  // the colours this file adds: [paper, night]
  const M = {
    sfGold: ['#d6b25c', '#a3833f'], sfDome: ['#c2cbc6', '#56626e'], sfLawn: ['#aac190', '#3d5142'], sfTurf: ['#90b27b', '#3a5a3e'], sfSeat: ['#5f7a74', '#28383b'],
    sfHedge: ['#8aa877', '#33483a'], sfTree: ['#7d9a6c', '#2e4034'], sfJade: ['#78a891', '#3e5e53'], sfMaroon: ['#9b4b44', '#5c3030'], sfCopper: ['#a28b6b', '#55493a'],
    sfPatina: ['#8db3a0', '#46645a'], sfGranite: ['#715b58', '#372e31'], sfRose: ['#5e6c82', '#e2aa6a'], sfWood: ['#b9a385', '#584b3d'], sfSign: ['#f3ecda', '#ffe2a8'],
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

  X.push({ id: 'cliffhouse', lon: -122.5127, lat: 37.7784, ex: 3.4, ry: 0, label: 'Cliff House & Sutro Baths',
    // the Cliff House and the Sutro Baths: the low white 1909 Cliff House on the cliff edge with its glass wing, and the ruined pools of the baths in the cove to the north
    build(b) {
      b.box('white', 0, -22, 0, 26, 38, 31);
      b.box('whiteShade', 1, 9, 0, 22, 34, 4.5, { win: [9, 1], glow: 1 });
      b.box('white', 1, 13.5, 0, 24, 36, 1.2);
      b.box('glass', -1, -22, 25, 22, 13, 33, { win: [5, 2], glow: 1 });
      b.box('white', -1, 11, 25, 23, 14, 0.8);
      b.box('concrete', -16, -22, 4, 8, 44, 25);
      const zb = -78;
      b.box('concrete', -4, -22, zb, 74, 50, 22.5);
      for (const [x, z, w, d] of [[-16, zb - 6, 40, 24], [22, zb - 8, 14, 18], [-12, zb + 16, 30, 9]]) {
        b.box('lagoon', x, 0.5, z, w, d, 0.4);
        b.box('concreteLight', x, 0.5, z - d / 2 - 1, w + 4, 2, 2.4); b.box('concreteLight', x - w / 2 - 1, 0.5, z, 2, d, 2.4);
        b.box('concreteLight', x + w / 2 + 1, 0.5, z - d / 4, 2, d / 2, 1.6); b.box('concreteLight', x - w / 4, 0.5, z + d / 2 + 1, w / 2, 2, 1.2);
      }
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

  X.push({ id: 'pier39', lon: -122.4064, lat: 37.8089, ex: 2, ry: 5, label: 'Pier 39', mats: mats('sfWood'),
    // Pier 39: two rows of weathered timber shops down the pier, the carousel at its end, and the sea lions hauled out on their floats
    build(b) {
      b.box('sfWood', 0, -20, 0, 22, 106, 21.2);
      for (const s of [-1, 1]) for (const [z, l] of [[-28, 26], [0, 24], [27, 24], [47, 12]]) { b.box('sfWood', s * 6.2, 1.2, z, 8, l, 6.5, { win: [4, 2], glow: 0.8 }); gableZ(b, 'roof', z - l / 2, z + l / 2, 7.7, s * 6.2, 4.4, 2.6); }
      b.cyl('white', 0, 1.2, -46, 5, 5, 4, 12, { win: [12, 1], glow: 1.2 }); b.lathe('red', 0, -46, [[5.8, 5], [3, 7], [0, 8.4]], 12, { cap: false });
      b.light([0, 4, -46], 'gold', 1.4);
      for (const s of [-1, 1]) {
        const z = -48; b.box('concrete', s * 8.6, 1.2, z, 4, 9, 0.6);
        for (let k = 0; k < 3; k++) b.lathe('bronzeShade', s * (8 + (k % 2) * 1.3), z - 2.8 + k * 2.8, [[0, 1.8], [0.9, 2.1], [0.5, 2.9], [0, 3.1]], 5, { cap: false });
      }
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

  X.push({ id: 'wharfsign', lon: -122.4157, lat: 37.8080, ex: 6.5, ry: 9, label: "Fisherman's Wharf sign",
    // the Fisherman's Wharf sign: a ship's wheel with the red crab at its hub, on its post at Jefferson and Taylor
    build(b) {
      b.cyl('stone', 0, -20, 0, 2.2, 2.2, 21, 8);
      b.rod('dark', [0, 1, 0], [0, 6.2, 0], 0.4, 0.35, 6);
      const c = [0, 9.4, 0]; b.rod('p0', [0, 9.4, -0.25], [0, 9.4, 0.25], 3.2, 3.2, 16);
      b.tube('sfWood', Array.from({ length: 17 }, (_, i) => { const a = i / 16 * Math.PI * 2; return [Math.cos(a) * 3.35, 9.4 + Math.sin(a) * 3.35, 0]; }), 0.3, 4);
      for (let i = 0; i < 8; i++) { const a = (i + 0.5) / 8 * Math.PI * 2; b.rod('sfWood', [Math.cos(a) * 3.3, 9.4 + Math.sin(a) * 3.3, 0], [Math.cos(a) * 4.5, 9.4 + Math.sin(a) * 4.5, 0], 0.28, 0.4, 5); }
      b.lathe('red', 0, 0.3, [[0, 8.2], [1.4, 8.4], [1.7, 9.4], [1.4, 10.4], [0, 10.6]], 8, { cap: false });
      for (const s of [-1, 1]) b.beam('red', [s * 1.2, 10, 0.4], [s * 2.2, 11.4, 0.4], 0.5, 0.5);
      b.light([0, 9.4, 1.5], 'warm', 0.8);
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

  X.push({ id: 'ca555', lon: -122.4036, lat: 37.7920, ex: 2.2, ry: 9, label: '555 California Street', mats: mats('sfGranite'),
    // 555 California Street, 237 m: a dark red granite tower whose walls fold into narrow bay windows on every side, with a stepped, notched top
    build(b) {
      const zig = (y, x0, rx, rz, nx, nz) => { const C = [[x0 - rx, -rz], [x0 + rx, -rz], [x0 + rx, rz], [x0 - rx, rz]], out = []; for (let k = 0; k < 4; k++) { const a = C[k], c = C[(k + 1) % 4], nb = k % 2 ? nz : nx, L = Math.hypot(c[0] - a[0], c[1] - a[1]), n = [(c[1] - a[1]) / L, -(c[0] - a[0]) / L]; for (let i = 0; i < nb; i++) { const t = i / nb, m = (i + 0.5) / nb; out.push([lerp(a[0], c[0], t), y, lerp(a[1], c[1], t)]); out.push([lerp(a[0], c[0], m) - n[0] * 1.8, y, lerp(a[1], c[1], m) - n[1] * 1.8]); } } return out; };
      b.loft('sfGranite', [zig(-20, 0, 27, 21, 8, 6), zig(196, 0, 27, 21, 8, 6)], { flat: true, win: [1, 52], glow: 0.7 });
      b.loft('sfGranite', [zig(196, -6, 21, 21, 6, 6), zig(218, -6, 21, 21, 6, 6)], { flat: true, win: [1, 6], glow: 0.7 });
      b.loft('sfGranite', [zig(218, -13, 14, 15, 4, 4), zig(237, -13, 14, 15, 4, 4)], { flat: true, win: [1, 5], glow: 0.7 });
      b.light([-13, 240, 0], 'red', 1.2);
    } });

  X.push({ id: 'cupidsspan', lon: -122.3909, lat: 37.7910, ex: 5, ry: -40, label: "Cupid's Span", mats: mats('sfLawn', 'sfGold'),
    // Cupid's Span, Rincon Park, 18 m: a giant bow sunk to its grip in the lawn, its two arms rising to a taut string, the arrow driven into the ground with its feathers high
    build(b) {
      lawn(b, 'sfLawn', 0, 0, 19, 11);
      b.push(new THREE.Matrix4().makeRotationX(-18 * D2R));
      const arm = Array.from({ length: 11 }, (_, i) => { const x = -13 + i * 2.6; return [x, -5 + 22 * Math.pow(x / 13, 2), 0]; });
      b.tube('sfGold', arm, 1.1, 6, { cap: true, cap0: true });
      b.tube('white', [arm[0], arm[10]], 0.3, 4);
      b.rod('red', [0, -3, 0], [0, 24, 0], 0.6, 0.6, 6);
      b.beam('red', [0, 18.5, 0], [0, 24.5, 0], 3.2, 0.2); b.beam('red', [0, 18.5, 0], [0, 24.5, 0], 0.2, 3.2);
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

  X.push({ id: 'chasecenter', lon: -122.3877, lat: 37.7680, ex: 2.3, ry: 0, label: 'Chase Center',
    // Chase Center, 41 m: a rounded white arena drum on a glass base, its skin swelling outwards and rolling over into a low domed roof, on its plaza
    build(b) {
      b.loft('concreteLight', [se(0, -20, 0, 94, 78, 20), se(0, 0.6, 0, 94, 78, 20)]);
      b.loft('glassDark', [se(0, -20, 0, 76, 61, 28), se(0, 9, 0, 76, 61, 28)], { win: [40, 2], glow: 1.1, cap: false });
      const R = [[9, 78, 62], [15, 81, 65], [26, 80.5, 64.5], [33, 76, 60], [38, 66, 51], [41, 52, 39], [42.5, 30, 22]];
      b.loft('white', R.map(([y, rx, rz]) => se(0, y, 0, rx, rz, 28)), { win: [28, 5], glow: 0.35 });
      for (let i = 0; i < 8; i++) { const a = (i + 0.5) / 8 * Math.PI * 2; b.light([Math.cos(a) * 84, 18, Math.sin(a) * 68], 'cool', 2.2); }
    } });

  // ---------- the Castro, the Mission ----------
  X.push({ id: 'castrotheatre', lon: -122.4349, lat: 37.7620, ex: 3.8, ry: 0, label: 'Castro Theatre',
    // the Castro Theatre, 1922: the tall Spanish Baroque front on Castro Street with its great arched window and stepped crest, the lit marquee over the sidewalk, the red CASTRO sign rising above the roof
    build(b) {
      b.box('stoneShade', -17, -20, 0, 32, 22, 33); gableX(b, 'roof', -33, -1, 13, 0, 11.2, 3);
      b.box('stone', 0.5, -20, 0, 4, 26, 44);
      b.box('stone', 0.5, 24, 0, 3.6, 16, 3.6); b.box('stone', 0.5, 27.6, 0, 3.2, 8, 3); b.cyl('stone', 0.5, 30.6, 0, 1.4, 0.2, 3, 6);
      for (const s of [-1, 1]) { b.box('stone', 0.5, 24, s * 11, 3.6, 4, 2); b.cyl('stone', 0.5, 26, s * 11, 1.2, 0.2, 2.6, 6); }
      b.box('glassDark', 2.6, 10, 0, 0.4, 9, 11, { win: [3, 3], glow: 1 }); b.rod('glassDark', [2.6, 21, 0], [3, 21, 0], 4.5, 4.5, 10, { win: [3, 1], glow: 1 });
      b.loft('lamp', [[[2.5, 4.6, -10], [2.5, 4.6, 10], [9, 4.6, 0]], [[2.5, 7.4, -10], [2.5, 7.4, 10], [9, 7.4, 0]]], { flat: true, cap0: true, lit: 1.2 });
      b.box('red', 4.4, 7.4, 0, 1.2, 4.4, 27, { lit: 0.9 }); b.box('sfR3', 4.4, 34.4, 0, 1.4, 4.8, 0.8, { lit: 1 });
      b.light([7, 6, 0], 'warm', 1.6); b.light([5.5, 30, 0], 'red', 1);
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

  X.push({ id: 'missiondolores', lon: -122.4270, lat: 37.7642, ex: 4.2, ry: 0, label: 'Mission Dolores',
    // Mission Dolores: the whitewashed adobe mission of 1791 under its tile roof, with the 1918 basilica and its two ornate towers beside it to the north, both fronting Dolores Street
    build(b) {
      b.box('white', -14, -20, 12, 34, 9, 30);
      gableX(b, 'dome', -31, 3, 10, 12, 5, 3.4);
      b.box('white', 3.4, -20, 12, 1.8, 10.4, 33);
      b.box('white', 3.4, 13, 12, 1.6, 5.4, 1.8);
      for (let k = -1; k <= 1; k++) b.box('dark', 4.2, 9.6, 12 + k * 2.8, 0.3, 1.3, 1.8);
      for (let k = 0; k < 4; k++) b.cyl('whiteShade', 4.8, -0.5, 8.4 + k * 2.4, 0.4, 0.4, 9.5, 5);
      b.box('stone', -20, -20, -8, 40, 19, 40, { win: [8, 2], glow: 0.8 });
      gableX(b, 'dome', -40, 0, 20, -8, 9.8, 5);
      b.box('stone', 2, -20, -8, 4, 9, 46); b.frustum('stone', 2, 26, -8, 4, 8, 3, 3, 4);
      for (const s of [-1, 1]) {
        const z = -8 + s * 7.6;
        b.box('stone', 2, -20, z, 6.4, 6.4, 48);
        b.box('stoneShade', 2, 28, z, 5.4, 5.4, 5.2, { win: [2, 1], glow: 1 });
        b.lathe('stone', 2, z, [[3.4, 33.2], [2.8, 35], [1, 37], [0, 38.4]], 8, { cap: false });
        b.rod('metal', [2, 38.2, z], [2, 40.4, z], 0.15, 0.1, 4);
      }
      b.light([5, 8, 12], 'warm', 0.9);
    } });

  // ---------- Golden Gate Park: the Music Concourse ----------
  X.push({ id: 'deyoung', lon: -122.4686, lat: 37.7715, ex: 1.9, ry: 0, label: 'de Young Museum', mats: mats('sfCopper'),
    // the de Young, tower 44 m: long low copper-clad galleries under one flat roof with deep overhangs, and the tower that twists as it rises to line up with the city grid
    build(b) {
      b.box('sfCopper', -12, -20, -16, 104, 30, 34, { win: [16, 2], glow: 0.5 });
      b.box('sfCopper', 6, -20, 18, 100, 30, 34, { win: [16, 2], glow: 0.5 });
      b.box('glassDark', -2, -20, 2, 60, 10, 32, { win: [8, 1], glow: 0.9 });
      b.box('sfCopper', -2, 14, 0, 132, 80, 1.6);
      for (const [x, z] of [[-30, 2], [24, 2], [40, -20]]) b.box('glassRoof', x, 15.6, z, 12, 9, 0.3);
      const twist = y => lerp(0, -32, Math.max(0, y) / 44);
      b.loft('sfCopper', [-20, 0, 15, 30, 40].map(y => b.rect(48, y, -26, 30, 18, twist(y))), { flat: true, win: [6, 9], glow: 0.6 });
      b.loft('glass', [b.rect(48, 40, -26, 30, 18, twist(40)), b.rect(48, 44, -26, 30, 18, twist(44))], { flat: true, win: [8, 1], glow: 1.2 });
      b.box('sfCopper', 48, 44, -26, 31, 19, 0.8, { ry: twist(44) });
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
    // the Legion of Honor: a white Beaux-Arts palace round the Court of Honor, the columned portico at its head, colonnades down both sides, the triumphal gateway on the east and the glass pyramid in the court
    build(b) {
      b.box('white', -32, -20, 0, 24, 72, 40, { win: [10, 2], glow: 0.6 });
      b.box('whiteShade', -32, 20, 0, 20, 64, 1.4);
      for (let i = 0; i < 6; i++) b.cyl('white', -18.5, 1, -11 + i * 4.4, 1, 0.9, 15, 6);
      b.box('white', -19, 16, 0, 4, 26, 2.4); b.loft('white', [[[-21, 18.4, -13], [-21, 18.4, 13], [-21, 23, 0]], [[-17, 18.4, -13], [-17, 18.4, 13], [-17, 23, 0]]], { flat: true, cap0: true });
      for (const s of [-1, 1]) {
        b.box('white', 6, -20, s * 30, 52, 12, 34, { win: [8, 1], glow: 0.6 });
        for (let i = 0; i < 9; i++) b.cyl('white', -16 + i * 5, 1, s * 22.6, 0.75, 0.7, 10, 5);
        b.box('white', 6, 11, s * 23, 46, 3, 1.6);
      }
      for (const s of [-1, 1]) b.box('white', 34, -20, s * 10, 8, 10, 39);
      b.box('white', 34, 11, 0, 8, 30, 8); b.box('whiteShade', 34, 19, 0, 8.6, 30.6, 1);
      for (const s of [-1, 1]) b.box('white', 34, -20, s * 24, 6, 12, 30);
      b.box('concreteLight', 6, -20, 0, 54, 34, 20.5);
      b.frustum('glassRoof', 8, 0.5, 0, 9, 9, 0.4, 0.4, 5.5, { lit: 0.5 });
    } });

  X.push({ id: 'fortpoint', lon: -122.4770, lat: 37.8106, ex: 4.2, ry: 0, label: 'Fort Point',
    // Fort Point, 1861: a four-tier brick and granite fort under the south end of the Golden Gate Bridge, cut square on the landward side, its small iron lighthouse on the roof
    build(b) {
      const ring = (y, g) => [[-37 - g, y, 24 + g], [37 + g, y, 24 + g], [37 + g, y, -8], [20, y, -24 - g], [-20, y, -24 - g], [-37 - g, y, -8]];
      b.loft('rust', [ring(-20, 0), ring(14.5, 0)], { flat: true, win: [10, 3], glow: 0.35 });
      b.loft('stoneShade', [ring(14.5, 0.3), ring(16.5, 0.3)], { flat: true });
      b.box('concreteLight', 0, 15, 2, 44, 22, 1.7);
      b.cyl('dark', 12, 16.5, -17, 1.3, 1.1, 7, 6); b.cyl('lamp', 12, 23.5, -17, 1.2, 1.2, 1.6, 6, { lit: 2 }); b.cyl('dark', 12, 25.1, -17, 1.6, 0, 1.4, 6);
      b.light([12, 24.3, -17], 'beam', 2);
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
    // Haight and Ashbury: the corner with its green street-sign blades, and the Victorians on the corner, one with a round turret
    build(b) {
      b.box('roadLight', 0, -1, 0, 60, 8, 1.4); b.box('roadLight', 0, -1, 0, 8, 60, 1.41);
      b.box('p5', -12, -20, -12, 14, 14, 33, { win: [3, 3], glow: 0.8 }); gableZ(b, 'roof', -19, -5, 13, -12, 7.4, 5);
      b.cyl('p5', -5, -20, -5, 2.8, 2.8, 37, 8, { win: [6, 3], glow: 0.8 }); b.lathe('roof', -5, -5, [[3.2, 17], [0, 23]], 8, { cap: false });
      b.box('p1', -26, -20, -12, 13, 14, 31.5, { win: [3, 3], glow: 0.8 }); gableZ(b, 'roof', -19, -5, 11.5, -26, 7, 4.6);
      b.box('p3', -12, -20, -26, 14, 13, 30.5, { win: [3, 3], glow: 0.8 }); gableX(b, 'roof', -19, -5, 10.5, -26, 7, 4.4);
      b.rod('dark', [5, 0, 5], [5, 8.6, 5], 0.3, 0.25, 5);
      b.box('sfJade', 5, 7.6, 5, 7, 0.25, 1); b.box('sfJade', 5, 6.4, 5, 0.25, 7, 1);
      b.light([5, 9, 5], 'warm', 0.7);
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
})();
