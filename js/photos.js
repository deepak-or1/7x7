// Photos on spots, sections and places (hosted site only). They live beside the log, not in it, so the live log
// stream never carries them: logs/<key>-ph/<owner>/<photoId> = { d: JPEG data URL, w, h, at } is the photo, and
// logs/<key>-pt/<owner>/<photoId> = { d, w, h } its thumb (longest edge 480). An owner's ids come from a shallow read
// of -ph, which stays the source of truth: a thumb whose id is not listed there is ignored (clients on older code add
// photos without thumbs and delete photos without their thumbs). A hero paints thumbs at once and fetches the full photo
// only for the slide in view; records never change once written, so IndexedDB keeps a copy of both and a second visit
// paints with no network wait. This file owns the downscale, the caches, the photo hero at the top of a panel (a
// section or place also shows the photos of what is inside it), and the lightbox.
window.Photos = (() => {
  const MAX = 8, EDGE = 2560, TEDGE = 480, BIG = 1800000, FRESH = 60000; // EDGE: four times the pixels of a phone screen's width, so a photo holds up when zoomed; BIG: past this many characters it is saved a step lower in quality; FRESH: a panel opened again after a minute re-reads the list in the background
  const XMAX = 12, DOTS = 8; // XMAX: extra sources rolled into one hero; DOTS: past this many photos the hero shows a counter instead of dots
  const LOCAL_MS = 500, RETRY = 5000; // LOCAL_MS: a local copy slower than this is skipped; RETRY: a failed photo is not asked for again sooner
  const PIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6-5.3-6-11a6 6 0 0 1 12 0c0 5.7-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/></svg>';
  const CHEV = d => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const plural = n => n + (n === 1 ? ' photo' : ' photos');
  let api = null, toast = () => {}, canWrite = () => true;
  // owner -> { ids: {id: true} | null, known: ids came from the server (not only the local copy), th / full: {id: rec},
  //            bad: {id: true} (not a photo), fk: ids whose full photo is in IndexedDB, got / miss: full photo in flight / failed at,
  //            at, ver, loading, busy, local: IndexedDB was read }
  const cache = {};
  const entry = o => cache[o] || (cache[o] = { ids: null, known: false, th: {}, full: {}, bad: {}, fk: new Set(), got: {}, miss: {}, at: 0, ver: 0, loading: null, busy: 0, local: false });
  const isImg = d => typeof d === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(d); // never a remote URL: a record is written by anyone with the link
  const okRec = r => r && typeof r === 'object' && isImg(r.d) ? { d: r.d, w: +r.w || 0, h: +r.h || 0, at: typeof r.at === 'string' ? r.at : undefined } : null; // full or thumb, only the fields we use
  // one owner's photos in id (upload) order; d is the best copy in memory (the full photo, else the thumb, else '': a loading slide), q says which
  const ordered = o => { const e = cache[o]; if (!e || !e.ids) return []; return Object.keys(e.ids).sort().filter(id => !e.bad[id]).map(id => { const r = e.full[id] || e.th[id]; return { id, d: r ? r.d : '', w: r ? r.w : 0, h: r ? r.h : 0, q: e.full[id] ? 'f' : r ? 't' : '' }; }); };
  const newId = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 4).padEnd(2, '0');
  const later = ms => new Promise(r => setTimeout(() => r(null), ms));
  function init(o) { api = o.api || null; if (o.toast) toast = o.toast; if (o.canWrite) canWrite = o.canWrite; }

  // ---------- the local copy: IndexedDB stores t (thumbs) and f (full photos), keyed <log key>/<owner>/<id> ----------
  // Every call resolves, never rejects: no IndexedDB (a private window, an old browser, a full disk) just means memory only.
  const idb = (() => {
    let dbp = null;
    const key = (o, id) => api.key + '/' + o + '/' + id;
    const open = () => dbp || (dbp = new Promise(res => {
      try { const r = indexedDB.open('sbs-photos', 1); r.onupgradeneeded = () => ['t', 'f'].forEach(s => r.result.objectStoreNames.contains(s) || r.result.createObjectStore(s)); r.onsuccess = () => { const d = r.result; d.onversionchange = () => { d.close(); dbp = null; }; res(d); }; r.onerror = () => res(null); } catch (e) { res(null); }
    }));
    const tx = (stores, mode, fn) => (api && api.key ? open() : Promise.resolve(null)).then(d => d && new Promise(res => { try { const t = d.transaction(stores, mode), out = fn(t); t.oncomplete = () => res(out ? out() : true); t.onerror = t.onabort = () => res(null); } catch (e) { res(null); } }));
    const range = o => { const p = key(o, ''); return [p, IDBKeyRange.bound(p, p + '\uffff')]; };
    return {
      read: o => tx(['t', 'f'], 'readonly', t => { const [p, rg] = range(o), tk = t.objectStore('t').getAllKeys(rg), tv = t.objectStore('t').getAll(rg), fk = t.objectStore('f').getAllKeys(rg); return () => ({ t: tk.result.map((k, i) => [k.slice(p.length), tv.result[i]]), f: fk.result.map(k => k.slice(p.length)) }); }),
      get: (s, o, id) => tx([s], 'readonly', t => { const r = t.objectStore(s).get(key(o, id)); return () => r.result; }),
      put: (s, o, id, v) => tx([s], 'readwrite', t => { t.objectStore(s).put(v, key(o, id)); }),
      del: (o, id) => tx(['t', 'f'], 'readwrite', t => { t.objectStore('t').delete(key(o, id)); t.objectStore('f').delete(key(o, id)); }),
      drop: o => tx(['t', 'f'], 'readwrite', t => { const rg = range(o)[1]; t.objectStore('t').delete(rg); t.objectStore('f').delete(rg); }),
    };
  })();
  function forget(e, owner, id) { // gone from the server or deleted here: out of memory and the local copy
    delete e.th[id]; delete e.full[id]; delete e.bad[id]; e.fk.delete(id);
    if (e.ids && e.ids[id]) { e.ids = Object.assign({}, e.ids); delete e.ids[id]; }
    idb.del(owner, id);
  }

  // ---------- the list: ids and thumbs ----------
  // The id list goes out at once. The local copy paints as soon as it is read; with nothing local the thumbs go out
  // too, beside the id list, and otherwise only the thumbs it lacks are asked for once the list is in. The list and its
  // thumbs land together, so a hero never flashes loading slides for photos whose thumbs are a moment behind.
  function load(owner, force) {
    const e = entry(owner);
    if (e.loading) return e.loading;
    if (e.known && !force && Date.now() - e.at < FRESH) return Promise.resolve();
    if (!api) return Promise.reject(new Error('photos are not available'));
    const ver = e.ver, ids = api.ids(owner);
    ids.catch(() => {}); // handled below, once the local copy is read
    const local = e.local ? Promise.resolve(null) : (e.local = true, Promise.race([idb.read(owner), later(LOCAL_MS)]));
    e.loading = local.then(loc => {
      if (loc) {
        loc.t.forEach(([id, r]) => { const t = okRec(r); if (t && !e.th[id]) e.th[id] = t; }); loc.f.forEach(id => e.fk.add(id));
        if (!e.ids && loc.t.length && e.ver === ver) { e.ids = {}; loc.t.forEach(([id]) => { if (e.th[id]) e.ids[id] = true; }); refresh(owner); } // paint the local copy now; the server's list corrects it below
      }
      const all = !e.known && !Object.keys(e.th).length ? api.thumbs(owner) : null; // nothing local: every thumb, alongside the id list
      if (all) all.catch(() => {});
      return ids.then(list => {
        const miss = Object.keys(list).filter(id => !e.th[id]);
        const th = all || (!miss.length ? Promise.resolve({}) : miss.length > 2 ? api.thumbs(owner) : Promise.all(miss.map(id => api.thumb(owner, id).then(t => [id, t]))).then(Object.fromEntries));
        return th.catch(() => ({})).then(t => [list, t]); // no thumbs (older photos, a failed read): those slides load their full photo
      });
    }).then(([list, th]) => {
      e.loading = null; e.at = Date.now();
      if (e.ver === ver) { // a local add or delete while this was in flight wins; the next open re-reads
        for (const id in th) { const t = okRec(th[id]); if (t && list[id] && !e.th[id]) { e.th[id] = t; idb.put('t', owner, id, t); } } // a thumb with no photo behind it is ignored
        e.ids = list; e.known = true;
        [...new Set([...Object.keys(e.th), ...Object.keys(e.full), ...e.fk])].filter(id => !list[id]).forEach(id => forget(e, owner, id));
        refresh(owner);
      }
    }, err => { e.loading = null; if (!e.ids) { e.ids = {}; e.at = 0; refresh(owner); } throw err; }); // offline or blocked: the local copy, else the empty state; retried on the next open
    return e.loading;
  }
  function preload(owner) { if (api) load(owner).catch(() => {}); } // a page opened on a spot: its list sets off before the panel exists

  // ---------- full photos, one at a time, for the slide in view ----------
  const wrote = new Set(); // owner/id whose thumb this session wrote for an older photo: once each
  function want(owner, id, then) { // then: what to fetch once this one is in (the next slide), so the two never share the line
    const e = entry(owner);
    if (e.full[id]) { if (then) then(); return; }
    if (e.got[id]) { if (then) e.got[id].then(then); return; }
    if (!api || !e.ids || !e.ids[id] || e.bad[id] || Date.now() - (e.miss[id] || 0) < RETRY) return;
    let net = false; // it came from the server, so the local copy is still to be written
    e.got[id] = (e.fk.has(id) ? idb.get('f', owner, id) : Promise.resolve(null))
      .then(r => okRec(r) || api.get(owner, id).then(r => { net = true; return r === null ? null : okRec(r) || false; }))
      .then(f => {
        delete e.got[id]; if (!e.ids || !e.ids[id]) return; // deleted while it loaded
        if (f === null) forget(e, owner, id); else if (!f) e.bad[id] = true; // gone from the server since the list; not a photo
        else { e.full[id] = f; e.fk.add(id); if (net) idb.put('f', owner, id, f); if (!e.th[id]) backfill(owner, id, f); } // after the check above: a photo deleted while it loaded is not written back
        refresh(owner); if (then) then();
      }, err => { delete e.got[id]; e.miss[id] = Date.now(); console.warn('photo load failed', err); setTimeout(() => refresh(owner), RETRY + 50); }); // a hero still showing it asks again (fill)
  }
  // An older photo has no thumb: make one from the full photo, keep it, and (anyone who may write) store it for everyone.
  function backfill(owner, id, f) {
    thumbOf(f.d).then(t => {
      const e = entry(owner); if (!e.ids || !e.ids[id] || e.th[id]) return;
      e.th[id] = t; idb.put('t', owner, id, t);
      const k = owner + '/' + id; if (api && canWrite() && !wrote.has(k)) { wrote.add(k); api.putThumb(owner, id, t).catch(() => {}); }
    }).catch(() => {});
  }

  // ---------- downscale: longest edge 2560 (thumbs 480), JPEG, EXIF orientation applied ----------
  async function decode(file) {
    if (window.createImageBitmap) { try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) {} }
    return new Promise((res, rej) => { const u = URL.createObjectURL(file), img = new Image(); img.onload = () => { URL.revokeObjectURL(u); res(img); }; img.onerror = () => { URL.revokeObjectURL(u); rej(new Error('could not read the image')); }; img.src = u; }); // <img> applies EXIF orientation by default
  }
  function canvasOf(src, W, H, edge) {
    const s = Math.min(1, edge / Math.max(W, H)), w = Math.max(1, Math.round(W * s)), h = Math.max(1, Math.round(H * s));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.imageSmoothingQuality = 'high'; g.drawImage(src, 0, 0, w, h); // white under a transparent PNG, not black
    return c;
  }
  const thumbAt = (src, W, H) => { const c = canvasOf(src, W, H, TEDGE); return { d: c.toDataURL('image/jpeg', 0.7), w: c.width, h: c.height }; };
  const thumbOf = d => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(thumbAt(i, i.naturalWidth, i.naturalHeight)); i.onerror = () => rej(new Error('could not read the image')); i.src = d; });
  async function shrink(file) { // the photo and its thumb, both from one decode
    const src = await decode(file), W = src.naturalWidth || src.width, H = src.naturalHeight || src.height;
    if (!W || !H) throw new Error('empty image');
    const c = canvasOf(src, W, H, EDGE); if (src.close) src.close();
    let d = c.toDataURL('image/jpeg', 0.85); if (d.length > BIG) d = c.toDataURL('image/jpeg', 0.75);
    return { rec: { d, w: c.width, h: c.height, at: new Date().toISOString() }, th: thumbAt(c, c.width, c.height) };
  }
  const downscale = file => shrink(file).then(r => r.rec);

  // ---------- add / remove ----------
  async function add(owner, files, label) { // label: what the photos are of, for the first-photo toast
    files = [...(files || [])].filter(f => f && (!f.type || /^image\//.test(f.type)));
    if (!files.length) return [];
    if (!api) { toast('Could not add the photo. Try again.', 3000); throw new Error('photos are not available'); }
    const e = entry(owner);
    try { await load(owner); } catch (err) {} // count what is there first; offline, the add itself fails below
    const had = Object.keys(e.ids || {}).length, room = Math.max(0, MAX - had), take = files.slice(0, room);
    if (!take.length) { toast(`${MAX} photos is the limit here`, 2600); return []; }
    e.busy++; refresh(owner);
    toast(`Adding ${plural(take.length)}…`, 60000);
    const added = []; let failed = null;
    for (const f of take) { // one at a time, so ids (time-based) sort in upload order
      try {
        const { rec, th } = await shrink(f), id = newId(); await api.put(owner, id, rec);
        e.ver++; e.ids = Object.assign({}, e.ids, { [id]: true }); e.full[id] = rec; e.th[id] = th; e.fk.add(id); idb.put('f', owner, id, rec); idb.put('t', owner, id, th);
        api.putThumb(owner, id, th).catch(err => console.warn('thumb upload failed', err)); // right after its photo; without it, the first viewer who may write makes one
        added.push(id); refresh(owner);
      }
      catch (err) { failed = err; console.warn('photo upload failed', err); break; }
    }
    e.busy--; refresh(owner);
    if (failed) toast('Could not add the photo. Try again.', 3000);
    else if (!had && added.length && label) { if (window.Confetti) window.Confetti.burst(); toast(`First photo of ${label}`, 2600); } // its very first photo: a small party
    else toast(`${plural(added.length)} added${take.length < files.length ? ` (${MAX} is the limit)` : ''}`);
    return added;
  }
  async function remove(owner, id) {
    if (!api) throw new Error('photos are not available');
    await api.del(owner, id); // the photo, then its thumb
    const e = entry(owner); e.ver++; forget(e, owner, id);
    refresh(owner);
  }
  function removeAll(owner) { // a deleted spot: best effort, never in the way
    const e = entry(owner); e.ver++; Object.assign(e, { ids: {}, known: true, th: {}, full: {}, bad: {}, fk: new Set(), at: Date.now() }); idb.drop(owner);
    return api ? api.delAll(owner).catch(err => console.warn('photo cleanup failed', err)) : Promise.resolve();
  }

  // ---------- the hero at the top of a panel ----------
  // app.js writes block() into the panel HTML; mount() fills it, and refresh() redraws it in place when the cache changes,
  // so a panel re-render never refetches or flickers, and the panel HTML never depends on photo state.
  // o: { c: cover colour (CSS), e: cover emoji, badge: { e, t } over the photos (bottom left),
  //      extras: [{ owner, label }] whose photos follow the panel's own, in order (a section's spots, a place's sections and spots) }
  const look = o => ` style="--hc:${esc(o.c || 'var(--accent)')}" data-e="${esc(o.e || '')}"`;
  const cover = (o = {}) => `<div class="hero cover deco"${look(o)} aria-hidden="true"><span class="hero-e">${esc(o.e || '')}</span></div>`; // photos unavailable here: the same cover, decorative only; needs no init
  const block = (owner, label, writable, o = {}) => `<div class="hero cover loading"${look(o)} data-owner="${esc(owner)}" data-label="${esc(label)}" data-w="${writable ? 1 : 0}"`
    + (o.badge ? ` data-be="${esc(o.badge.e || '')}" data-bt="${esc(o.badge.t || '')}"` : '')
    + (o.extras && o.extras.length ? ` data-x="${esc(JSON.stringify(o.extras.slice(0, XMAX).map(x => ({ owner: x.owner, label: x.label }))))}"` : '') + '></div>';
  function sourcesOf(el) { // [own, ...extras]: no repeats, at most XMAX extras
    const own = { owner: el.dataset.owner, label: el.dataset.label || '' }, seen = new Set([own.owner]); let x = [];
    try { x = JSON.parse(el.dataset.x || '[]'); } catch (err) {}
    return [own].concat((Array.isArray(x) ? x : []).filter(s => s && typeof s.owner === 'string' && !seen.has(s.owner) && seen.add(s.owner)).slice(0, XMAX).map(s => ({ owner: s.owner, label: String(s.label || '') })));
  }
  const combined = srcs => srcs.flatMap((s, k) => ordered(s.owner).map(p => Object.assign(p, { owner: s.owner, label: s.label, own: k === 0 })));
  const heroes = owner => [...document.querySelectorAll('.hero[data-owner]')].filter(el => sourcesOf(el).some(s => s.owner === owner));
  const smooth = () => matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
  const slideAt = track => Math.round(track.scrollLeft / Math.max(1, track.clientWidth));
  // One file picker for the page, outside every hero: a hero redraws while sources load, and a picker whose input
  // has left the page can lose the chosen photos (iOS Safari).
  let picker = null, pickFor = null;
  function pick(owner, label) {
    if (!picker) {
      picker = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*', multiple: true, hidden: true }); picker.setAttribute('data-ph-file', '');
      picker.addEventListener('change', () => { const fs = [...picker.files], t = pickFor; picker.value = ''; if (t) add(t.owner, fs, t.label).catch(() => {}); });
      document.body.appendChild(picker);
    }
    pickFor = { owner, label }; picker.click();
  }
  function draw(el) {
    const srcs = sourcesOf(el), own = srcs[0], e = entry(own.owner), list = combined(srcs), n = list.length;
    const full = Object.keys(e.ids || {}).length >= MAX, write = el.dataset.w === '1' && canWrite() && !!api;
    const mode = n ? 'photos' : api && srcs.some(s => !entry(s.owner).ids) ? 'loading' : 'empty'; // no "No photos yet" flash before the first read
    const sig = JSON.stringify([mode, list.map(p => p.owner + '/' + p.id), write, full, e.busy > 0]);
    if (el._sig === sig) { fill(el, list); return; } // the same slides: keep the slide, the focus and the decoded images; only better copies move in
    el._sig = sig;
    const old = el.querySelector('.hero-track'), oldI = old ? slideAt(old) : 0, was = old && old.children[oldI], keep = was ? was.dataset.o + '/' + was.dataset.id : null;
    const focus = el.contains(document.activeElement) ? (document.activeElement.matches('[data-ph-add]') ? 'add' : document.activeElement.dataset.o + '/' + document.activeElement.dataset.id) : null;
    const busy = e.busy > 0;
    let html = '';
    if (mode === 'photos') {
      const addTxt = full ? `${MAX} of ${MAX}` : busy ? 'Adding…' : '';
      html = `<div class="hero-track" role="group" aria-label="${esc('Photos of ' + own.label)}">${list.map((p, i) => `<button type="button" class="hero-slide${p.q ? '' : ' wait'}" data-i="${i}" data-o="${esc(p.owner)}" data-id="${esc(p.id)}" aria-label="${esc(`Photo ${i + 1} of ${n}, ${p.label}`)}"><img${p.d ? ` src="${esc(p.d)}"` : ''} data-k="${esc(p.owner + '/' + p.id)}" data-q="${p.q}" alt="" decoding="async"${i > 1 ? ' loading="lazy"' : ''}></button>`).join('')}</div>`
        + (el.dataset.bt ? `<span class="hero-chip hero-badge"><span aria-hidden="true">${esc(el.dataset.be)}</span>${esc(el.dataset.bt)}</span>` : '')
        + '<span class="hero-chip hero-src" hidden></span>'
        + (n > 1 ? (n <= DOTS ? `<span class="hero-dots" aria-hidden="true">${list.map(() => '<i></i>').join('')}</span>` : '<span class="hero-chip hero-count" aria-hidden="true"></span>')
          + `<button type="button" class="hero-nav prev" aria-label="Previous photo">${CHEV('M15 5l-7 7 7 7')}</button><button type="button" class="hero-nav next" aria-label="Next photo">${CHEV('M9 5l7 7-7 7')}</button>` : '')
        + (write ? `<button type="button" class="hero-chip hero-add" data-ph-add ${addTxt ? 'disabled' : ''} aria-label="${esc(full ? `${MAX} of ${MAX} photos, the limit` : busy ? 'Adding photos' : 'Add photos of ' + own.label)}">${addTxt || '+ Photo'}</button>` : '');
    } else if (mode === 'empty') html = `<span class="hero-e" aria-hidden="true">${esc(el.dataset.e)}</span><p class="hero-msg">No photos yet</p>`
      + (write ? `<button type="button" class="hero-cta" data-ph-add ${busy ? 'disabled' : ''}>${busy ? 'Adding…' : 'Add the first photo'}</button>` : '');
    el.className = 'hero ' + (mode === 'photos' ? 'has' : 'cover') + (mode === 'loading' ? ' loading' : '');
    el.innerHTML = html;
    if (write) el.querySelectorAll('[data-ph-add]').forEach(b => b.addEventListener('click', () => pick(own.owner, own.label)));
    const track = el.querySelector('.hero-track');
    if (track) {
      const at = () => Math.max(0, Math.min(n - 1, slideAt(track)));
      let raf = 0;
      const sync = () => { // dots, counter, arrows and the source caption follow the slide in view, and its full photo is fetched
        raf = 0; const i = at(), p = list[i]; need(list, i);
        el.querySelectorAll('.hero-dots i').forEach((d, j) => d.classList.toggle('on', j === i));
        const c = el.querySelector('.hero-count'); if (c) c.textContent = `${i + 1} / ${n}`;
        const s = el.querySelector('.hero-src'); s.hidden = p.own; if (!p.own) s.innerHTML = PIN + `<span>${esc(p.label)}</span>`;
        const pv = el.querySelector('.hero-nav.prev'), nx = el.querySelector('.hero-nav.next'); if (pv) { pv.disabled = i === 0; nx.disabled = i === n - 1; }
      };
      track.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(sync); }, { passive: true });
      track.querySelectorAll('.hero-slide').forEach(b => b.addEventListener('click', () => open(srcs, +b.dataset.i)));
      el.querySelectorAll('.hero-nav').forEach(b => b.addEventListener('click', () => track.scrollTo({ left: (at() + (b.classList.contains('next') ? 1 : -1)) * track.clientWidth, behavior: smooth() })));
      const j = keep ? list.findIndex(p => p.owner + '/' + p.id === keep) : -1, to = j >= 0 ? j : Math.min(oldI, n - 1); if (to > 0) track.scrollLeft = to * track.clientWidth; // a redraw stays on the photo it showed, or in its place if that one is gone
      sync();
    }
    const f = focus === 'add' ? el.querySelector('[data-ph-add]:not([disabled])') : focus ? [...el.querySelectorAll('.hero-slide')].find(b => b.dataset.o + '/' + b.dataset.id === focus) : null;
    if (f) f.focus({ preventScroll: true });
  }
  // The slide in view gets its full photo, then the next one of the same source does: a section's or place's roll-up
  // sources stay thumbs until one of their own slides is in view.
  function need(list, i) { const p = list[i], nx = list[i + 1]; if (p) want(p.owner, p.id, nx && nx.owner === p.owner ? () => want(nx.owner, nx.id) : null); }
  // An <img> takes its first copy at once. A thumb gives way to the full photo only once that has decoded off-screen, so
  // the swap never blinks, and the box (same slide, same aspect) never moves. data-k: owner/id it shows; data-q: t | f | ''.
  function show(img, p) {
    if (!img) return; const k = p.owner + '/' + p.id;
    if (img.dataset.k !== k || !img.dataset.q) { img.dataset.k = k; img.dataset.q = p.q; if (p.d) img.src = p.d; else img.removeAttribute('src'); return; }
    if (img.dataset.q !== 't' || p.q !== 'f' || img._up === k) return; // _up: the photo whose full copy is on its way into this <img>
    img._up = k; const n = img.cloneNode(); n.removeAttribute('loading'); n.dataset.q = 'f';
    new Promise((res, rej) => { n.onload = res; n.onerror = rej; n.src = p.d; }).then(() => n.decode ? n.decode().catch(() => {}) : null)
      .then(() => { n.onload = n.onerror = null; if (img.isConnected && img.dataset.k === k) { n.alt = img.alt; img.replaceWith(n); } else if (img._up === k) img._up = 0; }, () => {}); // a full copy that is not an image: the thumb stays
  }
  function fill(el, list) { el.querySelectorAll('.hero-slide').forEach((b, i) => { const p = list[i]; if (!p) return; b.classList.toggle('wait', !p.q); show(b.querySelector('img'), p); }); const t = el.querySelector('.hero-track'); if (t) need(list, Math.max(0, Math.min(list.length - 1, slideAt(t)))); } // and the slide in view asks again for a full photo that failed
  function refresh(owner) { heroes(owner).forEach(el => { if (el._raf) return; el._raf = requestAnimationFrame(() => { el._raf = 0; if (el.isConnected) draw(el); }); }); if (lb && lb.srcs.some(s => s.owner === owner)) showLb(true); }
  function mount(root) { root.querySelectorAll('.hero[data-owner]').forEach(el => { draw(el); if (api) sourcesOf(el).forEach(s => load(s.owner).catch(() => {})); }); } // every source at once, each through its own cache

  // ---------- lightbox ----------
  // It shows the hero's combined list: the panel's own photos, then each extra source's. Delete acts on the photo's real owner.
  let lb = null; // { el, srcs, i, o, id }
  function open(srcs, i, label) {
    if (typeof srcs === 'string') srcs = [{ owner: srcs, label: label || '' }]; // open(owner, i, label): one owner's photos
    close(true);
    const el = document.createElement('div');
    el.className = 'lb'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Photos of ' + srcs[0].label); el.tabIndex = -1;
    el.innerHTML = `<div class="lb-bar"><div class="lb-meta"><span class="lb-n" aria-live="polite"></span><span class="lb-src" hidden></span></div><button type="button" class="lb-btn lb-x" aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
      <div class="lb-stage"><img alt=""></div>
      <button type="button" class="lb-btn lb-prev" aria-label="Previous photo"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button><button type="button" class="lb-btn lb-next" aria-label="Next photo"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button>
      <div class="lb-foot"><button type="button" class="btn sm lb-del">Delete</button><div class="lb-confirm" hidden><span>Delete this photo?</span><button type="button" class="btn sm lb-yes">Delete</button><button type="button" class="btn sm quiet lb-no">Keep</button></div></div>`;
    (document.getElementById('app') || document.body).appendChild(el);
    lb = { el, srcs, i };
    el.querySelector('.lb-x').addEventListener('click', () => close());
    el.querySelector('.lb-prev').addEventListener('click', () => step(-1));
    el.querySelector('.lb-next').addEventListener('click', () => step(1));
    el.querySelector('.lb-stage').addEventListener('click', ev => { if (ev.target === ev.currentTarget) close(); }); // a tap on the scrim, not the photo
    el.querySelector('.lb-del').addEventListener('click', () => confirmDel(true));
    el.querySelector('.lb-no').addEventListener('click', () => confirmDel(false));
    el.querySelector('.lb-yes').addEventListener('click', delCurrent);
    window.addEventListener('keydown', onKey, true);
    showLb();
    el.querySelector('.lb-x').focus();
  }
  function showLb(anchor) { // anchor: a cache change; stay on the same photo if it is still there
    if (!lb) return;
    const list = combined(lb.srcs), n = list.length; if (!n) { close(); return; }
    if (anchor && lb.id) { const j = list.findIndex(p => p.owner === lb.o && p.id === lb.id); if (j >= 0) lb.i = j; }
    lb.i = Math.max(0, Math.min(n - 1, lb.i)); const p = list[lb.i], el = lb.el; lb.id = p.id; lb.o = p.owner;
    show(el.querySelector('.lb-stage img'), p); el.querySelector('.lb-stage img').alt = `Photo ${lb.i + 1} of ${n}, ${p.label}`; need(list, lb.i); // the thumb at once, the full photo when it is in
    el.querySelector('.lb-n').textContent = `${lb.i + 1} of ${n}`;
    const src = el.querySelector('.lb-src'); src.hidden = p.own; if (!p.own) src.innerHTML = PIN + `<span>${esc(p.label)}</span>`;
    el.querySelector('.lb-prev').hidden = el.querySelector('.lb-next').hidden = n < 2;
    el.querySelector('.lb-foot').hidden = !canWrite() || !api;
  }
  function step(d) { if (!lb) return; const n = combined(lb.srcs).length; if (n < 2) return; lb.i = (lb.i + d + n) % n; confirmDel(false); showLb(); }
  function confirmDel(on) { if (!lb) return; lb.el.querySelector('.lb-confirm').hidden = !on; lb.el.querySelector('.lb-del').hidden = on; if (on) lb.el.querySelector('.lb-no').focus(); }
  async function delCurrent() {
    if (!lb) return; const { o: owner, id } = lb, yes = lb.el.querySelector('.lb-yes'); yes.disabled = true;
    try { await remove(owner, id); toast('Photo deleted'); if (lb) { confirmDel(false); lb.el.querySelector('.lb-x').focus(); } }
    catch (err) { console.warn('photo delete failed', err); toast('Could not delete the photo. Try again.', 3000); }
    if (lb) yes.disabled = false;
  }
  function onKey(e) {
    if (!lb) return;
    e.stopPropagation(); // the app's own keys (Escape goes up a level, +/- zoom) wait until the lightbox is closed
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    else if (e.key === 'Tab') { // keep focus inside the dialog
      const f = [...lb.el.querySelectorAll('button')].filter(b => !b.disabled && b.offsetParent !== null); if (!f.length) return;
      const i = f.indexOf(document.activeElement); if (e.shiftKey ? i <= 0 : i === f.length - 1 || i < 0) { e.preventDefault(); f[e.shiftKey ? f.length - 1 : 0].focus(); }
    }
  }
  function close(quiet) {
    if (!lb) return; const { el, srcs, o, id } = lb; lb = null;
    window.removeEventListener('keydown', onKey, true); el.remove();
    if (quiet) return;
    const box = [...document.querySelectorAll('.hero[data-owner]')].find(b => b.dataset.owner === srcs[0].owner); if (!box) return; // back to the hero, on the photo it showed
    const slides = [...box.querySelectorAll('.hero-slide')], s = slides.find(b => b.dataset.o === o && b.dataset.id === id), track = box.querySelector('.hero-track');
    if (s && track) track.scrollLeft = slides.indexOf(s) * track.clientWidth;
    const t = s || slides[0] || box.querySelector('[data-ph-add]:not([disabled])');
    if (t) t.focus({ preventScroll: true });
  }

  return {
    MAX, init, block, cover, mount, preload, add, remove, removeAll, downscale, open, close,
    list: owner => (entry(owner).known ? Promise.resolve() : load(owner)).then(() => ordered(owner)), // [{ id, d: best copy in memory, w, h, q: 'f' | 't' | '' }]
    // tests: fill the cache without the network. recs: {id: full record, or true for a photo whose full copy is not in}; thumbs: {id: thumb}
    prime(owner, recs, thumbs) {
      const e = entry(owner); e.ver++; Object.assign(e, { ids: {}, known: true, th: {}, full: {}, bad: {}, at: Date.now() });
      for (const id in recs || {}) { e.ids[id] = true; const f = okRec(recs[id]); if (f) e.full[id] = f; else if (recs[id] !== true) e.bad[id] = true; }
      for (const id in thumbs || {}) { const t = okRec(thumbs[id]); if (t) { e.th[id] = t; e.ids[id] = true; } }
      refresh(owner);
    },
  };
})();
