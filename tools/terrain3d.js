#!/usr/bin/env node
// Makes js/map3d/terrain.js: two height grids for the 3D map, from the public Terrain Tiles set on AWS (terrarium PNGs).
//
//   node tools/terrain3d.js --raw <dir> [--pictures <dir>] [--bay-m 250] [--sf-m 40]
//
// --raw: where the downloaded tiles live (<dir>/terrarium/{z}/{x}/{y}.png). A tile is fetched only when its file is missing,
// so a second run with the same settings needs no network. The tiles are treated as untrusted data: size limits, a strict
// PNG reader (8-bit RGB or RGBA, no interlace, 256 x 256), nothing in them is ever run.
// --pictures: also write a shaded-relief PNG of each grid there (bay.png, sf.png) and print the height check table.
// Grids: `bay` covers every place in data/geo.js except Las Vegas plus a small margin; `sf` covers San Francisco and the
// Marin Headlands end of the Golden Gate. Plain lon/lat sampling, north-up (row 0 is the north edge), bilinear from the tiles.
// Heights below 0 are 0; each sample is one byte, height = byte * step metres. No packages.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), zlib = require('zlib'), https = require('https');
const root = path.join(__dirname, '..');

// ---------- arguments ----------
const args = process.argv.slice(2), arg = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const RAW = arg('--raw'), PICS = arg('--pictures');
if (!RAW) { console.error('usage: node tools/terrain3d.js --raw <dir> [--pictures <dir>] [--bay-m 250] [--sf-m 40]'); process.exit(2); }
const BAY_M = +arg('--bay-m', 250), SF_M = +arg('--sf-m', 40);
if (!(BAY_M >= 20 && BAY_M <= 2000 && SF_M >= 5 && SF_M <= 500)) { console.error('spacing out of range'); process.exit(2); }

// ---------- the map's areas (data/geo.js, run in a sandbox: it is the repo's own file) ----------
const win = {}; vm.runInContext(fs.readFileSync(path.join(root, 'data/geo.js'), 'utf8'), vm.createContext({ window: win }), { filename: 'data/geo.js' });
const region = {}; win.GEO.hoods.forEach(h => { region[h.name] = h.region; });
function boundsOf(test) {
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  win.HP.forEach(h => { if (!test(region[h.name])) return; h.polys.forEach(p => p.forEach(r => r.forEach(([x, y]) => { if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y; if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y; }))); });
  return b;
}
const r4 = v => Math.round(v * 1e4) / 1e4;
const bayB = boundsOf(r => r && r !== 'vegas'), sfB = boundsOf(r => r === 'sf');
const BAY_BBOX = [bayB[0] - 0.03, bayB[1] - 0.03, bayB[2] + 0.03, bayB[3] + 0.03].map(r4);
// SF plus the Marin Headlands (Point Bonita at -122.530, Hawk Hill at 37.826) and a little margin
const SF_BBOX = [Math.min(sfB[0], -122.535) - 0.01, sfB[1] - 0.01, sfB[2] + 0.01, Math.max(sfB[3], 37.835) + 0.01].map(r4);

// ---------- tiles ----------
const URL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const MAX_TILE = 4 << 20; // a terrarium tile is about 100 KB; refuse anything over 4 MB
const stats = { fetched: 0, bytesFetched: 0, fromDisk: 0, bytesDisk: 0 };
const sleep = ms => new Promise(r => setTimeout(r, ms));
function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'map-data-fetch/1.0' }, timeout: 60000 }, res => {
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`HTTP ${res.statusCode} for ${url} (stopping: the server refused)`)); return; }
      const parts = []; let n = 0;
      res.on('data', d => { n += d.length; if (n > MAX_TILE) { req.destroy(new Error('tile over size limit: ' + url)); return; } parts.push(d); });
      res.on('end', () => resolve(Buffer.concat(parts)));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout: ' + url)));
    req.on('error', reject);
  });
}
async function tileBuf(z, x, y) {
  const file = path.join(RAW, 'terrarium', String(z), String(x), y + '.png');
  if (fs.existsSync(file)) { const b = fs.readFileSync(file); stats.fromDisk++; stats.bytesDisk += b.length; return b; }
  const b = await get(URL(z, x, y));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file + '.part', b); fs.renameSync(file + '.part', file);
  stats.fetched++; stats.bytesFetched += b.length;
  await sleep(150); // be polite
  return b;
}

