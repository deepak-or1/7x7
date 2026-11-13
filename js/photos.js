// Photos on spots, sections and places (hosted site only). They live beside the log, not in it:
// logs/<key>-ph/<owner>/<photoId> = { d: JPEG data URL, w, h, at }, so the live log stream never carries them.
// This file owns the downscale, an in-memory cache per owner, the strip in a panel, and the lightbox.
window.Photos = (() => {
  const MAX = 8, EDGE = 1280, BIG = 600000, FRESH = 60000; // FRESH: a panel opened again after a minute re-reads the list in the background
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const plural = n => n + (n === 1 ? ' photo' : ' photos');
  let api = null, toast = () => {}, canWrite = () => true;
  const cache = {}; // owner -> { recs: {id: rec} | null, at, ver, loading, busy }
  const entry = o => cache[o] || (cache[o] = { recs: null, at: 0, ver: 0, loading: null, busy: 0 });
  const ordered = o => { const r = (cache[o] && cache[o].recs) || {}; return Object.keys(r).sort().map(id => Object.assign({ id }, r[id])); };
  const newId = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 4).padEnd(2, '0');
  function init(o) { api = o.api || null; if (o.toast) toast = o.toast; if (o.canWrite) canWrite = o.canWrite; }

  // ---------- the list ----------
  function load(owner, force) {
    const e = entry(owner);
    if (e.loading) return e.loading;
    if (e.recs && !force && Date.now() - e.at < FRESH) return Promise.resolve(e.recs);
    if (!api) return Promise.reject(new Error('photos are not available'));
    const ver = e.ver;
    e.loading = api.list(owner).then(recs => {
      e.loading = null; e.at = Date.now();
      if (e.ver === ver) { e.recs = recs; refresh(owner); } // a local add or delete while this was in flight wins; the next open re-reads
      return e.recs;
    }, err => { e.loading = null; if (!e.recs) { e.recs = {}; e.at = 0; refresh(owner); } throw err; }); // offline or blocked: the empty state, retried on the next open
    return e.loading;
  }

  // ---------- downscale: longest edge 1280, JPEG, EXIF orientation applied ----------
  async function decode(file) {
    if (window.createImageBitmap) { try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch (e) {} }
    return new Promise((res, rej) => { const u = URL.createObjectURL(file), img = new Image(); img.onload = () => { URL.revokeObjectURL(u); res(img); }; img.onerror = () => { URL.revokeObjectURL(u); rej(new Error('could not read the image')); }; img.src = u; }); // <img> applies EXIF orientation by default
  }
  async function downscale(file) {
    const src = await decode(file), W = src.naturalWidth || src.width, H = src.naturalHeight || src.height;
    if (!W || !H) throw new Error('empty image');
    const s = Math.min(1, EDGE / Math.max(W, H)), w = Math.max(1, Math.round(W * s)), h = Math.max(1, Math.round(H * s));
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(src, 0, 0, w, h); if (src.close) src.close(); // white under a transparent PNG, not black
    let d = c.toDataURL('image/jpeg', 0.8); if (d.length > BIG) d = c.toDataURL('image/jpeg', 0.6);
    return { d, w, h, at: new Date().toISOString() };
  }

  // ---------- add / remove ----------
  async function add(owner, files) {
    files = [...(files || [])].filter(f => f && (!f.type || /^image\//.test(f.type)));
    if (!files.length) return [];
    if (!api) { toast('Could not add the photo. Try again.', 3000); throw new Error('photos are not available'); }
    const e = entry(owner);
    try { await load(owner); } catch (err) {} // count what is there first; offline, the add itself fails below
    const room = Math.max(0, MAX - Object.keys(e.recs || {}).length), take = files.slice(0, room);
    if (!take.length) { toast(`${MAX} photos is the limit here`, 2600); return []; }
    e.busy++; refresh(owner);
    toast(`Adding ${plural(take.length)}…`, 60000);
    const added = []; let failed = null;
    for (const f of take) { // one at a time, so ids (time-based) sort in upload order
      try { const rec = await downscale(f), id = newId(); await api.put(owner, id, rec); e.ver++; e.recs = Object.assign({}, e.recs, { [id]: rec }); added.push(id); refresh(owner); }
      catch (err) { failed = err; console.warn('photo upload failed', err); break; }
    }
    e.busy--; refresh(owner);
    if (failed) toast('Could not add the photo. Try again.', 3000);
    else toast(`${plural(added.length)} added${take.length < files.length ? ` (${MAX} is the limit)` : ''}`);
    return added;
  }
  async function remove(owner, id) {
    if (!api) throw new Error('photos are not available');
    await api.del(owner, id);
    const e = entry(owner); e.ver++; if (e.recs) { const r = Object.assign({}, e.recs); delete r[id]; e.recs = r; }
    refresh(owner);
  }
  function removeAll(owner) { // a deleted spot: best effort, never in the way
    const e = entry(owner); e.ver++; e.recs = {}; e.at = Date.now();
    return api ? api.delAll(owner).catch(err => console.warn('photo cleanup failed', err)) : Promise.resolve();
  }

  // ---------- the strip in a panel ----------
  // app.js writes block() into the panel HTML; mount() fills it, and refresh() redraws it in place when the cache changes,
  // so a panel re-render never refetches or flickers, and the panel HTML never depends on photo state.
  const block = (owner, label, writable) => `<div class="photos" data-owner="${esc(owner)}" data-label="${esc(label)}" data-w="${writable ? 1 : 0}"></div>`;
  const boxes = owner => [...document.querySelectorAll('.photos[data-owner]')].filter(el => el.dataset.owner === owner);
  function draw(el) {
    const owner = el.dataset.owner, label = el.dataset.label || '', e = entry(owner), list = e.recs ? ordered(owner) : null, n = list ? list.length : 0, full = n >= MAX;
    const addBtn = el.dataset.w === '1' && canWrite() ? `<button type="button" class="act" data-ph-add ${full || e.busy ? 'disabled' : ''}>${full ? `${MAX} of ${MAX}` : e.busy ? 'Adding…' : '+ Add photos'}</button>` : '';
    // the file input comes first so the heading is not :first-child (that rule is for a panel's opening heading)
    el.innerHTML = `<input type="file" accept="image/*" multiple hidden data-ph-file><h3>Photos <span class="n">${n || ''}</span>${addBtn}</h3>`
      + (list === null ? '<p class="empty">Loading photos…</p>' : n ? `<div class="ph-strip" aria-label="${esc('Photos of ' + label)}">${list.map((p, i) => `<button type="button" class="ph" data-ph="${i}" data-id="${esc(p.id)}" aria-label="${esc(`Photo ${i + 1} of ${n}, ${label}`)}"><img src="${esc(p.d)}" alt="" decoding="async"></button>`).join('')}</div>` : '<p class="empty">No photos yet.</p>');
    const file = el.querySelector('[data-ph-file]'), btn = el.querySelector('[data-ph-add]');
    if (btn) btn.addEventListener('click', () => file.click());
    file.addEventListener('change', () => { const fs = [...file.files]; file.value = ''; add(owner, fs).catch(() => {}); });
    el.querySelectorAll('[data-ph]').forEach(b => b.addEventListener('click', () => open(owner, +b.dataset.ph, label)));
  }
  function refresh(owner) { boxes(owner).forEach(draw); if (lb && lb.owner === owner) showLb(); }
  function mount(root) { root.querySelectorAll('.photos[data-owner]').forEach(el => { draw(el); if (api) load(el.dataset.owner).catch(() => {}); }); }

  // ---------- lightbox ----------
  let lb = null; // { el, owner, label, i, list }
  function open(owner, i, label) {
    close(true);
    const el = document.createElement('div');
    el.className = 'lb'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Photos of ' + label); el.tabIndex = -1;
    el.innerHTML = `<div class="lb-bar"><span class="lb-n" aria-live="polite"></span><button type="button" class="lb-btn lb-x" aria-label="Close"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>
      <div class="lb-stage"><img alt=""></div>
      <button type="button" class="lb-btn lb-prev" aria-label="Previous photo"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button><button type="button" class="lb-btn lb-next" aria-label="Next photo"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button>
      <div class="lb-foot"><button type="button" class="btn sm lb-del">Delete</button><div class="lb-confirm" hidden><span>Delete this photo?</span><button type="button" class="btn sm lb-yes">Delete</button><button type="button" class="btn sm quiet lb-no">Keep</button></div></div>`;
    (document.getElementById('app') || document.body).appendChild(el);
    lb = { el, owner, label, i };
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
  function showLb() {
    if (!lb) return;
    const list = ordered(lb.owner), n = list.length; if (!n) { close(); return; }
    lb.i = Math.max(0, Math.min(n - 1, lb.i)); const p = list[lb.i], el = lb.el; lb.id = p.id;
    const img = el.querySelector('.lb-stage img'); if (img.getAttribute('src') !== p.d) img.src = p.d;
    img.alt = `Photo ${lb.i + 1} of ${n}, ${lb.label}`;
    el.querySelector('.lb-n').textContent = `${lb.i + 1} of ${n}`;
    el.querySelector('.lb-prev').hidden = el.querySelector('.lb-next').hidden = n < 2;
    el.querySelector('.lb-foot').hidden = !canWrite() || !api;
  }
  function step(d) { if (!lb) return; const n = ordered(lb.owner).length; if (n < 2) return; lb.i = (lb.i + d + n) % n; confirmDel(false); showLb(); }
  function confirmDel(on) { if (!lb) return; lb.el.querySelector('.lb-confirm').hidden = !on; lb.el.querySelector('.lb-del').hidden = on; if (on) lb.el.querySelector('.lb-no').focus(); }
  async function delCurrent() {
    if (!lb) return; const { owner, id } = lb, yes = lb.el.querySelector('.lb-yes'); yes.disabled = true;
    try { await remove(owner, id); toast('Photo deleted'); if (lb) { confirmDel(false); lb.el.querySelector('.lb-x').focus(); } }
    catch (err) { console.warn('photo delete failed', err); toast('Could not delete the photo. Try again.', 3000); }
    if (lb) yes.disabled = false;
  }
  function onKey(e) {
    if (!lb) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); step(1); }
    else if (e.key === 'Tab') { // keep focus inside the dialog
      const f = [...lb.el.querySelectorAll('button')].filter(b => !b.disabled && b.offsetParent !== null); if (!f.length) return;
      const i = f.indexOf(document.activeElement); if (e.shiftKey ? i <= 0 : i === f.length - 1 || i < 0) { e.preventDefault(); f[e.shiftKey ? f.length - 1 : 0].focus(); } else return;
    } else return;
    e.stopPropagation(); // the app's own keys (Escape goes up a level, +/- zoom) wait until the lightbox is closed
  }
  function close(quiet) {
    if (!lb) return; const { el, owner, id } = lb; lb = null;
    window.removeEventListener('keydown', onKey, true); el.remove();
    if (quiet) return;
    const box = boxes(owner)[0]; if (!box) return; // focus back to the strip: the photo it showed, or what is left
    const t = [...box.querySelectorAll('[data-id]')].find(b => b.dataset.id === id) || box.querySelector('[data-ph]') || box.querySelector('[data-ph-add]:not([disabled])');
    if (t) t.focus({ preventScroll: true });
  }

  return {
    MAX, init, block, mount, add, remove, removeAll, downscale, open, close,
    list: owner => (entry(owner).recs ? Promise.resolve() : load(owner)).then(() => ordered(owner)),
    prime(owner, recs) { const e = entry(owner); e.ver++; e.recs = Object.assign({}, recs); e.at = Date.now(); refresh(owner); }, // tests: fill the cache without the network
  };
})();
