// Seven by Seven, the 3D map: the real buildings. Loaded only when the 3D map is wanted (index.html), after js/map3d/land.js and
// js/map3d/buildings.js. In the four areas that file covers (the core of San Francisco, the city's tall buildings, downtown
// Oakland, the Las Vegas Strip) every outline is stood up from its footprint to its height, on the ground where it is, in place
// of what js/map3d/fabric.js and the filler towers of js/map3d/models.js make up there.
// Two halves, as the fabric has. make(data, env) unpacks the outlines, sorts them by square of the map (a chunk) and answers the
// fabric's questions (is a point built on, is it in the part of town where every building is real); chunk(ix, iz) makes one
// square's buildings as one merged shape: plain numbers in typed arrays, no THREE in it. gl(THREE, U) draws a chunk with the
// fabric's own uniforms: a building's colour is read from the texture of place colours (so a lens, a fade or the quiz recolours it
// for nothing), mixed towards the pale of the look, further for a tower; it grows from the ground as the map comes close; its
// windows are lit at night. Heights: metres times V (see below) on a map where one unit is about 143 m.
// World frame: x = map x, z = map y (south), y = up. Defines window.M3D.real.
(function () {
  'use strict';
  const M3D = window.M3D, land = M3D && M3D.land; if (!land) return;
  const Geom = window.Geom, K = 1 / land.UNIT_M;
  const CS = 6;                                   // the side of a chunk, in map units
  const V = 2;                                    // heights are drawn at twice the map's scale: about what the ground's own heights and the fabric's houses are drawn at, and near the landmark models' enlargement (2.5 for the two downtown towers), so they stand right among their neighbours without the real towers turning to needles
  const CELL = 1.5;                               // the grid that answers "is this point built on"
  const NV = 3, NB = 4, NW = 4;                   // numbers per vertex: position; aB [the ground it grows from, place, tint, the chunk's slot]; aW [along the wall, above the ground, 1 wall / 0 roof, the building's height]

  // one area of js/map3d/buildings.js (its header gives the format): [{ h, base, roof, pts: [x, y, ...] metres east and north }]
  function unpack(area) {
    const bin = atob(area.data), n = bin.length, s = new Uint8Array(n); for (let k = 0; k < n; k++) s[k] = bin.charCodeAt(k);
    let i = 0, px = 0, py = 0; const out = [];
    const uv = () => { let v = 0, m = 1, b; do { if (i >= n) throw new Error('the building data is cut short'); b = s[i++]; v += (b & 127) * m; m *= 128; } while (b & 128); return v; };
    const sv = () => { const u = uv(); return u & 1 ? -(u + 1) / 2 : u / 2; };
    while (i < n) {
      const h = uv(), base = uv(), roof = uv(), np = uv(); if (np < 3 || np > 4000) throw new Error('the building data is not whole');
      const pts = new Float64Array(np * 2); let x = px + sv(), y = py + sv(); px = x; py = y; pts[0] = x; pts[1] = y;
      for (let k = 1; k < np; k++) { x += sv(); y += sv(); pts[k * 2] = x; pts[k * 2 + 1] = y; }
      out.push({ h, base, roof, pts });
    }
    return out;
  }
  const inRing = (p, n, x, z) => { let c = false; for (let i = 0, j = n - 1; i < n; j = i++) { const xi = p[i * 2], zi = p[i * 2 + 1], xj = p[j * 2], zj = p[j * 2 + 1]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
  // a simple polygon (x, z pairs, counter-clockwise as land.js counts area) cut into triangles by its ears: indices into it
  function ears(p, n, out) {
    const v = []; for (let i = 0; i < n; i++) v.push(i);
    const X = (a, b, c) => (p[b * 2] - p[a * 2]) * (p[c * 2 + 1] - p[b * 2 + 1]) - (p[b * 2 + 1] - p[a * 2 + 1]) * (p[c * 2] - p[b * 2]); let guard = 0;
    while (v.length > 3 && guard++ < 5000) {
      const m = v.length; let cut = -1;
      for (let i = 0; i < m && cut < 0; i++) { const a = v[(i + m - 1) % m], b = v[i], c = v[(i + 1) % m]; if (!(X(a, b, c) > 1e-12)) continue; let ok = true; for (let k = 0; k < m && ok; k++) { const q = v[k]; if (q === a || q === b || q === c) continue; if (X(a, b, q) > 1e-12 && X(b, c, q) > 1e-12 && X(c, a, q) > 1e-12) ok = false; } if (ok) cut = i; }
      if (cut < 0) { let bm = Infinity; for (let i = 0; i < m; i++) { const q = Math.abs(X(v[(i + m - 1) % m], v[i], v[(i + 1) % m])); if (q < bm) { bm = q; cut = i; } } }
      const a = v[(cut + m - 1) % m], b = v[cut], c = v[(cut + 1) % m]; if (X(a, b, c) >= 0) out.push(a, b, c); v.splice(cut, 1);
    }
    if (v.length === 3 && X(v[0], v[1], v[2]) >= 0) out.push(v[0], v[1], v[2]);
  }

  // env: { inTop(x, z): the place whose block's top holds the point, or -1; inTopOf(i, x, z); hAt(i, x, z): the ground of place i
  // there; boxes: [[x0, z0, x1, z1], ...] the plans of the landmark models (a model wins over the outline at its spot) }
  function make(data, env) {
    if (!data || !Array.isArray(data.areas) || !data.areas.length) throw new Error('the building data is not there');
    const chunks = new Map(), grid = new Map(), dens = new Map(), ck = (x, z) => Math.floor(x / CELL) * 8192 + Math.floor(z / CELL); let total = 0;
    for (const a of data.areas) {
      const list = unpack(a); if (a.count != null && list.length !== a.count) throw new Error('the building data is cut short: ' + list.length + ' of ' + a.count + ' in ' + a.name);
      const o = a.origin, kx = 1 / (111320 * Math.cos(o[1] * Math.PI / 180)), core = a.name === 'sf-core';
      for (const b of list) {
        const n = b.pts.length / 2, p = new Float32Array(n * 2); let ar = 0, cx = 0, cz = 0, x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
        for (let k = 0; k < n; k++) { const q = Geom.proj([o[0] + b.pts[k * 2] * kx, o[1] + b.pts[k * 2 + 1] / 111320]); p[k * 2] = q[0]; p[k * 2 + 1] = q[1]; cx += q[0]; cz += q[1]; if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < z0) z0 = q[1]; if (q[1] > z1) z1 = q[1]; }
        for (let k = 0, j = n - 1; k < n; j = k++) ar += p[j * 2] * p[k * 2 + 1] - p[k * 2] * p[j * 2 + 1];
        if (ar < 0) { for (let k = 0; k < n >> 1; k++) { const j = n - 1 - k, tx = p[k * 2], tz = p[k * 2 + 1]; p[k * 2] = p[j * 2]; p[k * 2 + 1] = p[j * 2 + 1]; p[j * 2] = tx; p[j * 2 + 1] = tz; } ar = -ar; }   // the solid on the left, as land.js winds its rings
        if (!(ar > 1e-5) || !(b.h > 0)) continue;
        const rec = { p, n, h: b.h, base: b.base, roof: b.roof, cx: cx / n, cz: cz / n, x0, z0, x1, z1, area: ar / 2, tint: ((total * 2654435761) >>> 0) / 4294967296, place: undefined }; total++;
        const key = Math.floor(rec.cx / CS) * 65536 + Math.floor(rec.cz / CS); let l = chunks.get(key); if (!l) chunks.set(key, l = []); l.push(rec);
        for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) for (let j = Math.floor(z0 / CELL); j <= Math.floor(z1 / CELL); j++) { const g = i * 8192 + j; let q = grid.get(g); if (!q) grid.set(g, q = []); q.push(rec); }
        if (core) { const g = ck(rec.cx, rec.cz); dens.set(g, (dens.get(g) || 0) + 1); }
      }
    }
    // is the circle r round a point built on (by any outline, kept or not: nothing made up stands there either)
    function solid(x, z, r) {
      for (let i = Math.floor((x - r) / CELL); i <= Math.floor((x + r) / CELL); i++) for (let j = Math.floor((z - r) / CELL); j <= Math.floor((z + r) / CELL); j++) {
        const l = grid.get(i * 8192 + j); if (!l) continue;
        for (const b of l) { if (x + r < b.x0 || x - r > b.x1 || z + r < b.z0 || z - r > b.z1) continue; if (inRing(b.p, b.n, x, z)) return true;
          for (let k = 0, q = b.n - 1; k < b.n; q = k++) { const ax = b.p[q * 2], az = b.p[q * 2 + 1], dx = b.p[k * 2] - ax, dz = b.p[k * 2 + 1] - az, l2 = dx * dx + dz * dz; let t = l2 ? ((x - ax) * dx + (z - az) * dz) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t; const ex = ax + dx * t - x, ez = az + dz * t - z; if (ex * ex + ez * ez < r * r) return true; } }
      }
      return false;
    }
    // the part of town where every building is real (the core of San Francisco): nothing is made up there, built or not
    const dense = (x, z) => (dens.get(ck(x, z)) || 0) >= 2;
    // where a building stands: not under a landmark's plan, and on the top of one place
    function settle(b) {
      b.place = -1;
      for (const q of env.boxes || []) { if (b.cx > q[0] && b.cx < q[2] && b.cz > q[1] && b.cz < q[3]) return; const mx = (q[0] + q[2]) / 2, mz = (q[1] + q[3]) / 2; if (mx > b.x0 && mx < b.x1 && mz > b.z0 && mz < b.z1 && inRing(b.p, b.n, mx, mz)) return; }
      const i = env.inTop(b.cx, b.cz); if (i < 0) return; let on = 0; for (let k = 0; k < b.n; k++) if (env.inTopOf(i, b.p[k * 2], b.p[k * 2 + 1])) on++;
      if (on >= b.n * 0.7) b.place = i;
    }
    const has = (ix, iz) => chunks.has(ix * 65536 + iz);
    // one chunk's buildings as one shape, the tallest first (a lighter picture draws the first part of it): null when it has none
    function chunk(ix, iz) {
      const list = chunks.get(ix * 65536 + iz); if (!list) return null;
      const keep = []; for (const b of list) { if (b.place === undefined) settle(b); if (b.place >= 0) keep.push(b); } if (!keep.length) return null;
      keep.sort((a, b) => b.h - a.h);
      const pos = [], nor = [], aB = [], aW = [], idx = [], tri = [], cuts = []; let nv = 0, y0 = Infinity, y1 = -Infinity;
      const vert = (x, y, z, nx, ny, nz, g, b, u, v, wall, bh) => { pos.push(x, y, z); nor.push(nx, ny, nz); aB.push(g, b.place, b.tint, 0); aW.push(u, v, wall, bh); if (y < y0) y0 = y; if (y > y1) y1 = y; return nv++; };
      keep.forEach((b, bi) => {
        const p = b.p, n = b.n, i = b.place, gc = env.hAt(i, b.cx, b.cz); let g = gc; for (let k = 0; k < n; k++) { const q = env.hAt(i, p[k * 2], p[k * 2 + 1]); if (q < g) g = q; }
        // on a slope it stands on the lowest ground under its outline and is as tall above the ground at its middle as on the flat; a part that starts above the ground (base) hangs from there
        const hh = b.h * K * V, top = gc + hh, bot = b.base > 0 && b.base < b.h ? gc + b.base * K * V : g - 0.02, u0 = b.tint * 9;
        const ring = (q, s, y, lift) => { // walls up from a ring (q scaled by s about the middle) from y to y + lift, and a flat lid on them
          let acc = u0; const at = k => [b.cx + (q[k * 2] - b.cx) * s, b.cz + (q[k * 2 + 1] - b.cz) * s];
          for (let k = 0; k < n; k++) { const a = at(k), c = at((k + 1) % n), dx = c[0] - a[0], dz = c[1] - a[1], l = Math.hypot(dx, dz); if (l < 1e-6) continue; const nx = dz / l, nz = -dx / l;
            const v0 = vert(a[0], y, a[1], nx, 0, nz, g, b, acc, y - gc, 1, hh), v1 = vert(c[0], y, c[1], nx, 0, nz, g, b, acc + l, y - gc, 1, hh), v2 = vert(c[0], y + lift, c[1], nx, 0, nz, g, b, acc + l, y + lift - gc, 1, hh), v3 = vert(a[0], y + lift, a[1], nx, 0, nz, g, b, acc, y + lift - gc, 1, hh);
            idx.push(v0, v2, v1, v0, v3, v2); acc += l; }
          const base = nv; for (let k = 0; k < n; k++) { const a = at(k); vert(a[0], y + lift, a[1], 0, 1, 0, g, b, 0, y + lift - gc, 0, hh); }
          return base;
        };
        const lid = base => { tri.length = 0; ears(p, n, tri); for (let k = 0; k < tri.length; k += 3) idx.push(base + tri[k], base + tri[k + 2], base + tri[k + 1]); };
        const base = ring(p, 1, bot, top - bot); let convex = n <= 12; for (let k = 0; k < n && convex; k++) { const a = k, c = (k + 1) % n, d = (k + 2) % n; if ((p[c * 2] - p[a * 2]) * (p[d * 2 + 1] - p[c * 2 + 1]) - (p[c * 2 + 1] - p[a * 2 + 1]) * (p[d * 2] - p[c * 2]) < -1e-9) convex = false; }
        const span = Math.sqrt(b.area);
        if (b.roof === 1 || b.roof === 2 || b.roof === 3 || b.roof === 4 || b.roof === 6 || b.roof === 7) {
          // a roof that rises to the middle: one tier for a pyramid, a gable or a hip (low), two for a dome
          const round = b.roof === 2 || b.roof === 6 || b.roof === 7, rh = Math.min(round ? 0.5 * span : 0.28 * span, 0.7), tiers = round ? [[0.66, 0.68], [0, 1]] : [[0, 1]]; let ps = 1, py = 0;
          for (const [s, f] of tiers) { for (let k = 0; k < n; k++) { const c = (k + 1) % n, A = [b.cx + (p[k * 2] - b.cx) * ps, top + rh * py, b.cz + (p[k * 2 + 1] - b.cz) * ps], B = [b.cx + (p[c * 2] - b.cx) * ps, top + rh * py, b.cz + (p[c * 2 + 1] - b.cz) * ps], C = [b.cx + (p[c * 2] - b.cx) * s, top + rh * f, b.cz + (p[c * 2 + 1] - b.cz) * s], D = [b.cx + (p[k * 2] - b.cx) * s, top + rh * f, b.cz + (p[k * 2 + 1] - b.cz) * s];
              let nx = (C[1] - A[1]) * (B[2] - A[2]) - (C[2] - A[2]) * (B[1] - A[1]), ny = (C[2] - A[2]) * (B[0] - A[0]) - (C[0] - A[0]) * (B[2] - A[2]), nz = (C[0] - A[0]) * (B[1] - A[1]) - (C[1] - A[1]) * (B[0] - A[0]); const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l; if (ny < 0) { nx = -nx; ny = -ny; nz = -nz; }
              const a0 = vert(A[0], A[1], A[2], nx, ny, nz, g, b, 0, A[1] - gc, 0, hh), b0 = vert(B[0], B[1], B[2], nx, ny, nz, g, b, 0, B[1] - gc, 0, hh), c0 = vert(C[0], C[1], C[2], nx, ny, nz, g, b, 0, C[1] - gc, 0, hh); idx.push(a0, c0, b0);
              if (s > 0) { const d0 = vert(D[0], D[1], D[2], nx, ny, nz, g, b, 0, D[1] - gc, 0, hh); idx.push(a0, d0, c0); } }
            ps = s; py = f; }
        } else {
          lid(base);
          // a tower with a plain flat top gets what stands on such roofs: a set-back storey, and on the tallest a plant room on that
          if (convex && b.h >= 40 && span > 0.12) { const c1 = ring(p, 0.72, top, Math.min(0.09, hh * 0.05) + 0.02 * b.tint); lid(c1); if (b.h >= 110) lid(ring(p, 0.4, top + Math.min(0.09, hh * 0.05) + 0.02 * b.tint, 0.07 + 0.05 * b.tint)); }
        }
        if (bi + 1 === Math.ceil(keep.length * 0.25)) cuts[0] = idx.length; if (bi + 1 === Math.ceil(keep.length * 0.5)) cuts[1] = idx.length;
      });
      return { ix, iz, count: keep.length, n: nv, pos: new Float32Array(pos), nor: new Float32Array(nor), aB: new Float32Array(aB), aW: new Float32Array(aW), idx: nv > 65535 ? new Uint32Array(idx) : new Uint16Array(idx), quarter: cuts[0] || idx.length, half: cuts[1] || idx.length, y0, y1 };
    }
    return { chunk, has, solid, dense, total, CS };
  }

  // ---- drawing ----
  // U: the fabric's uniforms (js/map3d/fabric.js gl): the texture of place colours and lifts (row 0) and of each chunk's growth
  // (row 1), how far the fabric stands, the circle it stands in, what it is mixed towards, the colour of lit windows
  function gl(THREE, U) {
    const HEAD = `
attribute vec4 aB; attribute vec4 aW;
uniform sampler2D uPlace; uniform float uTexW; uniform float uGrow; uniform vec4 uFocus;`;
    const POS = `
vec4 fpl = texture2D(uPlace, vec2((aB.y + 0.5) / uTexW, 0.25));
float fg = uGrow * texture2D(uPlace, vec2((aB.w + 0.5) / uTexW, 0.75)).r * (1.0 - smoothstep(uFocus.z, uFocus.w, distance(position.xz, uFocus.xy)));
vec3 transformed = step(0.02, fg) * vec3(position.x, aB.x + (position.y - aB.x) * fg + fpl.a, position.z);`;
    const uni = s => { for (const k in U) s.uniforms[k] = U[k]; };
    const mat = new THREE.MeshStandardMaterial({ metalness: 0, roughness: 0.84 });
    mat.customProgramCacheKey = () => 'm3d-real';
    mat.onBeforeCompile = s => { uni(s);
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>' + HEAD + '\nuniform vec3 uPale; uniform float uRoofK; uniform float uWallK;\nvarying vec3 vFab; varying vec4 vWin;')
        .replace('#include <begin_vertex>', POS + `
bool top = aW.z < 0.5; float ft = aB.z, tall = smoothstep(0.3, 1.7, aW.w);
// the place's colour towards the pale of the look: a house keeps most of its place, a tower stands pale among them
vec3 fc = mix(fpl.rgb, uPale, top ? uRoofK + (0.82 - uRoofK) * 0.7 * tall : uWallK + (0.86 - uWallK) * 0.72 * tall) * (0.9 + 0.2 * fract(ft * 7.31));
if (top && fract(ft * 3.17) > 0.8) fc = mix(fc, fpl.rgb * 0.8, 0.55 * (1.0 - tall));
if (!top) fc *= 0.84 + 0.16 * smoothstep(0.0, 0.26, aW.y);   // a little darker at its foot, where its neighbours stand close
vFab = fc; vWin = vec4(aW.x, aW.y, top ? 0.0 : 1.0, tall);`);
      s.fragmentShader = s.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vFab; varying vec4 vWin; uniform vec3 uWin;')
        .replace('#include <color_fragment>', `diffuseColor.rgb = vFab;
{ float fl = vWin.y / 0.058, fw = fwidth(fl); // the floors of a tall building, as faint bands, gone before they could shimmer
  diffuseColor.rgb *= 1.0 - 0.085 * smoothstep(0.36, 0.5, abs(fract(fl) - 0.5)) * (1.0 - clamp(fw * 1.7 - 0.2, 0.0, 1.0)) * vWin.z * (0.3 + 0.7 * vWin.w); }`)
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
if (uWin.r + uWin.g + uWin.b > 0.0) { vec2 wc = vWin.xy / vec2(0.075, 0.058), wi = floor(wc), wf = wc - wi;
  float lit = step(0.6 - 0.12 * vWin.w, fract(sin(dot(wi, vec2(12.9898, 78.233))) * 43758.5453)) * step(0.22, wf.x) * step(wf.x, 0.78) * step(0.3, wf.y) * step(wf.y, 0.74);
  float fw = max(fwidth(wc.x), fwidth(wc.y)); totalEmissiveRadiance += uWin * mix(lit, 0.11 + 0.05 * vWin.w, clamp(fw * 1.4 - 0.25, 0.0, 1.0)) * vWin.z; }`);
    };
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }); depth.customProgramCacheKey = () => 'm3d-real-d';
    depth.onBeforeCompile = s => { uni(s); s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>' + HEAD).replace('#include <begin_vertex>', POS); };
    // a chunk's mesh, growing with its slot in the texture
    function mesh(c, slot) {
      for (let i = 0; i < c.n; i++) c.aB[i * NB + 3] = slot;
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(c.pos, NV)); g.setAttribute('normal', new THREE.BufferAttribute(c.nor, 3)); g.setAttribute('aB', new THREE.BufferAttribute(c.aB, NB)); g.setAttribute('aW', new THREE.BufferAttribute(c.aW, NW)); g.setIndex(new THREE.BufferAttribute(c.idx, 1));
      const up = isFinite(c.y0) ? (c.y1 - c.y0) / 2 : 0; g.boundingSphere = new THREE.Sphere(new THREE.Vector3((c.ix + 0.5) * CS, isFinite(c.y0) ? (c.y0 + c.y1) / 2 : 0, (c.iz + 0.5) * CS), CS * 0.75 + 2 + up + 1);
      const m = new THREE.Mesh(g, mat); m.customDepthMaterial = depth; m.castShadow = m.receiveShadow = true; m.matrixAutoUpdate = false; return m;
    }
    return { mesh, mats: { mat, depth } };
  }

  M3D.real = { make, gl, CS, V };
})();
