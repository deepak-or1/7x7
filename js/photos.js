// Photos on spots, sections and places (hosted site only). They live beside the log, not in it, so the live log
// stream never carries them: logs/<key>-ph/<owner>/<photoId> = { d: JPEG data URL, w, h, at, by?, taken? } is the photo,
// and logs/<key>-pt/<owner>/<photoId> = { d, w, h, by?, taken? } its thumb (longest edge 480). An owner's ids come from a
// shallow read of -ph, which stays the source of truth: a thumb whose id is not listed there is ignored (clients on older
// code add photos without thumbs and delete photos without their thumbs). logs/<key>-po/<owner> = { ids: [...] } is the
// order a writer chose (the first is the cover); it is read beside the id list, ids it names that still exist come first,
// in its order, then the rest in id (upload) order, and older clients never read it. A hero paints thumbs at once and
// fetches the full photo only for the slide in view; photo records never change once written (an edit writes a new id),
// so IndexedDB keeps a copy of both and a second visit paints with no network wait. This file owns the downscale, the
// caches, the photo hero at the top of a panel (a section or place also shows the photos of what is inside it), and the
// lightbox (swipe, zoom, the thumbnail strip with reordering, delete, crop and rotate).
// init({ api, toast, canWrite, who, onAdded, onTaken }): who() is this device's display name, stored as `by` on new photos;
// onAdded(owner, ids, label) after an add batch that added any; onTaken(owner, 'YYYY-MM-DD', label) with the earliest
// capture date (EXIF DateTimeOriginal) in that batch, when one was found.
window.Photos = (() => {
  const MAX = 8, EDGE = 2560, TEDGE = 480, BIG = 1800000, FRESH = 60000; // EDGE: four times the pixels of a phone screen's width, so a photo holds up when zoomed; BIG: past this many characters it is saved a step lower in quality; FRESH: a panel opened again after a minute re-reads the list in the background
  const XMAX = 12, DOTS = 8; // XMAX: extra sources rolled into one hero; DOTS: past this many photos the hero shows a counter instead of dots
  const LOCAL_MS = 500, RETRY = 5000; // LOCAL_MS: a local copy slower than this is skipped; RETRY: a failed photo is not asked for again sooner
  const NAME = 24, OMAX = 64, OKEY = '.order'; // NAME: longest `by`; OMAX: ids kept from an order record (anyone can write one); OKEY: the order's IndexedDB slot beside the thumbs (a Firebase key never holds a '.', so no photo id can be it)
  const ZMAX = 4, ZTAP = 2.5, HOLD = 320; // zoom limit, the double-tap zoom, the press that lifts a thumb in the strip
  const PIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6-5.3-6-11a6 6 0 0 1 12 0c0 5.7-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/></svg>';
  const CHEV = d => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
  const SVG = { trash: CHEV('M4 7h16M10 3.5h4M6.5 7l.9 12.1A2 2 0 0 0 9.4 21h5.2a2 2 0 0 0 2-1.9L17.5 7M10 11v6M14 11v6'), crop: CHEV('M6 2.5V16a2 2 0 0 0 2 2h13.5M2.5 6H16a2 2 0 0 1 2 2v13.5'), rot: CHEV('M3.5 12.5a8 8 0 1 0 2.4-6.1M3.5 3.5v4.5H8') };
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const plural = n => n + (n === 1 ? ' photo' : ' photos');
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  let api = null, toast = () => {}, canWrite = () => true, who = null, onAdded = null, onTaken = null;
  // owner -> { ids: {id: true} | null, known: ids came from the server (not only the local copy), th / full: {id: rec},
  //            bad: {id: true} (not a photo), fk: ids whose full photo is in IndexedDB, got / miss: full photo in flight / failed at,
  //            order: [id] a writer chose | null, at, ver, loading, busy, local: IndexedDB was read, ow: order writes in flight }
  const cache = {};
  const entry = o => cache[o] || (cache[o] = { ids: null, known: false, th: {}, full: {}, bad: {}, fk: new Set(), got: {}, miss: {}, order: null, at: 0, ver: 0, loading: null, busy: 0, local: false });
  const isImg = d => typeof d === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(d); // never a remote URL: a record is written by anyone with the link
  const okName = s => typeof s === 'string' ? Array.from(s.replace(/[\x00-\x1f\x7f]/g, '').replace(/\s+/g, ' ').trim()).slice(0, NAME).join('').trim() : ''; // cut by code point, so an emoji is never split
  const okDay = s => typeof s === 'string' && /^(19|20|21)\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(s) ? s : undefined;
  const okRec = r => r && typeof r === 'object' && isImg(r.d) ? { d: r.d, w: +r.w || 0, h: +r.h || 0, at: typeof r.at === 'string' ? r.at : undefined, by: okName(r.by) || undefined, taken: okDay(r.taken) } : null; // full or thumb, only the fields we use
  const okOrder = r => r && typeof r === 'object' && Array.isArray(r.ids) ? [...new Set(r.ids.slice(0, OMAX).filter(s => typeof s === 'string' && s.length <= 64 && !/[.$#[\]/]/.test(s)))] : null;
  // one owner's photos in display order (the chosen order, then id order); d is the best copy in memory (the full photo,
  // else the thumb, else '': a loading slide), q says which; t: the thumb, for the strip
  const ordered = o => {
    const e = cache[o]; if (!e || !e.ids) return [];
    const rank = new Map(); (e.order || []).forEach((id, i) => rank.has(id) || rank.set(id, i));
    const at = id => rank.has(id) ? rank.get(id) : Infinity;
    return Object.keys(e.ids).filter(id => !e.bad[id]).sort((a, b) => at(a) - at(b) || (a < b ? -1 : a > b ? 1 : 0)).map(id => {
      const f = e.full[id], t = e.th[id], r = f || t;
      return { id, d: r ? r.d : '', w: r ? r.w : 0, h: r ? r.h : 0, q: f ? 'f' : r ? 't' : '', t: t ? t.d : '', at: f && f.at, by: (f && f.by) || (t && t.by), taken: (f && f.taken) || (t && t.taken) };
    });
  };
  const newId = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 4).padEnd(2, '0');
  const later = ms => new Promise(r => setTimeout(() => r(null), ms));
  const call = (fn, ...a) => { if (typeof fn === 'function') { try { fn(...a); } catch (err) { console.warn('photos hook failed', err); } } };
  const myName = () => { try { return who ? okName(who()) : ''; } catch (err) { return ''; } };
  function init(o) { // app.js passes api, toast and canWrite; a later call (tests) may set only the hooks
    if ('api' in o) api = o.api || null;
    if (o.toast) toast = o.toast; if (o.canWrite) canWrite = o.canWrite;
    if ('who' in o) who = typeof o.who === 'function' ? o.who : null;
    if ('onAdded' in o) onAdded = o.onAdded; if ('onTaken' in o) onTaken = o.onTaken;
  }

  // ---------- the local copy: IndexedDB stores t (thumbs, and the order under OKEY) and f (full photos), keyed <log key>/<owner>/<id> ----------
  // Every call resolves, never rejects: no IndexedDB (a private window, an old browser, a full disk) just means memory only.
  const idb = (() => {
    let dbp = null;
    const key = (o, id) => api.key + '/' + o + '/' + id;
    const open = () => dbp || (dbp = new Promise(res => {
      try { const r = indexedDB.open('sbs-photos', 1); r.onupgradeneeded = () => ['t', 'f'].forEach(s => r.result.objectStoreNames.contains(s) || r.result.createObjectStore(s)); r.onsuccess = () => { const d = r.result; d.onversionchange = () => { d.close(); dbp = null; }; res(d); }; r.onerror = () => res(null); } catch (e) { res(null); }
    }));
    const tx = (stores, mode, fn) => (api && api.key ? open() : Promise.resolve(null)).then(d => d && new Promise(res => { try { const t = d.transaction(stores, mode), out = fn(t); t.oncomplete = () => res(out ? out() : true); t.onerror = t.onabort = () => res(null); } catch (e) { res(null); } }));
    const range = o => { const p = key(o, ''); return [p, IDBKeyRange.bound(p, p + '￿')]; };
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
  const keepOrder = (owner, ids) => ids && ids.length ? idb.put('t', owner, OKEY, { ids }) : idb.del(owner, OKEY);

  // ---------- the list: ids, order and thumbs ----------
  // The id list and the order go out at once. The local copy paints as soon as it is read; with nothing local the thumbs
  // go out too, beside the id list, and otherwise only the thumbs it lacks are asked for once the list is in. The list and
  // its thumbs land together, so a hero never flashes loading slides for photos whose thumbs are a moment behind.
  function load(owner, force) {
    const e = entry(owner);
    if (e.loading) return e.loading;
    if (e.known && !force && Date.now() - e.at < FRESH) return Promise.resolve();
    if (!api) return Promise.reject(new Error('photos are not available'));
    const ver = e.ver, ids = api.ids(owner), ord = api.order ? api.order(owner).then(okOrder, () => undefined) : Promise.resolve(undefined); // undefined: the order could not be read, keep what is known
    ids.catch(() => {}); // handled below, once the local copy is read
    const local = e.local ? Promise.resolve(null) : (e.local = true, Promise.race([idb.read(owner), later(LOCAL_MS)]));
    e.loading = local.then(loc => {
      if (loc) {
        const ts = loc.t.filter(([id]) => id !== OKEY), lo = loc.t.find(([id]) => id === OKEY);
        if (lo && !e.order && e.ver === ver) e.order = okOrder(lo[1]); // the last order seen, so the local paint already has the chosen cover
        ts.forEach(([id, r]) => { const t = okRec(r); if (t && !e.th[id]) e.th[id] = t; }); loc.f.forEach(id => e.fk.add(id));
        if (!e.ids && ts.length && e.ver === ver) { e.ids = {}; ts.forEach(([id]) => { if (e.th[id]) e.ids[id] = true; }); refresh(owner); } // paint the local copy now; the server's list corrects it below
      }
      const all = !e.known && !Object.keys(e.th).length ? api.thumbs(owner) : null; // nothing local: every thumb, alongside the id list
      if (all) all.catch(() => {});
      return ids.then(list => {
        const miss = Object.keys(list).filter(id => !e.th[id]);
        const th = all || (!miss.length ? Promise.resolve({}) : miss.length > 2 ? api.thumbs(owner) : Promise.all(miss.map(id => api.thumb(owner, id).then(t => [id, t]))).then(Object.fromEntries));
        return th.catch(() => ({})).then(t => ord.then(o => [list, t, o])); // no thumbs (older photos, a failed read): those slides load their full photo
      });
    }).then(([list, th, ord]) => {
      e.loading = null; e.at = Date.now();
      if (e.ver === ver) { // a local add, delete or reorder while this was in flight wins; the next open re-reads
        for (const id in th) { const t = okRec(th[id]); if (t && list[id] && !e.th[id]) { e.th[id] = t; idb.put('t', owner, id, t); } } // a thumb with no photo behind it is ignored
        if (ord !== undefined && JSON.stringify(ord) !== JSON.stringify(e.order)) { e.order = ord; keepOrder(owner, ord); }
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
  function fullOf(owner, id) { // the full photo, fetched now if it is not in (the crop editor works from it)
    const e = entry(owner); if (e.full[id]) return Promise.resolve(e.full[id]);
    want(owner, id); return Promise.resolve(e.got[id]).then(() => e.full[id] || Promise.reject(new Error('the full photo is not available')));
  }
  // An older photo has no thumb: make one from the full photo, keep it, and (anyone who may write) store it for everyone.
  function backfill(owner, id, f) {
    thumbOf(f.d).then(t => {
      const e = entry(owner); if (!e.ids || !e.ids[id] || e.th[id]) return;
      if (f.by) t.by = f.by; if (f.taken) t.taken = f.taken;
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
  const encode = c => { let d = c.toDataURL('image/jpeg', 0.85); if (d.length > BIG) d = c.toDataURL('image/jpeg', 0.75); return { d, w: c.width, h: c.height }; }; // an upload and an edit save alike
  const thumbAt = (src, W, H) => { const c = canvasOf(src, W, H, TEDGE); return { d: c.toDataURL('image/jpeg', 0.7), w: c.width, h: c.height }; };
  const thumbOf = d => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(thumbAt(i, i.naturalWidth, i.naturalHeight)); i.onerror = () => rej(new Error('could not read the image')); i.src = d; });
  async function shrink(file) { // the photo and its thumb, both from one decode
    const src = await decode(file), W = src.naturalWidth || src.width, H = src.naturalHeight || src.height;
    if (!W || !H) throw new Error('empty image');
    const c = canvasOf(src, W, H, EDGE); if (src.close) src.close();
    return { rec: Object.assign(encode(c), { at: new Date().toISOString() }), th: thumbAt(c, c.width, c.height) };
  }
  const downscale = file => shrink(file).then(r => r.rec);

  // ---------- the capture date, read from the original file before it is downscaled (the canvas drops all metadata) ----------
  // JPEG: the APP1 Exif segment; HEIC: its Exif item. Anything odd (a truncated file, an offset past the end) throws a
  // RangeError out of the DataView and is no date.
  async function takenOf(file) {
    try {
      const v = new DataView(await file.slice(0, 131072).arrayBuffer());
      if (v.getUint16(0) === 0xFFD8) return jpegDate(v);
      if (v.getUint32(4) === 0x66747970) return await heicDate(file, v); // 'ftyp'
    } catch (e) {}
    return undefined;
  }
  function jpegDate(v) {
    for (let p = 2; p + 4 <= v.byteLength;) {
      if (v.getUint8(p) !== 0xFF) return;
      const m = v.getUint8(p + 1);
      if (m === 0xFF) { p++; continue; } // a fill byte
      if (m === 0x01 || (m >= 0xD0 && m <= 0xD8)) { p += 2; continue; } // markers with no length
      if (m === 0xDA || m === 0xD9) return; // the image data: no Exif before it
      const len = v.getUint16(p + 2);
      if (m === 0xE1 && len > 16 && v.getUint32(p + 4) === 0x45786966 && v.getUint16(p + 8) === 0) return tiffDate(v, p + 10, Math.min(v.byteLength, p + 2 + len)); // 'Exif\0\0'
      p += 2 + len;
    }
  }
  function tiffDate(v, t, end) { // t: where the TIFF header starts; both byte orders
    const bo = v.getUint16(t); if (bo !== 0x4949 && bo !== 0x4D4D) return;
    const le = bo === 0x4949, lim = end - t, u16 = o => v.getUint16(t + o, le), u32 = o => v.getUint32(t + o, le);
    if (u16(2) !== 42) return;
    const tag = (ifd, want) => { if (ifd < 8 || ifd + 2 > lim) return -1; const n = Math.min(u16(ifd), 400); for (let k = 0; k < n; k++) { const at = ifd + 2 + k * 12; if (at + 12 > lim) return -1; if (u16(at) === want) return at; } return -1; };
    const ex = tag(u32(4), 0x8769); if (ex < 0) return; // the Exif IFD pointer in IFD0
    const dt = tag(u32(ex + 8), 0x9003); if (dt < 0 || u16(dt + 2) !== 2 || u32(dt + 4) < 11) return; // DateTimeOriginal, ASCII 'YYYY:MM:DD HH:MM:SS'
    const off = u32(dt + 8); if (off + 10 > lim) return;
    let s = ''; for (let k = 0; k < 10; k++) s += String.fromCharCode(v.getUint8(t + off + k));
    const m = /^(\d{4}):(\d\d):(\d\d)$/.exec(s); return m ? okDay(`${m[1]}-${m[2]}-${m[3]}`) : undefined;
  }
  async function heicDate(file, v) { // ISO BMFF: meta > iinf names the 'Exif' item, meta > iloc says where its bytes are
    const n64 = o => Number(v.getBigUint64(o)), int = (o, sz) => sz === 4 ? v.getUint32(o) : sz === 8 ? n64(o) : sz === 2 ? v.getUint16(o) : 0;
    const boxes = (s, e, fn) => { for (let p = s; p + 8 <= e;) { let n = v.getUint32(p), h = 8; if (n === 1) { n = n64(p + 8); h = 16; } else if (n === 0) n = e - p; if (n < h || p + n > e) return; fn(v.getUint32(p + 4), p + h, p + n); p += n; } };
    let meta = null, iinf = null, iloc = null, item = -1;
    boxes(0, v.byteLength, (ty, s, e) => { if (ty === 0x6D657461 && !meta) meta = [s + 4, e]; }); // 'meta', a full box
    if (!meta) return;
    boxes(meta[0], meta[1], (ty, s, e) => { if (ty === 0x69696E66) iinf = [s, e]; else if (ty === 0x696C6F63) iloc = [s, e]; }); // 'iinf', 'iloc'
    if (!iinf || !iloc) return;
    const iv = v.getUint8(iinf[0]);
    boxes(iinf[0] + (iv ? 8 : 6), iinf[1], (ty, s) => { // 'infe' version 2 (16-bit ids) or 3 (32-bit)
      if (ty !== 0x696E6665 || item >= 0) return; const fv = v.getUint8(s); if (fv < 2) return;
      const id = fv === 2 ? v.getUint16(s + 4) : v.getUint32(s + 4), type = v.getUint32(s + (fv === 2 ? 8 : 10));
      if (type === 0x45786966) item = id; // 'Exif'
    });
    if (item < 0) return;
    const lv = v.getUint8(iloc[0]), sizes = v.getUint8(iloc[0] + 4), more = v.getUint8(iloc[0] + 5), os = sizes >> 4, ls = sizes & 15, bs = more >> 4, xs = lv ? more & 15 : 0;
    let p = iloc[0] + 6; const count = lv < 2 ? v.getUint16(p) : v.getUint32(p); p += lv < 2 ? 2 : 4;
    for (let k = 0; k < count && p < iloc[1]; k++) {
      const id = lv < 2 ? v.getUint16(p) : v.getUint32(p); p += lv < 2 ? 2 : 4;
      let method = 0; if (lv) { method = v.getUint16(p) & 15; p += 2; }
      p += 2; const base = int(p, bs); p += bs; const ext = v.getUint16(p); p += 2;
      if (id !== item) { p += ext * (xs + os + ls); continue; }
      if (method !== 0 || !ext) return; // only bytes in the file itself
      p += xs; const off = base + int(p, os); p += os; const len = int(p, ls) || 65536;
      const x = new DataView(await file.slice(off, off + Math.min(len, 65536)).arrayBuffer()), skip = x.getUint32(0); // the item starts with the offset of its TIFF header
      return tiffDate(x, 4 + skip, x.byteLength);
    }
  }

  // ---------- add / remove / reorder / replace ----------
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
    const added = [], days = [], by = myName(); let failed = null;
    for (const f of take) { // one at a time, so ids (time-based) sort in upload order
      try {
        const taken = await takenOf(f), { rec, th } = await shrink(f), id = newId();
        if (by) rec.by = th.by = by; if (taken) rec.taken = th.taken = taken;
        await api.put(owner, id, rec);
        e.ver++; e.ids = Object.assign({}, e.ids, { [id]: true }); e.full[id] = rec; e.th[id] = th; e.fk.add(id); idb.put('f', owner, id, rec); idb.put('t', owner, id, th);
        api.putThumb(owner, id, th).catch(err => console.warn('thumb upload failed', err)); // right after its photo; without it, the first viewer who may write makes one
        added.push(id); if (taken) days.push(taken); refresh(owner);
      }
      catch (err) { failed = err; console.warn('photo upload failed', err); break; }
    }
    e.busy--; refresh(owner);
    if (failed) toast('Could not add the photo. Try again.', 3000);
    else if (!had && added.length && label) { if (window.Confetti) window.Confetti.burst(); toast(`First photo of ${label}`, 2600); } // its very first photo: a small party
    else toast(`${plural(added.length)} added${take.length < files.length ? ` (${MAX} is the limit)` : ''}`);
    if (added.length) { call(onAdded, owner, added.slice(), label); if (days.length) call(onTaken, owner, days.sort()[0], label); }
    return added;
  }
  async function remove(owner, id) {
    if (!api) throw new Error('photos are not available');
    await api.del(owner, id); // the photo, then its thumb
    const e = entry(owner); e.ver++; forget(e, owner, id);
    if (e.order && e.order.includes(id)) { // and out of the order, so a stale id never sits in it
      const ids = e.order.filter(x => x !== id); e.order = ids.length ? ids : null; keepOrder(owner, ids);
      if (api.putOrder) api.putOrder(owner, ids.length ? { ids } : null).catch(err => console.warn('order update failed', err));
    }
    refresh(owner);
  }
  function removeAll(owner) { // a deleted spot: best effort, never in the way
    const e = entry(owner); e.ver++; Object.assign(e, { ids: {}, known: true, th: {}, full: {}, bad: {}, fk: new Set(), order: null, at: Date.now() }); idb.drop(owner);
    return api ? api.delAll(owner).catch(err => console.warn('photo cleanup failed', err)) : Promise.resolve();
  }
  // ids: the owner's photos in their new order, the first is the cover. Any it leaves out keep their place after it.
  // An owner's order writes go one at a time, each sending the latest order, so a slow write never lands after a newer
  // one; only the last one's failure goes back (to the last order saved) and says so.
  async function reorder(owner, ids) {
    if (!api || !api.putOrder || !canWrite()) return false;
    const e = entry(owner), have = ordered(owner).map(p => p.id), before = e.order;
    const next = (okOrder({ ids }) || []).filter(id => have.includes(id)); have.forEach(id => next.includes(id) || next.push(id));
    if (next.join() === have.join()) return true;
    const w = e.ow || (e.ow = { p: Promise.resolve(), n: 0, saved: before }), me = ++w.n; w.ids = next; // e.ow: this owner's order writes; saved: the order the server holds
    e.ver++; e.order = next; keepOrder(owner, next); refresh(owner);
    let err = null;
    await (w.p = w.p.then(() => { const ids = w.ids; if (ids !== w.saved) return api.putOrder(owner, { ids }).then(() => { w.saved = ids; }); }).catch(x => { err = x; })); // an earlier write that already sent the latest order leaves nothing to send
    e.ver++; // a list read that started during the write must not bring the old order back
    if (me !== w.n) return !err; // a newer drag's write follows; it decides
    e.ow = null; if (!err) return true;
    console.warn('order save failed', err); if (e.order === next) { e.order = w.saved; keepOrder(owner, w.saved); refresh(owner); } toast('Could not save the order. Try again.', 3000); return false;
  }
  // An edited photo: a new id (records never change), put in the old one's place in the order, then the old one goes.
  async function replace(owner, old, rec, th) {
    if (!api || !api.putOrder) throw new Error('photos are not available');
    const e = entry(owner), id = newId(), base = ordered(owner).map(p => p.id);
    await api.put(owner, id, rec);
    e.ver++; e.ids = Object.assign({}, e.ids, { [id]: true }); e.full[id] = rec; e.th[id] = th; e.fk.add(id); idb.put('f', owner, id, rec); idb.put('t', owner, id, th);
    await api.putThumb(owner, id, th).catch(err => console.warn('thumb upload failed', err));
    const ids = base.includes(old) ? base.map(x => x === old ? id : x) : base.concat(id), before = e.order;
    e.ver++; e.order = ids; keepOrder(owner, ids);
    if (lb && lb.o === owner && lb.id === old) lb.id = id; // the lightbox follows the new copy
    try { await api.putOrder(owner, { ids }); e.ver++; } // a list read that started before the order landed must not bring the old one back
    catch (err) { e.ver++; e.order = before; keepOrder(owner, before); if (lb && lb.id === id) lb.id = old; await api.del(owner, id).catch(() => {}); forget(e, owner, id); refresh(owner); throw err; }
    try { await api.del(owner, old); e.ver++; forget(e, owner, old); } catch (err) { console.warn('old photo not deleted', err); } // left behind, it shows after the others
    refresh(owner);
    return id;
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
  const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  const smooth = () => still() ? 'auto' : 'smooth';
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
  // It shows the hero's combined list: the panel's own photos, then each extra source's. Delete and edit act on the photo's
  // real owner; reordering only moves the panel's own photos among themselves. The stage is a rail of three slides (the
  // photo before, the one in view, the one after), so a swipe drags real neighbours and a settled swipe only moves one
  // slide from one end to the other. Gestures are pointer events with touch-action: none on the lightbox, plus non-passive
  // touchmove and Safari gesture listeners, so no page scroll or browser zoom gets through on iOS.
  let lb = null; // { el, srcs, i, o, id, rail, stage, z: { s, x, y } zoom of the slide in view, g: stage gesture, drag: strip drag, ed: editor, anim, dirty }
  const writable = () => canWrite() && !!api;
  const day = s => { // 'YYYY-MM-DD' or an ISO time -> 'Nov 5' ('Nov 5, 2024' in another year)
    const m = /^(\d{4})-(\d\d)-(\d\d)/.exec(s || ''); if (!m) return '';
    const d = new Date(+m[1], +m[2] - 1, +m[3]), t = s.length > 10 ? new Date(s) : d, o = { month: 'short', day: 'numeric' };
    if (isNaN(t)) return ''; if (t.getFullYear() !== new Date().getFullYear()) o.year = 'numeric';
    return t.toLocaleDateString('en-US', o);
  };
  const infoOf = p => { const t = day(p.taken), a = day(p.at); return [t ? 'Taken ' + t : '', p.by ? 'Added by ' + p.by + (!t && a ? ', ' + a : '') : !t && a ? 'Added ' + a : ''].filter(Boolean).join(' · '); };
  function open(srcs, i, label) {
    if (typeof srcs === 'string') srcs = [{ owner: srcs, label: label || '' }]; // open(owner, i, label): one owner's photos
    close(true);
    const el = document.createElement('div');
    el.className = 'lb'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Photos of ' + srcs[0].label); el.tabIndex = -1;
    el.innerHTML = `<div class="lb-bar"><div class="lb-meta"><div class="lb-l1"><span class="lb-n" aria-live="polite"></span><span class="lb-src" hidden></span></div><div class="lb-info"></div></div><button type="button" class="lb-btn lb-x" aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
      <div class="lb-stage"><div class="lb-rail">${'<div class="lb-slide"><div class="lb-zoom"><img alt="" draggable="false"></div></div>'.repeat(3)}</div></div>
      <button type="button" class="lb-btn lb-nav lb-prev" aria-label="Previous photo"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button><button type="button" class="lb-btn lb-nav lb-next" aria-label="Next photo"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button>
      <div class="lb-foot"><p class="lb-hint" aria-hidden="true">The first photo is the cover</p><div class="lb-strip" role="group" aria-label="All photos"></div>
        <div class="lb-tools"><button type="button" class="lb-btn lb-edit" aria-label="Crop and rotate">${SVG.crop}</button><button type="button" class="lb-btn lb-del" aria-label="Delete photo">${SVG.trash}</button></div></div>
      <div class="lb-dlg" hidden><div class="lb-card" role="alertdialog" aria-modal="true" aria-labelledby="lb-dlg-t" aria-describedby="lb-dlg-d"><h2 id="lb-dlg-t">Delete this photo?</h2><p id="lb-dlg-d">It goes for everyone who has the link.</p><div class="lb-acts"><button type="button" class="lb-no">Keep</button><button type="button" class="lb-yes">Delete</button></div></div></div>`;
    (document.getElementById('app') || document.body).appendChild(el);
    lb = { el, srcs, i, rail: el.querySelector('.lb-rail'), stage: el.querySelector('.lb-stage'), z: { s: 1, x: 0, y: 0 } };
    el.querySelector('.lb-x').addEventListener('click', () => close());
    el.querySelector('.lb-prev').addEventListener('click', () => step(-1));
    el.querySelector('.lb-next').addEventListener('click', () => step(1));
    el.querySelector('.lb-del').addEventListener('click', () => confirmDel(true));
    el.querySelector('.lb-edit').addEventListener('click', editCurrent);
    el.querySelector('.lb-no').addEventListener('click', () => confirmDel(false));
    el.querySelector('.lb-yes').addEventListener('click', delCurrent);
    el.querySelector('.lb-dlg').addEventListener('click', ev => { if (ev.target === ev.currentTarget) confirmDel(false); }); // a tap beside the card keeps the photo
    stageGestures(lb.stage); stripGestures(el.querySelector('.lb-strip'));
    // nothing behind the lightbox moves: native scrolling only in the strip (until a thumb is lifted), never a page zoom
    el.addEventListener('touchmove', ev => { if (!lb || lb.ed || (lb.drag && lb.drag.on) || !ev.target.closest('.lb-strip')) ev.preventDefault(); }, { passive: false });
    ['gesturestart', 'gesturechange'].forEach(t => el.addEventListener(t, ev => ev.preventDefault(), { passive: false }));
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('contextmenu', ev => { if (ev.target.closest('.lb-strip, .lb-stage')) ev.preventDefault(); }); // a long press lifts a thumb, it does not save the image
    window.addEventListener('keydown', onKey, true); window.addEventListener('resize', onResize);
    showLb();
    el.querySelector('.lb-x').focus();
  }
  function showLb(anchor) { // anchor: a cache change; stay on the same photo if it is still there
    if (!lb) return;
    if (lb.g || lb.anim || (lb.drag && lb.drag.on)) { lb.dirty = true; return; } // mid-gesture: once it settles
    lb.dirty = false;
    const list = combined(lb.srcs), n = list.length; if (!n) { close(); return; }
    if (anchor && lb.id) { const j = list.findIndex(p => p.owner === lb.o && p.id === lb.id); if (j >= 0) lb.i = j; }
    lb.i = Math.max(0, Math.min(n - 1, lb.i)); const p = list[lb.i], el = lb.el, write = writable();
    if (p.id !== lb.id || p.owner !== lb.o) zoomTo({ s: 1, x: 0, y: 0 });
    lb.id = p.id; lb.o = p.owner;
    [...lb.rail.children].forEach((s, k) => { const q = list[lb.i + k - 1], img = s.querySelector('img'); s.classList.toggle('none', !q); if (q) show(img, q); else { img.removeAttribute('src'); img.dataset.k = img.dataset.q = ''; } });
    need(list, lb.i); // the thumb at once, the full photo when it is in
    meta(list, write);
  }
  function meta(list, write) { // the counter, captions, controls and strip for the photo at lb.i
    const el = lb.el, n = list.length, p = list[lb.i];
    lb.rail.children[1].querySelector('img').alt = `Photo ${lb.i + 1} of ${n}, ${p.label}`;
    el.querySelector('.lb-n').textContent = `${lb.i + 1} of ${n}`;
    const src = el.querySelector('.lb-src'); src.hidden = p.own; if (!p.own) src.innerHTML = PIN + `<span>${esc(p.label)}</span>`;
    el.querySelector('.lb-info').textContent = infoOf(p);
    el.querySelector('.lb-prev').hidden = el.querySelector('.lb-next').hidden = n < 2;
    el.querySelector('.lb-tools').hidden = !write;
    el.querySelector('.lb-foot').hidden = n < 2 && !write;
    strip(list, write);
  }
  // the thumbnail strip: every photo of the hero; a writer's own photos carry data-move and can be lifted and dragged
  function strip(list, write) {
    const st = lb.el.querySelector('.lb-strip'), n = list.length; st.hidden = n < 2; if (n < 2) return;
    const sig = JSON.stringify([list.map(p => p.owner + '/' + p.id), write]); let rebuilt = false;
    if (st._sig !== sig) {
      st._sig = sig; rebuilt = true;
      st.innerHTML = list.map((p, i) => `<button type="button" class="lb-th${i && p.owner !== list[i - 1].owner ? ' gap' : ''}" data-i="${i}" data-id="${esc(p.id)}"${write && p.own ? ' data-move' : ''} aria-label="${esc(`Photo ${i + 1} of ${n}${p.own ? '' : ', ' + p.label}`)}"><img alt="" draggable="false"></button>`).join('');
    }
    st.querySelectorAll('.lb-th').forEach((b, i) => {
      const p = list[i], img = b.querySelector('img'), d = p.t || p.d, on = i === lb.i;
      if (img._d !== d) { img._d = d; if (d) img.src = d; else img.removeAttribute('src'); }
      b.classList.toggle('on', on); if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    });
    const b = (rebuilt || st._i !== lb.i) && st.children[lb.i]; st._i = lb.i; // only a new photo or a new strip scrolls it: a photo loading never undoes the user's own scroll
    if (b) { const l = b.offsetLeft, r = l + b.offsetWidth; if (l < st.scrollLeft + 8) st.scrollLeft = l - 8; else if (r > st.scrollLeft + st.clientWidth - 8) st.scrollLeft = r - st.clientWidth + 8; } // the photo in view stays in view; not scrollIntoView, which also scrolls the page's hidden overflow
  }
  // arrows and keys: one photo over, wrapping at the ends; a neighbour slides in, a wrap jumps
  function step(d) {
    if (!lb || lb.ed || lb.anim || !lb.el.querySelector('.lb-dlg').hidden) return; const n = combined(lb.srcs).length; if (n < 2) return;
    const j = lb.i + d; if (j >= 0 && j < n) slideTo(d); else { lb.i = (j + n) % n; showLb(); }
  }
  const after = (ms, fn) => { const me = lb; setTimeout(() => { if (lb === me) fn(); }, still() ? 0 : ms); };
  function slideTo(d) { // the rail one slide over, then the end slide moves round so the photo in view is the middle one again
    const rail = lb.rail, list = combined(lb.srcs), p = list[lb.i + d]; if (!p) return;
    lb.anim = true; lb.i += d; lb.id = p.id; lb.o = p.owner; meta(list, writable()); need(list, lb.i); // the counter and captions change with the swipe, not after it
    rail.classList.add('go'); rail.style.transform = `translateX(${d > 0 ? -200 / 3 : 0}%)`;
    after(260, () => {
      rail.classList.remove('go'); if (d > 0) rail.appendChild(rail.firstElementChild); else rail.prepend(rail.lastElementChild);
      rail.style.transform = ''; lb.rail.querySelectorAll('.lb-zoom').forEach(w => { w.classList.remove('go'); w.style.transform = ''; });
      lb.anim = false; zoomTo({ s: 1, x: 0, y: 0 }); showLb(true);
    });
  }
  function settleRail() { const rail = lb.rail; lb.anim = true; rail.classList.add('go'); rail.style.transform = ''; after(260, () => { rail.classList.remove('go'); lb.anim = false; if (lb.dirty) showLb(true); }); }

  // ---------- zoom: a transform on the slide's .lb-zoom box (not the <img>, which the full copy replaces mid-zoom) ----------
  const zoomBox = () => lb.rail.children[1].querySelector('.lb-zoom');
  function fit() { // the photo's drawn size at zoom 1 (object-fit: contain) and the stage it may pan across
    const w = zoomBox(), img = w.querySelector('img'), bw = w.clientWidth || 1, bh = w.clientHeight || 1, r = lb.stage.getBoundingClientRect();
    const a = img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : bw / bh, dw = Math.min(bw, bh * a);
    return { dw, dh: dw / a, sw: r.width, sh: r.height, cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  }
  const bounds = (s, f) => [Math.max(0, (f.dw * s - f.sw) / 2), Math.max(0, (f.dh * s - f.sh) / 2)];
  const clampZ = (z, f) => { const [mx, my] = bounds(z.s, f); return { s: z.s, x: clamp(z.x, -mx, mx), y: clamp(z.y, -my, my) }; };
  const rubber = (v, m) => v > m ? m + (v - m) / 3 : v < -m ? -m + (v + m) / 3 : v;
  function zoomTo(z, go) {
    if (!lb) return; lb.z = z; const w = zoomBox();
    w.classList.toggle('go', !!go); w.style.transform = z.s === 1 && !z.x && !z.y ? '' : `translate(${z.x}px, ${z.y}px) scale(${z.s})`;
    lb.el.classList.toggle('zoomed', z.s > 1.01);
    if (go) after(280, () => w.classList.remove('go'));
  }
  // zoom to s about the client point (mx, my), the point under it staying put
  const about = (z, s, mx, my, f) => ({ s, x: mx - f.cx - s * (mx - f.cx - z.x) / z.s, y: my - f.cy - s * (my - f.cy - z.y) / z.s });
  function settleZoom(m) {
    const f = fit(); let z = lb.z;
    if (z.s < 1.02) z = { s: 1, x: 0, y: 0 }; else if (z.s > ZMAX) z = about(z, ZMAX, m ? m.x : f.cx, m ? m.y : f.cy, f);
    zoomTo(clampZ(z, f), true);
  }
  function onImage(x, y) { const f = fit(), z = lb.z; return Math.abs(x - f.cx - z.x) <= f.dw * z.s / 2 && Math.abs(y - f.cy - z.y) <= f.dh * z.s / 2; }

  // ---------- stage gestures: swipe, swipe down to close, pinch, double tap, pan ----------
  function stageGestures(stage) {
    const pts = new Map(); let tap = null, tapTimer = 0;
    const mid = () => { const a = [...pts.values()]; return { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2, d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y) || 1 }; };
    const pinch = () => { const m = mid(); lb.g = { kind: 'pinch', m0: m, z0: Object.assign({}, lb.z), m }; };
    const pan = p => { lb.g = { kind: 'pan', x0: p.x, y0: p.y, z0: Object.assign({}, lb.z), moved: true, hist: [] }; };
    const unswipe = () => { const g = lb.g; if (!g) return; if (g.kind === 'swipe') settleRail(); if (g.kind === 'down') undown(); };
    stage.addEventListener('pointerdown', ev => {
      if (!lb || lb.anim || lb.ed || ev.button > 0) return;
      pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY }); try { stage.setPointerCapture(ev.pointerId); } catch (e) {}
      if (pts.size === 1) lb.g = { kind: lb.z.s > 1.01 ? 'pan' : null, x0: ev.clientX, y0: ev.clientY, t0: performance.now(), z0: Object.assign({}, lb.z), moved: false, hist: [] };
      else if (pts.size === 2) { unswipe(); pinch(); }
    });
    stage.addEventListener('pointermove', ev => {
      const p = pts.get(ev.pointerId); if (!p || !lb || !lb.g) return; p.x = ev.clientX; p.y = ev.clientY;
      const g = lb.g;
      if (g.kind === 'pinch') { if (pts.size < 2) return; const m = mid(), f = fit(), s = clamp(g.z0.s * m.d / g.m0.d, 0.6, ZMAX * 1.5); g.m = m; const z = about(g.z0, s, g.m0.x, g.m0.y, f); z.x += m.x - g.m0.x; z.y += m.y - g.m0.y; zoomTo(z, false); return; } // the point under the fingers stays under them
      if (pts.size > 1) return;
      const dx = ev.clientX - g.x0, dy = ev.clientY - g.y0; g.hist.push({ x: ev.clientX, y: ev.clientY, t: performance.now() }); if (g.hist.length > 6) g.hist.shift();
      if (!g.moved) { if (Math.hypot(dx, dy) < 8) return; g.moved = true; if (!g.kind) g.kind = Math.abs(dx) >= Math.abs(dy) ? 'swipe' : dy > 0 ? 'down' : 'none'; }
      if (g.kind === 'pan') { const f = fit(), [mx, my] = bounds(g.z0.s, f); zoomTo({ s: g.z0.s, x: rubber(g.z0.x + dx, mx), y: rubber(g.z0.y + dy, my) }, false); }
      else if (g.kind === 'swipe') { const n = combined(lb.srcs).length, edge = (dx > 0 && lb.i === 0) || (dx < 0 && lb.i >= n - 1); lb.rail.style.transform = `translateX(calc(${-100 / 3}% + ${edge ? dx / 3 : dx}px))`; }
      else if (g.kind === 'down') { const y = Math.max(0, dy), h = lb.stage.clientHeight || 1, k = Math.min(1, y / h); lb.rail.children[1].style.transform = `translate(${dx / 2}px, ${y}px) scale(${1 - k * 0.3})`; lb.el.style.setProperty('--lbf', String(1 - k * 1.1)); }
    });
    const up = ev => {
      if (!pts.has(ev.pointerId)) return; pts.delete(ev.pointerId); if (!lb || !lb.g) return;
      const g = lb.g, cancel = ev.type === 'pointercancel';
      if (g.kind === 'pinch') { if (pts.size === 1) { pan([...pts.values()][0]); return; } if (!pts.size) { lb.g = null; settleZoom(g.m); if (lb.dirty) showLb(true); } return; }
      if (pts.size) return;
      lb.g = null; if (lb.dirty) showLb(true); if (!lb) return; // a change held back while the finger was down lands first, so the swipe counts from the photo in view in the new list, and a double tap zooms the latest copy
      const h = g.hist, a = h.find(q => h[h.length - 1].t - q.t < 100) || h[0], b = h[h.length - 1], dt = a && b && b.t > a.t ? b.t - a.t : 0, vx = dt ? (b.x - a.x) / dt : 0, vy = dt ? (b.y - a.y) / dt : 0; // px/ms over the last 100 ms
      const dx = ev.clientX - g.x0, dy = ev.clientY - g.y0;
      if (g.kind === 'pan' && g.moved) { settleZoom(); return; }
      if (g.kind === 'swipe') {
        const n = combined(lb.srcs).length, w = lb.stage.clientWidth, d = cancel ? 0 : dx < -w * 0.2 || (vx < -0.35 && dx < -12) ? 1 : dx > w * 0.2 || (vx > 0.35 && dx > 12) ? -1 : 0;
        if (d && lb.i + d >= 0 && lb.i + d < n) slideTo(d); else settleRail();
        return;
      }
      if (g.kind === 'down') { if (!cancel && (dy > lb.stage.clientHeight * 0.16 || (vy > 0.5 && dy > 24))) shut(); else undown(); return; }
      if ((g.kind && g.kind !== 'pan') || g.moved || cancel || performance.now() - g.t0 > 400) return;
      // a tap: two quick ones zoom in (or back out); one on the dark beside the photo closes, once it is sure it is not the first of two
      const now = performance.now(), x = ev.clientX, y = ev.clientY;
      if (tap && now - tap.t < 300 && Math.hypot(x - tap.x, y - tap.y) < 40) { clearTimeout(tapTimer); tap = null; const f = fit(); zoomTo(lb.z.s > 1.01 ? { s: 1, x: 0, y: 0 } : clampZ(about({ s: 1, x: 0, y: 0 }, ZTAP, x, y, f), f), true); return; }
      tap = { t: now, x, y }; clearTimeout(tapTimer);
      if (lb.z.s <= 1.01 && !onImage(x, y)) { const me = lb; tapTimer = setTimeout(() => { tap = null; if (lb === me && !lb.g && lb.z.s <= 1.01) close(); }, 300); }
    };
    stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
  }
  function undown() { const s = lb.rail.children[1]; lb.anim = true; lb.el.classList.add('going'); s.classList.add('go'); s.style.transform = ''; lb.el.style.removeProperty('--lbf'); after(260, () => { s.classList.remove('go'); lb.el.classList.remove('going'); lb.anim = false; if (lb.dirty) showLb(true); }); }
  function shut() { const s = lb.rail.children[1]; lb.anim = true; lb.el.classList.add('going'); s.classList.add('go'); s.style.transform = `translateY(${lb.stage.clientHeight}px) scale(.7)`; lb.el.style.setProperty('--lbf', '0'); after(200, () => close()); }
  function onWheel(ev) { // desktop: ctrl/cmd + wheel (a trackpad pinch) zooms about the pointer, the wheel pans a zoomed photo; never the page zoom
    if (!lb || lb.ed) { ev.preventDefault(); return; }
    if (ev.target.closest('.lb-strip') && !ev.ctrlKey) return; // the strip scrolls sideways
    ev.preventDefault(); if (!ev.target.closest('.lb-stage') || lb.anim) return;
    const f = fit(); let z = lb.z;
    if (ev.ctrlKey || ev.metaKey) z = about(z, clamp(z.s * Math.exp(-ev.deltaY * 0.01), 1, ZMAX), ev.clientX, ev.clientY, f);
    else if (z.s > 1.01) z = { s: z.s, x: z.x - ev.deltaX, y: z.y - ev.deltaY };
    zoomTo(z.s < 1.01 ? { s: 1, x: 0, y: 0 } : clampZ(z, f), false);
  }
  function onResize() { if (!lb) return; if (lb.z.s > 1.01) zoomTo(clampZ(lb.z, fit())); if (lb.ed) edLay(); }

  // ---------- the strip: a tap jumps; press and hold (touch) or drag (mouse) moves one of the panel's own photos ----------
  function stripGestures(st) {
    let skip = false; // the click that ends a drag is not a tap
    st.addEventListener('click', ev => { const b = ev.target.closest('.lb-th'); if (!b || !lb) return; if (skip) { skip = false; return; } if (lb.anim) return; /* mid-slide: the slide's end would put the old photo back */ if (+b.dataset.i !== lb.i) { lb.i = +b.dataset.i; showLb(); } });
    st.addEventListener('pointerdown', ev => {
      const b = ev.target.closest('.lb-th[data-move]'); if (!b || !lb || ev.button > 0 || !writable()) return;
      const d = lb.drag = { b, id: ev.pointerId, x0: ev.clientX, y0: ev.clientY, sl: st.scrollLeft, on: false, touch: ev.pointerType !== 'mouse' };
      if (d.touch) d.timer = setTimeout(() => lift(st, d), HOLD);
    });
    st.addEventListener('pointermove', ev => {
      const d = lb && lb.drag; if (!d || ev.pointerId !== d.id) return;
      if (!d.on) { if (Math.hypot(ev.clientX - d.x0, ev.clientY - d.y0) > 6) { if (d.touch) { clearTimeout(d.timer); lb.drag = null; } else lift(st, d); } return; } // a touch that moves first is a scroll of the strip
      const r = st.getBoundingClientRect(); if (ev.clientX < r.left + 28) st.scrollLeft -= 6; else if (ev.clientX > r.right - 28) st.scrollLeft += 6; // near an end, the strip scrolls under the finger
      const dx = ev.clientX - d.x0 + st.scrollLeft - d.sl, lo = -d.from * d.pitch, hi = (d.group.length - 1 - d.from) * d.pitch, x = clamp(dx, lo - 8, hi + 8);
      d.to = clamp(d.from + Math.round(x / d.pitch), 0, d.group.length - 1);
      d.group.forEach((g, k) => { if (g !== d.b) g.style.transform = k > d.from && k <= d.to ? `translateX(${-d.pitch}px)` : k < d.from && k >= d.to ? `translateX(${d.pitch}px)` : ''; });
      d.b.style.transform = `translateX(${x}px) translateY(-6px) scale(1.14)`;
    });
    const end = ev => {
      const d = lb && lb.drag; if (!d || ev.pointerId !== d.id) return; clearTimeout(d.timer); lb.drag = null; if (!d.on) return;
      skip = ev.type === 'pointerup'; setTimeout(() => { skip = false; }, 400);
      lb.el.classList.remove('dragging'); d.b.classList.remove('lift');
      const ids = d.group.map(g => g.dataset.id), from = d.from, to = ev.type === 'pointercancel' ? from : d.to;
      d.group.forEach(g => { g.style.transform = ''; });
      if (to !== from) { const [m] = ids.splice(from, 1); ids.splice(to, 0, m); st._sig = null; reorder(lb.srcs[0].owner, ids); } // the hero and the strip redraw in the new order, the lightbox staying on its photo
      else if (lb.dirty) showLb(true);
    };
    st.addEventListener('pointerup', end); st.addEventListener('pointercancel', end);
  }
  function lift(st, d) {
    if (!lb || lb.drag !== d) return;
    d.group = [...st.querySelectorAll('.lb-th[data-move]')]; d.from = d.group.indexOf(d.b); d.to = d.from;
    if (d.from < 0 || d.group.length < 2) { lb.drag = null; return; }
    d.pitch = d.group[1].offsetLeft - d.group[0].offsetLeft; d.on = true;
    try { st.setPointerCapture(d.id); } catch (e) {}
    lb.el.classList.add('dragging'); d.b.classList.add('lift'); d.b.style.transform = 'translateY(-6px) scale(1.14)';
  }

  // ---------- delete ----------
  function confirmDel(on) {
    if (!lb) return; lb.el.querySelector('.lb-dlg').hidden = !on; lb.del = on ? { o: lb.o, id: lb.id } : null; // the photo the dialog asks about, whatever the list does meanwhile
    if (on) lb.el.querySelector('.lb-no').focus(); else { const t = lb.el.querySelector('.lb-del'); if (t.offsetParent) t.focus(); }
  }
  async function delCurrent() {
    if (!lb || !lb.del) return; const { o: owner, id } = lb.del, yes = lb.el.querySelector('.lb-yes');
    if (!combined(lb.srcs).some(p => p.owner === owner && p.id === id)) { confirmDel(false); return; } // already gone (deleted elsewhere): nothing else is deleted in its place
    yes.disabled = true;
    try { await remove(owner, id); toast('Photo deleted'); if (lb) { lb.el.querySelector('.lb-dlg').hidden = true; lb.el.querySelector('.lb-x').focus(); } }
    catch (err) { console.warn('photo delete failed', err); toast('Could not delete the photo. Try again.', 3000); }
    if (lb) yes.disabled = false;
  }

  // ---------- crop and rotate: the frame is kept in fractions of the turned photo; save re-encodes from the full copy ----------
  const ASPECTS = [['o', 'Original'], ['1', 'Square'], ['0.8', '4:5'], ['1.7778', '16:9']];
  async function editCurrent() {
    if (!lb || lb.ed || !writable()) return; const { o: owner, id } = lb, btn = lb.el.querySelector('.lb-edit'); btn.disabled = true;
    let f = null, img = null;
    try { f = await fullOf(owner, id); img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = f.d; }); }
    catch (err) { console.warn('photo edit failed to open', err); toast('Could not open the photo. Try again.', 3000); }
    if (!lb) return; btn.disabled = false;
    if (img && lb.o === owner && lb.id === id) editor(owner, id, f, img);
  }
  function editor(owner, id, f, img) {
    const box = document.createElement('div'); box.className = 'lb-ed'; box.setAttribute('role', 'group'); box.setAttribute('aria-label', 'Crop and rotate');
    box.innerHTML = `<div class="lb-ed-stage"><canvas></canvas><div class="lb-crop">${['nw', 'ne', 'sw', 'se'].map(c => `<i class="h ${c}" data-c="${c}"></i>`).join('')}</div></div>
      <div class="lb-ed-bar"><div class="lb-aspects" role="group" aria-label="Shape">${ASPECTS.map(([k, t]) => `<button type="button" data-a="${k}" aria-pressed="false">${t}</button>`).join('')}</div>
        <div class="lb-ed-row"><button type="button" class="lb-pill lb-ed-no">Cancel</button><button type="button" class="lb-btn lb-rot" aria-label="Rotate 90° left">${SVG.rot}</button><button type="button" class="lb-pill lb-ed-ok">Save</button></div></div>`;
    lb.el.appendChild(box); lb.el.classList.add('editing');
    const ed = lb.ed = { el: box, owner, id, f, img, W: img.naturalWidth, H: img.naturalHeight, rot: 0, r: { x: 0, y: 0, w: 1, h: 1 }, a: null, g: null };
    box.querySelector('.lb-ed-no').addEventListener('click', () => edClose());
    box.querySelector('.lb-ed-ok').addEventListener('click', edSave);
    box.querySelector('.lb-rot').addEventListener('click', () => { // a quarter turn to the left, as Photos does; the frame turns with the photo
      const r = ed.r; ed.rot = (ed.rot + 3) % 4; ed.r = { x: r.y, y: 1 - r.x - r.w, w: r.h, h: r.w }; if (ed.a) aspect(ed.a); edLay(); // a chosen shape keeps its name (16:9 stays wide)
    });
    box.querySelectorAll('[data-a]').forEach(b => b.addEventListener('click', () => { aspect(ed.a === b.dataset.a ? null : b.dataset.a); edFrame(); })); // the pressed shape again frees the frame
    const st = box.querySelector('.lb-ed-stage');
    st.addEventListener('pointerdown', ev => {
      const h = ev.target.closest('.h'); if (ed.busy || (!h && !ev.target.closest('.lb-crop'))) return; ev.preventDefault();
      try { st.setPointerCapture(ev.pointerId); } catch (e) {}
      ed.g = { id: ev.pointerId, c: h ? h.dataset.c : null, x0: ev.clientX, y0: ev.clientY, r0: Object.assign({}, ed.r) }; box.classList.add('drag');
    });
    st.addEventListener('pointermove', ev => {
      const g = ed.g; if (!g || g.id !== ev.pointerId) return; const dx = (ev.clientX - g.x0) / ed.box.w, dy = (ev.clientY - g.y0) / ed.box.h;
      ed.r = g.c ? resize(ed, g.r0, g.c, dx, dy) : { x: clamp(g.r0.x + dx, 0, 1 - g.r0.w), y: clamp(g.r0.y + dy, 0, 1 - g.r0.h), w: g.r0.w, h: g.r0.h }; edFrame();
    });
    const up = ev => { if (ed.g && ed.g.id === ev.pointerId) { ed.g = null; box.classList.remove('drag'); } };
    st.addEventListener('pointerup', up); st.addEventListener('pointercancel', up);
    edLay(); box.querySelector('.lb-ed-no').focus();
  }
  const turned = ed => ed.rot % 2 ? [ed.H, ed.W] : [ed.W, ed.H];
  function aspect(k) { // k: a key of ASPECTS or null (free); the largest frame of that shape, centred
    const ed = lb.ed; ed.a = k; ed.el.querySelectorAll('[data-a]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.a === k)));
    if (!k) return; const a = shape(ed, k), w = a >= 1 ? 1 : a, h = a >= 1 ? 1 / a : 1; ed.r = { x: (1 - w) / 2, y: (1 - h) / 2, w, h };
  }
  const shape = (ed, k) => { const [RW, RH] = turned(ed); return (k === 'o' ? RW / RH : +k) * RH / RW; }; // width over height in fractions of the turned photo; Original is the photo's own shape
  function resize(ed, r0, c, dx, dy) { // a corner moves, the opposite one stays; a chosen shape holds
    const west = c[1] === 'w', north = c[0] === 'n', ax = west ? r0.x + r0.w : r0.x, ay = north ? r0.y + r0.h : r0.y;
    const px = clamp((west ? r0.x : r0.x + r0.w) + dx, 0, 1), py = clamp((north ? r0.y : r0.y + r0.h) + dy, 0, 1);
    const mw = 44 / ed.box.w, mh = 44 / ed.box.h, maxW = west ? ax : 1 - ax, maxH = north ? ay : 1 - ay;
    let w = Math.min(maxW, Math.max(mw, west ? ax - px : px - ax)), h = Math.min(maxH, Math.max(mh, north ? ay - py : py - ay));
    if (ed.a) { const a = shape(ed, ed.a); if (w / h > a) h = w / a; else w = h * a; if (w > maxW) { w = maxW; h = w / a; } if (h > maxH) { h = maxH; w = h * a; } }
    return { x: west ? ax - w : ax, y: north ? ay - h : ay, w, h };
  }
  function edLay() { // the turned photo, as large as fits, drawn sharp for the screen; then the frame over it
    const ed = lb.ed, st = ed.el.querySelector('.lb-ed-stage'), [RW, RH] = turned(ed), pad = 24;
    const k = Math.min((st.clientWidth - 2 * pad) / RW, (st.clientHeight - 2 * pad) / RH), w = RW * k, h = RH * k;
    ed.box = { x: (st.clientWidth - w) / 2, y: (st.clientHeight - h) / 2, w, h };
    const c = ed.el.querySelector('canvas'), dpr = Math.min(3, window.devicePixelRatio || 1);
    c.width = Math.max(1, Math.round(w * dpr)); c.height = Math.max(1, Math.round(h * dpr)); Object.assign(c.style, { left: ed.box.x + 'px', top: ed.box.y + 'px', width: w + 'px', height: h + 'px' });
    const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.setTransform(c.width / RW, 0, 0, c.height / RH, 0, 0); g.translate(RW / 2, RH / 2); g.rotate(ed.rot * Math.PI / 2); g.drawImage(ed.img, -ed.W / 2, -ed.H / 2);
    edFrame();
  }
  function edFrame() { const ed = lb.ed, b = ed.box, r = ed.r; Object.assign(ed.el.querySelector('.lb-crop').style, { left: b.x + r.x * b.w + 'px', top: b.y + r.y * b.h + 'px', width: r.w * b.w + 'px', height: r.h * b.h + 'px' }); }
  function edClose() { if (!lb || !lb.ed || lb.ed.busy) return; lb.ed.el.remove(); lb.ed = null; lb.el.classList.remove('editing'); const b = lb.el.querySelector('.lb-edit'); if (b && b.offsetParent) b.focus(); } // not while a save is in flight (Cancel, Escape): the save ends by closing it or by saying it failed
  function recrop(ed) { // the frame cut from the full copy, turned, at most EDGE on its long side and never larger than the source
    const [RW, RH] = turned(ed), sx = ed.r.x * RW, sy = ed.r.y * RH, cw = Math.max(1, ed.r.w * RW), ch = Math.max(1, ed.r.h * RH);
    const k = Math.min(1, EDGE / Math.max(cw, ch)), w = Math.max(1, Math.round(cw * k)), h = Math.max(1, Math.round(ch * k));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.imageSmoothingQuality = 'high';
    g.scale(w / cw, h / ch); g.translate(RW / 2 - sx, RH / 2 - sy); g.rotate(ed.rot * Math.PI / 2); g.drawImage(ed.img, -ed.W / 2, -ed.H / 2);
    const keep = { at: ed.f.at || new Date().toISOString() }, meta = {}; if (ed.f.by) meta.by = ed.f.by; if (ed.f.taken) meta.taken = ed.f.taken; // the same photo: when it was added, by whom and taken stay
    return { rec: Object.assign(encode(c), keep, meta), th: Object.assign(thumbAt(c, w, h), meta) };
  }
  async function edSave() {
    const ed = lb && lb.ed; if (!ed || ed.busy) return; const r = ed.r;
    if (!ed.rot && r.x < 1e-3 && r.y < 1e-3 && r.w > 1 - 1e-3 && r.h > 1 - 1e-3) { edClose(); return; } // nothing changed: nothing to write
    const ok = ed.el.querySelector('.lb-ed-ok'), btns = ed.el.querySelectorAll('button'); ed.busy = true; btns.forEach(b => { b.disabled = true; }); ok.textContent = 'Saving…';
    try { const { rec, th } = recrop(ed); await replace(ed.owner, ed.id, rec, th); ed.busy = false; if (lb && lb.ed === ed) edClose(); toast('Photo saved'); }
    catch (err) { console.warn('photo edit failed', err); toast('Could not save the photo. Try again.', 3000); ed.busy = false; if (lb && lb.ed === ed) { btns.forEach(b => { b.disabled = false; }); ok.textContent = 'Save'; } }
  }

  function onKey(e) {
    if (!lb) return;
    e.stopPropagation(); // the app's own keys (Escape goes up a level, +/- zoom) wait until the lightbox is closed
    const dlg = !lb.el.querySelector('.lb-dlg').hidden;
    if (e.key === 'Escape') { e.preventDefault(); if (lb.ed) edClose(); else if (dlg) confirmDel(false); else close(); }
    else if (e.key === 'ArrowLeft' && !lb.ed && !dlg) { e.preventDefault(); step(-1); }
    else if (e.key === 'ArrowRight' && !lb.ed && !dlg) { e.preventDefault(); step(1); }
    else if (e.key === 'Tab') { // keep focus inside the dialog (and inside the editor or the confirmation while one is up)
      const scope = lb.ed ? lb.ed.el : dlg ? lb.el.querySelector('.lb-dlg') : lb.el;
      const f = [...scope.querySelectorAll('button')].filter(b => !b.disabled && b.offsetParent !== null && (scope !== lb.el || !b.closest('.lb-dlg, .lb-ed'))); if (!f.length) return;
      const i = f.indexOf(document.activeElement); if (e.shiftKey ? i <= 0 : i === f.length - 1 || i < 0) { e.preventDefault(); f[e.shiftKey ? f.length - 1 : 0].focus(); }
    }
  }
  function close(quiet) {
    if (!lb) return; const { el, srcs, o, id } = lb; lb = null;
    window.removeEventListener('keydown', onKey, true); window.removeEventListener('resize', onResize); el.remove();
    if (quiet) return;
    const box = [...document.querySelectorAll('.hero[data-owner]')].find(b => b.dataset.owner === srcs[0].owner); if (!box) return; // back to the hero, on the photo it showed
    const slides = [...box.querySelectorAll('.hero-slide')], s = slides.find(b => b.dataset.o === o && b.dataset.id === id), track = box.querySelector('.hero-track');
    if (s && track) track.scrollLeft = slides.indexOf(s) * track.clientWidth;
    const t = s || slides[0] || box.querySelector('[data-ph-add]:not([disabled])');
    if (t) t.focus({ preventScroll: true });
  }

  return {
    MAX, init, block, cover, mount, preload, add, remove, removeAll, reorder, downscale, open, close,
    list: owner => (entry(owner).known ? Promise.resolve() : load(owner)).then(() => ordered(owner)), // [{ id, d: best copy in memory, w, h, q: 'f' | 't' | '', t: thumb, at, by, taken }]
    // tests: fill the cache without the network. recs: {id: full record, or true for a photo whose full copy is not in}; thumbs: {id: thumb}; order: [id]
    prime(owner, recs, thumbs, order) {
      const e = entry(owner); e.ver++; Object.assign(e, { ids: {}, known: true, th: {}, full: {}, bad: {}, order: okOrder({ ids: order }), at: Date.now() });
      for (const id in recs || {}) { e.ids[id] = true; const f = okRec(recs[id]); if (f) e.full[id] = f; else if (recs[id] !== true) e.bad[id] = true; }
      for (const id in thumbs || {}) { const t = okRec(thumbs[id]); if (t) { e.th[id] = t; e.ids[id] = true; } }
      refresh(owner);
    },
    takenOf, // tests: the capture date of a File or Blob, 'YYYY-MM-DD' or undefined
    lightbox: () => lb && { i: lb.i, owner: lb.o, id: lb.id, zoom: Object.assign({}, lb.z), editing: !!lb.ed, confirming: !lb.el.querySelector('.lb-dlg').hidden }, // tests
  };
})();
