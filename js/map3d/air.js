// Seven by Seven, the 3D map: light, air and what moves. Loaded only when the 3D map is wanted (index.html), after js/map3d/land.js.
// The pieces js/map3d.js puts into its scene: where the sun stands for the hour (the light theme follows the day, gently), the
// sky behind a tilted view, the water's moving surface and its glint, the soft wash where water meets land, the fog bank over the
// foggy places, the ferries and the traffic on the bridges at night. Everything is made in code. Nothing here runs a clock: each
// piece has uniforms that js/map3d.js moves while its ambient motion runs, and leaves alone when it has stopped.
// World frame: x = map x, z = map y (south), y = up. Needs THREE. Defines window.M3D.air.
(function () {
  'use strict';
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v)), lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (v, a, b) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  // ---- the sun for an hour of the day (0 to 24, the reader's clock) and a day of the year ----
  // The map keeps a mapmaker's light, from the top of the sheet, so the near walls stay in shade and the blocks read; within that,
  // the day shows: the light comes from the east in the morning and the west in the evening, low and warm at both ends, high and
  // neutral at noon. Before sunrise and after dusk the light theme keeps its plain day look (the night belongs to the dark theme).
  // Returns { az, el (degrees), warm (0 neutral to 1 golden), low (0 high sun to 1 at the horizon) }
  function sun(hour, doy) {
    const half = 6.1 + 1.3 * Math.cos((doy - 172) / 365 * Math.PI * 2), noon = 12.4, rise = noon - half, set = noon + half; // half a day's length at this latitude, roughly
    const plain = { az: 302, el: 44, warm: 0, low: 0 };
    if (!(hour > rise - 0.5 && hour < set + 0.5)) return plain;
    const t = clamp((hour - rise) / (set - rise), 0, 1), up = Math.sin(Math.PI * t), day = { az: (lerp(62, -58, t) + 360) % 360, el: 24 + 28 * Math.pow(up, 0.8), warm: Math.pow(1 - up, 1.6), low: 1 - up };
    const k = smooth(Math.min(hour - (rise - 0.5), set + 0.5 - hour), 0, 0.6); // half an hour of twilight either side: from the plain look and back
    let d = day.az - plain.az; d = ((d + 540) % 360) - 180;
    return { az: (plain.az + d * k + 360) % 360, el: lerp(plain.el, day.el, k), warm: day.warm * k, low: day.low * k };
  }

  // ---- one small tiling texture of soft noise: rg its slope (the water's ripples), b and a two heights (the fog's shape) ----
  function noiseTex(THREE) {
    const N = 256, lat = (i, j, s, p) => { let h = (s ^ Math.imul(((i % p) + p) % p, 0x9E3779B1) ^ Math.imul(((j % p) + p) % p, 0x85EBCA77)) >>> 0; h ^= h >>> 15; h = Math.imul(h, 0x2C1B3C6D); h ^= h >>> 12; h = Math.imul(h, 0x297A2D39); h ^= h >>> 15; return (h >>> 0) / 4294967296; };
    const val = (x, y, s, p) => { const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j, u = fx * fx * fx * (fx * (fx * 6 - 15) + 10), v = fy * fy * fy * (fy * (fy * 6 - 15) + 10); return lerp(lerp(lat(i, j, s, p), lat(i + 1, j, s, p), u), lerp(lat(i, j + 1, s, p), lat(i + 1, j + 1, s, p), u), v); };
    const fbm = (x, y, s, p0, oct) => { let a = 0, w = 0.5, t = 0, p = p0; for (let o = 0; o < oct; o++) { a += val(x * p, y * p, s + o * 101, p) * w; t += w; w *= 0.5; p *= 2; } return a / t; };
    const H = new Float32Array(N * N), F1 = new Float32Array(N * N), F2 = new Float32Array(N * N);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const u = x / N, v = y / N, k = y * N + x; H[k] = fbm(u, v, 11, 6, 4); F1[k] = fbm(u, v, 501, 3, 4); F2[k] = fbm(u, v, 907, 5, 3); }
    const D = new Uint8Array(N * N * 4), at = (x, y) => H[((y + N) % N) * N + ((x + N) % N)];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) { const k = y * N + x; D[k * 4] = clamp(Math.round(127.5 + (at(x + 1, y) - at(x - 1, y)) * 1500), 0, 255); D[k * 4 + 1] = clamp(Math.round(127.5 + (at(x, y + 1) - at(x, y - 1)) * 1500), 0, 255); D[k * 4 + 2] = Math.round(clamp((F1[k] - 0.25) * 2, 0, 1) * 255); D[k * 4 + 3] = Math.round(clamp((F2[k] - 0.25) * 2, 0, 1) * 255); }
    const t = new THREE.DataTexture(D, N, N, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true; return t;
  }
  const flatNoise = THREE => { const t = new THREE.DataTexture(new Uint8Array([128, 128, 128, 128]), 1, 1, THREE.RGBAFormat); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; return t; };

  // ---- the sky: one sheet behind everything, coloured by how high each pixel looks ----
  // set(c, W, H): the camera's axes (js/map3d.js camOf). Colours: horizon (the haze the far land fades into), zenith, and a warm
  // glow low on the sun's side.
  function sky(THREE) {
    const U = { uF: { value: new THREE.Vector3() }, uR: { value: new THREE.Vector3() }, uU: { value: new THREE.Vector3() }, uHorizon: { value: new THREE.Color() }, uZenith: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() }, uSun: { value: new THREE.Vector3(0, 1, 0) } };
    const mat = new THREE.ShaderMaterial({ uniforms: U, depthTest: false, depthWrite: false, fog: false,
      vertexShader: 'uniform vec3 uF; uniform vec3 uR; uniform vec3 uU; varying vec3 vDir;\nvoid main(){ vDir = uF + uR * position.x + uU * position.y; gl_Position = vec4(position.xy, 1.0, 1.0); }',
      fragmentShader: `uniform vec3 uHorizon; uniform vec3 uZenith; uniform vec3 uGlow; uniform vec3 uSun; varying vec3 vDir;
void main(){ vec3 d = normalize(vDir); float e = max(d.y, 0.0);
  vec3 c = mix(uHorizon, uZenith, smoothstep(0.0, 0.2, e) * 0.9 + smoothstep(0.0, 0.04, e) * 0.1);
  float s = max(dot(normalize(d.xz + 1e-5), normalize(uSun.xz + 1e-5)), 0.0); c += uGlow * pow(s, 4.0) * e * 20.0 * exp(1.0 - e * 20.0);   // nothing at the horizon itself (the far ground has no glow), most a few degrees up
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}` });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat); mesh.frustumCulled = false; mesh.renderOrder = -1000; mesh.matrixAutoUpdate = false;
    return { mesh, U, set(c, W, H) { const a = W / 2 / c.g, b = H / 2 / c.g; U.uF.value.set(c.fx, c.fy, c.fz); U.uR.value.set(c.rx * a, 0, c.rz * a); U.uU.value.set(c.ux * b, c.uy * b, c.uz * b); } };
  }

  // ---- the water: the sea's own material, with ripples that drift and a soft glint towards the sun ----
  // The ripples are a slope added to the flat normal, read from the noise at a size that follows the camera's distance (two sizes,
  // cross-faded), so they look the same from across the bay and from a pier; small textures of it are averaged, so nothing sparkles.
  // U.uT: seconds of ambient motion; uD: the camera's distance; uWave: how steep; uGlint: how bright; uSun, uSunC: the light.
  function water(THREE, mat) {
    const U = { uT: { value: 0 }, uD: { value: 100 }, uWave: { value: 0.1 }, uGlint: { value: 0.2 }, uSun: { value: new THREE.Vector3(0, 1, 0) }, uSunC: { value: new THREE.Color(1, 1, 1) }, uNoise: { value: flatNoise(THREE) } };
    mat.customProgramCacheKey = () => 'm3d-water';
    mat.onBeforeCompile = s => { for (const k in U) s.uniforms[k] = U[k];
      s.vertexShader = s.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      s.fragmentShader = s.fragmentShader.replace('#include <common>', `#include <common>
varying vec3 vWp; uniform float uT; uniform float uD; uniform float uWave; uniform float uGlint; uniform vec3 uSun; uniform vec3 uSunC; uniform sampler2D uNoise;
vec2 m3dRipple(vec2 p, float s) { p = vec2(p.x * 0.8 + p.y * 0.6, (p.y * 0.8 - p.x * 0.6) * 2.3); return (texture2D(uNoise, p / s + uT * vec2(0.004, 0.016)).rg - 0.5) + (texture2D(uNoise, p.yx / (s * 0.63) - uT * vec2(0.012, 0.003)).rg - 0.5); } // long ripples, lying across the wind`)
        .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
{ float ls = log2(max(uD, 1.0)), fl = floor(ls); vec2 rp = mix(m3dRipple(vWp.xz, exp2(fl) * 0.085), m3dRipple(vWp.xz, exp2(fl + 1.0) * 0.085), ls - fl);
  vec3 wn = normalize(vec3(rp.x * uWave, 1.0, rp.y * uWave)); normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
  vec3 gn = normalize(vec3(rp.x * 0.14, 1.0, rp.y * 0.14)), wv = normalize(cameraPosition - vWp); float gl = max(dot(reflect(-wv, gn), uSun), 0.0);
  totalEmissiveRadiance += uSunC * (pow(gl, 220.0) * 0.3 + pow(gl, 28.0) * 0.1) * uGlint; }`);
    };
    return U;
  }

  // ---- the wash: a soft light band on the water round every block, widest where the block meets it, breathing a little ----
  // rings: every block's outline at its foot (solid on the left of the direction of travel). U.uT, uK (how strong), uCol.
  function wash(THREE, rings) {
    const P = [], A = [], I = [], WD = 0.5; let n = 0;
    for (const r of rings) {
      const m = r.length, base = n; let arc = 0;
      for (let i = 0; i < m; i++) {
        const a = r[(i - 1 + m) % m], p = r[i], b = r[(i + 1) % m]; let ex = p[0] - a[0], ey = p[1] - a[1], fx = b[0] - p[0], fy = b[1] - p[1]; const le = Math.hypot(ex, ey) || 1, lf = Math.hypot(fx, fy) || 1; ex /= le; ey /= le; fx /= lf; fy /= lf;
        let mx = ey + fy, my = -ex - fx; const ml = Math.hypot(mx, my); if (ml < 1e-6) { mx = ey; my = -ex; } else { mx /= ml; my /= ml; }
        const q = WD / Math.max(0.5, mx * ey - my * ex); arc += le;
        P.push(p[0] - mx * 0.03, 0, p[1] - my * 0.03, p[0] + mx * q, 0, p[1] + my * q); A.push(1, arc, 0, arc); n += 2;
      }
      for (let i = 0; i < m; i++) { const j = (i + 1) % m, a = base + i * 2, b = base + j * 2; I.push(a, a + 1, b, b, a + 1, b + 1); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(P), 3)); g.setAttribute('aEdge', new THREE.BufferAttribute(new Float32Array(A), 2)); g.setIndex(new THREE.BufferAttribute(new Uint32Array(I), 1)); g.computeBoundingSphere();
    const U = { uT: { value: 0 }, uK: { value: 1 }, uCol: { value: new THREE.Color(1, 1, 1) } };
    const mat = new THREE.ShaderMaterial({ uniforms: U, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
      vertexShader: 'attribute vec2 aEdge; varying vec2 vE;\nvoid main(){ vE = aEdge; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `uniform float uT; uniform float uK; uniform vec3 uCol; varying vec2 vE;
void main(){ float a = vE.x, line = 0.8 + 0.07 * sin(uT * 0.8 + vE.y * 1.7) + 0.04 * sin(uT * 0.5 - vE.y * 4.1);
  float w = a * a * 0.3 + smoothstep(line - 0.16, line, a) * 0.42;
  gl_FragColor = vec4(uCol, w * uK);
  #include <colorspace_fragment>
}` });
    const mesh = new THREE.Mesh(g, mat); mesh.position.y = 0.012; mesh.renderOrder = 1; return { mesh, U };
  }

  // ---- the fog bank ----
  // A few thin sheets one above another, draped over the foggy ground (mask: a small picture of where, white where it is
  // thickest; heightAt(x, z): the top of what stands there, smoothed here so the sheets roll over the hills and dip to the sea),
  // each cut into wisps by the drifting noise: from above they add up to a soft bank, from the side to layers the hilltops and
  // the bridge's towers stand out of. box: [x0, z0, x1, z1], the ground the mask covers. U.uT; uK: how thick (0 none); uCol.
  function fog(THREE, mask, box, noise, heightAt, offsets) {
    const cell = 5, nx = Math.ceil((box[2] - box[0]) / cell), nz = Math.ceil((box[3] - box[1]) / cell), cv = mask.image, px = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data, n1 = nx + 1;
    const M = new Uint8Array(n1 * (nz + 1)); let Hh = new Float32Array(n1 * (nz + 1));
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) M[j * n1 + i] = px[(clamp(Math.round(j * cell / (box[3] - box[1]) * cv.height), 0, cv.height - 1) * cv.width + clamp(Math.round(i * cell / (box[2] - box[0]) * cv.width), 0, cv.width - 1)) * 4];
    const near = (i, j) => { for (let b = Math.max(0, j - 2); b <= Math.min(nz, j + 2); b++) for (let a = Math.max(0, i - 2); a <= Math.min(nx, i + 2); a++) if (M[b * n1 + a] > 3) return true; return false; };
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) if (near(i, j)) Hh[j * n1 + i] = heightAt(box[0] + i * cell, box[1] + j * cell);
    { const O = new Float32Array(Hh.length); for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) { let m = 0; for (let b = Math.max(0, j - 2); b <= Math.min(nz, j + 2); b++) for (let a = Math.max(0, i - 2); a <= Math.min(nx, i + 2); a++) m = Math.max(m, Hh[b * n1 + a]); O[j * n1 + i] = m; } Hh = O; } // the highest ground near by: a sheet never cuts into a wall at a shore
    for (let pass = 0; pass < 2; pass++) { const O = new Float32Array(Hh.length); for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) { let s = 0, c = 0; for (let b = Math.max(0, j - 1); b <= Math.min(nz, j + 1); b++) for (let a = Math.max(0, i - 1); a <= Math.min(nx, i + 1); a++) { s += Hh[b * n1 + a]; c++; } O[j * n1 + i] = s / c; } Hh = O; }
    const P = new Float32Array(n1 * (nz + 1) * 3), I = [];
    for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) { const k = j * n1 + i; P[k * 3] = box[0] + i * cell; P[k * 3 + 1] = Hh[k]; P[k * 3 + 2] = box[1] + j * cell; }
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const a = j * n1 + i, b = a + 1, c = a + n1, d = c + 1; if (M[a] > 3 || M[b] > 3 || M[c] > 3 || M[d] > 3) I.push(a, c, b, b, c, d); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setIndex(new THREE.BufferAttribute(new Uint32Array(I), 1)); g.computeBoundingSphere();
    const U = { uT: { value: 0 }, uK: { value: 1 }, uCol: { value: new THREE.Color(1, 1, 1) }, uMask: { value: mask }, uNoise: { value: noise }, uHaze: { value: new THREE.Vector2(100, 1000) }, uBox: { value: new THREE.Vector4(box[0], box[1], 1 / (box[2] - box[0]), 1 / (box[3] - box[1])) } };
    const group = new THREE.Group();
    offsets.forEach((y, k) => {
      const mat = new THREE.ShaderMaterial({ uniforms: Object.assign({ uOff: { value: new THREE.Vector2(k * 0.37, k * 0.61) }, uA: { value: 1 - k * 0.14 } }, U), transparent: true, depthWrite: false, side: THREE.DoubleSide,
        vertexShader: 'varying vec3 vWp;\nvoid main(){ vec4 w = modelMatrix * vec4(position, 1.0); vWp = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
        fragmentShader: `uniform float uT; uniform float uK; uniform float uA; uniform vec3 uCol; uniform sampler2D uMask; uniform sampler2D uNoise; uniform vec2 uOff; uniform vec2 uHaze; uniform vec4 uBox; varying vec3 vWp;
void main(){ vec2 p = vWp.xz; float m = texture2D(uMask, (p - uBox.xy) * uBox.zw).r; if (m < 0.01) discard;
  float n = texture2D(uNoise, p * 0.0125 + uOff + uT * vec2(0.0042, 0.0013)).b * 0.62 + texture2D(uNoise, p * 0.034 + uOff.yx - uT * vec2(0.0021, -0.0034)).a * 0.38;
  float a = smoothstep(0.5, 0.96, m * (0.14 + n * 1.36)) * uK * uA * (1.0 - smoothstep(uHaze.x, uHaze.y, distance(cameraPosition, vWp)));
  gl_FragColor = vec4(uCol, a);
  #include <colorspace_fragment>
}` });
      const mesh = new THREE.Mesh(g, mat); mesh.position.y = y; mesh.renderOrder = 6 + k; group.add(mesh);
    });
    return { group, U };
  }
  // where the fog lies, painted small and soft: places: [{ polys: [[ring, ...], ...] in map units, k: 0 to 1 }], spots: [[x, z, rx, rz, k]]
  function fogMask(THREE, box, places, spots) {
    const sc = 0.5, w = Math.max(8, Math.round((box[2] - box[0]) * sc)), h = Math.max(8, Math.round((box[3] - box[1]) * sc)), small = document.createElement('canvas'); small.width = w; small.height = h;
    const g = small.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, w, h); g.setTransform(sc, 0, 0, sc, -box[0] * sc, -box[1] * sc);
    const fill = (polys, dx, a) => { g.globalAlpha = a; g.fillStyle = '#fff'; g.beginPath(); for (const poly of polys) for (const r of poly) { r.forEach((p, k) => k ? g.lineTo(p[0] + dx, p[1]) : g.moveTo(p[0] + dx, p[1])); g.closePath(); } g.fill('evenodd'); };
    for (const p of places) { fill(p.polys, -7, p.k * 0.45); fill(p.polys, 0, p.k); }   // the fog comes in off the ocean: a paler copy to the west
    for (const [x, z, rx, rz, k] of spots) { g.globalAlpha = k; g.beginPath(); g.ellipse(x, z, rx, rz, 0, 0, Math.PI * 2); g.fill(); }
    // soft: drawn smaller still and stretched back, twice
    const out = document.createElement('canvas'); out.width = w; out.height = h; const o = out.getContext('2d'), t = document.createElement('canvas'); t.width = Math.max(2, Math.round(w / 9)); t.height = Math.max(2, Math.round(h / 9)); const tg = t.getContext('2d');
    tg.imageSmoothingQuality = o.imageSmoothingQuality = 'high'; tg.drawImage(small, 0, 0, t.width, t.height); o.drawImage(t, 0, 0, w, h);
    const tex = new THREE.CanvasTexture(out); tex.flipY = false; tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping; tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false; return tex;
  }

  // ---- ferries: a small boat and its wake, there and back along a line of water ----
  // routes: [[[x, z], ...], ...] in map units; b: a models.js Builder. Returns the boats: { route, len, at(s) → [x, z, heading] }
  function ferryModel(b) {
    const L = 0.62, Wd = 0.17;
    b.loft('white', [[[-L / 2, 0, -Wd / 2], [L * 0.32, 0, -Wd / 2], [L / 2, 0, 0], [L * 0.32, 0, Wd / 2], [-L / 2, 0, Wd / 2]], [[-L / 2, 0.07, -Wd / 2], [L * 0.34, 0.07, -Wd / 2], [L / 2 + 0.02, 0.07, 0], [L * 0.34, 0.07, Wd / 2], [-L / 2, 0.07, Wd / 2]]], { flat: true });
    b.box('whiteShade', -0.04, 0.07, 0, L * 0.6, Wd * 0.78, 0.055, { win: [6, 1], glow: 1.1 });
    b.box('white', -0.02, 0.125, 0, L * 0.3, Wd * 0.6, 0.04, { win: [3, 1], glow: 1.1 });
    b.box('red', -0.14, 0.165, 0, 0.05, 0.05, 0.05);
    b.light([L / 2, 0.1, 0], 'white', 0.9); b.light([-L / 2, 0.1, 0], 'red', 0.6);
  }
  function ferryPath(pts) {
    const acc = [0]; for (let i = 1; i < pts.length; i++) acc.push(acc[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const len = acc[acc.length - 1];
    // s: distance travelled; the boat goes to the far end, waits, and comes back
    const at = s => { const lap = len * 2 + 24, q = ((s % lap) + lap) % lap; let d, dir = 1; if (q < len) d = q; else if (q < len + 12) d = len; else if (q < len * 2 + 12) { d = len - (q - len - 12); dir = -1; } else { d = 0; dir = -1; }
      let i = 1; while (i < pts.length - 1 && acc[i] < d) i++; const t = clamp((d - acc[i - 1]) / (acc[i] - acc[i - 1] || 1), 0, 1), a = pts[i - 1], b = pts[i];
      return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), Math.atan2(-(b[1] - a[1]) * dir, (b[0] - a[0]) * dir)]; };
    return { len, at };
  }
  function wake(THREE) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.3, 0, 0, -2.6, 0, -0.42, -2.6, 0, 0.42, -0.3, 0, 0.07, -0.3, 0, -0.07]), 3)); g.setAttribute('aA', new THREE.BufferAttribute(new Float32Array([1, 0, 0, 1, 1]), 1)); g.setIndex([4, 1, 0, 0, 2, 3, 0, 1, 2]);
    return g;
  }
  const wakeMat = THREE => new THREE.ShaderMaterial({ uniforms: { uCol: { value: new THREE.Color(1, 1, 1) }, uK: { value: 0.3 } }, transparent: true, depthWrite: false, side: THREE.DoubleSide, vertexShader: 'attribute float aA; varying float vA;\nvoid main(){ vA = aA; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }', fragmentShader: 'uniform vec3 uCol; uniform float uK; varying float vA;\nvoid main(){ gl_FragColor = vec4(uCol, vA * vA * uK);\n#include <colorspace_fragment>\n}' });

  window.M3D = window.M3D || {};
  window.M3D.air = { sun, noiseTex, sky, water, wash, fog, fogMask, ferryModel, ferryPath, wake, wakeMat };
})();
