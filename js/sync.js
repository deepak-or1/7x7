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
      get: () => fetch(url(key)).then(r => r.ok ? r.json() : Promise.reject(err(r.status === 401 ? 'invalid_argument' : 'unavailable'))), // the record as the database holds it now
      close: () => { closed = true; if (es) es.close(); },
    };
  }
  // Photos sit in sibling records, so the log's live stream never carries them: logs/<key>-ph/<owner>/<photoId> is the
  // full photo (the source of truth) and logs/<key>-pt/<owner>/<photoId> its small thumb. A shallow read lists an
  // owner's ids ({id: true}) without their bytes.
  function photos(key) { // and logs/<key>-po/<owner> = { ids: [...] }, the order a writer chose
    const at = node => (...p) => `${base}/logs/${[key + node, ...p].map(encodeURIComponent).join('/')}.json`, ph = at('-ph'), pt = at('-pt'), po = at('-po');
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
      order: owner => get(po(owner)), // null when no order was chosen
      putOrder: (owner, rec) => put(po(owner), rec), // null removes it
      del: (owner, id) => del(ph(owner, id)).then(() => del(pt(owner, id)).catch(() => {})).then(() => {}), // the thumb after the photo: a thumb left behind is ignored, a photo left without one gets a new one
      delAll: owner => Promise.all([del(ph(owner)), del(pt(owner)).catch(() => {}), del(po(owner)).catch(() => {})]).then(() => {}),
    };
  }
  // Photos someone removed, kept 30 days before they go for good (js/safe.js): logs/<key>-pd/<owner>/<photoId> = { at, by? }.
  // The photo itself stays where it is (-ph, -pt, -po), so a restore moves no bytes; the app leaves listed ones out wherever photos show.
  function deleted(key) {
    const at = (...p) => `${base}/logs/${[key + '-pd', ...p].map(encodeURIComponent).join('/')}.json`;
    const req = (u, o) => fetch(u, o).then(r => { if (!r.ok) throw err(r.status === 401 || r.status === 403 ? 'invalid_argument' : 'unavailable', 'deleted-photos request failed ' + r.status); return r; });
    const get = u => req(u).then(r => r.json());
    return {
      all: () => get(at()), // { owner: { id: { at, by } } } or null
      get: (owner, id) => get(at(owner, id)),
      put: (owner, id, rec) => req(at(owner, id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rec) }).then(() => {}),
      del: (owner, id) => req(at(owner, id), { method: 'DELETE' }).then(() => {}),
      delOwner: owner => req(at(owner), { method: 'DELETE' }).then(() => {}),
    };
  }
  // The activity feed, another sibling: logs/<key>-ev/<eventId> = { t, by, d, k, id, name, hood, n }. push POSTs, so the database
  // makes the id (time-ordered by its clock); recent reads the last few by id; watch streams the newest one, so onChange() fires
  // when any device adds an event (photos included, which never touch the log). Anyone with the link can write it: app.js checks
  // every field it reads.
  function events(key) {
    const u = `${base}/logs/${encodeURIComponent(key + '-ev')}.json`, last = n => `?orderBy=${encodeURIComponent('"$key"')}&limitToLast=${n}`;
    const req = (q, o) => fetch(u + q, o).then(r => { if (!r.ok) throw err(r.status === 401 || r.status === 403 ? 'invalid_argument' : 'unavailable', 'feed request failed ' + r.status); return r.json(); });
    function watch(onChange) { // the same reopen-with-backoff as connect(); returns close
      let es = null, closed = false, retry = 0;
      function open() {
        if (closed) return;
        es = new EventSource(u + last(1));
        es.addEventListener('put', () => { retry = 0; onChange(); });
        es.addEventListener('patch', () => onChange());
        es.addEventListener('auth_revoked', () => es.close()); es.addEventListener('cancel', () => es.close());
        es.onerror = () => { if (es.readyState === EventSource.CLOSED && !closed) { es = null; setTimeout(open, Math.min(30000, 1000 * 2 ** retry++)); } };
      }
      open();
      return () => { closed = true; if (es) es.close(); };
    }
    return {
      push: ev => req('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ev) }).then(r => (r && typeof r.name === 'string' ? r.name : null)), // the new id
      recent: (limit = 30) => req(last(Math.max(1, Math.min(100, limit | 0)))).then(d => (d && typeof d === 'object' ? d : {})), // { id: event }, unordered
      watch,
    };
  }
  return { ready, connect, url, photos, deleted, events };
})();
