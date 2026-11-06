#!/usr/bin/env node
// tools/geo-build.js: rebuilds data/geo.js for the nine-county Bay Area (Node 24, no npm deps).
//
//   node tools/geo-build.js [--places PATH] [--cache DIR] [--dry]
//
// Workflow: edit tools/geo-places.json (the non-SF places, in batches with display name, Census BASENAME,
// kind city|cdp, county, region), then run `node tools/geo-build.js` from the repo; it rewrites data/geo.js.
// Rerunning with no edits reproduces data/geo.js byte for byte.
//
// Input is the current data/geo.js. Every hood in it that is NOT in the places list is "existing": its
// polygons, region and adj entries are kept verbatim (adj only gains reciprocal links) and its cx/cy is
// translated by the offset between the file's canvas and the recomputed one (zero when they match). Every
// place in the list is "new": appended in list order, polygon reused from data/geo.js when already there,
// otherwise fetched from the Census TIGERweb generalized (500K) place layers; label anchor, adjacency
// (250 m polygon proximity, with a 2-nearest fallback up to 25 km for isolated places) recomputed.
// For every hood, max elevation and cell counts are resampled from Mapzen terrarium tiles: cells from z=12 (the scale CELL_SCALE was
// pinned on), max from z=14 (only the tiles holding a sample inside a place; z=12 flattens small summits). The canvas
// bbox is recomputed at the fixed unit density of the original SF/Marin/East/Peninsula canvas (UNIT_REF) so
// every tuned map constant stays valid; region rects, the land filler (`other`: Census counties near the
// canvas), the inland water (TIGERweb areal hydrography on the canvas, size rules at WATER_*) and the coast outline
// (county shore plus the shores of the larger water bodies) are rebuilt. The calibrated constants below
// (CELL_SCALE, ANCHOR_METHOD, REGION_PAD) were measured once against the hand-made 90-place file and are
// pinned so reruns are stable; the calibrations are still recomputed into the report as diagnostics.
// Network responses and tiles are cached in tools/geo-cache (gitignored) so reruns work offline; a JSON report
// is written to <cache>/report.json.
'use strict';
const fs = require('fs'), path = require('path'), zlib = require('zlib'), crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const PLACES = opt('--places', path.join(ROOT, 'tools/geo-places.json'));
const DRY = args.includes('--dry');
const CACHE = path.resolve(opt('--cache', opt('--scratch', path.join(ROOT, 'tools/geo-cache')))), TILES = path.join(CACHE, 'tiles'); // --scratch: older name for --cache
fs.mkdirSync(TILES, { recursive: true });

const TIGER = 'https://tigerweb.geo.census.gov/arcgis/rest/services/Generalized_ACS2023';
const PLACE_LAYER = { city: 10, cdp: 11 };
const COUNTY_URL = `${TIGER}/State_County/MapServer/11/query`;
const HYDRO_URL = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Hydro/MapServer/1/query'; // areal hydrography (full detail; generalized on the server)
// the county filler is land across inland water (lakes, reservoirs, the Carquinez Strait, Suisun Bay, the Delta, the marsh sloughs):
// every areal hydrography feature on the canvas with AREAWATER > WATER_CHANNEL_MIN_M2 is queried, then kept when it is
// a channel/bay/estuary (any MTFCC but lake/pond/reservoir), or still water (WATER_STILL) of at least WATER_MIN_M2 or sharing
// its NAME with such a feature (a reservoir split in pieces); the higher still-water bar keeps out ponds and salt-pond grids.
// Features mostly outside the filler (ocean, the open bay) are dropped: water over water, they only add vertices and seams.
const WATER_STILL = ['H2030', 'H2040']; // MTFCC lake/pond, reservoir
const WATER_MIN_M2 = 1.24e6, WATER_CHANNEL_MIN_M2 = 5e5, WATER_GEN_DEG = 0.0003, WATER_PAGE = 100;
const WATER_IN_FILLER = 0.5;  // keep a feature when at least this share of its area lies on the county filler
const WATER_SHORE_EPS = 0.0005; // deg: side offset that tells a shore (land on one side) from a seam or open water
const WATER_SHORE_MIN_M = 200;  // open shore pieces shorter than this (about 1.4 map units) are dropped from the halo as noise
const COAST_PAD = 0.3; // outline edges beyond bbox + this many degrees are county lines inland, not shore
const TERRARIUM = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const Z = 12, ZMAX = 14; // z=12 samples give `cells` (pinned CELL_SCALE); z=14 samples (about 7.5 m) give `max`
const SPIKE_M = 10; // z=14 max: a pixel more than this above the second-highest of its 8 neighbours is a tile artefact (seen: 54 m in flat Oakley), not a summit
const MARGIN = 0.04, GRID = 0.005, ADJ_M = 250, ADJ_CAP = 8, FALLBACK_N = 2, FALLBACK_M = 25000;
const REGION_KEYS = ['sf', 'marin', 'east', 'penin', 'south', 'north'];
// pinned calibration (measured against the original hand-made 90-place file; see the header)
const UNIT_REF = { nx: 400, ny: 584, bbox: [-122.755, 37.41, -122.105, 38.16] }; // the original canvas: map units per degree
const CELL_SCALE = 0.31248124238846825; // terrarium z=12 samples -> the original `cells` scale (1 / median new/old ratio)
const ANCHOR_METHOD = 'centroid';       // label anchor rule that best matched the hand-placed cx/cy (median 0.65 units)
const REGION_PAD = 0;                   // padding of the original region rects around their members' polygons (units)

const r5 = v => Math.round(v * 1e5) / 1e5;
const r2 = v => Math.round(v * 100) / 100;
const r1 = v => Math.round(v * 10) / 10;
const median = a => { const s = a.slice().sort((x, y) => x - y); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };
const report = { notes: [] };
const note = s => { report.notes.push(s); console.log(s); };

// ---------- fetch with disk cache ----------
async function cachedFetch(url, file, binary) {
  if (fs.existsSync(file)) return binary ? fs.readFileSync(file) : fs.readFileSync(file, 'utf8');
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(90000) });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      const body = binary ? Buffer.from(await res.arrayBuffer()) : await res.text();
      if (!binary) { const j = JSON.parse(body); if (j.error) throw new Error('ArcGIS error ' + JSON.stringify(j.error)); }
      fs.writeFileSync(file, body);
      return body;
    } catch (e) { if (attempt === 4) throw e; await new Promise(r => setTimeout(r, 1500 * attempt)); }
  }
}
const urlFile = (url, ext) => path.join(CACHE, crypto.createHash('sha1').update(url).digest('hex').slice(0, 16) + ext);
async function fetchJSON(url) { return JSON.parse(await cachedFetch(url, urlFile(url, '.json'), false)); }

