// Looking back: repeat visits on a spot, the timeline (everything with a date, newest first, month by month), "on this day" on the
// first screen, and the recap of a month or a year, shareable as an image.
// Dates are local calendar dates kept as 'YYYY-MM-DD' strings and compared as strings. A Date is only ever built from numbers
// (new Date(y, m - 1, d)), never parsed from one of those strings, so no time zone moves a day.
// The log: spot.visits = ['YYYY-MM-DD', ...] (sorted, unique, at most 60) beside spot.at. While the spot's status is been, `at` equals
// the latest visit; while it is want to go the list stays stored as it was (not shown, not counted in the timeline or the recap), and
// going back to been shows it again with `at` set to the latest. A spot with `at` and no `visits` is one visit and is left as it is
// until a visit is added or changed. Another device on older code that saves a spot through its log form rebuilds the spot and drops
// `visits`; `at` survives, so the spot then reads as one visit on its latest date. Older code that moves `at` in place (a photo's
// capture date) moves the latest visit.
// Future dates: a date entered on this device (the add input, the date editor, the log form's date) must be today or earlier. A date
// read from the log is shown up to tomorrow (another time zone's today, or older code's UTC date in the evening), and a stored date
// later than that is not shown but is carried through every save untouched: this device never deletes it for being in the future.
// Everything read from the log is untrusted: dates are checked one by one, lookups use own keys, strings are escaped.
// init({ state, panel, go, render, persist, beforeWrite, toast, setHead, esc, attr, KINDS, IDX, BY_SLUG, ownerKey, cleanName, niceDate,
// isPhone, look, VERDICT }) from app.js.
window.Lookback = (() => {
  const VMAX = 60, SCAN = 2000; // VMAX: visits kept on a spot (the latest); SCAN: entries of a visits list looked at, at most
  const LIM = 4, IMGN = 24; // LIM: photo lists loading at once; IMGN: places and spots whose photos the image may use
  const CAP = 'Only the latest 60 visits are kept';
  const DISMISS = 'sbs-otd-off'; // this device: the day the on-this-day card was put away
  const W = 1080, H = 1350; // the shared image
  const LIGHT = { paper: '#fdfbf6', paper2: '#f4efe4', paper3: '#ebe4d6', ink: '#15202b', ink2: '#3c4a57', muted: '#6b6559', line: '#e8e1d2', line2: '#d2c9b6', accent: '#e85a1f', star: '#b07d0a' }; // css/app.css :root: the image is always drawn light
  let A = null;
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  // the local calendar day. Dates written by older code may be the UTC date (a day ahead in the evening here), which is why dates
  // read from the log are accepted up to tomorrow
  const today = () => ymd(new Date());
  const tomorrow = () => { const d = new Date(); return ymd(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)); };
  const dim = (y, m) => new Date(y, m, 0).getDate(); // days in month m (1-12) of year y
  const ymdOf = s => [+s.slice(0, 4), +s.slice(5, 7), +s.slice(8, 10)];
  const real = s => { if (typeof s !== 'string' || s.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false; const [y, m, d] = ymdOf(s); return y >= 1900 && m >= 1 && m <= 12 && d >= 1 && d <= dim(y, m); }; // a well-formed real day, any day
  const okDay = (s, t) => real(s) && s <= (t || today()); // entered on this device: up to today
  const okRead = (s, t) => real(s) && s <= (t || tomorrow()); // read from the log: up to tomorrow
  const own = (o, k) => o && typeof o === 'object' && typeof k === 'string' && Object.hasOwn(o, k) ? o[k] : undefined;
  const str = v => typeof v === 'string' ? v : typeof v === 'number' && isFinite(v) ? String(v) : '';
  const isBeen = sp => !!sp && typeof sp === 'object' && (sp.status == null || sp.status === 'been');
  const dayOf = (s, o) => new Date(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10) || 1).toLocaleDateString(undefined, o);
  const short = s => dayOf(s, { month: 'short', day: 'numeric' }); // 'Nov 10'
  const shortY = s => s.slice(0, 4) === today().slice(0, 4) ? short(s) : dayOf(s, { month: 'short', day: 'numeric', year: 'numeric' }); // 'Nov 10', or 'Nov 18, 2025' in another year
  const monthName = k => dayOf(k + '-01', { month: 'long', year: 'numeric' }); // 'November 2026'
  const periodName = p => p.length === 4 ? p : monthName(p);
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many || one + 's');

  // ---------- visits ----------
  function clean(a, t1 = tomorrow()) { // a visits list from the log, as shown: the real dates up to tomorrow, sorted, unique, the latest 60
    if (!Array.isArray(a)) return [];
    const out = new Set(); for (let i = 0; i < a.length && i < SCAN; i++) if (okRead(a[i], t1)) out.add(a[i]);
    return [...out].sort().slice(-VMAX);
  }
  const kept = a => Array.isArray(a) ? [...new Set(a.slice(0, SCAN).filter(real))].sort().slice(-VMAX) : []; // a want-to-go spot's stored list
  function ahead(sp) { // stored dates that fail only the future check: carried through every save as they are
    const t1 = tomorrow(), out = [];
    if (Array.isArray(sp.visits)) for (let i = 0; i < sp.visits.length && i < SCAN; i++) if (real(sp.visits[i]) && sp.visits[i] > t1) out.push(sp.visits[i]);
    if (real(sp.at) && sp.at > t1) out.push(sp.at);
    return out;
  }
  // every visit of a been spot, as shown; `at` is the latest one (older code may have moved it: then it replaces the latest)
  function visitsOf(sp) {
    if (!isBeen(sp)) return [];
    const t1 = tomorrow(), v = clean(sp.visits, t1), at = okRead(sp.at, t1) ? sp.at : null;
    if (!v.length) return at ? [at] : [];
    if (at && at !== v[v.length - 1]) { v[v.length - 1] = at; return [...new Set(v)].sort(); }
    return v;
  }
  // the dates a list would keep: false when `d` itself would fall off the cap, else the number of dates the cap would drop
  function fits(from, list, d) { const all = [...new Set(list.concat(ahead(from)))].sort(), cut = all.length - VMAX; return cut > 0 && d && all.indexOf(d) < cut ? false : Math.max(0, cut); }
  // save a shown list (plus the stored future dates of `from`) on sp; `at` becomes the latest. Returns false for an empty list
  function write(sp, list, from = sp) {
    if (!list.length) return false;
    const v = [...new Set(list.concat(ahead(from)))].sort().slice(-VMAX);
    sp.visits = v; sp.at = v[v.length - 1]; return true;
  }
  // the stamp on a spot page: one visit reads as before ('Been · Nov 10'); more: 'Been 3 times · last Nov 10'
  function stamp(sp) {
    const v = visitsOf(sp);
    if (v.length < 2) { const d = A.niceDate(v.length ? v[0] : sp && sp.at ? str(sp.at) : ''); return 'Been' + (d ? ' · ' + d : ''); }
    return `Been ${v.length === 2 ? 'twice' : v.length + ' times'} · last ${shortY(v[v.length - 1])}`;
  }
  // the log form saved a spot (app.js rebuilt it from the form, without `visits`). Returns a line for the toast, or ''.
  // Been to been: the date edits the latest visit; a date that is already another visit leaves the list as it is. Want to go: the list
  // stays stored. Want to go back to been: the list comes back, and a new date is one more visit. A spot that had no list is left alone
  function carry(prev, next) {
    if (!prev || !next || !Array.isArray(prev.visits)) return '';
    if (!isBeen(next)) { const k = kept(prev.visits); if (k.length) next.visits = k; return ''; }
    const back = !isBeen(prev), v = back ? clean(prev.visits) : visitsOf(prev); if (!v.length) return '';
    const d = next.at; let said = '';
    if (d !== v[v.length - 1]) {
      if (v.includes(d)) said = 'That day is already a visit';
      else if (okDay(d)) { if (back) v.push(d); else v[v.length - 1] = d; }
    }
    write(next, v, prev); return said;
  }
  // app.js folded several entries of one spot into sp (now been): every been entry's visits, with their stored future dates, kept as
  // write() keeps them. One visit, on a spot that had no list, stays a plain `at`, as on a spot logged once
  function join(sp, all) {
    const been = all.filter(isBeen), v = [...new Set(been.flatMap(visitsOf))].sort(), fut = been.flatMap(ahead);
    if (!isBeen(sp)) delete sp.visits; // a want-to-go entry's own stored list is not a visit
    if (v.length < 2 && !fut.length && !Array.isArray(sp.visits)) { if (v.length) sp.at = v[0]; return; }
    write(sp, v.concat(fut), {});
  }
  // 'Mark as been' on a want-to-go spot (app.js has set the status): today is one more visit on a list kept through want to go
  function markBeen(sp, d) { if (!Array.isArray(sp.visits)) { sp.at = d; return; } const v = clean(sp.visits); if (!v.includes(d)) v.push(d); write(sp, v); }
  // older-code paths that set `at` in place: the latest visit moves with it
  function setLatest(sp, date) {
    if (!Array.isArray(sp.visits) || !okDay(date)) { sp.at = date; return; }
    const v = visitsOf(sp); v[v.length - 1] = date; if (!write(sp, v)) sp.at = date;
  }
  // a photo's capture date on a been spot (app.js photoTaken): null, no offer (already a visit); 'add' (more than one visit: one more);
  // 'set' (one visit: it moves, as before)
  function photoOffer(sp, d) { const v = visitsOf(sp); return v.includes(d) ? null : v.length > 1 ? 'add' : 'set'; }
  // the offer taken: null when the date was not kept (said here), else a toast line ('' for app.js's own)
  function photoDate(sp, d, how) {
    if (how !== 'add') { setLatest(sp, d); return ''; }
    const v = visitsOf(sp); if (v.includes(d)) return '';
    const f = fits(sp, v.concat(d), d); if (f === false) { A.toast(CAP, 3200); return null; }
    write(sp, v.concat(d)); return f ? `${str(sp.name) || 'Spot'}: visited ${shortY(d)}. ${CAP}` : '';
  }
  let datesOpen = null; // the spot whose list of visits is open: it stays open through the re-render after an edit
  function spotBlock(id) {
    const sp = own(A.state.spots, id); if (!isBeen(sp)) return '';
    const v = visitsOf(sp), t = today(), w = !!A.state.canWrite, open = datesOpen === id;
    const ctl = w ? `<span class="lk-ctl"><button type="button" class="lk-ag" data-lk="again">Been again</button><button type="button" class="lk-od" data-lk="other" aria-expanded="false" aria-controls="lk-add">another day</button></span>` : '';
    const sum = v.length > 1 ? `<button type="button" class="lk-dsum" data-lk="dates" aria-expanded="${open}" aria-controls="lk-dates">All ${v.length} visits</button>` : '';
    if (!ctl && !sum) return ''; // a read-only log, one visit: nothing
    const row = d => w ? `<li><span class="lk-dv"><label class="sr" for="lk-d-${d}">Visit on ${A.esc(shortY(d))}</label><input type="date" id="lk-d-${d}" value="${d}" max="${t}" data-lk-day="${d}" enterkeyhint="done"><button type="button" class="act" data-lk-rm="${d}">Remove</button></span><span class="lk-rmq" hidden><span>Remove the visit on ${A.esc(shortY(d))}?</span><button type="button" class="btn sm" data-lk-yes="${d}">Remove</button><button type="button" class="btn sm quiet" data-lk-no>Keep</button></span></li>` : `<li><span class="lk-dv">${A.esc(shortY(d))}</span></li>`;
    return `<div class="lk-again"><div class="lk-bar">${sum}${ctl}</div>
      ${w ? `<div class="lk-add" id="lk-add" hidden><label class="sr" for="lk-day">Date of the visit</label><input type="date" id="lk-day" max="${t}" value="${t}" enterkeyhint="done"><button type="button" class="btn sm primary" data-lk="add">Add visit</button><button type="button" class="btn sm quiet" data-lk="cancel">Cancel</button></div>` : ''}
      ${sum ? `<ul class="rows lk-dates" id="lk-dates"${open ? '' : ' hidden'}>${v.slice().reverse().map(row).join('')}</ul>` : ''}
    </div>`;
  }
  // a re-render after an edit: focus goes back where it was (the same control), else to the list when it is open, else to Been again.
  // prefer: the control to focus instead (the date just typed). Focus outside the panel is left alone
  function refocus(paint, prefer) {
    const P = A.panel, a = document.activeElement, mine = !!a && a !== document.body && P.contains(a), loose = !a || a === document.body;
    const key = prefer || (mine ? (a.dataset.lk ? `[data-lk="${a.dataset.lk}"]` : a.dataset.lkDay ? `[data-lk-day="${a.dataset.lkDay}"]` : a.id ? '#' + CSS.escape(a.id) : null) : null);
    paint();
    if (!mine && !loose) return;
    const seen = el => el && !el.disabled && el.getClientRects().length ? el : null;
    const el = seen(key && P.querySelector(key)) || (datesOpen === A.state.loc.spot && seen(P.querySelector('[data-lk="dates"]'))) || seen(P.querySelector('[data-lk="again"]'));
    if (el) el.focus({ preventScroll: true });
  }
  // one change to a spot's visits: fn(visits) returns the new list (or nothing); d: the date it adds or moves to. Saved, then undoable
  async function editVisits(id, fn, msg, d, prefer) {
    if (!A.state.canWrite) return;
    await A.beforeWrite();
    const sp = own(A.state.spots, id); if (!isBeen(sp)) return;
    const before = { had: Object.hasOwn(sp, 'visits'), visits: sp.visits, at: sp.at }, next = fn(visitsOf(sp));
    if (!next || !next.length) return;
    const f = fits(sp, next, d); if (f === false) { A.toast(CAP, 3200); return; } // the date itself would not be kept: nothing changes
    write(sp, next);
    const mine = JSON.stringify(sp.visits); refocus(A.render, prefer); const ok = await A.persist();
    if (ok === false) return;
    A.toast(msg(sp) + (f ? '. ' + CAP : ''), 6000, { label: 'Undo', run: async () => { const s = own(A.state.spots, id); if (!s || JSON.stringify(s.visits) !== mine) return; if (before.had) s.visits = before.visits; else delete s.visits; s.at = before.at; refocus(A.render); await A.persist(); } }); // only while the list is still the one written here
  }
  const addVisit = (id, d) => { if (!okDay(d)) { A.toast('Pick a day up to today', 2600); return; } const sp = own(A.state.spots, id); if (sp && visitsOf(sp).includes(d)) { A.toast(`Already a visit on ${shortY(d)}`, 2600); return; } editVisits(id, v => v.concat(d), s => `${str(s.name) || 'Spot'}: been ${shortY(d)}`, d); };
  const changeVisit = (id, from, to, viaKey) => editVisits(id, v => { const i = v.indexOf(from); if (i < 0) return null; v[i] = to; return v; }, () => `Visit moved to ${shortY(to)}`, to, viaKey ? `[data-lk-day="${to}"]` : null);
  const removeVisit = (id, d) => editVisits(id, v => v.length > 1 ? v.filter(x => x !== d) : null, () => `Visit on ${shortY(d)} removed`);
  // the date editor commits once, on Enter or when the field is left; typing in between saves nothing
  function commitDay(inp, viaKey) {
    if (inp.dataset.lkDone || !inp.isConnected) return;
    const from = inp.dataset.lkDay, to = inp.value, id = A.state.loc.spot, sp = own(A.state.spots, id);
    if (to === from) return;
    if (!okDay(to)) { inp.value = from; if (to) A.toast('Pick a day up to today', 2600); return; }
    if (sp && visitsOf(sp).includes(to)) { inp.value = from; A.toast(`Already a visit on ${shortY(to)}`, 2600); return; }
    inp.dataset.lkDone = '1'; changeVisit(id, from, to, viaKey);
  }

  // ---------- entries: every dated thing in the log ----------
  // places walked (their walked date) and each visit to a been spot; want-to-go has no date that means anything
  function entries() {
    const S = A.state, t1 = tomorrow(), out = [];
    for (const k of Object.keys(S.done || {})) {
      const e = S.done[k]; if (!Object.hasOwn(A.BY_SLUG, k) || !e || typeof e !== 'object' || !okRead(e.at, t1)) continue;
      const hood = A.BY_SLUG[k]; out.push({ t: 'place', key: 'p:' + k, date: e.at, name: hood, hood, owner: A.ownerKey.place(hood), loc: { hood }, by: A.cleanName(e.by) });
    }
    for (const id of Object.keys(S.spots || {})) {
      if (id in Object.prototype) continue; // '__proto__', 'constructor': app.js and js/photos.js look these up in plain objects, so such a spot is never offered
      const sp = S.spots[id], v = visitsOf(sp); if (!v.length) continue;
      const kind = Object.hasOwn(A.KINDS, sp.kind) ? sp.kind : 'other', hood = str(sp.hood), sub = str(sp.sub), rating = Math.max(0, Math.min(5, sp.rating | 0));
      v.forEach((d, i) => out.push({ t: 'spot', key: 's:' + id + ':' + d, date: d, id, name: str(sp.name).slice(0, 80) || 'A spot', kind, hood, sub, rating, n: i, of: v.length, owner: A.ownerKey.spot(id), loc: { spot: id }, by: i ? '' : A.cleanName(sp.by) }));
    }
    return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) || (a.t === b.t ? a.name.localeCompare(b.name) : a.t === 'place' ? -1 : 1));
  }
  const look = e => e.t === 'place' ? A.look(e.hood) : { c: A.KINDS[e.kind].c, e: A.KINDS[e.kind].e };
  const metaOf = e => (e.t === 'place' ? ['Walked'] : [A.KINDS[e.kind].label, e.sub || e.hood, e.n ? `visit ${e.n + 1}` : '']).concat(e.by ? 'by ' + e.by : '').filter(Boolean).join(' · ');

  // ---------- photos, thumbnails only (js/photos.js); a log without shared photos has none ----------
  // Photo lists load at most LIM at a time (an uncached list is several requests and all its thumbs); what has loaded this session is
  // `known`, and the counts on screen use only that, filling in as lists land
  const photosOn = () => !!window.Photos && A.state.store === 'sync';
  const known = new Map(), loading = new Map(), waiting = []; let busy = 0;
  function pump() {
    while (busy < LIM && waiting.length) {
      const [owner, res] = waiting.shift(); busy++;
      Photos.list(owner).then(l => Array.isArray(l) ? l : [], () => []).then(l => { busy--; loading.delete(owner); known.set(owner, l); res(l); heard(owner); pump(); });
    }
  }
  function listOf(owner) {
    if (!photosOn() || typeof owner !== 'string' || owner in Object.prototype) return Promise.resolve([]);
    if (loading.has(owner)) return loading.get(owner);
    const p = new Promise(res => waiting.push([owner, res])); loading.set(owner, p); pump(); return p;
  }
  const idDay = id => { const m = /^p([0-9a-z]{6,10})[0-9a-z]{2}$/.exec(id); if (!m) return null; const ms = parseInt(m[1], 36); return ms > 1.5e12 && ms < Date.now() + 864e5 ? ymd(new Date(ms)) : null; }; // a photo id starts with its upload time
  const photoDay = p => p.taken || idDay(p.id); // the capture date, else the day it was added
  const thumbFrom = (list, date) => { const l = list.filter(p => p.t); return (l.find(p => p.taken === date) || l[0] || {}).t || ''; }; // a photo from that day, else the cover
  // photos dated in the period on these owners (each photo once), from the lists known so far: { n, all: every list is known }
  function counted(owners, p) { let n = 0, all = true; for (const o of owners) { const l = known.get(o); if (!l) { all = false; continue; } n += l.filter(x => (photoDay(x) || '').startsWith(p)).length; } return { n, all }; }
  const ownersOf = ents => [...new Set(ents.map(e => e.owner))];
  const phNote = (k, os) => { const c = counted(os, k); return c.n ? ' · ' + (c.all ? plural(c.n, 'photo') : c.n + '+ photos') : ''; }; // a month's summary: '12+ photos' until every list is in
  const phNum = (os, p) => { if (!photosOn()) return '0'; const c = counted(os, p); return c.all ? String(c.n) : c.n ? c.n + '+' : '…'; }; // the recap's number
  let monthOwners = null, recapOwners = null; // what is on screen: the timeline's months and their owners, the recap's owners
  function heard(owner) { // a list landed: the counts on screen that use it
    if (monthOwners) for (const [k, os] of monthOwners) if (os.has(owner)) { const el = A.panel.querySelector(`[data-lk-month="${k}"] [data-lk-ph]`); if (el) el.textContent = phNote(k, os); }
    if (recapOwners && recapOwners.has(owner)) { const b = A.panel.querySelector('[data-lk-phn]'); if (b) b.textContent = phNum(recapOwners, period); }
  }
  const addImg = (el, t) => { if (!t || !el.isConnected || el.querySelector('img')) return; const img = new Image(); img.alt = ''; img.decoding = 'async'; img.onload = () => el.classList.add('has'); img.src = t; el.appendChild(img); };
  let io = null;
  function lazy(root) { // thumbs as their rows come into view (each row's list through the queue above)
    if (io) io.disconnect(); io = null; if (!photosOn()) return;
    const go = el => listOf(el.dataset.lkTh).then(l => addImg(el, thumbFrom(l, el.dataset.date)));
    const els = root.querySelectorAll('[data-lk-th]');
    if (!('IntersectionObserver' in window)) { els.forEach(go); return; }
    io = new IntersectionObserver(es => es.forEach(x => { if (x.isIntersecting) { io.unobserve(x.target); go(x.target); } }), { rootMargin: '120px 0px' });
    els.forEach(el => io.observe(el));
  }
  const thumb = (e, extra) => { const l = look(e); return `<span class="lk-th" style="--c:${l.c}" aria-hidden="true"${photosOn() ? ` data-lk-th="${A.esc(e.owner)}" data-date="${e.date}"` : ''}${extra || ''}><i>${l.e}</i></span>`; };

  // ---------- the timeline ----------
  let year = null, shown = null; // shown: the view drawn last (from the first screen the timeline opens on this year)
  function renderTimeline() {
    const P = A.panel, all = entries(), years = [...new Set(all.map(e => e.date.slice(0, 4)))], now = today().slice(0, 4);
    if (!years.includes(year)) year = years.includes(now) ? now : years[0] || null;
    A.setHead({ eyebrow: 'Logbook', title: 'Timeline', onBack: () => A.go(A.state.loc, { replace: true, fly: false }), tools: [] });
    if (!all.length) { monthOwners = null; P.innerHTML = '<p class="empty lk-empty">Nothing with a date yet. Mark a place as been, or log a spot you have been to, and it lands here, month by month.</p>'; return; }
    const list = all.filter(e => e.date.startsWith(year)), months = [];
    for (const e of list) { const k = e.date.slice(0, 7); if (!months.length || months[months.length - 1].k !== k) months.push({ k, es: [] }); months[months.length - 1].es.push(e); }
    monthOwners = photosOn() ? new Map(months.map(m => [m.k, new Set(ownersOf(m.es))])) : null;
    const cur = now === year;
    P.innerHTML = (years.length > 1 ? `<div class="textlinks chips lk-years" role="group" aria-label="Year">${years.map(y => `<button type="button" data-lk-year="${y}" aria-pressed="${y === year}">${y}</button>`).join('')}</div>` : '')
      + `<button type="button" class="lk-yr" data-lk-recap="${year}"><b>${cur ? 'This year' : year}</b><span>${cur ? 'The year so far' : 'The whole year'}, in numbers and a picture</span><span class="chev" aria-hidden="true"></span></button>`
      + months.map(m => {
        const pl = m.es.filter(e => e.t === 'place').length, sp = new Set(m.es.filter(e => e.t === 'spot').map(e => e.id)).size;
        const sum = [pl ? plural(pl, 'place walked', 'places walked') : '', sp ? plural(sp, 'spot') : ''].filter(Boolean).join(' · ');
        return `<section class="lk-month" data-lk-month="${m.k}" aria-label="${A.esc(monthName(m.k))}"><h3 class="lk-mh"><button type="button" data-lk-recap="${m.k}"><span><b>${A.esc(monthName(m.k))}</b><small>${sum}<span data-lk-ph>${monthOwners ? phNote(m.k, monthOwners.get(m.k)) : ''}</span></small></span><span class="lk-rc">Recap</span></button></h3>
          <ul class="rows">${m.es.map(e => `<li><button type="button" class="row lk-row" data-lk-go='${A.attr(e.loc)}'>${thumb(e)}<span class="nm">${A.esc(e.name)}<small>${A.esc(metaOf(e))}</small></span><span class="rt">${A.esc(short(e.date))}</span></button></li>`).join('')}</ul></section>`;
      }).join('');
    lazy(P);
  }

  // ---------- on this day ----------
  // today's month and day in an earlier year (an entry on Feb 29 shows on Feb 28 in a year without one), or exactly 1, 3 or 6
  // months ago (none when that day does not exist in that month)
  function matches(all) {
    const t = today(), [y, m, d] = ymdOf(t), leap = dim(y, 2) === 29, out = [];
    const ago = [6, 3, 1].map(n => { let ty = y, tm = m - n; if (tm < 1) { tm += 12; ty--; } return [n, d <= dim(ty, tm) ? `${ty}-${pad(tm)}-${pad(d)}` : null]; });
    for (const e of all) {
      const [ey, em, ed] = ymdOf(e.date);
      if (ey < y && em === m && (ed === d || (!leap && m === 2 && d === 28 && ed === 29))) { out.push({ e, years: y - ey }); continue; }
      const a = ago.find(([, s]) => s === e.date); if (a) out.push({ e, months: a[0] });
    }
    return out;
  }
  const otdLine = c => c.years ? (c.years === 1 ? 'A year ago today' : `${c.years} years ago today`) : c.months === 1 ? 'A month ago today' : `${c.months} months ago today`;
  const offToday = () => { try { return localStorage.getItem(DISMISS) === today(); } catch (e) { return false; } };
  // one card, chosen from the log alone so it is in the first paint: years before months, then the longer ago, then spots before
  // places (a spot is the more particular memory), then by name
  const pick = cs => cs.slice().sort((a, b) => (!!b.years - !!a.years) || ((b.years || b.months) - (a.years || a.months)) || (a.e.t === b.e.t ? a.e.name.localeCompare(b.e.name) : a.e.t === 'place' ? 1 : -1))[0];
  function cardHtml(c, th) {
    const e = c.e, l = look(e), what = e.t === 'place' ? 'Walked' : [A.KINDS[e.kind].label, e.sub || e.hood].filter(Boolean).join(' · ');
    return `<div class="lk-otd" id="lk-otd"><button type="button" class="lk-otd-go" data-lk-go='${A.attr(e.loc)}'><span class="lk-th${th ? ' has' : ''}" style="--c:${l.c}" aria-hidden="true"><i>${l.e}</i>${th ? `<img alt="" src="${A.esc(th)}">` : ''}</span><span class="lk-otd-t"><small>${otdLine(c)}</small><b>${A.esc(e.name)}</b><span>${A.esc(what)}</span></span></button><button type="button" class="lk-otd-x" data-lk="otd-off" aria-label="Hide until tomorrow"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>`;
  }
  // the first screen asks for the card on every render: the choice is kept for the day and these entries; the thumbnail is asked for
  // once and slipped into the card in place (a fixed-size square: the card keeps its height)
  let otd = { sig: null };
  function card() {
    if (offToday()) return '';
    const cs = matches(entries()); if (!cs.length) return '';
    const sig = today() + '|' + A.state.store + '|' + cs.map(c => c.e.key).join(',');
    if (otd.sig !== sig) otd = { sig, c: pick(cs), th: '', asked: false };
    const o = otd;
    if (!o.asked && photosOn()) { o.asked = true; Promise.resolve().then(() => listOf(o.c.e.owner)).then(l => { o.th = thumbFrom(l, o.c.e.date); const el = otd === o && document.querySelector('#lk-otd .lk-th'); if (el) addImg(el, o.th); }); }
    return cardHtml(o.c, o.th);
  }

  // ---------- the recap ----------
  let period = null;
  function stats(p) {
    const all = entries(), ents = all.filter(e => e.date.startsWith(p)), visits = ents.filter(e => e.t === 'spot');
    const latest = new Map(); for (const e of visits) if (!latest.has(e.id)) latest.set(e.id, e); // newest first: each spot's last visit in the period
    const top = [...latest.values()].filter(e => e.rating > 0).sort((a, b) => b.rating - a.rating || (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) || a.name.localeCompare(b.name)).slice(0, 3);
    const first = new Map(); for (const e of all) { if (!Object.hasOwn(A.IDX, e.hood)) continue; if (!first.has(e.hood) || e.date < first.get(e.hood)) first.set(e.hood, e.date); } // every place's first entry of any kind
    const hoods = [...first.keys()].filter(h => first.get(h).startsWith(p)).sort((a, b) => a.localeCompare(b));
    return { ents, places: ents.filter(e => e.t === 'place').length, spots: visits.filter(e => e.n === 0).length, visits: visits.length, top, hoods };
  }
  const stars = r => '★'.repeat(r);
  const imgOwners = s => [...new Set(s.top.map(e => e.owner).concat(s.ents.map(e => e.owner)))]; // the top-rated spots first
  function renderRecap() {
    const P = A.panel, p = period, s = stats(p), name = periodName(p);
    A.setHead({ eyebrow: p.length === 4 ? 'Recap · the year' : 'Recap · the month', title: A.esc(name), onBack: backToTimeline, tools: [] });
    recapOwners = photosOn() ? new Set(ownersOf(s.ents)) : null;
    const num = (n, label, extra) => `<div><b${extra || ''}>${n}</b><span>${label}</span></div>`;
    P.innerHTML = `<div class="lk-nums">${num(s.places, s.places === 1 ? 'place walked' : 'places walked')}${num(s.spots, s.spots === 1 ? 'new spot' : 'new spots')}${num(s.visits, s.visits === 1 ? 'visit' : 'visits')}${num(recapOwners ? phNum(recapOwners, p) : 0, 'photos', ' data-lk-phn')}</div>
      ${s.top.length ? `<h3>Top rated</h3><ul class="rows">${s.top.map(e => `<li><button type="button" class="row lk-row" data-lk-go='${A.attr(e.loc)}'>${thumb(e)}<span class="nm">${A.esc(e.name)}<small>${A.esc([A.KINDS[e.kind].label, e.sub || e.hood].filter(Boolean).join(' · '))}</small></span><span class="rt lk-stars" role="img" aria-label="${e.rating} of 5 stars">${stars(e.rating)}</span></button></li>`).join('')}</ul>` : ''}
      ${s.hoods.length ? `<h3>New neighborhoods <span class="n">${s.hoods.length}</span></h3><div class="textlinks">${s.hoods.map(h => `<button type="button" data-lk-go='${A.attr({ hood: h })}'>${A.esc(h)}</button>`).join('')}</div>` : ''}
      <div class="actions lk-share"><button type="button" class="btn primary" data-lk="share">Share as image</button></div>
      <div class="lk-out" id="lk-out" hidden></div>`;
    lazy(P);
    prepare(p); shareBtn(); // the image first (its lists go out first), then every list for the count; with the count complete the image is drawn again
    if (recapOwners) Promise.all([...recapOwners].map(listOf)).then(() => { if (period === p && A.state.view === 'recap') prepare(p); });
  }
  let tlY = 0; // where the timeline was scrolled to when a recap opened
  function openRecap(p) { tlY = A.panel.scrollTop; period = p; A.go(A.state.loc, { view: 'recap', fly: false, replace: true, sheet: A.isPhone() ? 'full' : undefined }); }
  function backToTimeline() { const y = tlY; A.go(A.state.loc, { view: 'timeline', fly: false, replace: true }); requestAnimationFrame(() => { A.panel.scrollTop = y; }); }

  // ---------- the image: 1080 x 1350, light palette, drawn once the fonts are in ----------
  // made: the image being drawn or drawn last, for these numbers (sk) and this photo count (nph); ready: the last one finished, which the
  // Share tap hands to the share sheet at once (a tap's permission does not survive waiting for a drawing)
  let made = null, ready = null;
  function prepare(p) {
    const s = stats(p), sk = p + '|' + JSON.stringify([s.places, s.spots, s.visits, s.top.map(e => e.key), s.hoods, s.ents.map(e => e.key)]);
    if (made && made.p === p && made.sk === sk && (made.busy || made.nph === phNum(new Set(ownersOf(s.ents)), p))) return;
    const job = made = { p, sk, busy: true, failed: false, nph: null }, name = `seven-by-seven-${p}.png`;
    imgOwners(s).slice(0, IMGN).forEach(listOf); // the image's lists join the queue first
    draw(p, s, job).then(c => new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('no image')), 'image/png'))).then(b => {
      job.busy = false; const r = { file: new File([b], name, { type: 'image/png' }), url: URL.createObjectURL(b), name };
      if (made !== job) { URL.revokeObjectURL(r.url); return; }
      const old = ready; ready = { p, sk, r }; if (old) setTimeout(() => { if (!document.querySelector(`#lk-out [src="${old.r.url}"]`)) URL.revokeObjectURL(old.r.url); }, 60000);
      shareBtn();
    }, e => { job.busy = false; job.failed = true; console.warn('recap image failed', e); shareBtn(); });
  }
  const isReady = () => !!(ready && made && ready.p === period && ready.sk === made.sk);
  function shareBtn() { // 'Preparing the image' (disabled) until an image for these numbers is ready
    const b = A.panel.querySelector('[data-lk="share"]'); if (!b) return; const ok = isReady(), bad = !ok && made && made.failed;
    b.disabled = !ok; b.textContent = ok ? 'Share as image' : bad ? 'Could not make the image' : 'Preparing the image';
    if (ok || bad) b.removeAttribute('aria-busy'); else b.setAttribute('aria-busy', 'true');
  }
  async function fonts() {
    if (!document.fonts) return;
    try { await Promise.all(['700 100px "Bricolage Grotesque"', '600 40px "Bricolage Grotesque"', '400 28px Figtree', '500 28px Figtree', '600 28px Figtree', '700 28px Figtree'].map(f => document.fonts.load(f, 'Seven by Seven 0123456789'))); await document.fonts.ready; } catch (e) {}
  }
  const loadImg = src => new Promise(res => { if (!src) { res(null); return; } const i = new Image(); i.onload = () => (i.decode ? i.decode().catch(() => {}) : Promise.resolve()).then(() => res(i.naturalWidth ? i : null)); i.onerror = () => res(null); i.src = src; }); // a photo that fails is left out
  async function photosFor(s, p) { // up to six thumbs of photos from the period: the top-rated spots first, then the rest, newest first; one per place or spot in turn
    const lists = await Promise.all(imgOwners(s).slice(0, IMGN).map(listOf));
    const per = lists.map(l => l.filter(x => x.t && (photoDay(x) || '').startsWith(p)).map(x => x.t));
    const out = []; for (let r = 0; out.length < 6 && per.some(l => l.length > r); r++) per.forEach(l => { if (out.length < 6 && l[r]) out.push(l[r]); });
    return (await Promise.all(out.map(loadImg))).filter(Boolean);
  }
  function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function fit(g, text, max) { if (g.measureText(text).width <= max) return text; const cs = Array.from(text); while (cs.length > 1 && g.measureText(cs.join('') + '…').width > max) cs.pop(); return cs.join('').trimEnd() + '…'; } // by code point: never half an emoji
  const spaced = (g, px) => { if ('letterSpacing' in g) g.letterSpacing = px + 'px'; };
  async function draw(p, s, job) {
    await fonts();
    const imgs = await photosFor(s, p), nph = job.nph = photosOn() ? phNum(new Set(ownersOf(s.ents)), p) : '0'; // the photo count as known now ('37+' while lists are still out)
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d'), L = LIGHT, X = 96, R = W - 96, D = '"Bricolage Grotesque", "Avenir Next", "Helvetica Neue", Arial, sans-serif', F = 'Figtree, "Avenir Next", "Helvetica Neue", Arial, sans-serif';
    g.fillStyle = L.paper; g.fillRect(0, 0, W, H);
    g.strokeStyle = L.line2; g.lineWidth = 2; rr(g, 40, 40, W - 80, H - 80, 28); g.stroke(); // the postcard edge
    g.textBaseline = 'alphabetic';
    // the wordmark, and the passport stamp of the period
    g.font = `700 52px ${D}`; g.fillStyle = L.ink; g.fillText('Seven by Seven', X, 146); g.fillStyle = L.accent; g.fillText('.', X + g.measureText('Seven by Seven').width, 146);
    g.save(); g.translate(R - 120, 124); g.rotate(-5 * Math.PI / 180); g.globalAlpha = .86; g.font = `700 26px ${D}`; spaced(g, 3);
    const st = p.length === 4 ? 'RECAP ' + p : 'RECAP ' + dayOf(p + '-01', { month: 'short' }).toUpperCase() + ' ' + p.slice(0, 4), sw = g.measureText(st).width + 36;
    g.strokeStyle = L.accent; g.fillStyle = L.accent; g.lineWidth = 4; rr(g, -sw / 2, -30, sw, 58, 10); g.stroke(); g.lineWidth = 1.5; g.globalAlpha = .4; rr(g, -sw / 2 + 7, -23, sw - 14, 44, 6); g.stroke(); g.globalAlpha = .86;
    g.textAlign = 'center'; g.fillText(st, 0, 9); g.restore(); spaced(g, 0); g.textAlign = 'left';
    // the period
    g.fillStyle = L.ink; g.font = `700 108px ${D}`; g.fillText(fit(g, periodName(p), R - X), X - 4, 292);
    g.fillStyle = L.muted; g.font = `500 32px ${F}`; g.fillText(p.length === 4 ? 'The year in the logbook' : 'The month in the logbook', X, 346);
    // the numbers: each at 96 px, smaller until it fits its column
    const nums = [[s.places, s.places === 1 ? 'PLACE WALKED' : 'PLACES WALKED'], [s.spots, s.spots === 1 ? 'NEW SPOT' : 'NEW SPOTS'], [s.visits, s.visits === 1 ? 'VISIT' : 'VISITS'], [nph, nph === '1' ? 'PHOTO' : 'PHOTOS']], cw = (R - X) / 4;
    g.strokeStyle = L.line2; g.lineWidth = 2; g.beginPath(); g.moveTo(X, 404); g.lineTo(R, 404); g.moveTo(X, 590); g.lineTo(R, 590); g.stroke();
    nums.forEach(([n, l], i) => {
      const x = X + i * cw + (i ? 24 : 0), room = cw - (i ? 24 : 0) - 16, t = String(n); let fs = 96;
      if (i) { g.strokeStyle = L.line; g.beginPath(); g.moveTo(X + i * cw, 432); g.lineTo(X + i * cw, 562); g.stroke(); }
      g.fillStyle = i ? L.ink : L.accent; g.font = `700 ${fs}px ${D}`; while (fs > 32 && g.measureText(t).width > room) { fs -= 4; g.font = `700 ${fs}px ${D}`; }
      g.fillText(t, x, 516); g.fillStyle = L.muted; g.font = `600 18px ${F}`; spaced(g, 1.5); g.fillText(fit(g, l, cw - 28), x, 556); spaced(g, 0);
    });
    let y = 622;
    // up to six photos in a grid
    if (imgs.length) {
      const n = imgs.length, cols = n <= 3 ? n : n === 4 ? 2 : 3, rows = Math.ceil(n / cols), gap = 16, wcell = (R - X - gap * (cols - 1)) / cols, hcell = Math.min(wcell * (cols === 1 ? .56 : cols === 2 ? .62 : .8), n > 3 ? (360 - gap) / 2 : 260); // room left under the grid for the top-rated spots
      imgs.forEach((im, i) => {
        const r = Math.floor(i / cols), inRow = Math.min(cols, n - r * cols), off = (cols - inRow) * (wcell + gap) / 2, x = X + off + (i % cols) * (wcell + gap), yy = y + r * (hcell + gap);
        const k = Math.max(wcell / im.naturalWidth, hcell / im.naturalHeight), sw2 = wcell / k, sh2 = hcell / k;
        g.save(); rr(g, x, yy, wcell, hcell, 18); g.clip(); g.fillStyle = L.paper3; g.fillRect(x, yy, wcell, hcell); g.drawImage(im, (im.naturalWidth - sw2) / 2, (im.naturalHeight - sh2) / 2, sw2, sh2, x, yy, wcell, hcell); g.restore();
      });
      y += rows * hcell + (rows - 1) * gap + 50;
    }
    // the best spots, then the first times
    const head = t => { g.fillStyle = L.muted; g.font = `600 22px ${F}`; spaced(g, 2.5); g.fillText(t, X, y); spaced(g, 0); y += 46; };
    if (s.top.length && y < H - 200) {
      head('TOP RATED');
      for (const e of s.top) { if (y > H - 150) break; g.fillStyle = L.star; g.font = `400 30px ${F}`; const sr = stars(e.rating), w = g.measureText(sr).width; g.fillText(sr, R - w, y); g.fillStyle = L.ink; g.font = `600 36px ${D}`; g.fillText(fit(g, e.name, R - X - w - 30), X, y); y += 54; }
      y += 18;
    }
    if (s.hoods.length && y < H - 170) {
      head(s.hoods.length === 1 ? 'A NEW NEIGHBORHOOD' : s.hoods.length + ' NEW NEIGHBORHOODS');
      const lim = H - 124; // the last baseline clear of the footer (its text sits at H - 84)
      g.fillStyle = L.ink2; g.font = `500 32px ${F}`; let line = '', lines = 0, more = false;
      for (const h of s.hoods) { const t = line ? line + ' · ' + h : h; if (g.measureText(t).width > R - X && line) { if (lines === 2 || y + 44 > lim) { more = true; break; } g.fillText(line, X, y); y += 44; lines++; line = h; } else line = t; }
      if (line && y <= lim) g.fillText(fit(g, more ? line + ' …' : line, R - X), X, y);
    }
    g.fillStyle = L.muted; g.font = `500 22px ${F}`; g.fillText('A trail map of the Bay Area', X, H - 84); g.fillStyle = L.accent; g.beginPath(); g.arc(R - 8, H - 92, 8, 0, Math.PI * 2); g.fill();
    return c;
  }
  // the Share tap: the ready image goes to the share sheet inside the tap itself (nothing awaited first); no file sharing, or a refusal
  // that is not the user cancelling, shows the picture to press and hold instead
  function share() {
    const p = period; if (!isReady()) return;
    const r = ready.r, files = [r.file]; let can = false;
    try { can = !!(navigator.canShare && navigator.share && navigator.canShare({ files })); } catch (e) {}
    if (!can) { fallback(p, r); return; }
    let sh; try { sh = navigator.share({ files, title: 'Seven by Seven · ' + periodName(p) }); } catch (e) { fallback(p, r); return; }
    Promise.resolve(sh).catch(e => { if (!(e && e.name === 'AbortError')) fallback(p, r); });
  }
  function fallback(p, r) {
    const out = A.panel.querySelector('#lk-out'); if (!out || period !== p) return;
    out.innerHTML = `<img src="${r.url}" alt="The recap of ${A.esc(periodName(p))} as an image" width="${W}" height="${H}"><p class="lk-hold">Press and hold the image to save it</p><div class="actions"><a class="btn sm" href="${r.url}" download="${A.esc(r.name)}">Save image</a></div>`;
    out.hidden = false; out.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  // ---------- events: one delegated listener on the panel for everything this file draws ----------
  function onClick(ev) {
    const b = ev.target.closest('[data-lk], [data-lk-go], [data-lk-year], [data-lk-recap], [data-lk-rm], [data-lk-yes], [data-lk-no]'); if (!b || !A.panel.contains(b) || b.disabled) return;
    const id = A.state.loc.spot, li = b.closest('li');
    if (b.dataset.lkGo) { let l = null; try { l = JSON.parse(b.dataset.lkGo); } catch (e) {} if (l) A.go(l, { tap: true }); return; }
    if (b.dataset.lkYear) { year = b.dataset.lkYear; renderTimeline(); A.panel.scrollTop = 0; return; }
    if (b.dataset.lkRecap) { openRecap(b.dataset.lkRecap); return; }
    if (b.dataset.lkRm) { li.querySelector('.lk-dv').hidden = true; li.querySelector('.lk-rmq').hidden = false; li.querySelector('[data-lk-no]').focus(); return; }
    if (b.hasAttribute('data-lk-no')) { li.querySelector('.lk-rmq').hidden = true; li.querySelector('.lk-dv').hidden = false; li.querySelector('[data-lk-rm]').focus(); return; }
    if (b.dataset.lkYes) { removeVisit(id, b.dataset.lkYes); return; }
    const k = b.dataset.lk, add = A.panel.querySelector('#lk-add'), other = A.panel.querySelector('[data-lk="other"]');
    if (k === 'again') addVisit(id, today());
    else if (k === 'other' && add) { add.hidden = !add.hidden; other.setAttribute('aria-expanded', String(!add.hidden)); if (!add.hidden) add.querySelector('input').focus(); }
    else if (k === 'cancel' && add) { add.hidden = true; other.setAttribute('aria-expanded', 'false'); other.focus(); }
    else if (k === 'add' && add) addVisit(id, add.querySelector('input').value);
    else if (k === 'dates') { const l = A.panel.querySelector('#lk-dates'); if (!l) return; l.hidden = !l.hidden; datesOpen = l.hidden ? null : id; b.setAttribute('aria-expanded', String(!l.hidden)); }
    else if (k === 'otd-off') { try { localStorage.setItem(DISMISS, today()); } catch (e) {} const c = A.panel.querySelector('#lk-otd'); if (c) c.remove(); A.toast('Hidden until tomorrow', 2200); }
    else if (k === 'share') share();
  }
  function onKey(e) {
    const t = e.target;
    if (t.id === 'lk-day') {
      if (e.key === 'Enter') { e.preventDefault(); addVisit(A.state.loc.spot, t.value); }
      else if (e.key === 'Escape') { e.stopPropagation(); const add = A.panel.querySelector('#lk-add'), other = A.panel.querySelector('[data-lk="other"]'); add.hidden = true; other.setAttribute('aria-expanded', 'false'); other.focus(); }
    } else if (t.dataset && t.dataset.lkDay) {
      if (e.key === 'Enter') { e.preventDefault(); commitDay(t, true); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); t.value = t.dataset.lkDay; } // the old date back; the field keeps the focus
    }
  }
  function init(o) {
    A = o;
    A.panel.addEventListener('click', onClick);
    A.panel.addEventListener('keydown', onKey);
    A.panel.addEventListener('focusout', e => { if (e.target.dataset && e.target.dataset.lkDay) commitDay(e.target, false); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && A.state.view === 'recap' && !document.querySelector('dialog[open]') && !(e.target.matches && e.target.matches('input, textarea, select'))) { e.stopImmediatePropagation(); backToTimeline(); } }, true); // Escape on a recap: back to the timeline, not the first screen
  }
  // app.js render(), with every view but the log form and the spots list: draws the timeline or the recap, and lets go of them otherwise
  function view(v) {
    const was = shown; shown = v;
    if (v !== 'timeline' && v !== 'recap' && io) { io.disconnect(); io = null; }
    if (v !== 'timeline') monthOwners = null; if (v !== 'recap') recapOwners = null;
    if (v === 'timeline') { if (was !== 'timeline' && was !== 'recap') year = null; renderTimeline(); return true; } // from anywhere but the timeline or a recap: this year
    if (v === 'recap' && period) { renderRecap(); return true; }
    return false;
  }
  return { init, view, card, stamp, spotBlock, carry, join, markBeen, setLatest, photoOffer, photoDate, visitsOf, today, debug: { clean, okDay, okRead, entries, matches, stats, prepare, open: openRecap, get ready() { return isReady(); }, image: () => isReady() ? ready.r : null, queue: () => ({ busy, waiting: waiting.length, known: known.size }), fit, io: () => !!io } };
})();
