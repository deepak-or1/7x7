#!/usr/bin/env node
// Makes js/map3d/parkdata.js: the parks, reserves, gardens, golf courses, cemeteries and recreation grounds of the 3D map's
// area, from OpenStreetMap through the Overpass API.
//
//   node tools/parks3d.js --raw <dir> [--pictures <dir>] [--sf-ha 0.4] [--min-ha 40] [--rel-tol 0.03] [--keep-nested]
//
// --raw: where the Overpass answers live (<dir>/<piece>.json, with the query sent beside it as <piece>.query). A piece is
// queried only when its file is missing, so a second run needs no network. The answers are treated as untrusted data: size
// limit, JSON only, type checks on every field used, nothing in them is ever run.
// --pictures: also write a top-down picture of each area there (bay.png, sf.png, vegas.png: shapes filled by kind) and print
// the checks (counts and hectares per kind and area, the named parks, what OpenStreetMap has for Presidio Tunnel Tops, a round
// trip of the packed file).
// --sf-ha: the smallest shape kept inside San Francisco and on the Strip (default 0.4 ha); --min-ha: elsewhere (default 40 ha).
// --rel-tol: outside San Francisco and the Strip a large shape is simplified to this share of its side (the square root of its
// area) when that is more than 15 m (default 0.03: 95 m for 1,000 ha, 300 m for 10,000 ha).
// --keep-nested: keep the shapes outside San Francisco and the Strip that lie 90% or more inside larger kept shapes (left out by
// default: they add no ground of their own).
// The task asked for 6 ha elsewhere and 15 m; that makes the file about 250 KB (163 KB gzipped) against a budget of 180 KB
// (80 KB gzipped). The defaults above are what fits: about 115 KB (74 KB gzipped).
//
// Areas (bounds from the places in data/geo.js, run in a sandbox: it is the repo's own file): bay (every place of the Bay plus
// 0.03 degrees) and vegas (the Strip plus 0.03 degrees). Asked for: ways and relations with leisure = park, nature_reserve,
// garden, golf_course; landuse = recreation_ground, cemetery; boundary = national_park, protected_area. Kept: everything with a
// leisure or landuse tag above, boundary=national_park, and boundary=protected_area only where it is parkland (protect_class 1 to
// 6, 1a, 1b or not given) and not water or closed: a marine area, sanctuary, the coastal national monument (rocks at sea),
// easement, water district or a closed area by its tags or name (a leisure=nature_reserve that fails the same test is left out
// too). Kind: 0 park
// (leisure=park, boundary=national_park), 1 reserve (nature_reserve, protected_area), 2 garden, 3 golf, 4 cemetery, 5 recreation
// (landuse=recreation_ground); leisure wins over landuse, landuse over boundary. Outer rings only (holes dropped; a relation's
// outer rings are separate shapes sharing its name), filtered by size (the shape's centre decides which limit). The same ground
// mapped twice (two shapes overlapping by 80% or more of their union) keeps the more detailed outline (more points in
// OpenStreetMap), with the name and kind of the one tagged as a park when only one is. Then simplified (Douglas-Peucker, 4 m
// inside San Francisco and on the Strip, --rel-tol or at least 15 m elsewhere). No packages.
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib'), https = require('https'), vm = require('vm');
const root = path.join(__dirname, '..');

const args = process.argv.slice(2), arg = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const RAW = arg('--raw'), PICS = arg('--pictures'), SF_HA = +arg('--sf-ha', 0.4), MIN_HA = +arg('--min-ha', 40), REL = +arg('--rel-tol', 0.03), NESTED = !args.includes('--keep-nested');
if (!RAW || !(SF_HA >= 0 && SF_HA <= 100 && MIN_HA >= 0 && MIN_HA <= 1000 && REL >= 0 && REL <= 0.1)) { console.error('usage: node tools/parks3d.js --raw <dir> [--pictures <dir>] [--sf-ha 0.4] [--min-ha 40] [--rel-tol 0.03] [--keep-nested]'); process.exit(2); }

