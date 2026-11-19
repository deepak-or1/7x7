// Web Push in the service worker: shows the notification the push Worker (push/worker.js) sent, and opens or focuses the
// app on a tap. Pulled into the site's service worker with importScripts('sw-push.js'); it only adds listeners and defines
// nothing global. A tap on a notification while the app is open posts { type: 'sbs-open', hash } to that window
// (navigator.serviceWorker 'message'); otherwise the app opens at this service worker's scope plus the hash.
(() => {
  const LIM = { title: 80, body: 240, tag: 64, hash: 200 }, ICON = 'icons/icon-192.png';
  const cut = (s, n) => { let o = ''; for (const ch of s) { if (o.length + ch.length > n) break; o += ch; } return o; };
  const okHash = h => (typeof h === 'string' && h[0] === '#' && h.length <= LIM.hash ? h : '');
  const read = data => { try { const m = data ? data.json() : null; return m && typeof m === 'object' && !Array.isArray(m) ? m : null; } catch (e) { return null; } };
  self.addEventListener('push', e => {
    const m = read(e.data) || {}; // a browser requires a visible notification for every push, so anything unreadable still shows one
    const title = (typeof m.title === 'string' && cut(m.title.trim(), LIM.title)) || 'Seven by Seven';
    const body = (typeof m.body === 'string' && cut(m.body, LIM.body)) || 'Something new in the logbook';
    const tag = typeof m.tag === 'string' ? cut(m.tag, LIM.tag) : '';
    e.waitUntil(self.registration.showNotification(title, { body, tag, renotify: false, icon: ICON, badge: ICON, data: { hash: okHash(m.hash) } }));
  });
  self.addEventListener('notificationclick', e => {
    e.notification.close();
    const d = e.notification.data, hash = okHash(d && d.hash), scope = self.registration.scope;
    e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const w = list.find(c => c.url.startsWith(scope) && c.focused) || list.find(c => c.url.startsWith(scope));
      if (w) { w.postMessage({ type: 'sbs-open', hash }); return w.focus().catch(() => {}); }
      return self.clients.openWindow(scope + hash); // only the scope and a checked hash, never a URL from the payload
    }));
  });
})();
