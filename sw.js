// Seven by Seven service worker: a repeat visit paints from a saved copy of the app, and the app opens with no connection.
// The "core set" is the page plus every same-origin script and stylesheet it references, read from the page itself. It is saved
// as one cache and replaced only as a whole: after a visit is served from it, the set is fetched again in the background
// (revalidated, so an unchanged file costs a 304), and only when something changed and every file arrived is the new set staged
// in a cache of its own and made the active one in a single write; open pages are told, and offer a reload. Anything else of the
// app's own (the street-map library, icons, the manifest) is saved on first use and refreshed in the background.
// Never touched: other hosts (the log's database and its stream, map tiles, fonts), anything but GET, range requests.
// The page is stored and matched by its path only: the ?log= key in the page URL never reaches Cache Storage.
'use strict';
importScripts('sw-push.js'); // the notification listeners (push, notificationclick)

const VERSION = 1; // names the caches; bump only when this file's logic changes (old caches go on activate)
const PRE = `sbs-v${VERSION}-`, META = PRE + 'meta', EXTRA = PRE + 'extra', CORE = PRE + 'core-';
const SCOPE = new URL(self.registration.scope), BASE = SCOPE.pathname, PAGE = SCOPE.origin + BASE;
const ACTIVE_KEY = PAGE + '__sbs-active'; // a made-up URL in the meta cache whose body names the active core cache
const STATIC = /^(?:(?:js|css|data|vendor|icons)\/|manifest\.webmanifest$)|\.(?:woff2?|ttf|otf)$/;

