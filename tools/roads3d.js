#!/usr/bin/env node
// Makes js/map3d/roaddata.js: the real highway network for the 3D map, from OpenStreetMap through the Overpass API.
//
//   node tools/roads3d.js --raw <dir> [--pictures <dir>] [--far-m 10] [--links near|all]
//
// --raw: where the Overpass answers live (<dir>/<piece>.json, with the query sent beside it as <piece>.query). A piece is
// queried only when its file is missing, so a second run needs no network. The answers are treated as untrusted data: size
// limit, JSON only, type checks on every field used, nothing in them is ever run.
// --pictures: also write a top-down picture of each area there (bay.png, sf.png, vegas.png: lines coloured by class, raised
// stretches with a dark casing, tunnels dashed, the stretches on the map's own bridges in cyan) and print the checks (counts and
// lengths per class and area, the named routes, the Presidio Parkway tunnels, the raised stretches in SoMa, the bridge marks,
// a round trip of the packed file).
// --far-m: the Douglas-Peucker tolerance outside San Francisco and the Strip (default 10 m).
// --links: near (default) keeps the bay's links (ramps) only in and around San Francisco and Oakland; all keeps every link, which
// makes the file about 183 KB (115 KB gzipped), over the 160 KB / 70 KB budget; links on the Strip are always kept.
//
// Areas (bounds from the places in data/geo.js, run in a sandbox: it is the repo's own file):
//   bay    every place of the Bay plus 0.03 degrees: highway = motorway, motorway_link, trunk, trunk_link
//   vegas  the Las Vegas Strip plus 0.06 degrees (enough to reach I-215 south of the airport): the same classes
//   primary (a separate list): highway = primary inside San Francisco only (the city's own places, no margin)
// What is kept, per line: class (0 motorway, 1 link: motorway_link and trunk_link, 2 trunk, 3 primary), state (0 on the ground,
// 1 raised: `bridge` set and not "no", 2 tunnel: `tunnel` set and not "no", or covered=yes), layer (raised only, 0 when not
// given), lanes (0 when unknown), ref and name (indexes into one string table), and which of the map's own bridges the stretch
// lies on. Ways that continue each other (same class, ref, or name when there is no ref, same state, layer and bridge, meeting end
// to end with exactly two ends at the node, a oneway only head to tail) are joined, so the two carriageways of a divided road stay
// two lines and a line is split where its state changes; a joined line takes the name of its longest part. The map's bridges
// (the ones js/map3d/models.js draws: Golden Gate, both Bay Bridge spans, Richmond-San Rafael, San Mateo-Hayward, Dumbarton,
// Carquinez, Benicia-Martinez, Antioch) are found by their name tags: a raised way whose bridge:name or name names the bridge
// and that lies within 3 km of that deck axis (the Bay Bridge's one name goes to the nearer span). Simplified (Douglas-Peucker,
// 3 m inside San Francisco and on the Strip, --far-m elsewhere); lines under 40 m whose ends touch no other kept line are
// dropped. No packages.
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib'), https = require('https'), vm = require('vm');
const root = path.join(__dirname, '..');

const args = process.argv.slice(2), arg = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const RAW = arg('--raw'), PICS = arg('--pictures'), FAR_M = +arg('--far-m', 10), LINKS = arg('--links', 'near');
if (!RAW || !(FAR_M >= 1 && FAR_M <= 100) || !/^(near|all)$/.test(LINKS)) { console.error('usage: node tools/roads3d.js --raw <dir> [--pictures <dir>] [--far-m 10] [--links near|all]'); process.exit(2); }