// ---------- the map's areas (bbox: [west, south, east, north]) ----------
const win = {}; vm.runInContext(fs.readFileSync(path.join(root, 'data/geo.js'), 'utf8'), vm.createContext({ window: win }), { filename: 'data/geo.js' });
const region = {}; win.GEO.hoods.forEach(h => { region[h.name] = h.region; });
function boundsOf(test) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  win.HP.forEach(h => { if (!test(region[h.name])) return; h.polys.forEach(p => p.forEach(r => r.forEach(([x, y]) => { if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y; }))); });
  return b;
}
const r4 = v => Math.round(v * 1e4) / 1e4, grow = (b, m) => [b[0] - m, b[1] - m, b[2] + m, b[3] + m].map(r4);
const BAY = grow(boundsOf(r => r && r !== 'vegas'), 0.03), LV = grow(boundsOf(r => r === 'vegas'), 0.03), SF = grow(boundsOf(r => r === 'sf'), 0);
const split = (b, nx, ny, name) => { const out = []; for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) out.push({ name: `${name}-${j}${i}`, bbox: [b[0] + (b[2] - b[0]) * i / nx, b[1] + (b[3] - b[1]) * j / ny, b[0] + (b[2] - b[0]) * (i + 1) / nx, b[1] + (b[3] - b[1]) * (j + 1) / ny].map(r4) }); return out; };
const AREAS = [
  // bay-12 (the East Bay hills and Contra Costa: many parks and large reserves) timed out whole, so it is asked in four parts
  { name: 'bay', box: BAY, pieces: split(BAY, 3, 3, 'bay').flatMap(p => p.name === 'bay-12' ? split(p.bbox, 2, 2, 'bay-12') : [p]) },
  { name: 'vegas', box: LV, pieces: [{ name: 'vegas', bbox: LV }] },
];
const inBox = (b, lon, lat) => lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3];
const fine = (lon, lat) => inBox(SF, lon, lat) || inBox(LV, lon, lat); // San Francisco and the Strip: finer tolerance, smaller limit
function query(p) {
  const b = `${p.bbox[1]},${p.bbox[0]},${p.bbox[3]},${p.bbox[2]}`; // Overpass order: south, west, north, east
  const sets = [];
  for (const t of ['way', 'relation']) sets.push(`${t}["leisure"~"^(park|nature_reserve|garden|golf_course)$"](${b});`, `${t}["landuse"~"^(recreation_ground|cemetery)$"](${b});`, `${t}["boundary"~"^(national_park|protected_area)$"](${b});`);
  return `[out:json][timeout:240];(${sets.join('')});out geom;`;
}

// ---------- fetching (each piece once, kept on disk) ----------
const SERVERS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const MAX_BODY = 300 << 20;
const stats = { queries: 0, answers: 0, bytesFetched: 0, fromDisk: 0, bytesDisk: 0 };
const sleep = ms => new Promise(r => setTimeout(r, ms));
function post(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url), data = Buffer.from('data=' + encodeURIComponent(body));
    const req = https.request({ hostname: u.hostname, path: u.pathname, method: 'POST', timeout: 360000,
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
  if (buf.length > MAX_BODY) throw new Error('answer over size limit');
  const j = JSON.parse(buf.toString('utf8'));
  if (!j || typeof j !== 'object' || !Array.isArray(j.elements)) throw new Error('answer has no elements list');
  if (typeof j.remark === 'string' && /error|timed out|out of memory/i.test(j.remark)) throw new Error('server remark: ' + j.remark.slice(0, 200));
  return j;
}
let fetchedBefore = false;
async function piece(p) {
  const file = path.join(RAW, p.name + '.json'), q = query(p);
  if (fs.existsSync(file)) {
    const b = fs.readFileSync(file); stats.fromDisk++; stats.bytesDisk += b.length;
    const qf = file.replace(/\.json$/, '.query'); if (fs.existsSync(qf) && fs.readFileSync(qf, 'utf8') !== q) console.log(`  note: ${p.name}.json was fetched with another query (the bounds moved?); delete it to fetch again`);
    return parseAnswer(b);
  }
  let lastErr;
  // A "busy" answer (429, 502, 503, 504: the server asks for backoff) is retried after 30, 60, 120 s; any other refusal, or a
  // fourth busy answer, moves on to the next server, and when both have refused the run stops.
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
    fs.writeFileSync(file.replace(/\.json$/, '.query'), q);
    fs.writeFileSync(file + '.part', r.body); fs.renameSync(file + '.part', file);
    console.log(`  fetched ${p.name} from ${new URL(url).hostname}: ${r.body.length} bytes, ${j.elements.length} elements`);
    return j;
  }
  throw new Error(`every server refused piece ${p.name}; stopping. Last: ${lastErr}`);
}

