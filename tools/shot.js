#!/usr/bin/env node
// Screenshot and interaction harness for Seven by Seven. Dependency-free: Node 24 (global WebSocket and
// fetch), a tiny in-process static server, and headless Chrome driven over the DevTools Protocol.
//
//   node tools/shot.js --scenes <scenes.json> --out <dir> [--serve-port N] [--only name,name] [--chrome <path>]
//
// Scenes file (JSON):
//   {
//     "block": ["*firebaseio.com*"],                 // Network.setBlockedURLs patterns (default: Firebase, so a seeded
//                                                    // log is never written to the real shared database)
//     "defaults": { "device": "phone", "themes": ["light", "dark"], "settle": 900 },
//     "devices": { "custom": { "width": 430, "height": 932, "dpr": 3, "mobile": true } },   // optional extra devices
//     "scenes": [
//       { "name": "landing-peek", "url": "#",                 // url: "#hash", "/path#hash" or absolute
//         "device": "phone" | "desktop" | "<devices key>" | { "width", "height", "dpr", "mobile" },
//         "themes": ["light", "dark"],                        // one PNG per theme: <name>-<theme>.png
//         "media": [{ "name": "prefers-reduced-motion", "value": "reduce" }],   // extra emulated media features
//         "seed": { "sbs-prefs-v3": { "theme": "dark" } },    // localStorage items set before the app's scripts run
//         "seedFile": "seed-log.json",                        // same shape, read from a file next to the scenes file
//         "setup": "__sbs.sheet.set('full')",                 // JS run after load + fonts + 600 ms (inside an async fn:
//                                                             // `await` and `return` allowed; a returned value is logged)
//         "steps": [ { "tap": [195, 700] }, { "tapSel": "#lens-btn" }, { "wait": 500 }, { "eval": "..." },
//                    { "type": "Noe" }, { "key": "Enter" },
//                    { "swipe": { "from": [195, 780], "to": [195, 300], "ms": 260, "steps": 10 } },
//                    { "shot": "mid" } ],                      // extra capture: <name>-<theme>-mid.png
//         "settle": 1200,                                     // ms to wait before the final capture
//         "fullPage": false }
//     ]
//   }
// Each scene runs in a fresh browser context (own localStorage), so seeds never leak between scenes.
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http'), net = require('net');
const { spawn } = require('child_process');

const DEFAULT_CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const DEVICES = {
  phone: { width: 390, height: 844, dpr: 3, mobile: true },       // iPhone 14 / 15 / 16 CSS px
  desktop: { width: 1440, height: 900, dpr: 2, mobile: false },
};
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain' };

const sleep = ms => new Promise(r => setTimeout(r, ms));
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout after ${ms} ms: ${what}`)), ms))]);

// ---------- CLI ----------
function usage(code) {
  console.log(`Usage: node tools/shot.js --scenes <scenes.json> --out <dir> [--serve-port N] [--only a,b] [--chrome <path>] [--root <dir>]
  --scenes      scenes file (see the header comment of this script for the schema)
  --out         output directory for PNGs (created if missing); files are named <scene>-<theme>[-<shot>].png
  --serve-port  port for the static server (default: a free port)
  --only        comma list of scene names to run (substring match)
  --chrome      Chrome binary (default: ${DEFAULT_CHROME})
  --root        directory to serve (default: the repo root, the parent of tools/)
  --help        this text`);
  process.exit(code);
}
function parseArgs(argv) {
  const a = { scenes: null, out: null, servePort: 0, only: null, chrome: DEFAULT_CHROME, root: path.resolve(__dirname, '..') };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i], v = argv[i + 1];
    if (k === '--help' || k === '-h') usage(0);
    else if (k === '--scenes') { a.scenes = v; i++; }
    else if (k === '--out') { a.out = v; i++; }
    else if (k === '--serve-port') { a.servePort = +v || 0; i++; }
    else if (k === '--only') { a.only = v.split(',').map(s => s.trim()).filter(Boolean); i++; }
    else if (k === '--chrome') { a.chrome = v; i++; }
    else if (k === '--root') { a.root = path.resolve(v); i++; }
    else { console.error('unknown argument: ' + k); usage(2); }
  }
  if (!a.scenes || !a.out) { console.error('--scenes and --out are required'); usage(2); }
  return a;
}

// ---------- static server ----------
function startServer(root, port) {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      let p; try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch (e) { res.writeHead(400); res.end(); return; }
      if (p.endsWith('/')) p += 'index.html';
      const f = path.normalize(path.join(root, p));
      if (!f.startsWith(root + path.sep) && f !== root) { res.writeHead(403); res.end(); return; }
      fs.readFile(f, (err, buf) => {
        if (err) { res.writeHead(err.code === 'EISDIR' ? 301 : 404, err.code === 'EISDIR' ? { Location: p + '/' } : {}); res.end(); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Content-Length': buf.length });
        res.end(buf);
      });
    });
    srv.on('error', reject);
    srv.listen(port, '127.0.0.1', () => resolve({ srv, port: srv.address().port, origin: `http://127.0.0.1:${srv.address().port}` }));
  });
}

