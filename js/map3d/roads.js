// Seven by Seven, the 3D map: roads. Loaded only when the 3D map is wanted (index.html), after js/map3d/land.js and models.js.
// A SAMPLE OF THE STYLE, NOT A ROAD MAP: two short stretches placed by hand from memory, approximate (roadData.approx), until
// real road data is fetched: the Presidio Parkway (US 101) from the Golden Gate Bridge through the Main Post tunnels (under
// Presidio Tunnel Tops, js/map3d/icons-sf.js) to Lombard Street and Marina Boulevard, and the Bay Bridge approach (I-80) across
// South of Market with the Central Freeway to Market Street.
// Two halves. roadData is the list, in the shape real data would take: a road is ways in order, a way is points [lon, lat] with
// a level (on the ground, a bridge so many metres above it, a tunnel), as a road's ways come from OpenStreetMap; a road may start
// from the end of one of the map's own bridges (from). build(data, env) turns any such list into slim ribbons: a bed with a low
// wall each side, the roadway and its centre line on it, piers where it stands above the ground, lamps and a frame for the
// night's traffic (the bridges' own, js/map3d.js stepLife), in one mesh per place it crosses (so it rises with a selected place).
// The full network is a new list. Widths are drawn 2.6 times and heights above the ground 2.2 times, as the bridges are.
// World frame: x = map x, z = map y (south), y = up. Defines window.M3D.roadData and window.M3D.roads.
(function () {
  'use strict';
  const M3D = window.M3D, land = M3D && M3D.land; if (!land) return;
  const K = 1 / land.UNIT_M, proj = land.proj, WEX = 2.6, VEX = 2.2;
  const lerp = (a, b, t) => a + (b - a) * t, clamp = (v, a, b) => Math.min(b, Math.max(a, v)), sstep = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };

  // ---- the list (approximate: by hand, to about a hundred metres; the Palace of Fine Arts is drawn 5.5 times its size, so the two
  // ramps east of the tunnels bend round it, further out than the real ones) ----
  // w: the roadway's width in metres. layer: -1 for a road that lies just under another where they meet (a ramp leaving it). lvl: 'ground', 'bridge' (h metres above the ground), 'tunnel' (not drawn: what covers it is a model)
  M3D.roadData = { approx: true, source: 'placed by hand, 2026-11; not surveyed', roads: [
    { id: 'us101-presidio-parkway', ref: 'US 101', name: 'Presidio Parkway', w: 19, from: { bridge: 'gg' }, ways: [
      { lvl: 'ground', pts: [[-122.4769, 37.8083], [-122.4757, 37.8072], [-122.4741, 37.8059], [-122.4722, 37.8048], [-122.4702, 37.8040]] },
      { lvl: 'bridge', h: 10, name: 'High Viaduct', pts: [[-122.4702, 37.8040], [-122.4681, 37.8036], [-122.4660, 37.8033]] },
      { lvl: 'ground', pts: [[-122.4660, 37.8033], [-122.4641, 37.8030], [-122.4623, 37.8027]] },   // (the Battery Tunnels are here: drawn open, nothing stands over them yet)
      { lvl: 'bridge', h: 4, pts: [[-122.4623, 37.8027], [-122.4609, 37.8025], [-122.4597, 37.8024]] },
      { lvl: 'tunnel', id: 'main-post', name: 'Main Post Tunnels', pts: [[-122.4597, 37.8024], [-122.4553, 37.8018]] },
      { lvl: 'ground', name: 'Richardson Avenue', pts: [[-122.4553, 37.8018], [-122.4546, 37.8007], [-122.4536, 37.7993], [-122.4517, 37.7982], [-122.4493, 37.7977], [-122.4476, 37.7978]] },
    ] },
    { id: 'us101-marina-boulevard', ref: 'US 101', name: 'to Marina Boulevard', w: 13, layer: -1, ways: [
      { lvl: 'ground', pts: [[-122.4547, 37.8014], [-122.4537, 37.8027], [-122.4524, 37.8045], [-122.4500, 37.8058], [-122.4474, 37.8058]] },
    ] },
    { id: 'i80-bay-bridge-approach', ref: 'I-80', name: 'Bay Bridge approach', w: 17, from: { bridge: 'bayWest' }, ways: [
      { lvl: 'ground', pts: [[-122.3896, 37.7865]] },
      { lvl: 'bridge', h: 19, pts: [[-122.3896, 37.7865], [-122.3912, 37.7858], [-122.3932, 37.7850], [-122.3952, 37.7845], [-122.3972, 37.7829], [-122.3992, 37.7813], [-122.4012, 37.7797], [-122.4032, 37.7781], [-122.4049, 37.7763], [-122.4061, 37.7745], [-122.4069, 37.7726], [-122.4073, 37.7708]] },
    ] },
    { id: 'us101-central-freeway', ref: 'US 101', name: 'Central Freeway', w: 14, ways: [
      { lvl: 'bridge', h: 19, pts: [[-122.4073, 37.7708], [-122.4086, 37.7701], [-122.4105, 37.7698], [-122.4132, 37.7697], [-122.4165, 37.7698], [-122.4194, 37.7700], [-122.4217, 37.7705], [-122.4232, 37.7710]] },
      { lvl: 'ground', pts: [[-122.4232, 37.7710], [-122.4242, 37.7713]] },
    ] },
  ] };

  // points through a list of control points (Catmull-Rom), about `step` apart: [x, z, the control point it follows, how far along to the next]
  function spline(P, step) {
    const out = [], n = P.length;
    for (let i = 0; i < n - 1; i++) {
      const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(n - 1, i + 2)], m = Math.max(1, Math.round(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / step));
      for (let k = 0; k < m; k++) { const t = k / m, t2 = t * t, t3 = t2 * t, f = q => 0.5 * (2 * p1[q] + (p2[q] - p0[q]) * t + (2 * p0[q] - 5 * p1[q] + 4 * p2[q] - p3[q]) * t2 + (3 * p1[q] - p0[q] - 3 * p2[q] + p3[q]) * t3); out.push([f(0), f(1), i, t]); }
    }
    out.push([P[n - 1][0], P[n - 1][1], n - 1, 0]); return out;
  }

  // env: { Builder (js/map3d/models.js), ground(x, z): the ground there, hood(x, z): the place there or -1, frames: the bridges' frames by name }
  // Returns { parts: [{ hood, model }] (a mesh's worth each, as Builder.finish gives), frames: [{ L, lat, D(x, lat, dm) }] for the
  // traffic, near(x, z, r): is the circle on a road (nothing else is to stand there), tris, length }
  function build(data, env) {
    if (!data || !Array.isArray(data.roads)) throw new Error('the road list is not there');
    const STEP = 0.24, parts = new Map(), frames = [], cells = new Map(), ck = (x, z) => Math.floor(x) * 8192 + Math.floor(z); let length = 0;
    const of = hood => { let b = parts.get(hood); if (!b) parts.set(hood, b = new env.Builder()); return b; };
    for (const road of data.roads) {
      // the control points: along the bridge's own roadway first (the ribbon lies on it down to where the deck meets the ground), then
      // the ways. seg: the level of the stretch that leaves a point (where two ways share an end, the second way's); y: a height that is given (the deck's)
      const C = [], hw0 = (road.w || 16) * WEX * K / 2; let hwB = hw0, f = null;
      if (road.from && road.from.bridge) { f = env.frames && env.frames[road.from.bridge]; if (!f) throw new Error('no bridge ' + road.from.bridge + ' for ' + road.id);
        hwB = f.wex * K * 0.72 * (road.from.bridge === 'gg' ? 13.7 : 10.2);                           // (the half width of that bridge's roadway, models.js deckSlab)
        for (const x of [90, 45, 0]) { const p = f.P(x, 0, 0); C.push({ x: p[0], z: p[2], seg: 'deck', h: 0, y: f.deck(x) + 1.4 * f.vex * K + 0.004 }); } }
      for (const w of road.ways || []) for (const q of w.pts || []) { const p = proj(q), l = C[C.length - 1], lvl = w.lvl || 'ground';
        if (l && (l.y != null || Math.hypot(l.x - p[0], l.z - p[1]) < 1e-6)) { l.seg = lvl; l.h = w.h || 0; if (l.y == null) continue; }
        C.push({ x: p[0], z: p[1], seg: lvl, h: w.h || 0 }); }
      if (C.length < 2) continue;
      const S = spline(C.map(c => [c.x, c.z]), STEP).map(q => ({ x: q[0], z: q[1], i: q[2], t: q[3] })), n = S.length;
      // each station: its heading, its level, its half width (the bridge's roadway at first), the ground under it (the highest of the
      // middle and the two edges: the ribbon is never under the land), its clearance
      let s = 0;
      for (let k = 0; k < n; k++) {
        const a = S[Math.max(0, k - 1)], b = S[Math.min(n - 1, k + 1)], st = S[k], l = Math.hypot(b.x - a.x, b.z - a.z) || 1; st.tx = (b.x - a.x) / l; st.tz = (b.z - a.z) / l; st.nx = -st.tz; st.nz = st.tx;
        if (k) s += Math.hypot(st.x - S[k - 1].x, st.z - S[k - 1].z); st.s = s;
        const c = C[st.i], c2 = C[Math.min(C.length - 1, st.i + 1)]; st.lvl = c.y != null && c2.y != null ? 'deck' : c.seg; st.hw = f ? lerp(hwB, hw0, sstep((s - 0.9) / 1.6)) : hw0;
        st.g = Math.max(env.ground(st.x, st.z), env.ground(st.x + st.nx * st.hw, st.z + st.nz * st.hw), env.ground(st.x - st.nx * st.hw, st.z - st.nz * st.hw));
        st.fix = c.y != null && c2.y != null ? lerp(c.y, c2.y, st.t) : c.y != null && st.t === 0 ? c.y : null;
        st.up = st.lvl === 'bridge' ? (c.h || 0) * VEX * K : 0.03;
      }
      // heights: above a smoothed ground by the level's clearance, smoothed along the road (so a viaduct ramps up and down), then
      // never under the land; on a bridge's deck, the deck's; in a tunnel, straight from one mouth to the other
      const gs = S.map((st, k) => { let a = 0, m = 0; for (let q = -4; q <= 4; q++) { const o = S[clamp(k + q, 0, n - 1)]; a += o.g; m++; } return a / m; });
      let Y = S.map((st, k) => st.fix != null ? st.fix : (st.lvl === 'bridge' ? gs[k] : st.g) + st.up);
      for (let it = 0; it < 3; it++) { const Z = Y.slice(); for (let k = 0; k < n; k++) { if (S[k].fix != null) continue; let a = 0, m = 0; for (let q = -3; q <= 3; q++) { const j = clamp(k + q, 0, n - 1); a += Y[j]; m++; } Z[k] = Math.max(a / m, S[k].lvl === 'tunnel' ? -Infinity : S[k].g + 0.03); } Y = Z; }
      for (let k = 0; k < n; k++) if (S[k].lvl === 'tunnel') { let a = k; while (a > 0 && S[a - 1].lvl === 'tunnel') a--; let b = k; while (b < n - 1 && S[b].lvl === 'tunnel') b++; const t = b > a ? (k - a) / (b - a) : 0; Y[k] = lerp(Y[Math.max(0, a - 1)], Y[b], t); }
      S.forEach((st, k) => { st.y = Y[k] + (road.layer || 0) * 0.005; st.hood = env.hood(st.x, st.z); }); for (let k = 1; k < n; k++) if (S[k].hood < 0) S[k].hood = S[k - 1].hood; for (let k = n - 2; k >= 0; k--) if (S[k].hood < 0) S[k].hood = S[k + 1].hood;
      length += s;
      // the ribbon, a run at a time: the same place under it, and not in a tunnel (a run takes the first station of the next, so the pieces meet)
      const at = (st, lat, dy) => [st.x + st.nx * lat, st.y + dy, st.z + st.nz * lat];
      let k0 = 0;
      while (k0 < n - 1) {
        if (S[k0].lvl === 'tunnel') { k0++; continue; }
        let k1 = k0; while (k1 < n - 1 && S[k1].lvl !== 'tunnel' && S[k1].hood === S[k0].hood) k1++;
        const run = S.slice(k0, k1 + 1), b = of(S[k0].hood), ring = (l0, l1, y0, y1) => run.map(st => [at(st, l0(st), y0), at(st, l1(st), y0), at(st, l1(st), y1), at(st, l0(st), y1)]), o = { flat: true, cap0: true };
        if (run.length > 1) {
          const e = 0.022;
          b.loft('rdBed', ring(st => -st.hw - e, st => 0, -0.05, -0.012), o); b.loft('rdBed', ring(st => 0, st => st.hw + e, -0.05, -0.012), o);   // the bed, in two halves as the roadway is (cut the same way, its top never comes up through the roadway where the road turns as it climbs)
          b.loft('rdTop', ring(st => -st.hw, st => 0, -0.014, 0), o); b.loft('rdTop', ring(st => 0, st => st.hw, -0.014, 0), o);   // the roadway, in two halves (so its middle is where the centre line lies, on a bend that climbs too)
          b.loft('rdLine', ring(st => -0.011, st => 0.011, -0.002, 0.003), o);                        // its centre line
          for (const sd of [-1, 1]) b.loft('rdBed', ring(st => sd * (st.hw + e) - (sd > 0 ? e : 0), st => sd * (st.hw + e) + (sd > 0 ? 0 : e), -0.01, 0.024), o);   // a low wall each side
          run.forEach((st, q) => { const k = k0 + q;
            // a pier where the roadway stands clear of the ground: a column under a cross beam, every fifth station
            if (k % 5 === 2 && st.lvl !== 'deck' && st.y - st.g > 0.11) { const ry = -Math.atan2(st.tz, st.tx) * 180 / Math.PI; b.box('rdPier', st.x, st.g - 0.2, st.z, 0.07, st.hw * 0.62, st.y - 0.085 - st.g + 0.2, { ry }); b.box('rdPier', st.x, st.y - 0.085, st.z, 0.09, st.hw * 1.7, 0.036, { ry }); }
            if (k % 6 === 3 && st.lvl !== 'deck') b.light(at(st, (k % 12 === 3 ? 1 : -1) * (st.hw + e), 0.06), 'warm', 0.42);
          });
        }
        k0 = Math.max(k1, k0 + 1);
      }
      // nothing else stands on a road (not its tunnels, which a model covers; not the bridge's own deck)
      for (const st of S) { if (st.lvl === 'tunnel' || st.lvl === 'deck') continue; for (let i = Math.floor(st.x - 1); i <= Math.floor(st.x + 1); i++) for (let j = Math.floor(st.z - 1); j <= Math.floor(st.z + 1); j++) { const key = i * 8192 + j; let l = cells.get(key); if (!l) cells.set(key, l = []); l.push(st.x, st.z, st.hw + 0.07); } }
      // the frame the night's traffic runs on (as a bridge's: x metres along, lat metres to the left, dm metres above the roadway); in a tunnel, out of sight
      const Lw = s, pos = d => { d = clamp(d, 0, Lw); let lo = 0, hi = n - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (S[m].s <= d) lo = m; else hi = m; } const a = S[lo], b = S[hi], t = b.s > a.s ? (d - a.s) / (b.s - a.s) : 0; return [a, b, t]; };
      frames.push({ id: road.id, L: Lw / K, lat: hw0 * 0.5 / (WEX * K), D(x, lat, dm) { const [a, b, t] = pos(x * K), hid = a.lvl === 'tunnel' || b.lvl === 'tunnel', l = lat * WEX * K; return [lerp(a.x + a.nx * l, b.x + b.nx * l, t), hid ? -50 : lerp(a.y, b.y, t) + dm * VEX * K, lerp(a.z + a.nz * l, b.z + b.nz * l, t)]; } });
    }
    const near = (x, z, r) => { const l = cells.get(ck(x, z)); if (!l) return false; for (let k = 0; k < l.length; k += 3) { const dx = x - l[k], dz = z - l[k + 1], rr = l[k + 2] + r; if (dx * dx + dz * dz < rr * rr) return true; } return false; };
    const out = []; let tris = 0; for (const [hood, b] of parts) { if (!b.pos.length) continue; const model = b.finish(); tris += model.tris; out.push({ hood, model }); }
    return { parts: out, frames, near, tris, length: length / K };
  }

  // the colours the roads bring: [paper, night] (taken up with the landmarks' own, js/map3d.js adoptMats)
  (M3D.extra = M3D.extra || []).push({ mats: { rdBed: ['#dcd6c8', '#4a535f'], rdTop: ['#a3a29d', '#262e38'], rdLine: ['#f6f1e4', '#7c8591'], rdPier: ['#c9c2b3', '#3d4651'] } });
  M3D.roads = { build };
})();