// ---------- geometry helpers ----------
const mercY = lat => { const r = lat * Math.PI / 180; return Math.log(Math.tan(r) + 1 / Math.cos(r)); };
const invMercY = y => Math.atan(Math.sinh(y)) * 180 / Math.PI;
function makeProj(nx, ny, bbox) {
  const [LON0, LAT0, LON1, LAT1] = bbox, MY0 = mercY(LAT1), MY1 = mercY(LAT0);
  return {
    proj: p => [(p[0] - LON0) / (LON1 - LON0) * nx, (mercY(p[1]) - MY0) / (MY1 - MY0) * ny],
    unproj: (x, y) => [LON0 + x / nx * (LON1 - LON0), invMercY(MY0 + y / ny * (MY1 - MY0))],
  };
}
function pip(ring, x, y) { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; }
const inPolys = (polys, x, y) => polys.some(poly => pip(poly[0], x, y) && !poly.slice(1).some(h => pip(h, x, y)));
function area(ring) { let a = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]); return a / 2; }
function centroid(ring) { let a = 0, cx = 0, cy = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]; a += f; cx += (ring[j][0] + ring[i][0]) * f; cy += (ring[j][1] + ring[i][1]) * f; } a *= 3; return a ? [cx / a, cy / a] : ring[0]; }
function bboxOf(rings) { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; rings.forEach(r => r.forEach(([x, y]) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; })); return [x0, y0, x1, y1]; }
const allRings = polys => polys.flat();
const mapPolys = (polys, f) => polys.map(poly => poly.map(ring => ring.map(f)));
function cleanRing(ring) { // round to 5 decimals, drop consecutive duplicates, close
  const out = []; ring.forEach(p => { const q = [r5(p[0]), r5(p[1])]; const l = out[out.length - 1]; if (!l || l[0] !== q[0] || l[1] !== q[1]) out.push(q); });
  if (out.length > 1 && (out[0][0] !== out[out.length - 1][0] || out[0][1] !== out[out.length - 1][1])) out.push([out[0][0], out[0][1]]);
  return out;
}
function geomToPolys(g) {
  const parts = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : null;
  if (!parts) throw new Error('unsupported geometry ' + g.type);
  return parts.map(poly => poly.map(cleanRing)).filter(poly => poly[0].length >= 4);
}
// Mapbox polylabel (pole of inaccessibility) on one polygon [outer, holes...] in map units.
function polylabel(poly, precision = 0.5) {
  const [x0, y0, x1, y1] = bboxOf(poly); const w = x1 - x0, h = y1 - y0, size = Math.min(w, h);
  const segDist = (px, py, a, b) => { let x = a[0], y = a[1], dx = b[0] - x, dy = b[1] - y; if (dx || dy) { const t = ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy); if (t > 1) { x = b[0]; y = b[1]; } else if (t > 0) { x += dx * t; y += dy * t; } } dx = px - x; dy = py - y; return dx * dx + dy * dy; };
  const dist = (x, y) => { let inside = false, md = Infinity; poly.forEach(ring => { for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside; md = Math.min(md, segDist(x, y, a, b)); } }); return (inside ? 1 : -1) * Math.sqrt(md); };
  const cell = (x, y, hh) => { const d = dist(x, y); return { x, y, h: hh, d, max: d + hh * Math.SQRT2 }; };
  if (!size) return [x0, y0];
  let hh = size / 2; const queue = [];
  for (let x = x0; x < x1; x += size) for (let y = y0; y < y1; y += size) queue.push(cell(x + hh, y + hh, hh));
  let best = cell(x0 + w / 2, y0 + h / 2, 0);
  const c = centroid(poly[0]); const cc = cell(c[0], c[1], 0); if (cc.d > best.d) best = cc;
  while (queue.length) {
    queue.sort((a, b) => a.max - b.max); const q = queue.pop();
    if (q.d > best.d) best = q;
    if (q.max - best.d <= precision) continue;
    hh = q.h / 2; queue.push(cell(q.x - hh, q.y - hh, hh), cell(q.x + hh, q.y - hh, hh), cell(q.x - hh, q.y + hh, hh), cell(q.x + hh, q.y + hh, hh));
  }
  return [best.x, best.y];
}
const largestPoly = polys => polys.reduce((m, p) => Math.abs(area(p[0])) > Math.abs(area(m[0])) ? p : m, polys[0]);
const anchors = {
  centroid: polys => centroid(largestPoly(polys)[0]),
  bboxCentre: polys => { const b = bboxOf(allRings(polys)); return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; },
  poi: polys => polylabel(largestPoly(polys)),
};