// ---------- the map's areas (bbox: [west, south, east, north]) ----------
const win = {}; vm.runInContext(fs.readFileSync(path.join(root, 'data/geo.js'), 'utf8'), vm.createContext({ window: win }), { filename: 'data/geo.js' });
const region = {}; win.GEO.hoods.forEach(h => { region[h.name] = h.region; });
function boundsOf(test) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  win.HP.forEach(h => { if (!test(region[h.name])) return; h.polys.forEach(p => p.forEach(r => r.forEach(([x, y]) => { if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y; }))); });
  return b;
}
const r4 = v => Math.round(v * 1e4) / 1e4, grow = (b, m) => [b[0] - m, b[1] - m, b[2] + m, b[3] + m].map(r4);
const BAY = grow(boundsOf(r => r && r !== 'vegas'), 0.03), LV = grow(boundsOf(r => r === 'vegas'), 0.06), SF = grow(boundsOf(r => r === 'sf'), 0);
const split = (b, nx, ny, name) => { const out = []; for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) out.push({ name: `${name}-${j}${i}`, bbox: [b[0] + (b[2] - b[0]) * i / nx, b[1] + (b[3] - b[1]) * j / ny, b[0] + (b[2] - b[0]) * (i + 1) / nx, b[1] + (b[3] - b[1]) * (j + 1) / ny].map(r4) }); return out; };
const BIG = '^(motorway|motorway_link|trunk|trunk_link)$';
const AREAS = [
  { name: 'bay', box: BAY, pieces: split(BAY, 3, 3, 'bay'), hw: BIG },
  { name: 'vegas', box: LV, pieces: [{ name: 'vegas', bbox: LV }], hw: BIG },
  { name: 'sf', box: SF, pieces: [{ name: 'sf-primary', bbox: SF }], hw: '^primary$', primary: true },
];
const inBox = (b, lon, lat) => lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3];
const tolAt = (lon, lat) => inBox(SF, lon, lat) || inBox(LV, lon, lat) ? 3 : FAR_M; // Douglas-Peucker tolerance, metres
// --links near: in the bay, links (ramps) are kept only where the map shows the city up close: San Francisco with the two ends
// of the Golden Gate and Bay Bridge, and Oakland from the Bay Bridge touchdown and the MacArthur Maze to Lake Merritt
const NEAR = [grow(SF, 0.02), [-122.32, 37.78, -122.24, 37.85]];
const nearLink = l => LINKS === 'all' || l.pts.some(([lon, lat]) => NEAR.some(b => inBox(b, lon, lat)));
function query(p, hw) {
  const b = `${p.bbox[1]},${p.bbox[0]},${p.bbox[3]},${p.bbox[2]}`; // Overpass order: south, west, north, east
  return `[out:json][timeout:180];way["highway"~"${hw}"](${b});out geom;`;
}
// the map's own bridges: the deck axes js/map3d/models.js draws (goldenGate, bayWest, bayEast, plainBridge calls)
const BRIDGES = [
  { code: 1, name: 'Golden Gate', a: [-122.4773, 37.8095], c: [-122.4790, 37.8335], re: /golden gate bridge/i },
  { code: 2, name: 'Bay Bridge west span', a: [-122.3886, 37.7870], c: [-122.3668, 37.8085], re: /bay bridge|san francisco.oakland/i },
  { code: 3, name: 'Bay Bridge east span', a: [-122.3590, 37.8135], c: [-122.3200, 37.8230], re: /bay bridge|san francisco.oakland/i },
  { code: 4, name: 'Richmond-San Rafael', a: [-122.4800, 37.9405], c: [-122.3960, 37.9345], re: /richmond.{1,3}san rafael/i },
  { code: 5, name: 'San Mateo-Hayward', a: [-122.2560, 37.5660], c: [-122.1200, 37.6080], re: /san mateo/i },
  { code: 6, name: 'Dumbarton', a: [-122.1290, 37.4980], c: [-122.1100, 37.5118], re: /dumbarton/i },
  { code: 7, name: 'Carquinez', a: [-122.2262, 38.0562], c: [-122.2285, 38.0662], re: /carquinez|zampa/i },
  { code: 8, name: 'Benicia-Martinez', a: [-122.1230, 38.0335], c: [-122.1265, 38.0470], re: /benicia|george miller/i },
  { code: 9, name: 'Antioch', a: [-121.7518, 38.0122], c: [-121.7495, 38.0345], re: /antioch|nejedly/i },
];
// metres from a point to a bridge's deck axis (the segment), and how far along it
function toAxis(br, p) {
  const kx = kxAt((br.a[1] + br.c[1]) / 2), cx = (br.c[0] - br.a[0]) * kx, cy = (br.c[1] - br.a[1]) * KY, L = Math.hypot(cx, cy), x = (p[0] - br.a[0]) * kx, y = (p[1] - br.a[1]) * KY, t = (x * cx + y * cy) / L;
  return { t, L, d: Math.sqrt(segDist2(x, y, 0, 0, cx, cy)) };
}
// a raised way is on one of the map's bridges when its bridge:name or name tag names that bridge and it lies within 3 km of the
// deck axis (the axes in models.js are drawn by hand and sit up to about 2 km from OpenStreetMap's deck); the Bay Bridge's one
// name goes to the span whose axis is nearer
function bridgeOf(w) {
  if (w.state !== 1) return 0;
  const mid = w.pts[Math.floor(w.pts.length / 2)]; let best = 0, bd = 3000;
  for (const br of BRIDGES) if (br.re.test(w.bname) || br.re.test(w.name)) { const d = toAxis(br, mid).d; if (d < bd) { bd = d; best = br.code; } }
  return best;
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
  if (buf.length > MAX_BODY) throw new Error('answer over size limit');
  const j = JSON.parse(buf.toString('utf8'));
  if (!j || typeof j !== 'object' || !Array.isArray(j.elements)) throw new Error('answer has no elements list');
  if (typeof j.remark === 'string' && /error|timed out|out of memory/i.test(j.remark)) throw new Error('server remark: ' + j.remark.slice(0, 200));
  return j;
}
let fetchedBefore = false;
async function piece(p, hw) {
  const file = path.join(RAW, p.name + '.json'), q = query(p, hw);
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
const distLL = (a, b) => Math.hypot((b[0] - a[0]) * kxAt((a[1] + b[1]) / 2), (b[1] - a[1]) * KY); // metres
const lenLL = pts => { let s = 0; for (let i = 1; i < pts.length; i++) s += distLL(pts[i - 1], pts[i]); return s; };
const key = p => p[0].toFixed(7) + ',' + p[1].toFixed(7);
function segDist2(px, py, ax, ay, bx, by) { const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy; let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0; t = t < 0 ? 0 : t > 1 ? 1 : t; const qx = ax + dx * t - px, qy = ay + dy * t - py; return qx * qx + qy * qy; }
// open polyline in lon/lat, Douglas-Peucker in local metres with a tolerance per point (tolAt); the two ends are kept
function simplifyLine(ll) {
  if (ll.length <= 2) return ll;
  const lat0 = ll[0][1], kx = kxAt(lat0), m = ll.map(([lon, lat]) => [(lon - ll[0][0]) * kx, (lat - lat0) * KY]);
  const n = ll.length, keep = new Uint8Array(n); keep[0] = keep[n - 1] = 1; const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let mi = -1, worst = 0;
    for (let i = a + 1; i < b; i++) { const d = Math.sqrt(segDist2(m[i][0], m[i][1], m[a][0], m[a][1], m[b][0], m[b][1])), over = d - tolAt(ll[i][0], ll[i][1]); if (over > worst) { worst = over; mi = i; } }
    if (mi >= 0) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return ll.filter((_, i) => keep[i]);
}
// [{lat, lon}, ...] -> [[lon, lat], ...] with type checks; null when unusable
function llLine(g) {
  if (!Array.isArray(g) || g.length < 2 || g.length > 100000) return null;
  const r = []; for (const p of g) { if (!p || !isNum(p.lat) || !isNum(p.lon) || Math.abs(p.lat) > 90 || Math.abs(p.lon) > 180) return null; r.push([p.lon, p.lat]); }
  return r;
}
// the runs of a line inside a box, each with one point beyond the box at either end so it reaches the edge
function clip(pts, b) {
  const runs = []; let cur = null;
  for (let i = 0; i < pts.length; i++) {
    const inside = inBox(b, pts[i][0], pts[i][1]);
    if (inside) { if (!cur) { cur = i > 0 ? [pts[i - 1]] : []; runs.push(cur); } cur.push(pts[i]); }
    else if (cur) { cur.push(pts[i]); cur = null; }
    else if (i > 0 && segCrossesBox(pts[i - 1], pts[i], b)) runs.push([pts[i - 1], pts[i]]);
  }
  return runs.filter(r => r.length >= 2);
}
function segCrossesBox(a, c, b) { // a segment with both ends outside that still crosses the box (sampled)
  for (let k = 1; k < 16; k++) { const t = k / 16; if (inBox(b, a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t)) return true; }
  return false;
}

// ---------- one area: elements -> ways -> joined lines ----------
const CLASS = { motorway: 0, motorway_link: 1, trunk_link: 1, trunk: 2, primary: 3 }, CLASS_NAME = ['motorway', 'link', 'trunk', 'primary'];
const STATE_NAME = ['ground', 'raised', 'tunnel'];
function ways(elements, area) {
  const out = [], seen = new Set();
  for (const e of elements) {
    if (!e || typeof e !== 'object' || e.type !== 'way' || !isNum(e.id) || seen.has(e.id)) continue;
    seen.add(e.id);
    const t = e.tags && typeof e.tags === 'object' ? e.tags : {};
    const hw = typeof t.highway === 'string' ? t.highway : '';
    if (!(hw in CLASS) || (area.primary ? hw !== 'primary' : hw === 'primary')) continue;
    let pts = llLine(e.geometry); if (!pts) continue;
    const yes = k => typeof t[k] === 'string' && t[k] !== 'no';
    const state = yes('tunnel') || t.covered === 'yes' ? 2 : yes('bridge') ? 1 : 0;
    const layer = state === 1 && /^\s*-?\d+\s*$/.test(t.layer || '') ? Math.max(0, Math.min(7, parseInt(t.layer, 10))) : 0;
    const lm = /^\s*(\d+)/.exec(typeof t.lanes === 'string' ? t.lanes : ''), lanes = lm ? Math.min(15, +lm[1]) : 0;
    let oneway = t.oneway === 'yes' || t.oneway === '1' || t.oneway === 'true' || ((hw === 'motorway' || hw === 'motorway_link') && t.oneway !== 'no');
    if (t.oneway === '-1') { pts = pts.slice().reverse(); oneway = true; }
    const base = { id: e.id, cls: CLASS[hw], ref: str(t, 'ref', 40), name: str(t, 'name', 80), bname: str(t, 'bridge:name', 80), state, layer, lanes, oneway };
    for (const run of clip(pts, area.box)) { const w = { ...base, pts: run, len: lenLL(run) }; w.bridge = bridgeOf(w); out.push(w); }
  }
  return out;
}
function join(ws) {
  const groups = new Map();
  for (const w of ws) { const k = [w.cls, w.ref || '#' + w.name, w.state, w.layer, w.bridge].join('|'); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(w); }
  const lines = [];
  for (const g of groups.values()) {
    const ends = new Map(), add = (k, w) => { if (!ends.has(k)) ends.set(k, []); ends.get(k).push(w); };
    g.forEach(w => { w.a = key(w.pts[0]); w.b = key(w.pts[w.pts.length - 1]); add(w.a, w); if (w.b !== w.a) add(w.b, w); });
    const used = new Set();
    // the next way at node k, when exactly two ends meet there; `fwd`: continuing after cur's end (else before its start)
    const next = (cur, k, fwd) => {
      const at = ends.get(k); if (!at || at.length !== 2) return null;
      const o = at[0] === cur ? at[1] : at[0]; if (o === cur || used.has(o)) return null;
      if (fwd) { if (o.a === k) return { w: o, rev: false }; if (!o.oneway && !cur.oneway && o.b === k) return { w: o, rev: true }; }
      else { if (o.b === k) return { w: o, rev: false }; if (!o.oneway && !cur.oneway && o.a === k) return { w: o, rev: true }; }
      return null;
    };
    for (const w0 of g) {
      if (used.has(w0)) continue; used.add(w0);
      let pts = w0.pts.slice(), members = [w0], head = w0, tail = w0, headK = w0.a, tailK = w0.b;
      for (let n; tailK !== headK && (n = next(tail, tailK, true));) { used.add(n.w); members.push(n.w); const p = n.rev ? n.w.pts.slice().reverse() : n.w.pts; pts = pts.concat(p.slice(1)); tail = n.w; tailK = n.rev ? n.w.a : n.w.b; }
      for (let n; tailK !== headK && (n = next(head, headK, false));) { used.add(n.w); members.push(n.w); const p = n.rev ? n.w.pts.slice().reverse() : n.w.pts; pts = p.slice(0, -1).concat(pts); head = n.w; headK = n.rev ? n.w.b : n.w.a; }
      const lw = new Map(); members.forEach(m => { if (m.lanes) lw.set(m.lanes, (lw.get(m.lanes) || 0) + m.len); });
      const lanes = [...lw.entries()].sort((x, y) => y[1] - x[1])[0];
      const nw = new Map(); members.forEach(m => { if (m.name) nw.set(m.name, (nw.get(m.name) || 0) + m.len); });
      const name = [...nw.entries()].sort((x, y) => y[1] - x[1])[0]; // the name of the longest part
      lines.push({ cls: w0.cls, ref: w0.ref, name: name ? name[0] : '', state: w0.state, layer: w0.layer, lanes: lanes ? lanes[0] : 0,
        bnames: [...new Set(members.map(m => m.bname).filter(Boolean))], ids: members.map(m => m.id), pts, bridge: w0.bridge });
    }
  }
  return lines;
}
function buildArea(area, elements) {
  const ws = ways(elements, area), joined = join(ws), far = joined.filter(l => l.cls === 1 && area.name === 'bay' && !nearLink(l));
  const lines = joined.filter(l => !far.includes(l));
  lines.forEach(l => { l.pts = simplifyLine(l.pts); l.len = lenLL(l.pts); });
  return { ways: ws.length, lines, farLinks: far.length, farLinkKm: far.reduce((s, l) => s + lenLL(l.pts), 0) / 1000 };
}
// drop lines under 40 m whose two ends touch no other kept line (`all`: every line of every area, for the touches)
function dropStubs(lines, all) {
  const count = new Map(); all.forEach(l => new Set(l.pts.map(key)).forEach(k => count.set(k, (count.get(k) || 0) + 1)));
  // an end also touches a line that passes through it between two of its kept points: test against nearby segments
  const G = 0.002, cell = (lon, lat) => Math.floor(lon / G) + ',' + Math.floor(lat / G), idx = new Map();
  all.forEach(l => { for (let i = 1; i < l.pts.length; i++) { const k = cell((l.pts[i - 1][0] + l.pts[i][0]) / 2, (l.pts[i - 1][1] + l.pts[i][1]) / 2); if (!idx.has(k)) idx.set(k, []); idx.get(k).push([l, i]); } });
  const touches = (l, p) => {
    if (count.get(key(p)) > 1) return true;
    const kx = kxAt(p[1]), gx = Math.floor(p[0] / G), gy = Math.floor(p[1] / G);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const [o, i] of idx.get((gx + dx) + ',' + (gy + dy)) || []) {
      if (o === l) continue; const a = o.pts[i - 1], b = o.pts[i];
      if (segDist2(0, 0, (a[0] - p[0]) * kx, (a[1] - p[1]) * KY, (b[0] - p[0]) * kx, (b[1] - p[1]) * KY) < 2 * 2) return true;
    }
    return false;
  };
  const kept = [], dropped = [];
  for (const l of lines) (l.len < 40 && !touches(l, l.pts[0]) && !touches(l, l.pts[l.pts.length - 1]) ? dropped : kept).push(l);
  return { kept, dropped };
}

