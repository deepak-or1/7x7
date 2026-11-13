// Photos on spots, sections and places (hosted site only). They live beside the log, not in it:
// logs/<key>-ph/<owner>/<photoId> = { d: JPEG data URL, w, h, at }, so the live log stream never carries them.
// This file owns the downscale, an in-memory cache per owner, the photo hero at the top of a panel (a section or
// place also shows the photos of what is inside it), and the lightbox.
window.Photos = (() => {
  const MAX = 8, EDGE = 1280, BIG = 600000, FRESH = 60000; // FRESH: a panel opened again after a minute re-reads the list in the background
  const XMAX = 12, DOTS = 8; // XMAX: extra sources rolled into one hero; DOTS: past this many photos the hero shows a counter instead of dots
  const PIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6-5.3-6-11a6 6 0 0 1 12 0c0 5.7-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/></svg>';
  const CHEV = d => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const plural = n => n + (n === 1 ? ' photo' : ' photos');
  let api = null, toast = () => {}, canWrite = () => true;
  const cache = {}; // owner -> { recs: {id: rec} | null, at, ver, loading, busy }
  const entry = o => cache[o] || (cache[o] = { recs: null, at: 0, ver: 0, loading: null, busy: 0 });
  const isImg = d => typeof d === 'string' && /^data:image\/(jpeg|png|webp);base64,/.test(d); // never a remote URL: a record is written by anyone with the link
  const ordered = o => { const r = (cache[o] && cache[o].recs) || {}; return Object.keys(r).sort().filter(id => r[id] && isImg(r[id].d)).map(id => Object.assign({}, r[id], { id })); };
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
  async function add(owner, files, label) { // label: what the photos are of, for the first-photo toast
    files = [...(files || [])].filter(f => f && (!f.type || /^image\//.test(f.type)));
    if (!files.length) return [];
    if (!api) { toast('Could not add the photo. Try again.', 3000); throw new Error('photos are not available'); }
    const e = entry(owner);
    try { await load(owner); } catch (err) {} // count what is there first; offline, the add itself fails below
    const had = Object.keys(e.recs || {}).length, room = Math.max(0, MAX - had), take = files.slice(0, room);
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
    else if (!had && added.length && label) { if (window.Confetti) window.Confetti.burst(); toast(`First photo of ${label}`, 2600); } // its very first photo: a small party
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
  function draw(el) {
    const srcs = sourcesOf(el), own = srcs[0], e = entry(own.owner), list = combined(srcs), n = list.length;
    const full = Object.keys(e.recs || {}).length >= MAX, write = el.dataset.w === '1' && canWrite() && !!api;
    const mode = n ? 'photos' : api && srcs.some(s => !entry(s.owner).recs) ? 'loading' : 'empty'; // no "No photos yet" flash before the first read
    const sig = JSON.stringify([mode, list.map(p => p.owner + '/' + p.id), write, full, e.busy > 0]);
    if (el._sig === sig) return; // nothing it shows has changed: keep the slide, the focus and the decoded images
    el._sig = sig;
    const old = el.querySelector('.hero-track'), was = old && old.children[slideAt(old)], keep = was ? was.dataset.o + '/' + was.dataset.id : null;
    const focus = el.contains(document.activeElement) ? (document.activeElement.matches('[data-ph-add]') ? 'add' : document.activeElement.dataset.o + '/' + document.activeElement.dataset.id) : null;
    const file = write ? '<input type="file" accept="image/*" multiple hidden data-ph-file>' : '', busy = e.busy > 0;
    let html = '';
    if (mode === 'photos') {
      const addTxt = full ? `${MAX} of ${MAX}` : busy ? 'Adding…' : '';
      html = file + `<div class="hero-track" role="group" aria-label="${esc('Photos of ' + own.label)}">${list.map((p, i) => `<button type="button" class="hero-slide" data-i="${i}" data-o="${esc(p.owner)}" data-id="${esc(p.id)}" aria-label="${esc(`Photo ${i + 1} of ${n}, ${p.label}`)}"><img src="${esc(p.d)}" alt="" decoding="async"></button>`).join('')}</div>`
        + (el.dataset.bt ? `<span class="hero-chip hero-badge"><span aria-hidden="true">${esc(el.dataset.be)}</span>${esc(el.dataset.bt)}</span>` : '')
        + '<span class="hero-chip hero-src" hidden></span>'
        + (n > 1 ? (n <= DOTS ? `<span class="hero-dots" aria-hidden="true">${list.map(() => '<i></i>').join('')}</span>` : '<span class="hero-chip hero-count" aria-hidden="true"></span>')
          + `<button type="button" class="hero-nav prev" aria-label="Previous photo">${CHEV('M15 5l-7 7 7 7')}</button><button type="button" class="hero-nav next" aria-label="Next photo">${CHEV('M9 5l7 7-7 7')}</button>` : '')
        + (write ? `<button type="button" class="hero-chip hero-add" data-ph-add ${addTxt ? 'disabled' : ''} aria-label="${esc(full ? `${MAX} of ${MAX} photos, the limit` : busy ? 'Adding photos' : 'Add photos of ' + own.label)}">${addTxt || '+ Photo'}</button>` : '');
    } else if (mode === 'empty') html = file + `<span class="hero-e" aria-hidden="true">${esc(el.dataset.e)}</span><p class="hero-msg">No photos yet</p>`
      + (write ? `<button type="button" class="hero-cta" data-ph-add ${busy ? 'disabled' : ''}>${busy ? 'Adding…' : 'Add the first photo'}</button>` : '');
    el.className = 'hero ' + (mode === 'photos' ? 'has' : 'cover') + (mode === 'loading' ? ' loading' : '');
    el.innerHTML = html;
    const fileIn = el.querySelector('[data-ph-file]');
    if (fileIn) {
      el.querySelectorAll('[data-ph-add]').forEach(b => b.addEventListener('click', () => fileIn.click()));
      fileIn.addEventListener('change', () => { const fs = [...fileIn.files]; fileIn.value = ''; add(own.owner, fs, own.label).catch(() => {}); });
    }
    const track = el.querySelector('.hero-track');
    if (track) {
      const at = () => Math.max(0, Math.min(n - 1, slideAt(track)));
      let raf = 0;
      const sync = () => { // dots, counter, arrows and the source caption follow the slide in view
        raf = 0; const i = at(), p = list[i];
        el.querySelectorAll('.hero-dots i').forEach((d, j) => d.classList.toggle('on', j === i));
        const c = el.querySelector('.hero-count'); if (c) c.textContent = `${i + 1} / ${n}`;
        const s = el.querySelector('.hero-src'); s.hidden = p.own; if (!p.own) s.innerHTML = PIN + `<span>${esc(p.label)}</span>`;
        const pv = el.querySelector('.hero-nav.prev'), nx = el.querySelector('.hero-nav.next'); if (pv) { pv.disabled = i === 0; nx.disabled = i === n - 1; }
      };
      track.addEventListener('scroll', () => { if (!raf) raf = requestAnimationFrame(sync); }, { passive: true });
      track.querySelectorAll('.hero-slide').forEach(b => b.addEventListener('click', () => open(srcs, +b.dataset.i)));
      el.querySelectorAll('.hero-nav').forEach(b => b.addEventListener('click', () => track.scrollTo({ left: (at() + (b.classList.contains('next') ? 1 : -1)) * track.clientWidth, behavior: smooth() })));
      const j = keep ? list.findIndex(p => p.owner + '/' + p.id === keep) : -1; if (j > 0) track.scrollLeft = j * track.clientWidth; // a redraw stays on the photo it showed
      sync();
    }
    const f = focus === 'add' ? el.querySelector('[data-ph-add]:not([disabled])') : focus ? [...el.querySelectorAll('.hero-slide')].find(b => b.dataset.o + '/' + b.dataset.id === focus) : null;
    if (f) f.focus({ preventScroll: true });
  }
  function refresh(owner) { heroes(owner).forEach(draw); if (lb && lb.srcs.some(s => s.owner === owner)) showLb(true); }
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
    const img = el.querySelector('.lb-stage img'); if (img.getAttribute('src') !== p.d) img.src = p.d;
    img.alt = `Photo ${lb.i + 1} of ${n}, ${p.label}`;
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
    MAX, init, block, cover, mount, add, remove, removeAll, downscale, open, close,
    list: owner => (entry(owner).recs ? Promise.resolve() : load(owner)).then(() => ordered(owner)),
    prime(owner, recs) { const e = entry(owner); e.ver++; e.recs = Object.assign({}, recs); e.at = Date.now(); refresh(owner); }, // tests: fill the cache without the network
  };
})();
