// Place details on a spot's page: opening hours, cuisine, website, phone and a few plain facts, from OpenStreetMap through the
// Overpass API (keyless; it answers a browser with CORS headers). A polite client: one small query per spot, asked only when the
// spot's page has stayed open 600 ms (never for a list or the map), one request in flight, 1.5 s between requests, a 10 s
// timeout, no retries. The answer, or "nothing found", is kept on this device per spot for 30 days (localStorage, at most 300
// spots) and asked again after that or when the spot's name, position or OpenStreetMap id changes. Nothing is written to the
// log: details are fetched data, not the couple's. Everything from OpenStreetMap is untrusted text: escaped, capped, and a URL
// only after validation. app.js puts an empty slot in the spot panel and calls mount(); the block appears when it is ready.
(function () {
  const API = 'https://overpass-api.de/api/interpreter', WAIT = 600, GAP = 1500, TIMEOUT = 10000, TTL = 30 * 864e5, MAX = 300, KEY = 'sbs-details-v1';
  const NEAR = 60, NEAR_AREA = 250, LINE = 200, OH_MAX = 1000, TZ = 'America/Los_Angeles', RETRY_AFTER = 5 * 60e3;
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const own = (o, k) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
  // one line of text: no control characters, spaces collapsed, at most n characters (an ellipsis marks a cut)
  const cap = (s, n = LINE) => { const a = [...String(s ?? '').replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim()]; return a.length > n ? a.slice(0, n - 1).join('') + '…' : a.join(''); };
  let opts = { ok: () => true, isOpen: () => null };

  // ---------- opening_hours: the common subset ----------
  // Day ranges and lists (Mo-Fr, Sa,Su, Fr-Mo), several time ranges per rule, ';' rules where a later rule replaces the days it
  // names, ',' additional rules that add to them, off/closed, 24/7, times past midnight (18:00-02:00, 18:00-26:00), and PH rules
  // (kept for the week, never used for open now). Anything else (months, weeks, sunrise, comments, '||', open ends) is "unknown":
  // the raw text is shown and no claim is made. Pure; never throws.
  const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'], DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const TOK = /\s*(?:(Mo|Tu|We|Th|Fr|Sa|Su|PH)(?![a-z])|(\d{1,2}):(\d{2})(?!\d)|([-‐-―])|(,)|(off|closed|open)(?![a-z]))/iy;
  function tokens(s) {
    const out = []; TOK.lastIndex = 0;
    while (TOK.lastIndex < s.length) {
      const at = TOK.lastIndex, m = TOK.exec(s);
      if (!m) { if (/^\s*$/.test(s.slice(at))) break; return null; }
      if (m[1]) { const d = m[1][0].toUpperCase() + m[1][1].toLowerCase(); out.push(d === 'Ph' ? { d: 'PH' } : { d, n: DAYS.indexOf(d) }); }
      else if (m[2] != null) { const h = +m[2], mi = +m[3]; if (h > 48 || mi > 59) return null; out.push({ tm: h * 60 + mi }); }
      else if (m[4]) out.push({ dash: 1 }); else if (m[5]) out.push({ comma: 1 }); else out.push({ st: m[6].toLowerCase() });
    }
    return out;
  }
  // one ';' rule (which may hold ',' additional rules) into sub-rules { days, ph, times, off, add }; false: outside the subset
  function parseRule(s, out) {
    const t = tokens(s); if (!t || !t.length) return false;
    let i = 0, add = false;
    while (i < t.length) {
      let days = null, ph = false, state = null; const times = [];
      if (t[i].d) {
        days = new Set();
        for (;;) {
          const a = t[i]; if (!a || !a.d) return false; i++;
          if (a.d === 'PH') ph = true;
          else if (t[i] && t[i].dash && t[i + 1] && t[i + 1].d && t[i + 1].d !== 'PH') { const b = t[i + 1]; i += 2; for (let k = a.n, n = 0; n < 7; k = (k + 1) % 7, n++) { days.add(k); if (k === b.n) break; } }
          else days.add(a.n);
          if (t[i] && t[i].comma && t[i + 1] && t[i + 1].d) { i++; continue; }
          break;
        }
      }
      if (t[i] && t[i].tm != null) {
        for (;;) {
          const a = t[i], dash = t[i + 1], b = t[i + 2];
          if (!a || a.tm == null || !dash || !dash.dash || !b || b.tm == null) return false;
          i += 3; const s0 = a.tm; let e = b.tm;
          if (s0 >= 1440) return false;
          if (e <= s0) { if (e > 1440) return false; e += 1440; } // past midnight
          if (e > s0 + 1440) return false;
          times.push([s0, e]);
          if (t[i] && t[i].comma && t[i + 1] && t[i + 1].tm != null) { i++; continue; }
          break;
        }
      }
      if (t[i] && t[i].st) { state = t[i].st; i++; }
      const off = state === 'off' || state === 'closed';
      if (!times.length && !off) return false; // a day list alone, or "open" with no times: not guessed
      if (times.length && off) return false;
      if (days && !days.size && !ph) return false;
      out.push({ days: days ? [...days] : ph ? [] : [0, 1, 2, 3, 4, 5, 6], ph, times, off, add });
      if (i >= t.length) break;
      if (t[i].comma && t[i + 1] && t[i + 1].d) { i++; add = true; continue; }
      return false;
    }
    return true;
  }
  const merge = list => { const a = list.slice().sort((p, q) => p[0] - q[0]), out = []; for (const x of a) { const l = out[out.length - 1]; if (l && x[0] <= l[1]) l[1] = Math.max(l[1], x[1]); else out.push(x.slice()); } return out; };
  // { ok: true, week: [7 lists of [start, end] minutes, Monday first; end may pass 1440], ph: list or null } or { ok: false, raw }
  function parseHours(raw) {
    const s = typeof raw === 'string' ? raw.trim() : '';
    try {
      if (!s || s.length > OH_MAX) return { ok: false, raw: s };
      const subs = [];
      for (const part of s.split(';')) {
        const p = part.trim(); if (!p) continue;
        if (/^24\s*\/\s*7$/.test(p)) { subs.push({ days: [0, 1, 2, 3, 4, 5, 6], ph: false, times: [[0, 1440]], off: false, add: false }); continue; }
        if (!parseRule(p, subs)) return { ok: false, raw: s };
      }
      if (!subs.some(r => r.days.length)) return { ok: false, raw: s }; // holidays alone say nothing about an ordinary day
      const week = DAYS.map(() => []); let ph = null;
      for (const r of subs) {
        for (const d of r.days) week[d] = r.off ? [] : r.add ? week[d].concat(r.times) : r.times.slice();
        if (r.ph) ph = r.off ? [] : r.add && ph ? ph.concat(r.times) : r.times.slice();
      }
      return { ok: true, week: week.map(merge), ph: ph && merge(ph) };
    } catch (e) { return { ok: false, raw: s }; }
  }
  // the day and minute in the Bay Area, whatever the device's time zone
  let fmtLA = null;
  function laNow(date) {
    if (!fmtLA) fmtLA = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    const p = {}; for (const x of fmtLA.formatToParts(date)) p[x.type] = x.value;
    const d = DAY_SHORT.indexOf(p.weekday), h = +p.hour % 24, m = +p.minute;
    if (d < 0 || !isFinite(h) || !isFinite(m)) throw new Error('no time zone');
    return { d, m: h * 60 + m };
  }
  // 9 am, 5:30 pm, 12 pm, midnight
  const clock = (m, mid = 'midnight') => { m = ((m % 1440) + 1440) % 1440; if (m === 0) return mid; const h = Math.floor(m / 60), mm = m % 60; return (h % 12 || 12) + (mm ? ':' + String(mm).padStart(2, '0') : '') + (h < 12 ? ' am' : ' pm'); };
  const span = ([s, e]) => s === 0 && e === 1440 ? 'Open 24 hours' : `${clock(s, '12 am')} – ${clock(e)}`;
  const daySpans = list => list.length ? list.map(span).join(', ') : 'Closed';
  // the answer at a moment: { state: 'open' | 'closed' | 'unknown', text ('until 10 pm', 'opens 5 pm', 'Open 24 hours', ''), today
  // (0 is Monday), week (7 display lines), ph (display line or null), raw }
  function hoursAt(raw, date) {
    try {
      const p = parseHours(raw); if (!p.ok) return { state: 'unknown', text: '', raw: p.raw };
      const at = laNow(date instanceof Date ? date : new Date());
      // every range of last week, this week and next week on one line of minutes from this Monday 00:00, joined where they touch
      const all = []; for (let w = -1; w <= 1; w++) for (let d = 0; d < 7; d++) for (const [s, e] of p.week[d]) all.push([(w * 7 + d) * 1440 + s, (w * 7 + d) * 1440 + e]);
      const runs = merge(all), now = at.d * 1440 + at.m, week = p.week.map(daySpans), ph = p.ph ? daySpans(p.ph) : null;
      const cur = runs.find(([s, e]) => s <= now && now < e);
      if (cur) return { state: 'open', text: cur[1] - now >= 1440 ? 'Open 24 hours' : 'until ' + clock(cur[1]), today: at.d, week, ph, raw: p.raw };
      const next = runs.find(([s]) => s > now);
      let text = '';
      if (next && next[0] - now <= 7 * 1440) { const day = Math.floor(next[0] / 1440), ahead = day - at.d; text = 'opens ' + (ahead === 0 ? '' : ahead === 1 ? 'tomorrow ' : DAY_SHORT[((day % 7) + 7) % 7] + ' ') + clock(next[0], '12 am'); }
      return { state: 'closed', text, today: at.d, week, ph, raw: p.raw };
    } catch (e) { return { state: 'unknown', text: '', raw: typeof raw === 'string' ? raw.trim() : '' }; }
  }

  // ---------- the other tags ----------
  // pizza;italian -> Pizza, Italian (only plain words; anything else in the list is dropped)
  function tidyCuisine(v) {
    if (typeof v !== 'string') return '';
    const out = [];
    for (let x of v.split(/[;,]/)) {
      x = x.trim().replace(/_/g, ' ').replace(/\s+/g, ' ');
      if (!x || x.length > 40 || !/^[\p{L}\p{N} &'-]+$/u.test(x)) continue;
      x = x[0].toUpperCase() + x.slice(1);
      if (!out.some(y => y.toLowerCase() === x.toLowerCase())) out.push(x);
      if (out.length >= 6) break;
    }
    return cap(out.join(', '));
  }
  // https only (an http tag is upgraded); no other scheme, no credentials, a real host name. { href, host } or null
  function safeUrl(v) {
    if (typeof v !== 'string') return null;
    const s = v.trim().split(/\s*;\s*/)[0];
    if (!s || s.length > 500 || /[\s<>"'`\\\x00-\x1f\x7f]/.test(s) || !/^https?:\/\//i.test(s)) return null;
    let u; try { u = new URL(s); } catch (e) { return null; }
    if (u.protocol === 'http:') u.protocol = 'https:'; else if (u.protocol !== 'https:') return null;
    if (u.protocol !== 'https:' || u.username || u.password || !/^(?=.{4,253}$)[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z][a-z0-9-]+$/i.test(u.hostname)) return null;
    return { href: u.href, host: cap(u.hostname.replace(/^www\./i, ''), 80) };
  }
  // a phone number: shown as written, dialled as digits and a leading plus; letters (1-800-FLOWERS, "ext") are not guessed
  function cleanPhone(v) {
    if (typeof v !== 'string') return null;
    const s = cap(v.split(';')[0], 40);
    if (!s || /[^\d+\-().\s/]/.test(s)) return null;
    const tel = s.replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
    return /^\+?\d{7,15}$/.test(tel) ? { tel, show: s } : null;
  }
  const FACTS = [['outdoor_seating', 'Outdoor seating', 'No outdoor seating'], ['takeaway', 'Takeaway', 'No takeaway'], ['wheelchair', 'Wheelchair accessible', 'Not wheelchair accessible'], ['reservation', 'Takes reservations', 'No reservations']];
  const KEEP = ['name', 'opening_hours', 'cuisine', 'website', 'contact:website', 'url', 'phone', 'contact:phone', ...FACTS.map(f => f[0])];

  // ---------- finding the place ----------
  // names compared after folding case, accents and punctuation, '&' as 'and', a leading 'the' and common trailing words
  // ('Zuni Café' = 'Zuni Cafe' = 'Zuni'; 'The Buena Vista' = 'Buena Vista Cafe'), spaces ignored
  const SUFFIX = new Set(['restaurant', 'cafe', 'bar', 'bakery', 'coffee', 'pub', 'museum', 'shop', 'kitchen', 'sf', 'inc', 'llc', 'co', 'company']);
  function normName(s) {
    const w = String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/['‘’`]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);
    if (w[0] === 'the' && w.length > 1) w.shift();
    if (w.length > 2 && w[w.length - 2] === 'san' && w[w.length - 1] === 'francisco') w.length -= 2;
    while (w.length > 1 && SUFFIX.has(w[w.length - 1])) w.pop();
    return w.join('');
  }
  const TYPES = new Set(['node', 'way', 'relation']);
  // a stored id on the spot: 'node/123', 'way/45', 'relation/6' (or n123, w45, r6)
  function parseOsm(v) {
    const m = typeof v === 'string' && /^(?:(node|way|relation)\/|([nwr]))(\d{1,15})$/.exec(v.trim()); if (!m) return null;
    const id = +m[3]; if (!Number.isSafeInteger(id) || id <= 0) return null;
    return { type: m[1] || { n: 'node', w: 'way', r: 'relation' }[m[2]], id };
  }
  const tagNames = tags => ['name', 'name:en', 'official_name', 'short_name', 'alt_name'].flatMap(k => own(tags, k) && typeof tags[k] === 'string' ? tags[k].split(';') : []);
  const metres = (a, b, lat) => Math.hypot((a[0] - b[0]) * Math.cos(lat * Math.PI / 180), a[1] - b[1]) * 111320;
  // the feature for a spot: its stored id; otherwise the nearest feature whose name matches, within 60 m (a building or area
  // within 60 m may have its centre further off: 250 m); none: null, no guess
  function pick(sp, els, osm) {
    if (!Array.isArray(els)) return null;
    const n = normName(sp.name); let best = null, bd = Infinity;
    for (const e of els) {
      if (!e || typeof e !== 'object' || !TYPES.has(e.type) || !Number.isSafeInteger(e.id) || e.id <= 0) continue;
      if (!e.tags || typeof e.tags !== 'object' || Array.isArray(e.tags)) continue;
      if (osm) { if (e.type === osm.type && e.id === osm.id) return e; continue; }
      if (!n) return null;
      const c = e.type === 'node' ? e : e.center; if (!c || typeof c.lat !== 'number' || typeof c.lon !== 'number' || !isFinite(c.lat) || !isFinite(c.lon)) continue;
      const d = metres([c.lon, c.lat], [sp.lon, sp.lat], sp.lat);
      if (d > (e.type === 'node' ? NEAR : NEAR_AREA) || d >= bd) continue;
      if (tagNames(e.tags).some(x => normName(x) === n)) { best = e; bd = d; }
    }
    return best;
  }
  // only the tags shown are kept (strings, bounded); a too-long opening_hours stays too long, so it is never parsed cut short
  function keep(e) {
    const tags = {};
    for (const k of KEEP) if (own(e.tags, k) && typeof e.tags[k] === 'string') tags[k] = e.tags[k].slice(0, k === 'opening_hours' ? OH_MAX + 1 : 500);
    return { type: e.type, id: e.id, tags };
  }

  // ---------- the block ----------
  const okLL = (lat, lon) => typeof lat === 'number' && typeof lon === 'number' && isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  // what the cached answer belongs to: a renamed or moved spot (or a new stored id) asks again
  const spotKey = sp => sp && okLL(sp.lat, sp.lon) && typeof sp.name === 'string' && sp.name.trim() ? [sp.name.trim(), sp.lat.toFixed(5), sp.lon.toFixed(5), parseOsm(sp.osm) ? sp.osm.trim() : ''].join('|') : null;
  let uid = 0;
  function html(d) {
    if (!d || !d.tags || !TYPES.has(d.type) || !Number.isSafeInteger(d.id)) return '';
    const t = d.tags, g = k => own(t, k) && typeof t[k] === 'string' ? t[k] : '', rows = [];
    const row = (label, value) => `<dt>${label}</dt><dd>${value}</dd>`;
    const oh = g('opening_hours').trim();
    if (oh) {
      const h = hoursAt(oh, new Date(api.now()));
      if (h.state === 'unknown') rows.push(row('Hours', `<span class="pd-raw">${esc(cap(h.raw))}</span>`));
      else {
        const id = 'pd-week-' + (++uid), all = h.state === 'open' && h.text === 'Open 24 hours';
        const now = all ? '<b class="pd-open">Open 24 hours</b>' : h.state === 'open' ? `<b class="pd-open">Open now</b>${h.text ? ' · ' + esc(h.text) : ''}` : `<b class="pd-closed">Closed</b>${h.text ? ' · ' + esc(h.text) : ''}`;
        const days = h.week.map((x, i) => `<li${i === h.today ? ' class="today"' : ''}><span>${DAY_SHORT[i]}</span><span>${esc(x)}</span></li>`).join('') + (h.ph ? `<li><span>Holidays</span><span>${esc(h.ph)}</span></li>` : '');
        rows.push(row('Hours', `<button type="button" class="pd-now" aria-expanded="false" aria-controls="${id}"><span>${now}</span><i class="pd-chev" aria-hidden="true"></i></button><ul class="pd-week" id="${id}" hidden>${days}</ul>`));
      }
    }
    const cu = tidyCuisine(g('cuisine')); if (cu) rows.push(row('Cuisine', esc(cu)));
    const web = safeUrl(g('website')) || safeUrl(g('contact:website')) || safeUrl(g('url'));
    if (web) rows.push(row('Website', `<a href="${esc(web.href)}" target="_blank" rel="noopener noreferrer">${esc(web.host)}</a>`));
    const ph = cleanPhone(g('phone')) || cleanPhone(g('contact:phone'));
    if (ph) rows.push(row('Phone', `<a href="tel:${esc(ph.tel)}">${esc(ph.show)}</a>`));
    const facts = FACTS.map(([k, yes, no]) => { const v = g(k).trim(); return v === 'yes' ? yes : v === 'no' ? no : ''; }).filter(Boolean);
    if (facts.length) rows.push(row('Good to know', esc(facts.join(' · '))));
    if (!rows.length) return ''; // a match with nothing worth showing: nothing, as before
    return `<h3>Details</h3><dl class="pd">${rows.join('')}</dl><p class="pd-src"><a href="https://www.openstreetmap.org/${d.type}/${d.id}" target="_blank" rel="noopener noreferrer">Details from OpenStreetMap</a></p>`;
  }
  function fill(el, d) {
    const h = html(d);
    if (!h) { el.replaceChildren(); return; }
    el.innerHTML = h;
    const b = el.querySelector('.pd-now'), w = b && el.querySelector('.pd-week');
    if (b && w) b.addEventListener('click', () => { const on = b.getAttribute('aria-expanded') !== 'true'; b.setAttribute('aria-expanded', String(on)); w.hidden = !on; });
  }

  // ---------- the cache (this device only) ----------
  let cache = null;
  function load() {
    if (cache) return cache;
    cache = new Map();
    try { const a = JSON.parse(localStorage.getItem(KEY) || '[]'); if (Array.isArray(a)) for (const x of a) if (Array.isArray(x) && typeof x[0] === 'string' && x[1] && typeof x[1] === 'object' && typeof x[1].k === 'string' && typeof x[1].t === 'number') cache.set(x[0], x[1]); } catch (e) {}
    return cache;
  }
  function put(id, k, d) {
    load().delete(id); cache.set(id, { k, t: Date.now(), d: d || null });
    const a = [...cache].sort((p, q) => q[1].t - p[1].t).slice(0, MAX); cache = new Map(a);
    try { localStorage.setItem(KEY, JSON.stringify(a)); } catch (e) {}
  }
  const cached = (id, k) => { const c = load().get(id); return c && c.k === k && Date.now() - c.t < TTL ? c : null; };

  // ---------- asking, politely ----------
  let want = null, busy = false, last = -Infinity, timer = null;
  const failed = new Map(); // a lookup that failed is not asked again for 5 minutes (it is never cached)
  const still = w => w.el.isConnected && spotKey(opts.isOpen(w.id)) === w.key;
  function mount(el, id, sp) {
    if (!el) return;
    const key = spotKey(sp); if (!key) return;
    const c = cached(id, key);
    if (c) { fill(el, c.d); return; } // known (found or not): no request
    if (!opts.ok() || failed.get(key) > Date.now() - RETRY_AFTER) return;
    if (want && want.key === key && want.id === id) { want.el = el; return; } // a re-render of the same spot: the wait goes on
    const w = want = { el, id, key, sp: { name: sp.name, lat: sp.lat, lon: sp.lon, osm: sp.osm } };
    clearTimeout(timer); timer = setTimeout(() => { if (want === w) pump(); }, WAIT);
  }
  function pump() {
    const w = want; if (!w || busy) return;
    if (!still(w)) { want = null; return; }
    const c = cached(w.id, w.key); if (c) { want = null; fill(w.el, c.d); return; }
    const gap = last + GAP - Date.now(); if (gap > 0) { clearTimeout(timer); timer = setTimeout(pump, gap); return; }
    want = null; busy = true;
    lookup(w.sp).then(d => {
      put(w.id, w.key, d);
      const tgt = want && want.key === w.key && want.id === w.id ? want : w; // the panel was redrawn while this was asked
      if (tgt === want) want = null;
      if (still(tgt)) fill(tgt.el, d);
    }, () => { failed.set(w.key, Date.now()); }).finally(() => { busy = false; last = Date.now(); if (want) { clearTimeout(timer); timer = setTimeout(pump, GAP); } });
  }
  async function lookup(sp) {
    const osm = parseOsm(sp.osm);
    const q = '[out:json][timeout:10];' + (osm ? `${osm.type}(${osm.id});out tags center 1;` : `nwr(around:${NEAR},${sp.lat.toFixed(5)},${sp.lon.toFixed(5)})[name];out tags center 20;`);
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null, t = ctl && setTimeout(() => ctl.abort(), TIMEOUT);
    const log = { at: Date.now(), q }; api.requests.push(log); // for tests and the console: when, what, and how it went
    try {
      // no referrer: the page address carries the private log key
      const r = await (api.fetcher || fetch)(API + '?data=' + encodeURIComponent(q), { signal: ctl && ctl.signal, referrerPolicy: 'no-referrer', credentials: 'omit' });
      log.status = r && r.status; log.ms = Date.now() - log.at;
      if (!r || !r.ok) throw new Error('details: ' + (r && r.status));
      const j = await r.json(), e = pick(sp, j && j.elements, osm);
      return e ? keep(e) : null;
    } catch (e) { log.error = e.name === 'AbortError' ? 'timeout' : String(e.message || e).slice(0, 80); throw e; } finally { clearTimeout(t); }
  }

  // o: { ok() (may this page reach OpenStreetMap; false inside the artifact), isOpen(id) (the spot when its page is the one open,
  // else null) }
  function init(o) { opts = Object.assign(opts, o); }
  // the slot app.js puts between the note and the street map: empty (and not displayed) until there is something to show
  const slot = '<div class="pdet"></div>';
  const api = window.Details = { init, mount, slot, parseHours, hoursAt, normName, pick, tidyCuisine, safeUrl, cleanPhone, parseOsm, html, now: () => Date.now(), fetcher: null, requests: [], clear() { cache = null; failed.clear(); try { localStorage.removeItem(KEY); } catch (e) {} } };
})();
