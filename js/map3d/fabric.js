// Seven by Seven, the 3D map: the city fabric. Loaded only when the 3D map is wanted (index.html), after js/map3d/land.js.
// What stands on a block's flat top when the map is close: small buildings along a street grid (low houses with pitched roofs
// where people live, bigger and flatter where it is busy, taller towards the three downtowns and along the Strip), trees and open
// lawn in the parks and the wild places, a few trees in the yards. Nothing here is real data: it is made from what the app knows
// about a place (data/info.js: its character and tags; data/subareas.js: the sections named after a park), from a seed that is
// the place's name and the block's number on its grid, so it is the same on every load.
// Two halves. make(env) decides what stands where: plain numbers in typed arrays, by square of the map (a chunk), made when the
// camera comes near; no THREE in it. gl(THREE, ...) draws a chunk: one instanced mesh of buildings and one of trees, their colour
// read in the shader from a small texture that holds every place's colour as the app paints it (so a lens, a fade or the quiz
// recolours the fabric for nothing), their height grown from the ground as the map comes close.
// World frame: x = map x, z = map y (south), y = up; one unit is one map unit, about 143 m.
(function () {
  'use strict';
  const CS = 12;                                  // the side of a chunk, in map units
  const CLEAR = 0.2;                              // the least room between a building and the edge of its block's top or a line between sections
  const NB = 11, NT = 7;                          // numbers per building [x, y, z, turn, w, h, d, roof, place, tint, slot]; per tree [x, y, z, r, place, tint, slot]
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v)), lerp = (a, b, t) => a + (b - a) * t;
  const hash = str => { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const mix32 = (a, b, c) => { let h = (a ^ Math.imul(b | 0, 0x9E3779B1) ^ Math.imul(c | 0, 0x85EBCA77)) >>> 0; h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D); h ^= h >>> 12; h = Math.imul(h, 0x297A2D39); h ^= h >>> 15; return h >>> 0; };
  function rng(seed) { let s = seed >>> 0; return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  // smooth value noise on a lattice (the groves and the meadows)
  const lat = (i, j, s) => mix32(s, i, j) / 4294967296;
  function noise(x, y, s) { const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy); return lerp(lerp(lat(i, j, s), lat(i + 1, j, s), u), lerp(lat(i, j + 1, s), lat(i + 1, j + 1, s), u), v); }

  // ---- what kind of ground a place is ----
  // park: trees and lawn, nothing built. wild: open country, bigger and fewer trees. The rest is built: how tightly, how tall and
  // how leafy comes from the place's character and tags (below).
  const PARK = ['Golden Gate Park', 'Presidio', 'Angel Island', 'Alcatraz'];
  const WILD = ['Mount Tam & Muir Woods', 'Marin Headlands', 'San Bruno Mountain', 'La Honda', 'Pescadero', 'Muir Beach', 'Stinson Beach', 'Bolinas', 'Inverness', 'Point Reyes Station', 'San Geronimo Valley', 'Lucas Valley', 'Montara & Moss Beach', 'Bodega Bay', 'Guerneville', 'Glen Ellen', 'Woodside', 'Portola Valley', 'Los Altos Hills'];
  // the street grid of a San Francisco place: degrees its streets are turned from east (the downtown grid 9, South of Market 45,
  // the avenues 0), else picked from the name
  const TURN = { 'South of Market': 45, 'Outer Sunset': 0, 'Parkside': 0, 'Inner Sunset': 0, 'Outer Richmond': 0, 'Inner Richmond': 0, 'Lakeshore': 0, 'Seacliff': 0, 'Bayview': 38, 'Excelsior': 32, 'Outer Mission': 32, 'Crocker Amazon': 32, 'Visitacion Valley': 20, 'Potrero Hill': 4, 'Mission': 4, 'Noe Valley': 4, 'Castro/Upper Market': 4, 'Bernal Heights': 12, 'Treasure Island/YBI': 22 };
  // the parks inside a San Francisco place, by the name of the section that is one: the clearing's radius in map units
  const POCKET = { 'Alamo Square': 0.75, 'Buena Vista Park': 1.3, 'Dolores Park': 0.9, 'Washington Square': 0.5, 'Telegraph Hill': 0.8, 'Marina Green': 1.2, 'Fort Mason': 1.1, 'Alta Plaza': 0.8, 'Lafayette Park': 0.8, 'Aquatic Park': 0.7, 'Huntington Park': 0.4, 'Bernal Hill': 1.5, 'Precita Park': 0.5, 'Holly Park': 0.6, 'Balboa Park': 1.2, 'McLaren Park': 3, 'McLaren Park South': 2, 'Crocker Amazon Park': 1.4, 'Bayview Hill & Candlestick': 2, 'Lake Merced': 3, 'Stern Grove': 1.5, 'Fort Funston': 2, 'SF Zoo': 1.6, 'Mount Davidson': 1.5, 'Twin Peaks Summit': 1.6, 'Tank Hill': 0.5, 'Glen Canyon': 1.8, 'Glen Canyon Park': 1.8, 'Lincoln Park': 2.6, 'South Park': 0.35, 'Pine Lake Park': 0.8 };
  const POCKET_RE = /(Regional|State|Memorial|Shoreline|Community|Central|City) Park|Preserve|Open Space|Wilderness|Golf|Marsh|Arboretum|Redwood|Woods\b|Botanical|Reservoir/;
  // where the buildings stand tall: [lon, lat, radius in map units, strength]; and along the Strip (given by the caller)
  const CORES = [[-122.3995, 37.7915, 9, 1], [-122.2712, 37.805, 6.5, 0.7], [-121.889, 37.3335, 6.5, 0.65], [-122.268, 37.8703, 3.2, 0.35], [-122.1617, 37.4447, 2.6, 0.3], [-122.0308, 37.9063, 2.6, 0.3]];

  // env: { HOODS, BB, HT, INFO, SUBD, REGS, proj, inTop(i, x, z), avoid: [[x, z, r], ...], strip: [[x, z], ...] }
  function make(env) {
    const { HOODS, BB, HT, proj } = env, INFO = env.INFO || {}, SUBD = env.SUBD || {}, REGS = env.REGS || {};
    const cores = CORES.map(c => { const p = proj([c[0], c[1]]); return [p[0], p[1], c[2], c[3]]; }), strip = env.strip || [];
    // how tall things stand at a point: 0 at the edge of town, 1 in the middle of downtown
    function core(x, z) {
      let d = 0; for (const c of cores) { const r = Math.hypot(x - c[0], z - c[1]); if (r < c[2]) { const f = 1 - r / c[2]; d = Math.max(d, f * f * (3 - 2 * f) * c[3]); } }
      for (const p of strip) { const r = Math.hypot(x - p[0], z - p[1]); if (r < 3.4) d = Math.max(d, (1 - r / 3.4) * 0.5); }
      return d;
    }
    // the avoid circles, on a coarse grid
    const AV = new Map(), ak = (i, j) => i * 4096 + j;
    for (const a of env.avoid || []) { const r = a[2]; for (let i = Math.floor((a[0] - r) / 4); i <= Math.floor((a[0] + r) / 4); i++) for (let j = Math.floor((a[1] - r) / 4); j <= Math.floor((a[1] + r) / 4); j++) { const k = ak(i, j); if (!AV.has(k)) AV.set(k, []); AV.get(k).push(a); } }
    const blocked = (x, z, r) => { const l = AV.get(ak(Math.floor(x / 4), Math.floor(z / 4))); if (!l) return false; for (const a of l) { const dx = x - a[0], dz = z - a[1], rr = a[2] + r; if (dx * dx + dz * dz < rr * rr) return true; } return false; };

    // ---- a place's plan, made the first time a chunk needs it ----
    const plans = [];
    function plan(i) {
      if (plans[i]) return plans[i];
      const h = HOODS[i], info = INFO[h.name] || {}, tags = info.tags || [], away = !!(REGS[h.region] && REGS[h.region].away), sf = h.region === 'sf', seed = hash(h.name), R = rng(seed);
      const P = { i, seed, kind: PARK.includes(h.name) ? 'park' : WILD.includes(h.name) ? 'wild' : 'built', parks: [], ox: h.cx, oz: h.cy, y: HT[i] };
      const deg = sf ? (TURN[h.name] != null ? TURN[h.name] : 9) : away ? 0 : [0, 0, 12, -20, 33, 45, -8, 24][Math.floor(R() * 8)], a = deg * Math.PI / 180; P.a = a; P.c = Math.cos(a); P.s = Math.sin(a);
      const city = sf || away, dense = tags.includes('dense') || info.vibe === 'buzz', leafy = info.vibe === 'green' || tags.includes('parks'), hilly = info.vibe === 'hills';
      // the block (bw across its two rows of lots, bh along them), the street, the lots and what stands on them
      if (away) Object.assign(P, { bw: 1.8, bh: 2.5, st: 0.4, dp: 0.6, lw0: 0.55, lw1: 1.15, h0: 0.1, h1: 0.26, roof: 0, keep: 0.84, gap: 0.1, green: 0.75, big: 0.22 });
      else if (city && dense) Object.assign(P, { bw: 1.3, bh: 2.3, st: 0.3, dp: 0.44, lw0: 0.34, lw1: 0.7, h0: 0.17, h1: 0.34, roof: 0, keep: 0.94, gap: 0.02, green: 0.12, big: 0.1 });
      else if (city) Object.assign(P, { bw: 1.22, bh: 2.3, st: 0.3, dp: 0.36, lw0: 0.3, lw1: 0.52, h0: 0.11, h1: 0.18, roof: 0.4, keep: 0.93, gap: 0.03, green: leafy ? 0.5 : hilly ? 0.35 : 0.22, big: 0.04 });
      else if (dense) Object.assign(P, { bw: 1.9, bh: 3.0, st: 0.42, dp: 0.56, lw0: 0.5, lw1: 1.0, h0: 0.14, h1: 0.3, roof: 0, keep: 0.8, gap: 0.08, green: 0.3, big: 0.12 });
      else Object.assign(P, { bw: 2.0, bh: 3.2, st: 0.44, dp: 0.5, lw0: 0.46, lw1: 0.8, h0: 0.1, h1: 0.16, roof: 0.42, keep: leafy || hilly ? 0.6 : 0.74, gap: 0.12, green: leafy ? 0.8 : hilly ? 0.6 : 0.4, big: 0.04 });
      if (R() < 0.5 && TURN[h.name] == null) { const t = P.bw; P.bw = P.bh; P.bh = t; P.flip = true; }   // some grids run the other way
      // the parks inside it: the sections named after one
      for (const s of SUBD[h.name] || []) { const r = sf ? POCKET[s.name] : POCKET_RE.test(s.name) ? 2.4 : 0; if (r) { const p = proj([s.lon, s.lat]); P.parks.push([p[0], p[1], r]); } }
      // its sections' seeds: the lines between sections (drawn on the block's top) run along a street kept clear of buildings
      P.seeds = (SUBD[h.name] || []).map(s => proj([s.lon, s.lat])); if (P.seeds.length < 2) P.seeds = null;
      return plans[i] = P;
    }

    // ---- one chunk ----
    function chunk(ix, iz) {
      const x0 = ix * CS, z0 = iz * CS, x1 = x0 + CS, z1 = z0 + CS, B = [], T = [];
      const own = (x, z) => x >= x0 && x < x1 && z >= z0 && z < z1;
      const tree = (P, x, z, r, tint) => { if (!env.inTop(P.i, x, z) || !env.inTop(P.i, x + r, z + r * 0.5) || !env.inTop(P.i, x - r, z - r * 0.5) || blocked(x, z, r * 0.6)) return; T.push(x, P.y, z, r, P.i, tint, 0); };
      for (let i = 0; i < HOODS.length; i++) {
        const bb = BB[i]; if (bb[2] < x0 - 3 || bb[0] > x1 + 3 || bb[3] < z0 - 3 || bb[1] > z1 + 3) continue;
        const P = plan(i), c = P.c, s = P.s;
        const inPark = (x, z) => { for (const p of P.parks) if ((x - p[0]) * (x - p[0]) + (z - p[1]) * (z - p[1]) < p[2] * p[2]) return true; return false; };
        if (P.kind !== 'built') {
          // trees on a loose grid: groves where the noise is high, lawn or open hill between them
          const sp = P.kind === 'park' ? 0.56 : 1.05, f = P.kind === 'park' ? 0.21 : 0.1, cut = P.kind === 'park' ? 0.42 : 0.5;
          for (let gi = Math.floor(x0 / sp); gi * sp < x1; gi++) for (let gj = Math.floor(z0 / sp); gj * sp < z1; gj++) {
            const R = rng(mix32(P.seed, gi, gj)), x = (gi + 0.15 + R() * 0.7) * sp, z = (gj + 0.15 + R() * 0.7) * sp; if (!own(x, z) || x < bb[0] || x > bb[2] || z < bb[1] || z > bb[3]) continue;
            const n = noise(x * f, z * f, P.seed) * 0.7 + noise(x * f * 2.7, z * f * 2.7, P.seed + 7) * 0.3; if (n < cut && R() > 0.05) continue;
            tree(P, x, z, (P.kind === 'park' ? 0.2 + R() * 0.14 : 0.3 + R() * 0.2) * (n > cut + 0.1 ? 1.12 : 0.9), R());
          }
          continue;
        }
        // the corners of the chunk on the place's grid: the blocks whose middle is in this chunk
        let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
        for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) { const dx = x - P.ox, dz = z - P.oz, u = dx * c - dz * s, v = dx * s + dz * c; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
        const rows = P.flip ? 1 : 0, iw = rows ? P.bh - P.st : P.bw - P.st, ih = rows ? P.bw - P.st : P.bh - P.st;   // iw across the two rows of lots, ih along them; flip: the rows run along u instead of v
        for (let gi = Math.floor(u0 / P.bw); gi <= Math.floor(u1 / P.bw); gi++) for (let gj = Math.floor(v0 / P.bh); gj <= Math.floor(v1 / P.bh); gj++) {
          const uc = (gi + 0.5) * P.bw, vc = (gj + 0.5) * P.bh, bx = P.ox + uc * c + vc * s, bz = P.oz - uc * s + vc * c; if (!own(bx, bz)) continue;
          if (bx < bb[0] - 2 || bx > bb[2] + 2 || bz < bb[1] - 2 || bz > bb[3] + 2) continue;
          const R = rng(mix32(P.seed, gi, gj)), d = core(bx, bz), tall = d > 0.22;
          // a lot's building: (a, b) on the block, a across the rows, b along them; w along the row, dp deep
          const put = (a, b, w, dp, hh, roof) => {
            const lu = rows ? b : a, lv = rows ? a : b, x = P.ox + (uc + lu) * c + (vc + lv) * s, z = P.oz - (uc + lu) * s + (vc + lv) * c;
            const sx = rows ? w : dp, sz = rows ? dp : w, hx = sx / 2, hz = sz / 2;   // sx along the grid's u, sz along its v
            if (inPark(x, z) || blocked(x, z, Math.max(hx, hz)) || !env.inTop(P.i, x, z)) return;
            // clear of the block's edge by a narrow street (CLEAR), and of the lines between the place's sections: the two nearest seeds, the distance to their bisector
            for (const [p, q] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) if (!env.inTop(P.i, x + (p * (hx + CLEAR) * c + q * (hz + CLEAR) * s), z + (-p * (hx + CLEAR) * s + q * (hz + CLEAR) * c))) return;
            if (P.seeds) { let a = -1, b = -1, da = Infinity, db = Infinity; for (let k = 0; k < P.seeds.length; k++) { const d = (x - P.seeds[k][0]) ** 2 + (z - P.seeds[k][1]) ** 2; if (d < da) { b = a; db = da; a = k; da = d; } else if (d < db) { b = k; db = d; } }
              if ((db - da) / (2 * Math.hypot(P.seeds[a][0] - P.seeds[b][0], P.seeds[a][1] - P.seeds[b][1]) || 1) < CLEAR + Math.min(hx, hz)) return; }
            // the ridge of a pitched roof runs along the row: the box's long side is turned to lie along local x
            if (sx >= sz) B.push(x, P.y, z, P.a, sx, hh, sz, roof, P.i, R(), 0); else B.push(x, P.y, z, P.a + Math.PI / 2, sz, hh, sx, roof, P.i, R(), 0);
          };
          if (!tall && R() < P.big) { // one big building on the block: a school, a market, a depot
            put(0, 0, ih * (0.5 + R() * 0.3), iw * (0.6 + R() * 0.25), P.h0 * (1.1 + R() * 0.7), 0);
          } else {
            const dp = tall ? iw * 0.45 : Math.min(P.dp, iw * 0.44), k = tall ? 1.7 : 1, keep = tall ? 0.9 : P.keep;
            for (const side of [-1, 1]) {
              let t = -ih / 2;
              while (t < ih / 2 - P.lw0 * k * 0.7) {
                let lw = lerp(P.lw0, P.lw1, R()) * k; if (t + lw > ih / 2 - P.lw0 * k * 0.5) lw = ih / 2 - t;
                const r1 = R(), r2 = R(), r3 = R();
                if (r1 < keep) {
                  const hh = tall ? lerp(P.h0, P.h1, r2) + Math.pow(d, 1.5) * (0.35 + 0.95 * r2 * r2) : lerp(P.h0, P.h1, r2);
                  put(side * (iw / 2 - dp / 2), t + lw / 2, lw - P.gap, dp, hh, tall || r3 > 0.72 ? 0 : P.roof * (0.75 + r3 * 0.5));
                }
                t += lw;
              }
            }
            // the yards down the middle of the block: a few trees
            if (!tall) for (let b = -ih / 2 + 0.2; b < ih / 2 - 0.2; b += 0.42) { const r1 = R(), r2 = R(), r3 = R(); if (r1 > P.green) continue; const lu = rows ? b : (r2 - 0.5) * 0.08, lv = rows ? (r2 - 0.5) * 0.08 : b; tree(P, P.ox + (uc + lu) * c + (vc + lv) * s, P.oz - (uc + lu) * s + (vc + lv) * c, 0.1 + r3 * 0.07, r3); }
          }
        }
        // its parks: trees round a clearing, thicker towards the rim
        for (const p of P.parks) {
          if (p[0] + p[2] < x0 || p[0] - p[2] > x1 || p[1] + p[2] < z0 || p[1] - p[2] > z1) continue; const sp = 0.42;
          for (let gi = Math.floor((p[0] - p[2]) / sp); gi * sp < p[0] + p[2]; gi++) for (let gj = Math.floor((p[1] - p[2]) / sp); gj * sp < p[1] + p[2]; gj++) {
            const R = rng(mix32(P.seed ^ 0x51ed, gi, gj)), x = (gi + 0.2 + R() * 0.6) * sp, z = (gj + 0.2 + R() * 0.6) * sp, q = Math.hypot(x - p[0], z - p[1]) / p[2]; if (!own(x, z) || q > 1) continue;
            const n = noise(x * 0.5, z * 0.5, P.seed); if (R() > 0.12 + 0.5 * q * q + (n > 0.55 ? 0.35 : 0)) continue;
            tree(P, x, z, 0.13 + R() * 0.1, R());
          }
        }
      }
      // in a seeded random order, so the first half of a chunk is an even half of it (a lighter fabric draws a part of each chunk)
      const shuffle = (A, n) => { const R = rng(mix32(77, ix, iz)), m = A.length / n, tmp = new Array(n); for (let i = m - 1; i > 0; i--) { const j = Math.floor(R() * (i + 1)); if (i === j) continue; for (let k = 0; k < n; k++) tmp[k] = A[i * n + k]; for (let k = 0; k < n; k++) { A[i * n + k] = A[j * n + k]; A[j * n + k] = tmp[k]; } } return new Float32Array(A); };
      return { ix, iz, b: shuffle(B, NB), nb: B.length / NB, t: shuffle(T, NT), nt: T.length / NT };
    }
    return { chunk, plan, core };
  }

  // ---- drawing ----
  // U: the uniforms js/map3d.js keeps (uPlace: the texture of place colours and lifts, row 0, and of how far each chunk has grown,
  // row 1; uTexW its width; uGrow: how far the fabric stands, 0 to 1; uFocus: x, z of the view's middle, and the distances between
  // which the fabric sinks away; uPale, uRoofK, uWallK: what the buildings are mixed towards and how far; uTree, uTreeK the same
  // for trees; uWin: the colour of lit windows, black by day)
  function gl(THREE, U) {
    const HEAD = `
attribute vec4 aPos; attribute vec4 aSize; attribute vec3 aInfo;
uniform sampler2D uPlace; uniform float uTexW; uniform float uGrow; uniform vec4 uFocus;
vec4 fabPlace() { return texture2D(uPlace, vec2((aInfo.x + 0.5) / uTexW, 0.25)); }
float fabGrow(vec2 at) { float g = texture2D(uPlace, vec2((aInfo.z + 0.5) / uTexW, 0.75)).r; return uGrow * g * (1.0 - smoothstep(uFocus.z, uFocus.w, distance(at, uFocus.xy))); }
vec3 fabTurn(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); }`;
    // a building: the unit box under a ridge (uv.y marks the ridge's two points; uv.x the two slopes of the roof, by sign)
    const B_POS = `
float fg = fabGrow(aPos.xz); vec4 fpl = fabPlace(); float fr = aSize.w * aSize.z * 0.5;
vec3 transformed = fabTurn(vec3(position.x * aSize.x, (position.y * aSize.y + uv.y * fr) * fg, position.z * aSize.z), aPos.w) * step(0.02, fg) + vec3(aPos.x, aPos.y + fpl.a, aPos.z);`;
    const B_NOR = `
vec3 objectNormal = uv.x != 0.0 ? normalize(vec3(0.0, 0.5 * aSize.z, uv.x * aSize.w * aSize.z * 0.5)) : vec3(normal); objectNormal = fabTurn(objectNormal, aPos.w);`;
    const T_POS = `
float fg = fabGrow(aPos.xz); vec4 fpl = fabPlace();
vec3 transformed = position * aPos.w * vec3(1.0, 1.25, 1.0) * fg * step(0.02, fg) + vec3(aPos.x, aPos.y + fpl.a + aPos.w * 0.8 * fg, aPos.z);`;
    const uni = s => { for (const k in U) s.uniforms[k] = U[k]; };
    const bld = new THREE.MeshStandardMaterial({ metalness: 0, roughness: 0.86 });
    bld.customProgramCacheKey = () => 'm3d-fab-b';
    bld.onBeforeCompile = s => { uni(s);
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>' + HEAD + '\nuniform vec3 uPale; uniform float uRoofK; uniform float uWallK;\nvarying vec3 vFab; varying vec3 vWin;')
        .replace('#include <beginnormal_vertex>', B_NOR).replace('#include <begin_vertex>', B_POS + `
bool top = normal.y > 0.5 || uv.x != 0.0; float ft = aInfo.y;
vec3 fc = mix(fpl.rgb, uPale, top ? uRoofK : uWallK) * (0.9 + 0.2 * fract(ft * 7.31));
if (top && fract(ft * 3.17) > 0.8) fc = mix(fc, fpl.rgb * 0.8, 0.55);
vFab = fc; vWin = vec3((abs(normal.x) > 0.5 ? position.z * aSize.z : position.x * aSize.x) + ft * 9.0, position.y * aSize.y, top ? 0.0 : 1.0);`);
      s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vFab; varying vec3 vWin; uniform vec3 uWin;')
        .replace('#include <color_fragment>', 'diffuseColor.rgb = vFab;')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
if (uWin.r + uWin.g + uWin.b > 0.0) { vec2 wc = vWin.xy / vec2(0.075, 0.06), wi = floor(wc), wf = wc - wi;
  float lit = step(0.6, fract(sin(dot(wi, vec2(12.9898, 78.233))) * 43758.5453)) * step(0.22, wf.x) * step(wf.x, 0.78) * step(0.3, wf.y) * step(wf.y, 0.74);
  float fw = max(fwidth(wc.x), fwidth(wc.y)); totalEmissiveRadiance += uWin * mix(lit, 0.1, clamp(fw * 1.4 - 0.25, 0.0, 1.0)) * vWin.z; }`);
    };
    const tree = new THREE.MeshStandardMaterial({ metalness: 0, roughness: 0.95 });
    tree.customProgramCacheKey = () => 'm3d-fab-t';
    tree.onBeforeCompile = s => { uni(s);
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>' + HEAD + '\nuniform vec3 uTree; uniform float uTreeK;\nvarying vec3 vFab;')
        .replace('#include <begin_vertex>', T_POS + '\nvFab = mix(fpl.rgb, uTree, uTreeK) * (0.8 + 0.4 * fract(aInfo.y * 5.3)) * (0.82 + 0.18 * smoothstep(-0.6, 0.5, position.y));');
      s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vFab;').replace('#include <color_fragment>', 'diffuseColor.rgb = vFab;');
    };
    // what the key light's shadow pass draws: the same shapes
    const depthOf = (pos, key) => { const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }); m.customProgramCacheKey = () => key; m.onBeforeCompile = s => { uni(s); s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>' + HEAD).replace('#include <begin_vertex>', pos); }; return m; };
    const bldDepth = depthOf(B_POS, 'm3d-fab-bd'), treeDepth = depthOf(T_POS, 'm3d-fab-td');
    // the unit building: four walls, two slopes that lie flat when the roof has no pitch, two gable ends
    const bg = (() => {
      const P = [], N = [], V = [], quad = (a, b, c, d, n, uv) => { for (const q of [a, b, c, a, c, d]) { P.push(q[0], q[1], q[2]); N.push(n[0], n[1], n[2]); V.push(uv[0], q[3] || 0); } }, h = 0.5;
      quad([-h, 0, h], [h, 0, h], [h, 1, h], [-h, 1, h], [0, 0, 1], [0]); quad([h, 0, -h], [-h, 0, -h], [-h, 1, -h], [h, 1, -h], [0, 0, -1], [0]);
      quad([h, 0, h], [h, 0, -h], [h, 1, -h], [h, 1, h], [1, 0, 0], [0]); quad([-h, 0, -h], [-h, 0, h], [-h, 1, h], [-h, 1, -h], [-1, 0, 0], [0]);
      quad([-h, 1, h], [h, 1, h], [h, 1, 0, 1], [-h, 1, 0, 1], [0, 1, 0], [1]); quad([h, 1, -h], [-h, 1, -h], [-h, 1, 0, 1], [h, 1, 0, 1], [0, 1, 0], [-1]);
      for (const [x, n] of [[h, 1], [-h, -1]]) for (const q of n > 0 ? [[x, 1, h], [x, 1, -h], [x, 1, 0, 1]] : [[x, 1, -h], [x, 1, h], [x, 1, 0, 1]]) { P.push(q[0], q[1], q[2]); N.push(n, 0, 0); V.push(0, q[3] || 0); }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3)); g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(N), 3)); g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(V), 2)); return g;
    })();
    const tg = new THREE.IcosahedronGeometry(1, 0);
    function inst(base, data, n, per, cx, cy, cz, sizes, mat, depth) {
      const g = new THREE.InstancedBufferGeometry(); for (const k of ['position', 'normal', 'uv']) if (base.attributes[k]) g.setAttribute(k, base.attributes[k]); if (base.index) g.setIndex(base.index);
      const ib = new THREE.InstancedInterleavedBuffer(data, per); let o = 0; for (const [name, sz] of sizes) { g.setAttribute(name, new THREE.InterleavedBufferAttribute(ib, sz, o)); o += sz; }
      g.instanceCount = n; g.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, cy, cz), CS * 0.75 + 3);
      const m = new THREE.Mesh(g, mat); m.customDepthMaterial = depth; m.castShadow = m.receiveShadow = true; m.matrixAutoUpdate = false; m.userData.n = n; return m;
    }
    // the two meshes of a chunk (null where it has nothing), growing with the chunk's slot in the texture
    function mesh(c, slot) {
      for (let i = 0; i < c.nb; i++) c.b[i * NB + 10] = slot; for (let i = 0; i < c.nt; i++) c.t[i * NT + 6] = slot;
      const cx = (c.ix + 0.5) * CS, cz = (c.iz + 0.5) * CS, y = c.nb ? c.b[1] : c.nt ? c.t[1] : 0;
      return { b: c.nb ? inst(bg, c.b, c.nb, NB, cx, y, cz, [['aPos', 4], ['aSize', 4], ['aInfo', 3]], bld, bldDepth) : null, t: c.nt ? inst(tg, c.t, c.nt, NT, cx, y, cz, [['aPos', 4], ['aInfo', 3]], tree, treeDepth) : null };
    }
    return { mesh, mats: { bld, tree, bldDepth, treeDepth }, tris: { b: 14, t: 20 } };
  }

  window.M3D = window.M3D || {};
  window.M3D.fabric = { make, gl, CS, NB, NT };
})();
