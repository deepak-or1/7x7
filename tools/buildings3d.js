#!/usr/bin/env node
// Makes js/map3d/buildings.js: real building shapes and heights for the 3D map, from OpenStreetMap through the Overpass API.
//
//   node tools/buildings3d.js --raw <dir> [--pictures <dir>] [--core-min 0]
//
// --raw: where the Overpass answers live (<dir>/overpass/<piece>.json). A piece is queried only when its file is missing, so a
// second run needs no network. The answers are treated as untrusted data: size limit, JSON only, type checks on every field
// used, nothing in them is ever run.
// --pictures: also write a top-down picture of each area there (<area>.png, outlines shaded by height) and print the checks
// (counts, the tallest ten per area, a round trip of the packed file).
// --core-min: the lowest height kept in the dense core of San Francisco (default 0: every building there with a height fits the
// size budget, about 270 KB for the whole file; the task asked for 12 m or taller at least, smaller ones if the budget allows).
//
// Areas and what is kept:
//   sf-core  the dense core of San Francisco (Financial District to Mission Bay, Civic Center, Nob Hill, North Beach, the
//            northern waterfront): --core-min metres or taller; a footprint over 400 m2 with no height counts as 12 m
//   sf       the rest of San Francisco: 35 m or taller (the server is asked only for those, plus all building:part pieces)
//   oakland  downtown Oakland: 15 m or taller
//   vegas    the Las Vegas Strip: 15 m or taller, plus any footprint over 10,000 m2 (resort podiums, arenas; 15 m if no height)
// Height: `height` when it is a number (an optional "m" is allowed), else building:levels x 3.2 m; base from min_height, else
// building:min_level x 3.2 m. Bridge towers and piers (bridge:support, tower:type=bridge, and pieces standing inside them) are left
// out: the map draws its own bridges. building:part pieces replace their outline when they cover at least half of it (so towers keep their setbacks), and a
// building's parts are kept or dropped together. Outlines are simplified (Douglas-Peucker, 1.5 m), holes are dropped, shapes
// under 60 m2 are dropped. No packages.
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib'), https = require('https'), vm = require('vm');
const root = path.join(__dirname, '..');

const args = process.argv.slice(2), arg = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const RAW = arg('--raw'), PICS = arg('--pictures'), CORE_MIN = +arg('--core-min', 0);
if (!RAW || !(CORE_MIN >= 0 && CORE_MIN <= 200)) { console.error('usage: node tools/buildings3d.js --raw <dir> [--pictures <dir>] [--core-min 0]'); process.exit(2); }

// ---------- areas and query pieces (bbox: [west, south, east, north]) ----------
const CORE = [-122.425, 37.765, -122.385, 37.812];
const SF = [-122.520, 37.700, -122.350, 37.835];
const OAK = [-122.285, 37.795, -122.255, 37.815];
const LV = [-115.185, 36.080, -115.150, 36.150];
const split = (b, nx, ny, name) => { const out = []; for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) out.push({ name: `${name}-${j}${i}`, bbox: [b[0] + (b[2] - b[0]) * i / nx, b[1] + (b[3] - b[1]) * j / ny, b[0] + (b[2] - b[0]) * (i + 1) / nx, b[1] + (b[3] - b[1]) * (j + 1) / ny].map(v => Math.round(v * 1e6) / 1e6) }); return out; };
const AREAS = [
  { name: 'sf-core', box: CORE, pieces: split(CORE, 2, 3, 'core'), all: true },
  { name: 'sf', box: SF, pieces: [{ name: 'sf-tall', bbox: SF, tall: true }] },
  { name: 'oakland', box: OAK, pieces: [{ name: 'oakland', bbox: OAK }], all: true },
  { name: 'vegas', box: LV, pieces: split(LV, 1, 2, 'vegas'), all: true },
];
function query(p) {
  const b = `${p.bbox[1]},${p.bbox[0]},${p.bbox[3]},${p.bbox[2]}`; // Overpass order: south, west, north, east
  const tall = '(if: number(t["height"]) >= 35 || number(t["building:levels"]) >= 11)';
  const sets = p.tall
    ? [`way["building"]${tall}(${b});`, `relation["building"]${tall}(${b});`, `way["building:part"](${b});`, `relation["building:part"](${b});`]
    : [`way["building"](${b});`, `relation["building"](${b});`, `way["building:part"](${b});`, `relation["building:part"](${b});`];
  return `[out:json][timeout:180];(${sets.join('')});out geom;`;
}