// ---------- geometry ----------
const KY = 111320, kxAt = lat => 111320 * Math.cos(lat * Math.PI / 180);
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const str = (t, k, max) => typeof t[k] === 'string' ? t[k].trim().slice(0, max) : '';
const sArea = r => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j][0] * r[i][1] - r[i][0] * r[j][1]; return a / 2; };
function pip(r, x, y) { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; }
function segDist2(px, py, ax, ay, bx, by) { const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy; let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t; const qx = ax + dx * t - px, qy = ay + dy * t - py; return qx * qx + qy * qy; }
const local = ll => { const c = ll.reduce((s, p) => [s[0] + p[0] / ll.length, s[1] + p[1] / ll.length], [0, 0]), kx = kxAt(c[1]); return { c, m: ll.map(([lon, lat]) => [(lon - c[0]) * kx, (lat - c[1]) * KY]) }; };
const hectares = ll => Math.abs(sArea(local(ll).m)) / 1e4;
// closed ring in lon/lat without the closing point, Douglas-Peucker in local metres with a tolerance per point; keeps the point
// farthest from the first as an anchor
function simplifyRing(ll, tolOf) {
  if (ll.length <= 4) return ll;
  const { m: r } = local(ll);
  let k = 0, md = -1; for (let i = 1; i < r.length; i++) { const d = (r[i][0] - r[0][0]) ** 2 + (r[i][1] - r[0][1]) ** 2; if (d > md) { md = d; k = i; } }
  const n = r.length, keep = new Uint8Array(n); keep[0] = keep[k] = 1; const stack = [[0, k], [k, n]];
  while (stack.length) {
    const [a, b] = stack.pop(), A = r[a], B = r[b % n]; let mi = -1, worst = 0;
    for (let i = a + 1; i < b; i++) { const over = Math.sqrt(segDist2(r[i][0], r[i][1], A[0], A[1], B[0], B[1])) - tolOf(ll[i]); if (over > worst) { worst = over; mi = i; } }
    if (mi >= 0) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return ll.filter((_, i) => keep[i]);
}
function llRingLoose(g) {
  if (!Array.isArray(g) || g.length < 2 || g.length > 200000) return null;
  const r = []; for (const p of g) { if (!p || !isNum(p.lat) || !isNum(p.lon) || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) return null; r.push([p.lon, p.lat]); }
  return r;
}
// join a multipolygon's outer member ways into closed rings (holes, role "inner", are left out)
function joinRings(members) {
  const segs = []; for (const m of members) { if (!m || m.type !== 'way' || (m.role !== 'outer' && m.role !== '')) continue; const g = llRingLoose(m.geometry); if (g) segs.push(g); }
  if (segs.length > 20000) return [];
  const rings = [], same = (a, b) => a[0] === b[0] && a[1] === b[1];
  while (segs.length) {
    let cur = segs.shift(), guard = 0;
    while (!same(cur[0], cur[cur.length - 1]) && guard++ < 20000) {
      const end = cur[cur.length - 1]; const i = segs.findIndex(s => same(s[0], end) || same(s[s.length - 1], end));
      if (i < 0) break; const s = segs.splice(i, 1)[0]; cur = cur.concat((same(s[0], end) ? s : s.slice().reverse()).slice(1));
    }
    if (cur.length >= 4 && same(cur[0], cur[cur.length - 1])) rings.push(cur);
  }
  return rings;
}

// ---------- one area: elements -> shapes ----------
const KIND_NAME = ['park', 'reserve', 'garden', 'golf', 'cemetery', 'recreation'];
const LEISURE = { park: 0, nature_reserve: 1, garden: 2, golf_course: 3 }, LANDUSE = { cemetery: 4, recreation_ground: 5 };
const NOT_PARK = /marine|ocean|sanctuary|coastal national monument|easement|water district|fishery|offshore|seabird|closed to public/i;
function kindOf(t) {
  const words = [t.name, t.protection_title, t.designation, t['protected_area'], t.site_type].filter(s => typeof s === 'string').join(' ');
  const wet = NOT_PARK.test(words) || t.marine === 'yes' || typeof t.water === 'string'; // sea and water reserves, sanctuaries, easements
  if (typeof t.leisure === 'string' && t.leisure in LEISURE) {
    if (t.leisure === 'nature_reserve' && wet) return { kind: -1, by: 'leisure=nature_reserve (not parkland: ' + words.slice(0, 50) + ')' };
    return { kind: LEISURE[t.leisure], by: 'leisure=' + t.leisure };
  }
  if (typeof t.landuse === 'string' && t.landuse in LANDUSE) return { kind: LANDUSE[t.landuse], by: 'landuse=' + t.landuse };
  if (t.boundary === 'national_park') return { kind: 0, by: 'boundary=national_park' };
  if (t.boundary === 'protected_area') {
    const pc = str(t, 'protect_class', 10);
    if ((pc && !/^([1-6]|1a|1b)$/.test(pc)) || wet) return { kind: -1, by: 'boundary=protected_area (not parkland: ' + (pc && !/^([1-6]|1a|1b)$/.test(pc) ? 'protect_class ' + pc : words.slice(0, 50)) + ')' };
    return { kind: 1, by: 'boundary=protected_area' };
  }
  return { kind: -1, by: 'no kind' };
}
// every outer ring of every element, before any filter (`all` is kept for the checks)
function shapes(elements) {
  const out = [], seen = new Set();
  for (const e of elements) {
    if (!e || typeof e !== 'object' || (e.type !== 'way' && e.type !== 'relation') || !isNum(e.id)) continue;
    const id = e.type + '/' + e.id; if (seen.has(id)) continue; seen.add(id);
    const t = e.tags && typeof e.tags === 'object' ? e.tags : {};
    const k = kindOf(t); let rings;
    if (e.type === 'way') { const r = llRingLoose(e.geometry); rings = r && r.length >= 4 && r[0][0] === r[r.length - 1][0] && r[0][1] === r[r.length - 1][1] ? [r] : []; }
    else rings = (t.type === 'multipolygon' || t.type === 'boundary') && Array.isArray(e.members) ? joinRings(e.members) : [];
    const name = str(t, 'name', 80);
    rings.forEach((r, i) => { const ll = r.slice(0, -1); out.push({ id, ring: i, kind: k.kind, by: k.by, name, ll, osmPts: ll.length, ha: hectares(ll) }); });
    if (!rings.length) out.push({ id, ring: -1, kind: k.kind, by: k.by, name, ll: null, osmPts: 0, ha: 0, why: e.type === 'way' ? 'not a closed way' : 'no closed outer ring' });
  }
  return out;
}
function centreOf(ll) { const c = local(ll); let a = 0, cx = 0, cy = 0; const r = c.m; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const f = r[j][0] * r[i][1] - r[i][0] * r[j][1]; a += f; cx += (r[j][0] + r[i][0]) * f; cy += (r[j][1] + r[i][1]) * f; } a *= 3; const kx = kxAt(c.c[1]); return a ? [c.c[0] + cx / a / kx, c.c[1] + cy / a / KY] : ll[0]; }
function buildArea(area, elements) {
  const all = shapes(elements);
  for (const s of all) {
    if (!s.ll) continue;
    if (s.kind < 0) { s.why = s.by; continue; }
    s.c = centreOf(s.ll);
    if (!inBox(area.box, s.c[0], s.c[1])) { s.why = 'centre outside the area'; continue; }
    const lim = fine(s.c[0], s.c[1]) ? SF_HA : MIN_HA; if (s.ha < lim) { s.why = `under ${lim} ha`; continue; }
    s.ok = true;
  }
  let cand = all.filter(s => s.ok);
  // the same ground mapped twice: bounding boxes first, then the overlap measured on a 24 x 24 grid of sample points
  cand.forEach(s => { s.b = s.ll.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [180, 90, -180, -90]); });
  cand.sort((a, b) => a.b[0] - b.b[0]);
  const dups = [];
  for (let i = 0; i < cand.length; i++) for (let j = i + 1; j < cand.length && cand[j].b[0] <= cand[i].b[2]; j++) {
    const a = cand[i], b = cand[j]; if (a.dup || b.dup) continue;
    const r = a.ha / b.ha; if (r < 0.6 || r > 1 / 0.6) continue;
    const u = [Math.min(a.b[0], b.b[0]), Math.min(a.b[1], b.b[1]), Math.max(a.b[2], b.b[2]), Math.max(a.b[3], b.b[3])];
    const ix = Math.max(0, Math.min(a.b[2], b.b[2]) - Math.max(a.b[0], b.b[0])), iy = Math.max(0, Math.min(a.b[3], b.b[3]) - Math.max(a.b[1], b.b[1]));
    if (ix * iy < 0.5 * (u[2] - u[0]) * (u[3] - u[1])) continue;
    let both = 0, either = 0;
    for (let gy = 0; gy < 24; gy++) for (let gx = 0; gx < 24; gx++) { const x = u[0] + (u[2] - u[0]) * (gx + 0.5) / 24, y = u[1] + (u[3] - u[1]) * (gy + 0.5) / 24, pa = pip(a.ll, x, y), pb = pip(b.ll, x, y); if (pa && pb) both++; if (pa || pb) either++; }
    if (either && both / either >= 0.8) {
      const [keep, drop] = a.osmPts >= b.osmPts ? [a, b] : [b, a];
      drop.dup = true; drop.ok = false; drop.why = `same ground as ${keep.id} (${Math.round(100 * both / either)}% overlap), kept the one with more points`;
      // the more detailed outline stays; when only the other one is tagged as a park (leisure or landuse, not just a boundary),
      // its name and kind go with it (the Presidio is both a leisure=park and a ring of the GGNRA boundary)
      if ((/^(leisure|landuse)/.test(drop.by) && !/^(leisure|landuse)/.test(keep.by)) || (!keep.name && drop.name)) { keep.name = drop.name || keep.name; if (/^(leisure|landuse)/.test(drop.by)) { keep.kind = drop.kind; keep.by = drop.by + ' (outline of ' + keep.id + ')'; } }
      dups.push({ keep, drop, iou: both / either });
    }
  }
  cand = cand.filter(s => s.ok);
  for (const s of cand) {
    const far = Math.max(15, REL * Math.sqrt(s.ha * 1e4)); // a large shape outside the city: REL of its side
    let r = simplifyRing(s.ll, p => fine(p[0], p[1]) ? 4 : far);
    if (r.length < 3) { s.ok = false; s.why = 'nothing left after simplifying'; continue; }
    s.out = r;
  }
  // outside San Francisco and the Strip, a shape lying 90% or more inside larger kept shapes adds no ground of its own
  // and is left out (sampled on a grid of points inside it)
  let nested = 0;
  if (NESTED) {
    const big = cand.filter(s => s.ok).sort((a, b) => b.ha - a.ha);
    big.forEach(s => { s.bb = s.out.reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [180, 90, -180, -90]); });
    for (let i = 0; i < big.length; i++) {
      const s = big[i]; if (fine(s.c[0], s.c[1])) continue;
      const over = big.slice(0, i).filter(o => o.ok && o.ha > s.ha && o.bb[0] <= s.bb[2] && o.bb[2] >= s.bb[0] && o.bb[1] <= s.bb[3] && o.bb[3] >= s.bb[1]); if (!over.length) continue;
      let n = 0, inside = 0;
      for (let gy = 0; gy < 12; gy++) for (let gx = 0; gx < 12; gx++) { const x = s.bb[0] + (s.bb[2] - s.bb[0]) * (gx + 0.5) / 12, y = s.bb[1] + (s.bb[3] - s.bb[1]) * (gy + 0.5) / 12; if (!pip(s.out, x, y)) continue; n++; if (over.some(o => pip(o.out, x, y))) inside++; }
      if (n >= 4 && inside >= 0.9 * n) { const o = over.find(q => pip(q.out, s.c[0], s.c[1])) || over[0]; s.ok = false; s.why = `${Math.round(100 * inside / n)}% inside ${o.name || o.id} (larger, kept)`; nested++; }
    }
  }
  return { all, kept: cand.filter(s => s.ok), dups, nested };
}

