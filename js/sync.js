// Shared logbook for the hosted site. One JSON record per secret key at logs/<key> in a Firebase Realtime
// Database, read live over its REST streaming endpoint (EventSource) and written with PUT. No SDK: the
// database rules allow reads and writes only below a key, never a listing, and the key is a long random
// string carried in the link people bookmark. Config: js/sync-config.js.
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
  return { ready, connect, url };
})();