// ---------- fetching (each piece once, kept on disk) ----------
const SERVERS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const MAX_BODY = 200 << 20;
const stats = { queries: 0, answers: 0, bytesFetched: 0, fromDisk: 0, bytesDisk: 0 };
const sleep = ms => new Promise(r => setTimeout(r, ms));
function post(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url), data = Buffer.from('data=' + encodeURIComponent(body));
    const req = https.request({ hostname: u.hostname, path: u.pathname, method: 'POST', timeout: 300000,
      headers: { 'User-Agent': 'map-data-fetch/1.0', 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': data.length } }, res => {
      const parts = []; let n = 0;
      res.on('data', d => { n += d.length; if (n > MAX_BODY) { req.destroy(new Error('answer over size limit')); return; } parts.push(d); });
      res.on('end', () => resolve({ status: res.statusCode, type: String(res.headers['content-type'] || ''), body: Buffer.concat(parts) }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.end(data);
  });
}
function parseAnswer(buf) {
  const j = JSON.parse(buf.toString('utf8'));
  if (!j || typeof j !== 'object' || !Array.isArray(j.elements)) throw new Error('answer has no elements list');
  if (typeof j.remark === 'string' && /error|timed out|out of memory/i.test(j.remark)) throw new Error('server remark: ' + j.remark.slice(0, 200));
  return j;
}
let fetchedBefore = false;
async function piece(p) {
  const file = path.join(RAW, 'overpass', p.name + '.json');
  if (fs.existsSync(file)) { const b = fs.readFileSync(file); stats.fromDisk++; stats.bytesDisk += b.length; return parseAnswer(b); }
  const q = query(p); let lastErr;
  // A "busy" answer (429, 502, 503, 504: the server asks for exponential backoff) is retried after 30, 60, 120 s; any other
  // refusal, or a fourth busy answer, moves on to the next server, and when both have refused the run stops.
  for (const url of SERVERS) for (let attempt = 0; attempt < 4; attempt++) {
    if (fetchedBefore) await sleep(attempt ? 30000 * 2 ** (attempt - 1) : 5000); // be polite between queries
    fetchedBefore = true;
    let r;
    try { r = await post(url, q); } catch (e) { lastErr = `${url}: ${e.message}`; console.log('  refused or failed: ' + lastErr); break; }
    stats.queries++; stats.bytesFetched += r.body.length;
    if (r.status !== 200 || !/json/.test(r.type)) {
      lastErr = `${url}: HTTP ${r.status} ${r.type} ${r.body.toString('utf8', 0, 120).replace(/\s+/g, ' ')}`; console.log(`  refused (try ${attempt + 1}): ` + lastErr);
      if ([429, 502, 503, 504].includes(r.status)) continue; break;
    }
    const j = parseAnswer(r.body); // throws on a server error remark: nothing is saved then
    stats.answers++;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file + '.part', r.body); fs.renameSync(file + '.part', file);
    console.log(`  fetched ${p.name} from ${new URL(url).hostname}: ${r.body.length} bytes, ${j.elements.length} elements`);
    return j;
  }
  throw new Error(`every server refused piece ${p.name}; stopping. Last: ${lastErr}`);
}

// ---------- geometry (local metres around an origin) ----------
const KY = 111320, kxAt = lat => 111320 * Math.cos(lat * Math.PI / 180);
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const sArea = r => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1]; return a / 2; };
function pip(r, x, y) { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; }
function centroid(r) { let a = 0, cx = 0, cy = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const f = r[j][0] * r[i][1] - r[i][0] * r[j][1]; a += f; cx += (r[j][0] + r[i][0]) * f; cy += (r[j][1] + r[i][1]) * f; } a *= 3; return a ? [cx / a, cy / a] : r[0]; }
function segDist2(px, py, ax, ay, bx, by) { const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy; let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t; const qx = ax + dx * t - px, qy = ay + dy * t - py; return qx * qx + qy * qy; }
function simplifyRing(r, tol) { // closed ring without the closing point; keeps the point farthest from the first as an anchor
  if (r.length <= 4) return r;
  let k = 0, md = -1; for (let i = 1; i < r.length; i++) { const d = (r[i][0] - r[0][0]) ** 2 + (r[i][1] - r[0][1]) ** 2; if (d > md) { md = d; k = i; } }
  const n = r.length, keep = new Uint8Array(n), t2 = tol * tol; keep[0] = keep[k] = 1; const stack = [[0, k], [k, n]];
  while (stack.length) {
    const [a, b] = stack.pop(), A = r[a], B = r[b % n]; let mi = -1, m = t2;
    for (let i = a + 1; i < b; i++) { const d = segDist2(r[i][0], r[i][1], A[0], A[1], B[0], B[1]); if (d > m) { m = d; mi = i; } }
    if (mi >= 0) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return r.filter((_, i) => keep[i]);
}
// [{lat, lon}, ...] -> [[lon, lat], ...] with type checks; null when unusable
function llRing(g) {
  if (!Array.isArray(g) || g.length < 4 || g.length > 100000) return null;
  const r = []; for (const p of g) { if (!p || !isNum(p.lat) || !isNum(p.lon) || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) return null; r.push([p.lon, p.lat]); }
  return r;
}
// join a multipolygon's outer member ways into closed rings
function joinRings(members) {
  const segs = []; for (const m of members) { if (!m || m.type !== 'way' || (m.role !== 'outer' && m.role !== '')) continue; const g = Array.isArray(m.geometry) && m.geometry.length >= 2 ? llRingLoose(m.geometry) : null; if (g) segs.push(g); }
  const rings = [], same = (a, b) => a[0] === b[0] && a[1] === b[1];
  while (segs.length) {
    let cur = segs.shift(), guard = 0;
    while (!same(cur[0], cur[cur.length - 1]) && guard++ < 10000) {
      const end = cur[cur.length - 1]; let i = segs.findIndex(s => same(s[0], end) || same(s[s.length - 1], end));
      if (i < 0) break; const s = segs.splice(i, 1)[0]; cur = cur.concat((same(s[0], end) ? s : s.slice().reverse()).slice(1));
    }
    if (cur.length >= 4 && same(cur[0], cur[cur.length - 1])) rings.push(cur);
  }
  return rings;
}
function llRingLoose(g) { const r = []; for (const p of g) { if (!p || !isNum(p.lat) || !isNum(p.lon)) return null; r.push([p.lon, p.lat]); } return r; }

const num = s => { if (typeof s !== 'string') return NaN; const m = /^\s*(-?\d+(?:\.\d+)?)\s*(m|metres|meters)?\s*$/i.exec(s); return m ? +m[1] : NaN; };
const ROOF = { flat: 0, pyramidal: 1, dome: 2, gabled: 3, hipped: 4, skillion: 5, onion: 6, round: 7, 'half-hipped': 4, mansard: 4, gambrel: 3, saltbox: 3, cone: 1 };
const roofCode = s => typeof s === 'string' ? (s in ROOF ? ROOF[s] : 8) : 0; // 8: some other roof shape

// ---------- one area: elements -> buildings ----------
function shapes(elements) {
  const out = [], seen = new Set();
  for (const e of elements) {
    if (!e || typeof e !== 'object' || (e.type !== 'way' && e.type !== 'relation') || !isNum(e.id)) continue;
    const key = e.type + e.id; if (seen.has(key)) continue; seen.add(key);
    const t = e.tags && typeof e.tags === 'object' ? e.tags : {};
    const isPart = typeof t['building:part'] === 'string' && t['building:part'] !== 'no';
    const isBld = typeof t.building === 'string' && t.building !== 'no';
    if (!isPart && !isBld) continue;
    const bridge = !!(t['bridge:support'] || t['tower:type'] === 'bridge' || t.man_made === 'bridge'); // the map draws its own bridges
    let rings;
    if (e.type === 'way') { const r = llRing(e.geometry); rings = r && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? [r] : []; }
    else { if (t.type !== 'multipolygon' || !Array.isArray(e.members)) continue; rings = joinRings(e.members); }
    const h = num(t.height), lv = parseFloat(t['building:levels']), mh = num(t.min_height), ml = parseFloat(t['building:min_level']);
    const height = isNum(h) && h > 0 && h < 1000 ? h : isNum(lv) && lv > 0 && lv < 300 ? lv * 3.2 : null;
    const minH = isNum(mh) && mh >= 0 && mh < 1000 ? mh : isNum(ml) && ml > 0 && ml < 300 ? ml * 3.2 : 0;
    const name = typeof t.name === 'string' ? t.name.slice(0, 80) : typeof t['addr:housenumber'] === 'string' && typeof t['addr:street'] === 'string' ? `${t['addr:housenumber']} ${t['addr:street']}`.slice(0, 80) : '';
    for (const r of rings) out.push({ id: key, ll: r.slice(0, -1), isPart, bridge, height, minH, roof: roofCode(t['roof:shape']), name });
  }
  return out;
}
function buildArea(area, elements) {
  const lon0 = Math.round(area.box[0] * 1e4) / 1e4, lat0 = Math.round(area.box[1] * 1e4) / 1e4, kx = kxAt(lat0);
  const toM = ([lon, lat]) => [(lon - lon0) * kx, (lat - lat0) * KY];
  const shaped = shapes(elements).map(s => { const m = s.ll.map(toM); const a = Math.abs(sArea(m)); return { ...s, m, area: a, c: centroid(m) }; }).filter(s => s.area > 0);
  // bridge towers and piers, and any untagged piece standing inside one (centre within 10 m of its box), are left out
  const boxes = shaped.filter(s => s.bridge).map(s => { const xs = s.m.map(p => p[0]), ys = s.m.map(p => p[1]); return [Math.min(...xs) - 10, Math.min(...ys) - 10, Math.max(...xs) + 10, Math.max(...ys) + 10]; });
  const all = shaped.filter(s => !s.bridge && !boxes.some(b => s.c[0] >= b[0] && s.c[0] <= b[2] && s.c[1] >= b[1] && s.c[1] <= b[3]));
  const outlines = all.filter(s => !s.isPart), parts = all.filter(s => s.isPart);
  // grid index of parts by centroid
  const G = 50, cell = (x, y) => Math.floor(x / G) + ',' + Math.floor(y / G), idx = new Map();
  parts.forEach(p => { const k = cell(p.c[0], p.c[1]); if (!idx.has(k)) idx.set(k, []); idx.get(k).push(p); });
  const groups = []; let replaced = 0;
  for (const o of outlines) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; o.m.forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); });
    const inside = [];
    for (let gx = Math.floor(x0 / G); gx <= Math.floor(x1 / G); gx++) for (let gy = Math.floor(y0 / G); gy <= Math.floor(y1 / G); gy++) for (const p of idx.get(gx + ',' + gy) || []) if (!p.owner && pip(o.m, p.c[0], p.c[1])) inside.push(p);
    inside.forEach(p => { p.owner = o; });
    const cover = inside.reduce((s, p) => s + p.area, 0);
    if (inside.length && cover >= 0.5 * o.area) { replaced++; groups.push({ outline: o, pieces: inside }); }
    else groups.push({ outline: o, pieces: [o, ...inside] });
  }
  parts.filter(p => !p.owner).forEach(p => groups.push({ outline: p, pieces: [p] }));
  // heights and the area's rule
  const inCore = s => { const lon = lon0 + s.c[0] / kx, lat = lat0 + s.c[1] / KY; return lon >= CORE[0] && lon <= CORE[2] && lat >= CORE[1] && lat <= CORE[3]; };
  const kept = [];
  for (const g of groups) {
    const o = g.outline;
    g.pieces.forEach(p => {
      if (p.height == null && p !== o && o.height != null) p.height = o.height; // a part with no height takes its outline's
      if (p.height == null) {
        if (area.name === 'sf-core' && p.area > 400) p.height = 12;
        else if (area.name === 'vegas' && p.area > 10000) p.height = 15;
      }
    });
    const top = Math.max(o.height || 0, ...g.pieces.map(p => p.height || 0)), foot = Math.max(o.area, g.pieces.reduce((s, p) => s + p.area, 0));
    let keep;
    if (area.name === 'sf-core') keep = top >= CORE_MIN;
    else if (area.name === 'sf') keep = top >= 35 && !inCore(o);
    else if (area.name === 'oakland') keep = top >= 15;
    else keep = top >= 15 || foot > 10000;
    if (!keep) continue;
    const name = o.name || (g.pieces.find(p => p.name) || {}).name || '';
    for (const p of g.pieces) {
      if (p.height == null || p.height <= p.minH) continue;
      let r = simplifyRing(p.m, 1.5);
      if (r.length < 3 || Math.abs(sArea(r)) < 60) continue;
      if (sArea(r) < 0) r = r.slice().reverse(); // counter-clockwise (x east, y north)
      kept.push({ ring: r, h: Math.round(p.height), minH: Math.round(p.minH), roof: p.roof, name, group: o.id, top });
    }
  }
  return { lon0, lat0, kx, kept, replaced, shapes: all.length };
}

