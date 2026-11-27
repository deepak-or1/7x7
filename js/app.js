// Seven by Seven — the app: one place in a hierarchy (the map › region › neighborhood › section › spot; the regions are the
// Bay Area's six and, far outside it, the Las Vegas Strip),
// a logbook that follows it, and a tracker saved per person.
(function () {
  const $ = id => document.getElementById(id);
  // lookup tables and the log's maps have no prototype: a name from a link or from the shared log ('constructor', '__proto__') finds nothing
  const bare = o => { const out = Object.create(null); if (o && typeof o === 'object') for (const k of Object.keys(o)) if (k !== '__proto__') out[k] = o[k]; return out; };
  const G = window.GEO, HOODS = G.hoods, INFO = window.INFO, VIBES = window.VIBES, REGIONS = bare(window.REGIONS), SHORT = window.SHORT, MOODS = window.MOODS, FOG_WORDS = window.FOG_WORDS;
  const NX = G.nx, NY = G.ny, Geom = window.Geom, U = 400; // U: zoom limits are tuned in map units, where the first (SF-and-close-Bay) canvas was 400 wide
  const IDX = bare(Object.fromEntries(HOODS.map((h, i) => [h.name, i])));
  const NAMES = HOODS.map(h => h.name).sort((a, b) => a.localeCompare(b));
  const REGION_N = Object.fromEntries(Object.keys(REGIONS).map(r => [r, HOODS.filter(h => r === 'all' || h.region === r).length]));
  const slug = n => String(n).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const BY_SLUG = bare(Object.fromEntries(NAMES.map(n => [slug(n), n])));
  const ft = m => Math.round(m * 3.28084);
  // Areas: the Bay Area, and each away region (REGIONS[key].away: the Las Vegas Strip), which the map draws at its true position,
  // far outside the Bay canvas. areaKey: a region's area; AREA_MAX: the highest point per area (the Hills lens ramps within one area)
  const AWAY = Object.keys(REGIONS).filter(r => REGIONS[r].away && G.regions[r]), areaKey = r => AWAY.includes(r) ? r : 'bay';
  const AREA_MAX = {}; HOODS.forEach(h => { const a = areaKey(h.region); AREA_MAX[a] = Math.max(AREA_MAX[a] || 0, h.max); });
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const attr = o => esc(JSON.stringify(o)); // for data-go='...' (names like Blackie's Pasture)
  const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }; // the local calendar day (toISOString is UTC: a day off in the evening or the early morning). Dates written by older code may be that UTC date, a day ahead in the evening, which is why js/lookback.js accepts stored dates up to tomorrow
  const niceDate = iso => { if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}(?:$|T)/.test(iso)) return ''; const d = new Date(iso.slice(0, 10) + 'T12:00:00'); return isNaN(d) ? '' : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }; // only a real date: this goes into HTML, and the log's dates are anyone's to write
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const KINDS = bare({ food: { label: 'Food', c: 'var(--k-food)', e: '🍜' }, drink: { label: 'Drinks', c: 'var(--k-drink)', e: '🍸' }, coffee: { label: 'Coffee', c: 'var(--k-coffee)', e: '☕' }, view: { label: 'View', c: 'var(--k-view)', e: '🌄' }, shop: { label: 'Shop', c: 'var(--k-shop)', e: '🛍️' }, park: { label: 'Park', c: 'var(--k-park)', e: '🌳' }, other: { label: 'Other', c: 'var(--k-other)', e: '📍' } });
  const VIBE_E = { fog: '🌫️', hills: '⛰️', water: '🌊', sun: '☀️', buzz: '✨', green: '🌿' }; // the cover emoji of a place and its sections
  const VERDICT = ['', 'Skip it', 'Meh', 'Solid', 'Great', 'Loved it']; // a spot's rating, in words
  const LENSES = { vibe: { label: 'Character', sub: 'Six kinds of place' }, fog: { label: 'Fog', sub: 'Sunbelt to permanent cloud' }, elev: { label: 'Hills', sub: 'Sea level to the summits' }, done: { label: 'Been', sub: 'Where you have been' } };
  const STAMPS = [
    { id: 'first', label: 'First steps', test: s => s.n >= 1, icon: '1' }, { id: 'ten', label: 'Ten down', test: s => s.n >= 10, icon: '10' },
    { id: 'half', label: 'Half the city', test: s => s.sf >= Math.ceil(REGION_N.sf / 2), icon: '½' }, { id: 'all', label: 'Whole city', test: s => s.sf >= REGION_N.sf, icon: String(REGION_N.sf) },
    { id: 'gg', label: 'Over the Golden Gate', test: s => s.marin >= 1, icon: 'GG' }, { id: 'bb', label: 'Over the Bay Bridge', test: s => s.east >= 1, icon: 'BB' },
    { id: 'marin', label: 'All of Marin', test: s => s.marin >= REGION_N.marin, icon: 'M' }, { id: 'east', label: 'Whole East Bay', test: s => s.east >= REGION_N.east, icon: 'E' },
    { id: 'south', label: 'Down the Peninsula', test: s => s.penin >= 1, icon: '280' }, { id: 'penin', label: 'Whole Peninsula', test: s => s.penin >= REGION_N.penin, icon: 'P' },
    { id: 'sj', label: 'Down to the South Bay', test: s => s.south >= 1, icon: 'SJ' }, { id: 'southbay', label: 'Whole South Bay', test: s => s.south >= REGION_N.south, icon: 'SB' },
    { id: 'nb', label: 'Up to the North Bay', test: s => s.north >= 1, icon: 'N' }, { id: 'north', label: 'Whole North Bay', test: s => s.north >= REGION_N.north, icon: 'NB' },
    { id: 'lv', label: 'Viva Las Vegas', test: s => s.vegas >= 1, icon: 'LV' }, { id: 'vegas', label: 'Whole Strip', test: s => s.vegas >= REGION_N.vegas, icon: '♠' },
    { id: 'bay', label: 'The whole map', test: s => s.n >= REGION_N.all, icon: '∞' },
    { id: 'sun', label: 'Sun belt', test: s => s.vibe.sun, icon: '☀' }, { id: 'fog', label: 'Fog belt', test: s => s.vibe.fog, icon: '☁' }, { id: 'hills', label: 'Hill climber', test: s => s.vibe.hills, icon: '▲' },
    { id: 'water', label: 'Shoreline', test: s => s.vibe.water, icon: '≈' }, { id: 'buzz', label: 'Night owl', test: s => s.vibe.buzz, icon: '♪' }, { id: 'green', label: 'Park ranger', test: s => s.vibe.green, icon: '✿' },
    { id: 'summit', label: 'Summiteer', test: s => s.ft >= 5000, icon: '5k' }, { id: 'mtn', label: 'Mountaineer', test: s => s.ft >= 15000, icon: '15k' },
  ];
  const ICON = {
    back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>', // the header's X: the old log tool's plus, turned 45 degrees
    check: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    star: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 2h8v12l-4-3.2L4 14z" fill="#fff"/></svg>', // want to go: a bookmark (the gold star is a friend's pick)
    pin: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6-5.3-6-11a6 6 0 0 1 12 0c0 5.7-6 11-6 11z"/><circle cx="12" cy="10" r="2.2"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  };

  // ---------- state ----------
  const state = { loc: { region: 'all', hood: null, sub: null, spot: null }, view: null, lens: 'vibe', filters: new Set(), query: '', showAll: true, theme: 'system', done: bare(), want: bare(), spots: bare(), placing: false, pending: null, draft: null, canWrite: true, store: 'none', quiz: null, hover: -1 };
  try { const s = JSON.parse(localStorage.getItem('sbs-prefs-v3') || localStorage.getItem('sbs-prefs-v2') || '{}'); if (LENSES[s.lens || s.mode]) state.lens = s.lens || s.mode; if (s.showAll === false) state.showAll = false; if (s.theme === 'light' || s.theme === 'dark') state.theme = s.theme; if (AWAY.includes(s.area)) state.lastArea = s.area; state.map3d = s.map3d === true; } catch (e) {}
  const savePrefs = () => { try { localStorage.setItem('sbs-prefs-v3', JSON.stringify(Object.assign({ lens: state.lens, showAll: state.showAll, theme: state.theme, area: areaKey(state.loc.region) }, state.map3d ? { map3d: true } : null))); } catch (e) {} }; // area: the app opens in the area it was left in; map3d: the 3D map (beta), kept only while it is on
  function applyTheme() { if (state.theme === 'light' || state.theme === 'dark') document.documentElement.setAttribute('data-theme', state.theme); else document.documentElement.removeAttribute('data-theme'); syncThemeColor(); if (window.StreetMap) StreetMap.restyle(); }
  // the browser / PWA status band follows the theme the page actually shows: the paper tone at the top of the map
  function syncThemeColor() { const c = getComputedStyle(document.documentElement).getPropertyValue('--land-other').trim(); if (c) document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.setAttribute('content', c)); } // both metas (their media attributes only matter before this runs)
  applyTheme();
  const isDone = i => !!state.done[slug(HOODS[i].name)];
  const isWant = i => !!state.want[slug(HOODS[i].name)];
  const inRegion = (i, r = state.loc.region) => r === 'all' || HOODS[i].region === r;
  const isPhone = () => window.innerWidth <= 880;
  // ---------- who is using this device ----------
  // No accounts (anyone with the link writes the log), so each device may give a name: asked once, before its first write to a
  // shared log, and changed later in Settings. null in storage: never asked; '': skipped. The device id tells this device's
  // feed events from the others' (names can repeat or change).
  const WHO_MAX = 24, cleanName = s => (typeof s === 'string' ? s : '').replace(/[\x00-\x1f\x7f]/g, '').replace(/\s+/g, ' ').trim().slice(0, WHO_MAX);
  const who = () => { try { return cleanName(localStorage.getItem('sbs-who')); } catch (e) { return ''; } };
  let whoSet = false; // asked this session: a browser without the dialog, or storage that will not keep the answer, is not asked again until reload
  const whoAsked = () => { if (whoSet) return true; try { return localStorage.getItem('sbs-who') !== null; } catch (e) { return true; } };
  const setWho = n => { whoSet = true; try { localStorage.setItem('sbs-who', cleanName(n)); } catch (e) {} };
  const deviceId = (() => { let d = null; try { d = localStorage.getItem('sbs-dev'); } catch (e) {} if (!d || !/^[a-z0-9]{8,40}$/.test(d)) { d = (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '') : Math.random().toString(36).slice(2) + Date.now().toString(36)).slice(0, 24); try { localStorage.setItem('sbs-dev', d); } catch (e) {} } return d; })();

  // ---------- map ----------
  const stage = $('stage'), canvas = $('map'), panel = $('panel'), head = $('head'), sheetEl = $('sheet'), tip = $('tip');
  const spotList = () => { const out = []; for (const id in state.spots) { const sp = state.spots[id]; if (!sp._xy) sp._xy = Geom.proj([sp.lon, sp.lat]); out.push({ id, x: sp._xy[0], y: sp._xy[1], c: (KINDS[sp.kind] || KINDS.other).c, name: sp.name, status: sp.status || 'been', hood: sp.hood }); } if (state.pending) out.push({ id: 'pending', x: state.pending.x, y: state.pending.y, c: 'var(--accent)', name: '', status: 'pending' }); return out; };
  const marksFor = () => HOODS.map((h, i) => isDone(i) ? 'flag' : isWant(i) ? 'star' : null);
  const matches = i => { if (!inRegion(i)) return false; const info = INFO[HOODS[i].name]; for (const t of state.filters) if (!info.tags.includes(t)) return false; return true; };
  // the 3D map (beta) when it was asked for (index.html) and can run here (js/map3d.js: three.js loaded, WebGL), else the flat map
  const mapEngine = (c, o) => { let m = null; try { m = window.SBS_MAP3D && window.MapView3D && window.MapView3D(c, o); } catch (e) { console.error('3D map: ' + (e && e.stack || e)); c.hidden = false; c.parentElement.querySelectorAll('.m3d, .m3d-north').forEach(el => el.remove()); } return m || window.MapView(c, o); }; // whatever the 3D map throws, the flat map
  const map3dOff = () => { try { return !!sessionStorage.getItem('sbs-map3d-off'); } catch (e) { return false; } }; // the 3D map failed here this session and came back as the flat map
  const map = mapEngine(canvas, {
    // framing: above the phone sheet; the desktop clear of the search pill (top left) and the control capsule (a column beside the
    // logbook). The phone frames across the full width, and in the column left of its capsule only when the shape would run under
    // it (insetClear, set by frame())
    insets() { const c = document.querySelector('#ctl .stack').getBoundingClientRect(), right = Math.max(0, window.innerWidth - c.left) + 8; if (isPhone()) return { top: sheet && sheet.detent === 'full' ? 0 : Math.max(c.top + 4, insetPill ? $('areas').getBoundingClientRect().bottom + 8 : 0), right: insetClear ? right : 0, bottom: (sheet ? sheet.visible : 0) + 12, left: 0 }; return { top: document.querySelector('.top .search').getBoundingClientRect().bottom + 10, right, bottom: 12, left: 0 }; },
    spots: spotList, marks: marksFor, selectedSpot: () => state.loc.spot,
    alphaFor(i) { if (state.quiz) return 1; const filtered = state.filters.size > 0 && !matches(i) ? .25 : 1; const veil = !state.showAll && state.lens !== 'done' && !isDone(i) ? .35 : 1; return filtered * veil; },
    onTap, onHover, onGestureStart() { fingerOn = true; mapBusyT = fingerT = performance.now(); closeLenses(); openAreas(false); }, onGestureEnd() { fingerOn = false; mapBusyT = performance.now(); }, onMove() { mapBusyT = fingerT = performance.now(); }, // (the map in use: the street map waits, streetGate)
    // the floating chrome (the control capsule; the search field, which on the phone sits in the capsule's top slot) reserves its footprint so map labels avoid it
    occluders() { if (isPhone() && document.documentElement.classList.contains('sheet-full')) return []; return ['.top .search', '#ctl .stack', '#areas'].map(s => document.querySelector(s)).filter(el => el && el.offsetParent !== null && getComputedStyle(el).opacity !== '0').map(el => el.getBoundingClientRect()).filter(b => b.height > 0).map(b => [b.left - 4, b.top - 4, b.right + 4, b.bottom + 4]); },
  });

  // each area's lon/lat box (the Bay canvas; an away area's camera box, which is its places plus a margin), for "am I on the map"
  // and place search
  const BOXES = map.areas.map(a => { if (a.id === 'bay') return { area: 'bay', b: G.bbox }; const sw = Geom.unproj(a.r[0], a.r[3]), ne = Geom.unproj(a.r[2], a.r[1]); return { area: a.id, b: [sw[0], sw[1], ne[0], ne[1]] }; });
  const boxAt = (lon, lat) => BOXES.find(({ b }) => lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3]) || null;

  // the colour a place is drawn in under the Character lens: its kind's, unless it carries a tone of its own (the Strip's stretches)
  const toneOf = name => INFO[name].tone || VIBES[INFO[name].vibe].cls;
  function colorFor(i) {
    const h = HOODS[i], info = INFO[h.name];
    if (state.quiz) return quizFill(h.name);
    if (state.lens === 'vibe') return `var(--${toneOf(h.name)})`;
    if (state.lens === 'fog') return `var(--fog${info.fog})`;
    if (state.lens === 'elev') { const low = REGIONS[h.region].low ? REGIONS[h.region].low.m : 0; return `var(--hill${1 + Math.min(4, Math.floor(Math.sqrt(Math.max(0, h.max - low) / (AREA_MAX[areaKey(h.region)] - low)) * 5))})`; } // from the area's floor (sea level, or an away region's own) to its highest point
    return isDone(i) ? 'var(--accent)' : 'var(--grey-fill)';
  }
  const recolor = animate => map.setColors(HOODS.map((h, i) => colorFor(i)), animate && !reduceMotion);

  // ---------- sheet ----------
  // canDismiss: something is open that a swipe down may close (never the log form, a pin drop, the name or join dialog, search or the quiz)
  const dialogOpen = () => !!document.querySelector('dialog[open]');
  const canDismiss = () => isPhone() && !state.quiz && !state.query && !state.placing && state.view !== 'log' && !dialogOpen() && (!!state.view || level(state.loc) > 0);
  const sheet = window.Sheet(sheetEl, { grip: $('grip'), head, panel, canDismiss, onDismiss: () => dismiss(), onChange(detent, vis, o) { if (o && (o.resize || o.quiet)) return; if (isPhone() && detent !== 'full' && document.documentElement.classList.contains('searching')) { q.blur(); endSearch(); } if (isPhone() && detent !== 'full' && !map.userMoved && !state.quiz) flyToLoc(); } }); // dragging the sheet down leaves search mode so the controls come back

  // ---------- navigation ----------
  const hoodOfSpot = id => state.spots[id] ? state.spots[id].hood : null;
  function normalize(l) {
    const out = { region: 'all', hood: null, sub: null, spot: null };
    if (l.spot && state.spots[l.spot]) { const sp = state.spots[l.spot]; out.spot = l.spot; out.hood = IDX[sp.hood] != null ? sp.hood : null; out.sub = out.hood && sp.sub || null; } // a hood name the map does not know (the log is anyone's to write) is no hood
    else if (l.hood && IDX[l.hood] != null) { out.hood = l.hood; out.sub = l.sub != null && subByName(l.hood, l.sub) ? l.sub : null; }
    if (out.hood) out.region = HOODS[IDX[out.hood]].region; else out.region = REGIONS[l.region] ? l.region : 'all';
    return out;
  }
  const subs = name => map.subs(IDX[name]) || [];
  const subByName = (hood, sub) => subs(hood).find(s => s.name === sub) || null;
  const subIndex = (hood, sub) => subs(hood).findIndex(s => s.name === sub);
  // starred sections ("star": "<reason>" in the sub-area data); a place is starred when any of its sections is
  const starOf = hood => subs(hood).some(s => s.star);
  let lastBurst = -Infinity;
  function celebrate(s) { // a tap opened a starred section: confetti over everything, and the reason in a toast
    const t = performance.now(); if (t - lastBurst < 1500) return; lastBurst = t;
    if (window.Confetti) window.Confetti.burst();
    toast('★ ' + s.star, 2000);
  }
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
  // history entries this page pushed carry this load's id and their depth, so a swipe down can step back to the screen the person
  // came from, and only when that screen is this app's (a deep link or a reload has nothing of ours behind it: one level up instead)
  const SESSION = Math.random().toString(36).slice(2), hDepth = () => history.state && history.state.s === SESSION ? history.state.n | 0 : 0;
  let goFly = false; // inside go(), before its camera fly: a street map mounts once the fly has landed
  function go(l, opts = {}) {
    const next = normalize(l), prev = state.loc;
    if (state.quiz && !opts.keepQuiz) endQuiz(true);
    if (state.placing && !opts.keepPlacing) stopPlacing();
    if (state.pending && opts.view !== 'log') { state.pending = null; map.redraw(); } // off the log form: its picked place's dot goes too
    state.loc = next; state.view = opts.view || null;
    if (areaKey(next.region) !== areaKey(prev.region)) savePrefs();
    if (opts.push !== false) { try { const url = location.pathname + location.search + hashOf(next), n = hDepth(); if (opts.replace || level(next) === level(prev) && next.hood === prev.hood && next.sub === prev.sub) history.replaceState({ loc: next, s: SESSION, n }, '', url); else history.pushState({ loc: next, s: SESSION, n: n + 1 }, '', url); } catch (e) {} }
    map.setState({ region: next.region, sel: next.hood ? IDX[next.hood] : -1, selSub: next.sub ? subIndex(next.hood, next.sub) : -1 });
    if (state.lens === 'done' || state.quiz) recolor(false);
    goFly = opts.fly !== false; render(); goFly = false;
    // settle the sheet first so the camera frames the place in the space that is left
    if (isPhone()) { const lv = level(next); if (opts.sheet) sheet.set(opts.sheet, { quiet: true }); else if (lv >= 2) { if (!opts.fromMap || sheet.detent === 'peek') sheet.set('half', { quiet: true }); } else if (opts.fromMap || lv < level(prev)) sheet.set('peek', { quiet: true }); } // up to a region or the whole map: back to map-first
    else panel.scrollTop = 0;
    if (opts.fly !== false) flyToLoc(opts.dur);
    // a tap on the map or a list that opens a starred section (never a hash load, back/forward, or a step up)
    if ((opts.fromMap || opts.tap) && !opts.view && next.sub && !next.spot && !(prev.hood === next.hood && prev.sub === next.sub)) { const s = subByName(next.hood, next.sub); if (s && s.star) celebrate(s); }
  }
  function up() { const l = state.loc; if (state.view) { go(l, { replace: true, fly: false }); return; } if (l.spot) go({ hood: l.hood, sub: l.sub }); else if (l.sub) go({ hood: l.hood }); else if (l.hood) go({ region: l.region }); else if (l.region !== 'all') go({ region: 'all' }); }
  // the phone's swipe down from half: back to the previous screen when it is ours, else one level up. go() then settles the sheet
  // where that screen wants it (the first screen and a region at the peek)
  // (a list opened from the same screen, like all spots, is not a step down: go() leaves the sheet as the drag left it, so it is set here)
  let backing = null; // dismiss() went back and waits for the popstate that answers it
  function dismiss() {
    if (state.view) { up(); if (isPhone()) sheet.set(level(state.loc) >= 2 ? 'half' : 'peek', { quiet: true }); return; }
    if (hDepth() < 1) { up(); return; }
    const was = state.loc, n = hDepth(), b = backing = { late: false }; history.back();
    // the popstate is late (else two navigations, and a history that no longer matches the panel). The history has stepped back
    // already: go where it is now, and the popstate that still comes moves nothing (after 5 s it is not waited for). It has not: only
    // settle the sheet, so it never stays mid-drag, and the popstate navigates when it comes. Either way one navigation.
    b.t = setTimeout(() => {
      if (state.loc !== was) return;
      if (hDepth() < n) { b.late = true; go((history.state && history.state.loc) || parseHash(location.hash), { push: false }); setTimeout(() => { if (backing === b) backing = null; }, 5000); }
      else sheet.set('half', { quiet: true });
    }, 600);
  }
  // phone: frame the selection across the full width, unless a vertex of its shape (or a corner of the capsule inside the shape)
  // would land under the capsule: then frame it again in the column left of the capsule
  // the same for the area switch (top left): a shape that would land under it is framed below it (insetPill)
  let insetClear = false, insetPill = false;
  function fitClear(bb, pad, minW, polys) {
    const fit = () => map.fitView(bb[0], bb[1], bb[2], bb[3], pad, minW); let v = fit();
    if (isPhone() && polys) {
      const under = el => { if (!el || !el.offsetParent) return false; const c = el.getBoundingClientRect(), k = map.W / v.w, x0 = c.left - 6, y0 = c.top - 6, x1 = c.right + 6, y1 = c.bottom + 6;
        if (map.is3d) return polys.some(poly => poly.some(ring => ring.some(([x, y]) => { const [sx, sy] = map.toScreen(x, y, v); return sx > x0 && sx < x1 && sy > y0 && sy < y1; }))) // the 3D map leans: it projects, and ray-casts, for the view asked about
          || [[x0, y0], [x0, y1], [x1, y0], [x1, y1]].some(([sx, sy]) => { const q = map.toMap(sx, sy, v); return Geom.inPolys(polys, q[0], q[1]); });
        return polys.some(poly => poly.some(ring => ring.some(([x, y]) => { const sx = (x - v.x) * k, sy = (y - v.y) * k; return sx > x0 && sx < x1 && sy > y0 && sy < y1; })))
          || [[x0, y0], [x0, y1], [x1, y0], [x1, y1]].some(([sx, sy]) => Geom.inPolys(polys, v.x + sx / k, v.y + sy / k)); };
      if (under($('areas'))) { insetPill = true; v = fit(); }
      if (under(document.querySelector('#ctl .stack'))) { insetClear = true; v = fit(); }
      insetClear = insetPill = false;
    }
    return v;
  }
  const frame = (bb, pad, minW, dur, polys) => map.flyToView(fitClear(bb, pad, minW, polys), dur);
  const regionPolys = r => AWAY.includes(r) ? HOODS.flatMap((h, i) => h.region === r ? window.HPP[i] : []) : null; // an away region is small enough to frame by its shape
  function flyToLoc(dur) {
    const l = state.loc;
    if (l.spot && state.spots[l.spot]) { const sp = state.spots[l.spot], [x, y] = sp._xy || Geom.proj([sp.lon, sp.lat]); frame([x - .01, y - .01, x + .01, y + .01], 1, U * 0.028, dur, [[[[x, y]]]]); return; }
    if (l.sub) { const s = subByName(l.hood, l.sub); if (s) { const pb = map.hoodBBox(IDX[l.hood]); frame(s.bbox, isPhone() ? 1.3 : 1.5, Math.max(U * 0.03, (s.bbox[2] - s.bbox[0]) * 3, (pb[2] - pb[0]) * .5), dur, (s.rings || []).map(r => [r])); return; } } // keep the parent place in view around a small section
    if (l.hood) { const ph = isPhone(); frame(map.hoodBBox(IDX[l.hood]), ph ? 1.25 : 1.75, U * (ph ? 0.06 : 0.08), dur, window.HPP[IDX[l.hood]]); return; }
    const rp = regionPolys(l.region); if (rp) { map.userMoved = false; frame(map.regionBBox(l.region), 1.06, 0, dur, rp); return; }
    map.flyTo(map.regionBBox(l.region), 1.06, 0, dur); // 'all' is the bay core box, padded like a region
  }
  window.addEventListener('popstate', e => { const b = backing; backing = null; if (b) { clearTimeout(b.t); if (b.late) return; } const l = (e.state && e.state.loc) || parseHash(location.hash); go(l, { push: false }); });

  // ---------- map callbacks ----------
  // a spot's dot opens the spot only from inside its own place (the place, a section or a spot there open), and always for a spot in
  // no place the map knows; anywhere else it stands for its place, so the tap (and the desktop hover) is the one that place gets there
  function dotHit(hit) {
    if (hit.type !== 'spot') return hit; const sp = state.spots[hit.id], i = sp ? IDX[sp.hood] : null;
    if (i == null || state.loc.hood === sp.hood) return hit;
    return { type: 'hood', i, hood: sp.hood, sub: map.hoodPx(i) > 300 ? subIndex(sp.hood, sp.sub) : -1 }; // a section as the place's own hit gives one (map.js hitTest)
  }
  function onTap(hit, sx, sy, downAt) {
    closeLenses();
    if (state.placing) { if (hit.type === 'water' || hit.type === 'hood' || hit.type === 'landmark' || hit.type === 'spot') placePending(hit.x != null ? [hit.x, hit.y] : map.toMap(sx, sy)); return; }
    if (state.quiz) { if (hit.type === 'hood' && !(downAt < state.quiz.askedAt)) answer(hit.hood); return; } // a tap that went down before this question was shown is not an answer to it
    const l = state.loc; hit = dotHit(hit);
    if (hit.type === 'spot') { go({ spot: hit.id }, { fromMap: true }); return; }
    if (hit.type === 'landmark') { toast(hit.landmark.name + ' · ' + hit.landmark.hood, 2600); if (l.hood !== hit.hood) go({ hood: hit.hood }, { fromMap: true, fly: false }); return; }
    if (hit.type === 'hood') {
      // phone, zoomed out: a place too small to aim at opens its region first
      if (isPhone() && !l.hood && map.hoodPx(hit.i) < 44 && l.region !== HOODS[hit.i].region) { go({ region: HOODS[hit.i].region }, { fromMap: true }); return; }
      const name = hit.hood, subName = hit.sub >= 0 ? subs(name)[hit.sub].name : null;
      if (l.hood === name) { if (subName && subName !== l.sub) go({ hood: name, sub: subName }, { fromMap: true }); else if (!subName && l.sub) go({ hood: name }, { fromMap: true }); else if (l.spot) go({ hood: name, sub: l.sub }, { fromMap: true }); else flyToLoc(); return; }
      go(subName && map.hoodPx(hit.i) > 420 ? { hood: name, sub: subName } : { hood: name }, { fromMap: true }); return;
    }
    if (hit.type === 'water') { if (level(l) > 0) up(); }
  }
  function onHover(hit, sx, sy) {
    if (!hit || isPhone()) { map.setHover(-1, -1, null); tip.classList.remove('on'); stage.classList.remove('pointing'); return; }
    const l = state.loc; if (!state.quiz && !state.placing) hit = dotHit(hit);
    if (hit.type === 'spot') { const sp = state.spots[hit.id]; map.setHover(-1, -1, hit.id); showTip(sx, sy, sp.name, (KINDS[sp.kind] || KINDS.other).label + ' · ' + (sp.sub || sp.hood)); stage.classList.add('pointing'); return; }
    if (hit.type === 'landmark') { map.setHover(-1, -1, null); showTip(sx, sy, hit.landmark.name, hit.landmark.hood); stage.classList.add('pointing'); return; }
    if (hit.type === 'hood') {
      const i = hit.i, name = hit.hood, s = hit.sub >= 0 ? subs(name)[hit.sub] : null;
      map.setHover(i, hit.sub, null); stage.classList.add('pointing');
      if (state.quiz) { tip.classList.remove('on'); if (!quizMap.pick(i)) { map.setHover(-1, -1, null); stage.classList.remove('pointing'); } return; } // locked on an answer: nothing to point at (but the green place, which is Next after a miss)
      if (s && (l.hood === name || map.hoodPx(i) > 420)) showTip(sx, sy, s.name, name);
      else showTip(sx, sy, name, isDone(i) ? 'Been ✓' : isWant(i) ? 'Want to go' : INFO[name].line);
      return;
    }
    map.setHover(-1, -1, null); tip.classList.remove('on'); stage.classList.remove('pointing');
  }
  function showTip(x, y, main, sub) { tip.innerHTML = `${esc(main)}${sub ? `<small>${esc(sub)}</small>` : ''}`; tip.style.left = x + 'px'; tip.style.top = y + 'px'; tip.classList.add('on'); }
  let toastTimer = null;
  // action (optional): { label, run } adds one button; the toast is tappable only while it shows one
  function toast(t, ms = 2200, action) {
    const el = $('toast'); el.textContent = t; el.classList.toggle('act', !!action);
    if (action) { const s = document.createElement('span'), b = document.createElement('button'); s.textContent = t; b.type = 'button'; b.textContent = action.label; b.addEventListener('click', () => { el.classList.remove('on'); clearTimeout(toastTimer); action.run(); }); el.replaceChildren(s, b); } // the text in a span, so a long line shrinks and the button never does
    el.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('on'), ms);
  }

  // ---------- chrome: the path, lenses and their legend, search ----------
  // the path to where you are, the current item left out (it is the title under it): each crumb opens its level
  function crumbsOf(l) {
    const c = [{ label: AWAY.includes(l.region) ? 'Home' : 'Bay Area', loc: { region: 'all' } }]; // the first screen: the Bay Area, unless the path leads out of it
    if (l.region !== 'all') c.push({ label: REGIONS[l.region].label, loc: { region: l.region } });
    if (l.hood) c.push({ label: l.hood, loc: { hood: l.hood } });
    if (l.sub) c.push({ label: l.sub, loc: { hood: l.hood, sub: l.sub } });
    if (l.spot && state.spots[l.spot]) c.push({ label: state.spots[l.spot].name, loc: { spot: l.spot } });
    return c.slice(0, -1);
  }
  // the header's small line, built to fit by measuring: more than three crumbs keep the first and the last two; the kind tag after
  // the path (a spot's kind, a section's star) moves to the panel's .kbody line when it does not fit; then middle crumbs fold into
  // a '…' crumb (it opens the first level it hides); last, the last crumb ends in an ellipsis. Run after every render and resize.
  function fitHead() {
    const eb = head.querySelector('.eyebrow'), P = head._path; if (!eb || !P) return;
    const cr = P.crumbs, body = panel.querySelector('.kbody'), over = () => eb.scrollWidth > eb.clientWidth + 1;
    let idx = cr.length > 3 ? [0, cr.length - 2, cr.length - 1] : cr.map((c, i) => i), tag = !!P.tag;
    const draw = (fold, squeeze) => {
      eb.innerHTML = `<span class="path${squeeze ? ' squeeze' : ''}">${idx.map((i, j) => (j ? '<span class="sep" aria-hidden="true">›</span>' : '') + (fold && j === 1 ? `<button type="button" class="fold" data-crumb="1" aria-label="${esc(cr[1].label)}"><span>…</span></button>` : `<button type="button" data-crumb="${i}"><span>${esc(cr[i].label)}</span></button>`)).join('')}</span>${tag ? `<span class="ktag"><span class="sep" aria-hidden="true">·</span>${P.tag}</span>` : ''}`;
    };
    draw(false);
    if (over() && tag) { tag = false; draw(false); }
    if (over() && idx.length > 2) { idx = [idx[0], idx[1], idx[idx.length - 1]]; draw(true); } // Bay Area › … › the parent
    if (over()) draw(idx.length > 2, true);
    if (body) body.hidden = tag || !P.tag;
    eb.querySelectorAll('[data-crumb]').forEach(b => b.addEventListener('click', () => go(cr[+b.dataset.crumb].loc, { tap: true })));
  }
  const lensesEl = $('lenses'), lensBtn = $('lens-btn');
  function swatches(lens) { if (lens === 'vibe') return Object.values(VIBES).map(v => `<i style="--c:var(--${v.cls})"></i>`).join(''); if (lens === 'fog') return [1, 2, 3, 4, 5].map(n => `<i style="--c:var(--fog${n})"></i>`).join(''); if (lens === 'elev') return [1, 2, 3, 4, 5].map(n => `<i style="--c:var(--hill${n})"></i>`).join(''); return `<i style="--c:var(--accent)"></i><i style="--c:var(--grey-fill)"></i>`; }
  // the layers menu: the four lenses, and under them the legend of the one in use (the map has no legend of its own)
  function renderLenses() { lensesEl.innerHTML = Object.entries(LENSES).map(([k, v]) => `<button type="button" data-lens="${k}" aria-pressed="${state.lens === k}"><span><b>${v.label}</b><small>${v.sub}</small></span><span class="sw">${swatches(k)}</span></button>`).join('') + '<div class="lgd" id="legend"></div>'; lensesEl.querySelectorAll('[data-lens]').forEach(b => b.addEventListener('click', () => { setLens(b.dataset.lens); closeLenses(); })); renderLegend(); }
  function setLens(k) { state.lens = k; savePrefs(); renderLenses(); recolor(true); }
  function renderLegend() {
    const el = $('legend'), k = state.lens; if (!el) return;
    if (state.quiz) { el.innerHTML = ''; return; }
    if (k === 'vibe') el.innerHTML = AWAY.includes(state.loc.region) && HOODS.some(h => h.region === state.loc.region && INFO[h.name].tone) ? HOODS.filter(h => h.region === state.loc.region).map(h => `<span><i style="--c:var(--${toneOf(h.name)})"></i>${esc(h.name)}</span>`).join('') // a region of toned places: the legend names them
      : Object.values(VIBES).map(v => `<span><i style="--c:var(--${v.cls})"></i>${v.label}</span>`).join('');
    else if (k === 'fog') el.innerHTML = `<span>Sunny</span><span class="ramp">${swatches('fog')}</span><span>Always foggy</span>`;
    else if (k === 'elev') { const r = state.loc.region, low = REGIONS[r] && REGIONS[r].low; el.innerHTML = `<span>${low ? esc(low.label) : 'Sea level'}</span><span class="ramp">${swatches('elev')}</span><span>${ft(AREA_MAX[areaKey(r)]).toLocaleString()} ft</span>`; }
    else el.innerHTML = `<span><i style="--c:var(--accent)"></i>Been</span><span><i style="--c:var(--grey-fill)"></i>Everywhere else</span>`;
    el.setAttribute('aria-label', 'Legend: ' + LENSES[k].label);
  }
  function closeLenses() { lensesEl.classList.remove('on'); lensBtn.setAttribute('aria-expanded', 'false'); }
  lensBtn.addEventListener('click', e => { e.stopPropagation(); const on = !lensesEl.classList.contains('on'); lensesEl.classList.toggle('on', on); lensBtn.setAttribute('aria-expanded', String(on)); });
  document.addEventListener('pointerdown', e => { if (!e.target.closest('#lenses, #lens-btn')) closeLenses(); if (!e.target.closest('#areas, #areas-menu')) openAreas(false); });
  $('zoom-in').addEventListener('click', () => map.zoom(1 / 1.6)); $('zoom-out').addEventListener('click', () => map.zoom(1.6));
  document.addEventListener('keydown', e => { if (dialogOpen()) return; if (e.key === 'Escape' && areasOpen()) { openAreas(false, true); return; } if (e.target.matches('input, textarea, select')) { if (e.key === 'Escape') e.target.blur(); return; } if (e.key === 'Escape') { if (state.view || level(state.loc) > 0) up(); } else if (e.key === '+' || e.key === '=') map.zoom(1 / 1.6); else if (e.key === '-') map.zoom(1.6); });
  const q = $('q');
  q.addEventListener('input', () => { state.query = q.value.trim().toLowerCase(); q.classList.toggle('has', !!q.value); if (state.query) renderSearch(); else { dropMore(); render(); } });
  // Enter: the first result, as before; with none, the explicit place search (js/places.js: Nominatim when Photon is down), as the
  // log form does. A "More places" row only when nothing local matched
  q.addEventListener('keydown', e => { if (e.key !== 'Enter') return; const first = panel.querySelector('[data-first]') || panel.querySelector('[data-more]'); if (first) first.click(); else if (searchCtx && searchCtx.term.length >= 2 && !searchCtx.only && !searchCtx.link) { askMore(searchCtx, true); fillMore(); } });
  // phone search mode: the card stays pinned and the sheet opens to full right under it, so results sit above the keyboard
  function endSearch(d) { document.documentElement.classList.remove('searching'); if (isPhone() && d) sheet.set(d, { quiet: true }); }
  q.addEventListener('focus', () => { openAreas(false); if (isPhone()) { document.documentElement.classList.add('searching'); sheet.set('full', { quiet: true }); } if (state.query) renderSearch(); });
  q.addEventListener('blur', () => { if (isPhone() && !q.value) endSearch('peek'); });

  // ---------- head + panel ----------
  // o: { eyebrow (text) or path: { crumbs, tag } (the tappable path, fitted by fitHead), title, tools, back, onBack, badge (news by others: a count beside the title, the only sign of it at the phone's peek), tally (the first
  // screen: [[n, label, spoken]] shown as three counts on the title's row, with no small line above it), compact (the title is for
  // assistive tech only) }
  // Every screen below the first screen of the map in play ends its tools with the X, which goes straight back to that first screen
  // (the Bay Area's; an away map's own). Never on the log form, a pin drop, search or the quiz: they keep their own way out
  const homeOf = l => { if (AWAY.includes(l.region)) return l.region; const sp = !l.hood && l.spot && state.spots[l.spot], b = sp && boxAt(sp.lon, sp.lat); return b ? areaRegion(b.area) : 'all'; }; // a spot in no place: the map its point is on
  const showX = () => !state.query && !state.quiz && !state.placing && state.view !== 'log' && (!!state.view || !!state.loc.hood || !!state.loc.spot || state.loc.region !== homeOf(state.loc));
  const toFirst = () => go({ region: homeOf(state.loc) }, { sheet: isPhone() ? 'peek' : undefined }); // a new history entry: Back returns to where the X was tapped
  function setHead(o) {
    head._path = o.path || null;
    o = Object.assign({}, o, { tools: (o.tools || []).concat(showX() ? [{ id: 'home', label: 'Back to the map', icon: ICON.x, run: toFirst }] : []) });
    // the counts are plain text, heard as one labelled group ("7 places walked, 3 want to go, 10 spots"), not three loose numbers
    const tally = o.tally ? `<div class="tally"><span class="sr">${esc(o.tally.map(t => t[2]).join(', '))}</span>${o.tally.map(t => `<span aria-hidden="true"><b>${t[0].toLocaleString('en-US')}</b><small>${t[1]}</small></span>`).join('')}</div>` : '';
    head.innerHTML = `<button type="button" class="up" aria-label="Back" ${o.back === false ? 'hidden' : ''}>${ICON.back}</button><div class="ttl">${o.tally ? '' : `<p class="eyebrow">${o.path ? '' : (o.dot ? `<i style="--c:${o.dot}"></i>` : '') + (o.eyebrow || '')}</p>`}<h2${o.compact ? ' class="sr"' : ''}>${o.title}</h2>${o.badge ? `<span class="newsb"><span aria-hidden="true">${esc(o.badge)}</span><span class="sr">${esc(o.badge)} new</span></span>` : ''}</div>${tally}<div class="tools">${o.tools.map(t => `<button type="button" data-tool="${t.id}" title="${esc(t.label)}" aria-label="${esc(t.label)}">${t.icon}</button>`).join('')}</div>`;
    head.classList.toggle('compact', !!o.compact); head.classList.toggle('first', !!o.tally);
    head.querySelector('.up').addEventListener('click', o.onBack || up);
    o.tools.forEach(t => head.querySelector(`[data-tool="${t.id}"]`).addEventListener('click', t.run));
  }
  let headH = 0;
  // the map chip on the map: the area you are on. A tap opens a menu of every area (the Bay Area, then each away region) with how
  // much of it is walked; a row opens that area's first screen. The menu is #areas-menu, beside the chip, so it is never measured as
  // the chip (insets, label occluders). It closes on a tap outside, Escape (back to the chip), a map drag, search and the full sheet
  const areasEl = $('areas'), amenu = $('areas-menu'), AREAS = ['bay'].concat(AWAY);
  const areaLabel = a => REGIONS[a === 'bay' ? 'all' : a].label, areaRegion = a => a === 'bay' ? 'all' : a;
  const areaWalked = a => HOODS.reduce((s, h, i) => areaKey(h.region) === a ? [s[0] + (isDone(i) ? 1 : 0), s[1] + 1] : s, [0, 0]);
  const areaLine = a => { const [n, t] = areaWalked(a), tag = a !== 'bay' && REGIONS[a].tag; return (tag ? tag + ' · ' : '') + `${n} of ${t} walked`; };
  const areasOpen = () => !!amenu && !amenu.hidden;
  let amenuHtml = '';
  function renderAreas() {
    if (!areasEl || !AWAY.length) return; const cur = areaKey(state.loc.region);
    if (areasEl.dataset.cur !== cur) { areasEl.dataset.cur = cur; areasEl.innerHTML = `<button type="button" aria-haspopup="true" aria-expanded="${areasOpen()}" aria-controls="areas-menu">${esc(areaLabel(cur))}<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5l3.5 3.5 3.5-3.5"/></svg></button>`; }
    if (!areasOpen()) return;
    // live counts: a walk elsewhere re-renders, and an unchanged menu is left alone (the focus stays on its row)
    const html = `<ul class="rows">${AREAS.map(a => `<li><button type="button" class="row" data-area="${a}"${a === cur ? ' aria-current="true"' : ''}><span class="ic ${areaWalked(a)[0] ? 'flag' : 'none'}"></span><span class="nm">${esc(areaLabel(a))}<small>${esc(areaLine(a))}</small></span><span class="rt">${a === cur ? '<svg viewBox="0 0 14 14" role="img" aria-label="Current map"><path d="M2.5 7.5l3 3 6-7"/></svg>' : ''}</span></button></li>`).join('')}</ul>`;
    if (html !== amenuHtml) { amenuHtml = html; amenu.innerHTML = html; }
  }
  function openAreas(on, focus) {
    if (!amenu || on === areasOpen()) return; amenu.hidden = !on; const b = areasEl.querySelector('button'); if (b) b.setAttribute('aria-expanded', String(on));
    if (on) renderAreas(); else if (focus && b) b.focus();
  }
  if (areasEl) areasEl.addEventListener('click', e => { if (e.target.closest('button')) openAreas(!areasOpen()); });
  if (amenu) amenu.addEventListener('click', e => { const b = e.target.closest('[data-area]'); if (!b) return; const kb = e.detail === 0; openAreas(false); go({ region: areaRegion(b.dataset.area) }, { tap: true }); if (kb) { const c = areasEl.querySelector('button'); if (c) c.focus(); } }); // chosen by keyboard: the focus goes back to the chip
  new MutationObserver(() => { const c = document.documentElement.classList; if (c.contains('searching') || (isPhone() && c.contains('sheet-full'))) openAreas(false); }).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] }); // search or the full sheet hides the chip
  function render() {
    renderLegend(); renderAreas();
    if (state.query) renderSearch();
    else if (state.quiz) renderQuiz();
    else {
      const l = state.loc, v = state.view; let fresh = true;
      if (!l.spot) stamped = null; // back on this spot later, the stamp lands again
      if (v === 'log') renderLogForm(); else if (v === 'spots') renderSpots(); else if (window.Lookback && Lookback.view(v)) {} else if (l.spot) fresh = renderSpot(l.spot); else if (l.sub) fresh = renderSub(l.hood, l.sub); else if (l.hood) renderHood(l.hood); else renderHome();
      if (fresh !== false) { wire(panel); if (window.Photos) Photos.mount(panel); } // fresh false: the panel was left as it was, listeners and all
      if (!v && level(l) >= 2) streetSoon();
    }
    streetOff(); fitHead();
    // the peek is the header's height: when that changes (the first screen's one-row header, a two-line title) the peek follows
    const hh = head.offsetHeight; if (hh !== headH) { headH = hh; if (isPhone() && sheet.detent === 'peek') sheet.set('peek', { quiet: true }); }
  }
  function wire(root) {
    root.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => go(JSON.parse(b.dataset.go), { tap: true })));
    root.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', () => go(state.loc, { view: b.dataset.view, fly: false, replace: true, sheet: isPhone() ? 'full' : undefined })));
  }
  const rowSub = (hood, s, j) => { const n = Object.values(state.spots).filter(sp => sp.hood === hood && sp.sub === s.name).length; return `<li><button type="button" class="row" data-go='${attr({ hood, sub: s.name })}'>${s.star ? '<span class="ic starb" aria-label="Starred"></span>' : `<span class="ic sq" style="--c:${colorFor(IDX[hood])};opacity:${[1, .75, .5][j % 3]}"></span>`}<span class="nm">${esc(s.name)}<small>${s.star ? `<span class="why">${esc(s.star)}</span> · ` : ''}${esc(s.line)}</small></span><span class="rt">${n ? n + (n === 1 ? ' spot' : ' spots') : ''}<span class="chev"></span></span></button></li>`; };
  const rowSpot = (id, withPlace) => { const sp = state.spots[id], k = KINDS[sp.kind] || KINDS.other; const meta = [k.label, withPlace ? (sp.sub || sp.hood) : sp.sub, sp.note].filter(Boolean).join(' · '); const rt = sp.status === 'want' ? 'want to go' : (sp.rating > 0 ? '★'.repeat(Math.max(1, Math.min(5, Math.round(sp.rating) || 1))) : niceDate(sp.at)); return `<li><button type="button" class="row" data-go='${attr({ spot: id })}'><span class="ic" style="--c:${k.c};${sp.status === 'want' ? 'background:transparent;box-shadow:0 0 0 2px ' + k.c + ' inset' : ''}"></span><span class="nm">${esc(sp.name)}<small>${esc(meta)}</small></span><span class="rt">${esc(rt)}</span></button></li>`; };
  const spotsIn = (hood, sub) => Object.keys(state.spots).filter(id => state.spots[id].hood === hood && (!sub || state.spots[id].sub === sub)).sort((a, b) => (state.spots[a].at < state.spots[b].at ? 1 : -1));
  // ---- Google Maps: a text query lands on the real place; a pinned, GPS or approximate spot keeps its coordinates
  // (a made-up name resolves to the wrong place). From place search, `where` is 'street · district · city'; the
  // district is unreliable, so only a street that starts with a number and the last part (the city) are used.
  const isSF = hood => IDX[hood] != null && HOODS[IDX[hood]].region === 'sf';
  // the region a query is about: the place's, or for a spot outside every place, the area its coordinates are in. Its state ends the
  // query; an away region also names the city (its places are stretches of the Strip, which no map service knows as towns)
  const regOf = (hood, sp) => REGIONS[IDX[hood] != null ? HOODS[IDX[hood]].region : sp && okLL(sp.lat, sp.lon) ? (boxAt(sp.lon, sp.lat) || {}).area : null] || {};
  const stOf = (hood, sp) => regOf(hood, sp).st || 'CA';
  const joinQ = parts => parts.filter((p, i, a) => p && a.indexOf(p) === i).join(', ');
  function spotQuery(sp) {
    if (sp.src !== 'search' || !sp.name) return `${sp.lat},${sp.lon}`;
    const parts = String(sp.where || '').split(' · ').map(s => s.trim()).filter(Boolean), sf = isSF(sp.hood);
    const street = /^\d/.test(parts[0] || '') ? parts[0] : null, city = regOf(sp.hood, sp).city || (parts.length > 1 ? parts[parts.length - 1] : sf ? 'San Francisco' : sp.hood);
    return joinQ([sp.name, street || (sf ? sp.hood : null), city, stOf(sp.hood, sp)]);
  }
  const areaQuery = (hood, sub) => { const city = regOf(hood).city; return city ? joinQ([sub || hood, city, stOf(hood)]) : joinQ([sub, hood, isSF(hood) ? 'San Francisco' : null, stOf(hood)]); };
  const mapsLink = q => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
  // Apple Maps, in the legacy URL format every iOS and macOS version opens: q searches near sll; ll with q drops a labelled pin
  const appleLink = (q, o = {}) => 'https://maps.apple.com/?' + (o.ll ? `ll=${o.ll}&q=${encodeURIComponent(q)}` : `q=${encodeURIComponent(q)}${o.sll ? '&sll=' + o.sll : ''}`) + (o.z ? '&z=' + o.z : '');
  const APPLE = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent); // iPadOS reports itself as a Mac
  const ll = (lat, lon) => `${+(+lat).toFixed(5)},${+(+lon).toFixed(5)}`;
  const spotApple = sp => sp.src === 'search' && sp.name ? appleLink(spotQuery(sp), { sll: ll(sp.lat, sp.lon), z: 17 }) : appleLink(sp.name || ll(sp.lat, sp.lon), { ll: ll(sp.lat, sp.lon), z: 17 });
  function areaApple(hood, sub) { const s = sub && subByName(hood, sub), h = HOODS[IDX[hood]], c = s ? [s.lon, s.lat] : h ? Geom.unproj(h.cx, h.cy) : null; return appleLink(areaQuery(hood, sub), c ? { sll: ll(c[1], c[0]) } : {}); }
  const tapLink = (q, apple) => APPLE ? apple : mapsLink(q); // where a tap on the phone preview goes
  // the map buttons, a pair under the preview: Apple Maps first on Apple devices, otherwise the one Google button
  const extBtn = (href, label) => `<a class="btn sm" href="${esc(href)}" target="_blank" rel="noopener">${label}<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 16L16 8M9 8h7v7"/></svg></a>`;
  const mapBtns = (q, apple) => `<div class="mapbtns">${APPLE ? extBtn(apple, 'Apple Maps') + extBtn(mapsLink(q), 'Google Maps') : extBtn(mapsLink(q), 'Open in Maps')}</div>`;
  // the street-map preview (js/streetmap.js). Not inside the Claude artifact, whose host blocks third-party content
  const streetOK = () => (state.store === 'sync' || state.store === 'local') && !(window.claude && window.claude.use);
  const streetMap = v => streetOK() && window.StreetMap ? `<h3>Street map</h3>${StreetMap.box(v)}` : '';
  // the street map is made only when its box is on screen (a third of it at least: on the phone the sheet at its low stops does not show
  // it) and the map has rested 500 ms (no finger, no flight, nothing animating: mapBusyT, and the 3D map's own restMs); until then the box
  // shows its land-coloured placeholder with the pin. A gesture or flight meanwhile starts the wait again; leaving the place first never
  // makes it. A re-render with no fly (a sync echo, a save) of the view already drawn mounts at once, so it stays drawn without a blink
  // (fingerOn counts as off once the map itself says it rests, or 5 s after the last move or touch: a finger the map kept by mistake never blocks it for ever)
  let mapBusyT = 0, fingerOn = false, fingerT = 0, streetW = null; const streetOff = () => { if (streetW && !panel.querySelector('.mapprev')) streetW.stop(); }; // (a panel painted without a box: its watcher goes)
  function streetGate(v) {
    if (streetW) streetW.stop(); const el = panel.querySelector('.mapprev'); if (!el || el.dataset.key !== v.key || !window.StreetMap) return;
    if (!goFly && !flyQ.length && StreetMap.shown === v.key) { StreetMap.mount(el, v); return; }
    const t0 = performance.now(); let seen = false, tm = 0, io = null;
    const w = streetW = { stop() { clearTimeout(tm); if (io) io.disconnect(); if (streetW === w) streetW = null; } };
    const check = () => { clearTimeout(tm); if (streetW !== w) return; if (!el.isConnected) return w.stop(); if (!seen) return;
      const fOn = fingerOn && !(map.restMs && map.restMs() >= 500) && performance.now() - fingerT < 5000, rest = fOn ? 0 : Math.min(performance.now() - Math.max(mapBusyT, t0), map.restMs ? map.restMs() : Infinity); if (rest < 500) { tm = setTimeout(check, 520 - rest); return; }
      w.stop(); StreetMap.mount(el, v); };
    if (!window.IntersectionObserver) { seen = true; check(); return; } // (no IntersectionObserver: as if the box were on screen)
    io = new IntersectionObserver(es => { seen = es[es.length - 1].intersectionRatio >= 0.33; check(); }, { threshold: [0, 0.33, 0.66, 1] }); io.observe(el);
  }
  const mountStreet = v => streetGate(v);
  // the camera has been still for three frames (or 2.5 s passed): the fly is over
  const flyQ = [];
  function afterFly(fn) {
    flyQ.push(fn); if (flyQ.length > 1) return;
    let last = '', still = 0; const t0 = performance.now();
    const tick = () => { const c = map.cam, k = c.x + ',' + c.y + ',' + c.w, t = performance.now(); still = k === last ? still + 1 : 0; last = k; if ((still >= 3 && t - t0 > 90) || t - t0 > 2500) flyQ.splice(0).forEach(f => f()); else requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }
  // the street-map library (about 376 KB) is not loaded at boot: the first place, section or spot asks for its download (not its parse: that
  // waits for the street map itself, streetGate), once its fly is over, so neither shares the main thread with the camera or a first photo
  let streetAsked = false;
  function streetSoon() { if (streetAsked || !window.StreetMap || !streetOK()) return; streetAsked = true; afterFly(() => StreetMap.preload(true)); }
  const okLL = (lat, lon) => typeof lat === 'number' && typeof lon === 'number' && isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180; // a log is anyone's to write: a spot without real coordinates gets no map and no dot
  const spotDots = skip => Object.keys(state.spots).filter(id => id !== skip && okLL(state.spots[id].lat, state.spots[id].lon)).map(id => { const s = state.spots[id]; return [s.lon, s.lat, KINDS[s.kind] ? s.kind : 'other']; });
  // a re-render (sync echo, a save) that would write the same HTML leaves the panel alone, so the street map stays as drawn
  let painted = null;
  function paint(html) { if (painted && painted.html === html && panel.contains(painted.el)) return false; panel.innerHTML = html; const el = panel.querySelector('.mapprev'); painted = el ? { html, el } : null; return true; }
  // ---- photos (hosted shared log only): owner keys are Firebase-safe (no . $ # [ ] / or control characters)
  const okey = s => String(s).replace(/[.$#[\]/\x00-\x1f\x7f]/g, '_');
  const ownerKey = { spot: id => okey(id), place: hood => okey('h-' + slug(hood)), section: (hood, sub) => okey('h-' + slug(hood) + '--' + slug(sub)) };
  // the photo hero at the top of a spot, section or place; o: { c, e, badge, extras } (see js/photos.js). Without shared photos
  // (a local log, the artifact) it is the same coloured cover with the emoji, purely decorative, so every mode looks alike.
  const hero = (owner, label, o) => !window.Photos ? '' : state.store === 'sync' ? Photos.block(owner, label, state.canWrite, o) : Photos.cover(o);
  const spotSrc = id => ({ owner: ownerKey.spot(id), label: state.spots[id].name });
  const vibeLook = hood => { const v = INFO[hood].vibe; return { c: `var(--${toneOf(hood)})`, e: VIBE_E[v] || '📍' }; };
  let stamped = null; // the spot (and status) whose stamp last landed: it thunks once per spot, not on every re-render

  // ---- home: Bay Area or a region ----
  const doneCount = (r = state.loc.region) => HOODS.reduce((s, h, i) => s + (inRegion(i, r) && isDone(i) ? 1 : 0), 0);
  const climbedFt = (r = state.loc.region) => HOODS.reduce((s, h, i) => s + (inRegion(i, r) && isDone(i) ? ft(h.max) : 0), 0);
  const areaPct = (r = state.loc.region) => { let a = 0, t = 0; HOODS.forEach((h, i) => { if (inRegion(i, r)) { t += h.cells; if (isDone(i)) a += h.cells; } }); return t ? a / t : 0; };
  function stampState() { const vibe = {}; for (const k in VIBES) vibe[k] = HOODS.every((h, i) => AWAY.includes(h.region) || INFO[h.name].vibe !== k || isDone(i)); return { n: doneCount('all'), sf: doneCount('sf'), marin: doneCount('marin'), east: doneCount('east'), penin: doneCount('penin'), south: doneCount('south'), north: doneCount('north'), vegas: doneCount('vegas'), ft: climbedFt('all'), vibe }; } // the six character stamps are the Bay Area's: an away region does not move them
  function renderHome() {
    const r = state.loc.region, n = doneCount(), total = REGION_N[r], s = stampState(), earned = STAMPS.filter(st => st.test(s)), next = STAMPS.find(st => !st.test(s));
    const news = r === 'all' ? state.news.length : 0;
    const recent = Object.keys(state.spots).filter(id => IDX[state.spots[id].hood] != null && inRegion(IDX[state.spots[id].hood])).sort((a, b) => (state.spots[a].at < state.spots[b].at ? 1 : -1));
    const entries = NAMES.filter(x => inRegion(IDX[x]) && state.done[slug(x)]).sort((a, b) => String(state.done[slug(b)].at ?? '').localeCompare(String(state.done[slug(a)].at ?? '')) || a.localeCompare(b));
    const wantList = NAMES.filter(x => inRegion(IDX[x]) && state.want[slug(x)] && !state.done[slug(x)]);
    // the first screen of the map in play (the Bay Area's, an away map's own): the title and, on its row, the panel's own three counts:
    // places walked (the progress below), want to go (the Want to go places below plus the spots saved as want to go) and spots (the
    // Spots list below)
    if (r === 'all' || AWAY.includes(r)) {
      const w = wantList.length + recent.filter(id => state.spots[id].status === 'want').length, sp = recent.length;
      setHead({ back: r !== 'all', title: r === 'all' ? 'Seven by Seven<em>.</em>' : esc(REGIONS[r].label), badge: news ? String(news) : '', tally: [[n, 'Walked', `${n} ${n === 1 ? 'place' : 'places'} walked`], [w, 'Want', `${w} want to go`], [sp, 'Spots', `${sp} ${sp === 1 ? 'spot' : 'spots'}`]] });
    } else setHead({ path: { crumbs: crumbsOf(state.loc) }, title: REGIONS[r].label });
    const active = state.filters.size > 0, hits = active ? NAMES.filter(x => matches(IDX[x])) : [];
    const places = r === 'all'
      ? Object.keys(REGIONS).filter(k => k !== 'all').map(k => `<li><button type="button" class="row" data-go='${attr({ region: k })}'><span class="ic ${doneCount(k) === REGION_N[k] ? 'flag' : doneCount(k) ? 'sq' : 'none'}" style="--c:var(--accent)"></span><span class="nm">${REGIONS[k].label}</span><span class="rt">${doneCount(k)} of ${REGION_N[k]}<span class="chev"></span></span></button></li>`).join('')
      : (REGIONS[r].ordered ? HOODS.filter(h => h.region === r).map(h => h.name) : NAMES.filter(x => inRegion(IDX[x]))).map(x => `<li><button type="button" class="row" data-go='${attr({ hood: x })}'><span class="ic ${isDone(IDX[x]) ? 'flag' : isWant(IDX[x]) ? 'star' : 'none'}"></span><span class="nm">${esc(x)}${starOf(x) ? '<span class="st" role="img" aria-label="Starred"></span>' : ''}</span><span class="rt">${ft(HOODS[IDX[x]].max).toLocaleString()} ft</span></button></li>`).join('');
    // the phone puts the tappable list right under the progress bar, so the half sheet shows rows, not instructions
    const progress = `<div class="progress"><div class="bar"><i style="width:${(n / total * 100).toFixed(1)}%"></i></div><small>${n === 0 ? (state.store === 'sync' && !Object.keys(state.spots).length ? 'Nothing walked yet · <button type="button" class="act" id="join-log-hint">Already have a log? Join it</button>' : 'Nothing walked yet') : `<b>${n}</b> of ${total} walked · ${Math.round(areaPct() * 100)}% by area · ${climbedFt().toLocaleString()} ft climbed`}</small></div>`;
    const lead = `<p class="lead">${n === 0 ? `Tap a place on the map, or pick one ${isPhone() ? 'above' : 'below'}. When you have set foot in it, log it and it gets a flag.` : n === total ? `All ${total}. You have been all over ${REGIONS[r].the}.` : `${total - n} to go.${next ? ' Next stamp: ' + next.label + '.' : ''}`}</p>`;
    const links = `<div class="textlinks">${r === 'all' && window.Lookback ? '<button type="button" data-view="timeline">Timeline</button>' : ''}<button type="button" id="surprise">Suggest a place</button><button type="button" id="quiz">Quiz me</button><button type="button" data-mood-toggle>Find by mood${active ? ' (' + state.filters.size + ')' : ''}</button></div>
      <div id="moods" ${active ? '' : 'hidden'}><h3>Mood</h3><div class="textlinks">${MOODS.map(t => `<button type="button" data-mood="${t}" aria-pressed="${state.filters.has(t)}">${t}</button>`).join('')}</div>
        ${active ? `<h3>${hits.length ? hits.length + ' match' + (hits.length === 1 ? '' : 'es') : 'No matches'}</h3><div class="textlinks">${hits.map(a => `<button type="button" class="${isDone(IDX[a]) ? 'done' : isWant(IDX[a]) ? 'want' : ''}" data-go='${attr({ hood: a })}'>${esc(a)}</button>`).join('')}</div>` : ''}</div>`;
    const list = `<h3>${r === 'all' ? 'Regions' : 'Places'} <span class="n">${r === 'all' ? '' : total}</span></h3><ul class="rows ${r === 'all' || REGIONS[r].ordered ? '' : 'cols2'}">${places}</ul>`; // an ordered region (the Strip, north to south) reads down one column
    panel.innerHTML = (news ? newsBlock() : '') + (r === 'all' && window.Lookback ? Lookback.card() : '') + progress + (isPhone() ? list + lead + links : lead + links + list) + `
      ${entries.length ? `<h3>Been <span class="n">${entries.length}</span></h3><ul class="rows">${entries.map(x => `<li><button type="button" class="row" data-go='${attr({ hood: x })}'><span class="ic flag"></span><span class="nm">${esc(x)}${state.done[slug(x)].note ? `<small>${esc(state.done[slug(x)].note)}</small>` : ''}</span><span class="rt">${niceDate(state.done[slug(x)].at)}</span></button></li>`).join('')}</ul>` : ''}
      ${wantList.length ? `<h3>Want to go <span class="n">${wantList.length}</span></h3><div class="textlinks">${wantList.map(a => `<button type="button" class="want" data-go='${attr({ hood: a })}'>${esc(a)}</button>`).join('')}</div>` : ''}
      <h3>Spots <span class="n">${recent.length || ''}</span>${recent.length > 6 ? `<button type="button" class="act" data-view="spots">All ${recent.length}</button>` : ''}</h3>
      ${recent.length ? `<ul class="rows">${recent.slice(0, 6).map(id => rowSpot(id, true)).join('')}</ul>` : `<p class="empty">Restaurants, bars, views, shops: search a name or drop a pin, then rate it.</p>`}
      <h3>Stamps <span class="n">${earned.length} of ${STAMPS.length}</span></h3><div class="stamps">${STAMPS.map(st => `<div class="stamp ${st.test(s) ? 'got' : ''}"><b>${st.icon}</b>${st.label}</div>`).join('')}</div>
      <details class="more"><summary>Settings</summary>
        <label class="switch"><span>Color every place, been or not</span><input type="checkbox" id="show-all" ${state.showAll ? 'checked' : ''}></label>
        <label class="switch"><span>3D map (beta)${!window.MapView3D || (window.SBS_MAP3D && !map.is3d) || map3dOff() ? '<small>Not available here</small>' : ''}</span><input type="checkbox" id="map3d" ${state.map3d || window.SBS_MAP3D ? 'checked' : ''} ${window.MapView3D ? '' : 'disabled'}></label>
        <div class="field" style="margin-top:12px"><label>Appearance</label><div class="seg">${['system', 'light', 'dark'].map(t => `<button type="button" data-theme-pick="${t}" aria-pressed="${state.theme === t}">${t === 'system' ? 'System' : t[0].toUpperCase() + t.slice(1)}</button>`).join('')}</div></div>
        ${state.store === 'sync' ? `<div class="field"><label for="who-in">Your name on this device</label><input id="who-in" maxlength="${WHO_MAX}" autocomplete="given-name" enterkeyhint="done" placeholder="Shown on what you add" value="${esc(who())}"></div>` : ''}
        <div class="actions" style="margin-top:4px"><button type="button" class="btn sm" id="export">Export log</button><button type="button" class="btn sm" id="import">Import</button><input type="file" id="import-file" accept="application/json" hidden>${state.store === 'sync' ? '<button type="button" class="btn sm primary" id="share-log">Share this log</button><button type="button" class="btn sm" id="join-log">Join a log</button>' + (prevKeys().length ? '<button type="button" class="btn sm quiet" id="back-log">Back to the previous log</button>' : '') : ''}</div>
        <p class="fine">${state.store === 'db' ? 'Your log, list, spots and notes are saved with this artifact and shared with everyone it is shared with.' : state.store === 'sync' ? 'This log is shared: everyone who opens your link sees it and adds to it, live. Keep the link private, and bookmark it on each phone. Photos are shared with the log the same way, but Export log does not include them.' : 'Your log is saved in this browser. Export it now and then to keep a copy, or to move it to another device.'} San Francisco boundaries from the SF Planning Department, high points from Mapzen elevation data. Boundaries everywhere else in the Bay Area from the US Census; their high points are approximate. The Las Vegas Strip is drawn between I-15 and Paradise Road, cut at its cross streets. Place search by Photon, © OpenStreetMap contributors.</p>
        ${window.MapView3D ? '<p class="fine m3d-credit">3D map: © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>. United States 3DEP (formerly NED) and global GMTED2010 and SRTM terrain data courtesy of the U.S. Geological Survey.</p>' : ''}
      </details>`;
    panel.querySelector('#surprise').addEventListener('click', surprise);
    panel.querySelector('#quiz').addEventListener('click', startQuiz);
    panel.querySelector('[data-mood-toggle]').addEventListener('click', () => { const m = panel.querySelector('#moods'); m.hidden = !m.hidden; });
    panel.querySelectorAll('[data-mood]').forEach(b => b.addEventListener('click', () => { const t = b.dataset.mood; state.filters.has(t) ? state.filters.delete(t) : state.filters.add(t); map.invalidate(); render(); panel.querySelector('#moods').hidden = false; }));
    panel.querySelectorAll('[data-theme-pick]').forEach(b => b.addEventListener('click', () => { state.theme = b.dataset.themePick; savePrefs(); applyTheme(); map.refreshPalette(); recolor(false); render(); }));
    panel.querySelector('#show-all').addEventListener('change', e => { state.showAll = e.target.checked; savePrefs(); map.invalidate(); });
    panel.querySelector('#map3d').addEventListener('change', e => { // the other map engine: kept with the prefs, and the page loads again with it (an engine named in the address is dropped, or it would win)
      state.map3d = e.target.checked; savePrefs(); try { sessionStorage.removeItem('sbs-map3d-off'); sessionStorage.removeItem('sbs-map3d-q2'); } catch (err) {}
      const u = new URL(location.href); u.searchParams.delete('map'); if (u.href === location.href) location.reload(); else location.replace(u.href);
    });
    panel.querySelector('#export').addEventListener('click', exportLog);
    panel.querySelector('#import').addEventListener('click', () => panel.querySelector('#import-file').click());
    panel.querySelector('#import-file').addEventListener('change', e => importLog(e.target.files[0]));
    const sh = panel.querySelector('#share-log'); if (sh) sh.addEventListener('click', shareLog);
    panel.querySelectorAll('#join-log, #join-log-hint').forEach(b => b.addEventListener('click', joinLog));
    const bl = panel.querySelector('#back-log'); if (bl) bl.addEventListener('click', () => joinLog(true));
    const wi = panel.querySelector('#who-in'); if (wi) { wi.addEventListener('keydown', e => { if (e.key === 'Enter') wi.blur(); }); wi.addEventListener('change', () => { setWho(wi.value); wi.value = who(); toast(who() ? `You are ${who()} on this device` : 'No name on this device'); }); }
    const ns = panel.querySelector('#news-seen'); if (ns) ns.addEventListener('click', markSeen);
    panel.querySelectorAll('[data-news]').forEach(b => b.addEventListener('click', () => { const e = newsShown.find(x => x.key === b.dataset.news); if (e) openEv(e); }));
  }

  // ---- a neighborhood ----
  function renderHood(name) {
    const i = IDX[name], info = INFO[name], h = HOODS[i], k = slug(name), done = state.done[k], want = state.want[k], secs = subs(name), mine = spotsIn(name);
    const roof = h.max === Math.max(...HOODS.filter(x => x.region === h.region).map(x => x.max)), dis = state.canWrite ? '' : 'disabled';
    const keepNote = panel.dataset.name === name && panel.querySelector('#note') ? panel.querySelector('#note').value : null; panel.dataset.name = name;
    setHead({ path: { crumbs: crumbsOf(state.loc) }, title: esc(name) }); // the vibe is the first of the facts
    const extras = mine.map(spotSrc).concat(secs.slice().sort((a, b) => !!b.star - !!a.star).map(s => ({ owner: ownerKey.section(name, s.name), label: s.name }))); // spots first, newest first (photos mostly live there and the hero caps its sources), then sections in list order
    panel.innerHTML = `
      ${hero(ownerKey.place(name), name, Object.assign(vibeLook(name), { extras }))}
      <p class="lead">${esc(info.line)}</p>
      <div class="marks">
        <button type="button" class="mark done ${done ? 'on' : ''}" id="explore" aria-pressed="${!!done}" ${dis}><span class="box">${ICON.check}</span><span><b>Been</b><small>${done ? [niceDate(done.at), 'tap to undo'].filter(Boolean).join(' · ') : 'Plants a flag'}</small></span></button>
        <button type="button" class="mark want ${want ? 'on' : ''}" id="want" aria-pressed="${!!want}" ${dis || (done ? 'disabled' : '')}><span class="box">${ICON.star}</span><span><b>Want to go</b><small>${done ? 'Already been' : want ? 'Tap to remove' : 'Save for later'}</small></span></button>
      </div>
      ${done ? `<textarea class="note" id="note" placeholder="What did you eat, see, or climb?" aria-label="Notes for ${esc(name)}">${esc(keepNote ?? done.note ?? '')}</textarea>` : ''}<div class="savestate" id="savestate">${state.canWrite ? '' : 'Sign in to keep a list'}</div>
      ${secs.length ? `<h3>Sections <span class="n">${secs.length}</span></h3><ul class="rows">${secs.map((s, j) => [s, j]).sort((a, b) => !!b[0].star - !!a[0].star).map(([s, j]) => rowSub(name, s, j)).join('')}</ul>` : ''}
      <div class="facts"><span class="vibe"><i style="--c:var(--${toneOf(name)})"></i><b>${VIBES[info.vibe].label}</b></span><span><b>${ft(h.max).toLocaleString()} ft</b> high point${roof ? ' · ' + REGIONS[h.region].roof : ''}</span><span><b>Fog</b> <span class="dots">${[1, 2, 3, 4, 5].map(n => `<i class="${n <= info.fog ? 'on' : ''}"></i>`).join('')}</span> ${FOG_WORDS[info.fog - 1]}</span></div>
      ${mapBtns(areaQuery(name), areaApple(name))}
      <h3>Spots <span class="n">${mine.length || ''}</span></h3>
      ${mine.length ? `<ul class="rows">${mine.map(id => rowSpot(id, false)).join('')}</ul>` : `<p class="empty">Nothing logged here yet.</p>`}
      <h3>Known for</h3><ul class="plain">${info.known.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
      <h3>One thing to know</h3><p class="fact">${esc(info.fact)}</p>
      <h3>Next door</h3>${h.adj.length ? `<div class="textlinks">${h.adj.map(a => `<button type="button" class="${isDone(IDX[a]) ? 'done' : isWant(IDX[a]) ? 'want' : ''}" data-go='${attr({ hood: a })}'>${esc(a)}</button>`).join('')}</div>` : '<p class="empty">Nobody. It is an island.</p>'}`;
    panel.querySelector('#explore').addEventListener('click', () => toggleDone(name));
    panel.querySelector('#want').addEventListener('click', () => toggleWant(name));
    const n = panel.querySelector('#note'); if (n) n.addEventListener('input', e => noteInput(name, e.target.value));
  }
  // ---- a section of a neighborhood ----
  function renderSub(hood, subName) {
    const s = subByName(hood, subName), i = IDX[hood], info = INFO[hood], mine = spotsIn(hood, subName), others = subs(hood).filter(x => x.name !== subName);
    setHead({ path: { crumbs: crumbsOf(state.loc), tag: s.star ? '<span class="star"><b>★</b> Starred</span>' : null }, title: esc(subName) }); // the reason for the star is the note at the top of the panel
    const mq = areaQuery(hood, subName), aq = areaApple(hood, subName);
    const sv = { key: 'sub:' + hood + '/' + subName, name: subName, href: tapLink(mq, aq), q: mq, z: 16, seed: [s.lon, s.lat], zoom: 15 };
    if (!paint(`
      ${s.star ? `<p class="starnote"><b aria-hidden="true">★</b><span>${esc(s.star)}</span></p>` : ''}
      ${hero(ownerKey.section(hood, subName), subName, Object.assign(vibeLook(hood), { extras: mine.map(spotSrc) }))}
      <p class="lead">${esc(s.line)}</p>
      ${s.tags && s.tags.length ? `<div class="tags">${s.tags.map(t => `<span>${esc(t)}</span>`).join('')}</div>` : ''}
      ${streetMap(sv)}${mapBtns(mq, aq)}
      <h3>Spots here <span class="n">${mine.length || ''}</span></h3>
      ${mine.length ? `<ul class="rows">${mine.map(id => rowSpot(id, false)).join('')}</ul>` : `<p class="empty">Nothing logged in ${esc(subName)} yet.</p>`}
      ${s.known && s.known.length ? `<h3>Known for</h3><ul class="plain">${s.known.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      <h3>Also in ${esc(hood)}</h3><div class="textlinks">${others.map(x => `<button type="button" data-go='${attr({ hood, sub: x.name })}'>${esc(x.name)}</button>`).join('')}</div>`)) return false;
    mountStreet(Object.assign(sv, { rings: (s.rings || []).map(r => r.map(([x, y]) => Geom.unproj(x, y).map(n => +n.toFixed(5)))), dots: spotDots(null) })); // the section's cell, outlined
  }
  // ---- a spot ----
  function renderSpot(id) {
    const sp = state.spots[id], k = KINDS[sp.kind] || KINDS.other;
    setHead({ path: { crumbs: crumbsOf(state.loc), tag: `<i style="--c:${k.c}"></i>${k.label}` }, title: esc(sp.name), tools: [{ id: 'edit', label: 'Edit', icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l10-10-4-4L4 16v4z"/><path d="M13 7l4 4"/></svg>', run: () => { const s = state.spots[id]; if (s) startLog({ hood: s.hood, sub: s.sub, edit: id }); } }] });
    const mq = spotQuery(sp), aq = spotApple(sp), want = sp.status === 'want', r = want ? 0 : Math.max(0, Math.min(5, sp.rating | 0)), by = cleanName(sp.by);
    const sv = { key: 'spot:' + id + '@' + ll(sp.lat, sp.lon), name: sp.name, href: tapLink(mq, aq), q: mq, z: 17, lat: sp.lat, lon: sp.lon, zoom: 16, pin: { c: k.c, e: k.e } };
    if (!paint(`
      ${hero(ownerKey.spot(id), sp.name, { c: k.c, e: k.e, badge: { e: k.e, t: k.label } })}
      ${sp.where ? `<p class="lead"><span class="kbody" hidden><i style="--c:${k.c}"></i>${esc(k.label)} · </span>${esc(sp.where)}</p>` : `<p class="lead kbody" hidden><i style="--c:${k.c}"></i>${esc(k.label)}</p>`}
      <div class="vrow">${r ? `<span class="vstars" role="img" aria-label="${r} of 5 stars"><span aria-hidden="true">${'★'.repeat(r)}<i>${'★'.repeat(5 - r)}</i></span></span><b class="vword">${VERDICT[r]}</b>` : ''}<span class="pstamp ${want ? 'want' : 'been'}">${want ? 'Want to go' : window.Lookback ? esc(Lookback.stamp(sp)) : `Been${niceDate(sp.at) ? ' · ' + esc(niceDate(sp.at)) : ''}`}</span></div>
      ${by ? `<p class="vby">Logged by ${esc(by)}</p>` : ''}${window.Lookback ? Lookback.spotBlock(id) : ''}
      ${sp.note ? `<p class="pull">${esc(sp.note)}</p>` : ''}
      ${okLL(sp.lat, sp.lon) ? streetMap(sv) : ''}${mapBtns(mq, aq)}
      <div class="actions" style="margin-top:18px">${sp.status === 'want' ? `<button type="button" class="btn primary" id="been-now">Mark as been</button>` : ''}<button type="button" class="btn quiet" id="del" style="color:var(--bad)">Delete</button></div>
      <div class="actions" id="del-confirm" hidden><span style="font-size:13.5px;align-self:center">Remove ${esc(sp.name)} from your log?</span><button type="button" class="btn sm" id="del-yes" style="color:var(--bad);border-color:var(--bad)">Delete</button><button type="button" class="btn sm quiet" id="del-no">Keep</button></div>`)) return false;
    mountStreet(Object.assign(sv, { dots: spotDots(id) })); // the other spots in the log, as small dots
    { const st = panel.querySelector('.pstamp'), key = id + ':' + sp.status; if (st && stamped !== key) { st.classList.add('thunk'); st.addEventListener('animationend', () => st.classList.remove('thunk'), { once: true }); } stamped = key; } // a fresh spot (or a new status): the stamp lands
    // listeners can outlive this render (an identical re-render keeps the panel), so they look the spot up when used
    panel.querySelector('#del').addEventListener('click', () => { panel.querySelector('#del-confirm').hidden = false; panel.querySelector('#del').hidden = true; });
    panel.querySelector('#del-no').addEventListener('click', () => { panel.querySelector('#del-confirm').hidden = true; panel.querySelector('#del').hidden = false; });
    panel.querySelector('#del-yes').addEventListener('click', () => removeSpot(id));
    const bn = panel.querySelector('#been-now'); if (bn) bn.addEventListener('click', async () => { if (!state.spots[id]) return; await beforeWrite(); const s = state.spots[id]; if (!s || s.status === 'been') return; s.status = 'been'; if (window.Lookback) Lookback.markBeen(s, today()); else s.at = today(); const ok = await persist(); render(); toast(`${s.name}: been there.`); if (ok !== false) logEvent('been', { id, name: s.name, hood: s.hood }); });
  }
  // ---- all spots ----
  function renderSpots() {
    const r = state.loc.region; const f = state.spotFilter || {};
    let ids = Object.keys(state.spots).filter(id => IDX[state.spots[id].hood] != null && inRegion(IDX[state.spots[id].hood], r));
    if (f.kind) ids = ids.filter(id => state.spots[id].kind === f.kind); if (f.status) ids = ids.filter(id => (state.spots[id].status || 'been') === f.status);
    ids.sort((a, b) => (state.spots[a].at < state.spots[b].at ? 1 : -1));
    setHead({ eyebrow: 'Logbook', title: 'Spots', onBack: () => go(state.loc, { replace: true, fly: false }) });
    panel.innerHTML = `<div class="textlinks chips"><button type="button" data-sf="status:" aria-pressed="${!f.status}">All</button><button type="button" data-sf="status:been" aria-pressed="${f.status === 'been'}">Been</button><button type="button" data-sf="status:want" aria-pressed="${f.status === 'want'}">Want to go</button></div>
      <div class="textlinks chips"><button type="button" data-sf="kind:" aria-pressed="${!f.kind}">Any kind</button>${Object.entries(KINDS).map(([k, v]) => `<button type="button" data-sf="kind:${k}" aria-pressed="${f.kind === k}">${v.label}</button>`).join('')}</div>
      <h3>${ids.length} ${ids.length === 1 ? 'spot' : 'spots'}</h3>${ids.length ? `<ul class="rows">${ids.map(id => rowSpot(id, true)).join('')}</ul>` : '<p class="empty">Nothing matches.</p>'}`;
    panel.querySelectorAll('[data-sf]').forEach(b => b.addEventListener('click', () => { const [k, v] = b.dataset.sf.split(':'); state.spotFilter = Object.assign({}, f, { [k]: v || null }); renderSpots(); wire(panel); }));
  }
  // ---- search ----
  // how well a name matches: 0 it starts with the query, 1 a word in it does, 2 it contains it, 9 not at all
  function rankOf(text, qq) { const t = String(text || '').toLowerCase(); let j = t.indexOf(qq); if (j < 0) return 9; if (j === 0) return 0; for (; j >= 0; j = t.indexOf(qq, j + 1)) if (!/[\p{L}\p{N}]/u.test(t[j - 1])) return 1; return 2; }
  // the matches, best rank first, ties alphabetical; names: the texts that count (an alias, a note: the note only as 'contains'). A synced
  // spot's name is anyone's to write (a number, nothing): the labels compare as strings
  const ranked = (items, names, label, qq = state.query) => items.map(x => [x, Math.min(...names(x).map(([t, floor]) => Math.max(floor || 0, rankOf(t, qq))))]).filter(a => a[1] < 9).sort((a, b) => a[1] - b[1] || String(label(a[0]) ?? '').localeCompare(String(label(b[0]) ?? ''))).map(a => a[0]);
  // a map keyword: the words that name an area (an away region's label, its city, and the label's last word: "vegas"; the Bay's own)
  const AREA_NAMES = AREAS.map(a => [a, a === 'bay' ? ['bay area', 'san francisco', 'sf'] : [REGIONS[a].label, REGIONS[a].city, / /.test(REGIONS[a].label) ? REGIONS[a].label.split(' ').pop() : ''].filter(Boolean).map(s => s.toLowerCase())]);
  const areaNamed = s => (AREA_NAMES.find(([, ns]) => ns.includes(s)) || [])[0] || null;
  // typed text that starts or ends with whole words naming an area, with 2+ characters left: { area, rest, word } (longest name first)
  function mapWord(text) {
    const w = text.split(/[\s,]+/).filter(Boolean);
    for (let k = w.length - 1; k >= 1; k--) for (const [name, rest] of [[w.slice(-k), w.slice(0, -k)], [w.slice(0, k), w.slice(k)]]) { const a = areaNamed(name.join(' ').toLowerCase()), r = rest.join(' '); if (a && r.length >= 2) return { area: a, rest: r, word: name.join(' ') }; }
    return null;
  }
  const spotArea = sp => IDX[sp.hood] != null ? areaKey(HOODS[IDX[sp.hood]].region) : okLL(sp.lat, sp.lon) ? (boxAt(sp.lon, sp.lat) || {}).area || null : null;
  // the four local groups for a query, all areas or one (a: after a map keyword)
  function localHits(qq, a) {
    const inA = hood => !a || (IDX[hood] != null && areaKey(HOODS[IDX[hood]].region) === a);
    const hoods = ranked(NAMES.filter(inA), n => [[n], [SHORT[n]]], n => n, qq);
    const allSecs = []; HOODS.forEach(h => { if (inA(h.name)) subs(h.name).forEach(s => allSecs.push({ hood: h.name, sub: s.name })); });
    const secs = ranked(allSecs, x => [[x.sub]], x => x.sub, qq);
    const spots = ranked(Object.keys(state.spots).filter(id => !a || spotArea(state.spots[id]) === a), id => [[state.spots[id].name], [state.spots[id].note, 2]], id => state.spots[id].name, qq);
    const lms = ranked(map.landmarks.filter(l => inA(l.hood)), l => [[l.name]], l => l.name, qq);
    return { hoods, secs, spots, lms, n: hoods.length + secs.length + spots.length + lms.length };
  }
  // place search beside them (js/places.js, inside the box of the area in play): typing waits 350 ms, a newer query drops an older
  // answer, and the answer fills only its own slot (#more) at the end of the panel: nothing above it is redrawn, so no tap, focus or
  // caret is lost. Unreachable, the group is simply absent
  const more = { key: '', st: '', res: [], timer: 0, n: 0 }; // st: 'busy', 'done' or 'down', for the query `key` (area|text)
  let searchCtx = null;
  function dropMore() { clearTimeout(more.timer); more.n++; more.key = more.st = ''; more.res = []; searchCtx = null; dropLink(); }
  const clearQ = d => { q.value = ''; state.query = ''; q.classList.remove('has'); q.blur(); endSearch(d); dropMore(); };
  const metres = (a, b) => Math.hypot((a.lon - b.lon) * Math.cos(a.lat * Math.PI / 180) * 111320, (a.lat - b.lat) * 110540);
  const isMine = r => Object.values(state.spots).some(sp => okLL(sp.lat, sp.lon) && String(sp.name ?? '').trim().toLowerCase() === r.name.trim().toLowerCase() && metres(sp, r) < 75); // already one of your spots
  function askMore(c, explicit) {
    if (!explicit && more.key === c.key) return; // asked already: it answers into the slot
    clearTimeout(more.timer); const my = ++more.n; more.key = c.key; more.st = 'busy'; more.res = [];
    more.timer = setTimeout(async () => {
      const b = (BOXES.find(x => x.area === c.area) || {}).b, v = Geom.unproj(map.cam.x + map.cam.w / 2, map.cam.y + map.cam.w * map.H / map.W / 2), bias = b && v[0] >= b[0] && v[0] <= b[2] && v[1] >= b[1] && v[1] <= b[3] ? v : null; // the view's centre, when it is in that area
      let res;
      try { if (!window.Places) throw new Error('no place search'); res = await window.Places.search(c.term, bias, { explicit, bbox: b || null }); }
      catch (e) { if (my !== more.n) return; if (e.name === 'AbortError') { more.key = more.st = ''; return; } more.st = 'down'; fillMore(); return; } // aborted by the log form's search: asked again on the next render
      if (my !== more.n) return;
      more.res = (res || []).filter(r => !isMine(r)).slice(0, 6); more.st = 'done'; fillMore();
    }, explicit ? 0 : 350);
  }
  // a result's small line: kind · street · district, city
  const placeLine = r => { const p = String(r.where || '').split(' · ').filter(Boolean), w = p.length > 1 ? p.slice(0, -2).concat(p.slice(-2).join(', ')) : p; return [r.osm ? r.osm[0].toUpperCase() + r.osm.slice(1) : '', ...w].filter(Boolean).join(' · '); };
  // the slot: the found places; nothing local and still searching, a quiet line; nothing at all, the miss with Maps and a pin
  function moreHtml(c) {
    if (c.only) return '';
    if (c.link) return c.n ? '' : '<p class="empty">That is not a Maps link.</p>';
    const st = more.key === c.key ? more.st : '', res = st === 'done' ? more.res : [], al = esc(areaLabel(c.area)), label = c.kw ? 'In ' + al : 'More places · ' + al;
    const note = c.kw ? `<p class="fine" style="margin-top:18px">“${esc(c.kw)}” searched the ${al} map.${res.length && state.canWrite ? ' Tap a place to see it on the map and save it as been or want to go.' : ''}</p>` : '';
    if (res.length) return `<h3>${label} <span class="n">${res.length}</span></h3><ul class="rows">${res.map((r, i) => `<li><button type="button" class="row" data-more="${i}"><span class="ic none"></span><span class="nm">${esc(r.name)}<small>${esc(placeLine(r))}</small></span><span class="rt">${state.canWrite ? '<span class="add" role="img" aria-label="Add"><svg viewBox="0 0 16 16"><path d="M8 3v10M3 8h10"/></svg></span>' : ''}</span></button></li>`).join('')}</ul>${note}`;
    if (c.n) return note;
    if (st === 'busy') return '<p class="empty">Searching…</p>';
    return `${c.kw ? `<h3>${label} <span class="n">0</span></h3>` : ''}<p class="empty">Nothing called “${esc(c.shown)}” in the map data for ${al}.</p>
      ${missBtns(c.shown, c.area)}${note}`;
  }
  // the miss's buttons: the name in Apple Maps or Google Maps (with the area's city and state), or a pin dropped in that area
  function missBtns(name, area) {
    const ar = REGIONS[areaRegion(area)], mq = joinQ([name, ar.city || 'San Francisco', ar.st || 'CA']), b = (BOXES.find(x => x.area === area) || {}).b;
    return `<div class="missbtns"><a class="btn primary" href="${esc(appleLink(mq, b ? { sll: ll((b[1] + b[3]) / 2, (b[0] + b[2]) / 2) } : {}))}" target="_blank" rel="noopener">Look it up in Apple Maps</a><a class="btn" href="${esc(mapsLink(mq))}" target="_blank" rel="noopener">Google Maps</a><button type="button" class="btn" data-pin>Drop a pin</button></div>`;
  }
  function fillMore() {
    const c = searchCtx, slot = panel.querySelector('#more'); if (!c || !slot || !state.query) return;
    const html = moreHtml(c); if (slot._html === html) return; slot._html = html; slot.innerHTML = html; wireMore(slot, c);
    const eb = head.querySelector('.eyebrow'), t = c.n + (more.key === c.key && more.st === 'done' ? more.res.length : 0); if (eb) eb.textContent = t ? `Search · ${t} ${t === 1 ? 'result' : 'results'}` : 'Search';
  }
  function wireMore(slot, c) {
    const res = more.res; slot.querySelectorAll('[data-more]').forEach(b => b.addEventListener('click', () => { const r = res[+b.dataset.more]; if (r) addFound(r, c.area); }));
    const p = slot.querySelector('[data-pin]'); if (p) p.addEventListener('click', () => pinFor(c.shown, c.area));
  }
  // a "More places" row: off to its area, the map flies there, and the log form opens with the place picked exactly as from the form's
  // own suggestions (only been or want to go is left to choose). A log that cannot be written only flies the map there
  function addFound(r, area) {
    clearQ(isPhone() ? 'peek' : null); if (areaKey(state.loc.region) !== area) go({ region: areaRegion(area) }, { tap: true, fly: false });
    const [x, y] = Geom.proj([r.lon, r.lat]);
    if (state.canWrite) { startLog({ place: r }); state.pending = { x, y }; map.redraw(); } else { render(); toast(r.name || PIN_NAME, 2600); }
    map.flyTo([x - .01, y - .01, x + .01, y + .01], 1, U * 0.028);
  }
  // the miss's Drop a pin: the log form's own pin drop, in that area, with the name typed
  function pinFor(name, area) { clearQ(null); if (areaKey(state.loc.region) !== area) go({ region: areaRegion(area) }, { tap: true }); startLog({ name, pin: true }); }
  // a pasted Apple or Google Maps link (js/link.js): one group, "From your link", instead of the usual ones, and the link is never sent
  // to the place search. A short link is read by the link helper, once per link (a change of link aborts it); a link that gives only
  // a name searches that name as if it had been typed
  const PIN_NAME = 'Dropped pin'; // a place from a link without a name: the row's name (the form's name is left for the user to type)
  const lnk = { url: '', st: '', got: null, ac: null }; // the short link being read: st 'busy', 'done' (got: a place or a name) or 'fail'
  function dropLink() { if (lnk.ac) lnk.ac.abort(); lnk.url = lnk.st = ''; lnk.got = lnk.ac = null; }
  function readLink(url) {
    if (lnk.url === url) return; dropLink(); const ac = lnk.ac = new AbortController(); lnk.url = url; lnk.st = 'busy';
    Link.read(url, ac.signal).then(got => { if (lnk.ac !== ac) return; lnk.ac = null; lnk.got = got; lnk.st = got ? 'done' : 'fail'; if (state.query) renderSearch(); });
  }
  function renderLink(lk, got) {
    clearTimeout(more.timer); more.n++; more.key = more.st = ''; searchCtx = null; // no place search for a link
    const pl = got && got.t === 'place' ? { name: got.name || lk.name || '', lat: got.lat, lon: got.lon, where: got.where || '' } : null, box = pl && boxAt(pl.lon, pl.lat), here = areaKey(state.loc.region);
    let body, n = 0;
    if (pl && box) {
      const [x, y] = Geom.proj([pl.lon, pl.lat]), w = locateXY(x, y), line = [areaLabel(box.area), w.hood, w.sub].filter(Boolean).join(' · '); n = 1;
      body = `<ul class="rows"><li><button type="button" class="row" data-first data-link><span class="ic none"></span><span class="nm">${esc(pl.name || PIN_NAME)}<small>${esc(line)}</small></span><span class="rt">${state.canWrite ? '<span class="add" role="img" aria-label="Add"><svg viewBox="0 0 16 16"><path d="M8 3v10M3 8h10"/></svg></span>' : ''}</span></button></li></ul>`;
    } else if (pl) body = '<p class="empty">That place is outside your maps.</p>';
    else if (lk.t === 'short' && lnk.st === 'busy') body = '<p class="empty">Reading the link…</p>';
    else body = `<p class="empty">Could not read that link. Open it, then copy the full link from the address bar and paste that.</p>${lk.name ? missBtns(lk.name, here) : ''}`;
    setHead({ eyebrow: n ? 'Search · 1 result' : 'Search', title: 'Search results', compact: true, onBack: () => { clearQ('peek'); render(); } });
    panel.innerHTML = `<h3>From your link</h3>${body}`;
    const b = panel.querySelector('[data-link]'); if (b) b.addEventListener('click', () => addFound(Object.assign(pl, { src: pl.name ? 'search' : 'pin' }), box.area));
    const p = panel.querySelector('[data-pin]'); if (p) p.addEventListener('click', () => pinFor(lk.name, here));
  }
  function renderSearch() {
    if (streetW) streetW.stop(); // (no street map in search: its watcher goes)
    const pasted = q.value.trim(), lk = window.Link ? Link.parse(pasted) : { t: 'other' };
    if (lk.t === 'short') readLink(lk.url); else if (lnk.url) dropLink();
    const got = lk.t === 'short' ? (lnk.st === 'done' ? lnk.got : null) : lk;
    if (lk.t !== 'other' && !(got && got.t === 'name')) return renderLink(lk, got);
    // as typed first (a link's name: as if typed); with no local match, a map keyword at either end searches the rest in that area
    const typed = got && got.t === 'name' ? got.name : pasted, qq = typed.toLowerCase(); let L = localHits(qq, null), kw = null;
    if (!L.n && (kw = mapWord(typed))) L = localHits(kw.rest.toLowerCase(), kw.area);
    const only = AWAY.length ? areaNamed(qq.replace(/[\s,]+/g, ' ')) : null, maps = only ? [only] : []; // just a map's name: a row that opens it
    const { hoods, secs, spots, lms } = L, area = kw ? kw.area : areaKey(state.loc.region), term = kw ? kw.rest : typed;
    const c = searchCtx = { area, kw: kw && kw.word, term, shown: term, only: !!only, link: /https?:\/\//i.test(typed), n: L.n + maps.length, key: area + '|' + term.toLowerCase() }; // link: a link that is not a Maps link, never sent to place search
    if (!c.only && !c.link && term.length >= 3) askMore(c); else if (more.key !== c.key) { clearTimeout(more.timer); more.n++; more.key = more.st = ''; }
    const total = c.n + (more.key === c.key && more.st === 'done' ? more.res.length : 0);
    // the query is already in the field above: the header says how many, and its heading names the panel for assistive tech
    setHead({ eyebrow: total ? `Search · ${total} ${total === 1 ? 'result' : 'results'}` : 'Search', title: 'Search results', compact: true, onBack: () => { clearQ('peek'); render(); } });
    let first = true; const F = () => { const f = first ? 'data-first' : ''; first = false; return f; };
    const slot = moreHtml(c);
    panel.innerHTML = `
      ${maps.length ? `<h3>Maps</h3><ul class="rows">${maps.map(a => `<li><button type="button" class="row" ${F()} data-go='${attr({ region: areaRegion(a) })}'><span class="ic ${areaWalked(a)[0] ? 'flag' : 'none'}"></span><span class="nm">${esc(areaLabel(a))}<small>${esc(areaLine(a))}</small></span><span class="rt"><span class="chev"></span></span></button></li>`).join('')}</ul>` : ''}
      ${hoods.length ? `<h3>Places <span class="n">${hoods.length}</span></h3><ul class="rows">${hoods.map(n => `<li><button type="button" class="row" ${F()} data-go='${attr({ hood: n })}'><span class="ic ${isDone(IDX[n]) ? 'flag' : isWant(IDX[n]) ? 'star' : 'none'}"></span><span class="nm">${esc(n)}<small>${esc(REGIONS[HOODS[IDX[n]].region].label)}</small></span><span class="rt"><span class="chev"></span></span></button></li>`).join('')}</ul>` : ''}
      ${secs.length ? `<h3>Sections <span class="n">${secs.length}</span></h3><ul class="rows">${secs.map(x => `<li><button type="button" class="row" ${F()} data-go='${attr(x)}'><span class="ic sq"></span><span class="nm">${esc(x.sub)}<small>${esc(x.hood)}</small></span><span class="rt"><span class="chev"></span></span></button></li>`).join('')}</ul>` : ''}
      ${lms.length ? `<h3>Landmarks</h3><ul class="rows">${lms.map(l => `<li><button type="button" class="row" ${F()} data-go='${attr({ hood: l.hood })}'><span class="ic sq" style="--c:var(--ink)"></span><span class="nm">${esc(l.name)}<small>${esc(l.hood)}</small></span><span class="rt"><span class="chev"></span></span></button></li>`).join('')}</ul>` : ''}
      ${spots.length ? `<h3>Your spots <span class="n">${spots.length}</span></h3><ul class="rows">${spots.map(id => rowSpot(id, true).replace('class="row"', `class="row" ${F()}`)).join('')}</ul>` : ''}
      <div id="more">${slot}</div>`;
    const sl = panel.querySelector('#more'); sl._html = slot; wireMore(sl, c);
    panel.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', () => clearQ('half'))); // before wire(): go() must see the query cleared
    wire(panel);
  }

  // ---------- tracker ----------
  let docRef = null, writing = Promise.resolve(), lastSent = null;
  const clone = o => JSON.parse(JSON.stringify(o || {}));
  function persist() {
    const spots = {}; for (const id in state.spots) { const { _xy, ...rest } = state.spots[id]; spots[id] = rest; }
    const payload = { hoods: { ...state.done }, want: { ...state.want }, spots, updatedAt: new Date().toISOString() };
    if (state.store !== 'db') { try { localStorage.setItem('sbs-explored', JSON.stringify(payload)); } catch (e) {} }
    if (docRef) { lastSent = payload.updatedAt; writing = writing.then(() => docRef.set(payload)).then(() => true, e => { if (e && e.code === 'invalid_argument') { state.canWrite = false; render(); } setSaveState('Could not save. Try again in a moment.'); console.warn('save failed', e); return false; }); return writing; }
    try { localStorage.setItem('sbs-explored', JSON.stringify(payload)); } catch (e) {}
    return Promise.resolve();
  }
  function setSaveState(t) { const el = $('savestate'); if (el) el.textContent = t; }
  function adopt(body) {
    state.done = bare(clone(body.hoods)); state.want = bare(clone(body.want)); state.spots = bare(clone(body.spots));
    for (const id in state.spots) { const sp = state.spots[id]; if (!sp || typeof sp !== 'object' || Array.isArray(sp)) { delete state.spots[id]; continue; } if (!sp.status) sp.status = 'been'; if (!sp.sub && IDX[sp.hood] != null) { const [x, y] = Geom.proj([sp.lon, sp.lat]); const j = map.subIndexAt(IDX[sp.hood], x, y); if (j >= 0) sp.sub = subs(sp.hood)[j].name; } }
  }
  async function toggleDone(name) {
    if (!state.canWrite) return;
    const k = slug(name), i = IDX[name];
    if (!state.done[k] && needsName()) { await beforeWrite(); if (state.done[k] || state.loc.hood !== name) return; } // the name first; a sync while asking may have walked it already
    const before = stampState(), walking = !state.done[k];
    if (state.done[k]) delete state.done[k]; else { state.done[k] = { at: today(), note: '' }; delete state.want[k]; map.pop(i); }
    if (state.lens === 'done') recolor(true); map.redraw(); render();
    if (state.done[k]) { const after = stampState(); const newStamp = STAMPS.find(s => !s.test(before) && s.test(after)); toast(newStamp ? `Stamp earned: ${newStamp.label}` : `Been to ${name}. +${ft(HOODS[i].max).toLocaleString()} ft`); }
    setSaveState('Saving…'); const ok = await persist(); if (ok !== false) { setSaveState(state.done[k] ? 'Saved' : ''); if (walking && state.done[k] && !walkedEv.has(k)) { walkedEv.add(k); logEvent('place', { id: k, name, hood: name }); } } // still walked once saved (no undo meanwhile), and one event a place a session however often it is toggled
  }
  const walkedEv = new Set();
  async function toggleWant(name) {
    if (!state.canWrite) return; const k = slug(name), i = IDX[name];
    if (!state.want[k] && needsName()) { await beforeWrite(); if (state.want[k] || state.loc.hood !== name) return; }
    if (state.want[k]) delete state.want[k]; else { state.want[k] = { at: today() }; map.pop(i); }
    map.redraw(); render(); setSaveState('Saving…'); if (await persist() !== false) setSaveState('Saved');
  }
  let noteTimer = null;
  function noteInput(name, text) { const k = slug(name); if (!state.done[k]) return; state.done[k].note = text; setSaveState('Saving…'); clearTimeout(noteTimer); noteTimer = setTimeout(async () => { if (await persist() !== false) setSaveState('Saved'); }, 700); }
  let local = null;
  function loadLocal() { try { local = JSON.parse(localStorage.getItem('sbs-explored') || 'null'); } catch (e) {} if (local && local.hoods) adopt(local); }
  async function connectStore() {
    if (!window.claude || !window.claude.use) { connectSync(); return; }
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
  // ---------- hosted site: one shared logbook per secret link ----------
  // The key rides in ?log= so a bookmark or a shared link carries it; a link with a key adopts that log on this device.
  const KEY_RE = /^[A-Za-z0-9_-]{16,80}$/;
  // a log this device leaves is never lost: its key goes to the front of sbs-log-keys-prev (most recent first, distinct, at most 5, never
  // the log open now), whether it is left by Join or by opening a link with another key. The older single slot (sbs-log-key-prev) is
  // read into the list once, then removed. Keys are never shown in the page.
  function prevKeys() {
    let a = null, cur = null, old = null; try { cur = localStorage.getItem('sbs-log-key'); old = localStorage.getItem('sbs-log-key-prev'); a = JSON.parse(localStorage.getItem('sbs-log-keys-prev')); } catch (e) {}
    a = [old, ...(Array.isArray(a) ? a : [])].filter((k, i, s) => typeof k === 'string' && KEY_RE.test(k) && k !== cur && s.indexOf(k) === i).slice(0, 5);
    if (old !== null) try { localStorage.setItem('sbs-log-keys-prev', JSON.stringify(a)); localStorage.removeItem('sbs-log-key-prev'); } catch (e) {}
    return a;
  }
  function keepPrevKey(next) { try { const a = [localStorage.getItem('sbs-log-key'), ...prevKeys()].filter((k, i, s) => k && KEY_RE.test(k) && k !== next && s.indexOf(k) === i).slice(0, 5); localStorage.setItem('sbs-log-keys-prev', JSON.stringify(a)); } catch (e) {} }
  function syncKey() {
    let k = null; try { k = new URLSearchParams(location.search).get('log'); } catch (e) {}
    if (k && KEY_RE.test(k)) { keepPrevKey(k); try { localStorage.setItem('sbs-log-key', k); } catch (e) {} return k; }
    try { k = localStorage.getItem('sbs-log-key'); } catch (e) {}
    if (!k) { k = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)).replace(/-/g, ''); try { localStorage.setItem('sbs-log-key', k); } catch (e) {} }
    try { const u = new URL(location.href); u.searchParams.set('log', k); history.replaceState(history.state, '', u.pathname + u.search + u.hash); } catch (e) {}
    return k;
  }
  function shareLink() { const u = new URL(location.href); u.hash = ''; return u.toString(); }
  async function shareLog() {
    const link = shareLink();
    try { if (navigator.share) { await navigator.share({ title: 'Seven by Seven', text: 'Our logbook', url: link }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(link); toast('Link copied'); } catch (e) { prompt('Copy this link', link); }
  }
  const keyOf = raw => { let k = String(raw || '').trim(); try { const u = new URL(k); k = u.searchParams.get('log') || ''; } catch (e) { const m = k.match(/log=([A-Za-z0-9_-]+)/); if (m) k = m[1]; } return KEY_RE.test(k) ? k : null; };
  function switchLog(k) { keepPrevKey(k); try { localStorage.setItem('sbs-log-key', k); localStorage.removeItem('sbs-explored'); } catch (e) {} location.href = location.pathname + '?log=' + k; }
  // joining another log: the link goes in an in-page dialog that says first that this device switches logs, and that the log it
  // leaves keeps its key here (keepPrevKey). Nothing is replaced until Switch logs is tapped. back: the same dialog, without the
  // field, takes this device back to the log it left last (Settings offers it only when there is one)
  function joinLog(back) {
    back = back === true; const to = back ? prevKeys()[0] : null; if (back && !to) return;
    let dlg = $('join');
    if (!dlg) {
      dlg = document.createElement('dialog'); dlg.id = 'join'; dlg.className = 'who'; dlg.setAttribute('aria-labelledby', 'join-t');
      dlg.innerHTML = `<form method="dialog" id="join-form" novalidate><h2 id="join-t">Join another log?</h2><p>This device will switch to that log: you will see and add to it instead of the one open now. Nothing is deleted, and this device keeps the current log's key so it can come back to it.</p>
        <div class="field"><label for="join-in">The shared link, or its key</label><input id="join-in" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="go" placeholder="Paste the link"></div>
        <p class="err" id="join-err" role="alert" hidden></p>
        <div class="actions"><button type="button" class="btn quiet" id="join-cancel">Cancel</button><button type="submit" class="btn primary">Switch logs</button></div></form>`;
      document.body.appendChild(dlg);
    }
    if (typeof dlg.showModal !== 'function') { const k = back ? (confirm('Go back to the previous log?') ? to : null) : keyOf(prompt('Paste the shared link (or just its key)')); if (k) switchLog(k); return; } // a browser without the dialog: the old prompt
    const inp = dlg.querySelector('#join-in'), err = dlg.querySelector('#join-err'), form = dlg.querySelector('#join-form');
    inp.value = ''; err.hidden = true; inp.parentNode.hidden = back;
    dlg.querySelector('#join-t').textContent = back ? 'Back to the previous log?' : 'Join another log?';
    dlg.querySelector('#join-t + p').textContent = back ? 'This device will switch back to the log it used before this one. Nothing is deleted, and this device keeps the current log\'s key so it can come back to it.' : 'This device will switch to that log: you will see and add to it instead of the one open now. Nothing is deleted, and this device keeps the current log\'s key so it can come back to it.';
    form.onsubmit = e => {
      e.preventDefault(); const k = back ? to : keyOf(inp.value);
      if (!k) { err.textContent = 'That is not a Seven by Seven link.'; err.hidden = false; inp.focus(); return; }
      let cur = null; try { cur = localStorage.getItem('sbs-log-key'); } catch (x) {}
      dlg.close(); if (k === cur) { toast('This device already uses that log'); return; }
      switchLog(k);
    };
    dlg.querySelector('#join-cancel').onclick = () => dlg.close();
    dlg.showModal(); if (!back) inp.focus();
  }
  // ---- the name prompt: an in-page dialog. done(name) runs inside the Save / Skip tap, so a file picker it opens counts as tapped
  function askName(done) {
    let dlg = $('who');
    if (!dlg) {
      dlg = document.createElement('dialog'); dlg.id = 'who'; dlg.className = 'who'; dlg.setAttribute('aria-labelledby', 'who-t');
      dlg.innerHTML = `<form method="dialog" id="who-form"><h2 id="who-t">Who is logging?</h2><p>Your name goes on what you add to this log, so the other phone sees who it was. Change it any time in Settings.</p>
        <div class="field"><label for="who-name">Your name</label><input id="who-name" maxlength="${WHO_MAX}" autocomplete="given-name" enterkeyhint="done" placeholder="First name"></div>
        <div class="actions"><button type="button" class="btn quiet" id="who-skip">Skip</button><button type="submit" class="btn primary">Save</button></div></form>`;
      document.body.appendChild(dlg);
    }
    if (typeof dlg.showModal !== 'function') { whoSet = true; done(who()); return; } // no dialog support: write without a name, ask again next visit
    const inp = dlg.querySelector('#who-name'), form = dlg.querySelector('#who-form'), skip = dlg.querySelector('#who-skip');
    inp.value = who();
    const finish = (name, esc) => { form.onsubmit = skip.onclick = dlg.oncancel = null; setWho(name); if (dlg.open) dlg.close(); done(who(), esc); };
    form.onsubmit = e => { e.preventDefault(); finish(inp.value); };
    skip.onclick = () => finish('');
    dlg.oncancel = e => { e.preventDefault(); finish('', true); }; // Escape: a skip, but not a tap (done is told, so it opens no file picker)
    dlg.showModal(); inp.focus();
  }
  // before a write to a shared log: the name, once per device
  const needsName = () => state.store === 'sync' && state.canWrite && !whoAsked();
  const beforeWrite = () => new Promise(r => needsName() ? askName(r) : r(who()));
  // adding a photo: photos.js opens the picker on the tap, so the first tap asks first, then taps the button again for the user. The
  // hero may have redrawn while the dialog was open: then it is that hero's add button now. After Escape there is no tap to open a
  // picker with, so nothing is replayed (the user taps + Photo again).
  document.addEventListener('click', e => {
    const b = e.target.closest && e.target.closest('[data-ph-add]'); if (!b || b.disabled || !needsName()) return;
    e.preventDefault(); e.stopPropagation(); const h = b.closest('.hero[data-owner]'), owner = h && h.dataset.owner;
    askName((n, esc) => {
      if (esc) return;
      const nb = b.isConnected ? b : [...document.querySelectorAll('.hero[data-owner]')].filter(x => x.dataset.owner === owner).map(x => x.querySelector('[data-ph-add]:not([disabled])')).find(Boolean);
      if (nb && !nb.disabled) nb.click();
    });
  }, true);

  // ---------- what's new: the activity feed beside a shared log ----------
  // logs/<key>-ev/<id> = { t, by, d (device id), k, id, name, hood, n }, written when this device adds a spot, marks one been, walks
  // a place or adds photos, and only once the write itself went through. On open the last 30 are read; the ones by other devices
  // newer than this device's last seen id show at the top of the root panel until Seen. Ids come from the database, so they sort by
  // its clock (no skew between phones). While the app is open the feed's own stream fires on every new event and the feed is read
  // again, and what arrived is toasted.
  // Anyone with the link can write the feed: every field is checked and cut to length, and escaped where it reaches HTML.
  let feed = null, feedKey = null, feedTimer = null, photoOpts = null, feedReq = 0, feedDone = false, newsShown = []; const told = new Set(); // told: events already shown this session (block or toast)
  state.news = []; // unseen events by others, newest first
  const EV_KINDS = bare({ spot: 1, been: 1, photo: 1, place: 1 });
  const EV_KEY = /^-[A-Za-z0-9_-]{19}$/; // a database push id only: a hand-written key ('zzzz') would sort after every real one and hide them
  const evStr = (v, n) => typeof v === 'string' ? v.replace(/[\x00-\x1f\x7f]/g, '').slice(0, n) : '';
  function cleanEv(key, e) {
    if (!EV_KEY.test(key) || !e || typeof e !== 'object' || !Object.hasOwn(EV_KINDS, e.k)) return null;
    return { key, k: e.k, t: evStr(e.t, 40), by: cleanName(evStr(e.by, 80)), d: evStr(e.d, 40), id: evStr(e.id, 120), name: evStr(e.name, 80).trim(), hood: evStr(e.hood, 80), n: e.k === 'photo' ? Math.max(1, Math.min(99, Math.floor(+e.n) || 1)) : 0 };
  }
  function logEvent(k, o) {
    if (!feed || state.store !== 'sync' || !state.canWrite) return;
    const ev = { t: new Date().toISOString(), by: who(), d: deviceId, k, id: String(o.id || '').slice(0, 120), name: String(o.name || '').slice(0, 80), hood: String(o.hood || '').slice(0, 80) };
    if (k === 'photo') ev.n = Math.max(1, o.n | 0);
    feed.push(ev).catch(e => console.warn('event not saved', e));
  }
  const seenId = () => { let s = null; try { s = localStorage.getItem('sbs-seen-' + feedKey); } catch (e) {} return s === '' || EV_KEY.test(s) ? s : null; }; // '': before every event; anything else unknown: never seen
  const setSeen = id => { if (id !== '' && !EV_KEY.test(id)) return; try { localStorage.setItem('sbs-seen-' + feedKey, id); } catch (e) {} };
  function evLine(e) { const by = e.by || 'Someone', nm = e.name || 'a spot'; return e.k === 'photo' ? `${by} added ${e.n === 1 ? 'a photo' : e.n + ' photos'} to ${nm}` : e.k === 'place' ? `${by} has been to ${nm}` : e.k === 'been' ? `${by} went to ${nm}` : `${by} logged ${nm}`; }
  function ago(t) { const d = Date.parse(t), m = (Date.now() - d) / 60000; if (!isFinite(m) || m < -5) return ''; return m < 1 ? 'just now' : m < 60 ? Math.round(m) + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : m < 10080 ? Math.round(m / 1440) + (Math.round(m / 1440) === 1 ? ' day ago' : ' days ago') : niceDate(new Date(d).toISOString().slice(0, 10)); }
  // where a photo owner key points: a spot, a place, or a section
  function ownerLoc(owner) {
    for (const id in state.spots) if (ownerKey.spot(id) === owner) return { spot: id };
    for (const h of NAMES) { if (ownerKey.place(h) === owner) return { hood: h }; for (const s of subs(h)) if (ownerKey.section(h, s.name) === owner) return { hood: h, sub: s.name }; }
    return null;
  }
  function evLoc(e) { // every lookup by own key only: an event's id or hood of '__proto__' or 'constructor' finds nothing
    if ((e.k === 'spot' || e.k === 'been') && Object.hasOwn(state.spots, e.id)) return { spot: e.id };
    if (e.k === 'photo') { const l = ownerLoc(e.id); if (l) return l; }
    if (e.k === 'place' && Object.hasOwn(BY_SLUG, e.id)) return { hood: BY_SLUG[e.id] };
    return Object.hasOwn(IDX, e.hood) ? { hood: e.hood } : null;
  }
  function openEv(e) { const l = evLoc(e); if (l) go(l, { tap: true }); else toast('That is no longer in the log', 2600); }
  const atRoot = () => !state.view && !state.query && !state.quiz && level(state.loc) === 0;
  async function readFeed(live) {
    if (!feed) return; const my = ++feedReq; let d;
    try { d = await feed.recent(30); } catch (e) { console.warn('feed unavailable', e); return; }
    if (my !== feedReq) return; // a later read was asked for: an older answer never replaces it
    if (!feedDone) { feedDone = true; live = false; } // the first answer is the backlog: the block shows it, no toast
    const all = Object.keys(d && typeof d === 'object' ? d : {}).sort().map(k => cleanEv(k, d[k])).filter(Boolean);
    let seen = seenId();
    if (seen === null) { seen = all.length ? all[all.length - 1].key : ''; setSeen(seen); } // first visit on this device: nothing counts as new
    const news = all.filter(e => e.key > seen && e.d !== deviceId).reverse(), arrived = news.filter(e => !told.has(e.key));
    news.forEach(e => told.add(e.key));
    const changed = news.map(e => e.key).join() !== state.news.map(e => e.key).join(); state.news = news;
    const busy = state.view === 'log' || !!($('who') && $('who').open); // a form or the name prompt is open: View would leave it and lose the draft
    if (live && arrived.length) { const e = arrived[0]; toast(evLine(e) + (arrived.length > 1 ? ` and ${arrived.length - 1} more` : ''), 6000, busy ? null : { label: 'View', run: () => openEv(e) }); }
    if (changed && atRoot() && !(document.activeElement && panel.contains(document.activeElement) && document.activeElement.matches('input, textarea'))) render(); // never under someone typing
  }
  const feedSoon = () => { clearTimeout(feedTimer); feedTimer = setTimeout(() => readFeed(true), 250); }; // one read for a burst of stream messages
  // Seen and the lines act on what the block last drew (newsShown), never on a list read since while it could not redraw
  function markSeen() { const top = newsShown[0]; if (top && top.key > (seenId() || '')) setSeen(top.key); state.news = top ? state.news.filter(e => e.key > top.key) : []; render(); }
  function newsBlock() {
    const n = newsShown = state.news; if (!n.length) return '';
    // a written log: the time in a margin column, who in bold, what they did. Every unseen event is here; past about four rows the list scrolls
    return `<section class="news" aria-label="Since you were last here"><div class="news-hd">Since you were here<button type="button" id="news-seen">Seen</button></div>
      <ol class="news-log">${n.map(e => `<li><button type="button" data-news="${esc(e.key)}" title="${esc(evLine(e) + (ago(e.t) ? ', ' + ago(e.t) : ''))}"><time datetime="${esc(e.t)}">${esc(agoShort(e.t))}</time><span><b>${esc(e.by || 'Someone')}</b> ${esc(evWhat(e))}</span></button></li>`).join('')}</ol></section>`;
  }
  // the margin's short time: 12m, 2h, 3d, then the date
  function agoShort(t) { const d = Date.parse(t), m = (Date.now() - d) / 60000; if (!isFinite(m) || m < -5) return ''; return m < 1 ? 'now' : m < 60 ? Math.round(m) + 'm' : m < 1440 ? Math.round(m / 60) + 'h' : m < 10080 ? Math.round(m / 1440) + 'd' : niceDate(new Date(d).toISOString().slice(0, 10)); }
  function evWhat(e) { const nm = e.name || 'a spot'; return e.k === 'photo' ? `+${e.n === 1 ? '1 photo' : e.n + ' photos'}, ${nm}` : e.k === 'place' ? `walked ${nm}` : e.k === 'been' ? `went to ${nm}` : `logged ${nm}`; }
  // photos.js: who adds a photo, what was added (an event), and the capture date of a photo on a been spot (offered, never applied unasked)
  function photoAdded(owner, ids, label) {
    const n = Array.isArray(ids) ? ids.length : ids && typeof ids === 'object' ? Object.keys(ids).length : 0; if (!n) return;
    const l = ownerLoc(owner), hood = l ? (l.spot ? state.spots[l.spot].hood : l.hood) : '';
    logEvent('photo', { id: owner, name: label || (l && l.spot ? state.spots[l.spot].name : l ? l.sub || l.hood : ''), hood, n });
  }
  function photoTaken(owner, date, label) {
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(new Date(date + 'T12:00:00')) || date > today()) return;
    const l = ownerLoc(owner), id = l && l.spot, sp = id && state.spots[id]; if (!sp || sp.status !== 'been' || sp.at === date || !state.canWrite) return;
    const was = sp.at, how = window.Lookback ? Lookback.photoOffer(sp, date) : 'set'; if (!how) return; // the offer is for the date shown now: an edit or a sync since, or a log gone read-only, voids it. how: js/lookback.js (none when it is already a visit; 'add' one more visit on a spot visited more than once)
    toast(`Photo taken ${niceDate(date)}`, 8000, { label: how === 'add' ? `Add ${niceDate(date)} as a visit` : 'Use as the visit date', run: async () => { const s = state.spots[id]; if (!s || s.status !== 'been' || s.at !== was || !state.canWrite) return; const said = window.Lookback ? Lookback.photoDate(s, date, how) : (s.at = date, ''); if (said === null) return; stamped = null; render(); if (await persist() !== false) toast(said || `${s.name}: visited ${niceDate(date)}`); } });
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && feed) readFeed(true); }); // a home-screen app comes back without reloading

  function connectSync() {
    if (!window.Sync || !Sync.ready()) { state.store = 'local'; return; }
    const key = syncKey(); state.store = 'sync';
    if (Sync.events) { feed = Sync.events(key); feedKey = key; }
    if (window.Photos && Sync.photos) Photos.init(photoOpts = { api: Sync.photos(key), toast, canWrite: () => state.canWrite, who, onAdded: photoAdded, onTaken: photoTaken });
    { const sp = state.loc.spot || (state.bootLoc && state.bootLoc.spot); if (sp && window.Photos && Photos.preload) Photos.preload(ownerKey.spot(sp)); } // a #spot-- link: its photos set off now, beside the log, not after it
    let seeded = false, fed = false;
    const unwatch = feed && feed.watch ? feed.watch(feedSoon) : null; // any device's new event (a photo too): read the feed again
    docRef = Sync.connect(key, data => {
      if (!fed) { fed = true; readFeed(false); } // the first record, even our own write coming back: what is new since last time
      if (data && data.updatedAt && data.updatedAt === lastSent) return; // our own write coming back
      if (data) adopt(data);
      else if (!seeded) { seeded = true; if (local && local.hoods && Object.keys(local.hoods).length) persist(); }
      if (state.lens === 'done') recolor(false); map.redraw();
      const boot = state.bootLoc; state.bootLoc = null;
      if (boot && state.spots[boot.spot] && !state.loc.spot) go(boot, { replace: true });
      else if (state.loc.spot && !state.spots[state.loc.spot]) go({ hood: state.loc.hood }, { replace: true }); else render();
    }, e => { console.warn('sync ended', e); if (e && e.code === 'invalid_argument') { state.canWrite = false; if (unwatch) unwatch(); render(); } }); // the log stream closed: the feed's goes too
    render();
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
  // ctx.place: a place from search's "More places", picked as from the form's suggestions (the phone keeps the map in view: half);
  // ctx.pin with ctx.name: search's Drop a pin, the name typed and the pin drop on at once
  function startLog(ctx) {
    const sp = ctx.edit ? state.spots[ctx.edit] : null, pl = ctx.place || null;
    state.draft = sp ? Object.assign({}, sp, { hood: IDX[sp.hood] != null ? sp.hood : null, sub: IDX[sp.hood] != null ? sp.sub : null, id: ctx.edit, x: sp._xy ? sp._xy[0] : null, y: sp._xy ? sp._xy[1] : null }) : { id: null, name: ctx.name || '', kind: 'food', status: 'been', rating: 0, note: '', at: today(), hood: pl ? null : ctx.hood || state.loc.hood || null, sub: pl ? null : ctx.sub || (ctx.hood ? null : state.loc.sub) || null, lon: null, lat: null, x: null, y: null, where: '', src: null };
    // no place chosen (the first screen, a region): most likely it is where you stand, so the location lookup starts at once. With no
    // location (refused, unavailable, timed out, off the map) the form simply stays as it is, with no message
    const d = state.draft; if (pl) pickPlace(d, pl); if (ctx.pin) d.pinning = true; // pinning: no autofocus (on the phone a focus opens the sheet over the map)
    if (!sp && !d.hood && !pl && !ctx.pin && navigator.geolocation) d.locating = true;
    go(state.loc, { view: 'log', fly: false, replace: true, sheet: isPhone() ? (pl ? 'half' : ctx.pin ? 'peek' : 'full') : undefined });
    if (ctx.pin) startPin();
    else if (!sp && !pl) { const qi = panel.querySelector('#lf-q'); if (qi) qi.focus({ preventScroll: true }); } // the name first, still inside the tap (iOS opens the keyboard only for a focus in a tap)
    if (d.locating) locate(pos => { d.locating = false; if (state.draft === d && d.lon == null) fillGps(d, pos); else gpsIdle(d); }, { quiet: true, fail: () => { d.locating = false; gpsIdle(d); } });
  }
  // a location that lands while the form is open changes the form in place, never by a rebuild: that would take what is being typed,
  // the focus (on iOS, the keyboard), the caret and the open suggestions with it. Once the form is saved or left it does nothing.
  const openForm = d => state.draft === d && state.view === 'log' && panel.querySelector('#logform');
  function gpsIdle(d) { const b = openForm(d) && panel.querySelector('#lf-gps'); if (b) { b.disabled = false; b.removeAttribute('aria-busy'); b.textContent = 'Use my location'; } }
  function fillGps(d, pos) {
    if (state.draft !== d) return; const [x, y] = Geom.proj(pos), w = locateXY(x, y); Object.assign(d, { lon: pos[0], lat: pos[1], x, y, hood: w.hood || d.hood, sub: w.sub, src: 'gps', where: 'Your location' });
    const f = !state.placing && openForm(d); if (!f) return; // a pin drop is on: its Back draws the form from the draft
    const qi = f.querySelector('#lf-q'), lb = f.querySelector('label[for="lf-q"]'); if (lb) lb.textContent = 'Place';
    { const o = f.querySelector('#lf-clear'); if (o) o.parentNode.remove(); } qi.insertAdjacentHTML('afterend', whereLine(d)); f.querySelector('#lf-clear').addEventListener('click', () => clearWhere(d));
    for (const el of [f.querySelector('#lf-gps') && f.querySelector('#lf-gps').parentNode, f.querySelector('#lf-hint'), f.querySelector('#lf-actions span')]) if (el) el.remove(); // what a placed form has not
    if (!d.id) { const h = head.querySelector('h2'); if (h) h.innerHTML = d.hood ? `In ${esc(d.sub || d.hood)}` : 'Somewhere on the map'; }
  }
  // the line under the name once the spot has a place: where it is, and 'change' to take the place off again
  const whereLine = d => `<small style="color:var(--muted);font-size:12.5px">${ICON.pin.replace('<svg', '<svg style="width:12px;height:12px;vertical-align:-1px;fill:none;stroke:currentColor;stroke-width:2"')} ${esc(d.where || '')}${(() => { const w = d.where || ''; const parts = [d.sub, d.hood].filter(x => x && !w.includes(x)); const tail = parts.length ? parts.join(', ') : (w ? '' : 'outside the tracked places'); return (w && tail ? ' · ' : '') + esc(tail); })()} <button type="button" class="act" id="lf-clear" style="border:0;background:none;color:var(--accent-deep, var(--accent));font-weight:600;padding:0 0 0 6px">change</button></small>`;
  function clearWhere(d) { d.lon = d.lat = d.x = d.y = null; d.where = ''; d.src = null; renderLogForm(); }
  let sugTimer = null, sugCtrl = 0;
  function renderLogForm() {
    const d = state.draft; if (!d) { state.view = null; render(); return; }
    const placed = d.lon != null;
    setHead({ eyebrow: d.id ? 'Edit spot' : 'Log a place', title: d.id ? esc(d.name) : (d.hood ? `In ${esc(d.sub || d.hood)}` : 'Somewhere on the map'), onBack: cancelLog, tools: [] });
    panel.innerHTML = `<form id="logform" autocomplete="off">
      <div class="field"><label for="lf-q">${placed ? 'Place' : 'Find the place'}</label><input id="lf-q" placeholder="Search a restaurant, bar, park…" value="${esc(d.name)}" ${placed || d.pinning ? '' : 'autofocus'}>
        ${placed ? whereLine(d) : ''}</div>
      <ul class="suggest" id="lf-sug" hidden></ul>
      <p class="empty" id="lf-nosearch" style="font-size:12.5px;margin:-4px 0 10px" ${state.searchDown ? '' : 'hidden'}>Live suggestions are not available here. Press Enter to search, or type the name and drop a pin.</p>
      ${placed ? '' : `<div class="actions" style="margin:0 0 14px"><button type="button" class="btn sm" id="lf-pin">${ICON.pin} Drop a pin on the map</button><button type="button" class="btn sm" id="lf-gps" ${d.locating ? 'disabled aria-busy="true"' : ''}>${d.locating ? 'Finding your location…' : 'Use my location'}</button></div>`}
      <div class="field"><label>Kind</label><div class="seg" id="lf-kind">${Object.entries(KINDS).filter(([k]) => k !== 'other').map(([k, v]) => `<button type="button" data-k="${k}" aria-pressed="${d.kind === k}">${v.label}</button>`).join('')}</div></div>
      <div class="field"><label>Status</label><div class="seg" id="lf-status"><button type="button" data-s="been" aria-pressed="${d.status === 'been'}">Been</button><button type="button" data-s="want" aria-pressed="${d.status === 'want'}">Want to go</button></div></div>
      <div class="two lf-been" id="lf-been" ${d.status === 'been' ? '' : 'hidden'}>
        <div class="field" style="margin:0"><label>Rating</label><div class="rate" id="lf-rate">${[1, 2, 3, 4, 5].map(n => `<button type="button" data-r="${n}" class="${n <= d.rating ? 'on' : ''}" aria-label="${n} star${n > 1 ? 's' : ''}">★</button>`).join('')}</div></div>
        <div class="field lf-when" style="margin:0"><label for="lf-date">When</label><input type="date" id="lf-date" value="${esc(d.at || today())}"></div>
      </div>
      <div class="field"><label for="lf-note">Note</label><textarea id="lf-note" rows="2" placeholder="What to order, who to bring, what to skip">${esc(d.note || '')}</textarea></div>
      ${d.id || placed || !isPhone() ? '' : `<p class="empty" id="lf-hint" style="font-size:12.5px">Without a pin it lands in the middle of ${esc(d.sub || d.hood || 'the map')}.</p>`}
      <div class="actions" id="lf-actions"><button type="submit" class="btn primary">${d.id ? 'Save changes' : 'Save spot'}</button><button type="button" class="btn" id="lf-cancel">Cancel</button>${d.id || placed || isPhone() ? '' : `<span style="font-size:12.5px;color:var(--muted);align-self:center">Without a pin it lands in the middle of ${esc(d.sub || d.hood || 'the map')}.</span>`}</div>
    </form>`;
    const form = panel.querySelector('#logform'), qi = panel.querySelector('#lf-q'), sug = panel.querySelector('#lf-sug');
    qi.addEventListener('input', () => { d.name = qi.value; if (placed && d.src === 'search') return; clearTimeout(sugTimer); const v = qi.value.trim(); if (v.length < 2) { sug.hidden = true; return; } sugTimer = setTimeout(() => suggest(v, sug, qi, false), 280); });
    qi.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); clearTimeout(sugTimer); const first = sug.querySelector('[data-i]'); if (first && !sug.hidden) first.click(); else if (qi.value.trim().length >= 2 && !(placed && d.src === 'search')) suggest(qi.value.trim(), sug, qi, true); } });
    panel.querySelectorAll('#lf-kind [data-k]').forEach(b => b.addEventListener('click', () => { d.kind = b.dataset.k; panel.querySelectorAll('#lf-kind [data-k]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); }));
    panel.querySelectorAll('#lf-status [data-s]').forEach(b => b.addEventListener('click', () => { d.status = b.dataset.s; panel.querySelectorAll('#lf-status [data-s]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); panel.querySelector('#lf-been').hidden = d.status !== 'been'; }));
    panel.querySelectorAll('#lf-rate [data-r]').forEach(b => b.addEventListener('click', () => { d.rating = d.rating === +b.dataset.r ? 0 : +b.dataset.r; panel.querAll = null; panel.querySelectorAll('#lf-rate [data-r]').forEach(x => x.classList.toggle('on', +x.dataset.r <= d.rating)); }));
    panel.querySelector('#lf-date').addEventListener('change', e => d.at = e.target.value || today());
    panel.querySelector('#lf-note').addEventListener('input', e => d.note = e.target.value);
    panel.querySelector('#lf-cancel').addEventListener('click', cancelLog);
    const clr = panel.querySelector('#lf-clear'); if (clr) clr.addEventListener('click', () => clearWhere(d));
    const pin = panel.querySelector('#lf-pin'); if (pin) pin.addEventListener('click', startPin);
    const gps = panel.querySelector('#lf-gps'); if (gps) gps.addEventListener('click', () => locate(pos => { if (state.draft === d) fillGps(d, pos); }));
    form.addEventListener('submit', e => { e.preventDefault(); saveDraft(); });
  }
  function startPin() { state.placing = true; state.pending = null; stage.classList.add('placing'); if (isPhone()) sheet.set('peek'); setHead({ eyebrow: 'Drop a pin', title: 'Tap the map', onBack: () => { stopPlacing(); renderLogForm(); if (isPhone()) sheet.set('full'); }, tools: [] }); toast('Tap the map where it is', 3200); map.redraw(); }
  // a place picked from place search (the form's suggestions, search's "More places"): its name, where and kind, and the place and
  // section it is in. r.src: a pasted link's place without a name is a pin ('pin'); everything else is a search pick
  function pickPlace(d, r) { const [x, y] = Geom.proj([r.lon, r.lat]), w = locateXY(x, y); Object.assign(d, { name: r.name, lon: r.lon, lat: r.lat, x, y, where: r.where, src: r.src || 'search', hood: w.hood || d.hood, sub: w.sub, kind: r.kind || d.kind }); }
  async function suggest(v, sug, qi, explicit) {
    const my = ++sugCtrl, d = state.draft; let res = []; if (!d) return; // the form was saved or left before the typing pause ended
    const bias = d.hood ? (() => { const bb = map.hoodBBox(IDX[d.hood]); return Geom.unproj((bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2); })() : null;
    const at = bias || Geom.unproj(map.cam.x + map.cam.w / 2, map.cam.y + map.cam.w * map.H / map.W / 2), box = boxAt(at[0], at[1]); // search the area of the chosen place, else of the map view
    try { res = await window.Places.search(v, bias, { explicit, bbox: box ? box.b : null }); } catch (e) { if (e.name === 'AbortError') return; sug.hidden = true; if (!state.searchDown) { state.searchDown = true; const n = panel.querySelector('#lf-nosearch'); if (n) n.hidden = false; } return; }
    if (window.Places.search.photonDown && !state.searchDown) { state.searchDown = true; const n = panel.querySelector('#lf-nosearch'); if (n) n.hidden = false; }
    if (my !== sugCtrl || !state.draft || state.view !== 'log') return;
    if (!res.length) { sug.hidden = true; return; }
    sug.hidden = false; sug.innerHTML = res.map((r, i) => `<li><button type="button" data-i="${i}"><span><b>${esc(r.name)}</b><small>${esc(r.where)}</small></span><span class="k">${esc(r.osm)}</span></button></li>`).join('');
    sug.querySelectorAll('[data-i]').forEach(b => b.addEventListener('click', () => { pickPlace(d, res[+b.dataset.i]); renderLogForm(); }));
  }
  function placePending(xy) {
    const tEl = $('toast'); tEl.classList.remove('on'); clearTimeout(toastTimer); // the 'tap the map' hint is done
    const [x, y] = xy, [lon, lat] = Geom.unproj(x, y), w = locateXY(x, y), d = state.draft;
    state.placing = false; stage.classList.remove('placing');
    if (!d) { state.draft = { id: null, name: '', kind: 'food', status: 'been', rating: 0, note: '', at: today(), lon, lat, x, y, hood: w.hood, sub: w.sub, src: 'pin', where: '' }; }
    else Object.assign(d, { lon, lat, x, y, hood: w.hood || d.hood, sub: w.sub, src: 'pin', where: '' });
    state.pending = { x, y };
    go(state.loc, { view: 'log', fly: false, replace: true, sheet: isPhone() ? 'half' : undefined }); // phone: half, so the pin stays in view above the form
    if (isPhone()) map.flyTo([x - .01, y - .01, x + .01, y + .01], 1, U * 0.028);
  }
  function stopPlacing() { state.placing = false; state.pending = null; stage.classList.remove('placing'); map.redraw(); }
  function cancelLog() { const d = state.draft; state.draft = null; stopPlacing(); if (d && d.id) go({ spot: d.id }, { replace: true, fly: false }); else go(state.loc, { replace: true, fly: false }); }
  async function saveDraft() {
    const d = state.draft; if (!d) return; const name = (d.name || '').trim(); if (!name) { panel.querySelector('#lf-q').focus(); return; }
    const di = panel.querySelector('#lf-date'); if (di) d.at = di.value || today(); // the field as it is now: iOS may not have fired change before the tap
    if (needsName()) { await beforeWrite(); if (state.draft !== d) return; }
    if (d.lon == null) { // no pin: the centre of the section, or the neighborhood
      let x, y; if (d.hood && d.sub && subByName(d.hood, d.sub)) [x, y] = subByName(d.hood, d.sub).c; else if (d.hood) { const h = HOODS[IDX[d.hood]]; x = h.cx; y = h.cy; } else { const c = map.cam; x = c.x + c.w / 2; y = c.y + c.w * map.H / map.W / 2; }
      x += (Math.random() - .5) * 0.6; y += (Math.random() - .5) * 0.6; const [lon, lat] = Geom.unproj(x, y); const w = locateXY(x, y); Object.assign(d, { lon, lat, x, y, hood: w.hood || d.hood, sub: w.sub || d.sub, src: 'approx' });
    }
    const id = d.id || ('s' + Date.now().toString(36)), prev = d.id ? state.spots[d.id] : null;
    const by = prev ? cleanName(prev.by) : who(), was = prev ? prev.status : null; // by: who first logged it, kept through every edit
    state.spots[id] = { ...(by ? { by } : {}), name: name.slice(0, 80), kind: KINDS[d.kind] ? d.kind : 'other', status: d.status === 'want' ? 'want' : 'been', rating: d.status === 'been' ? (d.rating | 0) : 0, note: (d.note || '').trim().slice(0, 400), lon: +d.lon.toFixed(5), lat: +d.lat.toFixed(5), hood: d.hood, sub: d.sub || null, at: d.at || today(), where: (d.where || '').slice(0, 120), src: d.src || null };
    const said = window.Lookback ? Lookback.carry(prev, state.spots[id]) : ''; // the date edits the latest visit (js/lookback.js keeps spot.visits)
    state.draft = null; state.pending = null; state.placing = false; stage.classList.remove('placing');
    toast(said || (d.id ? 'Saved' : `${name} logged`)); setSaveState('Saving…'); const ok = await persist(); go({ spot: id }, { replace: true }); if (ok !== false) setSaveState('Saved');
    if (ok !== false && state.spots[id]) { const s = state.spots[id], k = !prev ? 'spot' : was === 'want' && s.status === 'been' ? 'been' : null; if (k) logEvent(k, { id, name: s.name, hood: s.hood }); }
  }
  async function removeSpot(id) { const sp = state.spots[id]; if (!sp) return; delete state.spots[id]; go({ hood: sp.hood, sub: sp.sub }, { replace: true, fly: false }); map.redraw(); const ok = await persist(); if (ok !== false && state.store === 'sync' && window.Photos) { try { Photos.removeAll(ownerKey.spot(id)); } catch (e) {} } toast(`${sp.name} removed`); } // its photos go too, best effort, once the delete is saved

  // ---------- where am I ----------
  // o.quiet: no message on failure, o.fail() instead (the log form's own lookup)
  function locate(onPos, o = {}) {
    const btn = $('locate');
    if (!navigator.geolocation) { if (o.quiet) { if (o.fail) o.fail(); } else toast('Location is not available here', 3000); return; }
    btn.classList.add('busy');
    navigator.geolocation.getCurrentPosition(pos => {
      btn.classList.remove('busy'); const lon = pos.coords.longitude, lat = pos.coords.latitude;
      if (!boxAt(lon, lat)) { if (o.quiet) { if (o.fail) o.fail(); } else toast('You are outside the map', 3000); return; }
      const [x, y] = Geom.proj([lon, lat]); map.setMe([x, y]);
      if (onPos) { onPos([lon, lat]); return; }
      const w = locateXY(x, y);
      if (w.hood) { toast('You are in ' + (w.sub ? w.sub + ', ' + w.hood : w.hood), 3000); go(w.sub ? { hood: w.hood, sub: w.sub } : { hood: w.hood }, { fromMap: true }); }
      else { toast('You are here', 3000); map.flyTo([x - .01, y - .01, x + .01, y + .01], 1, U * 0.08); }
    }, err => {
      btn.classList.remove('busy'); if (o.quiet) { if (o.fail) o.fail(); return; } const framed = window.top !== window.self;
      if (err.code === 1 && framed) toast('Location is blocked inside this frame. Open the app on its own.', 3600); else toast(err.code === 1 ? 'Location permission was refused' : 'Could not get a location', 3000);
    }, { enableHighAccuracy: true, timeout: o.quiet ? 10000 : 12000, maximumAge: 60000 });
  }
  $('locate').addEventListener('click', () => locate());

  // ---------- suggest & quiz ----------
  // from the first screen both stay in the Bay Area: an away region's places are suggested, and asked, from that region's own screen
  const inPlay = i => inRegion(i) && (state.loc.region !== 'all' || !AWAY.includes(HOODS[i].region));
  function surprise() {
    let pool = HOODS.map((h, i) => i).filter(i => inPlay(i) && (state.filters.size ? matches(i) : true));
    const fresh = pool.filter(i => !isDone(i)); if (fresh.length) pool = fresh;
    pool = pool.filter(i => HOODS[i].name !== state.loc.hood); if (!pool.length) return;
    go({ hood: HOODS[pool[Math.floor(Math.random() * pool.length)]].name });
  }
  // The quiz: ten places of the region in play, one at a time. The question is pinned on the map (#qz: under the map chip, beside
  // the controls); on the phone the sheet drops to its peek and carries only the hint and Quit. The place about to be picked is
  // tinted (map.js: under the pointer, or under a finger held down; the answer is taken on release). An answer shows at once on the
  // map: the right place green with its name and a check, and after a miss the tapped place red with its own name and a cross, with
  // both brought into view. A right answer moves on by itself; a miss waits for Next (Enter or Space, or a tap on the green place)
  const QZ_NEXT_MS = 1200, QZ_OK = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8.5l3 3 7-7"/></svg>', QZ_NO = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>';
  let qzEl = null;
  const quizMap = { // what map.js asks while state.quiz is set
    pick(i) { const q = state.quiz; return !!q && q.round < q.rounds && (!q.locked || (q.miss && HOODS[i].name === q.order[q.round])); },
    marks() { return state.quiz ? state.quiz.marks : []; },
    top() { return qzEl && !qzEl.hidden ? qzEl.getBoundingClientRect().bottom : 0; },
  };
  function quizFill(name) {
    const q = state.quiz;
    if (q.round >= q.rounds) { const r = q.order.indexOf(name); return r < 0 ? 'var(--grey-fill)' : q.results[r] ? 'var(--qz-ok)' : 'var(--qz-no)'; } // the end: the round, found and missed
    return !q.locked ? 'var(--grey-fill)' : name === q.order[q.round] ? 'var(--qz-ok)' : name === q.picked ? 'var(--qz-no)' : 'var(--grey-fill)';
  }
  // fly to bb with its top clear of the prompt (fit, then fit again with the shortfall added above, in map units)
  function quizFit(bb, pad = 1.08, minW = 0, dur) {
    const b = bb.slice(), need = quizMap.top() + 10; let v;
    for (let n = 0; n < 3; n++) { v = map.fitView(b[0], b[1], b[2], b[3], pad, minW); const k = map.W / v.w, sy = map.is3d ? Math.min(map.toScreen(bb[0], bb[1], v, bb)[1], map.toScreen(bb[2], bb[1], v, bb)[1]) : (bb[1] - v.y) * k; if (sy >= need - 1) break; b[1] -= (need - sy) / k; } // the 3D map: the top corners as it would draw them, at the top of the blocks there
    map.flyToView(v, dur);
  }
  // after a miss: both places on screen, clear of the prompt, the sheet and the edges, and the right one big enough to see; else fly to them
  function quizShow(names) {
    const k = map.k, c = map.cam, top = quizMap.top() + 6, bottom = map.H - (isPhone() ? sheet.visible : 0) - 8, right = isPhone() ? map.W - 4 : sheetEl.getBoundingClientRect().left - 8;
    const bbs = names.map(n => map.hoodBBox(IDX[n])), u = [Math.min(...bbs.map(b => b[0])), Math.min(...bbs.map(b => b[1])), Math.max(...bbs.map(b => b[2])), Math.max(...bbs.map(b => b[3]))];
    const on = b => { if (!map.is3d) return [(b[0] - c.x) * k, (b[1] - c.y) * k, (b[2] - c.x) * k, (b[3] - c.y) * k]; const q = [[b[0], b[1]], [b[2], b[1]], [b[0], b[3]], [b[2], b[3]]].flatMap(([x, y]) => [map.toScreen(x, y), map.toScreen(x, y, undefined, b)]); return [Math.min(...q.map(p => p[0])), Math.min(...q.map(p => p[1])), Math.max(...q.map(p => p[0])), Math.max(...q.map(p => p[1]))]; }; // the 3D map: the box's corners as drawn, on the ground and at the top of the blocks there
    const seen = bbs.every((b, j) => { const [x0, y0, x1, y1] = on(b); return x0 >= 4 && x1 <= right && y0 >= top && y1 <= bottom && (j === 0 || Math.max(x1 - x0, y1 - y0) >= 24); });
    if (!seen) { quizFit(u, 1.3, U * 0.05); state.quiz.moved = true; }
  }
  // the prompt on the map: the question, then the answer; a row of ten dots (green, red, empty) and "3 of 10 · 2 right"
  // answered: right after an answer (the Next button takes the focus, and a miss shakes the card: its class changes only then).
  // The status line is made once and only its content changes, so a screen reader announces each answer
  function quizPrompt(answered) {
    const qz = state.quiz;
    if (!qz || qz.round >= qz.rounds) { if (qzEl) qzEl.hidden = true; return; }
    if (!qzEl) { qzEl = document.createElement('div'); qzEl.className = 'qz'; qzEl.id = 'qz'; qzEl.innerHTML = '<div class="qz-card"><p class="qz-q" role="status" aria-live="polite"></p></div>'; $('app').appendChild(qzEl); }
    const t = qz.order[qz.round], done = qz.round + (qz.locked ? 1 : 0);
    const q = !qz.locked ? `<span class="qz-find">Find</span> <b>${esc(t)}</b>` : !qz.miss ? `<span class="qz-ico ok">${QZ_OK}</span>Yes, <b>${esc(t)}</b>` : `<span class="qz-ico no">${QZ_NO}</span><span class="qz-miss">That was <b class="no">${esc(qz.picked)}</b>. <b class="ok">${esc(t)}</b> is in green.</span>`;
    const dots = qz.order.map((n, r) => `<i class="${r < done ? (qz.results[r] ? 'ok' : 'no') : r === qz.round ? 'now' : ''}"></i>`).join('');
    qzEl.hidden = false;
    const card = qzEl.firstChild, st = card.firstChild, rest = `<div class="qz-sub"><span class="qz-dots" aria-hidden="true">${dots}</span><span>${qz.round + 1} of ${qz.rounds} · ${qz.score} right</span></div>${qz.miss ? '<button type="button" class="btn primary qz-next" id="next">Next</button>' : ''}`;
    card.className = `qz-card ${!qz.locked ? '' : qz.miss ? 'is-no' : 'is-ok'}`;
    if (st._q !== q) { st._q = q; st.innerHTML = q; }
    if (card._rest !== rest) { card._rest = rest; while (st.nextSibling) st.nextSibling.remove(); st.insertAdjacentHTML('afterend', rest); const nx = qzEl.querySelector('#next'); if (nx) nx.addEventListener('click', nextClick); } // unchanged (a sync's re-render): left alone, focus and all
    const nx = qzEl.querySelector('#next'); if (nx && answered && !isPhone()) nx.focus({ preventScroll: true });
  }
  // Next as a button: not in the first 450 ms after a miss, when the click a phone sends after a tap can land on the Next that just
  // appeared under the finger (a tap near the prompt) and skip the answer before it is seen
  const nextClick = () => { const q = state.quiz; if (q && q.missAt && performance.now() - q.missAt < 450) return; nextRound(); };
  function startQuiz() {
    const pool = NAMES.filter(n => inPlay(IDX[n])), rounds = Math.min(10, pool.length);
    const order = pool.slice(); for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    if (state.quiz) clearTimeout(state.quiz.timer);
    state.quiz = { order: order.slice(0, rounds), rounds, round: 0, score: 0, locked: false, miss: false, picked: null, results: [], marks: [], timer: 0, moved: false, region: state.loc.region, askedAt: performance.now() };
    map.setState({ quiz: quizMap, sel: -1, selSub: -1 }); recolor(true); go({ region: state.loc.region }, { keepQuiz: true, replace: true, sheet: isPhone() ? 'peek' : undefined });
    quizFit(map.regionBBox(state.quiz.region));
  }
  function endQuiz(silent) { if (state.quiz) clearTimeout(state.quiz.timer); if (window.Confetti) Confetti.stop(); state.quiz = null; quizPrompt(); map.setState({ quiz: false }); map.setHover(-1, -1, null); recolor(true); if (!silent) go({ region: state.loc.region }, { replace: true }); }
  function renderQuiz(answered) {
    const qz = state.quiz; if (!qz) return; if (streetW) streetW.stop(); // (nor in the quiz)
    quizPrompt(answered); if (state.query) return; // search open: the card keeps up, the panel and header stay the search's (render() rebuilds them when it closes)
    if (qz.round >= qz.rounds) {
      const s = qz.score, away = AWAY.includes(qz.region), rank = s >= 10 ? (away ? 'Pit boss' : 'Muni operator') : s >= 8 ? 'Certified local' : s >= 5 ? 'Transplant, two years in' : s >= 2 ? 'Tourist with a good map' : away ? 'Just landed at Harry Reid' : 'Just landed at SFO';
      const missed = qz.order.filter((n, r) => !qz.results[r]);
      setHead({ eyebrow: 'Where is it?', title: `${s} out of ${qz.rounds}`, onBack: () => endQuiz(), tools: [] });
      panel.innerHTML = `<div class="quiz"><p class="verdict good">${rank}</p><p class="lead">${s === qz.rounds ? (away ? 'Perfect. You could find the exit from any casino floor.' : 'Perfect. You could give the fog directions.') : 'Play again to meet the ones you missed.'}</p>${missed.length ? `<p class="qz-mh">Missed (red on the map)</p><ul class="qz-missed">${missed.map(n => `<li><button type="button" data-qz-miss="${esc(n)}"><span class="qz-ico no">${QZ_NO}</span><b>${esc(n)}</b><small>Show it</small></button></li>`).join('')}</ul>` : ''}<div class="actions"><button type="button" class="btn primary" id="again">Play again</button><button type="button" class="btn" id="done">Back to the map</button></div></div>`;
      panel.querySelector('#again').addEventListener('click', startQuiz); panel.querySelector('#done').addEventListener('click', () => endQuiz());
      panel.querySelectorAll('[data-qz-miss]').forEach(b => b.addEventListener('click', () => { // its name on the map, and the map on it
        const i = IDX[b.dataset.qzMiss]; qz.marks = qz.order.map((n, r) => IDX[n] === i ? { i, ok: false, name: true, t0: performance.now() } : { i: IDX[n], ok: !!qz.results[r], dot: true }); map.redraw(); // the whole round again: only the place shown carries its name
        panel.querySelectorAll('[data-qz-miss]').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
        const bb = map.hoodBBox(i); quizFit(bb, isPhone() ? 2.2 : 2.6, U * 0.06);
      }));
      return;
    }
    const target = qz.order[qz.round], hint = esc(INFO[target].line), verdict = !qz.locked ? 'Tap it on the map.' : qz.miss ? `No, that was ${esc(qz.picked)}. ${esc(target)} is in green.` : `Yes, that is ${esc(target)}.`;
    if (isPhone()) setHead({ eyebrow: 'Hint', title: `<span class="qz-hint">${hint}</span>`, onBack: () => endQuiz(), tools: [{ id: 'qz-quit', label: 'Quit the quiz', icon: 'Quit', run: () => endQuiz() }] });
    else setHead({ eyebrow: `Where is it? · ${qz.round + 1} of ${qz.rounds}`, title: esc(target), onBack: () => endQuiz(), tools: [] });
    panel.innerHTML = `<div class="quiz"><div class="score">Score ${qz.score}</div><div class="bar"><i style="width:${((qz.round + (qz.locked ? 1 : 0)) / qz.rounds) * 100}%"></i></div><p class="verdict ${!qz.locked ? '' : qz.miss ? 'bad' : 'good'}">${verdict}</p><p style="color:var(--muted);margin:0">Hint: ${hint}</p><div class="actions" style="margin-top:14px">${qz.miss ? '<button type="button" class="btn primary" id="qz-next2">Next</button>' : ''}<button type="button" class="btn quiet" id="quit">Quit</button></div></div>`;
    const nx = panel.querySelector('#qz-next2'); if (nx) nx.addEventListener('click', nextClick); panel.querySelector('#quit').addEventListener('click', () => endQuiz());
    if (isPhone() && sheet.detent === 'peek') sheet.set('peek', { quiet: true }); // the peek is the header's height, and the hint changes it
  }
  function answer(name) {
    const qz = state.quiz; if (!qz || qz.round >= qz.rounds) return; const target = qz.order[qz.round];
    if (qz.locked) { if (qz.miss && name === target) nextRound(); return; } // after a miss the green place is Next too; any other tap waits
    const ok = name === target, t0 = performance.now();
    qz.locked = true; qz.miss = !ok; qz.missAt = ok ? 0 : t0; qz.picked = name; qz.results[qz.round] = ok; if (ok) qz.score++;
    qz.marks = ok ? [{ i: IDX[target], ok: true, name: true, t0 }] : [{ i: IDX[name], ok: false, name: true, t0 }, { i: IDX[target], ok: true, name: true, t0 }];
    recolor(false); map.setHover(-1, -1, null); stage.classList.remove('pointing');
    renderQuiz(true);
    if (ok) { if (window.Confetti) Confetti.burst({ count: 60, duration: 1.4 }); const r = qz.round; qz.timer = setTimeout(() => { if (state.quiz === qz && qz.round === r) nextRound(); }, QZ_NEXT_MS); }
    else quizShow([name, target]);
  }
  function nextRound() {
    const qz = state.quiz; if (!qz || !qz.locked) return; clearTimeout(qz.timer);
    qz.round++; qz.locked = false; qz.miss = false; qz.picked = null; qz.askedAt = performance.now();
    const end = qz.round >= qz.rounds;
    qz.marks = end ? qz.order.map((n, r) => ({ i: IDX[n], ok: !!qz.results[r], dot: true })) : [];
    recolor(false); map.setHover(-1, -1, null); renderQuiz();
    if (end) { if (isPhone()) sheet.set('half', { quiet: true }); quizFit(map.regionBBox(qz.region)); }
    else if (qz.moved) { qz.moved = false; quizFit(map.regionBBox(qz.region)); } // a miss flew to show both places: back to the whole region for the next one
  }
  // keys while the quiz is on: Escape quits (before the global handler, which would also step up a level), or first closes the map
  // chip's menu (the focus back on the chip); Enter or Space is Next after a miss
  window.addEventListener('keydown', e => {
    const el = e.target instanceof Element ? e.target : document.body; if (!state.quiz || dialogOpen() || el.matches('input, textarea, select')) return;
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); if (areasOpen()) openAreas(false, true); else endQuiz(); }
    else if ((e.key === 'Enter' || e.key === ' ') && state.quiz.miss && !el.closest('button, a')) { e.preventDefault(); nextRound(); }
  }, true);

  // ---------- boot ----------
  window.HPP = []; window.HP.forEach(h => { window.HPP[IDX[h.name]] = h.polys.map(poly => poly.map(ring => ring.map(Geom.proj))); });
  function start(saved) {
    renderLenses(); recolor(false);
    const fromHash = (saved && saved.loc) || (!location.hash && state.lastArea ? { region: state.lastArea } : parseHash(location.hash)); // no link to follow: the area the app was left in
    loadLocal(); // spots must be known before a #spot-- link can resolve
    state.loc = normalize(fromHash); state.bootLoc = fromHash.spot && !state.loc.spot ? fromHash : null;
    sheet.set(isPhone() ? (level(state.loc) >= 2 ? 'half' : 'peek') : 'full', { instant: true, quiet: true });
    map.setState({ region: state.loc.region, sel: state.loc.hood ? IDX[state.loc.hood] : -1, selSub: state.loc.sub ? subIndex(state.loc.hood, state.loc.sub) : -1 });
    try { if (!state.bootLoc) history.replaceState({ loc: state.loc, s: SESSION, n: 0 }, '', location.pathname + location.search + hashOf(state.loc)); } catch (e) {}
    goFly = level(state.loc) >= 2; render(); goFly = false; // a deep link flies in below: its street map waits for that
    if (isPhone()) sheet.set(sheet.detent, { instant: true, quiet: true }); // the peek is the header's height, known only now
    { // synchronously, so the very first frame is already the fitted view
      const l = state.loc; const v = l.hood ? null : fitClear(map.regionBBox(l.region), 1.06, 0, regionPolys(l.region)); if (v) { map.jumpTo(v); } else { const bb = map.regionBBox(l.region); map.jumpTo(map.fitView(bb[0], bb[1], bb[2], bb[3], 1.06, 0)); flyToLoc(900); }
    }
    connectStore();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { map.redraw(); fitHead(); }); // the path folds by measured width: measure again in the real font
  }
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { syncThemeColor(); map.refreshPalette(); recolor(false); if (window.StreetMap) StreetMap.restyle(); });
  let wasPhone = isPhone();
  window.addEventListener('resize', () => { map.resize(); map.redraw(); if (isPhone() !== wasPhone) { wasPhone = isPhone(); if (state.quiz) renderQuiz(); else if (state.placing) fitHead(); else render(); } else fitHead(); }); // across the breakpoint the first screen reorders its panel, and the quiz's header and card change layout (not mid pin-drop, whose header a render replaces) // resize() also catches a devicePixelRatio change (browser zoom)
  if (window.Lookback) Lookback.init({ state, panel, go, render, persist, beforeWrite, toast, setHead, esc, attr, KINDS, IDX, BY_SLUG, ownerKey, cleanName, niceDate, isPhone, look: vibeLook, VERDICT });
  window.__sbs = { map, state, go, sheet, maps: { spotQuery, areaQuery, mapsLink, appleLink, spotApple, areaApple }, photos: window.Photos ? Object.assign(Object.create(window.Photos), { ownerKey }) : null, get photoOpts() { return photoOpts; }, feed: { read: readFeed, get news() { return state.news; } } }; // for tests and the console
  window.claude?.hot?.snapshot?.(() => ({ loc: state.loc }));
  window.claude?.hot?.ready ? window.claude.hot.ready(start) : start(window.claude?.hot?.data ?? {});
})();