// ---------- packing ----------
// per shape: kind, name index (into `names`, 0 is ''), area in tenths of a hectare, point count n, then n points as (dx, dy) in
// whole metres: the first from the previous shape's first point (the area's origin for the first shape), the rest from the
// point before. All unsigned LEB128 varints except dx, dy, which are zigzag-signed; base64.
const FORMAT = 'base64 bytes of varints (7 bits a byte, low first, high bit = more); per shape: kind (0 park 1 reserve 2 garden 3 golf 4 cemetery 5 recreation), name index (into names, 0 = none), area in tenths of a hectare, n, then n points as zigzag (dx, dy) in whole metres east and north, the first from the previous shape\'s first point (origin for the first), the rest from the point before; lon = origin[0] + x / (111320 cos(origin[1] deg)), lat = origin[1] + y / 111320; rings are outer rings only, counter-clockwise, not closed';
function packArea(a, shapesIn, names) {
  const bytes = [], uv = v => { do { let b = v & 127; v = Math.floor(v / 128); if (v) b |= 128; bytes.push(b); } while (v); }, sv = v => uv(v < 0 ? -2 * v - 1 : 2 * v);
  const kx = kxAt(a.lat0), nameIx = s => { if (!s) return 0; let i = names.indexOf(s); if (i < 0) { names.push(s); i = names.length - 1; } return i; };
  let px = 0, py = 0; const out = [];
  for (const s of shapesIn) {
    let pts = []; s.out.forEach(([lon, lat]) => { const q = [Math.round((lon - a.lon0) * kx), Math.round((lat - a.lat0) * KY)], z = pts[pts.length - 1]; if (!z || z[0] !== q[0] || z[1] !== q[1]) pts.push(q); });
    if (pts.length > 1 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
    if (pts.length < 3 || sArea(pts) === 0) continue;
    if (sArea(pts) < 0) { pts = pts.reverse(); s.out = s.out.slice().reverse(); } // counter-clockwise (x east, y north)
    s.m = pts; s.tenths = Math.max(1, Math.round(s.ha * 10)); out.push(s);
    uv(s.kind); uv(nameIx(s.name)); uv(s.tenths); uv(pts.length);
    sv(pts[0][0] - px); sv(pts[0][1] - py); px = pts[0][0]; py = pts[0][1];
    for (let i = 1; i < pts.length; i++) { sv(pts[i][0] - pts[i - 1][0]); sv(pts[i][1] - pts[i - 1][1]); }
  }
  return { data: Buffer.from(bytes).toString('base64'), shapes: out };
}
// the reader, as the engine would write it (also in the file's header comment)
function unpack(area) {
  const s = Buffer.from(area.data, 'base64'); let i = 0;
  const uv = () => { let v = 0, m = 1, b; do { b = s[i++]; v += (b & 127) * m; m *= 128; } while (b & 128); return v; }, sv = () => { const u = uv(); return u & 1 ? -(u + 1) / 2 : u / 2; };
  const out = []; let px = 0, py = 0;
  while (i < s.length) {
    const kind = uv(), name = uv(), ha = uv() / 10, n = uv(), pts = [];
    let x = px + sv(), y = py + sv(); px = x; py = y; pts.push([x, y]);
    for (let k = 1; k < n; k++) { x += sv(); y += sv(); pts.push([x, y]); }
    out.push({ kind, name, ha, pts });
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
function canvas(box, mpp) {
  const kx = kxAt(box[1]), w = Math.ceil((box[2] - box[0]) * kx / mpp), h = Math.ceil((box[3] - box[1]) * KY / mpp);
  const c = { w, h, rgb: Buffer.alloc(w * h * 3, 0), P: ([lon, lat]) => [(lon - box[0]) * kx / mpp, (box[3] - lat) * KY / mpp] };
  for (let i = 0; i < w * h; i++) { c.rgb[i * 3] = 205; c.rgb[i * 3 + 1] = 222; c.rgb[i * 3 + 2] = 235; } // water
  return c;
}
function fill(c, ring, col, edge) {
  const P = ring.map(c.P); let ya = Infinity, yb = -Infinity; P.forEach(p => { ya = Math.min(ya, p[1]); yb = Math.max(yb, p[1]); });
  const put = (x, y, k) => { if (x < 0 || y < 0 || x >= c.w || y >= c.h) return; const o = (y * c.w + x) * 3; c.rgb[o] = k[0]; c.rgb[o + 1] = k[1]; c.rgb[o + 2] = k[2]; };
  for (let py = Math.max(0, Math.floor(ya)); py <= Math.min(c.h - 1, Math.ceil(yb)); py++) {
    const yc = py + 0.5, xs = [];
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if ((yi > yc) !== (yj > yc)) xs.push(xi + (yc - yi) / (yj - yi) * (xj - xi)); }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) for (let px = Math.max(0, Math.round(xs[k])); px < Math.min(c.w, Math.round(xs[k + 1])); px++) put(px, py, col);
  }
  if (edge) for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const n = Math.ceil(Math.hypot(P[i][0] - P[j][0], P[i][1] - P[j][1]) * 2) + 1; for (let k = 0; k <= n; k++) put(Math.floor(P[j][0] + (P[i][0] - P[j][0]) * k / n), Math.floor(P[j][1] + (P[i][1] - P[j][1]) * k / n), edge); }
}
const COL = [[110, 180, 90], [60, 130, 70], [200, 120, 170], [170, 210, 80], [150, 150, 130], [230, 190, 90]];
function picture(file, box, mpp, list) {
  const c = canvas(box, mpp); // the land of data/geo.js (the places and the land filler), for orientation; on the Strip land everywhere
  if (box === LV) for (let i = 0; i < c.rgb.length; i++) c.rgb[i] = [242, 238, 228][i % 3];
  else [...win.HP.flatMap(h => h.polys), ...win.GEO.other].forEach(poly => fill(c, poly[0], [242, 238, 228]));
  win.GEO.water.forEach(poly => fill(c, poly[0], [205, 222, 235]));
  list.slice().sort((a, b) => b.ha - a.ha).forEach(s => fill(c, s.ll, COL[s.kind], mpp <= 10 ? COL[s.kind].map(v => Math.round(v * 0.6)) : null)); // big first, small on top
  writePNG(file, c.w, c.h, c.rgb);
  return `${c.w} x ${c.h}`;
}