// strict PNG reader: 8-bit RGB or RGBA, not interlaced, 256 x 256, the five filter types
function decodePNG(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 45 || buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a) throw new Error('not a PNG');
  let p = 8, w = 0, h = 0, depth, ct, interlace; const idat = [];
  while (p + 12 <= buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('latin1', p + 4, p + 8);
    if (len > buf.length - p - 12) throw new Error('PNG chunk runs past the end');
    const d = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { if (len < 13) throw new Error('short IHDR'); w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; ct = d[9]; interlace = d[12]; }
    else if (type === 'IDAT') idat.push(d); else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (w !== 256 || h !== 256 || depth !== 8 || interlace || (ct !== 2 && ct !== 6)) throw new Error(`unexpected PNG ${w}x${h} depth ${depth} type ${ct} interlace ${interlace}`);
  const ch = ct === 2 ? 3 : 4, stride = w * ch, need = h * (stride + 1);
  const raw = zlib.inflateSync(Buffer.concat(idat), { maxOutputLength: need });
  if (raw.length !== need) throw new Error('PNG data has the wrong length');
  const out = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = y * (stride + 1) + 1, dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i], a = i >= ch ? out[dst + i - ch] : 0, b = y > 0 ? out[dst - stride + i] : 0, c = (y > 0 && i >= ch) ? out[dst - stride + i - ch] : 0; let v;
      switch (f) {
        case 0: v = x; break; case 1: v = x + a; break; case 2: v = x + b; break; case 3: v = x + ((a + b) >> 1); break;
        case 4: { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c); break; }
        default: throw new Error('bad PNG filter ' + f);
      }
      out[dst + i] = v & 255;
    }
  }
  const hm = new Float32Array(w * h); // terrarium: metres = R * 256 + G + B / 256 - 32768
  for (let i = 0; i < w * h; i++) hm[i] = out[i * ch] * 256 + out[i * ch + 1] + out[i * ch + 2] / 256 - 32768;
  return hm;
}

const mercY = lat => { const r = lat * Math.PI / 180; return Math.log(Math.tan(r) + 1 / Math.cos(r)); };
const lon2px = (lon, z) => (lon + 180) / 360 * 256 * (1 << z);
const lat2py = (lat, z) => (1 - mercY(lat) / Math.PI) / 2 * 256 * (1 << z);
const pxSizeM = (z, lat) => 2 * Math.PI * 6378137 * Math.cos(lat * Math.PI / 180) / (256 * (1 << z));

// a height source at one zoom: bilinear in tile pixels (pixel centres at +0.5), across tile edges, so no seams
async function source(bbox, z) {
  const x0 = Math.floor(lon2px(bbox[0], z) / 256), x1 = Math.floor(lon2px(bbox[2], z) / 256);
  const y0 = Math.floor(lat2py(bbox[3], z) / 256), y1 = Math.floor(lat2py(bbox[1], z) / 256);
  const tiles = new Map(); let n = 0;
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) { tiles.set(tx + '/' + ty, decodePNG(await tileBuf(z, tx, ty))); n++; }
  const px = (gx, gy) => { // global pixel, clamped to the fetched tiles
    gx = Math.min(Math.max(gx, x0 * 256), x1 * 256 + 255); gy = Math.min(Math.max(gy, y0 * 256), y1 * 256 + 255);
    return tiles.get((gx >> 8) + '/' + (gy >> 8))[(gy & 255) * 256 + (gx & 255)];
  };
  const at = (lon, lat) => {
    const fx = lon2px(lon, z) - 0.5, fy = lat2py(lat, z) - 0.5, ix = Math.floor(fx), iy = Math.floor(fy), tx = fx - ix, ty = fy - iy;
    return (px(ix, iy) * (1 - tx) + px(ix + 1, iy) * tx) * (1 - ty) + (px(ix, iy + 1) * (1 - tx) + px(ix + 1, iy + 1) * tx) * ty;
  };
  return { at, tiles: n, z };
}
// the lowest zoom whose pixel is at most half the sample spacing (so a sample sees at least two pixels across)
const zoomFor = (spacing, lat) => { for (let z = 0; z <= 15; z++) if (pxSizeM(z, lat) <= spacing / 2) return z; return 15; };

