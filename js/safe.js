// Not losing it: a deleted spot or photo waits 30 days in Recently deleted, with an undo, before it goes for good.
//
// A deleted spot stays in the log's spots, marked: spots[id].trashed = { at, by? }. app.js keeps only live spots in state.spots
// (adopt() hands the marked ones to Safe.adopt, which moves them to state.trash = { id: { spot, at, by } }; persist() puts them
// back through Safe.out), so every list, dot, count and search sees live spots only. Inside the spot is where an older copy of
// the app keeps it: its persist() writes back every field of a spot it read (only _xy is dropped), while a field beside hoods,
// want and spots would be dropped by the next save from it. A removed photo moves nothing: logs/<key>-pd/<owner>/<id> = { at, by? }
// (Sync.deleted) lists it, and photos.js leaves listed photos out wherever photos show or count. After 30 days a device that may
// write deletes both for good (the spot with its photos; the photo, its thumb, its place in the order and its entry), but only
// 30 days after the later of the entry's date and the day this device first saw it (sbs-del-seen-<log>), so a wrong clock on
// either device can only make a purge later, never earlier. The single-file copy in a Claude artifact (store 'db') never purges
// by itself: there the record cannot be checked against the database first. Everything
// read back (the log, the index) is checked before it is used, and every map keyed by an id from them has no prototype and never
// takes a name Object has.
// init(o): o = { state, persist, go, setHead, toast, esc, who, cleanName, ownerKey, ownerNames, kinds, render, redraw, refresh,
// logKey, photoApi, fetchLog }; see app.js for each.
window.Safe = (() => {
  const DAYS = 30, DAY = 864e5, PD_MAX = 400, SEEN_MAX = 5000;
  const SAFE_KEY = /^[^.$#[\]/\x00-\x1f\x7f]{1,160}$/; // a database key: what the photo owner and id keys may be
  const IMG = /^data:image\/(jpeg|png|webp);base64,/;
  const BAD = new Set(['__proto__', 'constructor', 'prototype', 'toString', 'toLocaleString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__']);
  const okId = k => typeof k === 'string' && !BAD.has(k); // an id from the log or the index that may key a map
  const dict = () => Object.create(null);
  let A = null, panel = null;
  const okAt = s => typeof s === 'string' && s.length <= 40 && isFinite(Date.parse(s)) ? s : null;
  const own = (o, k) => o && typeof o === 'object' && Object.hasOwn(o, k) ? o[k] : undefined;
  const marked = sp => { const t = own(sp, 'trashed'); return !!t && typeof t === 'object' && !Array.isArray(t) && !!okAt(own(t, 'at')); }; // removed: its own trashed, an object with a real date (false, 0, a string or an inherited one is not)
  const old = (at, now) => now - Date.parse(at) > DAYS * DAY;
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  const S = () => A.state;
  const logId = () => { const s = S().store; return s === 'sync' ? (A.logKey() || null) : s === 'local' || s === 'db' ? s : null; };
  const idTime = id => { const m = /^p([0-9a-z]{8})[0-9a-z]{2}$/.exec(id); return m ? parseInt(m[1], 36) : 0; }; // a photo id is 'p' + its upload time in base 36 + two random characters

  function init(o) {
    A = o; panel = document.getElementById('panel'); if (!S().trash || Object.getPrototypeOf(S().trash) !== null) S().trash = dict();
    if (window.Photos) Photos.init({ hidden, onDelete: hidePhoto });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && booted) pdLoad(); }); // a home-screen app comes back without reloading
    panel.addEventListener('keydown', e => { if (e.key === 'Escape' && ask && S().view === 'trash') { e.stopPropagation(); ask = null; A.render(); } }); // Escape closes a confirmation, not the page
  }

  // ---------- when this device first saw each removed item (s:<spot id>, p:<owner>/<photo id>), per log ----------
  let seen = null, seenT = 0;
  function seenMap() {
    const log = logId();
    if (!seen || seen.log !== log) {
      const m = dict(); let raw = null;
      if (log) { try { raw = JSON.parse(localStorage.getItem('sbs-del-seen-' + log)); } catch (e) {} }
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) for (const k of Object.keys(raw)) if (k.length <= 400 && Number.isFinite(raw[k])) m[k] = raw[k];
      seen = { log, m }; // no log yet (a local log before it is known): in memory only
    }
    return seen.m;
  }
  function seenSave() {
    seenT = 0; if (!seen || !seen.log) return; const m = seen.m, ks = Object.keys(m);
    if (ks.length > SEEN_MAX) ks.sort((a, b) => m[a] - m[b]).slice(0, ks.length - SEEN_MAX).forEach(k => delete m[k]); // one dropped is seen again later: its purge only waits longer
    try { localStorage.setItem('sbs-del-seen-' + seen.log, JSON.stringify(m)); } catch (e) {}
  }
  function firstSeen(k) { const m = seenMap(); if (!(k in m)) { m[k] = Date.now(); if (!seenT) seenT = setTimeout(seenSave, 0); } return m[k]; }
  function seenKeep(pre, keys) { if (!logId()) return; const m = seenMap(), set = new Set(keys.map(k => pre + k)); let n = 0; for (const k of Object.keys(m)) if (k.startsWith(pre) && !set.has(k)) { delete m[k]; n++; } if (n) seenSave(); } // back or gone: forgotten, so a later removal counts afresh
  const effAt = (k, at) => { const s = firstSeen(k); return Date.parse(at) > Date.now() ? new Date(s).toISOString() : at; }; // a date in the future: from when this device first saw it
  const since = (k, at) => Math.max(Date.parse(at), firstSeen(k)); // the 30 days count from the later of the entry's date and this device's first sighting: a wrong clock, here or there, can only make the purge later
  const leftTxt = (k, at) => { const d = Math.min(DAYS, Math.max(0, Math.ceil((since(k, at) + DAYS * DAY - Date.now()) / DAY))); return d <= 1 ? 'goes for good within a day' : d + ' days left'; }; // when the purge may take it
  const ripe = (k, at, now) => now - since(k, at) > DAYS * DAY;

  // ---------- the log in and out ----------
  // adopt: after app.js has cloned a record's spots. A record from the database replaces the trash; a body without updatedAt (an
  // import) keeps it. A spot that is live again (restored here or elsewhere) is never in the trash.
  function adopt(body) {
    const st = S(), prev = st.trash && Object.getPrototypeOf(st.trash) === null ? st.trash : dict(); st.trash = body && body.updatedAt ? dict() : prev;
    for (const id of Object.keys(st.spots)) {
      const sp = st.spots[id]; if (!okId(id) || !marked(sp)) continue;
      const { trashed: t, _xy, ...spot } = sp;
      st.trash[id] = { spot, at: effAt('s:' + id, t.at), by: A.cleanName(own(t, 'by')) };
      delete st.spots[id];
    }
    for (const id of Object.keys(st.trash)) if (Object.hasOwn(st.spots, id)) delete st.trash[id];
    seenKeep('s:', Object.keys(st.trash));
    if (body && body.updatedAt) seenAt = body.updatedAt;
  }
  let seenAt = null; // updatedAt of the record this device last read or wrote: a purge goes ahead only while the database still holds it
  function withTrash(spots) { // the removed spots back inside spots, as they are stored
    const t = S().trash || dict();
    for (const id of Object.keys(t)) if (!Object.hasOwn(spots, id)) spots[id] = { ...t[id].spot, trashed: t[id].by ? { at: t[id].at, by: t[id].by } : { at: t[id].at } }; // spread, not assign: a key from the log never reaches a setter
    return spots;
  }
  function out(payload) { withTrash(payload.spots); seenAt = payload.updatedAt; } // persist(): the trash rides back inside spots
  const objOf = v => v && typeof v === 'object' && !Array.isArray(v) ? v : {};

  // ---------- spots: delete, undo, restore, delete forever ----------
  async function trashSpot(id) {
    const st = S(), sp = Object.hasOwn(st.spots, id) ? st.spots[id] : null; if (!sp) return; if (!okId(id)) return false; // false: not taken (app.js deletes it the old way)
    const { _xy, trashed, ...spot } = sp, by = A.who();
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
  let pd = { key: null, map: dict(), ver: 0 }, dapiFor = null;
  const dapi = () => { const k = A.logKey(); if (S().store !== 'sync' || !k || !window.Sync || !Sync.deleted) return null; if (!dapiFor || dapiFor.key !== k) dapiFor = { key: k, api: Sync.deleted(k) }; return dapiFor.api; };
  const okKey = k => okId(k) && SAFE_KEY.test(k);
  function cleanPd(raw) { // anyone with the link writes it: keys and fields checked. All of it hides; only the list is capped
    const out = dict(), r0 = objOf(raw);
    for (const o of Object.keys(r0)) {
      if (!okKey(o)) continue; const ids = objOf(r0[o]);
      for (const id of Object.keys(ids)) {
        if (!okKey(id) || id.length > 64) continue; const r = ids[id], at = okAt(own(r, 'at')), k = 'p:' + o + '/' + id;
        (out[o] || (out[o] = dict()))[id] = { at: at ? effAt(k, at) : new Date(firstSeen(k)).toISOString(), by: A.cleanName(own(r, 'by')) }; // an unreadable date: its 30 days start when this device first saw it
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
  const pdKeys = map => Object.keys(map).flatMap(o => Object.keys(map[o]).map(id => o + '/' + id));
  function hidden(o, id) { const p = pdFor(); return !!(p && typeof o === 'string' && typeof id === 'string' && Object.hasOwn(p.map, o) && Object.hasOwn(p.map[o], id)); }
  const redrawOwner = o => { if (window.Photos && Photos.refresh) { try { Photos.refresh(o); } catch (e) {} } };
  function pdLoad() {
    const d = dapi(), p = pdFor(); if (!d || !p) return Promise.resolve();
    const ver = p.ver;
    return d.all().then(raw => {
      if (pdFor() !== p || p.ver !== ver) return; // a remove or restore here while it was read wins; the next read catches up
      const next = cleanPd(raw), owners = new Set([...Object.keys(p.map), ...Object.keys(next)]), was = JSON.stringify(p.map);
      p.map = next; pdSave(); seenKeep('p:', pdKeys(next));
      if (JSON.stringify(next) !== was) { owners.forEach(redrawOwner); if (S().view === 'trash') A.render(); else rootSoft(); }
    }, () => {});
  }
  const atRoot = () => !S().view && !S().loc.spot && !S().loc.sub && !S().loc.hood;
  const rootSoft = () => { const d = panel.querySelector('details.more'); if (atRoot() && !S().query && !S().quiz && !(d && d.open)) A.render(); }; // the Recently deleted entry follows, but an open Settings is never folded
  const unlist = (p, o, id) => { if (Object.hasOwn(p.map, o)) { delete p.map[o][id]; if (!Object.keys(p.map[o]).length) delete p.map[o]; } };
  async function hidePhoto(o, id) { // the lightbox's Delete: listed, not deleted
    const d = dapi(), p = pdFor(); if (!d || !p || !S().canWrite || !okKey(o) || !okKey(id)) throw new Error('not available');
    const rec = { at: new Date().toISOString() }, by = A.who(); if (by) rec.by = by;
    p.ver++; (p.map[o] || (p.map[o] = dict()))[id] = { at: rec.at, by }; redrawOwner(o);
    try { await d.put(o, id, rec); } catch (e) { p.ver++; unlist(p, o, id); redrawOwner(o); throw e; }
    pdSave(); rootSoft();
    A.toast('Photo removed', 6000, { label: 'Undo', run: () => restorePhoto(o, id) });
  }
  // A photo comes back to its old place (photos.js keeps hidden ids in the order through a reorder or a crop). Restoring one
  // where 8 already show is allowed (9 show); adding stays blocked until fewer than 8 show.
  async function restorePhoto(o, id) {
    const d = dapi(), p = pdFor(); if (!d || !p || !hidden(o, id)) return;
    const rec = p.map[o][id]; p.ver++; unlist(p, o, id); redrawOwner(o); A.render();
    try { await d.del(o, id); pdSave(); A.toast('Photo is back'); }
    catch (e) { p.ver++; (p.map[o] || (p.map[o] = dict()))[id] = rec; redrawOwner(o); A.render(); A.toast('Could not restore the photo. Try again.', 3000); }
  }
  async function photoForever(o, id) {
    const d = dapi(), p = pdFor(); if (!d || !p || !hidden(o, id) || !S().canWrite) return;
    ask = null;
    try { if (window.Photos && A.photoApi()) { await Photos.list(o).catch(() => {}); await Photos.remove(o, id); } await d.del(o, id); } // the list first, so its order record is known and loses the id // the photo, its thumb and its place in the order, then the entry
    catch (e) { A.toast('Could not delete the photo. Try again.', 3000); A.render(); return; }
    p.ver++; unlist(p, o, id); pdSave(); A.render(); A.toast('Deleted for good');
  }
  const pdCount = () => { const p = pdFor(); return p ? Object.values(p.map).reduce((n, ids) => n + Object.keys(ids).length, 0) : 0; };

  // ---------- the purge: older than 30 days, on a device that may write ----------
  let purging = false, purgedAt = 0;
  async function purge() {
    const st = S(); if (purging || !st.canWrite || st.store === 'db') return; purging = true; purgedAt = Date.now(); // 'db' (the artifact): no check against the database is possible there, so nothing goes by itself
    try {
      const now = Date.now(); let at0 = seenAt, ids = Object.keys(st.trash).filter(id => ripe('s:' + id, st.trash[id].at, now));
      if (ids.length && st.store === 'sync') { // only while the database still holds the record this device read, and only what it still has old in its trash
        const rec = await Promise.resolve(A.fetchLog()).catch(() => null), sp = rec && objOf(rec.spots);
        ids = !rec || rec.updatedAt !== seenAt ? [] : ids.filter(id => Object.hasOwn(sp, id) && marked(sp[id]) && old(effAt('s:' + id, sp[id].trashed.at), now));
      }
      const api = ids.length ? A.photoApi() : null;
      if (api) { // a photo added after the spot was removed (a device on older code shows it as live): the spot comes back instead
        const go = [], back = [];
        for (const id of ids) {
          let list = null; try { list = objOf(await api.ids(A.ownerKey.spot(id))); } catch (e) { continue; } // not known: not this time
          const t = st.trash[id]; if (!t) continue;
          (Object.keys(list).some(pid => idTime(pid) > Date.parse(t.at)) ? back : go).push(id);
        }
        ids = go;
        const live = back.filter(id => seenAt === at0 && Object.hasOwn(st.trash, id) && !Object.hasOwn(st.spots, id));
        if (live.length) { live.forEach(id => { st.spots[id] = JSON.parse(JSON.stringify(st.trash[id].spot)); delete st.trash[id]; }); await A.persist(); at0 = seenAt; A.refresh(); } // its own save: not a newer record
      }
      if (ids.length && st.store === 'sync') { const rec = await Promise.resolve(A.fetchLog()).catch(() => null); if (!rec || rec.updatedAt !== seenAt) ids = []; } // read again right before the save: the photo checks above took time
      ids = ids.filter(id => seenAt === at0 && Object.hasOwn(st.trash, id) && !Object.hasOwn(st.spots, id) && ripe('s:' + id, st.trash[id].at, now)); // still in the trash after the wait, and no newer record meanwhile (a restore wins)
      if (ids.length && st.canWrite) {
        const gone = dict(); ids.forEach(id => { gone[id] = st.trash[id]; delete st.trash[id]; });
        if (await A.persist() === false) { for (const id of Object.keys(gone)) if (!Object.hasOwn(st.spots, id)) st.trash[id] = gone[id]; }
        else ids.forEach(dropPhotos);
        if (st.view === 'trash') A.render(); else rootSoft();
      }
      await purgePhotos(now);
    } catch (e) { console.warn('purge failed', e); }
    purging = false;
  }
  async function purgePhotos(now) {
    const d = dapi(), p = pdFor(); if (!d || !p || !S().canWrite || !window.Photos || !A.photoApi()) return;
    const items = []; for (const o of Object.keys(p.map)) for (const id of Object.keys(p.map[o])) { const at = p.map[o][id].at; if (ripe('p:' + o + '/' + id, at, now)) items.push({ o, id, at }); }
    const same = x => pdFor() === p && Object.hasOwn(p.map, x.o) && Object.hasOwn(p.map[x.o], x.id) && p.map[x.o][x.id].at === x.at; // still listed here, unchanged since the loop started
    let done = 0;
    for (const x of items) {
      try {
        if (!same(x)) continue;
        await Photos.list(x.o).catch(() => {}); // its order record known, so the delete takes the id out of it
        const cur = await d.get(x.o, x.id), at = cur && okAt(own(cur, 'at')); // read again: restored on another phone meanwhile, it stays
        if (cur && !(at && old(effAt('p:' + x.o + '/' + x.id, at), now))) continue;
        if (!same(x) || !S().canWrite) continue; // restored here during the reads: it stays. Nothing is awaited between this check and the delete
        if (cur) { await Photos.remove(x.o, x.id); await d.del(x.o, x.id); }
        if (same(x)) { p.ver++; unlist(p, x.o, x.id); done++; }
      } catch (e) {}
    }
    if (done) { pdSave(); if (S().view === 'trash') A.render(); }
  }

  // ---------- boot: once the log this device shows has arrived from where it lives ----------
  let booted = null;
  function loaded() {
    const id = logId(); if (!id || booted === id) return; booted = id;
    pdLoad();
    setTimeout(purge, 800);
  }

  // ---------- views ----------
  let ask = null; // the item whose confirmation is open
  function back() { A.go(S().loc, { replace: true, fly: false }); const d = panel.querySelector('details.more'); if (d) { d.open = true; d.scrollIntoView({ block: 'nearest' }); } }
  const head = title => A.setHead({ eyebrow: 'Settings', title, onBack: back, tools: [] });
  const has = v => v === 'trash';
  const render = () => trashView();
  function where(o, names) { // what a photo belonged to
    if (names.has(o)) return { name: names.get(o), gone: false };
    for (const id of Object.keys(S().trash)) if (A.ownerKey.spot(id) === o) return { name: S().trash[id].spot.name, gone: true };
    return null;
  }
  const btns = (k, what) => ask === k ? `<div class="actions safe-ask"><span>${what}</span><button type="button" class="btn sm safe-bad safe-yes" data-act="yes" data-k="${A.esc(k)}">Delete forever</button><button type="button" class="btn sm quiet" data-act="no" data-k="${A.esc(k)}">Keep</button></div>`
    : `<div class="actions"><button type="button" class="btn sm" data-act="restore" data-k="${A.esc(k)}">Restore</button><button type="button" class="btn sm quiet safe-bad" data-act="forever" data-k="${A.esc(k)}">Delete forever</button></div>`;
  function trashView() {
    head('Recently deleted');
    const st = S(), esc = A.esc, w = st.canWrite, p = pdFor();
    if (w && Date.now() - purgedAt > 60000) purge(); // on open; not again on every redraw of the list
    const spots = Object.keys(st.trash).sort((a, b) => st.trash[b].at.localeCompare(st.trash[a].at));
    const all = []; if (p) for (const o of Object.keys(p.map)) for (const id of Object.keys(p.map[o])) all.push({ o, id, at: p.map[o][id].at, by: p.map[o][id].by });
    all.sort((a, b) => b.at.localeCompare(a.at)); const photos = all.slice(0, PD_MAX), names = photos.length ? new Map(A.ownerNames()) : null; // every listed photo stays hidden; the list shows the newest
    const by = n => n ? 'removed by ' + n : 'removed';
    panel.innerHTML = `<p class="lead">Removed spots and photos wait here for ${DAYS} days, then go for good.</p>`
      + (spots.length ? `<h3>Spots <span class="n">${spots.length}</span></h3><ul class="rows safe-list">${spots.map(id => {
        const t = st.trash[id], sp = t.spot, k = Object.hasOwn(A.kinds, sp.kind) ? A.kinds[sp.kind] : A.kinds.other;
        return `<li><div class="row"><span class="ic" style="--c:${k.c}"></span><span class="nm">${esc(sp.name)}<small>${esc([k.label + (sp.status === 'want' ? ', want to go' : ''), sp.sub || sp.hood, by(t.by), leftTxt('s:' + id, t.at)].filter(Boolean).join(' · '))}</small></span></div>${w ? btns('s:' + id, 'This also removes its photos, and cannot be undone.') : ''}</li>`;
      }).join('')}</ul>` : '')
      + (photos.length ? `<h3>Photos <span class="n">${all.length}</span></h3>${all.length > photos.length ? `<p class="empty safe-cap">Showing the newest ${PD_MAX} of ${all.length}.</p>` : ''}<ul class="rows safe-list">${photos.map(x => {
        const wh = where(x.o, names), of = wh ? 'Photo of ' + wh.name + (wh.gone ? ' (removed)' : '') : 'Photo';
        return `<li><div class="row"><span class="safe-th"><img alt="" data-o="${esc(x.o)}" data-id="${esc(x.id)}"></span><span class="nm">${esc(of)}<small>${esc([by(x.by), leftTxt('p:' + x.o + '/' + x.id, x.at)].join(' · '))}</small></span></div>${w ? btns('p:' + x.o + '/' + x.id, 'The photo goes for good, and this cannot be undone.') : ''}</li>`;
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
  // ---------- Settings: the Recently deleted entry, while something is in it ----------
  function settings() {
    const n = Object.keys(S().trash).length, np = pdCount(), parts = [n ? plural(n, 'spot', 'spots') : '', np ? plural(np, 'photo', 'photos') : ''].filter(Boolean);
    return n + np ? `<ul class="rows safe-links"><li><button type="button" class="row" data-view="trash"><span class="ic sq" style="--c:var(--bad)"></span><span class="nm">Recently deleted<small>${A.esc(parts.join(' and '))}, kept ${DAYS} days</small></span><span class="rt">${n + np}<span class="chev"></span></span></button></li></ul>` : '';
  }

  return { init, adopt, out, trashSpot, loaded, has, render, settings, hidden, _t: { purge, pdFor, pdLoad, dapi, seenMap, seenSave } }; // _t: tests
})();