(async () => {
  const results = [];
  for (const area of AREAS) {
    const els = [];
    for (const p of area.pieces) els.push(...(await piece(p)).elements);
    results.push({ area, els: els.length, ...buildArea(area, els) });
  }
  const names = [''], packed = {};
  for (const r of results) {
    const lon0 = Math.round(r.area.box[0] * 1e4) / 1e4, lat0 = Math.round(r.area.box[1] * 1e4) / 1e4, kx = kxAt(lat0);
    r.lon0 = lon0; r.lat0 = lat0;
    r.kept.sort((a, b) => (Math.floor((a.out[0][1] - lat0) * KY / 2000) - Math.floor((b.out[0][1] - lat0) * KY / 2000)) || ((a.out[0][0] - b.out[0][0]) * kx));
    const p = packArea(r, r.kept, names); r.kept = p.shapes;
    packed[r.area.name] = { name: r.area.name, origin: [lon0, lat0], count: p.shapes.length, data: p.data };
  }
  const parkData = { areas: [packed.bay, packed.vegas], names, format: FORMAT, source: 'OpenStreetMap contributors, ODbL' };
  const head = '// Generated by tools/parks3d.js (do not edit by hand): parks and other green ground for the 3D map, from OpenStreetMap\n'
    + '// (Overpass API). areas: bay (every place of the Bay plus a margin) and vegas (the Strip plus a margin). Kept: ' + SF_HA + ' ha or larger\n'
    + '// inside San Francisco and on the Strip, ' + MIN_HA + ' ha or larger elsewhere; outer rings only (a relation\'s rings are separate shapes\n'
    + '// sharing its name), simplified (4 m in San Francisco and on the Strip, elsewhere 15 m or ' + (REL * 100) + '% of a large shape\'s side);\n'
    + '// ' + (NESTED ? 'outside the city, shapes lying inside larger ones left out. ' : '') + 'names: the name strings. Per area,\n'
    + '// data is base64 of varints; see `format`. Unpack one area into [{ kind, name, ha, pts: [[x, y], ...] }] (x, y metres east,\n'
    + '// north of origin; kind 0 park 1 reserve 2 garden 3 golf 4 cemetery 5 recreation):\n'
    + '//\n'
    + '//   function unpack(area, names) {\n'
    + '//     const bin = atob(area.data), s = new Uint8Array(bin.length); for (let k = 0; k < bin.length; k++) s[k] = bin.charCodeAt(k);\n'
    + '//     let i = 0, px = 0, py = 0; const out = [];\n'
    + '//     const uv = () => { let v = 0, m = 1, b; do { b = s[i++]; v += (b & 127) * m; m *= 128; } while (b & 128); return v; };\n'
    + '//     const sv = () => { const u = uv(); return u & 1 ? -(u + 1) / 2 : u / 2; };\n'
    + '//     while (i < s.length) {\n'
    + '//       const kind = uv(), name = names[uv()], ha = uv() / 10, n = uv(), pts = [];\n'
    + '//       let x = px + sv(), y = py + sv(); px = x; py = y; pts.push([x, y]);\n'
    + '//       for (let k = 1; k < n; k++) { x += sv(); y += sv(); pts.push([x, y]); }\n'
    + '//       out.push({ kind, name, ha, pts });\n'
    + '//     }\n'
    + '//     return out; // lon = origin[0] + x / (111320 * cos(origin[1] * PI / 180)), lat = origin[1] + y / 111320\n'
    + '//   }\n'
    + '//   // unpack(M3D.parkData.areas[0], M3D.parkData.names)\n';
  const out = head + 'window.M3D = window.M3D || {}; window.M3D.parkData = ' + JSON.stringify(parkData) + ';\n';
  fs.mkdirSync(path.join(root, 'js/map3d'), { recursive: true });
  fs.writeFileSync(path.join(root, 'js/map3d/parkdata.js'), out);
  const gz = zlib.gzipSync(Buffer.from(out), { level: 9 }).length;
  console.log(`requests sent now: ${stats.queries}, answered: ${stats.answers} (${stats.bytesFetched} bytes); pieces read from disk: ${stats.fromDisk} (${stats.bytesDisk} bytes)`);
  console.log(`boxes: bay ${BAY.join(', ')}; vegas ${LV.join(', ')}; San Francisco (4 m, ${SF_HA} ha) ${SF.join(', ')}`);
  for (const r of results) console.log(`${r.area.name}: ${r.els} elements, ${r.all.length} outer rings read, ${r.dups.length} duplicates dropped, ${r.nested} inside larger shapes left out, ${r.kept.length} shapes kept, ${packed[r.area.name].data.length} bytes packed`);
  console.log(`js/map3d/parkdata.js: ${out.length} bytes raw (${(out.length / 1024).toFixed(0)} KB), ${gz} bytes gzipped (${(gz / 1024).toFixed(0)} KB); ${names.length} names`);
  if (out.length > 180 * 1024 || gz > 80 * 1024) console.log('OVER BUDGET (180 KB raw, 80 KB gzipped)');
  if (!PICS) return;

  // ---------- checks ----------
  fs.mkdirSync(PICS, { recursive: true });
  const w2 = {}; vm.runInContext(fs.readFileSync(path.join(root, 'js/map3d/parkdata.js'), 'utf8'), vm.createContext({ window: w2 }), { filename: 'parkdata.js' });
  const file = w2.M3D.parkData;
  const hp = win.HP.map(h => ({ region: region[h.name], polys: h.polys.map(p => ({ p, b: p[0].reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [180, 90, -180, -90]) })) }));
  const regionOf = (lon, lat) => { for (const h of hp) for (const { p, b } of h.polys) if (lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3] && pip(p[0], lon, lat) && !p.slice(1).some(q => pip(q, lon, lat))) return h.region; return '(outside places)'; };
  console.log('\nshapes and hectares per kind, area and region (region: the app\'s place polygon the shape\'s centre falls in)');
  console.log('| Area | Region | Kind | Shapes | ha |'); console.log('|---|---|---|---|---|');
  for (const r of results) {
    const t = new Map();
    for (const s of r.kept) { const reg = r.area.name === 'bay' ? regionOf(s.c[0], s.c[1]) : 'vegas', k = reg + '|' + s.kind; if (!t.has(k)) t.set(k, { reg, kind: s.kind, n: 0, ha: 0 }); const e = t.get(k); e.n++; e.ha += s.ha; }
    [...t.values()].sort((x, y) => x.reg.localeCompare(y.reg) || x.kind - y.kind).forEach(e => console.log(`| ${r.area.name} | ${e.reg} | ${KIND_NAME[e.kind]} | ${e.n} | ${Math.round(e.ha)} |`));
    console.log(`| ${r.area.name} | all | all | ${r.kept.length} | ${Math.round(r.kept.reduce((s, x) => s + x.ha, 0))} |`);
  }
  const bay = results.find(x => x.area.name === 'bay');
  const CHECK = [['Golden Gate Park', /^golden gate park$/i], ['The Panhandle', /panhandle/i], ['the Presidio', /presidio/i], ['Dolores Park', /dolores park/i], ['Alamo Square', /alamo square/i], ['Buena Vista Park', /buena vista park/i],
    ['McLaren Park', /mclaren park/i], ['Lincoln Park', /^lincoln park$/i], ['Lake Merritt / Lakeside Park', /lake merritt|lakeside park/i], ['Tilden Regional Park', /tilden/i], ['Presidio Tunnel Tops', /tunnel tops/i]];
  console.log('\nnamed parks: every outer ring in the answers whose name matches, kept or not (and why not)');
  console.log('| Check | Name in OSM | OSM | Tag | ha | OSM points | Kept | Packed points or reason |'); console.log('|---|---|---|---|---|---|---|---|');
  for (const [label, re] of CHECK) {
    const hits = bay.all.filter(s => re.test(s.name)).sort((a, b) => b.ha - a.ha);
    if (!hits.length) { console.log(`| ${label} | (no element with this name) | | | | | no | |`); continue; }
    hits.slice(0, 8).forEach(s => console.log(`| ${label} | ${s.name} | ${s.id}${s.ring > 0 ? ' ring ' + s.ring : ''} | ${s.by} | ${s.ha.toFixed(1)} | ${s.osmPts} | ${s.ok ? 'yes' : 'no'} | ${s.ok ? s.m.length : s.why} |`));
    if (hits.length > 8) console.log(`| ${label} | ... ${hits.length - 8} more | | | | | | |`);
  }
  // what is mapped at the Tunnel Tops site itself (the park on the Presidio Parkway's tunnels, about -122.4625, 37.8030)
  const TT = [-122.4655, 37.8015, -122.4595, 37.8045];
  console.log('\nshapes in the answers that cover the Tunnel Tops site (-122.4625, 37.8030)');
  console.log('| Name | OSM | Tag | ha | Kept |'); console.log('|---|---|---|---|---|');
  bay.all.filter(s => s.ll && pip(s.ll, -122.4625, 37.8030)).forEach(s => console.log(`| ${s.name || '(no name)'} | ${s.id} | ${s.by} | ${s.ha.toFixed(1)} | ${s.ok ? 'yes' : 'no: ' + s.why} |`));
  bay.all.filter(s => s.ll && !pip(s.ll, -122.4625, 37.8030) && s.ll.some(([x, y]) => inBox(TT, x, y))).forEach(s => console.log(`| ${s.name || '(no name)'} (touches the site) | ${s.id} | ${s.by} | ${s.ha.toFixed(1)} | ${s.ok ? 'yes' : 'no: ' + s.why} |`));
  console.log('\nduplicates dropped (the same ground mapped twice), the ten largest');
  console.log('| Kept | Dropped | ha | overlap |'); console.log('|---|---|---|---|');
  results.flatMap(r => r.dups).sort((a, b) => b.keep.ha - a.keep.ha).slice(0, 10).forEach(d => console.log(`| ${d.keep.name || '(no name)'} ${d.keep.id} (${d.keep.by}, ${d.keep.osmPts} pts) | ${d.drop.name || '(no name)'} ${d.drop.id} (${d.drop.by}, ${d.drop.osmPts} pts) | ${d.keep.ha.toFixed(1)} | ${Math.round(d.iou * 100)}% |`));
  console.log('\nthe twenty largest shapes kept in the bay');
  console.log('| Name | OSM | Tag | ha |'); console.log('|---|---|---|---|');
  bay.kept.slice().sort((a, b) => b.ha - a.ha).slice(0, 20).forEach(s => console.log(`| ${s.name || '(no name)'} | ${s.id} | ${s.by} | ${Math.round(s.ha)} |`));
  const pa = new Map(); bay.all.filter(s => /\(not parkland/.test(s.by)).forEach(s => { const k = s.name || '(no name)'; if (!pa.has(k) || pa.get(k).ha < s.ha) pa.set(k, s); });
  console.log(`\nreserves and protected areas left out as not parkland: ${pa.size} names; the largest ten:`);
  [...pa.values()].sort((a, b) => b.ha - a.ha).slice(0, 10).forEach(s => console.log(`  ${s.name || '(no name)'} ${s.id}: ${s.by}, ${Math.round(s.ha)} ha`));
  console.log('\nround trip of js/map3d/parkdata.js');
  for (const r of results) {
    const fa = file.areas.find(x => x.name === r.area.name), back = unpack(fa), kx = kxAt(fa.origin[1]);
    let worst = 0, same = back.length === fa.count && fa.count === r.kept.length;
    const picks = r.kept.map((_, k) => k); // every shape
    for (const k of picks) {
      const s = r.kept[k], u = back[k]; if (u.kind !== s.kind || file.names[u.name] !== s.name || Math.abs(u.ha - s.ha) > 0.05 + 1e-9 && s.ha >= 0.1) same = false;
      for (const [x, y] of u.pts) { const lon = fa.origin[0] + x / kx, lat = fa.origin[1] + y / KY; let m = Infinity; for (const q of s.out) m = Math.min(m, Math.hypot((lon - q[0]) * kxAt(lat), (lat - q[1]) * KY)); worst = Math.max(worst, m); }
    }
    console.log(`${r.area.name}: count in file ${fa.count}, unpacked ${back.length}, shapes built ${r.kept.length}; ${picks.length} shapes compared, worst point error ${worst.toFixed(2)} m, fields equal: ${same}`);
    r.back = back.map(u => ({ kind: u.kind, ha: u.ha, ll: u.pts.map(([x, y]) => [fa.origin[0] + x / kx, fa.origin[1] + y / KY]) }));
  }
  const R = n => results.find(x => x.area.name === n).back;
  for (const [n, box, mpp, list] of [['bay', BAY, 100, R('bay')], ['sf', grow(SF, 0.005), 6, R('bay')], ['vegas', LV, 6, R('vegas')]]) {
    const f = path.join(PICS, n + '.png'); console.log(`picture ${f}: ${picture(f, box, mpp, list)} px at ${mpp} m a pixel`);
  }
})().catch(e => { console.error('parks3d: ' + e.message); process.exit(1); });