// ---------- packing ----------
// The lines are put in chains: a line that starts where the line before it ends, with the same class, ref and name (the next
// stretch of the same carriageway after a change of state, or a join the junction rule left apart), is a continuation and
// stores only what changes. Per line: a = cont + 2 x class + 8 x state + 24 x bridge, b = lanes + 16 x layer; then, for a line
// that is not a continuation, its ref and name indexes (into `names`, 0 is '') ; then the point count n; then the points as
// (dx, dy) in whole metres, each from the point before: the first from the previous line's last point (the area's origin for the
// first line), except that a continuation does not store its first point (it is the previous line's last point). All unsigned
// LEB128 varints except dx, dy, which are zigzag-signed; base64.
const FORMAT = 'base64 bytes of varints (7 bits a byte, low first, high bit = more); per line: a = cont + 2 * class + 8 * state + 24 * bridge (cont 1 = this line starts at the previous line\'s last point and has its ref and name; class 0 motorway 1 link 2 trunk 3 primary; state 0 ground 1 raised 2 tunnel; bridge 0 none 1 Golden Gate 2 Bay Bridge west span 3 Bay Bridge east span 4 Richmond-San Rafael 5 San Mateo-Hayward 6 Dumbarton 7 Carquinez 8 Benicia-Martinez 9 Antioch), b = lanes + 16 * layer (lanes 0 unknown; layer 0 not given), then when cont is 0: ref index and name index (into names, 0 = none), then n (points in the line), then the points as zigzag (dx, dy) in whole metres east and north, each from the point before, the first from the previous line\'s last point (the origin for the first line); when cont is 1 the first point is not stored (it is the previous line\'s last point) and n - 1 deltas follow; lon = origin[0] + x / (111320 cos(origin[1] deg)), lat = origin[1] + y / 111320; lines are open';
function chainOrder(lines) {
  const k = p => p[0] + ',' + p[1], same = (a, b) => a.cls === b.cls && a.ref === b.ref && a.name === b.name;
  const starts = new Map(); lines.forEach(l => { const s = k(l.m[0]); if (!starts.has(s)) starts.set(s, []); starts.get(s).push(l); });
  const hasPred = new Set(); lines.forEach(l => (starts.get(k(l.m[l.m.length - 1])) || []).forEach(o => { if (o !== l && same(o, l)) hasPred.add(o); }));
  const used = new Set(), out = [];
  const walk = l => { while (l && !used.has(l)) { used.add(l); out.push(l); const end = k(l.m[l.m.length - 1]), cur = l; l = (starts.get(end) || []).find(o => !used.has(o) && same(o, cur)); } };
  lines.forEach(l => { if (!hasPred.has(l)) walk(l); });
  lines.forEach(l => walk(l)); // what is left: closed loops
  return out;
}
function packArea(a, lines, names) {
  const bytes = [], uv = v => { do { let b = v & 127; v = Math.floor(v / 128); if (v) b |= 128; bytes.push(b); } while (v); }, sv = v => uv(v < 0 ? -2 * v - 1 : 2 * v);
  const kx = kxAt(a.lat0), nameIx = s => { if (!s) return 0; let i = names.indexOf(s); if (i < 0) { names.push(s); i = names.length - 1; } return i; };
  const ready = [];
  for (const l of lines) {
    const pts = []; l.pts.forEach(([lon, lat]) => { const q = [Math.round((lon - a.lon0) * kx), Math.round((lat - a.lat0) * KY)], z = pts[pts.length - 1]; if (!z || z[0] !== q[0] || z[1] !== q[1]) pts.push(q); });
    if (pts.length >= 2) { l.m = pts; ready.push(l); }
  }
  const out = chainOrder(ready);
  let px = 0, py = 0, prev = null, conts = 0;
  for (const l of out) {
    const pts = l.m, cont = !!prev && prev.cls === l.cls && prev.ref === l.ref && prev.name === l.name && pts[0][0] === px && pts[0][1] === py;
    uv((cont ? 1 : 0) + 2 * l.cls + 8 * l.state + 24 * l.bridge); uv(l.lanes + 16 * l.layer);
    if (!cont) { uv(nameIx(l.ref)); uv(nameIx(l.name)); } else conts++;
    uv(pts.length);
    for (let i = cont ? 1 : 0; i < pts.length; i++) { const [qx, qy] = i ? pts[i - 1] : [px, py]; sv(pts[i][0] - qx); sv(pts[i][1] - qy); }
    px = pts[pts.length - 1][0]; py = pts[pts.length - 1][1]; prev = l;
  }
  return { data: Buffer.from(bytes).toString('base64'), lines: out, conts, bytes: bytes.length };
}
// the reader, as the engine would write it (also in the file's header comment)
function unpack(area) {
  const s = Buffer.from(area.data, 'base64'); let i = 0;
  const uv = () => { let v = 0, m = 1, b; do { b = s[i++]; v += (b & 127) * m; m *= 128; } while (b & 128); return v; }, sv = () => { const u = uv(); return u & 1 ? -(u + 1) / 2 : u / 2; };
  const out = []; let x = 0, y = 0, ref = 0, name = 0;
  while (i < s.length) {
    const a = uv(), b = uv(), cont = a & 1; if (!cont) { ref = uv(); name = uv(); }
    const n = uv(), pts = cont ? [[x, y]] : [];
    while (pts.length < n) { x += sv(); y += sv(); pts.push([x, y]); }
    out.push({ cls: (a >> 1) & 3, state: Math.floor(a / 8) % 3, bridge: Math.floor(a / 24), lanes: b % 16, layer: Math.floor(b / 16), ref, name, pts });
  }
  return out;
}

