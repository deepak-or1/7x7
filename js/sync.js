// Shared logbook for the hosted site. One JSON record per secret key at logs/<key> in a Firebase Realtime
// Database, read live over its REST streaming endpoint (EventSource) and written with PUT. No SDK: the
// database rules allow reads and writes only below a key, never a listing, and the key is a long random
// string carried in the link people bookmark. Photos: Sync.photos(key), see js/photos.js. Config: js/sync-config.js.
window.Sync = (() => {
  const base = ((window.SYNC_CONFIG && window.SYNC_CONFIG.databaseURL) || '').replace(/\/+$/, '');
  const url = key => `${base}/logs/${encodeURIComponent(key)}.json`;
  const err = (code, message) => Object.assign(new Error(message || code), { code });
  function ready() { return /^https:\/\//.test(base) && typeof EventSource === 'function'; }
  // onData(record | null) fires with the whole record on connect and after every change made anywhere.
  function connect(key, onData, onError) {
    let es = null, closed = false, retry = 0;
    const refetch = () => fetch(url(key)).then(r => r.ok ? r.json() : Promise.reject(err(r.status === 401 ? 'invalid_argument' : 'unavailable'))).then(onData, e => onError && onError(e));
    function open() {
      if (closed) return;
      es = new EventSource(url(key));
      es.addEventListener('put', e => { retry = 0; try { const m = JSON.parse(e.data); if (m.path === '/') onData(m.data); else refetch(); } catch (x) {} });
      es.addEventListener('patch', () => refetch());
      es.addEventListener('auth_revoked', () => { es.close(); onError && onError(err('invalid_argument', 'access revoked')); });
      es.addEventListener('cancel', () => { es.close(); onError && onError(err('invalid_argument', 'permission denied')); });
      es.onerror = () => { // the browser reconnects on its own for transient drops; a closed stream (rules, offline for long) is reopened here with backoff
        if (es.readyState === EventSource.CLOSED && !closed) { es = null; setTimeout(open, Math.min(30000, 1000 * 2 ** retry++)); }
      };
    }
    open();
    return {
      set: payload => fetch(url(key), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        .then(r => { if (!r.ok) throw err(r.status === 401 || r.status === 403 ? 'invalid_argument' : 'unavailable', 'save failed ' + r.status); }),
      close: () => { closed = true; if (es) es.close(); },
    };
  }
  // Photos sit in sibling records, so the log's live stream never carries them: logs/<key>-ph/<owner>/<photoId> is the
  // full photo (the source of truth) and logs/<key>-pt/<owner>/<photoId> its small thumb. A shallow read lists an
  // owner's ids ({id: true}) without their bytes.
  function photos(key) {
    const at = node => (...p) => `${base}/logs/${[key + node, ...p].map(encodeURIComponent).join('/')}.json`, ph = at('-ph'), pt = at('-pt');
    const req = (u, o) => fetch(u, o).then(r => { if (!r.ok) throw err(r.status === 401 || r.status === 403 ? 'invalid_argument' : 'unavailable', 'photos request failed ' + r.status); return r; });
    const get = u => req(u).then(r => r.json()), obj = d => (d && typeof d === 'object' ? d : {});
    const put = (u, rec) => req(u, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rec) }).then(() => {});
    const del = u => req(u, { method: 'DELETE' });
    return {
      key,
      ids: owner => get(ph(owner) + '?shallow=true').then(d => Object.fromEntries(Object.keys(obj(d)).filter(k => d[k] != null).map(k => [k, true]))), // whatever shape comes back (an array for number-like ids), {id: true}
      thumbs: owner => get(pt(owner)).then(obj),
      get: (owner, id) => get(ph(owner, id)), // null once deleted
      thumb: (owner, id) => get(pt(owner, id)),
      put: (owner, id, rec) => put(ph(owner, id), rec),
      putThumb: (owner, id, rec) => put(pt(owner, id), rec),
      del: (owner, id) => del(ph(owner, id)).then(() => del(pt(owner, id)).catch(() => {})).then(() => {}), // the thumb after the photo: a thumb left behind is ignored, a photo left without one gets a new one
      delAll: owner => Promise.all([del(ph(owner)), del(pt(owner)).catch(() => {})]).then(() => {}),
    };
  }
  return { ready, connect, url, photos };
})();