// ---------- Chrome ----------
async function launchChrome(bin) {
  if (!fs.existsSync(bin)) throw new Error('Chrome binary not found: ' + bin);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'sbs-shot-'));
  const args = ['--headless=new', '--remote-debugging-port=0', '--no-first-run', '--no-default-browser-check', `--user-data-dir=${profile}`,
    '--hide-scrollbars', '--mute-audio', '--force-color-profile=srgb', '--window-size=1440,900', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', 'about:blank'];
  const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  const wsUrl = await withTimeout(new Promise((resolve, reject) => {
    proc.stderr.on('data', d => { stderr += d; const m = stderr.match(/DevTools listening on (ws:\/\/\S+)/); if (m) resolve(m[1]); });
    proc.on('exit', code => reject(new Error(`Chrome exited early (code ${code}):\n${stderr.slice(-2000)}`)));
  }), 20000, 'waiting for "DevTools listening on" from Chrome');
  const port = new URL(wsUrl).port;
  // the task asks for /json/version: the browser websocket URL from the discovery endpoint (same as the stderr line)
  let browserWs = wsUrl;
  try { const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); if (v.webSocketDebuggerUrl) browserWs = v.webSocketDebuggerUrl; } catch (e) { console.warn('  /json/version failed, using stderr URL:', e.message); }
  return { proc, profile, browserWs, kill() { try { proc.kill('SIGKILL'); } catch (e) {} try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} } };
}

class CDP {
  static async connect(url) {
    const ws = new WebSocket(url);
    await withTimeout(new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', () => rej(new Error('websocket error connecting to ' + url)), { once: true }); }), 10000, 'websocket open');
    const c = new CDP(); c.ws = ws; c.id = 0; c.pending = new Map(); c.listeners = new Set();
    ws.addEventListener('message', ev => {
      let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.id != null) { const p = c.pending.get(m.id); if (!p) return; c.pending.delete(m.id); if (m.error) p.reject(new Error(`${p.method}: ${m.error.message}${m.error.data ? ' — ' + m.error.data : ''}`)); else p.resolve(m.result || {}); }
      else for (const fn of c.listeners) { try { fn(m); } catch (e) {} }
    });
    ws.addEventListener('close', () => { for (const [, p] of c.pending) p.reject(new Error('websocket closed during ' + p.method)); c.pending.clear(); });
    return c;
  }
  send(method, params = {}, sessionId = undefined, timeout = 30000) {
    const id = ++this.id, msg = { id, method, params }; if (sessionId) msg.sessionId = sessionId;
    return withTimeout(new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject, method }); this.ws.send(JSON.stringify(msg)); }), timeout, method)
      .catch(e => { this.pending.delete(id); throw e; });
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  waitFor(method, sessionId, timeout, pred = () => true) {
    return withTimeout(new Promise(resolve => { const off = this.on(m => { if (m.method === method && (!sessionId || m.sessionId === sessionId) && pred(m.params)) { off(); resolve(m.params); } }); }), timeout, 'event ' + method);
  }
  close() { try { this.ws.close(); } catch (e) {} }
}

// ---------- one scene ----------
function resolveDevice(d, custom) {
  if (!d) return DEVICES.phone;
  if (typeof d === 'string') { const dev = custom[d] || DEVICES[d]; if (!dev) throw new Error('unknown device: ' + d); return dev; }
  return { width: d.width || 390, height: d.height || 844, dpr: d.dpr || d.deviceScaleFactor || 3, mobile: d.mobile !== false };
}
const seedScript = seed => `(() => { try { const s = ${JSON.stringify(seed)}; for (const k in s) localStorage.setItem(k, typeof s[k] === 'string' ? s[k] : JSON.stringify(s[k])); } catch (e) { console.warn('seed failed', e); } })();`;

