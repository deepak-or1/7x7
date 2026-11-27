#!/usr/bin/env node
// Makes js/map3d/heroes.js: the named buildings of downtown San Francisco for the 3D map, from tools/heroes3d.src.js (edit that
// file, not the one it makes). Run it by hand after the source or js/map3d/buildings.js changes:
//
//   node tools/heroes3d.js
//
// The source names each outline by its number in js/map3d/buildings.js, area sf-core (K(i) for one, KS(i, j, 'a-b', ...) for
// several, a-b a range); the file the page loads names it by what does not change when the building data is made again in another
// order: [lon, lat of the point inside it furthest from its edges (to half a metre), its height in metres, its count of points, its
// area in square metres]. Everything else is copied as it is. js/map3d/buildings.js is run in a sandbox (it is the repo's own file).
// A number with no outline, or an outline too thin to hold a point, stops the run with nothing written. No packages, no network.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), zlib = require('zlib');
const root = path.join(__dirname, '..');
const win = {}; vm.runInContext(fs.readFileSync(path.join(root, 'js/map3d/buildings.js'), 'utf8'), vm.createContext({ window: win }), { filename: 'buildings.js' });
const area = win.M3D.buildingData.areas.find(a => a.name === 'sf-core'); if (!area) throw new Error('js/map3d/buildings.js has no area sf-core');
// the area's outlines: [{ h, base, roof, pts: [[x, y], ...] }], x, y metres east and north of its origin (the format in the file's header)
function unpack(a) {
  const s = Buffer.from(a.data, 'base64'); let i = 0, px = 0, py = 0; const out = [];
  const uv = () => { let v = 0, m = 1, b; do { b = s[i++]; v += (b & 127) * m; m *= 128; } while (b & 128); return v; };
  const sv = () => { const u = uv(); return u & 1 ? -(u + 1) / 2 : u / 2; };
  while (i < s.length) { const h = uv(), base = uv(), roof = uv(), n = uv(), pts = []; let x = px + sv(), y = py + sv(); px = x; py = y; pts.push([x, y]); for (let k = 1; k < n; k++) { x += sv(); y += sv(); pts.push([x, y]); } out.push({ h, base, roof, pts }); }
  return out;
}
const L = unpack(area), o = area.origin, kx = 1 / (111320 * Math.cos(o[1] * Math.PI / 180));
const inside = (p, x, y) => { let c = false; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const xi = p[i][0], yi = p[i][1], xj = p[j][0], yj = p[j][1]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
const edgeD = (p, x, y) => { let d = Infinity; for (let i = 0, j = p.length - 1; i < p.length; j = i++) { const ax = p[j][0], ay = p[j][1], dx = p[i][0] - ax, dy = p[i][1] - ay, l2 = dx * dx + dy * dy; let t = l2 ? ((x - ax) * dx + (y - ay) * dy) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t; d = Math.min(d, Math.hypot(ax + dx * t - x, ay + dy * t - y)); } return d; };
function key(i) {
  const b = L[i]; if (!b) throw new Error('no outline ' + i); const p = b.pts; let ar = 0, x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let k = 0, j = p.length - 1; k < p.length; j = k++) { ar += p[j][0] * p[k][1] - p[k][0] * p[j][1]; x0 = Math.min(x0, p[k][0]); x1 = Math.max(x1, p[k][0]); y0 = Math.min(y0, p[k][1]); y1 = Math.max(y1, p[k][1]); }
  let best = null, bd = -1; for (let x = x0; x <= x1; x += 0.5) for (let y = y0; y <= y1; y += 0.5) if (inside(p, x, y)) { const d = edgeD(p, x, y); if (d > bd) { bd = d; best = [x, y]; } }
  if (!best || bd < 0.8) throw new Error('outline ' + i + ' has no room for a point inside');
  return `[${(o[0] + best[0] * kx).toFixed(6)}, ${(o[1] + best[1] / 111320).toFixed(6)}, ${b.h}, ${p.length}, ${Math.round(Math.abs(ar) / 2)}]`;
}
const list = s => { const out = []; for (const t of s.split(',')) { const m = t.trim().replace(/'/g, '').split('-').map(Number); for (let i = m[0]; i <= (m[1] != null ? m[1] : m[0]); i++) out.push(i); } return out; };
let src = fs.readFileSync(path.join(__dirname, 'heroes3d.src.js'), 'utf8'), n = 0;
src = src.replace(/\bKS\(([^)]*)\)/g, (_, s) => '[' + list(s).map(i => { n++; return key(i); }).join(', ') + ']').replace(/\bK\((\d+)\)/g, (_, i) => { n++; return key(+i); });
fs.writeFileSync(path.join(root, 'js/map3d/heroes.js'), src);
console.log('js/map3d/heroes.js: ' + n + ' outlines named, ' + Buffer.byteLength(src) + ' bytes, ' + zlib.gzipSync(src, { level: 9 }).length + ' gzipped');