const served = new Map(); // window client id -> the core cache its page came from (null: the page came from the network), so a page still loading never mixes sets
let lastNav = null; // { name, at }: the last navigation answered, for a subresource whose client id was never recorded (Safari may leave resultingClientId empty)
// the active core cache's name, read from META every time (never memoised: another copy of this worker may have switched it), and
// only when that cache still exists (caches.open on a deleted name would quietly make an empty one)
const activeName = async () => { try { const r = await (await caches.open(META)).match(ACTIVE_KEY), n = r && await r.text(); return n && await caches.has(n) ? n : null; } catch (e) { return null; } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const limit = () => (typeof AbortSignal === 'function' && AbortSignal.timeout ? { signal: AbortSignal.timeout(30000) } : {}); // a fetch that never settles must not block every later refresh
const keyOf = u => { const x = new URL(u); return x.origin + x.pathname; }; // no query, no hash
const isPage = u => u.pathname === BASE || u.pathname === BASE + 'index.html';
const ok = r => r && r.ok && r.status === 200 && r.type === 'basic';
// a saved file, rebuilt: never marked redirected (a navigation cannot be answered with that), and no-cache, so the page's own memory
// cache asks again after Reload instead of reusing the old file under the server's max-age. The body is already decoded: the
// server's gzip length and encoding no longer describe it
const saved = (r, body) => { const h = new Headers(r.headers); h.set('Cache-Control', 'no-cache'); h.delete('Content-Encoding'); h.delete('Content-Length'); return new Response(body, { status: 200, statusText: r.statusText, headers: h }); };

// the core set, from the page: the page itself, then every same-origin <script src> and <link rel=stylesheet href>
function coreOf(html) {
  const out = [PAGE];
  for (const m of html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<(script|link)\b[^>]*>/gi)) {
    const tag = m[0], at = tag.match(/\s(?:src|href)\s*=\s*["']([^"']+)["']/i);
    if (!at || (m[1].toLowerCase() === 'link' && !/\srel\s*=\s*["']?stylesheet/i.test(tag))) continue;
    try { const u = new URL(at[1], PAGE); if (u.origin === SCOPE.origin && u.pathname.startsWith(BASE)) { const k = keyOf(u); if (!out.includes(k)) out.push(k); } } catch (e) {}
  }
  return out;
}
const same = (a, b) => { if (a.byteLength !== b.byteLength) return false; const x = new Uint8Array(a), y = new Uint8Array(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false; return true; };

// fetch the core set again; swap it in only when it changed and all of it arrived. One refresh at a time
let refreshing = null;
function refresh() { return refreshing || (refreshing = doRefresh().catch(e => console.warn('sbs: refresh failed,', e && e.message || e)).finally(() => { refreshing = null; })); }
async function doRefresh() {
  // each body is read as it arrives: a response left unread holds its connection, and the browser opens only a few per host
  const get = u => fetch(u, Object.assign({ cache: 'no-cache', credentials: 'same-origin' }, limit())).then(async r => { if (!ok(r)) throw new Error('status ' + r.status); return [r, await r.arrayBuffer()]; })
    .catch(e => { throw new Error(u + ': ' + (e && e.message || e)); }); // the failing URL, for the warning (core URLs carry no query)
  const first = await get(PAGE), urls = coreOf(new TextDecoder().decode(first[1]));
  const got = [first, ...await Promise.all(urls.slice(1).map(get))]; // any failure throws: the old set stays
  const bodies = got.map(g => g[1]);
  const was = await activeName(), old = was && await caches.open(was);
  if (old) { // unchanged (same files, same bytes): nothing to do
    const keys = (await old.keys()).map(r => r.url);
    if (keys.length === urls.length && urls.every(u => keys.includes(u))) {
      let all = true;
      for (let i = 0; i < urls.length && all; i++) { const r = await old.match(urls[i]); all = !!r && same(await r.arrayBuffer(), bodies[i]); }
      if (all) return;
    }
  }
  const name = CORE + Date.now(), stage = await caches.open(name);
  try { await Promise.all(urls.map((u, i) => stage.put(u, saved(got[i][0], bodies[i])))); } catch (e) { await caches.delete(name); throw e; }
  await (await caches.open(META)).put(ACTIVE_KEY, new Response(name)); // the switch: one write
  for (const k of await caches.keys()) if (k.startsWith(CORE) && k !== name && k !== was) await caches.delete(k); // keep the previous set for a page still loading from it
  const open = await self.clients.matchAll({ type: 'window' }), ids = new Set(open.map(c => c.id));
  for (const id of served.keys()) if (!ids.has(id)) served.delete(id);
  if (!was) return; // the first save: nothing to announce
  for (const c of open) { const s = served.get(c.id); if (s !== null && s !== name) c.postMessage({ type: 'sbs-update' }); } // null: a page from the network is not stale
}

// a new copy of this file installs at once; it saves a set only when none exists (the visits refresh it), so two copies never race
self.addEventListener('install', e => { e.waitUntil(activeName().then(n => n ? null : refresh()).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('sbs-') && !k.startsWith(PRE)).map(k => caches.delete(k)))).then(() => self.clients.claim())); });

self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || r.headers.has('range')) return; // not ours: no respondWith, the browser does what it always does
  const u = new URL(r.url);
  if (u.origin !== SCOPE.origin || !u.pathname.startsWith(BASE)) return; // other hosts: the database, tiles, fonts
  const nav = r.mode === 'navigate';
  if (nav ? !isPage(u) : !STATIC.test(u.pathname.slice(BASE.length))) return;
  // waitUntil is called here, synchronously (Safari wants that); the work it waits for is added while the answer is made. Any Cache
  // Storage error (a full disk) falls back to the network, which is what the page would have had without a worker
  const work = [], keep = p => { work.push(Promise.resolve(p).catch(() => {})); };
  const p = nav ? page(e) : asset(e, u, keep), drain = async () => { for (let i = 0; i < work.length; i++) await work[i]; };
  e.respondWith(p.catch(() => fetch(r)));
  // a visit: the core set is checked again 2.5 s after the page is answered, so its re-check requests never compete with the page's own first ones
  e.waitUntil(p.then(drain, drain).then(() => nav ? sleep(2500).then(refresh) : null));
});

async function page(e) {
  const name = await activeName(), hit = name && await caches.open(name).then(c => c.match(PAGE)).catch(() => null), s = hit ? name : null;
  if (e.resultingClientId) served.set(e.resultingClientId, s); // null: from the network (no saved copy yet), never told it is stale
  lastNav = { name: s, at: Date.now() };
  return hit || fetch(e.request); // no saved copy yet: the network, as without a worker
}

// the set a subresource belongs to: its page's (recorded when the page was answered); a client never recorded takes the last
// navigation's set when that was under 10 s ago, else the active one
async function setOf(e) {
  if (served.has(e.clientId)) return served.get(e.clientId);
  return lastNav && Date.now() - lastNav.at < 10000 ? lastNav.name : activeName();
}
async function asset(e, u, keep) {
  const k = keyOf(u), name = await setOf(e);
  if (!name && /^(?:js|css|data)\//.test(u.pathname.slice(BASE.length))) return fetch(e.request); // no set behind this page: core files from the network only, never saved one by one beside a later set
  const core = name && await caches.open(name).then(c => c.match(k)).catch(() => null);
  if (core) return core; // the core set is refreshed only as a whole
  const extra = await caches.open(EXTRA), hit = await extra.match(k).catch(() => null);
  const net = fetch(e.request).then(res => { if (ok(res)) keep(extra.put(k, res.clone())); return res; }); // the write is not waited for: a failed one still answers
  if (hit) { keep(net); return hit; }
  return net;
}