// ---------- tiny PNG writer, a polygon filler and a line drawer for the pictures ----------
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = b => { let c = -1; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) { const t = Buffer.from(type, 'latin1'), len = Buffer.alloc(4), crc = Buffer.alloc(4); len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, crc]); }
function writePNG(file, w, h, rgb) {
  const raw = Buffer.alloc(h * (w * 3 + 1)); for (let y = 0; y < h; y++) rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
function canvas(box, mpp) {
  const lat0 = box[1], kx = kxAt(lat0), w = Math.ceil((box[2] - box[0]) * kx / mpp), h = Math.ceil((box[3] - box[1]) * KY / mpp);
  const c = { w, h, rgb: Buffer.alloc(w * h * 3, 0), P: ([lon, lat]) => [(lon - box[0]) * kx / mpp, (box[3] - lat) * KY / mpp] };
  for (let i = 0; i < w * h; i++) { c.rgb[i * 3] = 205; c.rgb[i * 3 + 1] = 222; c.rgb[i * 3 + 2] = 235; } // water
  return c;
}
function fill(c, ring, col) {
  const P = ring.map(c.P); let ya = Infinity, yb = -Infinity; P.forEach(p => { ya = Math.min(ya, p[1]); yb = Math.max(yb, p[1]); });
  for (let py = Math.max(0, Math.floor(ya)); py <= Math.min(c.h - 1, Math.ceil(yb)); py++) {
    const yc = py + 0.5, xs = [];
    for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const [xi, yi] = P[i], [xj, yj] = P[j]; if ((yi > yc) !== (yj > yc)) xs.push(xi + (yc - yi) / (yj - yi) * (xj - xi)); }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) for (let px = Math.max(0, Math.round(xs[k])); px < Math.min(c.w, Math.round(xs[k + 1])); px++) { const o = (py * c.w + px) * 3; c.rgb[o] = col[0]; c.rgb[o + 1] = col[1]; c.rgb[o + 2] = col[2]; }
  }
}
function land(c, all) { // the land and inland water of data/geo.js (the places and the land filler), for orientation; `all`: land everywhere
  if (all) for (let i = 0; i < c.rgb.length; i++) c.rgb[i] = [242, 238, 228][i % 3];
  else [...win.HP.flatMap(h => h.polys), ...win.GEO.other].forEach(poly => fill(c, poly[0], [242, 238, 228]));
  win.GEO.water.forEach(poly => fill(c, poly[0], [205, 222, 235]));
}
function stroke(c, pts, col, r, dash) {
  const dot = (x, y) => { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { if (dx * dx + dy * dy > r * r + r) continue; const X = Math.round(x) + dx, Y = Math.round(y) + dy; if (X < 0 || Y < 0 || X >= c.w || Y >= c.h) continue; const o = (Y * c.w + X) * 3; c.rgb[o] = col[0]; c.rgb[o + 1] = col[1]; c.rgb[o + 2] = col[2]; } };
  let run = 0;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = c.P(pts[i - 1]), [x1, y1] = c.P(pts[i]), L = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.ceil(L * 2));
    for (let k = 0; k <= n; k++) { const d = run + L * k / n; if (!dash || Math.floor(d / 5) % 2 === 0) dot(x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n); }
    run += L;
  }
}
const COL = [[214, 40, 40], [240, 150, 60], [150, 90, 20], [90, 90, 160]];
function picture(file, box, mpp, layers) {
  const c = canvas(box, mpp); land(c, box === LV);
  const all = layers.flat(), r = mpp <= 10 ? 1 : 0;
  // order: primary, trunk, link, motorway; ground, then raised (with a dark casing), tunnels dashed on top
  const order = all.slice().sort((a, b) => (b.cls - a.cls) || (a.state === 2) - (b.state === 2) || a.state - b.state);
  for (const l of order) {
    if (l.state === 1) stroke(c, l.ll, [30, 30, 30], r + 1, false);
    stroke(c, l.ll, l.bridge ? [0, 190, 220] : l.state === 2 ? COL[l.cls].map(v => Math.round(v * 0.5 + 127)) : COL[l.cls], r, l.state === 2);
  }
  writePNG(file, c.w, c.h, c.rgb);
  return `${c.w} x ${c.h}`;
}

