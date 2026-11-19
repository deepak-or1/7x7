// Phone notifications (hosted site only): when one device adds something, the others get a Web Push. A static site cannot
// send one, so a tiny Cloudflare Worker does (push/worker.js, deploy guide in push/README.md); it never sees the log or its
// key. Each device that turns notifications on stores its subscription beside the log at logs/<key>-pu/<device id> =
// { sub, who, at } (Sync.push(key)); notify() reads the other devices' records, posts them to the Worker with a short
// message, and deletes the ones the push service says are gone (404, 410). sw-push.js shows the notification.
// init({ store, dev, who }): store is { list, put, del } (Sync.push(key)), dev this device's id, who() its display name.
// While PUSH below is empty available() is false and everything is a no-op.
const PUSH = { url: '', key: '' }; // url: the Worker's address (https://sbs-push.<account>.workers.dev); key: its VAPID public key (base64url, from tools/vapid.js)
window.Push = (() => {
  const LIM = { title: 80, body: 240, tag: 64, hash: 200 }, MAX = 10, EP = 1024, BODY = 8192, NAME = 24, WAIT = 10000; // the Worker's limits; NAME: longest stored name; WAIT: longest wait for the service worker
  const ID = /^[A-Za-z0-9_-]{1,40}$/;
  const HOSTS = ['fcm.googleapis.com', 'updates.push.services.mozilla.com'], SUFFIXES = ['.push.apple.com', '.notify.windows.com']; // the Worker's own list (push/lib.js): any other endpoint could never be delivered
  let store = null, dev = '', who = () => '';
  const own = (o, k) => !!o && typeof o === 'object' && Object.hasOwn(o, k);
  const cut = (s, n) => { let o = ''; for (const ch of s) { if (o.length + ch.length > n) break; o += ch; } return o; }; // by code point, never splitting an emoji, at most n UTF-16 units (what the Worker counts)
  const bytes = s => { try { const t = String(s).replace(/=+$/, ''); if (!/^[A-Za-z0-9_-]*$/.test(t)) return null; return Uint8Array.from(atob(t.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)); } catch (e) { return null; } };
  const later = (ms, v) => new Promise(r => setTimeout(() => r(v), ms));
  function available() { return typeof PUSH.url === 'string' && !!PUSH.url && typeof PUSH.key === 'string' && !!PUSH.key; }
  function init(o) {
    if ('store' in o) store = o.store || null;
    if ('dev' in o) dev = typeof o.dev === 'string' && ID.test(o.dev) ? o.dev : '';
    if ('who' in o) who = typeof o.who === 'function' ? o.who : () => '';
  }
  const ios = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1); // iPadOS reports a Mac
  const supported = () => 'serviceWorker' in navigator && typeof PushManager === 'function' && typeof Notification === 'function';
  const sameKey = sub => { const k = sub && sub.options && sub.options.applicationServerKey, want = bytes(PUSH.key); if (!k || !want) return true; const a = new Uint8Array(k); return a.length === want.length && a.every((b, i) => b === want[i]); }; // a subscription made for an older Worker key cannot be used
  const current = async () => { const reg = await navigator.serviceWorker.getRegistration(); const sub = reg && await reg.pushManager.getSubscription(); return sub && sameKey(sub) ? sub : null; };
  const clean = s => s.replace(/[\x00-\x1f\x7f]/g, ''); // control characters: one would cost the Worker six bytes of JSON
  const name = () => { try { const n = who(); return typeof n === 'string' ? cut(clean(n).trim(), NAME) : ''; } catch (e) { return ''; } };
  const save = sub => store && dev ? store.put(dev, { sub: sub.toJSON(), who: name(), at: Date.now() }) : Promise.resolve();
  // the synchronous part of state(): everything but whether this device is subscribed
  function early() {
    if (!available()) return 'off';
    if (navigator.standalone === false && ios()) return 'needs-install'; // iPhone and iPad Safari: web push works only for a Home Screen app
    if (!supported()) return 'unsupported';
    if (Notification.permission === 'denied') return 'blocked';
    return '';
  }
  async function state() {
    const s = early(); if (s) return s;
    try { return Notification.permission === 'granted' && await current() ? 'on' : 'ready'; } catch (e) { return 'unsupported'; }
  }
  async function enable() { // from a tap: the permission prompt is asked before anything is awaited, so Safari still sees the tap
    const s = early(); if (s) return s;
    try {
      const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
      if (perm !== 'granted') return perm === 'denied' ? 'blocked' : 'ready';
      const reg = await Promise.race([navigator.serviceWorker.ready, later(WAIT, null)]);
      if (!reg) return 'unsupported';
      let sub = await reg.pushManager.getSubscription();
      if (sub && !sameKey(sub)) { await sub.unsubscribe(); sub = null; }
      if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes(PUSH.key) });
      await save(sub).catch(() => {}); // a failed write is retried by refresh() at the next start
      return 'on';
    } catch (e) { return state(); }
  }
  async function disable() {
    if (!available() || !supported()) return state();
    try { const reg = await navigator.serviceWorker.getRegistration(), sub = reg && await reg.pushManager.getSubscription(); if (sub) await sub.unsubscribe(); } catch (e) {}
    if (store && dev) await store.del(dev).catch(() => {});
    return state();
  }
  async function refresh() { // at app start: keep this device's record in step with the browser; never prompts
    try {
      if (!available() || !supported() || !store || !dev) return;
      const sub = Notification.permission === 'granted' ? await current() : null;
      const all = await store.list(), mine = own(all, dev) ? all[dev] : null;
      if (sub) { // stored again when the endpoint or either key differs (a browser may renew them)
        const ms = own(mine, 'sub') ? mine.sub : null, mk = own(ms, 'keys') ? ms.keys : null, j = sub.toJSON(), k = (j && j.keys) || {};
        if (!(own(ms, 'endpoint') && ms.endpoint === sub.endpoint && own(mk, 'p256dh') && mk.p256dh === k.p256dh && own(mk, 'auth') && mk.auth === k.auth)) await save(sub);
      } else if (mine && !(Notification.permission === 'granted' && await current())) await store.del(dev); // asked again: an enable() since this started may have saved it
    } catch (e) {}
  }
  const okHost = ep => { let u; try { u = new URL(ep); } catch (e) { return false; } if (u.protocol !== 'https:' || u.port || u.username || u.password) return false; const h = u.hostname.toLowerCase(); return HOSTS.includes(h) || SUFFIXES.some(x => h.endsWith(x) && h.length > x.length); };
  // one record from the shared log, or null: data there is written by anyone with the link
  function okSub(rec) {
    if (!own(rec, 'sub')) return null;
    const s = rec.sub;
    if (!own(s, 'endpoint') || !own(s, 'keys') || typeof s.endpoint !== 'string' || s.endpoint.length > EP || !okHost(s.endpoint)) return null;
    const k = s.keys; if (!own(k, 'p256dh') || !own(k, 'auth') || typeof k.p256dh !== 'string' || typeof k.auth !== 'string') return null;
    const p = bytes(k.p256dh), a = bytes(k.auth);
    return p && p.length === 65 && p[0] === 4 && a && a.length === 16 ? { endpoint: s.endpoint, keys: { p256dh: k.p256dh, auth: k.auth } } : null;
  }
  function okMsg(m) {
    if (!m || typeof m !== 'object' || typeof m.title !== 'string') return null;
    const title = cut(clean(m.title).trim(), LIM.title); if (!title) return null;
    const out = { title, body: typeof m.body === 'string' ? cut(clean(m.body), LIM.body) : '' };
    const tag = typeof m.tag === 'string' ? cut(clean(m.tag), LIM.tag) : ''; if (tag) out.tag = tag;
    if (typeof m.hash === 'string' && m.hash[0] === '#' && m.hash.length <= LIM.hash) out.hash = m.hash;
    return out;
  }
  async function send(m) {
    if (!available() || !store || typeof fetch !== 'function') return;
    const msg = okMsg(m); if (!msg) return;
    const all = await store.list(); if (!all || typeof all !== 'object') return;
    const ids = [], subs = [];
    for (const id of Object.keys(all)) {
      if (id === dev || !ID.test(id)) continue;
      const s = okSub(all[id]); if (!s) continue;
      ids.push(id); subs.push(s);
      if (subs.length === MAX) break;
    }
    let body = JSON.stringify({ subs, msg });
    while (subs.length > 1 && new Blob([body]).size > BODY) { subs.pop(); ids.pop(); body = JSON.stringify({ subs, msg }); }
    if (!subs.length || new Blob([body]).size > BODY) return;
    // text/plain keeps it a simple request (no preflight), which a keepalive request is most likely to survive; the Worker reads JSON either way
    const r = await fetch(PUSH.url.replace(/\/+$/, '') + '/notify', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body });
    if (!r.ok) return;
    const out = await r.json(), res = own(out, 'results') && Array.isArray(out.results) ? out.results : [];
    const gone = ids.map((id, i) => [id, subs[i].endpoint, res[i] && res[i].status]).filter(g => g[2] === 404 || g[2] === 410); // only these: -1 and 0 say nothing about the device
    if (!gone.length) return;
    const now = await store.list(); // read again: the other device may have replaced its record since
    for (const [id, ep] of gone) { const rec = own(now, id) ? now[id] : null; if (own(rec, 'sub') && own(rec.sub, 'endpoint') && rec.sub.endpoint === ep) Promise.resolve().then(() => store.del(id)).catch(() => {}); }
  }
  function notify(m) { try { send(m).catch(() => {}); } catch (e) {} } // fire and forget: never throws, never waits
  return { available, init, state, enable, disable, refresh, notify };
})();