async function grid(name, bbox, spacing) {
  const midLat = (bbox[1] + bbox[3]) / 2, mLat = 111320, mLon = 111320 * Math.cos(midLat * Math.PI / 180);
  const w = Math.round((bbox[2] - bbox[0]) * mLon / spacing) + 1, h = Math.round((bbox[3] - bbox[1]) * mLat / spacing) + 1;
  const z = zoomFor(spacing, midLat), src = await source(bbox, z);
  const m = new Float32Array(w * h); let max = 0;
  for (let r = 0; r < h; r++) {
    const lat = bbox[3] - (bbox[3] - bbox[1]) * r / (h - 1);
    for (let c = 0; c < w; c++) { const v = Math.max(0, src.at(bbox[0] + (bbox[2] - bbox[0]) * c / (w - 1), lat)); m[r * w + c] = v; if (v > max) max = v; }
  }
  const step = Math.ceil(max / 255 * 100) / 100, bytes = Buffer.alloc(w * h);
  for (let i = 0; i < w * h; i++) bytes[i] = Math.min(255, Math.round(m[i] / step));
  return { name, bbox, w, h, step, bytes, metres: m, max, z, tiles: src.tiles, spacing, src, mx: (bbox[2] - bbox[0]) * mLon / (w - 1), my: (bbox[3] - bbox[1]) * mLat / (h - 1) };
}
// what the engine will do: bilinear on the stored bytes
function sampleGrid(g, lon, lat) {
  const fx = (lon - g.bbox[0]) / (g.bbox[2] - g.bbox[0]) * (g.w - 1), fy = (g.bbox[3] - lat) / (g.bbox[3] - g.bbox[1]) * (g.h - 1);
  if (fx < 0 || fy < 0 || fx > g.w - 1 || fy > g.h - 1) return null;
  const ix = Math.min(g.w - 2, Math.floor(fx)), iy = Math.min(g.h - 2, Math.floor(fy)), tx = fx - ix, ty = fy - iy, d = g.bytes, w = g.w;
  return g.step * ((d[iy * w + ix] * (1 - tx) + d[iy * w + ix + 1] * tx) * (1 - ty) + (d[(iy + 1) * w + ix] * (1 - tx) + d[(iy + 1) * w + ix + 1] * tx) * ty);
}

// ---------- tiny PNG writer (8-bit RGB) ----------
const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = b => { let c = -1; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
function chunk(type, data) { const t = Buffer.from(type, 'latin1'), len = Buffer.alloc(4), crc = Buffer.alloc(4); len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, crc]); }
function writePNG(file, w, h, rgb) {
  const raw = Buffer.alloc(h * (w * 3 + 1)); for (let y = 0; y < h; y++) rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}
// shaded relief from the stored bytes: water blue, land grey by height times a light from the north-west
function relief(g, file) {
  const { w, h } = g, rgb = Buffer.alloc(w * h * 3), H = (c, r) => g.bytes[Math.min(h - 1, Math.max(0, r)) * w + Math.min(w - 1, Math.max(0, c))] * g.step;
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) {
    const v = H(c, r), i = (r * w + c) * 3;
    if (v <= 0) { rgb[i] = 150; rgb[i + 1] = 185; rgb[i + 2] = 215; continue; }
    const dx = (H(c + 1, r) - H(c - 1, r)) / (2 * g.mx), dy = (H(c, r + 1) - H(c, r - 1)) / (2 * g.my); // dy: southward
    const nx = -dx * 2, ny = dy * 2, len = Math.hypot(nx, ny, 1), lx = -0.6, ly = 0.6, lz = 0.53; // light from the north-west
    const shade = Math.max(0, (nx * lx + ny * ly + lz) / len) , t = v / Math.max(1, g.max);
    const base = 120 + 135 * t;
    rgb[i] = Math.min(255, base * (0.35 + 0.8 * shade)); rgb[i + 1] = Math.min(255, base * (0.33 + 0.78 * shade)); rgb[i + 2] = Math.min(255, base * (0.3 + 0.72 * shade));
  }
  writePNG(file, w, h, rgb);
}

