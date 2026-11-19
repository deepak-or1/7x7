// Not losing it: recently deleted (spots and photos wait 30 days, with an undo), automatic copies of the log on this device, and
// Download everything (the log and every photo in one .zip).
//
// A deleted spot stays in the log's spots, marked: spots[id].trashed = { at, by? }. app.js keeps only live spots in state.spots
// (adopt() hands the marked ones to Safe.adopt, which moves them to state.trash = { id: { spot, at, by } }; persist() puts them
// back through Safe.out), so every list, dot, count and search sees live spots only. Inside the spot is where an older copy of
// the app keeps it: its persist() writes back every field of a spot it read (only _xy is dropped), while a field beside hoods,
// want and spots would be dropped by the next save from it. A removed photo moves nothing: logs/<key>-pd/<owner>/<id> = { at, by? }
// (Sync.deleted) lists it, and photos.js leaves listed photos out wherever photos show or count. After 30 days a device that may
// write deletes both for good (the spot with its photos; the photo, its thumb, its place in the order and its entry).
// Copies of the log live in IndexedDB (sbs-safe, store snaps, one record per copy, per log): once a day at open when the log has
// changed, and before an import, a restore or a switch to another log (snap(label), for any later bulk change). The last 14 daily
// copies, one a week for the 8 weeks before them, and the last 10 labelled ones are kept. No IndexedDB: no copies, nothing else
// changes. Everything read back (the log, the index, a copy) is checked before it is used.
// init(o): o = { state, persist, adopt, refresh, go, setHead, toast, esc, who, cleanName, ownerKey, ownerNames, kinds, logKey,
// photoApi, fetchLog, exportBody, niceDate }; see app.js for each.
window.Safe = (() => {
  const DAYS = 30, DAY = 864e5, KEEP_D = 14, KEEP_W = 8, KEEP_X = 10, PD_MAX = 400;
  const SAFE_KEY = /^[^.$#[\]/\x00-\x1f\x7f]{1,160}$/; // a database key: what the photo owner and id keys may be
  const IMG = /^data:image\/(jpeg|png|webp);base64,/;
  let A = null, panel = null;
  const later = (ms, v) => new Promise(r => setTimeout(() => r(v), ms));
  const okAt = s => typeof s === 'string' && s.length <= 40 && isFinite(Date.parse(s)) ? s : null;
  const daysLeft = at => Math.max(0, Math.ceil((Date.parse(at) + DAYS * DAY - Date.now()) / DAY));
  const leftTxt = at => { const d = daysLeft(at); return d <= 1 ? 'goes for good today' : d + ' days left'; };
  const old = (at, now) => now - Date.parse(at) > DAYS * DAY;
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  const S = () => A.state;
  const logId = () => { const s = S().store; return s === 'sync' ? (A.logKey() || null) : s === 'local' || s === 'db' ? s : null; };

  function init(o) {
    A = o; panel = document.getElementById('panel'); if (!S().trash) S().trash = {};
    if (window.Photos) Photos.init({ hidden, onDelete: hidePhoto });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && booted) { daily(); pdLoad(); } }); // a home-screen app comes back without reloading
    panel.addEventListener('keydown', e => { if (e.key === 'Escape' && ask && (S().view === 'trash' || S().view === 'backups')) { e.stopPropagation(); ask = null; A.render(); } }); // Escape closes a confirmation, not the page
  }

  // ---------- the log in and out ----------
  // adopt: after app.js has cloned a record's spots. A record from the database replaces the trash; a body without updatedAt (an
  // import) keeps it. A spot that is live again (restored here or elsewhere) is never in the trash.
  function adopt(body) {
    const st = S(), prev = st.trash || {}; st.trash = body && body.updatedAt ? {} : prev;
    for (const id of Object.keys(st.spots)) {
      const sp = st.spots[id]; if (!sp || typeof sp !== 'object' || sp.trashed == null) continue;
      const { trashed: t, _xy, ...spot } = sp, m = t && typeof t === 'object' ? t : {};
      st.trash[id] = { spot, at: okAt(m.at) || new Date().toISOString(), by: A.cleanName(m.by) }; // an unreadable date: its 30 days start now
      delete st.spots[id];
    }
    for (const id of Object.keys(st.trash)) if (Object.hasOwn(st.spots, id)) delete st.trash[id];
    if (body && body.updatedAt) seenAt = body.updatedAt;
  }
  let seenAt = null; // updatedAt of the record this device last read or wrote: a purge goes ahead only while the database still holds it
  function out(payload) { // persist(): the trash rides back inside spots
    const t = S().trash || {};
    for (const id in t) if (!Object.hasOwn(payload.spots, id)) payload.spots[id] = Object.assign({}, t[id].spot, { trashed: t[id].by ? { at: t[id].at, by: t[id].by } : { at: t[id].at } });
    seenAt = payload.updatedAt;
  }
  function body() { // the whole log as persist() writes it (no updatedAt)
    const st = S(), spots = {}; for (const id in st.spots) { const { _xy, ...rest } = st.spots[id]; spots[id] = rest; }
    const p = { hoods: st.done, want: st.want, spots }; out(Object.assign({ updatedAt: seenAt }, p)); return JSON.parse(JSON.stringify(p));
  }
  const objOf = v => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  function counts(b) { const h = objOf(b.hoods), w = objOf(b.want), sp = objOf(b.spots); return { walked: Object.keys(h).length, spots: Object.keys(sp).filter(id => !(sp[id] && sp[id].trashed != null)).length, want: Object.keys(w).filter(k => !Object.hasOwn(h, k)).length }; }

  // ---------- spots: delete, undo, restore, delete forever ----------
  async function trashSpot(id) {
    const st = S(), sp = st.spots[id]; if (!sp) return;
    const { _xy, ...spot } = sp, by = A.who();
    st.trash[id] = { spot, at: new Date().toISOString(), by };
    delete st.spots[id];
    A.go({ hood: sp.hood, sub: sp.sub }, { replace: true, fly: false }); A.redraw();
    const ok = await A.persist();
    if (ok === false) return; // the save line says it could not save; the next save carries the delete
    A.toast('Removed ' + String(sp.name ?? ''), 6000, { label: 'Undo', run: () => restoreSpot(id, true) });
  }
  async function restoreSpot(id, back) {
    const st = S(), t = st.trash[id]; if (!t || !st.canWrite) return;
    delete st.trash[id]; if (!Object.hasOwn(st.spots, id)) st.spots[id] = JSON.parse(JSON.stringify(t.spot)); // the same id: its photos come back with it
    const ok = A.persist();
    if (back) A.go({ spot: id }, { replace: true }); else A.refresh();
    if (await ok !== false) A.toast(String(t.spot.name ?? 'The spot') + ' is back');
  }
  async function spotForever(id) {
    const st = S(), t = st.trash[id]; if (!t || !st.canWrite) return;
    delete st.trash[id]; ask = null; A.render();
    if (await A.persist() === false) { if (!Object.hasOwn(st.spots, id)) st.trash[id] = t; A.render(); return; }
    dropPhotos(id); A.toast('Deleted for good');
  }
  function dropPhotos(id) { // a spot gone for good: its photos and their entries, best effort
    const st = S(); if (Object.hasOwn(st.spots, id) || Object.hasOwn(st.trash, id) || st.store !== 'sync') return;
    const o = A.ownerKey.spot(id);
    if (window.Photos && A.photoApi()) { try { Photos.removeAll(o); } catch (e) {} }
    const d = dapi(); if (d) d.delOwner(o).catch(() => {});
    const p = pdFor(); if (p && Object.hasOwn(p.map, o)) { p.ver++; delete p.map[o]; pdSave(); }
  }

  // ---------- photos: the removed-photos index ----------
  let pd = { key: null, map: {}, ver: 0 }, dapiFor = null;
  const dapi = () => { const k = A.logKey(); if (S().store !== 'sync' || !k || !window.Sync || !Sync.deleted) return null; if (!dapiFor || dapiFor.key !== k) dapiFor = { key: k, api: Sync.deleted(k) }; return dapiFor.api; };
  function cleanPd(raw) { // anyone with the link writes it: keys and fields checked, size capped
    const out = {}; let n = 0;
    for (const o of Object.keys(objOf(raw))) {
      if (!SAFE_KEY.test(o)) continue; const ids = objOf(raw[o]);
      for (const id of Object.keys(ids)) {
        if (!SAFE_KEY.test(id) || id.length > 64 || n >= PD_MAX) continue; const r = objOf(ids[id]);
        (out[o] || (out[o] = {}))[id] = { at: okAt(r.at) || new Date().toISOString(), by: A.cleanName(r.by) }; n++;
      }
    }
    return out;
  }
  function pdFor() {
    const k = A.logKey(); if (S().store !== 'sync' || !k) return null;
    if (pd.key !== k) { let c = null; try { c = JSON.parse(localStorage.getItem('sbs-pd-' + k)); } catch (e) {} pd = { key: k, map: cleanPd(c), ver: 0 }; } // the last list seen, so a hero never flashes a removed photo before the read lands
    return pd;
  }
  const pdSave = () => { try { localStorage.setItem('sbs-pd-' + pd.key, JSON.stringify(pd.map)); } catch (e) {} };
  function hidden(o, id) { const p = pdFor(); return !!(p && Object.hasOwn(p.map, o) && Object.hasOwn(p.map[o], id)); }
  const redrawOwner = o => { if (window.Photos && Photos.refresh) { try { Photos.refresh(o); } catch (e) {} } };
  function pdLoad() {
    const d = dapi(), p = pdFor(); if (!d || !p) return Promise.resolve();
    const ver = p.ver;
    return d.all().then(raw => {
      if (pdFor() !== p || p.ver !== ver) return; // a remove or restore here while it was read wins; the next read catches up
      const next = cleanPd(raw), owners = new Set([...Object.keys(p.map), ...Object.keys(next)]), was = JSON.stringify(p.map);
      p.map = next; pdSave();
      if (JSON.stringify(next) !== was) { owners.forEach(redrawOwner); if (S().view === 'trash') A.render(); else rootSoft(); }
    }, () => {});
  }
  const atRoot = () => !S().view && !S().loc.spot && !S().loc.sub && !S().loc.hood;
  const rootSoft = () => { const d = panel.querySelector('details.more'); if (atRoot() && !S().query && !S().quiz && !(d && d.open)) A.render(); }; // the Recently deleted entry follows, but an open Settings is never folded
  async function hidePhoto(o, id) { // the lightbox's Delete: listed, not deleted
    const d = dapi(), p = pdFor(); if (!d || !p || !S().canWrite) throw new Error('not available');
    const rec = { at: new Date().toISOString() }, by = A.who(); if (by) rec.by = by;
    p.ver++; (p.map[o] || (p.map[o] = {}))[id] = { at: rec.at, by }; redrawOwner(o);
    try { await d.put(o, id, rec); } catch (e) { p.ver++; if (p.map[o]) { delete p.map[o][id]; if (!Object.keys(p.map[o]).length) delete p.map[o]; } redrawOwner(o); throw e; }
    pdSave(); rootSoft();
    A.toast('Photo removed', 6000, { label: 'Undo', run: () => restorePhoto(o, id) });
  }
  async function restorePhoto(o, id) {
    const d = dapi(), p = pdFor(); if (!d || !p || !hidden(o, id)) return;
    const rec = p.map[o][id]; p.ver++; delete p.map[o][id]; if (!Object.keys(p.map[o]).length) delete p.map[o]; redrawOwner(o); A.render(); // back in its old place: the order record never changed
    try { await d.del(o, id); pdSave(); A.toast('Photo is back'); }
    catch (e) { p.ver++; (p.map[o] || (p.map[o] = {}))[id] = rec; redrawOwner(o); A.render(); A.toast('Could not restore the photo. Try again.', 3000); }
  }
  async function photoForever(o, id) {
    const d = dapi(), p = pdFor(); if (!d || !p || !hidden(o, id) || !S().canWrite) return;
    ask = null;
    try { if (window.Photos && A.photoApi()) { await Photos.list(o).catch(() => {}); await Photos.remove(o, id); } await d.del(o, id); } // the list first, so its order record is known and loses the id // the photo, its thumb and its place in the order, then the entry
    catch (e) { A.toast('Could not delete the photo. Try again.', 3000); A.render(); return; }
    p.ver++; if (p.map[o]) { delete p.map[o][id]; if (!Object.keys(p.map[o]).length) delete p.map[o]; } pdSave(); A.render(); A.toast('Deleted for good');
  }
  const pdCount = () => { const p = pdFor(); return p ? Object.values(p.map).reduce((n, ids) => n + Object.keys(ids).length, 0) : 0; };

  // ---------- the purge: older than 30 days, on a device that may write ----------
  let purging = false, purgedAt = 0;
  async function purge() {
    const st = S(); if (purging || !st.canWrite) return; purging = true; purgedAt = Date.now();
    try {
      const now = Date.now(); let ids = Object.keys(st.trash).filter(id => old(st.trash[id].at, now));
      if (ids.length && st.store === 'sync') { // only while the database still holds the record this device read, and only what it still has old in its trash
        const rec = await Promise.resolve(A.fetchLog()).catch(() => null), sp = rec && objOf(rec.spots);
        ids = !rec || rec.updatedAt !== seenAt ? [] : ids.filter(id => Object.hasOwn(sp, id) && sp[id] && sp[id].trashed && okAt(sp[id].trashed.at) && old(sp[id].trashed.at, now));
      }
      ids = ids.filter(id => Object.hasOwn(st.trash, id) && !Object.hasOwn(st.spots, id) && old(st.trash[id].at, now)); // still in the trash after the wait (a restore meanwhile wins)
      if (ids.length && st.canWrite) {
        const gone = {}; ids.forEach(id => { gone[id] = st.trash[id]; delete st.trash[id]; });
        if (await A.persist() === false) { for (const id in gone) if (!Object.hasOwn(st.spots, id)) st.trash[id] = gone[id]; }
        else ids.forEach(dropPhotos);
        if (st.view === 'trash') A.render(); else rootSoft();
      }
      await purgePhotos(now);
    } catch (e) { console.warn('purge failed', e); }
    purging = false;
  }
  async function purgePhotos(now) {
    const d = dapi(), p = pdFor(); if (!d || !p || !S().canWrite || !window.Photos || !A.photoApi()) return;
    let done = 0;
    for (const o of Object.keys(p.map)) for (const id of Object.keys(p.map[o])) {
      if (!old(p.map[o][id].at, now)) continue;
      try {
        const cur = await d.get(o, id), at = cur && okAt(cur.at); // read again: restored on another phone meanwhile, it stays
        if (cur && !(at && old(at, now))) continue;
        if (cur) { await Photos.list(o).catch(() => {}); await Photos.remove(o, id); await d.del(o, id); }
        if (p.map[o]) { p.ver++; delete p.map[o][id]; if (!Object.keys(p.map[o]).length) delete p.map[o]; done++; }
      } catch (e) {}
    }
    if (done) { pdSave(); if (S().view === 'trash') A.render(); }
  }

  // ---------- copies of the log in IndexedDB ----------
  let idbOk = null; // null: not known yet; true / false once opened
  const db = (() => {
    let p = null;
    const open = () => p || (p = new Promise(res => {
      setTimeout(() => res(null), 4000); // a browser whose open never answers
      try { if (!window.indexedDB) { res(null); return; } const r = indexedDB.open('sbs-safe', 1); r.onupgradeneeded = () => { const s = r.result.createObjectStore('snaps', { keyPath: 'id', autoIncrement: true }); s.createIndex('log', 'log'); }; r.onsuccess = () => { const d = r.result; d.onversionchange = () => { d.close(); p = null; }; res(d); }; r.onerror = r.onblocked = () => res(null); } catch (e) { res(null); }
    }).then(d => { idbOk = !!d; return d; }));
    const tx = (mode, fn) => open().then(d => d && new Promise(res => { try { const t = d.transaction('snaps', mode), o = fn(t.objectStore('snaps')); t.oncomplete = () => res(o ? o() : true); t.onerror = t.onabort = () => res(null); } catch (e) { res(null); } }));
    return {
      list: log => tx('readonly', s => { const r = s.index('log').getAll(log); return () => r.result; }),
      add: rec => tx('readwrite', s => { s.add(rec); }),
      del: ids => tx('readwrite', s => { ids.forEach(id => s.delete(id)); }),
    };
  })();
  function okSnap(r, log) { // a copy that cannot be read is left out, never used
    try {
      if (!r || typeof r !== 'object' || r.log !== log || typeof r.id !== 'number' || !okAt(r.t) || (r.kind !== 'day' && r.kind !== 'extra')) return null;
      const d = r.data; if (!d || typeof d !== 'object' || Array.isArray(d)) return null;
      for (const k of ['hoods', 'want', 'spots']) if (d[k] != null && (typeof d[k] !== 'object' || Array.isArray(d[k]))) return null;
      return { id: r.id, t: r.t, kind: r.kind, label: typeof r.label === 'string' ? r.label.slice(0, 60) : '', sig: typeof r.sig === 'string' ? r.sig : '', n: counts(d), data: d };
    } catch (e) { return null; }
  }
  async function snaps(log) { const all = await db.list(log); return Array.isArray(all) ? all.map(r => okSnap(r, log)).filter(Boolean).sort((a, b) => b.t.localeCompare(a.t) || b.id - a.id) : null; }
  const sigOf = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36) + '.' + s.length; };
  const localDay = t => { const d = new Date(t); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
  const weekOf = t => { const d = new Date(t); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return localDay(d); }; // the Monday
  function keepers(list) { // newest first: 14 daily, then the newest of each of the 8 weeks before them, and 10 labelled
    const days = list.filter(r => r.kind === 'day'), keep = new Set(days.slice(0, KEEP_D).map(r => r.id)), weeks = new Set();
    for (const r of days.slice(KEEP_D)) { const w = weekOf(r.t); if (weeks.has(w) || weeks.size >= KEEP_W) continue; weeks.add(w); keep.add(r.id); }
    list.filter(r => r.kind === 'extra').slice(0, KEEP_X).forEach(r => keep.add(r.id));
    return keep;
  }
  async function prune(log) {
    const raw = await db.list(log); if (!Array.isArray(raw)) return;
    const good = raw.map(r => okSnap(r, log)).filter(Boolean).sort((a, b) => b.t.localeCompare(a.t) || b.id - a.id), keep = keepers(good);
    const drop = good.filter(r => !keep.has(r.id)).map(r => r.id); if (drop.length) await db.del(drop);
  }
  async function save(kind, label) {
    const log = logId(); if (!log) return false;
    const data = body(), sig = sigOf(JSON.stringify(data)), t = new Date().toISOString();
    if (await db.add({ log, t, kind, label: label || '', sig, data }) !== true) return false;
    list = null; await prune(log); if (S().view === 'backups') A.render();
    return true;
  }
  let dailyBusy = false;
  async function daily() { // once a day, only when the log changed since the last copy, never an empty log
    const log = logId(); if (!log || dailyBusy) return; dailyBusy = true;
    try {
      const all = await snaps(log); if (!all) return;
      const data = body(), n = counts(data); if (!n.walked && !n.spots && !n.want && !Object.keys(S().trash).length) return;
      const lastDay = all.find(r => r.kind === 'day'); if (lastDay && localDay(lastDay.t) === localDay(Date.now())) return;
      if (all.length && all[0].sig === sigOf(JSON.stringify(data))) return;
      await save('day', '');
    } catch (e) {} finally { dailyBusy = false; }
  }
  // before a bulk change: a labelled copy, waited for at most 1.5 s (never in the way). Resolves true once it is saved
  function snap(label) { return Promise.race([save('extra', label).catch(() => false), later(1500, false)]); }

  // ---------- boot: once the log this device shows has arrived from where it lives ----------
  let booted = null;
  function loaded() {
    const id = logId(); if (!id || booted === id) return; booted = id;
    pdLoad();
    setTimeout(() => { daily(); purge(); }, 800);
  }

  // ---------- views ----------
  let ask = null, list = null, listFor = null, pre = null; // ask: the item whose confirmation is open; list: the copies last read; pre: the log before the last restore
  function back() { A.go(S().loc, { replace: true, fly: false }); const d = panel.querySelector('details.more'); if (d) { d.open = true; d.scrollIntoView({ block: 'nearest' }); } }
  const head = title => A.setHead({ eyebrow: 'Settings', title, onBack: back, tools: [] });
  const has = v => v === 'trash' || v === 'backups';
  function render(v) { if (v === 'trash') trashView(); else backupView(); }
  function where(o, names) { // what a photo belonged to
    if (names.has(o)) return { name: names.get(o), gone: false };
    for (const id in S().trash) if (A.ownerKey.spot(id) === o) return { name: S().trash[id].spot.name, gone: true };
    return null;
  }
  const btns = (k, what) => ask === k ? `<div class="actions safe-ask"><span>${what}</span><button type="button" class="btn sm safe-bad safe-yes" data-act="yes" data-k="${A.esc(k)}">Delete forever</button><button type="button" class="btn sm quiet" data-act="no" data-k="${A.esc(k)}">Keep</button></div>`
    : `<div class="actions"><button type="button" class="btn sm" data-act="restore" data-k="${A.esc(k)}">Restore</button><button type="button" class="btn sm quiet safe-bad" data-act="forever" data-k="${A.esc(k)}">Delete forever</button></div>`;
  function trashView() {
    head('Recently deleted');
    const st = S(), esc = A.esc, w = st.canWrite, p = pdFor();
    if (w && Date.now() - purgedAt > 60000) purge(); // on open; not again on every redraw of the list
    const spots = Object.keys(st.trash).sort((a, b) => st.trash[b].at.localeCompare(st.trash[a].at));
    const photos = []; if (p) for (const o in p.map) for (const id in p.map[o]) photos.push({ o, id, at: p.map[o][id].at, by: p.map[o][id].by });
    photos.sort((a, b) => b.at.localeCompare(a.at)); const names = photos.length ? new Map(A.ownerNames()) : null;
    const by = n => n ? 'removed by ' + n : 'removed';
    panel.innerHTML = `<p class="lead">Removed spots and photos wait here for ${DAYS} days, then go for good.</p>`
      + (spots.length ? `<h3>Spots <span class="n">${spots.length}</span></h3><ul class="rows safe-list">${spots.map(id => {
        const t = st.trash[id], sp = t.spot, k = A.kinds[sp.kind] || A.kinds.other;
        return `<li><div class="row"><span class="ic" style="--c:${k.c}"></span><span class="nm">${esc(sp.name)}<small>${esc([k.label + (sp.status === 'want' ? ', want to go' : ''), sp.sub || sp.hood, by(t.by), leftTxt(t.at)].filter(Boolean).join(' · '))}</small></span></div>${w ? btns('s:' + id, 'This also removes its photos, and cannot be undone.') : ''}</li>`;
      }).join('')}</ul>` : '')
      + (photos.length ? `<h3>Photos <span class="n">${photos.length}</span></h3><ul class="rows safe-list">${photos.map(x => {
        const wh = where(x.o, names), of = wh ? 'Photo of ' + wh.name + (wh.gone ? ' (removed)' : '') : 'Photo';
        return `<li><div class="row"><span class="safe-th"><img alt="" data-o="${esc(x.o)}" data-id="${esc(x.id)}"></span><span class="nm">${esc(of)}<small>${esc([by(x.by), leftTxt(x.at)].join(' · '))}</small></span></div>${w ? btns('p:' + x.o + '/' + x.id, 'The photo goes for good, and this cannot be undone.') : ''}</li>`;
      }).join('')}</ul>` : '')
      + (!spots.length && !photos.length ? '<p class="empty">Nothing here.</p>' : '')
      + (w ? '' : '<p class="empty safe-ro">This log is read-only here.</p>');
    panel.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => act(b.dataset.act, b.dataset.k)));
    thumbs();
    const f = ask && panel.querySelector('.safe-ask [data-act="no"]'); if (f) f.focus({ preventScroll: true });
  }
  function act(a, k) {
    const [kind, rest] = [k.slice(0, 2), k.slice(2)], j = rest.lastIndexOf('/'), o = rest.slice(0, j), id = rest.slice(j + 1);
    if (a === 'forever') { ask = k; A.render(); return; }
    if (a === 'no') { ask = null; A.render(); const b = [...panel.querySelectorAll('[data-act="forever"]')].find(x => x.dataset.k === k); if (b) b.focus({ preventScroll: true }); return; }
    if (kind === 's:') { if (a === 'restore') restoreSpot(rest, false); else if (a === 'yes') spotForever(rest); }
    if (kind === 'p:') { if (a === 'restore') restorePhoto(o, id); else if (a === 'yes') photoForever(o, id); }
  }
  const thumbCache = new Map();
  function thumbs() { // the removed photos' thumbs, read once each (an older photo without a thumb: its full copy)
    const api = A.photoApi(); if (!api) return;
    panel.querySelectorAll('.safe-th img[data-o]').forEach(img => {
      const k = img.dataset.o + '/' + img.dataset.id, put = d => { if (typeof d === 'string' && IMG.test(d) && img.isConnected) img.src = d; };
      if (thumbCache.has(k)) { thumbCache.get(k).then(put); return; }
      const p = api.thumb(img.dataset.o, img.dataset.id).then(t => t && t.d ? t : api.get(img.dataset.o, img.dataset.id)).then(r => r && r.d, () => null);
      thumbCache.set(k, p); p.then(put);
    });
  }
  const when = t => { const d = new Date(t), today = localDay(Date.now()) === localDay(t); return (today ? 'Today' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' })) + ', ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); };
  const nLine = n => `${n.walked} walked · ${plural(n.spots, 'spot', 'spots')} · ${n.want} want to go`;
  const change = (label, a, b) => a === b ? `${label} ${a}, no change` : `${label} ${a} → ${b}`;
  function backupView() {
    head('Backups');
    const st = S(), esc = A.esc, log = logId(), w = st.canWrite;
    if (listFor !== log) { list = null; listFor = log; }
    if (list === null && idbOk !== false && log) snaps(log).then(l => { if (listFor !== log) return; list = l || []; if (S().view === 'backups') A.render(); });
    const lead = `<p class="lead">This device keeps a copy of the log once a day when it has changed, and before an import, a restore or a switch to another log. Photos are not in it.</p>`;
    let html;
    if (idbOk === false || !log) html = '<p class="empty">Backups are not available on this device.</p>';
    else if (list === null) html = '<p class="empty">Looking for copies…</p>';
    else if (!list.length) html = '<p class="empty">No copies yet. The first is made the next time the app opens with something in the log.</p>';
    else {
      const cur = counts(body());
      html = `<ul class="rows safe-list">${list.map(r => `<li><div class="row"><span class="ic sq" style="--c:var(--line-2)"></span><span class="nm">${esc(when(r.t))}<small>${esc(nLine(r.n) + (r.label ? ' · ' + r.label : ''))}</small></span><span class="rt">${w && ask !== 'b:' + r.id ? `<button type="button" class="btn sm" data-snap="${r.id}">Restore</button>` : ''}</span></div>
        ${ask === 'b:' + r.id ? `<div class="safe-ask safe-q"><p>Restore the copy from ${esc(when(r.t))}?</p><p><b>${esc([change('Places walked', cur.walked, r.n.walked), change('Spots', cur.spots, r.n.spots), change('Want to go', cur.want, r.n.want)].join(' · '))}</b></p><p>${st.store === 'sync' ? 'It changes the log for everyone who has the link. ' : ''}The log as it is now is copied here first, so this can be undone.</p><div class="actions"><button type="button" class="btn sm primary" data-yes="${r.id}">Restore</button><button type="button" class="btn sm quiet" data-no="${r.id}">Cancel</button></div></div>` : ''}</li>`).join('')}</ul>`
        + (w ? '' : '<p class="empty safe-ro">This log is read-only here, so a copy cannot be restored.</p>');
    }
    panel.innerHTML = lead + html;
    panel.querySelectorAll('[data-snap]').forEach(b => b.addEventListener('click', () => { ask = 'b:' + b.dataset.snap; A.render(); }));
    panel.querySelectorAll('[data-no]').forEach(b => b.addEventListener('click', () => { const id = b.dataset.no; ask = null; A.render(); const x = panel.querySelector(`[data-snap="${id}"]`); if (x) x.focus({ preventScroll: true }); }));
    panel.querySelectorAll('[data-yes]').forEach(b => b.addEventListener('click', () => restoreSnap(+b.dataset.yes)));
    const f = ask && panel.querySelector('.safe-ask [data-no]'); if (f) f.focus({ preventScroll: true });
  }
  async function restoreSnap(id) {
    const st = S(), r = list && list.find(x => x.id === id); ask = null; if (!r || !st.canWrite) { A.render(); return; }
    const before = body(); pre = before; // the toast's Undo works even where the copy below could not be saved
    await snap('Before restoring a backup');
    put(r.data);
    if (await A.persist() !== false) A.toast('Backup restored', 8000, { label: 'Undo', run: () => { if (pre === before && S().canWrite) { put(before); A.persist(); A.toast('Restore undone'); } } });
  }
  function put(data) { A.adopt(Object.assign(JSON.parse(JSON.stringify(data)), { updatedAt: new Date().toISOString() })); A.refresh(); }

  // ---------- Settings: the entries and Download everything ----------
  let dl = null; // { text, run: still going, cancel }
  const dlOK = () => !(window.claude && window.claude.use); // the artifact host cannot take a file download
  const dlBtn = () => dlOK() ? `<button type="button" class="btn sm" id="safe-dl-btn" ${dl && dl.run ? 'disabled' : ''}>Download everything</button>` : '';
  const line = () => dl ? `<p class="safe-dl" id="safe-dl" role="status" aria-live="polite"><span>${A.esc(dl.text)}</span>${dl.run ? '<button type="button" class="act" id="safe-dl-x">Cancel</button>' : ''}</p>` : '';
  function settings() {
    const n = Object.keys(S().trash).length, np = pdCount(), parts = [n ? plural(n, 'spot', 'spots') : '', np ? plural(np, 'photo', 'photos') : ''].filter(Boolean);
    return line()
      + `<ul class="rows safe-links">${n + np ? `<li><button type="button" class="row" data-view="trash"><span class="ic sq" style="--c:var(--bad)"></span><span class="nm">Recently deleted<small>${A.esc(parts.join(' and '))}, kept ${DAYS} days</small></span><span class="rt">${n + np}<span class="chev"></span></span></button></li>` : ''}
        <li><button type="button" class="row" data-view="backups"><span class="ic sq" style="--c:var(--line-2)"></span><span class="nm">Backups<small>Copies of the log on this device</small></span><span class="rt"><span class="chev"></span></span></button></li></ul>`;
  }
  function wire(root) {
    const b = root.querySelector('#safe-dl-btn'); if (b && !b._w) { b._w = 1; b.addEventListener('click', download); }
    const x = root.querySelector('#safe-dl-x'); if (x && !x._w) { x._w = 1; x.addEventListener('click', () => { if (dl && dl.run) { dl.cancel = true; x.disabled = true; } }); }
  }
  function status(text, run) {
    dl = Object.assign(dl || {}, { text, run });
    const el = document.getElementById('safe-dl');
    if (el) { el.querySelector('span').textContent = text; const x = el.querySelector('#safe-dl-x'); if (x && !run) x.remove(); const bt = document.getElementById('safe-dl-btn'); if (bt) bt.disabled = !!run; }
    else { const bt = document.getElementById('safe-dl-btn'), row = bt && bt.closest('.actions'); if (row) { row.insertAdjacentHTML('afterend', line()); wire(row.parentNode); } } // the first line goes in under the buttons, Settings left open
  }
  const fileName = s => (String(s ?? '').replace(/[\\/:*?"<>|\x00-\x1f\x7f]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').slice(0, 60).trim() || 'Untitled');
  const bytesOf = d => { const b = atob(d.slice(d.indexOf(',') + 1)), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; };
  const okOrder = r => r && typeof r === 'object' && Array.isArray(r.ids) ? r.ids.filter(s => typeof s === 'string') : [];
  async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } })); }
  async function download() {
    if (dl && dl.run) return;
    dl = { text: 'Getting the log…', run: true, cancel: false }; const job = dl; status(job.text, true);
    const day = localDay(Date.now()), files = [{ name: `seven-by-seven-${day}.json`, data: new TextEncoder().encode(JSON.stringify(A.exportBody(), null, 1)) }];
    let got = 0, skipped = 0;
    try {
      const api = S().store === 'sync' ? A.photoApi() : null;
      if (api) {
        status('Finding photos…', true);
        const names = new Map(A.ownerNames()); let owners = null;
        try { owners = api.owners ? await api.owners() : null; } catch (e) {}
        owners = (Array.isArray(owners) ? owners : [...names.keys()]).filter(o => typeof o === 'string' && names.has(o)); // only what the log shows: a removed spot's photos stay out
        const plan = [], used = new Map();
        await pool(owners, 6, async o => {
          if (job.cancel) return;
          let ids = {}, ord = []; try { [ids, ord] = await Promise.all([api.ids(o), api.order ? api.order(o).then(okOrder, () => []) : []]); } catch (e) { return; }
          const rank = new Map(); ord.forEach((id, i) => rank.has(id) || rank.set(id, i)); const at = id => rank.has(id) ? rank.get(id) : Infinity;
          const list = Object.keys(ids || {}).filter(id => !hidden(o, id)).sort((a, b) => at(a) - at(b) || (a < b ? -1 : a > b ? 1 : 0)); // the order the hero shows
          if (list.length) plan.push({ o, list });
        });
        plan.sort((a, b) => String(names.get(a.o)).localeCompare(String(names.get(b.o))));
        for (const p of plan) { let f = fileName(names.get(p.o)), k = 2; while (used.has(f.toLowerCase())) f = fileName(names.get(p.o)) + ' (' + k++ + ')'; used.set(f.toLowerCase(), 1); p.folder = f; }
        const total = plan.reduce((n, p) => n + p.list.length, 0); let i = 0;
        for (const p of plan) for (let j = 0; j < p.list.length; j++) {
          if (job.cancel) break;
          status(`Photo ${++i} of ${total}`, true);
          try {
            const r = await api.get(p.o, p.list[j]), d = r && r.d, m = typeof d === 'string' && IMG.exec(d); if (!m) throw new Error('not a photo');
            files.push({ name: `photos/${p.folder}/${j + 1}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`, data: bytesOf(d) }); got++;
          } catch (e) { skipped++; }
        }
      }
      if (job.cancel) { status('Download cancelled.', false); return; }
      status('Making the file…', true); await later(30);
      const blob = zip(files), a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `seven-by-seven-${day}.zip`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      status(`Downloaded the log${api ? ' and ' + plural(got, 'photo', 'photos') : ''}.${skipped ? ` ${plural(skipped, 'photo', 'photos')} could not be loaded and ${skipped === 1 ? 'was' : 'were'} skipped.` : ''}`, false);
    } catch (e) { console.warn('download failed', e); status('Could not make the download. Try again.', false); }
  }
  // ---------- a store-only .zip: local headers, the central directory, its end record; names in UTF-8 (flag bit 11) ----------
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u) { let c = 0xFFFFFFFF; for (let i = 0; i < u.length; i++) c = CRC[(c ^ u[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function zip(files, now = new Date()) {
    const enc = new TextEncoder(), parts = [], cd = [], time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1), date = ((Math.max(1980, now.getFullYear()) - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    let off = 0, cdLen = 0;
    for (const f of files) {
      const nm = enc.encode(f.name), sz = f.data.length, crc = crc32(f.data), h = new DataView(new ArrayBuffer(30)), c = new DataView(new ArrayBuffer(46));
      [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, time, 2], [12, date, 2], [14, crc, 4], [18, sz, 4], [22, sz, 4], [26, nm.length, 2], [28, 0, 2]].forEach(([o, v, n]) => n === 4 ? h.setUint32(o, v, true) : h.setUint16(o, v, true));
      [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, time, 2], [14, date, 2], [16, crc, 4], [20, sz, 4], [24, sz, 4], [28, nm.length, 2], [30, 0, 2], [32, 0, 2], [34, 0, 2], [36, 0, 2], [38, 0, 4], [42, off, 4]].forEach(([o, v, n]) => n === 4 ? c.setUint32(o, v, true) : c.setUint16(o, v, true));
      parts.push(h, nm, f.data); cd.push(c, nm); off += 30 + nm.length + sz; cdLen += 46 + nm.length;
    }
    const e = new DataView(new ArrayBuffer(22));
    [[0, 0x06054b50, 4], [4, 0, 2], [6, 0, 2], [8, files.length, 2], [10, files.length, 2], [12, cdLen, 4], [16, off, 4], [20, 0, 2]].forEach(([o, v, n]) => n === 4 ? e.setUint32(o, v, true) : e.setUint16(o, v, true));
    return new Blob([...parts, ...cd, e], { type: 'application/zip' });
  }

  return { init, adopt, out, trashSpot, loaded, snap, has, render, settings, dlBtn, wire, hidden, zip, crc32, keepers, _t: { snaps, daily, purge, prune, db, pdFor, pdLoad } }; // zip, crc32, keepers, _t: tests
})();