async function runScene(cdp, origin, scene, theme, dev, seed, opts) {
  const { out, block, log } = opts;
  const base = `${scene.name}-${theme}`;
  const { browserContextId } = await cdp.send('Target.createBrowserContext', {});
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId, width: dev.width, height: dev.height });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const S = (m, p, t) => cdp.send(m, p, sessionId, t);
  const pageErrors = [];
  const off = cdp.on(m => { if (m.sessionId !== sessionId) return; if (m.method === 'Runtime.exceptionThrown') pageErrors.push((m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description) || m.params.exceptionDetails.text); });
  const evaluate = async (code, label) => {
    const r = await S('Runtime.evaluate', { expression: `(async () => { ${code}\n })()`, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(`${label || 'eval'} threw: ${(r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text}`);
    return r.result && r.result.value;
  };
  const centerOf = async sel => { const v = await evaluate(`const el = document.querySelector(${JSON.stringify(sel)}); if (!el) throw new Error('no element matches ' + ${JSON.stringify(sel)}); const r = el.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2];`, 'tapSel'); return v; };
  const touch = (type, pts) => S('Input.dispatchTouchEvent', { type, touchPoints: pts.map(([x, y]) => ({ x: Math.round(x), y: Math.round(y), radiusX: 2, radiusY: 2, force: 1 })) });
  const tap = async (x, y) => {
    if (dev.mobile) { await touch('touchStart', [[x, y]]); await sleep(60); await touch('touchEnd', []); }
    else { for (const type of ['mousePressed', 'mouseReleased']) await S('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }); }
  };
  const swipe = async ({ from, to, ms = 260, steps = 10 }) => {
    await touch('touchStart', [from]);
    for (let i = 1; i <= steps; i++) { const t = i / steps; await touch('touchMove', [[from[0] + (to[0] - from[0]) * t, from[1] + (to[1] - from[1]) * t]]); await sleep(ms / steps); }
    await touch('touchEnd', []);
  };
  const capture = async suffix => {
    const file = path.join(out, `${base}${suffix ? '-' + suffix : ''}.png`);
    const { data } = await S('Page.captureScreenshot', { format: 'png', captureBeyondViewport: !!scene.fullPage, fromSurface: true }, 60000);
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
    console.log(file); log.written.push(file);
  };
  try {
    await S('Page.enable'); await S('Runtime.enable'); await S('Network.enable');
    if (block.length) await S('Network.setBlockedURLs', { urls: block });
    await S('Emulation.setDeviceMetricsOverride', { width: dev.width, height: dev.height, deviceScaleFactor: dev.dpr, mobile: dev.mobile, screenWidth: dev.width, screenHeight: dev.height });
    await S('Emulation.setTouchEmulationEnabled', { enabled: !!dev.mobile, maxTouchPoints: 5 });
    if (dev.mobile) await S('Emulation.setUserAgentOverride', { userAgent: scene.userAgent || IPHONE_UA, platform: 'iPhone' });
    await S('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }, ...(scene.media || [])] });
    await S('Emulation.setFocusEmulationEnabled', { enabled: true });
    if (seed) await S('Page.addScriptToEvaluateOnNewDocument', { source: seedScript(seed) });
    const url = new URL(scene.url || '/', origin + '/').href;
    const loaded = cdp.waitFor('Page.loadEventFired', sessionId, 20000);
    const nav = await S('Page.navigate', { url });
    if (nav.errorText) throw new Error(`navigation to ${url} failed: ${nav.errorText}`);
    await loaded;
    await evaluate('if (document.fonts && document.fonts.ready) await document.fonts.ready; return true;', 'fonts.ready');
    await sleep(600);
    if (scene.setup) { const v = await evaluate(scene.setup, 'setup'); if (v !== undefined) console.log(`  setup → ${JSON.stringify(v)}`); }
    for (const st of scene.steps || []) {
      if (st.wait != null) await sleep(st.wait);
      else if (st.tap) await tap(st.tap[0], st.tap[1]);
      else if (st.tapSel) { const [x, y] = await centerOf(st.tapSel); await tap(x, y); }
      else if (st.swipe) await swipe(st.swipe);
      else if (st.eval != null) { const v = await evaluate(st.eval, 'step eval'); if (v !== undefined) console.log(`  eval → ${JSON.stringify(v)}`); }
      else if (st.type != null) await S('Input.insertText', { text: String(st.type) });
      else if (st.key) { const key = st.key, code = key.length === 1 ? 'Key' + key.toUpperCase() : key, vk = { Enter: 13, Escape: 27, Tab: 9, Backspace: 8, ArrowUp: 38, ArrowDown: 40 }[key] || (key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0); await S('Input.dispatchKeyEvent', { type: 'keyDown', key, code, windowsVirtualKeyCode: vk, text: key === 'Enter' ? '\r' : key.length === 1 ? key : undefined }); await S('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: vk }); }
      else if (st.shot) await capture(st.shot);
      else throw new Error('unknown step: ' + JSON.stringify(st));
    }
    await sleep(scene.settle != null ? scene.settle : opts.settle);
    // fonts.check() is false whenever an unused unicode-range subset is unloaded, so look at the FontFace objects instead
    const fontOk = await evaluate(`if (!document.fonts) return null; const st = {}; for (const f of document.fonts) { const k = f.family.replace(/"/g, ''); if (f.status === 'loaded') st[k] = true; else if (!st[k]) st[k] = false; } return [!!st['Bricolage Grotesque'], !!st['Figtree']];`).catch(() => null);
    if (fontOk && !(fontOk[0] && fontOk[1])) console.warn(`  ! web fonts not loaded (Bricolage ${fontOk[0]}, Figtree ${fontOk[1]}); the render uses fallbacks (no network?)`);
    await capture('');
    if (pageErrors.length) console.warn(`  ! page errors: ${pageErrors.slice(0, 3).join(' | ')}`);
  } finally {
    off();
    await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
    await cdp.send('Target.disposeBrowserContext', { browserContextId }).catch(() => {});
  }
}

// ---------- main ----------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const scenesPath = path.resolve(args.scenes);
  const cfg = JSON.parse(fs.readFileSync(scenesPath, 'utf8'));
  const scenesDir = path.dirname(scenesPath);
  const defaults = Object.assign({ device: 'phone', themes: ['light'], settle: 900 }, cfg.defaults || {});
  const block = cfg.block || ['*firebaseio.com*'];
  let scenes = cfg.scenes || [];
  if (args.only) scenes = scenes.filter(s => args.only.some(o => s.name.includes(o)));
  if (!scenes.length) { console.error('no scenes to run'); process.exit(2); }
  fs.mkdirSync(path.resolve(args.out), { recursive: true });
  const out = path.resolve(args.out);

  const server = await startServer(args.root, args.servePort);
  console.log(`serving ${args.root} at ${server.origin}`);
  let chrome = null, cdp = null;
  const cleanup = () => { if (cdp) cdp.close(); if (chrome) chrome.kill(); try { server.srv.close(); } catch (e) {} };
  for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => { cleanup(); process.exit(130); });
  process.on('uncaughtException', e => { console.error('fatal:', e); cleanup(); process.exit(1); });
  const log = { written: [], failed: [] };
  try {
    chrome = await launchChrome(args.chrome);
    cdp = await CDP.connect(chrome.browserWs);
    for (const scene of scenes) {
      if (!scene.name) { console.warn('skipping a scene without a name'); continue; }
      const dev = resolveDevice(scene.device || defaults.device, cfg.devices || {});
      let seed = scene.seed || null;
      if (scene.seedFile) seed = Object.assign({}, JSON.parse(fs.readFileSync(path.resolve(scenesDir, scene.seedFile), 'utf8')), seed || {});
      for (const theme of scene.themes || defaults.themes) {
        console.log(`scene ${scene.name} (${theme}, ${dev.width}x${dev.height}@${dev.dpr}${dev.mobile ? ' mobile' : ''}) ${scene.url || '/'}`);
        try { await withTimeout(runScene(cdp, server.origin, scene, theme, dev, seed, { out, block, settle: defaults.settle, log }), 90000, 'scene ' + scene.name); }
        catch (e) { console.error(`  ! scene ${scene.name} (${theme}) failed: ${e.message}`); log.failed.push(`${scene.name}-${theme}`); }
      }
    }
  } finally { cleanup(); }
  console.log(`\n${log.written.length} PNG(s) written${log.failed.length ? `, ${log.failed.length} failed: ${log.failed.join(', ')}` : ''}`);
  process.exit(log.failed.length ? 1 : 0);
}
main().catch(e => { console.error('fatal:', e.message); process.exit(1); });