(async () => {
  fs.mkdirSync(RAW, { recursive: true });
  const bay = await grid('bay', BAY_BBOX, BAY_M), sf = await grid('sf', SF_BBOX, SF_M);
  const pack = g => ({ bbox: g.bbox, w: g.w, h: g.h, step: g.step, data: g.bytes.toString('base64') });
  const src = 'Terrain Tiles (terrarium), s3.amazonaws.com/elevation-tiles-prod; elevation data: 3DEP, SRTM, GMTED2010, ETOPO1 and others, see github.com/tilezen/joerd/blob/master/docs/attribution.md';
  const out = '// Generated by tools/terrain3d.js (do not edit by hand): height grids for the 3D map, from the Terrain Tiles set on AWS.\n'
    + `// bay: every place but Las Vegas, about ${BAY_M} m a sample (tiles z${bay.z}); sf: San Francisco and the Marin Headlands, about ${SF_M} m (tiles z${sf.z}).\n`
    + '// Per grid: bbox [lon0, lat0, lon1, lat1] (west, south, east, north); w x h samples, north-up, plain lon/lat spacing: sample (c, r)\n'
    + '// sits at lon = lon0 + (lon1 - lon0) * c / (w - 1), lat = lat1 - (lat1 - lat0) * r / (h - 1); data is base64 of w * h bytes, row by\n'
    + '// row from the north edge; height in metres = byte * step (0 is sea level and below). Sample by bilinear interpolation.\n'
    + 'window.M3D = window.M3D || {}; window.M3D.terrainData = ' + JSON.stringify({ bay: pack(bay), sf: pack(sf), source: src }) + ';\n';
  fs.mkdirSync(path.join(root, 'js/map3d'), { recursive: true });
  fs.writeFileSync(path.join(root, 'js/map3d/terrain.js'), out);
  const gz = zlib.gzipSync(Buffer.from(out), { level: 9 }).length;
  for (const g of [bay, sf]) console.log(`${g.name}: bbox ${g.bbox.join(', ')}; ${g.w} x ${g.h} samples, ${g.mx.toFixed(0)} x ${g.my.toFixed(0)} m; tiles z${g.z} (pixel ${pxSizeM(g.z, (g.bbox[1] + g.bbox[3]) / 2).toFixed(1)} m): ${g.tiles}; max ${g.max.toFixed(1)} m, step ${g.step} m`);
  console.log(`tiles fetched now: ${stats.fetched} (${stats.bytesFetched} bytes); read from disk: ${stats.fromDisk} (${stats.bytesDisk} bytes)`);
  console.log(`js/map3d/terrain.js: ${out.length} bytes raw (${(out.length / 1024).toFixed(0)} KB), ${gz} bytes gzipped (${(gz / 1024).toFixed(0)} KB)`);
  if (PICS) {
    fs.mkdirSync(PICS, { recursive: true });
    for (const g of [bay, sf]) relief(g, path.join(PICS, g.name + '.png'));
    console.log(`pictures: ${path.join(PICS, 'bay.png')}, ${path.join(PICS, 'sf.png')}`);
    const pts = [['Twin Peaks', 37.7544, -122.4477, 280], ['Mount Davidson', 37.7383, -122.4547, 282], ['Mount Tamalpais east peak', 37.9235, -122.5965, 784],
      ['Mount Diablo', 37.8816, -121.9142, 1173], ['Mount Hamilton', 37.3414, -121.6429, 1283], ['In the bay', 37.82, -122.35, 0], ['Ocean Beach', 37.76, -122.511, 3]];
    const f = v => v == null ? '-' : v.toFixed(0);
    console.log('\n| Point | Real (m) | bay grid | sf grid | tile z' + bay.z + ' at point | tile z' + sf.z + ' at point |');
    console.log('|---|---|---|---|---|---|');
    for (const [n, lat, lon, real] of pts) {
      const inSf = sampleGrid(sf, lon, lat) != null;
      console.log(`| ${n} | ${real} | ${f(sampleGrid(bay, lon, lat))} | ${f(sampleGrid(sf, lon, lat))} | ${f(Math.max(0, bay.src.at(lon, lat)))} | ${inSf ? f(Math.max(0, sf.src.at(lon, lat))) : '-'} |`);
    }
  }
})().catch(e => { console.error('terrain3d: ' + e.message); process.exit(1); });
