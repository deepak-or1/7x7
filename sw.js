// Seven by Seven service worker: a repeat visit paints from a saved copy of the app, and the app opens with no connection.
// The "core set" is the page plus every same-origin script and stylesheet it references, read from the page itself. It is saved
// as one cache and replaced only as a whole: after a visit is served from it, the set is fetched again in the background
// (revalidated, so an unchanged file costs a 304), and only when something changed and every file arrived is the new set staged
// in a cache of its own and made the active one in a single write; open pages are told, and offer a reload. Anything else of the
// app's own (the street-map library, icons, the manifest) is saved on first use and refreshed in the background.
// Never touched: other hosts (the log's database and its stream, map tiles, fonts), anything but GET, range requests.
// The page is stored and matched by its path only: the ?log= key in the page URL never reaches Cache Storage.
'use strict';
// push handlers are imported here (added with the notifications work)

const VERSION = 1; // names the caches; bump only when this file's logic changes (old caches go on activate)
const PRE = `sbs-v${VERSION}-`, META = PRE + 'meta', EXTRA = PRE + 'extra', CORE = PRE + 'core-';
const SCOPE = new URL(self.registration.scope), BASE = SCOPE.pathname, PAGE = SCOPE.origin + BASE;
const ACTIVE_KEY = PAGE + '__sbs-active'; // a made-up URL in the meta cache whose body names the active core cache
const STATIC = /^(?:(?:js|css|data|vendor|icons)\/|manifest\.webmanifest$)|\.(?:woff2?|ttf|otf)$/;

let active = null; // the active core cache's name, memoised (read from META after a restart)
const served = new Map(); // window client id -> the core cache its page came from, so a page still loading never mixes sets
const activeName = async () => active || (active = await caches.open(META).then(c => c.match(ACTIVE_KEY)).then(r => r ? r.text() : null).catch(() => null));
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
  for (const m of html.matchAll(/<(script|link)\b[^>]*>/gi)) {
    const tag = m[0], at = tag.match(/\s(?:src|href)\s*=\s*["']([^"']+)["']/i);
    if (!at || (m[1].toLowerCase() === 'link' && !/\srel\s*=\s*["']?stylesheet/i.test(tag))) continue;
    try { const u = new URL(at[1], PAGE); if (u.origin === SCOPE.origin && u.pathname.startsWith(BASE)) { const k = keyOf(u); if (!out.includes(k)) out.push(k); } } catch (e) {}
  }
  return out;
}
const same = (a, b) => { if (a.byteLength !== b.byteLength) return false; const x = new Uint8Array(a), y = new Uint8Array(b); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false; return true; };

// fetch the core set again; swap it in only when it changed and all of it arrived. One refresh at a time
let refreshing = null;
function refresh() { return refreshing || (refreshing = doRefresh().catch(() => {}).finally(() => { refreshing = null; })); }
async function doRefresh() {
  // each body is read as it arrives: a response left unread holds its connection, and the browser opens only a few per host
  const get = u => fetch(u, { cache: 'no-cache', credentials: 'same-origin' }).then(async r => { if (!ok(r)) throw new Error('refresh: ' + r.status + ' ' + u); return [r, await r.arrayBuffer()]; });
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
  active = name;
  for (const k of await caches.keys()) if (k.startsWith(CORE) && k !== name && k !== was) await caches.delete(k); // keep the previous set for a page still loading from it
  const open = await self.clients.matchAll({ type: 'window' }), ids = new Set(open.map(c => c.id));
  for (const id of served.keys()) if (!ids.has(id)) served.delete(id);
  if (!was) return; // the first save: nothing to announce
  for (const c of open) if (served.get(c.id) !== name) c.postMessage({ type: 'sbs-update' });
}

self.addEventListener('install', e => { e.waitUntil(refresh().then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('sbs-') && !k.startsWith(PRE)).map(k => caches.delete(k)))).then(() => self.clients.claim())); });

self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET' || r.headers.has('range')) return; // not ours: no respondWith, the browser does what it always does
  const u = new URL(r.url);
  if (u.origin !== SCOPE.origin || !u.pathname.startsWith(BASE)) return; // other hosts: the database, tiles, fonts
  if (r.mode === 'navigate') { if (isPage(u)) e.respondWith(page(e)); return; }
  if (!STATIC.test(u.pathname.slice(BASE.length))) return;
  e.respondWith(asset(e, u));
});

async function page(e) {
  const name = await activeName(), hit = name && await caches.open(name).then(c => c.match(PAGE)).catch(() => null);
  e.waitUntil(refresh());
  if (hit) { if (e.resultingClientId) served.set(e.resultingClientId, name); return hit; }
  return fetch(e.request); // no saved copy yet: the network, as without a worker
}

async function asset(e, u) {
  const k = keyOf(u), name = served.get(e.clientId) || await activeName();
  const core = name && await caches.open(name).then(c => c.match(k)).catch(() => null);
  if (core) return core; // the core set is refreshed only as a whole
  const extra = await caches.open(EXTRA), hit = await extra.match(k).catch(() => null);
  const net = fetch(e.request).then(async res => { if (ok(res)) await extra.put(k, res.clone()); return res; });
  if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
  return net;
}