// ---------- packing ----------
// per building: height, base height, roof code, point count n, then n points as (dx, dy) in whole metres: the first from the
// previous building's first point (the area's origin for the first building), the rest from the point before. Counts are
// unsigned LEB128 varints; dx, dy are zigzag-signed varints; the bytes are base64.
const FORMAT = 'base64 bytes of varints (7 bits a byte, low first, high bit = more); per building: height m, base m, roof (0 flat 1 pyramidal 2 dome 3 gabled 4 hipped 5 skillion 6 onion 7 round 8 other), n, then n points as zigzag (dx, dy) in whole metres east and north, the first from the previous building\'s first point (origin for the first), the rest from the point before; lon = origin[0] + x / (111320 cos(origin[1] deg)), lat = origin[1] + y / 111320; rings are counter-clockwise, not closed';
function packArea(a) {
  const bytes = [], uv = v => { do { let b = v & 127; v = Math.floor(v / 128); if (v) b |= 128; bytes.push(b); } while (v); }, sv = v => uv(v < 0 ? -2 * v - 1 : 2 * v);
  let px = 0, py = 0;
  for (const b of a.kept) {
    const pts = []; b.ring.forEach(([x, y]) => { const q = [Math.round(x), Math.round(y)], l = pts[pts.length - 1]; if (!l || l[0] !== q[0] || l[1] !== q[1]) pts.push(q); });
    if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
    if (pts.length < 3) { b.drop = true; continue; }
    b.pts = pts; uv(b.h); uv(b.minH); uv(b.roof); uv(pts.length);
    sv(pts[0][0] - px); sv(pts[0][1] - py); px = pts[0][0]; py = pts[0][1];
    for (let i = 1; i < pts.length; i++) { sv(pts[i][0] - pts[i - 1][0]); sv(pts[i][1] - pts[i - 1][1]); }
  }
  a.kept = a.kept.filter(b => !b.drop);
  return Buffer.from(bytes).toString('base64');
}
// the reader, as the engine would write it (also in the file's header comment)
function unpack(area) {
  const s = Buffer.from(area.data, 'base64'); let i = 0;
  const uv = () => { let v = 0, m = 1, b; do { b = s[i++]; v += (b & 127) * m; m *= 128; } while (b & 128); return v; }, sv = () => { const u = uv(); return u & 1 ? -(u + 1) / 2 : u / 2; };
  const out = []; let px = 0, py = 0;
  while (i < s.length) {
    const h = uv(), base = uv(), roof = uv(), n = uv(), pts = [];
    let x = px + sv(), y = py + sv(); px = x; py = y; pts.push([x, y]);
    for (let k = 1; k < n; k++) { x += sv(); y += sv(); pts.push([x, y]); }
    out.push({ h, base, roof, pts });
  }
  return out;
}