// ---------- terrarium tiles ----------
const lon2tx = (lon, z) => (lon + 180) / 360 * (1 << z);
const lat2ty = (lat, z) => (1 - mercY(lat) / Math.PI) / 2 * (1 << z);
const ty2lat = (y, z) => invMercY(Math.PI * (1 - 2 * y / (1 << z)));
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let p = 8, w, h, depth, ct, interlace; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; ct = d[9]; interlace = d[12]; }
    else if (type === 'IDAT') idat.push(d); else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (depth !== 8 || interlace || (ct !== 2 && ct !== 6) || w !== 256 || h !== 256) throw new Error(`unexpected PNG ${w}x${h} depth ${depth} type ${ct} interlace ${interlace}`);
  const ch = ct === 2 ? 3 : 4, raw = zlib.inflateSync(Buffer.concat(idat)), stride = w * ch, out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i], a = i >= ch ? out[dst + i - ch] : 0, b = y > 0 ? out[dst - stride + i] : 0, c = (y > 0 && i >= ch) ? out[dst - stride + i - ch] : 0; let v;
      switch (f) {
        case 0: v = x; break; case 1: v = x + a; break; case 2: v = x + b; break; case 3: v = x + ((a + b) >> 1); break;
        case 4: { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); break; }
        default: throw new Error('bad filter ' + f);
      }
      out[dst + i] = v & 255;
    }
  }
  return { ch, data: out };
}
const tileCache = new Map();
async function loadTiles(keys) { // keys "z/x/y"
  const todo = keys.filter(k => !tileCache.has(k)); let i = 0, done = 0;
  async function worker() {
    while (i < todo.length) {
      const k = todo[i++], [z, x, y] = k.split('/').map(Number);
      const buf = await cachedFetch(TERRARIUM(z, x, y), path.join(TILES, `${z}-${x}-${y}.png`), true);
      tileCache.set(k, decodePNG(buf)); done++;
      if (done % 50 === 0) console.log(`  tiles ${done}/${todo.length}`);
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
}
function tilesFor(polys, z) { // every tile of the polygon's bbox
  const [lon0, lat0, lon1, lat1] = bboxOf(allRings(polys)); const keys = [];
  for (let tx = Math.floor(lon2tx(lon0, z)); tx <= Math.floor(lon2tx(lon1, z)); tx++) for (let ty = Math.floor(lat2ty(lat1, z)); ty <= Math.floor(lat2ty(lat0, z)); ty++) keys.push(`${z}/${tx}/${ty}`);
  return keys;
}
// Scanline over every zoom-z pixel centre inside the polygon (even-odd over all rings): span(gy, ga, gb) per run of pixels gx = ga..gb in row gy.
function scanPixels(polys, z, span) {
  const edges = []; allRings(polys).forEach(r => { for (let i = 0; i + 1 < r.length; i++) edges.push([r[i], r[i + 1]]); });
  const [, lat0, , lat1] = bboxOf(allRings(polys));
  const gy0 = Math.floor(lat2ty(lat1, z) * 256), gy1 = Math.floor(lat2ty(lat0, z) * 256);
  for (let gy = gy0; gy <= gy1; gy++) {
    const lat = ty2lat((gy + 0.5) / 256, z); const xs = [];
    for (const [p, q] of edges) if ((p[1] > lat) !== (q[1] > lat)) xs.push(p[0] + (lat - p[1]) * (q[0] - p[0]) / (q[1] - p[1]));
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const ga = Math.ceil(lon2tx(xs[k], z) * 256 - 0.5), gb = Math.floor(lon2tx(xs[k + 1], z) * 256 - 0.5);
      if (ga <= gb) span(gy, ga, gb);
    }
  }
}
// tiles holding at least one sampled pixel centre of the polygon (z=14: only the tiles the polygon really covers, not its bbox)
function tilesInside(polys, z) {
  const keys = new Set();
  scanPixels(polys, z, (gy, ga, gb) => { const ty = Math.floor(gy / 256); for (let tx = Math.floor(ga / 256); tx <= Math.floor(gb / 256); tx++) keys.add(`${z}/${tx}/${ty}`); });
  return [...keys];
}
const pixel = (z, gx, gy) => { const t = tileCache.get(`${z}/${Math.floor(gx / 256)}/${Math.floor(gy / 256)}`); if (!t) return NaN; const o = ((gy & 255) * 256 + (gx & 255)) * t.ch; return t.data[o] * 256 + t.data[o + 1] + t.data[o + 2] / 256 - 32768; };
function isSpike(z, gx, gy, e) { // neighbours in tiles that were not loaded are skipped
  const nb = []; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) { const v = pixel(z, gx + dx, gy + dy); if (!Number.isNaN(v)) nb.push(v); }
  nb.sort((a, b) => b - a); return nb.length >= 2 && e - nb[1] > SPIKE_M;
}
function sampleElevation(polys, z, despike) {
  let cells = 0, max = -Infinity, spikes = 0;
  scanPixels(polys, z, (gy, ga, gb) => {
    for (let gx = ga; gx <= gb; gx++) {
      const e = pixel(z, gx, gy); if (Number.isNaN(e)) throw new Error(`tile missing ${z}/${Math.floor(gx / 256)}/${Math.floor(gy / 256)}`);
      cells++; if (e > max) { if (despike && isSpike(z, gx, gy, e)) spikes++; else max = e; }
    }
  });
  return { cells, max, spikes };
}

// ---------- distances for adjacency (metres, local equirectangular) ----------
function polyDistanceM(pa, pb, cosLat) {
  const K = 111320, toXY = p => [p[0] * cosLat * K, p[1] * K];
  const ra = allRings(pa).map(r => r.map(toXY)), rb = allRings(pb).map(r => r.map(toXY));
  const segD = (p, a, b) => { let x = a[0], y = a[1], dx = b[0] - x, dy = b[1] - y; if (dx || dy) { const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy); if (t > 1) { x = b[0]; y = b[1]; } else if (t > 0) { x += dx * t; y += dy * t; } } dx = p[0] - x; dy = p[1] - y; return dx * dx + dy * dy; };
  let md = Infinity;
  const one = (A, B) => { for (const r of A) for (const p of r) for (const s of B) for (let i = 0; i + 1 < s.length; i++) { const d = segD(p, s[i], s[i + 1]); if (d < md) md = d; } };
  one(ra, rb); one(rb, ra);
  return Math.sqrt(md);
}

