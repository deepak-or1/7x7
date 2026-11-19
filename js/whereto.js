// "Where to?": the want-to-go spots as a way to decide where to go. Filters (type, area, near me), a random pick shown like a
// postcard, and a walking day of 2 to 6 stops. It reads the log and never writes it. The location from Near me stays in this
// page's memory (never stored), and leaves the page only inside a Maps link the user taps. Distances are straight lines.
// init({...}) takes what it needs from app.js; app.js calls render() for state.view 'whereto' and asks onMap() which dots to draw.
(function () {
  const WALK = 80, MI = 1609.344; // metres walked in a minute; metres in a mile
  const RADIUS = { 15: 15, 30: 30, any: Infinity }, RLABEL = { 15: '15 min walk', 30: '30 min walk', any: 'Anywhere' };
  const LOC_ERR = {
    denied: 'Location is off for this site, so the list is not sorted by distance.',
    unavailable: 'Could not find where you are, so the list is not sorted by distance.',
    outside: 'You are outside the map, so the list is not sorted by distance.',
    none: 'This browser does not share a location, so the list is not sorted by distance.',
  };
  const SIGN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21V3M12 5h6l2.5 2.5L18 10h-6M12 12H6l-2.5 2.5L6 17h6"/></svg>';
  let A = null; // what app.js passes in
  // this session's choices, in memory only: they survive leaving the view and coming back, not a reload. pos: [lon, lat], never stored
  const S = { kind: null, region: null, hood: null, fav: false, near: false, radius: 'any', pos: null, locErr: null, locating: false, mode: 'list', sel: [], route: null, seen: new Set(), seenKey: '', last: null, shown: null };
  const own = (o, k) => !!o && typeof o === 'object' && typeof k === 'string' && Object.hasOwn(o, k);
  const spots = () => A.state.spots;
  // the log is anyone's to write: a spot needs real coordinates to be listed; every field is checked before use
  const okSpot = sp => !!sp && typeof sp === 'object' && A.okLL(sp.lat, sp.lon);
  const has = id => own(spots(), id) && okSpot(spots()[id]);
  const kindOf = sp => own(A.KINDS, sp.kind) ? sp.kind : 'other';
  const hoodOf = sp => own(A.IDX, sp.hood) ? sp.hood : null;
  const regionOf = sp => { const h = hoodOf(sp); return h ? A.HOODS[A.IDX[h]].region : null; };
  const nameOf = sp => typeof sp.name === 'string' && sp.name.trim() ? sp.name.slice(0, 80) : 'A spot';
  const areaOf = sp => (typeof sp.sub === 'string' && sp.sub) || hoodOf(sp) || '';
  const rating = sp => Math.max(0, Math.min(5, Math.floor(+sp.rating) || 0));
  const isFav = sp => sp.status === 'been' && rating(sp) >= 4;
  const ll = sp => [sp.lon, sp.lat];
  const nearOn = () => S.near && !!S.pos;
  // straight-line metres between two [lon, lat]
  function metres(a, b) { const r = Math.PI / 180, dLat = (b[1] - a[1]) * r, dLon = (b[0] - a[0]) * r, s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLon / 2) ** 2; return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(s))); }
  const mins = m => Math.max(1, Math.round(m / WALK)), walk = m => mins(m) <= 30 ? mins(m) + ' min walk' : (m / MI).toFixed(1) + ' mi'; // the radius counts the same rounded minutes the list shows
  const latlon = p => `${+p[1].toFixed(5)},${+p[0].toFixed(5)}`;

  // want-to-go spots, and with the switch on, been spots rated 4 or 5
  function base() { const out = []; for (const id of Object.keys(spots())) { const sp = spots()[id]; if (okSpot(sp) && (sp.status === 'want' || (S.fav && isFav(sp)))) out.push(id); } return out; }
  // the list as filtered now: [{ id, sp, d }], nearest first with a location (d in metres), else newest first
  function filtered(ids = base()) {
    let out = ids.map(id => ({ id, sp: spots()[id], d: null }));
    if (S.kind) out = out.filter(x => kindOf(x.sp) === S.kind);
    if (S.region) out = out.filter(x => regionOf(x.sp) === S.region);
    if (S.hood) out = out.filter(x => hoodOf(x.sp) === S.hood);
    if (nearOn()) { out.forEach(x => { x.d = metres(S.pos, ll(x.sp)); }); out = out.filter(x => mins(x.d) <= RADIUS[S.radius]).sort((a, b) => a.d - b.d); }
    else out.sort((a, b) => String(b.sp.at || '').localeCompare(String(a.sp.at || '')));
    return out;
  }
  // the dots the map draws while the view is open (null: all of them)
  const onMap = () => S.shown;

  // ---------- the list ----------
  const chip = (attrs, label, on) => `<button type="button" ${attrs} aria-pressed="${!!on}">${A.esc(label)}</button>`;
  function row(x, selecting) {
    const sp = x.sp, k = A.KINDS[kindOf(sp)], want = sp.status === 'want', e = A.esc;
    const ic = `<span class="ic" style="--c:${k.c};${want ? 'background:transparent;box-shadow:0 0 0 2px ' + k.c + ' inset' : ''}"></span>`;
    const rt = x.d != null ? walk(x.d) : want ? '' : '★'.repeat(rating(sp));
    const body = `${ic}<span class="nm">${e(nameOf(sp))}<small>${e([k.label, areaOf(sp)].filter(Boolean).join(' · '))}</small></span><span class="rt">${e(rt)}</span>`;
    if (!selecting) return `<li><button type="button" class="row" data-go='${A.attr({ spot: x.id })}'>${body}</button></li>`;
    const on = S.sel.includes(x.id), off = !on && S.sel.length >= 6;
    return `<li><label class="row wt-sel${off ? ' off' : ''}"><input type="checkbox" data-wt-sel="${e(x.id)}" ${on ? 'checked' : ''} ${off ? 'disabled' : ''} aria-label="${e(nameOf(sp))}">${body}</label></li>`;
  }
  function locLine() {
    if (S.locating) return '<p class="wt-loc" role="status">Finding where you are…</p>';
    if (S.locErr) return `<p class="wt-loc" role="status">${LOC_ERR[S.locErr] || LOC_ERR.unavailable}</p>`;
    if (nearOn()) return '<p class="wt-loc">Nearest first. Distances are straight lines, so they are about. <button type="button" class="act" id="wt-relocate">Find me again</button></p>';
    return '';
  }
  function emptyLine(all) {
    if (!all.length) return `<p class="empty">${S.fav ? 'No want-to-go spots and no 4 or 5 star favorites yet.' : 'No want-to-go spots yet.'} When you log a spot as Want to go, it shows up here. Until then, the app can suggest a place you have not walked.</p><div class="actions"><button type="button" class="btn sm" id="wt-suggest">Suggest a place</button></div>`;
    const what = S.kind ? `“${A.KINDS[S.kind].label}”` : 'anything', where = S.hood || (S.region ? A.REGIONS[S.region].label : ''), near = nearOn() && S.radius !== 'any' ? ` within a ${RLABEL[S.radius]} of you` : '';
    return `<p class="empty">Nothing for ${what}${where ? ' in ' + A.esc(where) : ''}${near}.</p><div class="actions"><button type="button" class="btn sm" id="wt-clear2">Clear filters</button></div>`;
  }
  function render() {
    if (S.mode === 'route' && S.route) return renderRoute();
    const all = base(), list = filtered(all), selecting = S.mode === 'select', e = A.esc;
    if (selecting) S.sel = S.sel.filter(has);
    S.shown = new Set(list.map(x => x.id).concat(selecting ? S.sel : []));
    // the chips offer what the list holds, and keep the one chosen so it can be undone
    const sps = all.map(id => spots()[id]);
    const kinds = Object.keys(A.KINDS).filter(k => k === S.kind || sps.some(sp => kindOf(sp) === k));
    const regions = Object.keys(A.REGIONS).filter(r => r !== 'all' && (r === S.region || sps.some(sp => regionOf(sp) === r)));
    const hoods = S.region ? [...new Set(sps.map(hoodOf).filter(h => h && A.HOODS[A.IDX[h]].region === S.region).concat(S.hood ? [S.hood] : []))].sort((a, b) => a.localeCompare(b)) : [];
    const filters = !!(S.kind || S.region || S.hood || (nearOn() && S.radius !== 'any'));
    A.setHead(selecting ? { eyebrow: 'Make a day of it', title: 'Choose 2 to 6 spots', onBack: () => { S.mode = 'list'; A.render(); }, tools: [] }
      : { eyebrow: S.fav ? 'Want to go and favorites' : 'Want to go', title: 'Where to?', onBack: A.up, tools: [] });
    A.panel.innerHTML = `
      <label class="switch wt-fav"><span>Favorites to revisit<small>Spots you have been to and rated 4 or 5</small></span><input type="checkbox" id="wt-fav" ${S.fav ? 'checked' : ''}></label>
      <div class="textlinks chips wt-chips" role="group" aria-label="Type">${chip('data-wt="kind:"', 'Any type', !S.kind)}${kinds.map(k => chip(`data-wt="kind:${k}"`, A.KINDS[k].label, S.kind === k)).join('')}</div>
      <div class="textlinks chips wt-chips" role="group" aria-label="Area">${chip('data-wt="region:"', 'Anywhere', !S.region)}${regions.map(r => chip(`data-wt="region:${r}"`, A.REGIONS[r].label, S.region === r)).join('')}</div>
      ${S.region && hoods.length ? `<div class="textlinks chips wt-chips" role="group" aria-label="Neighborhood in ${e(A.REGIONS[S.region].label)}">${chip('data-wt="hood:"', 'All', !S.hood)}${hoods.map(h => chip(`data-wt-hood="${e(h)}"`, h, S.hood === h)).join('')}</div>` : ''}
      <div class="textlinks chips wt-chips" role="group" aria-label="Distance">${chip('id="wt-near"', 'Near me', S.near)}${nearOn() ? Object.keys(RADIUS).map(r => chip(`data-wt="radius:${r}"`, RLABEL[r], S.radius === r)).join('') : ''}</div>
      ${locLine()}
      <h3 class="wt-count"><span role="status">${list.length} ${list.length === 1 ? 'spot' : 'spots'}</span>${filters ? '<button type="button" class="act" id="wt-clear">Clear filters</button>' : ''}</h3>
      ${selecting || !list.length ? '' : `<div class="actions wt-acts"><button type="button" class="btn primary" id="wt-pick" ${list.length ? '' : 'disabled'}>Pick for us</button><button type="button" class="btn" id="wt-day" ${list.length >= 2 ? '' : 'disabled'}>Make a day of it</button></div>`}
      ${list.length ? `<ul class="rows wt-list">${list.map(x => row(x, selecting)).join('')}</ul>` : emptyLine(all)}
      ${selecting ? `<div class="wt-bar"><span><b>${S.sel.length}</b> of 6 chosen${S.sel.length < 2 ? ' · choose at least 2' : ''}</span><button type="button" class="btn quiet" id="wt-cancel">Cancel</button><button type="button" class="btn primary" id="wt-plan" ${S.sel.length >= 2 ? '' : 'disabled'}>Plan the walk</button></div>` : ''}`;
    wire();
    showChosen();
  }
  // a chosen chip out of sight in its sideways row (the phone) is scrolled into it
  const showChosen = () => A.panel.querySelectorAll('.wt-chips').forEach(r => { const b = r.querySelector('[aria-pressed="true"]'); if (!b || r.scrollWidth <= r.clientWidth) return; const rb = r.getBoundingClientRect(), bb = b.getBoundingClientRect(); if (bb.right > rb.right) r.scrollLeft += bb.right - rb.right + 16; else if (bb.left < rb.left) r.scrollLeft -= rb.left - bb.left + 16; });
  // a re-render keeps the keyboard focus on the same control
  function again() {
    const a = document.activeElement, key = a && A.panel.contains(a) ? (a.id ? '#' + a.id : a.dataset.wt ? `[data-wt="${a.dataset.wt}"]` : a.dataset.wtHood ? `[data-wt-hood="${CSS.escape(a.dataset.wtHood)}"]` : a.dataset.wtSel ? `[data-wt-sel="${CSS.escape(a.dataset.wtSel)}"]` : a.dataset.wtUp ? `[data-wt-up="${a.dataset.wtUp}"]` : a.dataset.wtDown ? `[data-wt-down="${a.dataset.wtDown}"]` : null) : null;
    const rows = [...A.panel.querySelectorAll('.wt-chips')].map(r => r.scrollLeft); // the chip rows keep their sideways scroll
    A.render();
    A.panel.querySelectorAll('.wt-chips').forEach((r, i) => { if (rows[i]) r.scrollLeft = rows[i]; }); showChosen();
    if (key) { const b = A.panel.querySelector(key); if (b && !b.disabled) b.focus({ preventScroll: true }); }
  }
  const changed = () => { again(); frame(); };
  function set(k, v) {
    if (k === 'kind') S.kind = own(A.KINDS, v) ? v : null;
    else if (k === 'region') { S.region = own(A.REGIONS, v) && v !== 'all' ? v : null; S.hood = null; }
    else if (k === 'hood') S.hood = own(A.IDX, v) && A.HOODS[A.IDX[v]].region === S.region ? v : null;
    else if (k === 'radius') S.radius = own(RADIUS, v) ? v : 'any';
    changed();
  }
  function clear() { S.kind = S.region = S.hood = null; S.radius = 'any'; changed(); const c = A.panel.querySelector('[data-wt="kind:"]'); if (c) c.focus({ preventScroll: true }); }
  function wire() {
    const p = A.panel, on = (s, fn) => { const el = p.querySelector(s); if (el) el.addEventListener('click', fn); };
    p.querySelector('#wt-fav').addEventListener('change', ev => { S.fav = ev.target.checked; changed(); });
    p.querySelectorAll('[data-wt]').forEach(b => b.addEventListener('click', () => { const [k, v] = b.dataset.wt.split(':'); set(k, v || null); }));
    p.querySelectorAll('[data-wt-hood]').forEach(b => b.addEventListener('click', () => set('hood', b.dataset.wtHood)));
    on('#wt-near', () => { if (S.near && !S.locating) { S.near = false; S.pos = null; S.radius = 'any'; changed(); } else if (!S.locating) findMe(); });
    on('#wt-relocate', findMe); on('#wt-clear', clear); on('#wt-clear2', clear);
    on('#wt-pick', pick); on('#wt-suggest', () => A.surprise());
    on('#wt-day', () => { S.mode = 'select'; again(); const c = p.querySelector('[data-wt-sel]'); if (c) c.focus({ preventScroll: true }); });
    on('#wt-cancel', () => { S.mode = 'list'; again(); });
    on('#wt-plan', plan);
    p.querySelectorAll('[data-wt-sel]').forEach(c => c.addEventListener('change', () => { const id = c.dataset.wtSel; S.sel = S.sel.filter(x => x !== id); if (c.checked && S.sel.length < 6) S.sel.push(id); again(); }));
  }
  // Near me: asks for the location only on this tap (app.js locate(), which also shows the dot on the map)
  function findMe() {
    S.near = true; S.locating = true; S.locErr = null; again();
    const live = () => A.state.view === 'whereto';
    A.locate(pos => { S.locating = false; if (!S.near) return; S.pos = pos; if (live()) changed(); }, { quiet: true, fail: err => {
      const c = err && err.code; S.locating = false; S.near = false; S.pos = null;
      S.locErr = c === 1 ? 'denied' : c === 'outside' ? 'outside' : c === 'none' ? 'none' : 'unavailable';
      if (live()) again();
    } });
  }
  // the map frames what the view lists (and you, with Near me). Phone with the sheet full: the map is covered, so it frames when the
  // sheet comes down (app.js flyToLoc asks here while the view is open)
  function frame(dur) {
    if (!A || A.state.view !== 'whereto' || !S.shown) return false;
    const pts = [...S.shown].filter(has).map(id => A.Geom.proj(ll(spots()[id])));
    if (nearOn()) pts.push(A.Geom.proj(S.pos));
    if (!pts.length) return false;
    if (A.isPhone() && A.sheet.detent === 'full') { A.map.userMoved = false; return true; }
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    A.map.flyTo([Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)], 1.3, A.U * 0.04, dur);
    return true;
  }
  function open() {
    const r = A.state.loc.region; if (r && r !== 'all' && S.region !== r) { S.region = r; S.hood = null; } // from a region's screen: that region
    S.mode = 'list';
    A.go(A.state.loc, { view: 'whereto', fly: false, replace: true, sheet: A.isPhone() ? 'full' : undefined });
    frame();
  }

  // ---------- Pick for us ----------
  // one at random from the list as filtered now, never the same twice until every one was shown (then a new round, which does not
  // start with the last one shown). A change of filters starts afresh.
  function pick() {
    const ids = filtered().map(x => x.id); if (!ids.length) return;
    const key = ids.slice().sort().join('\n'); if (key !== S.seenKey) { S.seenKey = key; S.seen = new Set(); }
    let pool = ids.filter(id => !S.seen.has(id)), round = false;
    if (!pool.length) { S.seen = new Set(); round = true; pool = ids.length > 1 ? ids.filter(id => id !== S.last) : ids; }
    const id = pool[Math.floor(Math.random() * pool.length)]; S.seen.add(id); S.last = id;
    showPick(id, ids.length, round);
  }
  function showPick(id, n, round) {
    const sp = spots()[id], k = A.KINDS[kindOf(sp)], x = filtered().find(y => y.id === id), e = A.esc, r = rating(sp);
    let dlg = document.getElementById('wt-pick-dlg');
    if (!dlg) {
      dlg = document.createElement('dialog'); dlg.id = 'wt-pick-dlg'; dlg.className = 'who wt-card'; dlg.setAttribute('aria-labelledby', 'wt-pick-t');
      dlg.addEventListener('click', ev => { if (ev.target === dlg) dlg.close(); }); // a tap on the backdrop closes it
      dlg.addEventListener('close', () => { const b = A.panel.querySelector('#wt-pick'); if (b && A.state.view === 'whereto') b.focus({ preventScroll: true }); });
      document.body.appendChild(dlg);
    }
    const meta = [k.label, areaOf(sp), x && x.d != null ? 'about ' + walk(x.d) : ''].filter(Boolean).join(' · ');
    const stamp = sp.status === 'want' ? '<span class="pstamp want">Want to go</span>' : `<span class="vstars" role="img" aria-label="${r} of 5 stars"><span aria-hidden="true">${'★'.repeat(r)}<i>${'★'.repeat(5 - r)}</i></span></span><span class="pstamp been">Been</span>`;
    const note = typeof sp.note === 'string' && sp.note.trim() ? `<p class="wt-note">${e(sp.note.slice(0, 160))}</p>` : '';
    dlg.innerHTML = `<div class="wt-pc${A.reduceMotion ? '' : ' deal'}">
      ${window.Photos ? Photos.cover({ c: k.c, e: k.e }) : ''}
      <button type="button" class="wt-x" id="wt-x" aria-label="Close">${A.ICON.close}</button>
      <p class="eyebrow">${round ? `All ${n} shown · round two` : `Our pick · ${S.seen.size} of ${n}`}</p>
      <h2 id="wt-pick-t">${e(nameOf(sp))}</h2>
      <p class="wt-meta">${e(meta)}</p>
      <div class="vrow">${stamp}</div>${note}
      <div class="actions wt-pick-acts"><button type="button" class="btn" id="wt-again" ${n > 1 ? '' : 'disabled'}>Not this one</button><button type="button" class="btn primary" id="wt-go">Let’s go</button></div>
      ${A.mapBtns(A.spotQuery(sp), A.spotApple(sp))}
    </div>`;
    dlg.querySelector('#wt-x').addEventListener('click', () => dlg.close());
    dlg.querySelector('#wt-again').addEventListener('click', pick);
    dlg.querySelector('#wt-go').addEventListener('click', () => { dlg.close(); if (has(id)) A.go({ spot: id }, { tap: true }); });
    if (!dlg.open) dlg.showModal();
    dlg.querySelector(n > 1 ? '#wt-again' : '#wt-go').focus();
  }

  // ---------- Make a day of it ----------
  const startAt = () => nearOn() ? S.pos : null; // the walk starts where you are when Near me knows it, else at the first stop
  // nearest neighbour from the start (your location, else the first spot chosen), then 2-opt on the open path; the start stays put
  function order(ids, from) {
    const P = id => ll(spots()[id]), rest = ids.slice(), path = [];
    let cur = from; if (!cur) { path.push(rest.shift()); cur = P(path[0]); }
    while (rest.length) { let bi = 0, bd = Infinity; rest.forEach((id, i) => { const d = metres(cur, P(id)); if (d < bd) { bd = d; bi = i; } }); const id = rest.splice(bi, 1)[0]; path.push(id); cur = P(id); }
    const pts = (from ? [from] : []).concat(path.map(P)), ord = (from ? [null] : []).concat(path); // index 0 is fixed
    const flip = (a, i, j) => { while (i < j) { [a[i], a[j]] = [a[j], a[i]]; i++; j--; } };
    for (let better = true, n = 0; better && n < 50; n++) {
      better = false;
      for (let i = 1; i < pts.length - 1; i++) for (let j = i + 1; j < pts.length; j++) {
        const a = pts[i - 1], b = pts[i], c = pts[j], d = pts[j + 1]; // d undefined: the open end
        if (metres(a, c) + (d ? metres(b, d) : 0) < metres(a, b) + (d ? metres(c, d) : 0) - 0.5) { flip(pts, i, j); flip(ord, i, j); better = true; }
      }
    }
    return from ? ord.slice(1) : ord;
  }
  function plan() { const ids = S.sel.filter(has); if (ids.length < 2) return; S.route = order(ids, startAt()); S.mode = 'route'; A.render(); A.panel.scrollTop = 0; frame(); const h = A.panel.querySelector('.wt-route'); if (h) h.focus({ preventScroll: true }); }
  // each leg in metres: the first from your location (null when the walk starts at the first stop)
  function legs() { let prev = startAt(); return S.route.map(id => { const p = ll(spots()[id]), d = prev ? metres(prev, p) : null; prev = p; return d; }); }
  // Google Maps: the documented multi-stop form (origin, destination, waypoints split by |, travelmode=walking). Apple Maps: its
  // documented links take one destination (daddr, with dirflg=w for walking, from the current location), so it opens stop 1 only
  function links() {
    const q = S.route.map(id => A.spotQuery(spots()[id])), from = startAt(), enc = encodeURIComponent;
    const origin = from ? latlon(from) : q[0], stops = from ? q : q.slice(1), dest = stops[stops.length - 1], way = stops.slice(0, -1);
    return { google: 'https://www.google.com/maps/dir/?api=1&origin=' + enc(origin) + '&destination=' + enc(dest) + (way.length ? '&waypoints=' + way.map(enc).join('%7C') : '') + '&travelmode=walking', apple: 'https://maps.apple.com/?daddr=' + enc(q[0]) + '&dirflg=w', waypoints: way.length };
  }
  function renderRoute() {
    S.route = S.route.filter(has);
    if (S.route.length < 2) { S.mode = 'list'; S.route = null; return render(); }
    S.shown = new Set(S.route);
    const L = legs(), total = L.reduce((s, d) => s + (d || 0), 0), from = startAt(), n = S.route.length, e = A.esc, lk = links();
    A.setHead({ eyebrow: 'Make a day of it', title: 'Your walk', onBack: () => { S.mode = 'select'; again(); frame(); }, tools: [] });
    A.panel.innerHTML = `
      <p class="lead">${from ? 'Starting from where you are.' : `Starting at ${e(nameOf(spots()[S.route[0]]))}. With Near me on, the walk starts where you are.`} Drag a stop, or use the arrows, to change the order.</p>
      <p class="wt-total"><b>About ${(total / MI).toFixed(1)} mi</b> · ${Math.max(1, Math.round(total / WALK))} min walk in straight lines, ${n} stops</p>
      <ol class="rows wt-route" tabindex="-1" aria-label="Stops in walking order">${S.route.map((id, i) => {
        const sp = spots()[id], k = A.KINDS[kindOf(sp)], nm = nameOf(sp), leg = i === 0 ? (from ? 'from you · ' + walk(L[0]) : 'start') : walk(L[i]);
        return `<li><div class="row wt-stop"><span class="wt-grab" title="Drag to reorder" aria-hidden="true"></span><span class="wt-n" style="--c:${k.c}">${i + 1}</span><span class="nm"><button type="button" class="wt-name" data-go='${A.attr({ spot: id })}'>${e(nm)}</button><small>${e([k.label, areaOf(sp)].filter(Boolean).join(' · '))}</small></span><span class="rt">${e(leg)}</span><span class="wt-mv"><button type="button" data-wt-up="${i}" aria-label="Move ${e(nm)} earlier" ${i ? '' : 'disabled'}>↑</button><button type="button" data-wt-down="${i}" aria-label="Move ${e(nm)} later" ${i < n - 1 ? '' : 'disabled'}>↓</button></span></div></li>`;
      }).join('')}</ol>
      <div class="actions"><button type="button" class="btn sm" id="wt-best">Shortest order again</button></div>
      <div class="mapbtns wt-maps">${A.extBtn(lk.google, 'Google Maps: all stops')}${A.APPLE ? A.extBtn(lk.apple, 'Apple Maps: stop 1') : ''}</div>
      <p class="wt-fine">Google Maps gets every stop, in this order. ${A.APPLE ? 'Apple Maps links take one stop at a time, so Apple Maps gives walking directions to stop 1 only. ' : ''}${lk.waypoints > 3 ? 'Google Maps in a phone browser, without its app, shows at most 3 stops between the start and the end. ' : ''}Your location is never saved; it goes only into the Maps link you tap.</p>
      <div class="actions"><button type="button" class="btn quiet" id="wt-change">Change spots</button><button type="button" class="btn quiet" id="wt-done">Back to the list</button></div>`;
    const p = A.panel, on = (s, fn) => { const el = p.querySelector(s); if (el) el.addEventListener('click', fn); };
    const move = (i, j) => { if (j < 0 || j >= S.route.length || i === j) return; const [id] = S.route.splice(i, 1); S.route.splice(j, 0, id); };
    p.querySelectorAll('[data-wt-up]').forEach(b => b.addEventListener('click', () => { const i = +b.dataset.wtUp; move(i, i - 1); A.render(); focusMove('up', i - 1); }));
    p.querySelectorAll('[data-wt-down]').forEach(b => b.addEventListener('click', () => { const i = +b.dataset.wtDown; move(i, i + 1); A.render(); focusMove('down', i + 1); }));
    on('#wt-best', () => { S.route = order(S.route, startAt()); again(); frame(); });
    on('#wt-change', () => { S.sel = S.route.slice(); S.mode = 'select'; again(); frame(); });
    on('#wt-done', () => { S.mode = 'list'; again(); frame(); });
    drag(p.querySelector('.wt-route'), move);
  }
  function focusMove(dir, i) { const b = A.panel.querySelector(`[data-wt-${dir}="${i}"]`) || A.panel.querySelector(`[data-wt-${dir === 'up' ? 'down' : 'up'}="${i}"]`); if (b && !b.disabled) b.focus({ preventScroll: true }); else if (b) { const o = b.parentNode.querySelector('button:not([disabled])'); if (o) o.focus({ preventScroll: true }); } }
  // drag a stop by its handle: the others make room as it passes; dropped, the order is saved in this session and the legs redrawn
  function drag(ol, move) {
    if (!ol) return;
    ol.querySelectorAll('.wt-grab').forEach(h => {
      h.addEventListener('touchstart', ev => ev.stopPropagation(), { passive: true }); // the sheet must not take this drag (js/sheet.js listens on the panel)
      h.addEventListener('pointerdown', ev => {
        if (ev.button > 0) return; ev.preventDefault();
        const li = h.closest('li'), items = [...ol.children], from = items.indexOf(li), hgt = li.getBoundingClientRect().height, y0 = ev.clientY; let to = from;
        try { h.setPointerCapture(ev.pointerId); } catch (x) {}
        li.classList.add('lift'); ol.classList.add('dragging');
        const mv = m => { const dy = m.clientY - y0; to = Math.max(0, Math.min(items.length - 1, from + Math.round(dy / hgt))); li.style.transform = `translateY(${dy}px)`; items.forEach((o, k) => { if (o === li) return; const s = from < to && k > from && k <= to ? -hgt : from > to && k < from && k >= to ? hgt : 0; o.style.transform = s ? `translateY(${s}px)` : ''; }); };
        const end = u => { h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', end); h.removeEventListener('pointercancel', end); if (u.type === 'pointercancel') to = from; move(from, to); A.render(); frame(); };
        h.addEventListener('pointermove', mv); h.addEventListener('pointerup', end); h.addEventListener('pointercancel', end);
      });
    });
  }

  function init(o) { A = o; }
  const tool = () => ({ id: 'whereto', label: 'Where to?', icon: SIGN + '<span>Where to?</span>', run: open });
  window.WhereTo = { init, render, open, onMap, frame, tool, test: { S, filtered, order, metres, links, walk } };
})();