// ---------- tiny PNG writer and a polygon filler for the pictures ----------
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = b => { let c = -1; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) { const t = Buffer.from(type, 'latin1'), len = Buffer.alloc(4), crc = Buffer.alloc(4); len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, crc]); }
function writePNG(file, w, h, rgb) {
  const raw = Buffer.alloc(h * (w * 3 + 1)); for (let y = 0; y < h; y++) rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
function picture(file, bs, mpp) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; bs.forEach(b => b.pts.forEach(([x, y]) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }));
  x0 -= 20; y0 -= 20; x1 += 20; y1 += 20;
  const w = Math.ceil((x1 - x0) / mpp), h = Math.ceil((y1 - y0) / mpp), rgb = Buffer.alloc(w * h * 3, 238), maxH = Math.max(...bs.map(b => b.h));
  const order = bs.slice().sort((a, b) => a.h - b.h);
  for (const b of order) {
    const t = Math.sqrt(b.h / maxH), col = [Math.round(250 - 200 * t), Math.round(200 - 150 * t), Math.round(120 + 60 * t)];
    const P = b.pts.map(([x, y]) => [(x - x0) / mpp, (y1 - y) / mpp]);
    let ya = Infinity, yb = -Infinity; P.forEach(p => { ya = Math.min(ya, p[1]); yb = Math.max(yb, p[1]); });
    for (let py = Math.max(0, Math.floor(ya)); py <= Math.min(h - 1, Math.ceil(yb)); py++) {
      const yc = py + 0.5, xs = [];
      for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if ((yi > yc) !== (yj > yc)) xs.push(xi + (yc - yi) / (yj - yi) * (xj - xi)); }
      xs.sort((a, c) => a - c);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let px = Math.max(0, Math.round(xs[k])); px < Math.min(w, Math.round(xs[k + 1])); px++) { const o = (py * w + px) * 3; rgb[o] = col[0]; rgb[o + 1] = col[1]; rgb[o + 2] = col[2]; }
    }
  }
  writePNG(file, w, h, rgb);
  return `${w} x ${h}`;
}

