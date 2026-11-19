// Looking back: repeat visits on a spot, the timeline (everything with a date, newest first, month by month), "on this day" on the
// first screen, and the recap of a month or a year, shareable as an image.
// Dates are local calendar dates kept as 'YYYY-MM-DD' strings and compared as strings. A Date is only ever built from numbers
// (new Date(y, m - 1, d)), never parsed from one of those strings, so no time zone moves a day.
// The log: spot.visits = ['YYYY-MM-DD', ...] (sorted, unique, at most 60, none in the future) beside spot.at, which always equals
// the latest visit. A spot with `at` and no `visits` is one visit and is left as it is until a visit is added or changed. Another
// device on older code that saves a spot through its log form rebuilds the spot and drops `visits`; `at` survives, so the spot then
// reads as one visit on its latest date. Older code that moves `at` in place (a photo's capture date) moves the latest visit.
// Everything read from the log is untrusted: dates are checked one by one, lookups use own keys, strings are escaped.
// init({ state, panel, go, render, persist, beforeWrite, toast, setHead, esc, attr, KINDS, IDX, BY_SLUG, ownerKey, cleanName, niceDate,
// isPhone, look, VERDICT }) from app.js.
window.Lookback = (() => {
  const VMAX = 60, SCAN = 2000; // VMAX: visits kept on a spot (the latest); SCAN: entries of a visits list looked at, at most
  const DISMISS = 'sbs-otd-off'; // this device: the day the on-this-day card was put away
  const W = 1080, H = 1350; // the shared image
  const LIGHT = { paper: '#fdfbf6', paper2: '#f4efe4', paper3: '#ebe4d6', ink: '#15202b', ink2: '#3c4a57', muted: '#6b6559', line: '#e8e1d2', line2: '#d2c9b6', accent: '#e85a1f', star: '#b07d0a' }; // css/app.css :root: the image is always drawn light
  let A = null;
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const today = () => ymd(new Date());
  const dim = (y, m) => new Date(y, m, 0).getDate(); // days in month m (1-12) of year y
  const ymdOf = s => [+s.slice(0, 4), +s.slice(5, 7), +s.slice(8, 10)];
  const okDay = (s, t) => { if (typeof s !== 'string' || s.length !== 10 || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false; const [y, m, d] = ymdOf(s); return y >= 1900 && m >= 1 && m <= 12 && d >= 1 && d <= dim(y, m) && s <= (t || today()); };
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
  function clean(a, t = today()) { // a visits list from the log: the well-formed real dates up to today, sorted, unique, the latest 60
    if (!Array.isArray(a)) return [];
    const out = new Set(); for (let i = 0; i < a.length && i < SCAN; i++) if (okDay(a[i], t)) out.add(a[i]);
    return [...out].sort().slice(-VMAX);
  }
  // every visit of a been spot; `at` is the latest one (older code may have moved it: then it replaces the latest)
  function visitsOf(sp) {
    if (!isBeen(sp)) return [];
    const t = today(), v = clean(sp.visits, t), at = okDay(sp.at, t) ? sp.at : null;
    if (!v.length) return at ? [at] : [];
    if (at && at !== v[v.length - 1]) { v[v.length - 1] = at; return [...new Set(v)].sort(); }
    return v;
  }
  function write(sp, list) { const v = clean(list); if (!v.length) return false; sp.visits = v; sp.at = v[v.length - 1]; return true; }
  // the stamp on a spot page: one visit reads as before ('Been · Nov 10'); more: 'Been 3 times · last Nov 10'
  function stamp(sp) {
    const v = visitsOf(sp);
    if (v.length < 2) return 'Been' + (sp && sp.at ? ' · ' + A.niceDate(str(sp.at)) : '');
    return `Been ${v.length === 2 ? 'twice' : v.length + ' times'} · last ${shortY(v[v.length - 1])}`;
  }
  // the log form saved a spot (app.js rebuilt it from the form): its date edits the latest visit. A spot that had no visits list is
  // left as one visit; a spot saved as want to go keeps none
  function carry(prev, next) {
    if (!prev || !next || !isBeen(prev) || !isBeen(next) || !Array.isArray(prev.visits)) return;
    const v = visitsOf(prev); if (!v.length) return;
    if (okDay(next.at)) v[v.length - 1] = next.at;
    write(next, v);
  }
  // older-code paths that set `at` in place (a photo's capture date as the visit date): the latest visit moves with it
  function setLatest(sp, date) {
    if (!Array.isArray(sp.visits) || !okDay(date)) { sp.at = date; return; }
    const v = visitsOf(sp); v[v.length - 1] = date; if (!write(sp, v)) sp.at = date;
  }
  let datesOpen = null; // the spot whose list of visits is open: it stays open through the re-render after an edit
  function spotBlock(id) {
    const sp = own(A.state.spots, id); if (!isBeen(sp)) return '';
    const v = visitsOf(sp), t = today(), dis = A.state.canWrite ? '' : ' disabled';
    return `<div class="lk-again">
      <div class="actions"><button type="button" class="btn sm" data-lk="again"${dis}>Been again</button><button type="button" class="btn sm quiet" data-lk="other" aria-expanded="false" aria-controls="lk-add"${dis}>Another day</button></div>
      <div class="lk-add" id="lk-add" hidden><label class="sr" for="lk-day">Date of the visit</label><input type="date" id="lk-day" max="${t}" value="${t}"><button type="button" class="btn sm primary" data-lk="add">Add visit</button><button type="button" class="btn sm quiet" data-lk="cancel">Cancel</button></div>
      ${v.length > 1 ? `<details class="lk-dates"${datesOpen === id ? ' open' : ''}><summary>All ${v.length} visits</summary><ul class="rows">${v.slice().reverse().map(d => `<li><span class="lk-dv"><label class="sr" for="lk-d-${d}">Visit on ${A.esc(shortY(d))}</label><input type="date" id="lk-d-${d}" value="${d}" max="${t}" data-lk-day="${d}"${dis}><button type="button" class="act" data-lk-rm="${d}"${dis}>Remove</button></span><span class="lk-rmq" hidden><span>Remove the visit on ${A.esc(shortY(d))}?</span><button type="button" class="btn sm" data-lk-yes="${d}">Remove</button><button type="button" class="btn sm quiet" data-lk-no>Keep</button></span></li>`).join('')}</ul></details>` : ''}
    </div>`;
  }
  // one change to a spot's visits: fn(visits) returns the new list (or nothing). Saved, then undoable from the toast
  async function editVisits(id, fn, msg) {
    if (!A.state.canWrite) return;
    await A.beforeWrite();
    const sp = own(A.state.spots, id); if (!isBeen(sp)) return;
    const before = { had: Object.hasOwn(sp, 'visits'), visits: sp.visits, at: sp.at }, cur = visitsOf(sp), next = fn(cur.slice());
    if (!next || !write(sp, next)) return;
    const mine = JSON.stringify(sp.visits); A.render(); const ok = await A.persist();
    if (ok === false) return;
    A.toast(msg(sp), 6000, { label: 'Undo', run: async () => { const s = own(A.state.spots, id); if (!s || JSON.stringify(s.visits) !== mine) return; if (before.had) s.visits = before.visits; else delete s.visits; s.at = before.at; A.render(); await A.persist(); } }); // only while the list is still the one written here
  }
  const addVisit = (id, d) => { if (!okDay(d)) { A.toast('Pick a day up to today', 2600); return; } const sp = own(A.state.spots, id); if (sp && visitsOf(sp).includes(d)) { A.toast(`Already a visit on ${shortY(d)}`, 2600); return; } editVisits(id, v => v.concat(d), s => `${str(s.name) || 'Spot'}: been ${shortY(d)}`); };
  const changeVisit = (id, from, to) => editVisits(id, v => { const i = v.indexOf(from); if (i < 0) return null; v[i] = to; return v; }, s => `Visit moved to ${shortY(to)}`);
  const removeVisit = (id, d) => editVisits(id, v => v.length > 1 ? v.filter(x => x !== d) : null, s => `Visit on ${shortY(d)} removed`);

  // ---------- entries: every dated thing in the log ----------
  // places walked (their walked date) and each visit to a been spot; want-to-go has no date that means anything
  function entries() {
    const S = A.state, t = today(), out = [];
    for (const k of Object.keys(S.done || {})) {
      const e = S.done[k]; if (!Object.hasOwn(A.BY_SLUG, k) || !e || typeof e !== 'object' || !okDay(e.at, t)) continue;
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
  const photosOn = () => !!window.Photos && A.state.store === 'sync';
  const listOf = owner => photosOn() && !(owner in Object.prototype) ? Photos.list(owner).then(l => Array.isArray(l) ? l : [], () => []) : Promise.resolve([]);
  const idDay = id => { const m = /^p([0-9a-z]{6,10})[0-9a-z]{2}$/.exec(id); if (!m) return null; const ms = parseInt(m[1], 36); return ms > 1.5e12 && ms < Date.now() + 864e5 ? ymd(new Date(ms)) : null; }; // a photo id starts with its upload time
  const photoDay = p => p.taken || idDay(p.id); // the capture date, else the day it was added
  const thumbFrom = (list, date) => { const l = list.filter(p => p.t); return (l.find(p => p.taken === date) || l[0] || {}).t || ''; }; // a photo from that day, else the cover
  // photos dated in the period, on the places and spots that have an entry in it (each photo once)
  function countPhotos(ents, p) { const owners = [...new Set(ents.map(e => e.owner))]; return Promise.all(owners.map(listOf)).then(ls => ls.reduce((n, l) => n + l.filter(x => { const d = photoDay(x); return d && d.startsWith(p); }).length, 0)); }
  let io = null;
  function lazy(root) { // thumbs as their rows come into view; month photo counts as their months do
    if (io) io.disconnect(); io = null; if (!photosOn()) return;
    const go = el => {
      if (el.dataset.lkTh) listOf(el.dataset.lkTh).then(l => { const t = thumbFrom(l, el.dataset.date); if (!t || !el.isConnected || el.querySelector('img')) return; const img = new Image(); img.alt = ''; img.decoding = 'async'; img.onload = () => el.classList.add('has'); img.src = t; el.appendChild(img); });
      else if (el.dataset.lkMonth) { const k = el.dataset.lkMonth, ents = entries().filter(e => e.date.startsWith(k)); countPhotos(ents, k).then(n => { const s = el.querySelector('[data-lk-ph]'); if (s && n) s.textContent = ' · ' + plural(n, 'photo'); }); }
    };
    const els = root.querySelectorAll('[data-lk-th], [data-lk-month]');
    if (!('IntersectionObserver' in window)) { els.forEach(go); return; }
    io = new IntersectionObserver(es => es.forEach(x => { if (x.isIntersecting) { io.unobserve(x.target); go(x.target); } }), { rootMargin: '120px 0px' });
    els.forEach(el => io.observe(el));
  }
  const thumb = (e, extra) => { const l = look(e); return `<span class="lk-th" style="--c:${l.c}" aria-hidden="true"${photosOn() ? ` data-lk-th="${A.esc(e.owner)}" data-date="${e.date}"` : ''}${extra || ''}><i>${l.e}</i></span>`; };

  // ---------- the timeline ----------
  let year = null;
  function renderTimeline() {
    const P = A.panel, all = entries(), years = [...new Set(all.map(e => e.date.slice(0, 4)))];
    if (!years.includes(year)) year = years[0] || null;
    A.setHead({ eyebrow: 'Logbook', title: 'Timeline', onBack: () => A.go(A.state.loc, { replace: true, fly: false }), tools: [] });
    if (!all.length) { P.innerHTML = '<p class="empty lk-empty">Nothing with a date yet. Mark a place as been, or log a spot you have been to, and it lands here, month by month.</p>'; return; }
    const list = all.filter(e => e.date.startsWith(year)), months = [];
    for (const e of list) { const k = e.date.slice(0, 7); if (!months.length || months[months.length - 1].k !== k) months.push({ k, es: [] }); months[months.length - 1].es.push(e); }
    const now = today().slice(0, 4) === year;
    P.innerHTML = (years.length > 1 ? `<div class="textlinks chips lk-years" role="group" aria-label="Year">${years.map(y => `<button type="button" data-lk-year="${y}" aria-pressed="${y === year}">${y}</button>`).join('')}</div>` : '')
      + `<button type="button" class="lk-yr" data-lk-recap="${year}"><b>${now ? 'This year' : year}</b><span>${now ? 'The year so far' : 'The whole year'}, in numbers and a picture</span><span class="chev" aria-hidden="true"></span></button>`
      + months.map(m => {
        const pl = m.es.filter(e => e.t === 'place').length, sp = new Set(m.es.filter(e => e.t === 'spot').map(e => e.id)).size;
        const sum = [pl ? plural(pl, 'place walked', 'places walked') : '', sp ? plural(sp, 'spot') : ''].filter(Boolean).join(' · ');
        return `<section class="lk-month" data-lk-month="${m.k}" aria-label="${A.esc(monthName(m.k))}"><h3 class="lk-mh"><button type="button" data-lk-recap="${m.k}"><span><b>${A.esc(monthName(m.k))}</b><small>${sum}<span data-lk-ph></span></small></span><span class="lk-rc">Recap</span></button></h3>
          <ul class="rows">${m.es.map(e => `<li><button type="button" class="row lk-row" data-lk-go='${A.attr(e.loc)}'>${thumb(e)}<span class="nm">${A.esc(e.name)}<small>${A.esc(metaOf(e))}</small></span><span class="rt">${A.esc(short(e.date))}</span></button></li>`).join('')}</ul></section>`;
      }).join('');
    lazy(P);
  }

  // ---------- on this day ----------
  // today's month and day in an earlier year (an entry on Feb 29 shows on Feb 28 in a year without one), or exactly 1, 3 or 6
  // months ago (none when that day does not exist in that month). One card: years before months, then with photos before without,
  // then the longer ago, then places before spots, then by name
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
  let otd = { sig: null, html: '' }, otdBusy = null;
  function choose(cs) {
    return Promise.all(cs.map(c => listOf(c.e.owner).then(l => { c.th = thumbFrom(l, c.e.date); return c; }))).then(cs => cs.sort((a, b) => (!!b.years - !!a.years) || (!!b.th - !!a.th) || ((b.years || b.months) - (a.years || a.months)) || (a.e.t === b.e.t ? a.e.name.localeCompare(b.e.name) : a.e.t === 'place' ? -1 : 1))[0]);
  }
  function cardHtml(c) {
    const e = c.e, l = look(e), what = e.t === 'place' ? 'Walked' : [A.KINDS[e.kind].label, e.sub || e.hood].filter(Boolean).join(' · ');
    return `<div class="lk-otd" id="lk-otd"><button type="button" class="lk-otd-go" data-lk-go='${A.attr(e.loc)}'><span class="lk-th${c.th ? ' has' : ''}" style="--c:${l.c}" aria-hidden="true"><i>${l.e}</i>${c.th ? `<img alt="" src="${A.esc(c.th)}">` : ''}</span><span class="lk-otd-t"><small>${otdLine(c)}</small><b>${A.esc(e.name)}</b><span>${A.esc(what)}</span></span></button><button type="button" class="lk-otd-x" data-lk="otd-off" aria-label="Hide until tomorrow"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg></button></div>`;
  }
  // the first screen asks for the card on every render: the answer is kept for the day and these entries; the first time it is worked
  // out (the photo lists are asked for) an empty slot stands in and is filled when it is known
  function card() {
    if (offToday()) return '';
    const cs = matches(entries()); if (!cs.length) return '';
    const sig = today() + '|' + A.state.store + '|' + cs.map(c => c.e.key).join(',');
    if (otd.sig === sig) return otd.html;
    if (otdBusy !== sig) {
      otdBusy = sig;
      choose(cs).then(c => { if (otdBusy !== sig) return; otdBusy = null; otd = { sig, html: cardHtml(c) }; const slot = document.getElementById('lk-otd'); if (slot && !slot.classList.contains('lk-otd') && !offToday()) slot.outerHTML = otd.html; });
    }
    return '<div id="lk-otd" hidden></div>';
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
  function renderRecap() {
    const P = A.panel, p = period, s = stats(p), name = periodName(p);
    A.setHead({ eyebrow: p.length === 4 ? 'Recap · the year' : 'Recap · the month', title: A.esc(name), onBack: backToTimeline, tools: [] });
    const num = (n, label, extra) => `<div><b${extra || ''}>${n}</b><span>${label}</span></div>`;
    P.innerHTML = `<div class="lk-nums">${num(s.places, s.places === 1 ? 'place walked' : 'places walked')}${num(s.spots, s.spots === 1 ? 'new spot' : 'new spots')}${num(s.visits, s.visits === 1 ? 'visit' : 'visits')}${num(photosOn() ? '…' : 0, 'photos', ' data-lk-phn')}</div>
      ${s.top.length ? `<h3>Top rated</h3><ul class="rows">${s.top.map(e => `<li><button type="button" class="row lk-row" data-lk-go='${A.attr(e.loc)}'>${thumb(e)}<span class="nm">${A.esc(e.name)}<small>${A.esc([A.KINDS[e.kind].label, e.sub || e.hood].filter(Boolean).join(' · '))}</small></span><span class="rt lk-stars" role="img" aria-label="${e.rating} of 5 stars">${stars(e.rating)}</span></button></li>`).join('')}</ul>` : ''}
      ${s.hoods.length ? `<h3>New neighborhoods <span class="n">${s.hoods.length}</span></h3><div class="textlinks">${s.hoods.map(h => `<button type="button" data-lk-go='${A.attr({ hood: h })}'>${A.esc(h)}</button>`).join('')}</div>` : ''}
      <div class="actions lk-share"><button type="button" class="btn primary" data-lk="share">Share as image</button></div>
      <div class="lk-out" id="lk-out" hidden></div>`;
    lazy(P);
    countPhotos(s.ents, p).then(n => { const b = P.querySelector('[data-lk-phn]'); if (b && period === p) b.textContent = n; });
    prepare(p);
  }
  let tlY = 0; // where the timeline was scrolled to when a recap opened
  function openRecap(p) { tlY = A.panel.scrollTop; period = p; A.go(A.state.loc, { view: 'recap', fly: false, replace: true, sheet: A.isPhone() ? 'full' : undefined }); }
  function backToTimeline() { const y = tlY; A.go(A.state.loc, { view: 'timeline', fly: false, replace: true }); requestAnimationFrame(() => { A.panel.scrollTop = y; }); }

  // ---------- the image: 1080 x 1350, light palette, drawn once the fonts are in ----------
  let made = null; // { key, p: Promise<{ file, url, name }> }
  function prepare(p) {
    const s = stats(p), key = p + '|' + JSON.stringify([s.places, s.spots, s.visits, s.top.map(e => e.key), s.hoods, s.ents.map(e => e.key)]);
    if (made && made.key === key) return made.p;
    if (made) made.p.then(r => setTimeout(() => URL.revokeObjectURL(r.url), 60000), () => {});
    const name = `seven-by-seven-${p}.png`;
    made = { key, p: draw(p, s).then(c => new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('no image')), 'image/png'))).then(b => ({ file: new File([b], name, { type: 'image/png' }), url: URL.createObjectURL(b), name })) };
    made.p.catch(e => console.warn('recap image failed', e));
    return made.p;
  }
  async function fonts() {
    if (!document.fonts) return;
    try { await Promise.all(['700 100px "Bricolage Grotesque"', '600 40px "Bricolage Grotesque"', '400 28px Figtree', '600 28px Figtree', '700 28px Figtree'].map(f => document.fonts.load(f, 'Seven by Seven 0123456789'))); await document.fonts.ready; } catch (e) {}
  }
  const loadImg = src => new Promise(res => { if (!src) { res(null); return; } const i = new Image(); i.onload = () => (i.decode ? i.decode().catch(() => {}) : Promise.resolve()).then(() => res(i.naturalWidth ? i : null)); i.onerror = () => res(null); i.src = src; }); // a photo that fails is left out
  async function photosFor(s, p) { // up to six thumbs of photos from the period: the top-rated spots first, then the rest, newest first; one per place or spot in turn
    const order = [...new Set(s.top.map(e => e.owner).concat(s.ents.map(e => e.owner)))].slice(0, 24);
    const lists = await Promise.all(order.map(listOf));
    const per = lists.map(l => l.filter(x => x.t && (photoDay(x) || '').startsWith(p)).map(x => x.t));
    const out = []; for (let r = 0; out.length < 6 && per.some(l => l.length > r); r++) per.forEach(l => { if (out.length < 6 && l[r]) out.push(l[r]); });
    return (await Promise.all(out.map(loadImg))).filter(Boolean);
  }
  function rr(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
  function fit(g, text, max) { if (g.measureText(text).width <= max) return text; let t = text; while (t.length > 1 && g.measureText(t + '…').width > max) t = t.slice(0, -1); return t.trimEnd() + '…'; }
  const spaced = (g, px) => { if ('letterSpacing' in g) g.letterSpacing = px + 'px'; };
  async function draw(p, s) {
    await fonts();
    const [imgs, nph] = await Promise.all([photosFor(s, p), countPhotos(s.ents, p)]);
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
    // the numbers
    const nums = [[s.places, s.places === 1 ? 'PLACE WALKED' : 'PLACES WALKED'], [s.spots, s.spots === 1 ? 'NEW SPOT' : 'NEW SPOTS'], [s.visits, s.visits === 1 ? 'VISIT' : 'VISITS'], [nph, nph === 1 ? 'PHOTO' : 'PHOTOS']], cw = (R - X) / 4;
    g.strokeStyle = L.line2; g.lineWidth = 2; g.beginPath(); g.moveTo(X, 404); g.lineTo(R, 404); g.moveTo(X, 590); g.lineTo(R, 590); g.stroke();
    nums.forEach(([n, l], i) => { const x = X + i * cw + (i ? 24 : 0); if (i) { g.strokeStyle = L.line; g.beginPath(); g.moveTo(X + i * cw, 432); g.lineTo(X + i * cw, 562); g.stroke(); } g.fillStyle = i ? L.ink : L.accent; g.font = `700 96px ${D}`; g.fillText(String(n), x, 516); g.fillStyle = L.muted; g.font = `600 18px ${F}`; spaced(g, 1.5); g.fillText(fit(g, l, cw - 28), x, 556); spaced(g, 0); });
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
      g.fillStyle = L.ink2; g.font = `500 32px ${F}`; let line = '', lines = 0;
      for (const h of s.hoods) { const t = line ? line + ' · ' + h : h; if (g.measureText(t).width > R - X && line) { if (y > H - 150 || lines === 2) { line += ' …'; break; } g.fillText(line, X, y); y += 44; lines++; line = h; } else line = t; }
      if (line) g.fillText(fit(g, line, R - X), X, y);
    }
    g.fillStyle = L.muted; g.font = `500 22px ${F}`; g.fillText('A trail map of the Bay Area', X, H - 84); g.fillStyle = L.accent; g.beginPath(); g.arc(R - 8, H - 92, 8, 0, Math.PI * 2); g.fill();
    return c;
  }
  async function share() {
    const out = A.panel.querySelector('#lk-out'), btn = A.panel.querySelector('[data-lk="share"]'), p = period;
    let r; try { if (btn) { btn.disabled = true; btn.setAttribute('aria-busy', 'true'); } r = await prepare(p); } catch (e) { A.toast('Could not make the image', 2600); return; } finally { if (btn && btn.isConnected) { btn.disabled = false; btn.removeAttribute('aria-busy'); } }
    const files = [r.file];
    if (navigator.canShare && navigator.share) { let can = false; try { can = navigator.canShare({ files }); } catch (e) {} if (can) { try { await navigator.share({ files, title: 'Seven by Seven · ' + periodName(p) }); return; } catch (e) { if (e && e.name === 'AbortError') return; } } } // a refused share (no tap left, say) falls through to the picture
    if (!out || !out.isConnected || period !== p) return;
    out.innerHTML = `<img src="${r.url}" alt="The recap of ${A.esc(periodName(p))} as an image" width="${W}" height="${H}"><div class="actions"><a class="btn sm" href="${r.url}" download="${A.esc(r.name)}">Save image</a></div>`;
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
    else if (k === 'otd-off') { try { localStorage.setItem(DISMISS, today()); } catch (e) {} const c = A.panel.querySelector('#lk-otd'); if (c) c.remove(); A.toast('Hidden until tomorrow', 2200); }
    else if (k === 'share') share();
  }
  function onChange(ev) {
    const inp = ev.target.closest('[data-lk-day]'); if (!inp) return;
    const from = inp.dataset.lkDay, to = inp.value, id = A.state.loc.spot, sp = own(A.state.spots, id);
    if (!okDay(to)) { inp.value = from; if (to) A.toast('Pick a day up to today', 2600); return; }
    if (to === from) return;
    if (sp && visitsOf(sp).includes(to)) { inp.value = from; A.toast(`Already a visit on ${shortY(to)}`, 2600); return; }
    changeVisit(id, from, to);
  }
  function init(o) {
    A = o;
    A.panel.addEventListener('click', onClick);
    A.panel.addEventListener('change', onChange);
    A.panel.addEventListener('toggle', e => { if (e.target.classList && e.target.classList.contains('lk-dates')) datesOpen = e.target.open ? A.state.loc.spot : null; }, true);
    A.panel.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'lk-day') { e.preventDefault(); addVisit(A.state.loc.spot, e.target.value); } });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && A.state.view === 'recap' && !document.querySelector('dialog[open]') && !(e.target.matches && e.target.matches('input, textarea, select'))) { e.stopImmediatePropagation(); backToTimeline(); } }, true); // Escape on a recap: back to the timeline, not the first screen
  }
  // app.js render(): the views this file draws
  function view(v) { if (v === 'timeline') { renderTimeline(); return true; } if (v === 'recap' && period) { renderRecap(); return true; } return false; }
  return { init, view, card, stamp, spotBlock, carry, setLatest, visitsOf, today, debug: { clean, okDay, entries, matches, stats, prepare, open: openRecap } };
})();