// ---------- main ----------
(async () => {
  // 1. existing data
  const w = {}; global.window = w; eval(fs.readFileSync(path.join(ROOT, 'data/geo.js'), 'utf8'));
  const OLD = w.GEO, OLDHP = w.HP; delete global.window;
  if (OLD.hoods.length !== OLDHP.length || OLD.hoods.some((h, i) => h.name !== OLDHP[i].name)) throw new Error('existing GEO.hoods and HP disagree');
  const oldProj = makeProj(OLD.nx, OLD.ny, OLD.bbox);
  const hpByName = new Map(OLDHP.map(h => [h.name, h.polys]));

  // 2. place list
  const spec = JSON.parse(fs.readFileSync(PLACES, 'utf8'));
  const places = []; spec.batches.forEach(b => b.places.forEach(p => places.push({ ...p, region: p.region || b.region, batch: b.id })));
  places.forEach(p => { if (!REGION_KEYS.includes(p.region)) throw new Error(`bad region ${p.region} for ${p.name}`); });
  const listed = new Set(places.map(p => p.name)); if (listed.size !== places.length) throw new Error('duplicate place names in ' + PLACES);
  const OLDX = OLD.hoods.filter(h => !listed.has(h.name)); // existing hoods: kept verbatim
  places.forEach(p => { if (hpByName.has(p.name)) p.polys = hpByName.get(p.name); }); // listed and already in the file: reuse the polygon
  const toFetch = places.filter(p => !p.polys);
  note(`places list: ${places.length} places (${places.length - toFetch.length} already in data/geo.js, ${toFetch.length} to fetch); ${OLDX.length} existing hoods kept`);

  // 3. county polygons for the named counties (used to disambiguate duplicate BASENAMEs)
  const countyNames = [...new Set(toFetch.map(p => p.county))];
  const cq = !toFetch.length ? { features: [] } : await fetchJSON(`${COUNTY_URL}?where=${encodeURIComponent(`STATE='06' AND BASENAME IN (${countyNames.map(n => `'${n}'`).join(',')})`)}&outFields=BASENAME,GEOID,STATE&f=geojson&outSR=4326`);
  const countyPolys = new Map(cq.features.map(f => [f.properties.BASENAME, geomToPolys(f.geometry)]));
  countyNames.forEach(n => { if (!countyPolys.has(n)) throw new Error('county not found: ' + n); });

  // 4. place polygons (batched IN lists per layer)
  const missing = [], ambiguous = [];
  for (const kind of ['city', 'cdp']) {
    const list = toFetch.filter(p => p.kind === kind);
    for (let i = 0; i < list.length; i += 12) {
      const batch = list.slice(i, i + 12);
      const where = `STATE='06' AND BASENAME IN (${batch.map(p => `'${p.census.replace(/'/g, "''")}'`).join(',')})`;
      const url = `${TIGER}/Places_CouSub_ConCity_SubMCD/MapServer/${PLACE_LAYER[kind]}/query?where=${encodeURIComponent(where)}&outFields=BASENAME,NAME,GEOID,LSADC,AREALAND,CENTLAT,CENTLON&f=geojson&outSR=4326`;
      const j = await fetchJSON(url);
      if (j.exceededTransferLimit) throw new Error('transfer limit exceeded; use smaller batches');
      for (const p of batch) {
        let feats = j.features.filter(f => f.properties.BASENAME === p.census);
        if (feats.length > 1) {
          const cp = countyPolys.get(p.county);
          const inCounty = feats.filter(f => inPolys(cp, +f.properties.CENTLON, +f.properties.CENTLAT));
          ambiguous.push(`${p.name}: ${feats.length} features (${feats.map(f => f.properties.NAME + '/' + f.properties.GEOID).join(', ')}) -> ${inCounty.length ? 'picked ' + inCounty[0].properties.GEOID : 'none in county, picked first'}`);
          feats = inCounty.length ? inCounty : feats;
        }
        if (!feats.length) { missing.push(`${p.name} (${p.census}, layer ${PLACE_LAYER[kind]})`); continue; }
        p.polys = geomToPolys(feats[0].geometry); p.geoid = feats[0].properties.GEOID; p.arealand = feats[0].properties.AREALAND;
      }
    }
  }
  report.missing = missing; report.ambiguous = ambiguous;
  if (ambiguous.length) note('ambiguous BASENAMEs: ' + ambiguous.join('; '));
  if (missing.length) throw new Error('places with no feature: ' + missing.join(', '));
  if (toFetch.length) note('all fetched places resolved to exactly one feature' + (ambiguous.length ? ' after county disambiguation' : ''));

  // 5. new bbox at the old unit density
  const unitX = (UNIT_REF.bbox[2] - UNIT_REF.bbox[0]) / UNIT_REF.nx;                  // deg lon per unit
  const unitY = (mercY(UNIT_REF.bbox[3]) - mercY(UNIT_REF.bbox[1])) / UNIT_REF.ny;    // mercator per unit (positive)
  const everyPoly = [...OLDX.map(h => hpByName.get(h.name)), ...places.map(p => p.polys)];
  const ub = bboxOf(everyPoly.flatMap(allRings));
  const lon0 = Math.floor((ub[0] - MARGIN) / GRID) * GRID, lat1 = Math.ceil((ub[3] + MARGIN) / GRID) * GRID;
  const lon1g = Math.ceil((ub[2] + MARGIN) / GRID) * GRID, lat0g = Math.floor((ub[1] - MARGIN) / GRID) * GRID;
  const nx = Math.ceil((lon1g - lon0) / unitX - 1e-9), ny = Math.ceil((mercY(lat1) - mercY(lat0g)) / unitY - 1e-9);
  const bbox = [+lon0.toFixed(6), +invMercY(mercY(lat1) - ny * unitY).toFixed(6), +(lon0 + nx * unitX).toFixed(6), +lat1.toFixed(6)];
  const P = makeProj(nx, ny, bbox);
  const dx = P.proj(oldProj.unproj(0, 0))[0], dy = P.proj(oldProj.unproj(0, 0))[1];
  report.bbox = bbox; report.nx = nx; report.ny = ny; report.offset = [r5(dx), r5(dy)]; report.unionBbox = ub.map(r5);
  note(`union bbox ${ub.map(r5)} -> bbox ${bbox} nx ${nx} ny ${ny} (old ${OLD.nx}x${OLD.ny}); offsets dx ${dx.toFixed(4)} dy ${dy.toFixed(4)}`);
  const densX = nx / (bbox[2] - bbox[0]) / (OLD.nx / (OLD.bbox[2] - OLD.bbox[0])), densY = ny / (mercY(bbox[3]) - mercY(bbox[1])) / (OLD.ny / (mercY(OLD.bbox[3]) - mercY(OLD.bbox[1])));
  note(`density ratio new/input file x ${densX.toFixed(8)} y ${densY.toFixed(8)}`);

  // 6. translate existing hoods, verify
  const hoods = OLDX.map(h => {
    const q = P.proj(oldProj.unproj(h.cx, h.cy));
    return { ...h, cx: r2(q[0]), cy: r2(q[1]), adj: h.adj.slice(), _polysXY: mapPolys(hpByName.get(h.name), P.proj) };
  });
  let worstT = 0, outside = [];
  hoods.forEach((h, i) => { const o = OLDX[i]; worstT = Math.max(worstT, Math.abs(h.cx - (o.cx + dx)), Math.abs(h.cy - (o.cy + dy))); if (!inPolys(h._polysXY, h.cx, h.cy)) outside.push(h.name); });
  report.translateWorst = worstT; report.translatedOutside = outside;
  note(`translated existing cx/cy: worst deviation from pure translation ${worstT.toFixed(4)}; anchors outside polygon: ${outside.length ? outside.join(', ') : 'none'}`);

  // 7. anchor calibration on existing hoods (input projection vs existing cx/cy): diagnostics; ANCHOR_METHOD is pinned
  const calib = {};
  for (const m of Object.keys(anchors)) {
    const errs = OLDX.map(h => { const polys = mapPolys(hpByName.get(h.name), oldProj.proj); const a = anchors[m](polys); return Math.hypot(a[0] - h.cx, a[1] - h.cy); });
    calib[m] = { median: r2(median(errs)), mean: r2(errs.reduce((s, v) => s + v, 0) / errs.length), worst: r2(Math.max(...errs)) };
  }
  const calibBest = Object.keys(calib).sort((a, b) => calib[a].median - calib[b].median)[0], bestMethod = ANCHOR_METHOD;
  report.anchorCalibration = calib; report.anchorMethod = bestMethod;
  note(`anchor calibration (units): ${JSON.stringify(calib)} -> best ${calibBest}; using pinned ${bestMethod}`);

  // 8. new hoods
  const newHoods = places.map(p => {
    const polysXY = mapPolys(p.polys, P.proj); let a = anchors[bestMethod](polysXY), method = bestMethod;
    if (!inPolys(polysXY, a[0], a[1])) { a = anchors.poi(polysXY); method = 'poi(fallback)'; }
    if (!inPolys(polysXY, a[0], a[1])) throw new Error('no inside anchor for ' + p.name);
    return { name: p.name, region: p.region, cx: r2(a[0]), cy: r2(a[1]), max: 0, cells: 0, adj: [], _polysXY: polysXY, _method: method };
  });
  report.anchorFallbacks = newHoods.filter(h => h._method !== bestMethod).map(h => h.name);
  if (report.anchorFallbacks.length) note('anchor fallback to pole of inaccessibility for: ' + report.anchorFallbacks.join(', '));
  const all = [...hoods, ...newHoods];
  const polysOf = h => hpByName.get(h.name) || places.find(p => p.name === h.name).polys;

  // 9. elevation sampling: cells from z=12 (the scale CELL_SCALE was pinned on), max from z=14 (z=12 pixels, about 30 m, flatten small summits)
  const tileKeys = [...new Set(all.flatMap(h => tilesFor(polysOf(h), Z)))];
  note(`terrarium tiles needed at z=${Z}: ${tileKeys.length}`);
  await loadTiles(tileKeys);
  const samples = all.map(h => sampleElevation(polysOf(h), Z, false));
  tileKeys.forEach(k => tileCache.delete(k));
  const tileKeysMax = [...new Set(all.flatMap(h => tilesInside(polysOf(h), ZMAX)))].sort();
  note(`terrarium tiles needed at z=${ZMAX} (tiles holding a sample inside a place): ${tileKeysMax.length}`);
  await loadTiles(tileKeysMax);
  const noMax = [], spiky = [];
  all.forEach((h, i) => {
    const m = sampleElevation(polysOf(h), ZMAX, true); if (m.spikes) spiky.push(`${h.name} ${m.spikes}`);
    if (Number.isFinite(m.max)) samples[i].max = m.max; else noMax.push(h.name); // no z=14 pixel centre inside: keep the z=12 max
  });
  report.maxFromZ12 = noMax; if (noMax.length) note(`no z=${ZMAX} sample inside (z=${Z} max kept): ${noMax.join(', ')}`);
  report.maxSpikesSkipped = spiky; note(`z=${ZMAX} spike pixels skipped for max (more than ${SPIKE_M} m above the second-highest neighbour): ${spiky.join(', ') || 'none'}`);
  const ratios = [], maxDev = [], maxRel = [];
  hoods.forEach((h, i) => { const o = OLDX[i], s = samples[i]; if (o.cells > 0) ratios.push(s.cells / o.cells); maxDev.push(Math.abs(s.max - o.max)); maxRel.push(Math.abs(s.max - o.max) / Math.max(1, o.max)); });
  const medRatio = median(ratios), within2 = ratios.filter(r => r >= 0.5 && r <= 2).length;
  const scale = CELL_SCALE;
  note(`cell counts: raw samples / input cells median ${medRatio.toFixed(3)} (${within2}/${ratios.length} within a factor of 2); scaling by pinned CELL_SCALE ${scale.toFixed(4)}`);
  all.forEach((h, i) => { h.max = r1(samples[i].max); h.cells = Math.max(1, Math.round(samples[i].cells * scale)); });
  const cellRel = hoods.map((h, i) => Math.abs(h.cells / OLDX[i].cells - 1));
  const worstCell = cellRel.indexOf(Math.max(...cellRel)), worstMax = maxDev.indexOf(Math.max(...maxDev));
  report.elevation = { scale, medianCellRatio: r5(medRatio), medianCellRelDev: r5(median(cellRel)), worstCellRelDev: { name: hoods[worstCell].name, old: OLDX[worstCell].cells, new: hoods[worstCell].cells, rel: r5(cellRel[worstCell]) }, medianMaxDevM: r2(median(maxDev)), medianMaxRelDev: r5(median(maxRel)), worstMaxDev: { name: hoods[worstMax].name, old: OLDX[worstMax].max, new: hoods[worstMax].max, devM: r1(maxDev[worstMax]), rel: r5(maxRel[worstMax]) } };
  note(`elevation vs existing (${OLDX.length} hoods): max median dev ${report.elevation.medianMaxDevM} m (median rel ${report.elevation.medianMaxRelDev}), worst ${JSON.stringify(report.elevation.worstMaxDev)}; cells median rel dev ${report.elevation.medianCellRelDev}, worst ${JSON.stringify(report.elevation.worstCellRelDev)}`);
  report.elevationPerHood = hoods.map((h, i) => ({ name: h.name, oldMax: OLDX[i].max, newMax: h.max, oldCells: OLDX[i].cells, newCells: h.cells }));

  // 10. adjacency for new hoods (+ reciprocal links), symmetric
  const byName = new Map(all.map(h => [h.name, h]));
  const llBox = new Map(all.map(h => [h.name, bboxOf(allRings(polysOf(h)))]));
  const margLat = ADJ_M / 111320, margLon = ADJ_M / (111320 * Math.cos(37.8 * Math.PI / 180));
  const capped = [];
  for (const h of newHoods) {
    const b = llBox.get(h.name), cand = [];
    for (const o of all) {
      if (o === h) continue; const c = llBox.get(o.name);
      if (c[0] > b[2] + margLon || c[2] < b[0] - margLon || c[1] > b[3] + margLat || c[3] < b[1] - margLat) continue;
      const d = polyDistanceM(polysOf(h), polysOf(o), Math.cos((b[1] + b[3]) / 2 * Math.PI / 180));
      if (d <= ADJ_M) cand.push({ name: o.name, d });
    }
    cand.sort((a, b) => a.d - b.d);
    if (cand.length > ADJ_CAP) capped.push(`${h.name} (${cand.length} within ${ADJ_M} m, dropped ${cand.slice(ADJ_CAP).map(c => c.name).join(', ')})`);
    h.adj = cand.slice(0, ADJ_CAP).map(c => c.name);
  }
  // reciprocal links: existing-to-existing first, then from new hoods, then (after the fallback) existing-to-new;
  // this order makes a rerun on the generated file reproduce it (existing lists already hold the links to new hoods)
  const isNew = new Set(newHoods.map(h => h.name));
  const link = (h, a) => { const o = byName.get(a); if (!o) throw new Error(`adj name unresolvable: ${a} in ${h.name}`); if (!o.adj.includes(h.name)) o.adj.push(h.name); };
  for (const h of hoods) for (const a of h.adj) if (!isNew.has(a)) link(h, a);
  for (const h of newHoods) for (const a of h.adj) link(h, a);
  report.adjCapped = capped; if (capped.length) note('adj capped at 8: ' + capped.join('; '));
  report.adjIsolated = newHoods.filter(h => !h.adj.length).map(h => h.name); if (report.adjIsolated.length) note('new hoods with no neighbour within 250 m: ' + report.adjIsolated.join(', '));
  // 10b. fallback: a new hood with no neighbour within 250 m gets its FALLBACK_N nearest hoods (polygon distance, up to FALLBACK_M), linked both ways
  // (new hoods only: Alcatraz's empty list is deliberate, app.js shows "It is an island.")
  const isolated = newHoods.filter(h => !h.adj.length), fallback = [];
  const fbLat = FALLBACK_M / 111320, fbLon = FALLBACK_M / (111320 * Math.cos(37.8 * Math.PI / 180));
  for (const h of isolated) {
    const b = llBox.get(h.name), cand = [];
    for (const o of all) {
      if (o === h) continue; const c = llBox.get(o.name);
      if (c[0] > b[2] + fbLon || c[2] < b[0] - fbLon || c[1] > b[3] + fbLat || c[3] < b[1] - fbLat) continue;
      const d = polyDistanceM(polysOf(h), polysOf(o), Math.cos((b[1] + b[3]) / 2 * Math.PI / 180));
      if (d <= FALLBACK_M) cand.push({ name: o.name, d });
    }
    cand.sort((a, b) => a.d - b.d);
    if (!cand.length) throw new Error(`no hood within ${FALLBACK_M / 1000} km of ${h.name}`);
    for (const c of cand.slice(0, FALLBACK_N)) {
      const o = byName.get(c.name);
      if (!h.adj.includes(o.name)) h.adj.push(o.name);
      if (!o.adj.includes(h.name)) o.adj.push(h.name);
      fallback.push({ from: h.name, to: o.name, km: r2(c.d / 1000) });
    }
  }
  report.adjFallback = fallback;
  for (const h of hoods) for (const a of h.adj) if (isNew.has(a)) link(h, a);
  if (fallback.length) note(`adj fallback (${FALLBACK_N} nearest within ${FALLBACK_M / 1000} km, both ways): ` + fallback.map(f => `${f.from} - ${f.to} ${f.km} km`).join('; '));

  // 11. regions: padding measured on the input file's rects (diagnostics; REGION_PAD is pinned), then recompute all six
  const pads = [];
  for (const k of Object.keys(OLD.regions)) {
    const members = OLD.hoods.filter(h => h.region === k); if (!members.length) continue; const ub = bboxOf(members.flatMap(h => allRings(mapPolys(hpByName.get(h.name), oldProj.proj)))); const r = OLD.regions[k];
    pads.push({ region: k, pad: [r2(ub[0] - r[0]), r2(ub[1] - r[1]), r2(r[2] - ub[2]), r2(r[3] - ub[3])] });
  }
  const padAll = pads.flatMap(p => p.pad), pad = REGION_PAD;
  report.regionPadCalibration = pads; report.regionPad = pad;
  note(`region rect padding found on input rects (units, left/top/right/bottom per region): ${JSON.stringify(pads)} -> median ${r1(median(padAll))}; using pinned ${pad}`);
  const regions = {};
  for (const k of REGION_KEYS) {
    const members = all.filter(h => h.region === k); if (!members.length) throw new Error('region with no hoods: ' + k);
    const ub = bboxOf(members.flatMap(h => allRings(h._polysXY)));
    regions[k] = [r1(ub[0] - pad), r1(ub[1] - pad), r1(ub[2] + pad), r1(ub[3] + pad)];
  }
  note('regions: ' + JSON.stringify(regions));

  // 12. other: every California county intersecting bbox + 0.6 deg (queried), filtered to those meeting bbox + COAST_PAD
  const env = [bbox[0] - 0.6, bbox[1] - 0.6, bbox[2] + 0.6, bbox[3] + 0.6].map(v => +v.toFixed(3));
  const oq = await fetchJSON(`${COUNTY_URL}?where=${encodeURIComponent("STATE='06'")}&geometry=${env.join(',')}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=BASENAME,GEOID,STATE&f=geojson&outSR=4326`);
  if (oq.exceededTransferLimit) throw new Error('county query exceeded transfer limit');
  // keep only counties whose bbox meets the canvas + COAST_PAD (the rest never reach the canvas, and the outline step drops their edges anyway)
  const keepBox = [bbox[0] - COAST_PAD, bbox[1] - COAST_PAD, bbox[2] + COAST_PAD, bbox[3] + COAST_PAD];
  const fetched = oq.features.map(f => ({ name: f.properties.BASENAME, polys: geomToPolys(f.geometry) }));
  const meets = c => { const b = bboxOf(allRings(c.polys)); return b[0] <= keepBox[2] && b[2] >= keepBox[0] && b[1] <= keepBox[3] && b[3] >= keepBox[1]; };
  const counties = fetched.filter(meets);
  report.countiesDropped = fetched.filter(c => !meets(c)).map(c => c.name).sort();
  note(`counties dropped (bbox clear of canvas + ${COAST_PAD} deg): ${report.countiesDropped.join(', ') || 'none'}`);
  const other = counties.flatMap(c => c.polys);
  report.counties = counties.map(c => c.name).sort();
  note(`other: ${counties.length} counties (${report.counties.join(', ')}), ${other.length} polygons, ${other.flat().reduce((s, r) => s + r.length, 0)} vertices`);

  // 12b. water: inland areal hydrography on the canvas (drawn in the water colour over the county filler); rules at WATER_* above
  const wBase = `${HYDRO_URL}?where=${encodeURIComponent(`AREAWATER>${WATER_CHANNEL_MIN_M2}`)}&geometry=${bbox.join(',')}&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=OBJECTID,NAME,MTFCC,AREAWATER&outSR=4326&maxAllowableOffset=${WATER_GEN_DEG}&orderByFields=OBJECTID&f=geojson`;
  const wFeats = [], wSeen = new Set();
  for (let off = 0, page = 0; ; page++) { // paged by resultOffset; a page cut short by the server's transfer limit just moves the offset by what came back
    if (page > 200) throw new Error('water query: too many pages');
    const j = await fetchJSON(`${wBase}&resultOffset=${off}&resultRecordCount=${WATER_PAGE}`);
    const more = j.exceededTransferLimit || (j.properties && j.properties.exceededTransferLimit);
    j.features.forEach(f => { const id = f.properties.OBJECTID; if (!wSeen.has(id)) { wSeen.add(id); wFeats.push(f); } });
    off += j.features.length;
    if (!j.features.length || (!more && j.features.length < WATER_PAGE)) break;
  }
  const isStill = f => WATER_STILL.includes(f.properties.MTFCC), wArea = f => +f.properties.AREAWATER;
  wFeats.forEach(f => { f.polys = geomToPolys(f.geometry); f.bb = bboxOf(f.polys.map(p => p[0])); });
  const bigStill = wFeats.filter(f => isStill(f) && wArea(f) >= WATER_MIN_M2 && f.properties.NAME);
  const touches = (a, b, m = 0.005) => a[0] <= b[2] + m && a[2] >= b[0] - m && a[1] <= b[3] + m && a[3] >= b[1] - m;
  const pieceOf = f => bigStill.some(g => g.properties.NAME === f.properties.NAME && touches(f.bb, g.bb)); // a small piece of a big named lake
  const sized = wFeats.filter(f => !isStill(f) || wArea(f) >= WATER_MIN_M2 || pieceOf(f));
  const otherBB = other.map(p => bboxOf([p[0]]));
  const onFiller = (x, y) => other.some((p, i) => { const b = otherBB[i]; return x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3] && pip(p[0], x, y) && !p.slice(1).some(h => pip(h, x, y)); });
  const fillerShare = f => { // share of a grid of points inside the feature that falls on the filler (vertices when the grid misses a thin feature)
    const b = f.bb, st = Math.sqrt((b[2] - b[0]) * (b[3] - b[1]) / 2000) || 1e-4; let n = 0, k = 0;
    for (let y = b[1] + st / 2; y < b[3]; y += st) for (let x = b[0] + st / 2; x < b[2]; x += st) if (inPolys(f.polys, x, y)) { n++; if (onFiller(x, y)) k++; }
    if (n < 20) f.polys.forEach(p => p[0].forEach(([x, y]) => { n++; if (onFiller(x, y)) k++; }));
    return k / n;
  };
  sized.forEach(f => { f.share = fillerShare(f); });
  const wKept = sized.filter(f => f.share >= WATER_IN_FILLER);
  const water = wKept.flatMap(f => f.polys);
  const wRow = f => ({ name: f.properties.NAME || '(unnamed)', mtfcc: f.properties.MTFCC, km2: r2(wArea(f) / 1e6), onFiller: r2(f.share), vertices: f.polys.flat().reduce((s, r) => s + r.length, 0) });
  const byArea = (a, b) => wArea(b) - wArea(a) || a.properties.OBJECTID - b.properties.OBJECTID;
  report.water = { queried: wFeats.length, sized: sized.length, kept: wKept.slice().sort(byArea).map(wRow), droppedOpenWater: sized.filter(f => f.share < WATER_IN_FILLER).sort(byArea).map(wRow) };
  note(`water: ${wFeats.length} features over ${WATER_CHANNEL_MIN_M2 / 1e6} km2 on the canvas, ${sized.length} pass the size rules, ${wKept.length} kept on the filler (${sized.length - wKept.length} open-water dropped); ${water.length} polygons, ${water.flat().reduce((s, r) => s + r.length, 0)} vertices; largest: ${report.water.kept.slice(0, 10).map(w => `${w.name} ${w.km2}`).join(', ')}`);
  // shores for the halo: rings of kept features of at least WATER_MIN_M2 (or pieces of a big lake), cut to the segments with
  // land on one side and water (kept water, or off the filler) on the other: seams between water features and open-water edges drop out
  const waterBB = water.map(p => bboxOf([p[0]]));
  const inWater = (x, y) => water.some((p, i) => { const b = waterBB[i]; return x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3] && pip(p[0], x, y) && !p.slice(1).some(h => pip(h, x, y)); });
  const wet = (x, y) => inWater(x, y) || !onFiller(x, y);
  const shoreLines = [], shortDropped = [0];
  const lineM = l => { let m = 0; for (let i = 1; i < l.length; i++) m += Math.hypot((l[i][0] - l[i - 1][0]) * Math.cos(l[i][1] * Math.PI / 180), l[i][1] - l[i - 1][1]) * 111320; return m; };
  const pushRun = l => { if (lineM(l) >= WATER_SHORE_MIN_M) shoreLines.push(l); else shortDropped[0]++; };
  for (const f of wKept) {
    if (!(wArea(f) >= WATER_MIN_M2 || pieceOf(f))) continue;
    for (const ring of f.polys.flat()) {
      const L = ring.length - 1, keep = [];
      for (let i = 0; i < L; i++) {
        const [ax, ay] = ring[i], [bx, by] = ring[i + 1], c = Math.cos(ay * Math.PI / 180), ex = (bx - ax) * c, ey = by - ay, len = Math.hypot(ex, ey);
        const nx = -ey / len * WATER_SHORE_EPS / c, ny = ex / len * WATER_SHORE_EPS, mx = (ax + bx) / 2, my = (ay + by) / 2;
        keep.push(wet(mx + nx, my + ny) !== wet(mx - nx, my - ny));
      }
      if (keep.every(Boolean)) { shoreLines.push(ring); continue; }
      const s0 = keep.findIndex((k, i) => !k); let run = null;
      for (let t = 1; t <= L; t++) {
        const i = (s0 + t) % L;
        if (keep[i]) { if (!run) run = [ring[i]]; run.push(ring[i + 1]); } else if (run) { pushRun(run); run = null; }
      }
      if (run) pushRun(run);
    }
  }
  report.waterShores = { polylines: shoreLines.length, vertices: shoreLines.reduce((s, l) => s + l.length, 0), shortDropped: shortDropped[0] };
  note(`water shores (halo): ${shoreLines.length} polylines, ${report.waterShores.vertices} vertices (${shortDropped[0]} pieces under ${WATER_SHORE_MIN_M} m dropped)`);

  // 13. outline: union of the county polygons by directed-edge cancellation
  const key = p => p[0] + ',' + p[1];
  const edgeCount = new Map(); let total = 0;
  other.forEach(poly => poly.forEach(ring => { for (let i = 0; i + 1 < ring.length; i++) { const k = key(ring[i]) + '|' + key(ring[i + 1]); edgeCount.set(k, (edgeCount.get(k) || 0) + 1); total++; } }));
  const survivors = []; let cancelled = 0, inland = 0;
  const coastBox = [bbox[0] - COAST_PAD, bbox[1] - COAST_PAD, bbox[2] + COAST_PAD, bbox[3] + COAST_PAD];
  const nearCoast = k => { const [x, y] = k.split(',').map(Number); return x >= coastBox[0] && x <= coastBox[2] && y >= coastBox[1] && y <= coastBox[3]; };
  for (const [k, n] of edgeCount) {
    const [a, b] = k.split('|'); const rev = edgeCount.get(b + '|' + a) || 0; const keep = n - Math.min(n, rev); cancelled += Math.min(n, rev);
    if (keep && !(nearCoast(a) && nearCoast(b))) { inland += keep; continue; } // the outer edge of the county set, far inland: not a shore
    for (let i = 0; i < keep; i++) survivors.push([a, b]);
  }
  // chain the surviving edges into polylines: open chains first (they start where an inland edge was dropped), then closed rings
  const out = new Map(), indeg = new Map(); survivors.forEach(([a, b]) => { if (!out.has(a)) out.set(a, []); out.get(a).push(b); indeg.set(b, (indeg.get(b) || 0) + 1); });
  const lines = []; let used = 0;
  const walk = start => { const line = [start]; let cur = start; for (;;) { const nexts = out.get(cur); if (!nexts || !nexts.length) break; const nxt = nexts.pop(); used++; line.push(nxt); cur = nxt; if (cur === start) break; } return line; };
  for (const [start] of out) while ((out.get(start) || []).length > (indeg.get(start) || 0)) lines.push(walk(start));
  for (const [start] of out) while (out.get(start) && out.get(start).length) lines.push(walk(start));
  if (used !== survivors.length) throw new Error(`outline chaining used ${used} of ${survivors.length} edges`);
  // the water bodies' own shores get the same coast halo
  const outline = lines.filter(l => l.length >= 2).map(l => [l.map(k => k.split(',').map(Number))]).concat(shoreLines.map(l => [l]));
  const closed = lines.filter(l => l[0] === l[l.length - 1]).length;
  note(`outline: ${total} directed edges, ${cancelled} cancelled, ${inland} inland edges dropped, ${survivors.length} shore edges chained into ${lines.length} polylines (${closed} closed, largest ${Math.max(...lines.map(l => l.length))} pts), plus ${shoreLines.length} water shore polylines`);
  report.outline = { edges: total, cancelled, inland, survivors: survivors.length, polylines: lines.length, closed, waterShores: shoreLines.length };

  // 14. validate
  const HP = all.map(h => ({ name: h.name, polys: polysOf(h) }));
  const finalHoods = all.map(h => ({ name: h.name, region: h.region, cx: h.cx, cy: h.cy, max: h.max, cells: h.cells, adj: h.adj }));
  const names = new Set(finalHoods.map(h => h.name));
  if (names.size !== finalHoods.length) throw new Error('duplicate hood names');
  places.forEach(p => { if (!names.has(p.name)) throw new Error('new place missing: ' + p.name); });
  const okNum = v => typeof v === 'number' && Number.isFinite(v);
  const checkRings = (polys, what) => polys.forEach(poly => { if (!poly.length) throw new Error(`${what}: empty poly`); poly.forEach(r => { if (r.length < 4) throw new Error(`${what}: ring with ${r.length} pts`); const f = r[0], l = r[r.length - 1]; if (f[0] !== l[0] || f[1] !== l[1]) throw new Error(`${what}: ring not closed`); r.forEach(p => { if (!okNum(p[0]) || !okNum(p[1])) throw new Error(`${what}: NaN`); }); }); });
  HP.forEach((h, i) => {
    if (!h.polys.length) throw new Error('no polys: ' + h.name); checkRings(h.polys, h.name);
    const fh = finalHoods[i]; if (!okNum(fh.cx) || !okNum(fh.cy) || !okNum(fh.max) || !(fh.cells > 0)) throw new Error('bad numbers: ' + h.name);
    if (!inPolys(all[i]._polysXY, fh.cx, fh.cy)) throw new Error('anchor outside polygon: ' + h.name);
    fh.adj.forEach(a => { if (!names.has(a)) throw new Error(`adj unresolvable ${a} in ${h.name}`); if (!finalHoods.find(o => o.name === a).adj.includes(h.name)) throw new Error(`adj asymmetric ${h.name} -> ${a}`); });
    if (!REGION_KEYS.includes(fh.region)) throw new Error('bad region ' + h.name);
  });
  checkRings(other, 'other'); checkRings(water, 'water');
  outline.forEach(l => { if (l.length !== 1 || l[0].length < 2 || l[0].some(p => !okNum(p[0]) || !okNum(p[1]))) throw new Error('outline: bad polyline'); }); // open polylines: no closure check
  for (const k of REGION_KEYS) { const r = regions[k]; if (!(r[2] > r[0] && r[3] > r[1]) || r.some(v => !okNum(v))) throw new Error('empty region rect ' + k); }
  const counts = {}; finalHoods.forEach(h => counts[h.region] = (counts[h.region] || 0) + 1);
  report.regionCounts = counts; note('hoods per region: ' + JSON.stringify(counts) + `, total ${finalHoods.length}`);
  OLDX.forEach((o, i) => { if (finalHoods[i].name !== o.name || finalHoods[i].region !== o.region || JSON.stringify(HP[i].polys) !== JSON.stringify(hpByName.get(o.name))) throw new Error('existing hood changed: ' + o.name); o.adj.forEach(a => { if (!finalHoods[i].adj.includes(a)) throw new Error('lost adj ' + a); }); });
  places.forEach(p => { if (hpByName.has(p.name) && JSON.stringify(HP.find(h => h.name === p.name).polys) !== JSON.stringify(hpByName.get(p.name))) throw new Error('reused polygon changed: ' + p.name); });

  // 15. write
  const GEO = { nx, ny, bbox, regions, hoods: finalHoods, other, water, outline }; // outline: shore polylines (open or closed), stroked, never filled
  const text = '// Generated by tools/geo-build.js (do not edit by hand). Geometry: projected canvas (nx x ny), lon/lat bbox, places with label anchors, and polygons (lon/lat).\n'
    + '// SF boundaries: SF Planning Department. Other places: US Census TIGERweb generalized places (500K). Land filler and coast: Census counties (500K). Inland water: TIGERweb areal hydrography. Elevation: Mapzen terrarium tiles (high points z=14, area cells z=12).\n'
    + 'window.GEO = ' + JSON.stringify(GEO) + ';\n'
    + 'window.HP = ' + JSON.stringify(HP) + ';\n';
  fs.writeFileSync(path.join(CACHE, 'report.json'), JSON.stringify(report, null, 1));
  if (DRY) { note('dry run: data/geo.js not written'); return; }
  fs.writeFileSync(path.join(ROOT, 'data/geo.js'), text);
  note(`wrote data/geo.js (${text.length} bytes)`);
})().catch(e => { console.error('geo-build failed:', e.stack || e); process.exit(1); });
