// Seven by Seven — the app: one place in a hierarchy (Bay Area › region › neighborhood › section › spot),
// a logbook that follows it, and a tracker saved per person.
(function () {
  const $ = id => document.getElementById(id);
  const G = window.GEO, HOODS = G.hoods, INFO = window.INFO, VIBES = window.VIBES, REGIONS = window.REGIONS, SHORT = window.SHORT, MOODS = window.MOODS, FOG_WORDS = window.FOG_WORDS;
  const NX = G.nx, NY = G.ny, Geom = window.Geom;
  const IDX = Object.fromEntries(HOODS.map((h, i) => [h.name, i]));
  const NAMES = HOODS.map(h => h.name).sort((a, b) => a.localeCompare(b));
  const REGION_N = Object.fromEntries(Object.keys(REGIONS).map(r => [r, HOODS.filter(h => r === 'all' || h.region === r).length]));
  const slug = n => String(n).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const BY_SLUG = Object.fromEntries(NAMES.map(n => [slug(n), n]));
  const ft = m => Math.round(m * 3.28084);
  const MAXM = Math.max(...HOODS.map(h => h.max));
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const attr = o => esc(JSON.stringify(o)); // for data-go='...' (names like Blackie's Pasture)
  const today = () => new Date().toISOString().slice(0, 10);
  const niceDate = iso => { if (!iso) return ''; const d = new Date(iso + 'T12:00:00'); return isNaN(d) ? iso : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); };
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const KINDS = { food: { label: 'Food', c: 'var(--k-food)' }, drink: { label: 'Drinks', c: 'var(--k-drink)' }, coffee: { label: 'Coffee', c: 'var(--k-coffee)' }, view: { label: 'View', c: 'var(--k-view)' }, shop: { label: 'Shop', c: 'var(--k-shop)' }, park: { label: 'Park', c: 'var(--k-park)' }, other: { label: 'Other', c: 'var(--k-other)' } };
  const LENSES = { vibe: { label: 'Character', sub: 'Six kinds of place' }, fog: { label: 'Fog', sub: 'Sunbelt to permanent cloud' }, elev: { label: 'Hills', sub: 'Sea level to the summits' }, done: { label: 'Walked', sub: 'Where you have been' } };
  const STAMPS = [
    { id: 'first', label: 'First steps', test: s => s.n >= 1, icon: '1' }, { id: 'ten', label: 'Ten down', test: s => s.n >= 10, icon: '10' },
    { id: 'half', label: 'Half the city', test: s => s.sf >= Math.ceil(REGION_N.sf / 2), icon: '½' }, { id: 'all', label: 'Whole city', test: s => s.sf >= REGION_N.sf, icon: '37' },
    { id: 'gg', label: 'Over the Golden Gate', test: s => s.marin >= 1, icon: 'GG' }, { id: 'bb', label: 'Over the Bay Bridge', test: s => s.east >= 1, icon: 'BB' },
    { id: 'marin', label: 'All of Marin', test: s => s.marin >= REGION_N.marin, icon: 'M' }, { id: 'east', label: 'Whole East Bay', test: s => s.east >= REGION_N.east, icon: 'E' },
    { id: 'south', label: 'Down the Peninsula', test: s => s.penin >= 1, icon: '280' }, { id: 'penin', label: 'Whole Peninsula', test: s => s.penin >= REGION_N.penin, icon: 'P' },
    { id: 'bay', label: 'The whole map', test: s => s.n >= REGION_N.all, icon: '∞' },
    { id: 'sun', label: 'Sun belt', test: s => s.vibe.sun, icon: '☀' }, { id: 'fog', label: 'Fog belt', test: s => s.vibe.fog, icon: '☁' }, { id: 'hills', label: 'Hill climber', test: s => s.vibe.hills, icon: '▲' },
    { id: 'water', label: 'Shoreline', test: s => s.vibe.water, icon: '≈' }, { id: 'buzz', label: 'Night owl', test: s => s.vibe.buzz, icon: '♪' }, { id: 'green', label: 'Park ranger', test: s => s.vibe.green, icon: '✿' },
    { id: 'summit', label: 'Summiteer', test: s => s.ft >= 5000, icon: '5k' }, { id: 'mtn', label: 'Mountaineer', test: s => s.ft >= 15000, icon: '15k' },
  ];
  const ICON = {
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    check: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    star: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5l1.9 4.1 4.5.5-3.3 3 .9 4.4L8 11.3l-4 2.2.9-4.4-3.3-3 4.5-.5z" fill="#fff"/></svg>',
    pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6-5.3-6-11a6 6 0 0 1 12 0c0 5.7-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  };

  // ---------- state ----------
  const state = { loc: { region: 'all', hood: null, sub: null, spot: null }, view: null, lens: 'vibe', filters: new Set(), query: '', showAll: true, theme: 'system', done: {}, want: {}, spots: {}, placing: false, pending: null, draft: null, canWrite: true, store: 'none', quiz: null, hover: -1 };
  try { const s = JSON.parse(localStorage.getItem('sbs-prefs-v3') || localStorage.getItem('sbs-prefs-v2') || '{}'); if (LENSES[s.lens || s.mode]) state.lens = s.lens || s.mode; if (s.showAll === false) state.showAll = false; if (s.theme === 'light' || s.theme === 'dark') state.theme = s.theme; } catch (e) {}
  const savePrefs = () => { try { localStorage.setItem('sbs-prefs-v3', JSON.stringify({ lens: state.lens, showAll: state.showAll, theme: state.theme })); } catch (e) {} };
  function applyTheme() { if (state.theme === 'light' || state.theme === 'dark') document.documentElement.setAttribute('data-theme', state.theme); else document.documentElement.removeAttribute('data-theme'); }
  applyTheme();
  const isDone = i => !!state.done[slug(HOODS[i].name)];
  const isWant = i => !!state.want[slug(HOODS[i].name)];
  const inRegion = (i, r = state.loc.region) => r === 'all' || HOODS[i].region === r;
  const isPhone = () => window.innerWidth <= 880;

  // ---------- map ----------
  const stage = $('stage'), canvas = $('map'), panel = $('panel'), head = $('head'), sheetEl = $('sheet'), trailEl = $('trail'), tip = $('tip');
  const spotList = () => { const out = []; for (const id in state.spots) { const sp = state.spots[id]; if (!sp._xy) sp._xy = Geom.proj([sp.lon, sp.lat]); out.push({ id, x: sp._xy[0], y: sp._xy[1], c: (KINDS[sp.kind] || KINDS.other).c, name: sp.name, status: sp.status || 'been', hood: sp.hood }); } if (state.pending) out.push({ id: 'pending', x: state.pending.x, y: state.pending.y, c: 'var(--accent)', name: '', status: 'pending' }); return out; };
  const marksFor = () => HOODS.map((h, i) => isDone(i) ? 'flag' : isWant(i) ? 'star' : null);
  const matches = i => { if (!inRegion(i)) return false; const info = INFO[HOODS[i].name]; for (const t of state.filters) if (!info.tags.includes(t)) return false; return true; };
  const map = window.MapView(canvas, {
    insets() { const top = document.querySelector('.top').getBoundingClientRect().bottom; return { top: (isPhone() && sheet && sheet.detent === 'full') ? 0 : top + 10, right: isPhone() ? 0 : 400 + 32, bottom: (isPhone() ? (sheet ? sheet.visible : 0) : 0) + 12, left: 0 }; },
    spots: spotList, marks: marksFor, selectedSpot: () => state.loc.spot,
    alphaFor(i) { if (state.quiz) return 1; const filtered = state.filters.size > 0 && !matches(i) ? .25 : 1; const veil = !state.showAll && state.lens !== 'done' && !isDone(i) ? .35 : 1; return filtered * veil; },
    onTap, onHover, onGestureStart() { closeLenses(); },
  });

  function colorFor(i) {
    const h = HOODS[i], info = INFO[h.name];
    if (state.quiz) return h.name === state.quiz.lit ? 'var(--accent)' : 'var(--grey-fill)';
    if (state.lens === 'vibe') return `var(--${VIBES[info.vibe].cls})`;
    if (state.lens === 'fog') return `var(--fog${info.fog})`;
    if (state.lens === 'elev') return `var(--hill${1 + Math.min(4, Math.floor(Math.sqrt(h.max / MAXM) * 5))})`;
    return isDone(i) ? 'var(--accent)' : 'var(--grey-fill)';
  }
  const recolor = animate => map.setColors(HOODS.map((h, i) => colorFor(i)), animate && !reduceMotion);

  // ---------- sheet ----------
  const sheet = window.Sheet(sheetEl, { grip: $('grip'), head, panel, ctl: $('ctl'), onChange(detent, vis, o) { if (o && (o.resize || o.quiet)) return; if (isPhone() && detent !== 'full' && !map.userMoved) flyToLoc(); } });

  // ---------- navigation ----------
  const hoodOfSpot = id => state.spots[id] ? state.spots[id].hood : null;
  function normalize(l) {
    const out = { region: 'all', hood: null, sub: null, spot: null };
    if (l.spot && state.spots[l.spot]) { const sp = state.spots[l.spot]; out.spot = l.spot; out.hood = sp.hood; out.sub = sp.sub || null; }
    else if (l.hood && IDX[l.hood] != null) { out.hood = l.hood; out.sub = l.sub != null && subByName(l.hood, l.sub) ? l.sub : null; }
    if (out.hood) out.region = HOODS[IDX[out.hood]].region; else out.region = REGIONS[l.region] ? l.region : 'all';
    return out;
  }
  const subs = name => map.subs(IDX[name]) || [];
  const subByName = (hood, sub) => subs(hood).find(s => s.name === sub) || null;
  const subIndex = (hood, sub) => subs(hood).findIndex(s => s.name === sub);
  const level = l => l.spot ? 4 : l.sub ? 3 : l.hood ? 2 : l.region !== 'all' ? 1 : 0;
  // hashes use only letters, digits and hyphens; a double hyphen separates the levels
  function hashOf(l) { if (l.spot) return '#spot--' + l.spot; if (l.sub) return '#' + slug(l.hood) + '--' + slug(l.sub); if (l.hood) return '#' + slug(l.hood); if (l.region !== 'all') return '#' + l.region; return ''; }
  function parseHash(h) {
    const parts = (h || '').replace(/^#/, '').split(/--|\//).filter(Boolean); if (!parts.length) return { region: 'all' };
    if (parts[0] === 'spot') return { spot: parts[1] };
    if (BY_SLUG[parts[0]]) { const hood = BY_SLUG[parts[0]]; const sub = parts[1] ? (subs(hood).find(s => slug(s.name) === parts[1]) || {}).name : null; return { hood, sub }; }
    if (REGIONS[parts[0]]) return { region: parts[0] };
    return { region: 'all' };
  }
  function go(l, opts = {}) {
    const next = normalize(l), prev = state.loc;
    if (state.quiz && !opts.keepQuiz) endQuiz(true);
    if (state.placing && !opts.keepPlacing) stopPlacing();
    state.loc = next; state.view = opts.view || null;
    if (opts.push !== false) { try { const url = location.pathname + location.search + hashOf(next); if (opts.replace || level(next) === level(prev) && next.hood === prev.hood && next.sub === prev.sub) history.replaceState({ loc: next }, '', url); else history.pushState({ loc: next }, '', url); } catch (e) {} }
    map.setState({ region: next.region, sel: next.hood ? IDX[next.hood] : -1, selSub: next.sub ? subIndex(next.hood, next.sub) : -1 });
    if (state.lens === 'done' || state.quiz) recolor(false);
    render();
    // settle the sheet first so the camera frames the place in the space that is left
    if (isPhone()) { const lv = level(next); if (opts.sheet) sheet.set(opts.sheet, { quiet: true }); else if (lv >= 2) { if (!opts.fromMap || sheet.detent === 'peek') sheet.set('half', { quiet: true }); } else if (opts.fromMap) sheet.set('peek', { quiet: true }); }
    else panel.scrollTop = 0;
    if (opts.fly !== false) flyToLoc(opts.dur);
  }
  function up() { const l = state.loc; if (state.view) { go(l, { replace: true, fly: false }); return; } if (l.spot) go({ hood: l.hood, sub: l.sub }); else if (l.sub) go({ hood: l.hood }); else if (l.hood) go({ region: l.region }); else if (l.region !== 'all') go({ region: 'all' }); }
  function flyToLoc(dur) {
    const l = state.loc;
    if (l.spot && state.spots[l.spot]) { const sp = state.spots[l.spot], [x, y] = sp._xy || Geom.proj([sp.lon, sp.lat]); map.flyTo([x - .01, y - .01, x + .01, y + .01], 1, NX * 0.028, dur); return; }
    if (l.sub) { const s = subByName(l.hood, l.sub); if (s) { map.flyTo(s.bbox, 1.5, NX * 0.03, dur); return; } }
    if (l.hood) { map.flyTo(map.hoodBBox(IDX[l.hood]), 1.75, NX * 0.08, dur); return; }
    map.flyTo(map.regionBBox(l.region), l.region === 'all' ? 1.03 : 1.06, 0, dur);
  }
  window.addEventListener('popstate', e => { const l = (e.state && e.state.loc) || parseHash(location.hash); go(l, { push: false }); });

  // ---------- map callbacks ----------
  function onTap(hit, sx, sy) {
    closeLenses();
    if (state.placing) { if (hit.type === 'water' || hit.type === 'hood' || hit.type === 'landmark' || hit.type === 'spot') placePending(hit.x != null ? [hit.x, hit.y] : map.toMap(sx, sy)); return; }
    if (state.quiz) { if (hit.type === 'hood' || (hit.type === 'spot' && hit.hood)) answer(hit.hood); return; }
    const l = state.loc;
    if (hit.type === 'spot') { go({ spot: hit.id }, { fromMap: true }); return; }
    if (hit.type === 'landmark') { toast(hit.landmark.name + ' · ' + hit.landmark.hood, 2600); if (l.hood !== hit.hood) go({ hood: hit.hood }, { fromMap: true, fly: false }); return; }
    if (hit.type === 'hood') {
      const name = hit.hood, subName = hit.sub >= 0 ? subs(name)[hit.sub].name : null;
      if (l.hood === name) { if (subName && subName !== l.sub) go({ hood: name, sub: subName }, { fromMap: true }); else if (!subName && l.sub) go({ hood: name }, { fromMap: true }); else if (l.spot) go({ hood: name, sub: l.sub }, { fromMap: true }); else flyToLoc(); return; }
      go(subName && map.hoodPx(hit.i) > 420 ? { hood: name, sub: subName } : { hood: name }, { fromMap: true }); return;
    }
    if (hit.type === 'water') { if (level(l) > 0) up(); }
  }
  function onHover(hit, sx, sy) {
    if (!hit || isPhone()) { map.setHover(-1, -1, null); tip.classList.remove('on'); stage.classList.remove('pointing'); return; }
    const l = state.loc;
    if (hit.type === 'spot') { const sp = state.spots[hit.id]; map.setHover(-1, -1, hit.id); showTip(sx, sy, sp.name, (KINDS[sp.kind] || KINDS.other).label + ' · ' + (sp.sub || sp.hood)); stage.classList.add('pointing'); return; }
    if (hit.type === 'landmark') { map.setHover(-1, -1, null); showTip(sx, sy, hit.landmark.name, hit.landmark.hood); stage.classList.add('pointing'); return; }
    if (hit.type === 'hood') {
      const i = hit.i, name = hit.hood, s = hit.sub >= 0 ? subs(name)[hit.sub] : null;
      map.setHover(i, hit.sub, null); stage.classList.add('pointing');
      if (state.quiz) { tip.classList.remove('on'); return; }
      if (s && (l.hood === name || map.hoodPx(i) > 420)) showTip(sx, sy, s.name, name);
      else showTip(sx, sy, name, isDone(i) ? 'Walked ✓' : isWant(i) ? 'On your list ★' : INFO[name].line);
      return;
    }
    map.setHover(-1, -1, null); tip.classList.remove('on'); stage.classList.remove('pointing');
  }
  function showTip(x, y, main, sub) { tip.innerHTML = `${esc(main)}${sub ? `<small>${esc(sub)}</small>` : ''}`; tip.style.left = x + 'px'; tip.style.top = y + 'px'; tip.classList.add('on'); }
  let toastTimer = null;
  function toast(t, ms = 2200) { const el = $('toast'); el.textContent = t; el.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('on'), ms); }

  // ---------- chrome: trail, lenses, legend, search ----------
  function renderTrail() {
    const l = state.loc, crumbs = [{ label: 'Bay Area', loc: { region: 'all' } }];
    if (l.region !== 'all') crumbs.push({ label: REGIONS[l.region].label, loc: { region: l.region } });
    if (l.hood) crumbs.push({ label: l.hood, loc: { hood: l.hood } });
    if (l.sub) crumbs.push({ label: l.sub, loc: { hood: l.hood, sub: l.sub } });
    if (l.spot && state.spots[l.spot]) crumbs.push({ label: state.spots[l.spot].name, loc: { spot: l.spot } });
    trailEl.classList.toggle('deep', crumbs.length > 1);
    trailEl.innerHTML = `<button type="button" class="back" aria-label="Back">${ICON.back}</button>` + crumbs.map((c, i) => `${i ? '<span class="sep">›</span>' : ''}<button type="button" data-crumb="${i}" aria-current="${i === crumbs.length - 1}">${esc(c.label)}</button>`).join('');
    trailEl.querySelector('.back').addEventListener('click', up);
    trailEl.querySelectorAll('[data-crumb]').forEach(b => b.addEventListener('click', () => { const c = crumbs[+b.dataset.crumb]; if (+b.dataset.crumb === crumbs.length - 1) flyToLoc(); else go(c.loc); }));
    trailEl.scrollLeft = 1e6;
  }
  const lensesEl = $('lenses'), lensBtn = $('lens-btn');
  function swatches(lens) { if (lens === 'vibe') return Object.values(VIBES).map(v => `<i style="--c:var(--${v.cls})"></i>`).join(''); if (lens === 'fog') return [1, 2, 3, 4, 5].map(n => `<i style="--c:var(--fog${n})"></i>`).join(''); if (lens === 'elev') return [1, 2, 3, 4, 5].map(n => `<i style="--c:var(--hill${n})"></i>`).join(''); return `<i style="--c:var(--accent)"></i><i style="--c:var(--grey-fill)"></i>`; }
  function renderLenses() { lensesEl.innerHTML = Object.entries(LENSES).map(([k, v]) => `<button type="button" role="menuitemradio" data-lens="${k}" aria-pressed="${state.lens === k}"><span><b>${v.label}</b><small>${v.sub}</small></span><span class="sw">${swatches(k)}</span></button>`).join(''); lensesEl.querySelectorAll('[data-lens]').forEach(b => b.addEventListener('click', () => { setLens(b.dataset.lens); closeLenses(); })); }
  function setLens(k) { state.lens = k; savePrefs(); renderLenses(); renderLegend(); recolor(true); }
  function renderLegend() {
    const el = $('legend'), k = state.lens;
    if (state.quiz) { el.innerHTML = ''; return; }
    if (k === 'vibe') el.innerHTML = Object.values(VIBES).map(v => `<span><i style="--c:var(--${v.cls})"></i>${v.label}</span>`).join('');
    else if (k === 'fog') el.innerHTML = `<span>Sunny</span><span class="ramp">${swatches('fog')}</span><span>Always foggy</span>`;
    else if (k === 'elev') el.innerHTML = `<span>Sea level</span><span class="ramp">${swatches('elev')}</span><span>${ft(MAXM).toLocaleString()} ft</span>`;
    else el.innerHTML = `<span><i style="--c:var(--accent)"></i>Walked</span><span><i style="--c:var(--grey-fill)"></i>Not yet</span>`;
    el.innerHTML += `<span class="hint">Tap a place · drag · scroll to zoom</span>`;
  }
  function closeLenses() { lensesEl.classList.remove('on'); lensBtn.setAttribute('aria-expanded', 'false'); }
  lensBtn.addEventListener('click', e => { e.stopPropagation(); const on = !lensesEl.classList.contains('on'); lensesEl.classList.toggle('on', on); lensBtn.setAttribute('aria-expanded', String(on)); });
  document.addEventListener('pointerdown', e => { if (!e.target.closest('#lenses, #lens-btn')) closeLenses(); });
  $('zoom-in').addEventListener('click', () => map.zoom(1 / 1.6)); $('zoom-out').addEventListener('click', () => map.zoom(1.6));
  $('home').addEventListener('click', () => { if (level(state.loc) === 0) flyToLoc(); else go({ region: 'all' }); });
  document.addEventListener('keydown', e => { if (e.target.matches('input, textarea, select')) { if (e.key === 'Escape') e.target.blur(); return; } if (e.key === 'Escape') { if (state.view || level(state.loc) > 0) up(); } else if (e.key === '+' || e.key === '=') map.zoom(1 / 1.6); else if (e.key === '-') map.zoom(1.6); });
  const q = $('q');
  q.addEventListener('input', () => { state.query = q.value.trim().toLowerCase(); q.classList.toggle('has', !!q.value); if (state.query) renderSearch(); else render(); });
  q.addEventListener('keydown', e => { if (e.key === 'Enter') { const first = panel.querySelector('[data-first]'); if (first) first.click(); } });
  q.addEventListener('focus', () => { if (isPhone() && sheet.detent === 'peek') sheet.set('half'); if (state.query) renderSearch(); });

  // ---------- head + panel ----------
  function setHead(o) {
    head.innerHTML = `<button type="button" class="up" aria-label="Back" ${o.back === false ? 'hidden' : ''}>${ICON.back}</button><div class="ttl"><p class="eyebrow">${o.dot ? `<i style="--c:${o.dot}"></i>` : ''}${o.eyebrow || ''}</p><h2>${o.title}</h2></div><div class="tools">${(o.tools || []).map(t => `<button type="button" data-tool="${t.id}" title="${esc(t.label)}" aria-label="${esc(t.label)}">${t.icon}</button>`).join('')}</div>`;
    head.querySelector('.up').addEventListener('click', o.onBack || up);
    (o.tools || []).forEach(t => head.querySelector(`[data-tool="${t.id}"]`).addEventListener('click', t.run));
  }
  function render() {
    renderTrail(); renderLegend();
    if (state.query) { renderSearch(); return; }
    if (state.quiz) { renderQuiz(); return; }
    const l = state.loc, v = state.view;
    if (v === 'log') renderLogForm(); else if (v === 'spots') renderSpots(); else if (l.spot) renderSpot(l.spot); else if (l.sub) renderSub(l.hood, l.sub); else if (l.hood) renderHood(l.hood); else renderHome();
    wire(panel);
  }
  function wire(root) {
    root.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => go(JSON.parse(b.dataset.go))));
    root.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => go(state.loc, { view: b.dataset.view, fly: false, replace: true, sheet: isPhone() ? 'full' : undefined })));
  }
  const rowSub = (hood, s, j) => { const n = Object.values(state.spots).filter(sp => sp.hood === hood && sp.sub === s.name).length; return `<li><button type="button" class="row" data-go='${attr({ hood, sub: s.name })}'><span class="ic sq" style="--c:${colorFor(IDX[hood])};opacity:${[1, .75, .5][j % 3]}"></span><span class="nm">${esc(s.name)}<small>${esc(s.line)}</small></span><span class="rt">${n ? n + (n === 1 ? ' spot' : ' spots') : ''}<span class="chev"></span></span></button></li>`; };
  const rowSpot = (id, withPlace) => { const sp = state.spots[id], k = KINDS[sp.kind] || KINDS.other; const meta = [k.label, withPlace ? (sp.sub || sp.hood) : sp.sub, sp.note].filter(Boolean).join(' · '); const rt = sp.status === 'want' ? 'want to try' : (sp.rating ? '★'.repeat(sp.rating) : niceDate(sp.at)); return `<li><button type="button" class="row" data-go='${attr({ spot: id })}'><span class="ic" style="--c:${k.c};${sp.status === 'want' ? 'background:transparent;box-shadow:0 0 0 2px ' + k.c + ' inset' : ''}"></span><span class="nm">${esc(sp.name)}<small>${esc(meta)}</small></span><span class="rt">${esc(rt)}</span></button></li>`; };
  const spotsIn = (hood, sub) => Object.keys(state.spots).filter(id => state.spots[id].hood === hood && (!sub || state.spots[id].sub === sub)).sort((a, b) => (state.spots[a].at < state.spots[b].at ? 1 : -1));
  const logTool = (hood, sub) => ({ id: 'log', label: 'Log a place', icon: ICON.plus, run: () => startLog({ hood, sub }) });

  // ---- home: Bay Area or a region ----
  const doneCount = (r = state.loc.region) => HOODS.reduce((s, h, i) => s + (inRegion(i, r) && isDone(i) ? 1 : 0), 0);
  const climbedFt = (r = state.loc.region) => HOODS.reduce((s, h, i) => s + (inRegion(i, r) && isDone(i) ? ft(h.max) : 0), 0);
  const areaPct = (r = state.loc.region) => { let a = 0, t = 0; HOODS.forEach((h, i) => { if (inRegion(i, r)) { t += h.cells; if (isDone(i)) a += h.cells; } }); return t ? a / t : 0; };
  function stampState() { const vibe = {}; for (const k in VIBES) vibe[k] = HOODS.every((h, i) => INFO[h.name].vibe !== k || isDone(i)); return { n: doneCount('all'), sf: doneCount('sf'), marin: doneCount('marin'), east: doneCount('east'), penin: doneCount('penin'), ft: climbedFt('all'), vibe }; }
  function renderHome() {
    const r = state.loc.region, n = doneCount(), total = REGION_N[r], s = stampState(), earned = STAMPS.filter(st => st.test(s)), next = STAMPS.find(st => !st.test(s));
    setHead({ back: r !== 'all', eyebrow: r === 'all' ? 'Logbook' : 'Logbook · Bay Area', title: r === 'all' ? 'The Bay Area' : REGIONS[r].label, tools: [logTool(null, null)] });
    const entries = NAMES.filter(x => inRegion(IDX[x]) && state.done[slug(x)]).sort((a, b) => (state.done[slug(b)].at || '').localeCompare(state.done[slug(a)].at || '') || a.localeCompare(b));
    const wantList = NAMES.filter(x => inRegion(IDX[x]) && state.want[slug(x)] && !state.done[slug(x)]);
    const recent = Object.keys(state.spots).filter(id => IDX[state.spots[id].hood] != null && inRegion(IDX[state.spots[id].hood])).sort((a, b) => (state.spots[a].at < state.spots[b].at ? 1 : -1));
    const active = state.filters.size > 0, hits = active ? NAMES.filter(x => matches(IDX[x])) : [];
    const places = r === 'all'
      ? ['sf', 'marin', 'east', 'penin'].map(k => `<li><button type="button" class="row" data-go='${attr({ region: k })}'><span class="ic ${doneCount(k) === REGION_N[k] ? 'flag' : doneCount(k) ? 'sq' : 'none'}" style="--c:var(--accent)"></span><span class="nm">${REGIONS[k].label}</span><span class="rt">${doneCount(k)} of ${REGION_N[k]}<span class="chev"></span></span></button></li>`).join('')
      : NAMES.filter(x => inRegion(IDX[x])).map(x => `<li><button type="button" class="row" data-go='${attr({ hood: x })}'><span class="ic ${isDone(IDX[x]) ? 'flag' : isWant(IDX[x]) ? 'star' : 'none'}"></span><span class="nm">${esc(x)}</span><span class="rt">${ft(HOODS[IDX[x]].max).toLocaleString()} ft</span></button></li>`).join('');
    panel.innerHTML = `
      <div class="progress"><div class="bar"><i style="width:${(n / total * 100).toFixed(1)}%"></i></div><small>${n === 0 ? 'Nothing walked yet' : `<b>${n}</b> of ${total} walked · ${Math.round(areaPct() * 100)}% by area · ${climbedFt().toLocaleString()} ft climbed`}</small></div>
      <p class="lead">${n === 0 ? 'Tap a place on the map, or pick one below. When you have set foot in it, log it and it gets a flag.' : n === total ? `All ${total}. You have walked ${REGIONS[r].the}.` : `${total - n} to go.${next ? ' Next stamp: ' + next.label + '.' : ''}`}</p>
      <div class="textlinks"><button type="button" id="surprise">Suggest a place</button><button type="button" id="quiz">Quiz me</button><button type="button" data-mood-toggle>Find by mood${active ? ' (' + state.filters.size + ')' : ''}</button></div>
      <div id="moods" ${active ? '' : 'hidden'}><h3>Mood</h3><div class="textlinks">${MOODS.map(t => `<button type="button" data-mood="${t}" aria-pressed="${state.filters.has(t)}">${t}</button>`).join('')}</div>
        ${active ? `<h3>${hits.length ? hits.length + ' match' + (hits.length === 1 ? '' : 'es') : 'No matches'}</h3><div class="textlinks">${hits.map(a => `<button type="button" class="${isDone(IDX[a]) ? 'done' : isWant(IDX[a]) ? 'want' : ''}" data-go='${attr({ hood: a })}'>${esc(a)}</button>`).join('')}</div>` : ''}</div>
      <h3>${r === 'all' ? 'Regions' : 'Places'} <span class="n">${r === 'all' ? '' : total}</span></h3><ul class="rows ${r === 'all' ? '' : 'cols2'}">${places}</ul>
      ${entries.length ? `<h3>Walked <span class="n">${entries.length}</span></h3><ul class="rows">${entries.map(x => `<li><button type="button" class="row" data-go='${attr({ hood: x })}'><span class="ic flag"></span><span class="nm">${esc(x)}${state.done[slug(x)].note ? `<small>${esc(state.done[slug(x)].note)}</small>` : ''}</span><span class="rt">${niceDate(state.done[slug(x)].at)}</span></button></li>`).join('')}</ul>` : ''}
      ${wantList.length ? `<h3>Want to go <span class="n">${wantList.length}</span></h3><div class="textlinks">${wantList.map(a => `<button type="button" class="want" data-go='${attr({ hood: a })}'>${esc(a)}</button>`).join('')}</div>` : ''}
      <h3>Spots <span class="n">${recent.length || ''}</span>${recent.length > 6 ? `<button type="button" class="act" data-view="spots">All ${recent.length}</button>` : `<button type="button" class="act" id="log-home">+ Log a place</button>`}</h3>
      ${recent.length ? `<ul class="rows">${recent.slice(0, 6).map(id => rowSpot(id, true)).join('')}</ul>` : `<p class="empty">Restaurants, bars, views, shops: search a name or drop a pin, then rate it.</p>`}
      <h3>Stamps <span class="n">${earned.length} of ${STAMPS.length}</span></h3><div class="stamps">${STAMPS.map(st => `<div class="stamp ${st.test(s) ? 'got' : ''}"><b>${st.icon}</b>${st.label}</div>`).join('')}</div>
      <details class="more"><summary>Settings</summary>
        <label class="switch"><span>Color every place, walked or not</span><input type="checkbox" id="show-all" ${state.showAll ? 'checked' : ''}></label>
        <div class="field" style="margin-top:12px"><label>Appearance</label><div class="seg">${['system', 'light', 'dark'].map(t => `<button type="button" data-theme-pick="${t}" aria-pressed="${state.theme === t}">${t === 'system' ? 'System' : t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div></div>
        <div class="actions" style="margin-top:4px"><button type="button" class="btn sm" id="export">Export log</button><button type="button" class="btn sm" id="import">Import</button><input type="file" id="import-file" accept="application/json" hidden></div>
        <p class="fine">${state.store === 'db' ? 'Your log, list, spots and notes are saved with this artifact and shared with everyone it is shared with.' : 'Your log is saved in this browser. Export it now and then to keep a copy, or to move it to another device.'} San Francisco boundaries from the SF Planning Department, high points from Mapzen elevation data. Marin, East Bay and Peninsula boundaries from the US Census; their high points are approximate. Place search by Photon, © OpenStreetMap contributors.</p>
      </details>`;
    panel.querySelector('#surprise').addEventListener('click', surprise);
    panel.querySelector('#quiz').addEventListener('click', startQuiz);
    const lg = panel.querySelector('#log-home'); if (lg) lg.addEventListener('click', () => startLog({}));
    panel.querySelector('[data-mood-toggle]').addEventListener('click', () => { const m = panel.querySelector('#moods'); m.hidden = !m.hidden; });
    panel.querySelectorAll('[data-mood]').forEach(b => b.addEventListener('click', () => { const t = b.dataset.mood; state.filters.has(t) ? state.filters.delete(t) : state.filters.add(t); map.invalidate(); render(); panel.querySelector('#moods').hidden = false; }));
    panel.querySelectorAll('[data-theme-pick]').forEach(b => b.addEventListener('click', () => { state.theme = b.dataset.themePick; savePrefs(); applyTheme(); map.refreshPalette(); recolor(false); render(); }));
    panel.querySelector('#show-all').addEventListener('change', e => { state.showAll = e.target.checked; savePrefs(); map.invalidate(); });
    panel.querySelector('#export').addEventListener('click', exportLog);
    panel.querySelector('#import').addEventListener('click', () => panel.querySelector('#import-file').click());
    panel.querySelector('#import-file').addEventListener('change', e => importLog(e.target.files[0]));
  }

  // ---- a neighborhood ----
  function renderHood(name) {
    const i = IDX[name], info = INFO[name], h = HOODS[i], k = slug(name), done = state.done[k], want = state.want[k], secs = subs(name), mine = spotsIn(name);
    const roof = h.max === Math.max(...HOODS.filter(x => x.region === h.region).map(x => x.max)), dis = state.canWrite ? '' : 'disabled';
    const keepNote = panel.dataset.name === name && panel.querySelector('#note') ? panel.querySelector('#note').value : null; panel.dataset.name = name;
    setHead({ eyebrow: `${REGIONS[h.region].label} · ${VIBES[info.vibe].label}`, dot: `var(--${VIBES[info.vibe].cls})`, title: esc(name), tools: [logTool(name, null)] });
    panel.innerHTML = `
      <p class="lead">${esc(info.line)}</p>
      <div class="marks">
        <button type="button" class="mark done ${done ? 'on' : ''}" id="explore" aria-pressed="${!!done}" ${dis}><span class="box">${ICON.check}</span><span><b>${done ? 'Walked' : 'Been here'}</b><small>${done ? niceDate(done.at) + ' · tap to undo' : 'Logs it with a flag'}</small></span></button>
        <button type="button" class="mark want ${want ? 'on' : ''}" id="want" aria-pressed="${!!want}" ${dis || (done ? 'disabled' : '')}><span class="box">${ICON.star}</span><span><b>${want ? 'On the list' : 'Want to go'}</b><small>${done ? 'Already walked' : want ? 'Tap to remove' : 'Save for later'}</small></span></button>
      </div>
      ${done ? `<textarea class="note" id="note" placeholder="What did you eat, see, or climb?" aria-label="Notes for ${esc(name)}">${esc(keepNote ?? done.note ?? '')}</textarea>` : ''}<div class="savestate" id="savestate">${state.canWrite ? '' : 'Sign in to keep a list'}</div>
      <div class="facts"><span><b>${ft(h.max).toLocaleString()} ft</b> high point${roof ? ' · ' + REGIONS[h.region].roof : ''}</span><span><b>Fog</b> <span class="dots">${[1, 2, 3, 4, 5].map(n => `<i class="${n <= info.fog ? 'on' : ''}"></i>`).join('')}</span> ${FOG_WORDS[info.fog - 1]}</span></div>
      ${secs.length ? `<h3>Sections <span class="n">${secs.length}</span></h3><ul class="rows">${secs.map((s, j) => rowSub(name, s, j)).join('')}</ul>` : ''}
      <h3>Spots <span class="n">${mine.length || ''}</span><button type="button" class="act" id="log-here">+ Log a place</button></h3>
      ${mine.length ? `<ul class="rows">${mine.map(id => rowSpot(id, false)).join('')}</ul>` : `<p class="empty">Nothing logged here yet.</p>`}
      <h3>Known for</h3><ul class="plain">${info.known.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
      <h3>One thing to know</h3><p class="fact">${esc(info.fact)}</p>
      <h3>Next door</h3>${h.adj.length ? `<div class="textlinks">${h.adj.map(a => `<button type="button" class="${isDone(IDX[a]) ? 'done' : isWant(IDX[a]) ? 'want' : ''}" data-go='${attr({ hood: a })}'>${esc(a)}</button>`).join('')}</div>` : '<p class="empty">Nobody. It is an island.</p>'}`;
    panel.querySelector('#explore').addEventListener('click', () => toggleDone(name));
    panel.querySelector('#want').addEventListener('click', () => toggleWant(name));
    panel.querySelector('#log-here').addEventListener('click', () => startLog({ hood: name }));
    const n = panel.querySelector('#note'); if (n) n.addEventListener('input', e => noteInput(name, e.target.value));
  }
  // ---- a section of a neighborhood ----
  function renderSub(hood, subName) {
    const s = subByName(hood, subName), i = IDX[hood], info = INFO[hood], mine = spotsIn(hood, subName), others = subs(hood).filter(x => x.name !== subName);
    setHead({ eyebrow: `${esc(hood)} · ${REGIONS[HOODS[i].region].label}`, dot: `var(--${VIBES[info.vibe].cls})`, title: esc(subName), tools: [logTool(hood, subName)] });
    panel.innerHTML = `
      <p class="lead">${esc(s.line)}</p>
      ${s.tags && s.tags.length ? `<div class="facts">${s.tags.map(t => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
      <h3>Spots here <span class="n">${mine.length || ''}</span><button type="button" class="act" id="log-here">+ Log a place</button></h3>
      ${mine.length ? `<ul class="rows">${mine.map(id => rowSpot(id, false)).join('')}</ul>` : `<p class="empty">Nothing logged in ${esc(subName)} yet.</p>`}
      ${s.known && s.known.length ? `<h3>Known for</h3><ul class="plain">${s.known.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      <h3>Also in ${esc(hood)}</h3><div class="textlinks">${others.map(x => `<button type="button" data-go='${attr({ hood, sub: x.name })}'>${esc(x.name)}</button>`).join('')}</div>`;
    panel.querySelector('#log-here').addEventListener('click', () => startLog({ hood, sub: subName }));
  }
  // ---- a spot ----
  function renderSpot(id) {
    const sp = state.spots[id], k = KINDS[sp.kind] || KINDS.other;
    setHead({ eyebrow: `${k.label} · ${esc(sp.sub || sp.hood)}`, dot: k.c, title: esc(sp.name), tools: [{ id: 'edit', label: 'Edit', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l10-10-4-4L4 16v4z"/><path d="M13 7l4 4"/></svg>', run: () => startLog({ hood: sp.hood, sub: sp.sub, edit: id }) }] });
    const maps = `https://www.google.com/maps/search/?api=1&query=${sp.lat},${sp.lon}`;
    panel.innerHTML = `
      ${sp.where ? `<p class="lead">${esc(sp.where)}</p>` : ''}
      <div class="facts">${sp.status === 'want' ? '<span><b>Want to try</b></span>' : `<span><b>Been</b> ${niceDate(sp.at)}</span>${sp.rating ? `<span class="stars">${'★'.repeat(sp.rating)}<span style="color:var(--line-2)">${'★'.repeat(5 - sp.rating)}</span></span>` : ''}`}<span>${esc(sp.hood)}${sp.sub ? ' › ' + esc(sp.sub) : ''}</span></div>
      ${sp.note ? `<h3>Notes</h3><p>${esc(sp.note)}</p>` : ''}
      <div class="actions" style="margin-top:18px">${sp.status === 'want' ? `<button type="button" class="btn primary" id="been-now">Been here now</button>` : ''}<a class="btn" href="${maps}" target="_blank" rel="noopener">Open in Maps</a><button type="button" class="btn quiet" id="edit">Edit</button><button type="button" class="btn quiet" id="del" style="color:var(--bad)">Delete</button></div>
      <div class="actions" id="del-confirm" hidden><span style="font-size:13.5px;align-self:center">Remove ${esc(sp.name)} from your log?</span><button type="button" class="btn sm" id="del-yes" style="color:var(--bad);border-color:var(--bad)">Delete</button><button type="button" class="btn sm quiet" id="del-no">Keep</button></div>`;
    panel.querySelector('#edit').addEventListener('click', () => startLog({ hood: sp.hood, sub: sp.sub, edit: id }));
    panel.querySelector('#del').addEventListener('click', () => { panel.querySelector('#del-confirm').hidden = false; panel.querySelector('#del').hidden = true; });
    panel.querySelector('#del-no').addEventListener('click', () => { panel.querySelector('#del-confirm').hidden = true; panel.querySelector('#del').hidden = false; });
    panel.querySelector('#del-yes').addEventListener('click', () => removeSpot(id));
    const bn = panel.querySelector('#been-now'); if (bn) bn.addEventListener('click', async () => { sp.status = 'been'; sp.at = today(); await persist(); render(); toast(`${sp.name}: been there.`); });
  }
  // ---- all spots ----
  function renderSpots() {
    const r = state.loc.region; const f = state.spotFilter || {};
    let ids = Object.keys(state.spots).filter(id => IDX[state.spots[id].hood] != null && inRegion(IDX[state.spots[id].hood], r));
    if (f.kind) ids = ids.filter(id => state.spots[id].kind === f.kind); if (f.status) ids = ids.filter(id => (state.spots[id].status || 'been') === f.status);
    ids.sort((a, b) => (state.spots[a].at < state.spots[b].at ? 1 : -1));
    setHead({ eyebrow: 'Logbook', title: 'Spots', onBack: () => go(state.loc, { replace: true, fly: false }), tools: [logTool(null, null)] });
    panel.innerHTML = `<div class="textlinks" style="margin-bottom:6px"><button type="button" data-sf="status:" aria-pressed="${!f.status}">All</button><button type="button" data-sf="status:been" aria-pressed="${f.status === 'been'}">Been</button><button type="button" data-sf="status:want" aria-pressed="${f.status === 'want'}">Want to try</button></div>
      <div class="textlinks"><button type="button" data-sf="kind:" aria-pressed="${!f.kind}">Any kind</button>${Object.entries(KINDS).map(([k, v]) => `<button type="button" data-sf="kind:${k}" aria-pressed="${f.kind === k}">${v.label}</button>`).join('')}</div>
      <h3>${ids.length} ${ids.length === 1 ? 'spot' : 'spots'}</h3>${ids.length ? `<ul class="rows">${ids.map(id => rowSpot(id, true)).join('')}</ul>` : '<p class="empty">Nothing matches.</p>'}`;
    panel.querySelectorAll('[data-sf]').forEach(b => b.addEventListener('click', () => { const [k, v] = b.dataset.sf.split(':'); state.spotFilter = Object.assign({}, f, { [k]: v || null }); renderSpots(); wire(panel); }));
  }
  // ---- search ----
  function renderSearch() {
    const qq = state.query, hoods = NAMES.filter(n => n.toLowerCase().includes(qq) || (SHORT[n] || '').toLowerCase().includes(qq));
    const secs = []; HOODS.forEach(h => subs(h.name).forEach(s => { if (s.name.toLowerCase().includes(qq)) secs.push({ hood: h.name, sub: s.name }); }));
    const spots = Object.keys(state.spots).filter(id => state.spots[id].name.toLowerCase().includes(qq) || (state.spots[id].note || '').toLowerCase().includes(qq));
    const lms = map.landmarks.filter(l => l.name.toLowerCase().includes(qq));
    setHead({ eyebrow: 'Search', title: esc(q.value), onBack: () => { q.value = ''; state.query = ''; q.classList.remove('has'); render(); } });
    let first = true; const F = () => { const f = first ? 'data-first' : ''; first = false; return f; };
    panel.innerHTML = `
      ${hoods.length ? `<h3>Places <span class="n">${hoods.length}</span></h3><ul class="rows">${hoods.map(n => `<li><button type="button" class="row" ${F()} data-go='${attr({ hood: n })}'><span class="ic ${isDone(IDX[n]) ? 'flag' : isWant(IDX[n]) ? 'star' : 'none'}"></span><span class="nm">${esc(n)}<small>${esc(REGIONS[HOODS[IDX[n]].region].label)}</small></span><span class="rt"><span class="chev"></span></span></button></li>`).join('')}</ul>` : ''}
      ${secs.length ? `<h3>Sections <span class="n">${secs.length}</span></h3><ul class="rows">${secs.map(x => `<li><button type="button" class="row" ${F()} data-go='${attr(x)}'><span class="ic sq"></span><span class="nm">${esc(x.sub)}<small>${esc(x.hood)}</small></span><span class="rt"><span class="chev"></span></span></button></li>`).join('')}</ul>` : ''}
      ${lms.length ? `<h3>Landmarks</h3><ul class="rows">${lms.map(l => `<li><button type="button" class="row" ${F()} data-go='${attr({ hood: l.hood })}'><span class="ic sq" style="--c:var(--ink)"></span><span class="nm">${esc(l.name)}<small>${esc(l.hood)}</small></span><span class="rt"><span class="chev"></span></span></button></li>`).join('')}</ul>` : ''}
      ${spots.length ? `<h3>Your spots <span class="n">${spots.length}</span></h3><ul class="rows">${spots.map(id => rowSpot(id, true).replace('class="row"', `class="row" ${F()}`)).join('')}</ul>` : ''}
      ${!hoods.length && !secs.length && !spots.length && !lms.length ? `<p class="empty">Nothing called “${esc(q.value)}”. To log a new place, open a neighborhood and tap +.</p>` : ''}`;
    panel.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => { q.value = ''; state.query = ''; q.classList.remove('has'); q.blur(); })); // before wire(): go() must see the query cleared
    wire(panel);
  }

  // ---------- tracker ----------
  let docRef = null, writing = Promise.resolve(), lastSent = null;
  const clone = o => JSON.parse(JSON.stringify(o || {}));
  function persist() {
    const spots = {}; for (const id in state.spots) { const { _xy, ...rest } = state.spots[id]; spots[id] = rest; }
    const payload = { hoods: state.done, want: state.want, spots, updatedAt: new Date().toISOString() };
    if (docRef) { lastSent = payload.updatedAt; writing = writing.then(() => docRef.set(payload)).then(() => true, e => { if (e && e.code === 'invalid_argument') { state.canWrite = false; render(); } setSaveState('Could not save. Try again in a moment.'); console.warn('save failed', e); return false; }); return writing; }
    try { localStorage.setItem('sbs-explored', JSON.stringify(payload)); } catch (e) {}
    return Promise.resolve();
  }
  function setSaveState(t) { const el = $('savestate'); if (el) el.textContent = t; }
  function adopt(body) {
    state.done = clone(body.hoods); state.want = clone(body.want); state.spots = clone(body.spots);
    for (const id in state.spots) { const sp = state.spots[id]; if (!sp.status) sp.status = 'been'; if (!sp.sub && IDX[sp.hood] != null) { const [x, y] = Geom.proj([sp.lon, sp.lat]); const j = map.subIndexAt(IDX[sp.hood], x, y); if (j >= 0) sp.sub = subs(sp.hood)[j].name; } }
  }
  async function toggleDone(name) {
    if (!state.canWrite) return;
    const k = slug(name), i = IDX[name], before = stampState();
    if (state.done[k]) delete state.done[k]; else { state.done[k] = { at: today(), note: '' }; delete state.want[k]; map.pop(i); }
    if (state.lens === 'done') recolor(true); map.redraw(); render();
    if (state.done[k]) { const after = stampState(); const newStamp = STAMPS.find(s => !s.test(before) && s.test(after)); toast(newStamp ? `Stamp earned: ${newStamp.label}` : `${name} walked. +${ft(HOODS[i].max).toLocaleString()} ft`); }
    setSaveState('Saving…'); if (await persist() !== false) setSaveState(state.done[k] ? 'Saved' : '');
  }
  async function toggleWant(name) {
    if (!state.canWrite) return; const k = slug(name), i = IDX[name];
    if (state.want[k]) delete state.want[k]; else { state.want[k] = { at: today() }; map.pop(i); }
    map.redraw(); render(); setSaveState('Saving…'); if (await persist() !== false) setSaveState('Saved');
  }
  let noteTimer = null;
  function noteInput(name, text) { const k = slug(name); if (!state.done[k]) return; state.done[k].note = text; setSaveState('Saving…'); clearTimeout(noteTimer); noteTimer = setTimeout(async () => { if (await persist() !== false) setSaveState('Saved'); }, 700); }
  let local = null;
  function loadLocal() { try { local = JSON.parse(localStorage.getItem('sbs-explored') || 'null'); } catch (e) {} if (local && local.hoods) adopt(local); }
  async function connectStore() {
    if (!window.claude || !window.claude.use) { state.store = 'local'; return; }
    try {
      const [d, u] = await Promise.all([claude.use('db'), claude.use('user')]);
      const uid = u ? await u.id() : null;
      if (!d || !uid) { state.store = 'local'; return; }
      // One logbook for everyone the artifact is shared with (last write wins). Logs kept under the older
      // per-person path are copied into it the first time the shared one is found empty.
      docRef = d.doc('logbook/shared'); state.store = 'db';
      const mine = d.doc('data/users/' + uid + '/explored');
      let seeded = false;
      docRef.onSnapshot(async snap => {
        const data = snap.exists ? (snap.data() || {}) : null;
        if (data && ((data.updatedAt && data.updatedAt === lastSent) || (snap.metadata && snap.metadata.hasPendingWrites))) return; // our own write coming back: nothing new, and a re-render would take the focus off the note
        if (data) adopt(data);
        else if (!seeded && !(snap.metadata && snap.metadata.fromCache)) {
          seeded = true;
          let old = null; try { const m = await mine.get(); if (m.exists) old = m.data(); } catch (e) {}
          if (old && old.hoods) { adopt(old); persist(); }
          else if (local && local.hoods && Object.keys(local.hoods).length) persist();
        }
        if (state.lens === 'done') recolor(false); map.redraw();
        const boot = state.bootLoc; state.bootLoc = null;
        if (boot && state.spots[boot.spot] && !state.loc.spot) go(boot, { replace: true }); // a spot link whose spot has only now arrived
        else if (state.loc.spot && !state.spots[state.loc.spot]) go({ hood: state.loc.hood }, { replace: true }); else render();
      }, e => console.warn('subscription ended', e));
    } catch (e) { state.store = 'local'; console.warn('store unavailable', e); }
  }
  async function exportLog() {
    const payload = { app: 'seven-by-seven', exportedAt: new Date().toISOString(), hoods: state.done, want: state.want, spots: Object.fromEntries(Object.entries(state.spots).map(([id, sp]) => { const { _xy, ...rest } = sp; return [id, rest]; })) };
    const text = JSON.stringify(payload, null, 1), filename = `seven-by-seven-${today()}.json`;
    if (window.claude && window.claude.use) { // inside claude.ai the page cannot start a download itself; the viewer offers the save
      try { const dl = await claude.use('downloads'); if (dl) { await dl.save({ filename, data: text }); toast('Exported'); return; } } catch (e) { if (e && e.code !== 'cancelled') toast('Export was not allowed here', 3000); return; }
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  async function importLog(file) {
    if (!file) return;
    try {
      const body = JSON.parse(await file.text()); if (!body || typeof body !== 'object' || !(body.hoods || body.spots)) throw new Error('not a log');
      let n = 0; for (const k in body.hoods || {}) if (!state.done[k]) { state.done[k] = body.hoods[k]; n++; } for (const k in body.want || {}) if (!state.want[k] && !state.done[k]) { state.want[k] = body.want[k]; n++; } for (const id in body.spots || {}) if (!state.spots[id]) { state.spots[id] = body.spots[id]; n++; }
      adopt({ hoods: state.done, want: state.want, spots: state.spots }); await persist(); if (state.lens === 'done') recolor(true); map.redraw(); render(); toast(`Imported ${n} ${n === 1 ? 'thing' : 'things'}`);
    } catch (e) { toast('That file is not a Seven by Seven log', 3000); }
  }

  // ---------- logging a place ----------
  function hoodAt(x, y) { for (let i = 0; i < HOODS.length; i++) { const bb = map.bbox[i]; if (x < bb[0] || x > bb[2] || y < bb[1] || y > bb[3]) continue; if (Geom.inPolys(window.HPP[i], x, y)) return i; } return -1; }
  function locateXY(x, y) { const i = hoodAt(x, y); if (i < 0) return { hood: null, sub: null }; const j = map.subIndexAt(i, x, y); return { hood: HOODS[i].name, sub: j >= 0 ? subs(HOODS[i].name)[j].name : null }; }
  function startLog(ctx) {
    const sp = ctx.edit ? state.spots[ctx.edit] : null;
    state.draft = sp ? Object.assign({}, sp, { id: ctx.edit, x: sp._xy ? sp._xy[0] : null, y: sp._xy ? sp._xy[1] : null }) : { id: null, name: '', kind: 'food', status: 'been', rating: 0, note: '', at: today(), hood: ctx.hood || state.loc.hood || null, sub: ctx.sub || (ctx.hood ? null : state.loc.sub) || null, lon: null, lat: null, x: null, y: null, where: '', src: null };
    go(state.loc, { view: 'log', fly: false, replace: true, sheet: isPhone() ? 'full' : undefined });
  }
  let sugTimer = null, sugCtrl = 0;
  function renderLogForm() {
    const d = state.draft; if (!d) { state.view = null; render(); return; }
    const placed = d.lon != null;
    setHead({ eyebrow: d.id ? 'Edit spot' : 'Log a place', title: d.id ? esc(d.name) : (d.hood ? `In ${esc(d.sub || d.hood)}` : 'Somewhere on the map'), onBack: cancelLog, tools: [] });
    panel.innerHTML = `<form id="logform" autocomplete="off">
      <div class="field"><label for="lf-q">${placed ? 'Place' : 'Find the place'}</label><input id="lf-q" placeholder="Search a restaurant, bar, park…" value="${esc(d.name)}" ${placed ? '' : 'autofocus'}>
        ${placed ? `<small style="color:var(--muted);font-size:12.5px">${ICON.pin.replace('<svg', '<svg style="width:12px;height:12px;vertical-align:-1px;fill:none;stroke:currentColor;stroke-width:2"')} ${esc(d.where || '')}${(() => { const w = d.where || ''; const parts = [d.sub, d.hood].filter(x => x && !w.includes(x)); const tail = parts.length ? parts.join(', ') : (w ? '' : 'outside the tracked places'); return (w && tail ? ' · ' : '') + esc(tail); })()} <button type="button" class="act" id="lf-clear" style="border:0;background:none;color:var(--accent);font-weight:600;padding:0 0 0 6px">change</button></small>` : ''}</div>
      <ul class="suggest" id="lf-sug" hidden></ul>
      <p class="empty" id="lf-nosearch" style="font-size:12.5px;margin:-4px 0 10px" ${state.searchDown ? '' : 'hidden'}>Live suggestions are not available here. Press Enter to search, or type the name and drop a pin.</p>
      ${placed ? '' : `<div class="actions" style="margin:0 0 14px"><button type="button" class="btn sm" id="lf-pin">${ICON.pin} Drop a pin on the map</button><button type="button" class="btn sm" id="lf-gps">Use my location</button></div>`}
      <div class="field"><label>Kind</label><div class="seg" id="lf-kind">${Object.entries(KINDS).filter(([k]) => k !== 'other').map(([k, v]) => `<button type="button" data-k="${k}" aria-pressed="${d.kind === k}">${v.label}</button>`).join('')}</div></div>
      <div class="field"><label>Status</label><div class="seg" id="lf-status"><button type="button" data-s="been" aria-pressed="${d.status === 'been'}">Been</button><button type="button" data-s="want" aria-pressed="${d.status === 'want'}">Want to try</button></div></div>
      <div class="two" id="lf-been" ${d.status === 'been' ? '' : 'hidden'} style="display:${d.status === 'been' ? 'grid' : 'none'};grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">
        <div class="field" style="margin:0"><label>Rating</label><div class="rate" id="lf-rate">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-r="${n}" class="${n <= d.rating ? 'on' : ''}" aria-label="${n} star${n > 1 ? 's' : ''}">★</button>`).join('')}</div></div>
        <div class="field" style="margin:0"><label for="lf-date">When</label><input type="date" id="lf-date" value="${esc(d.at || today())}"></div>
      </div>
      <div class="field"><label for="lf-note">Note</label><textarea id="lf-note" rows="2" placeholder="What to order, who to bring, what to skip">${esc(d.note || '')}</textarea></div>
      <div class="actions"><button type="submit" class="btn primary">${d.id ? 'Save changes' : 'Save spot'}</button><button type="button" class="btn" id="lf-cancel">Cancel</button>${d.id ? '' : (!placed ? `<span style="font-size:12.5px;color:var(--muted);align-self:center">Without a pin it lands in the middle of ${esc(d.sub || d.hood || 'the map')}.</span>` : '')}</div>
    </form>`;
    const form = panel.querySelector('#logform'), qi = panel.querySelector('#lf-q'), sug = panel.querySelector('#lf-sug');
    qi.addEventListener('input', () => { d.name = qi.value; if (placed && d.src === 'search') return; clearTimeout(sugTimer); const v = qi.value.trim(); if (v.length < 2) { sug.hidden = true; return; } sugTimer = setTimeout(() => suggest(v, sug, qi, false), 280); });
    qi.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(sugTimer); const first = sug.querySelector('[data-i]'); if (first && !sug.hidden) first.click(); else if (qi.value.trim().length >= 2 && !(placed && d.src === 'search')) suggest(qi.value.trim(), sug, qi, true); } });
    panel.querySelectorAll('#lf-kind [data-k]').forEach(b => b.addEventListener('click', () => { d.kind = b.dataset.k; panel.querySelectorAll('#lf-kind [data-k]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); }));
    panel.querySelectorAll('#lf-status [data-s]').forEach(b => b.addEventListener('click', () => { d.status = b.dataset.s; panel.querySelectorAll('#lf-status [data-s]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); panel.querySelector('#lf-been').style.display = d.status === 'been' ? 'grid' : 'none'; }));
    panel.querySelectorAll('#lf-rate [data-r]').forEach(b => b.addEventListener('click', () => { d.rating = d.rating === +b.dataset.r ? 0 : +b.dataset.r; panel.querAll = null; panel.querySelectorAll('#lf-rate [data-r]').forEach(x => x.classList.toggle('on', +x.dataset.r <= d.rating)); }));
    panel.querySelector('#lf-date').addEventListener('change', e => d.at = e.target.value || today());
    panel.querySelector('#lf-note').addEventListener('input', e => d.note = e.target.value);
    panel.querySelector('#lf-cancel').addEventListener('click', cancelLog);
    const clr = panel.querySelector('#lf-clear'); if (clr) clr.addEventListener('click', () => { d.lon = d.lat = d.x = d.y = null; d.where = ''; d.src = null; renderLogForm(); });
    const pin = panel.querySelector('#lf-pin'); if (pin) pin.addEventListener('click', () => { state.placing = true; state.pending = null; stage.classList.add('placing'); if (isPhone()) sheet.set('peek'); toast('Tap the map where it is', 3200); map.redraw(); });
    const gps = panel.querySelector('#lf-gps'); if (gps) gps.addEventListener('click', () => locate(pos => { const [x, y] = Geom.proj(pos); const w = locateXY(x, y); Object.assign(d, { lon: pos[0], lat: pos[1], x, y, hood: w.hood || d.hood, sub: w.sub, src: 'gps', where: 'Your location' }); renderLogForm(); }));
    form.addEventListener('submit', e => { e.preventDefault(); saveDraft(); });
  }
  async function suggest(v, sug, qi, explicit) {
    const my = ++sugCtrl, d = state.draft; let res = [];
    const bias = d.hood ? (() => { const bb = map.hoodBBox(IDX[d.hood]); return Geom.unproj((bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2); })() : null;
    try { res = await window.Places.search(v, bias, { explicit }); } catch (e) { if (e.name === 'AbortError') return; sug.hidden = true; if (!state.searchDown) { state.searchDown = true; const n = panel.querySelector('#lf-nosearch'); if (n) n.hidden = false; } return; }
    if (window.Places.search.photonDown && !state.searchDown) { state.searchDown = true; const n = panel.querySelector('#lf-nosearch'); if (n) n.hidden = false; }
    if (my !== sugCtrl || !state.draft || state.view !== 'log') return;
    if (!res.length) { sug.hidden = true; return; }
    sug.hidden = false; sug.innerHTML = res.map((r, i) => `<li><button type="button" data-i="${i}"><span><b>${esc(r.name)}</b><small>${esc(r.where)}</small></span><span class="k">${esc(r.osm)}</span></button></li>`).join('');
    sug.querySelectorAll('[data-i]').forEach(b => b.addEventListener('click', () => { const r = res[+b.dataset.i], [x, y] = Geom.proj([r.lon, r.lat]), w = locateXY(x, y); Object.assign(d, { name: r.name, lon: r.lon, lat: r.lat, x, y, where: r.where, src: 'search', hood: w.hood || d.hood, sub: w.sub, kind: r.kind || d.kind }); renderLogForm(); }));
  }
  function placePending(xy) {
    const [x, y] = xy, [lon, lat] = Geom.unproj(x, y), w = locateXY(x, y), d = state.draft;
    state.placing = false; stage.classList.remove('placing');
    if (!d) { state.draft = { id: null, name: '', kind: 'food', status: 'been', rating: 0, note: '', at: today(), lon, lat, x, y, hood: w.hood, sub: w.sub, src: 'pin', where: '' }; }
    else Object.assign(d, { lon, lat, x, y, hood: w.hood || d.hood, sub: w.sub, src: 'pin', where: '' });
    state.pending = { x, y };
    go(state.loc, { view: 'log', fly: false, replace: true, sheet: isPhone() ? 'full' : undefined });
  }
  function stopPlacing() { state.placing = false; state.pending = null; stage.classList.remove('placing'); map.redraw(); }
  function cancelLog() { const d = state.draft; state.draft = null; stopPlacing(); if (d && d.id) go({ spot: d.id }, { replace: true, fly: false }); else go(state.loc, { replace: true, fly: false }); }
  async function saveDraft() {
    const d = state.draft; if (!d) return; const name = (d.name || '').trim(); if (!name) { panel.querySelector('#lf-q').focus(); return; }
    if (d.lon == null) { // no pin: the centre of the section, or the neighborhood
      let x, y; if (d.hood && d.sub && subByName(d.hood, d.sub)) [x, y] = subByName(d.hood, d.sub).c; else if (d.hood) { const h = HOODS[IDX[d.hood]]; x = h.cx; y = h.cy; } else { const c = map.cam; x = c.x + c.w / 2; y = c.y + c.w * map.H / map.W / 2; }
      x += (Math.random() - .5) * 0.6; y += (Math.random() - .5) * 0.6; const [lon, lat] = Geom.unproj(x, y); const w = locateXY(x, y); Object.assign(d, { lon, lat, x, y, hood: w.hood || d.hood, sub: w.sub || d.sub, src: 'approx' });
    }
    const id = d.id || ('s' + Date.now().toString(36));
    state.spots[id] = { name: name.slice(0, 80), kind: KINDS[d.kind] ? d.kind : 'other', status: d.status === 'want' ? 'want' : 'been', rating: d.status === 'been' ? (d.rating | 0) : 0, note: (d.note || '').trim().slice(0, 400), lon: +d.lon.toFixed(5), lat: +d.lat.toFixed(5), hood: d.hood, sub: d.sub || null, at: d.at || today(), where: (d.where || '').slice(0, 120), src: d.src || null };
    state.draft = null; state.pending = null; state.placing = false; stage.classList.remove('placing');
    toast(d.id ? 'Saved' : `${name} logged`); setSaveState('Saving…'); const ok = await persist(); go({ spot: id }, { replace: true }); if (ok !== false) setSaveState('Saved');
  }
  async function removeSpot(id) { const sp = state.spots[id]; if (!sp) return; delete state.spots[id]; go({ hood: sp.hood, sub: sp.sub }, { replace: true, fly: false }); map.redraw(); await persist(); toast(`${sp.name} removed`); }

  // ---------- where am I ----------
  function locate(onPos) {
    const btn = $('locate');
    if (!navigator.geolocation) { toast('Location is not available here', 3000); return; }
    btn.classList.add('busy');
    navigator.geolocation.getCurrentPosition(pos => {
      btn.classList.remove('busy'); const lon = pos.coords.longitude, lat = pos.coords.latitude, [LON0, LAT0, LON1, LAT1] = G.bbox;
      if (lon < LON0 || lon > LON1 || lat < LAT0 || lat > LAT1) { toast('You are outside the map', 3000); return; }
      const [x, y] = Geom.proj([lon, lat]); map.setMe([x, y]);
      if (onPos) { onPos([lon, lat]); return; }
      const w = locateXY(x, y);
      if (w.hood) { toast('You are in ' + (w.sub ? w.sub + ', ' + w.hood : w.hood), 3000); go(w.sub ? { hood: w.hood, sub: w.sub } : { hood: w.hood }, { fromMap: true }); }
      else { toast('You are here', 3000); map.flyTo([x - .01, y - .01, x + .01, y + .01], 1, NX * 0.08); }
    }, err => {
      btn.classList.remove('busy'); const framed = window.top !== window.self;
      if (err.code === 1 && framed) toast('Location is blocked inside this frame. Open the app on its own.', 3600); else toast(err.code === 1 ? 'Location permission was refused' : 'Could not get a location', 3000);
    }, { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 });
  }
  $('locate').addEventListener('click', () => locate());

  // ---------- suggest & quiz ----------
  function surprise() {
    let pool = HOODS.map((h, i) => i).filter(i => inRegion(i) && (state.filters.size ? matches(i) : true));
    const fresh = pool.filter(i => !isDone(i)); if (fresh.length) pool = fresh;
    pool = pool.filter(i => HOODS[i].name !== state.loc.hood); if (!pool.length) return;
    go({ hood: HOODS[pool[Math.floor(Math.random() * pool.length)]].name });
  }
  function startQuiz() {
    const pool = NAMES.filter(n => inRegion(IDX[n])), rounds = Math.min(10, pool.length);
    const order = pool.slice(); for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    state.quiz = { order: order.slice(0, rounds), rounds, round: 0, score: 0, locked: false, lit: null, region: state.loc.region };
    map.setState({ quiz: true, sel: -1, selSub: -1 }); recolor(true); go({ region: state.loc.region }, { keepQuiz: true, replace: true, sheet: isPhone() ? 'half' : undefined });
  }
  function endQuiz(silent) { state.quiz = null; map.setState({ quiz: false }); recolor(true); if (!silent) go({ region: state.loc.region }, { replace: true }); }
  function renderQuiz(verdict) {
    const qz = state.quiz; if (!qz) return;
    if (qz.round >= qz.rounds) {
      const s = qz.score, rank = s >= 10 ? 'Muni operator' : s >= 8 ? 'Certified local' : s >= 5 ? 'Transplant, two years in' : s >= 2 ? 'Tourist with a good map' : 'Just landed at SFO';
      setHead({ eyebrow: 'Where is it?', title: `${s} out of ${qz.rounds}`, onBack: () => endQuiz(), tools: [] });
      panel.innerHTML = `<div class="quiz"><p class="verdict good">${rank}</p><p class="lead">${s === qz.rounds ? 'Perfect. You could give the fog directions.' : 'Play again to meet the ones you missed.'}</p><div class="actions"><button type="button" class="btn primary" id="again">Play again</button><button type="button" class="btn" id="done">Back to the map</button></div></div>`;
      panel.querySelector('#again').addEventListener('click', startQuiz); panel.querySelector('#done').addEventListener('click', () => endQuiz()); return;
    }
    const target = qz.order[qz.round];
    setHead({ eyebrow: `Where is it? · ${qz.round + 1} of ${qz.rounds}`, title: esc(target), onBack: () => endQuiz(), tools: [] });
    panel.innerHTML = `<div class="quiz"><div class="score">Score ${qz.score}</div><div class="bar"><i style="width:${(qz.round / qz.rounds) * 100}%"></i></div><p class="verdict ${verdict ? verdict.cls : ''}">${verdict ? verdict.text : 'Tap it on the map.'}</p><p style="color:var(--muted);margin:0">Hint: ${esc(INFO[target].line)}</p><div class="actions" style="margin-top:14px">${verdict ? '<button type="button" class="btn primary" id="next">Next</button>' : ''}<button type="button" class="btn quiet" id="quit">Quit</button></div></div>`;
    const nx = panel.querySelector('#next'); if (nx) nx.addEventListener('click', nextRound); panel.querySelector('#quit').addEventListener('click', () => endQuiz());
  }
  function answer(name) {
    const qz = state.quiz; if (!qz || qz.locked) return; const target = qz.order[qz.round]; qz.locked = true; qz.lit = target; recolor(true); map.setState({ sel: IDX[target] });
    if (name === target) { qz.score++; renderQuiz({ cls: 'good', text: 'Yes. That is ' + target + '.' }); } else renderQuiz({ cls: 'bad', text: `No, that is ${name}. ${target} is lit up now.` });
    if (isPhone() && sheet.detent === 'peek') sheet.set('half');
  }
  function nextRound() { const qz = state.quiz; qz.round++; qz.locked = false; qz.lit = null; recolor(true); map.setState({ sel: -1 }); renderQuiz(); }

  // ---------- boot ----------
  window.HPP = []; window.HP.forEach(h => { window.HPP[IDX[h.name]] = h.polys.map(poly => poly.map(ring => ring.map(Geom.proj))); });
  function start(saved) {
    renderLenses(); recolor(false);
    const fromHash = (saved && saved.loc) || parseHash(location.hash);
    loadLocal(); // spots must be known before a #spot-- link can resolve
    state.loc = normalize(fromHash); state.bootLoc = fromHash.spot && !state.loc.spot ? fromHash : null;
    sheet.set(isPhone() ? (level(state.loc) >= 2 ? 'half' : 'peek') : 'full', { instant: true, quiet: true });
    map.setState({ region: state.loc.region, sel: state.loc.hood ? IDX[state.loc.hood] : -1, selSub: state.loc.sub ? subIndex(state.loc.hood, state.loc.sub) : -1 });
    try { if (!state.bootLoc) history.replaceState({ loc: state.loc }, '', location.pathname + location.search + hashOf(state.loc)); } catch (e) {}
    render();
    { // synchronously, so the very first frame is already the fitted view
      const l = state.loc; const v = l.hood ? null : map.fitView(...map.regionBBox(l.region), l.region === 'all' ? 1.03 : 1.06, 0); if (v) { map.jumpTo(v); } else { const bb = map.regionBBox(l.region); map.jumpTo(map.fitView(bb[0], bb[1], bb[2], bb[3], 1.06, 0)); flyToLoc(900); }
    }
    connectStore();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => map.redraw());
  }
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { map.refreshPalette(); recolor(false); });
  window.addEventListener('resize', () => { map.resize(); map.redraw(); }); // resize() also catches a devicePixelRatio change (browser zoom)
  window.__sbs = { map, state, go, sheet }; // for tests and the console
  window.claude?.hot?.snapshot?.(() => ({ loc: state.loc }));
  window.claude?.hot?.ready ? window.claude.hot.ready(start) : start(window.claude?.hot?.data ?? {});
})();