(async () => {
  fs.mkdirSync(RAW, { recursive: true });
  const results = [];
  for (const area of AREAS) {
    const els = [];
    for (const p of area.pieces) els.push(...(await piece(p)).elements);
    const a = buildArea(area, els);
    results.push({ area, a, data: packArea(a) });
  }
  const areas = results.map(({ area, a, data }) => ({ name: area.name, origin: [a.lon0, a.lat0], count: a.kept.length, data }));
  const head = '// Generated by tools/buildings3d.js (do not edit by hand): building shapes and heights for the 3D map, from OpenStreetMap\n'
    + '// (Overpass API). Areas: sf-core (the dense core of San Francisco, ' + (CORE_MIN > 0 ? CORE_MIN + ' m or taller' : 'every building with a height') + '), sf (the rest of the city, 35 m or taller),\n'
    + '// oakland (downtown, 15 m or taller), vegas (the Strip, 15 m or taller plus footprints over 10,000 m2). Per area, data is\n'
    + '// base64 of varints; see `format`. Unpack one area into [{ h, base, roof, pts: [[x, y], ...] }] (x, y metres east, north of origin):\n'
    + '//\n'
    + '//   function unpack(area) {\n'
    + '//     const bin = atob(area.data), s = new Uint8Array(bin.length); for (let k = 0; k < bin.length; k++) s[k] = bin.charCodeAt(k);\n'
    + '//     let i = 0, px = 0, py = 0; const out = [];\n'
    + '//     const uv = () => { let v = 0, m = 1, b; do { b = s[i++]; v += (b & 127) * m; m *= 128; } while (b & 128); return v; };\n'
    + '//     const sv = () => { const u = uv(); return u & 1 ? -(u + 1) / 2 : u / 2; };\n'
    + '//     while (i < s.length) {\n'
    + '//       const h = uv(), base = uv(), roof = uv(), n = uv(), pts = [];\n'
    + '//       let x = px + sv(), y = py + sv(); px = x; py = y; pts.push([x, y]);\n'
    + '//       for (let k = 1; k < n; k++) { x += sv(); y += sv(); pts.push([x, y]); }\n'
    + '//       out.push({ h, base, roof, pts });\n'
    + '//     }\n'
    + '//     return out; // lon = origin[0] + x / (111320 * cos(origin[1] * PI / 180)), lat = origin[1] + y / 111320\n'
    + '//   }\n';
  const out = head + 'window.M3D = window.M3D || {}; window.M3D.buildingData = ' + JSON.stringify({ areas, format: FORMAT, source: 'OpenStreetMap contributors, ODbL' }) + ';\n';
  fs.mkdirSync(path.join(root, 'js/map3d'), { recursive: true });
  fs.writeFileSync(path.join(root, 'js/map3d/buildings.js'), out);
  const gz = zlib.gzipSync(Buffer.from(out), { level: 9 }).length;
  console.log(`requests sent now: ${stats.queries}, answered: ${stats.answers} (${stats.bytesFetched} bytes); pieces read from disk: ${stats.fromDisk} (${stats.bytesDisk} bytes)`);
  for (const { area, a, data } of results) console.log(`${area.name}: ${a.shapes} shapes read, ${a.replaced} outlines replaced by their parts, ${a.kept.length} kept, ${data.length} bytes packed`);
  console.log(`js/map3d/buildings.js: ${out.length} bytes raw (${(out.length / 1024).toFixed(0)} KB), ${gz} bytes gzipped (${(gz / 1024).toFixed(0)} KB)`);
  if (!PICS) return;

  // ---------- checks ----------
  fs.mkdirSync(PICS, { recursive: true });
  const win = {}; vm.runInContext(fs.readFileSync(path.join(root, 'js/map3d/buildings.js'), 'utf8'), vm.createContext({ window: win }), { filename: 'buildings.js' });
  const file = win.M3D.buildingData;
  for (const { area, a } of results) {
    const fa = file.areas.find(x => x.name === area.name), back = unpack(fa);
    const groups = new Map(); a.kept.forEach(b => { const g = groups.get(b.group); if (!g || b.h > g.h) groups.set(b.group, { h: b.h, name: b.name, id: b.group }); });
    console.log(`\n${area.name}: count in file ${fa.count}, unpacked ${back.length}, buildings (outline groups) ${groups.size}`);
    console.log('| # | Height (m) | Name or address | OSM |'); console.log('|---|---|---|---|');
    [...groups.values()].sort((x, y) => y.h - x.h).slice(0, 10).forEach((g, i) => console.log(`| ${i + 1} | ${g.h} | ${g.name || '(no name)'} | ${g.id.replace(/^(way|relation)/, '$1/')} |`));
    // round trip: unpacked lon/lat against the simplified outline before rounding, for six buildings spread through the list
    let worst = 0; const picks = [0, 1, 2, Math.floor(a.kept.length / 2), a.kept.length - 2, a.kept.length - 1].filter(k => k >= 0 && k < a.kept.length);
    for (const k of picks) {
      const kx = 111320 * Math.cos(fa.origin[1] * Math.PI / 180), ll = back[k].pts.map(([x, y]) => [fa.origin[0] + x / kx, fa.origin[1] + y / 111320]);
      const orig = a.kept[k].ring.map(([x, y]) => [a.lon0 + x / a.kx, a.lat0 + y / KY]);
      // each unpacked point to the nearest simplified point, in metres
      for (const [lon, lat] of ll) { let m = Infinity; for (const [ol, oa] of orig) m = Math.min(m, Math.hypot((lon - ol) * kx, (lat - oa) * 111320)); worst = Math.max(worst, m); }
      if (back[k].h !== a.kept[k].h) worst = Infinity;
    }
    console.log(`round trip: ${picks.length} outlines, worst point error ${worst.toFixed(2)} m, heights equal: ${isFinite(worst)}`);
    const mpp = area.name === 'sf' ? 6 : area.name === 'vegas' ? 3 : 2;
    console.log(`picture ${path.join(PICS, area.name + '.png')}: ${picture(path.join(PICS, area.name + '.png'), back, mpp)} px at ${mpp} m a pixel`);
  }
})().catch(e => { console.error('buildings3d: ' + e.message); process.exit(1); });