(async () => {
  const results = [];
  for (const area of AREAS) {
    const els = [];
    for (const p of area.pieces) els.push(...(await piece(p, area.hw)).elements);
    results.push({ area, els: els.length, ...buildArea(area, els) });
  }
  const every = results.flatMap(r => r.lines);
  for (const r of results) { const d = dropStubs(r.lines, every); r.lines = d.kept; r.dropped = d.dropped; }
  const names = [''], packed = {};
  for (const r of results) {
    const lon0 = Math.round(r.area.box[0] * 1e4) / 1e4, lat0 = Math.round(r.area.box[1] * 1e4) / 1e4;
    r.lon0 = lon0; r.lat0 = lat0;
    // order by class, then in 2 km rows west to east (packArea then chains them), so the first-point steps stay short
    const kx = kxAt(lat0); r.lines.sort((a, b) => (a.cls - b.cls) || (Math.floor((a.pts[0][1] - lat0) * KY / 2000) - Math.floor((b.pts[0][1] - lat0) * KY / 2000)) || ((a.pts[0][0] - b.pts[0][0]) * kx));
    const p = packArea(r, r.lines, names); r.lines = p.lines;
    r.conts = p.conts; r.bytes = p.bytes; packed[r.area.name] = { name: r.area.name, origin: [lon0, lat0], count: p.lines.length, data: p.data };
  }
  const roadData = { areas: [packed.bay, packed.vegas], primary: packed.sf, names, format: FORMAT, source: 'OpenStreetMap contributors, ODbL' };
  const head = '// Generated by tools/roads3d.js (do not edit by hand): the highway network for the 3D map, from OpenStreetMap (Overpass API).\n'
    + '// areas: bay (every place of the Bay plus a margin) and vegas (the Strip plus a margin): highway = motorway, motorway_link, trunk,\n'
    + '// trunk_link. primary: highway = primary inside San Francisco only (Market Street, Van Ness Avenue and the like). Ways that continue\n'
    + '// each other are joined (a divided road stays two lines, one a carriageway; a line has one state: ground, raised or tunnel) and\n'
    + '// simplified (3 m in San Francisco and on the Strip, ' + FAR_M + ' m elsewhere). ' + (LINKS === 'near' ? 'In the bay, links (ramps) only in and around San Francisco\n'
    + '// and Oakland. ' : '') + 'bridge marks the stretches on the bridges the map models itself (js/map3d/models.js), found by their name\n'
    + '// tags. names: the ref and name strings. Per area, data is base64 of varints; see `format`. Unpack one\n'
    + '// area into [{ cls, state, bridge, lanes, layer, ref, name, pts: [[x, y], ...] }] (x, y metres east, north of origin):\n'
    + '//\n'
    + '//   function unpack(area, names) {\n'
    + '//     const bin = atob(area.data), s = new Uint8Array(bin.length); for (let k = 0; k < bin.length; k++) s[k] = bin.charCodeAt(k);\n'
    + '//     let i = 0, x = 0, y = 0, ref = 0, name = 0; const out = [];\n'
    + '//     const uv = () => { let v = 0, m = 1, b; do { b = s[i++]; v += (b & 127) * m; m *= 128; } while (b & 128); return v; };\n'
    + '//     const sv = () => { const u = uv(); return u & 1 ? -(u + 1) / 2 : u / 2; };\n'
    + '//     while (i < s.length) {\n'
    + '//       const a = uv(), b = uv(), cont = a & 1; if (!cont) { ref = uv(); name = uv(); }\n'
    + '//       const n = uv(), pts = cont ? [[x, y]] : []; // a continuation starts at the last point of the line before\n'
    + '//       while (pts.length < n) { x += sv(); y += sv(); pts.push([x, y]); }\n'
    + '//       out.push({ cls: (a >> 1) & 3, state: Math.floor(a / 8) % 3, bridge: Math.floor(a / 24), lanes: b % 16, layer: Math.floor(b / 16),\n'
    + '//         ref: names[ref], name: names[name], pts });\n'
    + '//     }\n'
    + '//     return out; // lon = origin[0] + x / (111320 * cos(origin[1] * PI / 180)), lat = origin[1] + y / 111320\n'
    + '//   }\n'
    + '//   // unpack(M3D.roadData.areas[0], M3D.roadData.names), unpack(M3D.roadData.primary, M3D.roadData.names)\n';
  const out = head + 'window.M3D = window.M3D || {}; window.M3D.roadData = ' + JSON.stringify(roadData) + ';\n';
  fs.mkdirSync(path.join(root, 'js/map3d'), { recursive: true });
  fs.writeFileSync(path.join(root, 'js/map3d/roaddata.js'), out);
  const gz = zlib.gzipSync(Buffer.from(out), { level: 9 }).length;
  console.log(`requests sent now: ${stats.queries}, answered: ${stats.answers} (${stats.bytesFetched} bytes); pieces read from disk: ${stats.fromDisk} (${stats.bytesDisk} bytes)`);
  console.log(`boxes: bay ${BAY.join(', ')}; vegas ${LV.join(', ')}; sf (primary, 3 m tolerance) ${SF.join(', ')}`);
  for (const r of results) console.log(`${r.area.name}: ${r.els} elements, ${r.ways} way runs inside the box, ${r.farLinks ? `${r.farLinks} links away from the city left out (${r.farLinkKm.toFixed(0)} km), ` : ''}${r.lines.length} lines kept, ${r.dropped.length} stubs dropped, ${r.conts} of them stored as continuations, ${r.bytes} bytes, ${packed[r.area.name].data.length} base64 characters`);
  console.log(`js/map3d/roaddata.js: ${out.length} bytes raw (${(out.length / 1024).toFixed(0)} KB), ${gz} bytes gzipped (${(gz / 1024).toFixed(0)} KB); ${names.length} strings`);
  if (out.length > 160 * 1024 || gz > 70 * 1024) console.log('OVER BUDGET (160 KB raw, 70 KB gzipped)');
  if (!PICS) return;

  // ---------- checks ----------
  fs.mkdirSync(PICS, { recursive: true });
  const w2 = {}; vm.runInContext(fs.readFileSync(path.join(root, 'js/map3d/roaddata.js'), 'utf8'), vm.createContext({ window: w2 }), { filename: 'roaddata.js' });
  const file = w2.M3D.roadData;
  const km = m => (m / 1000).toFixed(1);
  // which of the app's regions a point lies in (the place polygons of data/geo.js), for the length table
  const hp = win.HP.map(h => ({ region: region[h.name], polys: h.polys.map(p => ({ p, b: p[0].reduce((b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)], [180, 90, -180, -90]) })) }));
  const pipLL = (r, x, y) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
  const regionOf = (lon, lat) => { for (const h of hp) for (const { p, b } of h.polys) if (lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3] && pipLL(p[0], lon, lat) && !p.slice(1).some(q => pipLL(q, lon, lat))) return h.region; return '(between places)'; };
  console.log('\nlines and length per class, area and region (region: the app\'s place polygons the segment midpoints fall in)');
  console.log('| Area | Region | Class | Lines | km | raised km | tunnel km |'); console.log('|---|---|---|---|---|---|---|');
  for (const r of results) {
    const t = new Map();
    for (const l of r.lines) for (let i = 1; i < l.pts.length; i++) {
      const a = l.pts[i - 1], b = l.pts[i], reg = r.area.name === 'bay' ? regionOf((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) : r.area.name, k = reg + '|' + l.cls;
      if (!t.has(k)) t.set(k, { reg, cls: l.cls, lines: new Set(), m: 0, raised: 0, tunnel: 0 }); const e = t.get(k), d = distLL(a, b);
      e.lines.add(l); e.m += d; if (l.state === 1) e.raised += d; if (l.state === 2) e.tunnel += d;
    }
    [...t.values()].sort((x, y) => x.reg.localeCompare(y.reg) || x.cls - y.cls).forEach(e => console.log(`| ${r.area.name} | ${e.reg} | ${CLASS_NAME[e.cls]} | ${e.lines.size} | ${km(e.m)} | ${km(e.raised)} | ${km(e.tunnel)} |`));
    const tot = r.lines.reduce((s, l) => s + l.len, 0); console.log(`| ${r.area.name} | all | all | ${r.lines.length} | ${km(tot)} | | |`);
  }
  // named routes: carriageway length (a divided road counts twice), lon/lat extent, and how many pieces the route falls into
  // (lines whose ends come within 60 m of another line of the same route are one piece)
  const ROUTES = [['US 101', 'bay'], ['I 80', 'bay'], ['I 280', 'bay'], ['I 580', 'bay'], ['I 880', 'bay'], ['I 680', 'bay'], ['CA 1', 'bay'], ['CA 24', 'bay'], ['CA 92', 'bay'], ['CA 13', 'bay'], ['I 15', 'vegas'], ['I 215', 'vegas']];
  console.log('\nnamed routes (motorway and trunk lines whose ref lists the route; carriageway km: a divided road counts both sides)');
  console.log('| Route | Area | Lines | Carriageway km | raised km | tunnel km | Extent (lon, lat) | Pieces over 1 km | Loose ends (lon lat) |'); console.log('|---|---|---|---|---|---|---|---|---|');
  for (const [ref, an] of ROUTES) {
    const r = results.find(x => x.area.name === an), ls = r.lines.filter(l => l.cls !== 1 && l.ref.split(/\s*;\s*/).includes(ref));
    if (!ls.length) { console.log(`| ${ref} | ${an} | 0 | MISSING | | | | | |`); continue; }
    const m = ls.reduce((s, l) => s + l.len, 0), ra = ls.filter(l => l.state === 1).reduce((s, l) => s + l.len, 0), tu = ls.filter(l => l.state === 2).reduce((s, l) => s + l.len, 0);
    const b = [180, 90, -180, -90]; ls.forEach(l => l.pts.forEach(([x, y]) => { b[0] = Math.min(b[0], x); b[1] = Math.min(b[1], y); b[2] = Math.max(b[2], x); b[3] = Math.max(b[3], y); }));
    const par = ls.map((_, i) => i), find = i => par[i] === i ? i : (par[i] = find(par[i]));
    for (let i = 0; i < ls.length; i++) for (const e of [ls[i].pts[0], ls[i].pts[ls[i].pts.length - 1]]) for (let j = 0; j < ls.length; j++) {
      if (j === i || find(i) === find(j)) continue; const kx = kxAt(e[1]), o = ls[j].pts;
      for (let k = 1; k < o.length; k++) if (segDist2(0, 0, (o[k - 1][0] - e[0]) * kx, (o[k - 1][1] - e[1]) * KY, (o[k][0] - e[0]) * kx, (o[k][1] - e[1]) * KY) < 3600) { par[find(i)] = find(j); break; }
    }
    const comp = new Map(); ls.forEach((l, i) => comp.set(find(i), (comp.get(find(i)) || 0) + l.len));
    const big = [...comp.values()].filter(v => v > 1000).sort((x, y) => y - x).map(v => km(v));
    // loose ends: line ends within 60 m of no other line of the route (any class but link) and over 1 km inside the area's edge
    const others = r.lines.filter(l => l.cls !== 1 && l.ref.split(/\s*;\s*/).includes(ref)), loose = [], box = r.area.box;
    for (const l of ls) for (const e of [l.pts[0], l.pts[l.pts.length - 1]]) {
      const kx = kxAt(e[1]); if ((e[0] - box[0]) * kx < 1000 || (box[2] - e[0]) * kx < 1000 || (e[1] - box[1]) * KY < 1000 || (box[3] - e[1]) * KY < 1000) continue;
      const touch = others.some(o => o !== l && o.pts.some((q, k) => k > 0 && segDist2(0, 0, (o.pts[k - 1][0] - e[0]) * kx, (o.pts[k - 1][1] - e[1]) * KY, (q[0] - e[0]) * kx, (q[1] - e[1]) * KY) < 3600));
      if (!touch) loose.push(e.map(v => v.toFixed(4)).join(' '));
    }
    r.loose = r.loose || {}; r.loose[ref] = loose;
    console.log(`| ${ref} | ${an} | ${ls.length} | ${km(m)} | ${km(ra)} | ${km(tu)} | ${b.map(v => v.toFixed(3)).join(', ')} | ${big.length}: ${big.slice(0, 6).join(', ')}${big.length > 6 ? ', ...' : ''} | ${loose.length}${loose.length ? ': ' + loose.slice(0, 4).join('; ') + (loose.length > 4 ? '; ...' : '') : ''} |`);
  }
  const bay = results.find(x => x.area.name === 'bay'), within = (l, b) => l.pts.some(([x, y]) => inBox(b, x, y));
  const list = (title, b, test) => {
    console.log(`\n${title}`); console.log('| Class | Ref | Name | State | Layer | m | OSM ways |'); console.log('|---|---|---|---|---|---|---|');
    bay.lines.filter(l => test(l) && within(l, b)).sort((x, y) => x.pts[0][0] - y.pts[0][0]).forEach(l => console.log(`| ${CLASS_NAME[l.cls]} | ${l.ref} | ${l.name} | ${STATE_NAME[l.state]} | ${l.layer} | ${Math.round(l.len)} | ${l.ids.slice(0, 4).join(' ')}${l.ids.length > 4 ? ' ...' : ''} |`));
  };
  list('Presidio Parkway (US 101 between the Golden Gate Bridge toll plaza and the Marina: lon -122.475 to -122.447, lat 37.797 to 37.806)', [-122.475, 37.797, -122.447, 37.806], l => l.cls !== 1 && /US 101/.test(l.ref));
  list('Central Freeway (US 101 between Market Street and the Mission Street ramps: lon -122.424 to -122.409, lat 37.766 to 37.774)', [-122.424, 37.766, -122.409, 37.774], l => l.cls !== 1 && /US 101/.test(l.ref));
  list('Bay Bridge approach in SoMa (I 80 between 5th Street and the anchorage at Beale Street: lon -122.404 to -122.392, lat 37.776 to 37.787)', [-122.404, 37.776, -122.392, 37.787], l => l.cls !== 1 && /I 80/.test(l.ref));
  console.log('\nthe map\'s own bridges (marked by name tags; along: how far along the model\'s deck axis the marked lines run, 0 to the axis length; off: the farthest marked point from the axis)');
  console.log('| Bridge | Lines marked | km marked | Refs | bridge:name / name tags on them | along (m) | axis (m) | off axis (m) | raised lines in 300 m of the axis left unmarked |'); console.log('|---|---|---|---|---|---|---|---|---|');
  for (const br of BRIDGES) {
    const ls = bay.lines.filter(l => l.bridge === br.code), tags = new Set(); ls.forEach(l => { l.bnames.forEach(n => tags.add(n)); if (br.re.test(l.name)) tags.add(l.name); });
    let t0 = Infinity, t1 = -Infinity, off = 0, L = 0; ls.forEach(l => l.pts.forEach(p => { const a = toAxis(br, p); t0 = Math.min(t0, a.t); t1 = Math.max(t1, a.t); off = Math.max(off, a.d); L = a.L; }));
    const near = bay.lines.filter(l => l.state === 1 && !l.bridge && l.pts.some(p => { const a = toAxis(br, p); return a.d < 300 && a.t > 0 && a.t < a.L; }));
    console.log(`| ${br.name} | ${ls.length} | ${km(ls.reduce((s, l) => s + l.len, 0))} | ${[...new Set(ls.map(l => l.ref))].join(', ')} | ${[...tags].join('; ') || '(none)'} | ${ls.length ? Math.round(t0) + ' to ' + Math.round(t1) : ''} | ${ls.length ? Math.round(L) : ''} | ${ls.length ? Math.round(off) : ''} | ${near.length ? near.map(l => `${CLASS_NAME[l.cls]} ${l.ref || l.name} ${Math.round(l.len)} m`).slice(0, 4).join('; ') : 'none'} |`);
  }
  // round trip: unpacked lon/lat against the simplified line before rounding, for lines spread through each list
  console.log('\nround trip of js/map3d/roaddata.js');
  for (const r of results) {
    const fa = r.area.name === 'sf' ? file.primary : file.areas.find(x => x.name === r.area.name), back = unpack(fa);
    let worst = 0, same = back.length === fa.count && fa.count === r.lines.length;
    const picks = r.lines.map((_, k) => k); // every line
    for (const k of picks) {
      const kx = kxAt(fa.origin[1]), l = r.lines[k], u = back[k];
      if (u.cls !== l.cls || u.state !== l.state || u.bridge !== l.bridge || u.lanes !== l.lanes || u.layer !== l.layer || file.names[u.ref] !== l.ref || file.names[u.name] !== l.name) same = false;
      const ll = u.pts.map(([x, y]) => [fa.origin[0] + x / kx, fa.origin[1] + y / KY]);
      for (const p of ll) { let m = Infinity; for (const q of l.pts) m = Math.min(m, distLL(p, q)); worst = Math.max(worst, m); }
    }
    console.log(`${r.area.name}: count in file ${fa.count}, unpacked ${back.length}, lines built ${r.lines.length}; ${picks.length} lines compared, worst point error ${worst.toFixed(2)} m, fields equal: ${same}`);
    r.back = back.map(u => ({ ...u, ll: u.pts.map(([x, y]) => [fa.origin[0] + x / kxAt(fa.origin[1]), fa.origin[1] + y / KY]) }));
  }
  const R = n => results.find(x => x.area.name === n).back;
  for (const [n, box, mpp, layers] of [['bay', BAY, 100, [R('bay')]], ['sf', grow(SF, 0.01), 8, [R('bay'), R('sf')]], ['vegas', LV, 8, [R('vegas')]]]) {
    const f = path.join(PICS, n + '.png'); console.log(`picture ${f}: ${picture(f, box, mpp, layers)} px at ${mpp} m a pixel`);
  }
})().catch(e => { console.error('roads3d: ' + e.message); process.exit(1); });
