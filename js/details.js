// Place details on a spot's page: opening hours, cuisine, website, phone and a few plain facts, from OpenStreetMap through
// Nominatim's search (keyless; it answers a browser with CORS headers). Nominatim matches names loosely, so it only proposes: a
// result is used only when its name is the spot's (the rules under "finding the place") and it lies within 60 m (an area's centre:
// 250 m); otherwise nothing is shown. A polite client (Nominatim allows one request a second): one request per spot, asked only
// when the spot's page has stayed open 600 ms (never for a list or the map; leaving and coming back starts the wait again), one
// request in flight, 1.5 s between requests, a 10 s timeout, no retries; after a busy answer (429, 502-504), an answer that is not
// a list, a timeout or no answer at all the service is left alone for 60 s. The match, or "nothing found" (an empty list), is kept
// on this device per spot for 30 days (localStorage, at most 300 spots, under a hash: no name, position or log key is readable
// there) and asked again after that or when the spot's name or position changes; a failed lookup is never kept. Nothing is
// written to the log: details are fetched data, not the couple's. Everything from OpenStreetMap is untrusted text: escaped,
// capped, and a URL only after validation. app.js puts an empty slot in the spot panel below the Maps buttons and calls mount();
// the block appears when it is ready, and its open-now line is worked out again every minute and whenever the page comes back on
// screen.
(function () {
  const API = 'https://nominatim.openstreetmap.org/search', WAIT = 600, GAP = 1500, TIMEOUT = 10000, TTL = 30 * 864e5, MAX = 300, KEY = 'sbs-details-v3';
  const NEAR = 60, NEAR_AREA = 250, BOX = 150, LIMIT = 10, Q_MAX = 80, LINE = 200, OH_MAX = 1000, URL_MAX = 500, TZ = 'America/Los_Angeles', RETRY_AFTER = 5 * 60e3, PAUSE = 60e3, TICK = 60e3;
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const own = (o, k) => !!o && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);
  // one line of text: no control characters, spaces collapsed, at most n characters (an ellipsis marks a cut)
  const cap = (s, n = LINE) => { const a = [...String(s ?? '').replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim()]; return a.length > n ? a.slice(0, n - 1).join('') + '…' : a.join(''); };
  let opts = { ok: () => true, isOpen: () => null, scope: () => 'local' };
  const now = () => api.now();

  // ---------- opening_hours: the common subset ----------
  // Day ranges and lists (Mo-Fr, Sa,Su, Fr-Mo), several time ranges per rule, ';' rules where a later rule replaces the days it
  // names, ',' additional rules that add to them, off/closed, 24/7, times past midnight (18:00-02:00, 18:00-26:00), and PH rules
  // (kept for the week, never used for open now). Anything else (months, weeks, sunrise, comments, '||', open ends) is "unknown":
  // the raw text is shown and no claim is made. So is a range that starts before noon and lasts more than 18 hours (the common
  // '9:00-5:00' slip), and the hours after midnight that a later rule may have taken back ('Mo-Su 22:00-03:00; Su off' early on
  // Sunday). Pure; never throws.
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
          if (s0 < 720 && e - s0 > 18 * 60 && !(s0 === 0 && e === 1440)) return false; // '9:00-5:00' meant 9 to 5: not guessed
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
  const merge = list => { const a = list.slice().sort((p, q) => p[0] - q[0]), out = []; for (const x of a) { const l = out[out.length - 1]; if (l && x[0] <= l[1]) l[1] = Math.max(l[1], x[1]); else out.push(x.slice(0, 2)); } return out; };
  // { ok: true, week: [7 lists of [start, end] minutes, Monday first; end may pass 1440], ph: list or null, amb: [day, start, end]
  // stretches after midnight that spill from the day before into a day a later rule replaced } or { ok: false, raw }
  function parseHours(raw) {
    const s = typeof raw === 'string' ? raw.trim() : '';
    try {
      if (!s || s.length > OH_MAX) return { ok: false, raw: s };
      const subs = []; let r = 0;
      for (const part of s.split(';')) {
        const p = part.trim(); if (!p) continue;
        const n0 = subs.length;
        if (/^24\s*\/\s*7$/.test(p)) subs.push({ days: [0, 1, 2, 3, 4, 5, 6], ph: false, times: [[0, 1440]], off: false, add: false });
        else if (!parseRule(p, subs)) return { ok: false, raw: s };
        for (let k = n0; k < subs.length; k++) subs[k].rule = r; r++;
      }
      if (!subs.some(x => x.days.length)) return { ok: false, raw: s }; // holidays alone say nothing about an ordinary day
      // each range keeps the ';' rule it came from; setAt: the last rule that replaced the day
      const week = DAYS.map(() => []), setAt = DAYS.map(() => -1); let ph = null;
      for (const x of subs) {
        const rs = x.times.map(([a, b]) => [a, b, x.rule]);
        for (const d of x.days) { if (x.off) { week[d] = []; setAt[d] = x.rule; } else if (x.add) week[d] = week[d].concat(rs); else { week[d] = rs.slice(); setAt[d] = x.rule; } }
        if (x.ph) ph = x.off ? [] : x.add && ph ? ph.concat(x.times) : x.times.slice();
      }
      const amb = [];
      for (let d = 0; d < 7; d++) for (const [a, b, rule] of week[d]) if (b > 1440 && setAt[(d + 1) % 7] > rule) amb.push([(d + 1) % 7, 0, b - 1440]);
      return { ok: true, week: week.map(merge), ph: ph && merge(ph), amb, raw: s };
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
  const dayOf = m => DAY_SHORT[((Math.floor(m / 1440) % 7) + 7) % 7];
  // the answer at a moment: { state: 'open' | 'closed' | 'unknown', text ('until 10 pm', 'until Sat 11 pm', 'opens 5 pm', 'opens
  // next Mon 9 am', 'Open 24 hours', ''), today (0 is Monday), week (7 display lines), ph (display line or null), raw }
  function hoursAt(raw, date) {
    try {
      const p = parseHours(raw); if (!p.ok) return { state: 'unknown', text: '', raw: p.raw };
      const at = laNow(date instanceof Date ? date : new Date());
      // every range of last week, this week and next week on one line of minutes from this Monday 00:00, joined where they touch
      const all = [], amb = []; for (let w = -1; w <= 1; w++) { for (let d = 0; d < 7; d++) for (const [s, e] of p.week[d]) all.push([(w * 7 + d) * 1440 + s, (w * 7 + d) * 1440 + e]); for (const [d, s, e] of p.amb) amb.push([(w * 7 + d) * 1440 + s, (w * 7 + d) * 1440 + e]); }
      const runs = merge(all), now = at.d * 1440 + at.m, day0 = at.d * 1440, week = p.week.map(daySpans), ph = p.ph ? daySpans(p.ph) : null;
      if (amb.some(([s, e]) => s <= now && now < e)) return { state: 'unknown', text: '', raw: p.raw }; // hours a later rule may have taken back: no claim
      const cur = runs.find(([s, e]) => s <= now && now < e);
      if (cur) {
        // around the clock today and tomorrow: 'Open 24 hours'; an end that a later rule may have moved: no end given
        const text = cur[0] <= day0 && cur[1] >= day0 + 2 * 1440 ? 'Open 24 hours' : amb.some(([s]) => now < s && s < cur[1]) ? '' : 'until ' + (cur[1] - now <= 1440 ? '' : dayOf(cur[1] - 1) + ' ') + clock(cur[1]);
        return { state: 'open', text, today: at.d, week, ph, raw: p.raw };
      }
      const next = runs.find(([s]) => s > now);
      let text = '';
      if (next && next[0] - now <= 7 * 1440) { const day = Math.floor(next[0] / 1440), ahead = day - at.d; text = 'opens ' + (ahead === 0 ? '' : ahead === 1 ? 'tomorrow ' : (ahead === 7 ? 'next ' : '') + dayOf(next[0]) + ' ') + clock(next[0], '12 am'); }
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
  // http or https as written (an http site may have no TLS: not upgraded); at most 500 characters (longer is refused, never cut);
  // no other scheme, no credentials, a real host name. { href, host } or null
  function safeUrl(v) {
    if (typeof v !== 'string') return null;
    const s = v.trim().split(/\s*;\s*/)[0];
    if (!s || s.length > URL_MAX || /[\s<>"'`\\\x00-\x1f\x7f]/.test(s) || !/^https?:\/\//i.test(s)) return null;
    let u; try { u = new URL(s); } catch (e) { return null; }
    if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password || !/^(?=.{4,253}$)[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z][a-z0-9-]+$/i.test(u.hostname)) return null;
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
  const WEB = ['website', 'contact:website', 'url'], TEL = ['phone', 'contact:phone'];

  // ---------- finding the place ----------
  // A name is compared two ways. Exact: case, accents, punctuation and spaces ignored, '&' read as 'and'. Folded: also without a
  // leading 'the', a trailing 'San Francisco', 'SF' or company form (Inc, LLC, Co, Company), and the kind of place at the end
  // (cafe, bar, bakery...), which is kept aside. A folded match needs the same stem and the same kind, or a kind on one side only
  // ('Zuni Café' = 'Zuni'), never two different kinds ('Golden Gate Bakery' is not 'Golden Gate Restaurant').
  const NOISE = new Set(['sf', 'inc', 'llc', 'co', 'company']), KIND = new Set(['restaurant', 'cafe', 'bar', 'bakery', 'coffee', 'pub', 'museum', 'shop', 'kitchen']);
  function nameKey(s) {
    const w = String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/&/g, ' and ').replace(/['‘’`]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);
    const exact = w.join(''), f = w.slice(), kind = [];
    if (f[0] === 'the' && f.length > 1) f.shift();
    for (;;) {
      const l = f[f.length - 1];
      if (f.length > 2 && f[f.length - 2] === 'san' && l === 'francisco') f.length -= 2;
      else if (f.length > 1 && NOISE.has(l)) f.pop();
      else if (f.length > 1 && KIND.has(l)) kind.unshift(f.pop());
      else break;
    }
    return { exact, stem: f.join(''), kind: kind.join(' ') };
  }
  // 2: the same name; 1: the same after folding; 0: not the same place
  const sameName = (a, b) => !a.exact || !b.exact ? 0 : a.exact === b.exact ? 2 : a.stem && a.stem === b.stem && (a.kind === b.kind || !a.kind !== !b.kind) ? 1 : 0;
  const TYPES = new Set(['node', 'way', 'relation']);
  const tagNames = tags => ['name', 'name:en', 'official_name', 'short_name', 'alt_name'].flatMap(k => own(tags, k) && typeof tags[k] === 'string' ? tags[k].split(';') : []);
  const metres = (a, b, lat) => Math.hypot((a[0] - b[0]) * Math.cos(lat * Math.PI / 180), a[1] - b[1]) * 111320;
  // stops, platforms, station entrances, roads and routes share names with the places beside them; never a place page
  const RAIL_STOP = /^(stop|platform|halt|tram_stop|subway_entrance|train_station_entrance)$/;
  const transit = t => own(t, 'highway') || own(t, 'public_transport') || own(t, 'route') || (own(t, 'railway') && RAIL_STOP.test(String(t.railway)));
  // the feature for a spot: within 60 m (a building or area may have its centre further off: 250 m), the best name match: the same
  // name before a folded one at any distance, then one with something to show, then the nearest. None: null
  function pick(sp, els) {
    if (!Array.isArray(els)) return null;
    const n = nameKey(sp.name); let best = null, bq = 0, bs = false, bd = Infinity;
    for (const e of els) {
      if (!e || typeof e !== 'object' || !TYPES.has(e.type) || !Number.isSafeInteger(e.id) || e.id <= 0) continue;
      if (!e.tags || typeof e.tags !== 'object' || Array.isArray(e.tags)) continue;
      if (!n.exact) return null;
      if (transit(e.tags)) continue;
      const c = e.type === 'node' ? e : e.center; if (!c || typeof c.lat !== 'number' || typeof c.lon !== 'number' || !isFinite(c.lat) || !isFinite(c.lon)) continue;
      const d = metres([c.lon, c.lat], [sp.lon, sp.lat], sp.lat);
      if (d > (e.type === 'node' ? NEAR : NEAR_AREA)) continue;
      const q = tagNames(e.tags).reduce((m, x) => Math.max(m, sameName(n, nameKey(x))), 0); if (!q) continue;
      const s = Object.keys(keep(e).tags).length > 0;
      if (q > bq || (q === bq && ((s && !bs) || (s === bs && d < bd)))) { best = e; bq = q; bs = s; bd = d; }
    }
    return best;
  }
  // only the tags shown are kept: hours (a too-long one stays too long, so it is never parsed cut short), a cuisine with a plain
  // word, the first valid website and phone, the yes/no facts
  function keep(e) {
    const t = e.tags, g = k => own(t, k) && typeof t[k] === 'string' ? t[k] : '', tags = {};
    if (g('opening_hours').trim()) tags.opening_hours = g('opening_hours').slice(0, OH_MAX + 1);
    if (tidyCuisine(g('cuisine'))) tags.cuisine = g('cuisine').slice(0, 500);
    const wk = WEB.find(k => safeUrl(g(k))); if (wk) tags[wk] = g(wk).trim().split(/\s*;\s*/)[0];
    const pk = TEL.find(k => cleanPhone(g(k))); if (pk) tags[pk] = g(pk).split(';')[0].slice(0, 80);
    for (const [k] of FACTS) { const v = g(k).trim(); if (v === 'yes' || v === 'no') tags[k] = v; }
    return { type: e.type, id: e.id, tags };
  }
  // the tags read here (names for matching, the shown ones, the transit keys); nothing else is copied from an answer
  const TRANSIT = ['highway', 'public_transport', 'route', 'railway'], READ = new Set(['name', 'name:en', 'official_name', 'short_name', 'alt_name', 'opening_hours', 'cuisine', ...WEB, ...TEL, ...FACTS.map(f => f[0]), ...TRANSIT]);
  const coord = v => typeof v === 'number' ? v : typeof v === 'string' && /^-?\d{1,3}(\.\d{1,12})?$/.test(v) ? +v : NaN;
  // one Nominatim search result in the shape pick() reads: { type, id, lat, lon (a node) or center (a way or relation), tags:
  // extratags and the name }; its main key and value (category, type) count as a tag, so a bus stop is a bus stop. Anything else: null
  function fromNominatim(r) {
    if (!r || typeof r !== 'object' || Array.isArray(r)) return null;
    const type = own(r, 'osm_type') ? r.osm_type : null, id = own(r, 'osm_id') ? r.osm_id : null;
    if (!TYPES.has(type) || !Number.isSafeInteger(id) || id <= 0) return null;
    const lat = coord(own(r, 'lat') ? r.lat : null), lon = coord(own(r, 'lon') ? r.lon : null); if (!okLL(lat, lon)) return null;
    const x = own(r, 'extratags') && r.extratags && typeof r.extratags === 'object' && !Array.isArray(r.extratags) ? r.extratags : {}, tags = {};
    for (const k of READ) if (own(x, k) && typeof x[k] === 'string') tags[k] = x[k].slice(0, 10 * OH_MAX);
    const cat = own(r, 'category') && typeof r.category === 'string' ? r.category : '', val = own(r, 'type') && typeof r.type === 'string' ? r.type : '';
    if (TRANSIT.includes(cat) && !own(tags, cat)) tags[cat] = val.slice(0, 80);
    if (own(r, 'name') && typeof r.name === 'string') tags.name = r.name.slice(0, 500);
    return type === 'node' ? { type, id, lat, lon, tags } : { type, id, center: { lat, lon }, tags };
  }

  // ---------- the block ----------
  const okLL = (lat, lon) => typeof lat === 'number' && typeof lon === 'number' && isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
  // a short hash (two 53-bit halves): the cache's key shows nothing of what went in
  const hash = s => { const h = seed => { let a = 0xdeadbeef ^ seed, b = 0x41c6ce57 ^ seed; for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); a = Math.imul(a ^ c, 2654435761); b = Math.imul(b ^ c, 1597334677); } a = Math.imul(a ^ (a >>> 16), 2246822507) ^ Math.imul(b ^ (b >>> 13), 3266489909); b = Math.imul(b ^ (b >>> 16), 2246822507) ^ Math.imul(a ^ (a >>> 13), 3266489909); return (4294967296 * (2097151 & b) + (a >>> 0)).toString(36); }; return h(1) + h(2); };
  // what the cached answer belongs to: this log (or 'local'), the spot, its name and position. A renamed or moved spot asks again
  const spotKey = (id, sp) => sp && okLL(sp.lat, sp.lon) && typeof sp.name === 'string' && sp.name.trim() ? hash([String(opts.scope() || 'local'), id, sp.name.trim(), sp.lat.toFixed(5), sp.lon.toFixed(5)].join('\u0001')) : null;
  let uid = 0;
  const PH_RULE = /(^|[^a-z])PH(?![a-z])/i;
  // the Hours row at this moment: the raw text (no claim), or the line for now and the week's lines; a quiet note when PH is named
  function hoursParts(oh) {
    const h = hoursAt(oh, new Date(now())), note = PH_RULE.test(oh) ? '<small class="pd-note">Holiday hours may differ</small>' : '';
    if (h.state === 'unknown') return { raw: `<span class="pd-raw">${esc(cap(h.raw))}</span>${note}` };
    const line = h.state === 'open' && h.text === 'Open 24 hours' ? '<b class="pd-open">Open 24 hours</b>' : h.state === 'open' ? `<b class="pd-open">Open now</b>${h.text ? ' · ' + esc(h.text) : ''}` : `<b class="pd-closed">Closed</b>${h.text ? ' · ' + esc(h.text) : ''}`;
    const days = h.week.map((x, i) => `<li${i === h.today ? ' class="today"' : ''}><span>${DAY_SHORT[i]}</span><span>${esc(x)}</span></li>`).join('') + (h.ph ? `<li><span>Holidays</span><span>${esc(h.ph)}</span></li>` : '');
    return { line, days, note };
  }
  const hoursHTML = (p, open) => { if (p.raw != null) return p.raw; const id = 'pd-week-' + (++uid); return `<button type="button" class="pd-now" aria-expanded="${open}" aria-controls="${id}"><span class="pd-line">${p.line}</span><i class="pd-chev" aria-hidden="true"></i></button>${p.note}<ul class="pd-week" id="${id}"${open ? '' : ' hidden'}>${p.days}</ul>`; };
  function html(d) {
    if (!d || !d.tags || !TYPES.has(d.type) || !Number.isSafeInteger(d.id)) return '';
    const t = d.tags, g = k => own(t, k) && typeof t[k] === 'string' ? t[k] : '', rows = [];
    const row = (label, value, cls) => `<dt>${label}</dt><dd${cls ? ` class="${cls}"` : ''}>${value}</dd>`;
    const oh = g('opening_hours').trim();
    if (oh) rows.push(row('Hours', hoursHTML(hoursParts(oh), false), 'pd-hours'));
    const cu = tidyCuisine(g('cuisine')); if (cu) rows.push(row('Cuisine', esc(cu)));
    const web = WEB.reduce((v, k) => v || safeUrl(g(k)), null);
    if (web) rows.push(row('Website', `<a href="${esc(web.href)}" target="_blank" rel="noopener noreferrer">${esc(web.host)}</a>`));
    const ph = TEL.reduce((v, k) => v || cleanPhone(g(k)), null);
    if (ph) rows.push(row('Phone', `<a href="tel:${esc(ph.tel)}">${esc(ph.show)}</a>`));
    const facts = FACTS.map(([k, yes, no]) => { const v = g(k).trim(); return v === 'yes' ? yes : v === 'no' ? no : ''; }).filter(Boolean);
    if (facts.length) rows.push(row('Good to know', esc(facts.join(' · '))));
    if (!rows.length) return ''; // a match with nothing worth showing: nothing, as before
    return `<h3>Details</h3><dl class="pd">${rows.join('')}</dl><p class="pd-src"><a href="https://www.openstreetmap.org/${d.type}/${d.id}" target="_blank" rel="noopener noreferrer">Details from OpenStreetMap</a></p>`;
  }
  function fill(el, d) {
    stop();
    const h = html(d);
    if (!h) { el.replaceChildren(); return; }
    el.innerHTML = h;
    el.onclick = e => { const b = e.target.closest && e.target.closest('.pd-now'), w = b && el.contains(b) && b.parentNode.querySelector('.pd-week'); if (!w) return; const on = b.getAttribute('aria-expanded') !== 'true'; b.setAttribute('aria-expanded', String(on)); w.hidden = !on; };
    const oh = own(d.tags, 'opening_hours') && typeof d.tags.opening_hours === 'string' ? d.tags.opening_hours.trim() : '';
    if (oh && el.querySelector('.pd-hours')) watch(el, oh);
  }

  // ---------- keeping "open now" true while the page stays on screen ----------
  // The open-now line is worked out again every minute while the block is on the page, when the page comes back on screen and when
  // it is restored from the back-forward cache. Only that row changes, so an open week stays open. Everything stops when the block
  // leaves the page (the panel drew something else).
  let live = null, mo = null;
  const onShow = () => { if (document.visibilityState !== 'hidden') refresh(); };
  function watch(el, oh) {
    const p = hoursParts(oh);
    live = { el, oh, sig: p.raw != null ? 'raw' + p.raw : p.line + p.days, iv: setInterval(refresh, TICK) };
    document.addEventListener('visibilitychange', onShow); window.addEventListener('pageshow', onShow);
    guard(el);
  }
  function stop() {
    if (!live) return;
    clearInterval(live.iv); live = null;
    document.removeEventListener('visibilitychange', onShow); window.removeEventListener('pageshow', onShow);
  }
  function refresh() {
    const L = live; if (!L) return;
    const dd = L.el.isConnected && L.el.querySelector('.pd-hours'); if (!dd) { stop(); return; }
    const p = hoursParts(L.oh), sig = p.raw != null ? 'raw' + p.raw : p.line + p.days; if (sig === L.sig) return;
    L.sig = sig;
    const b = dd.querySelector('.pd-now'), line = b && b.querySelector('.pd-line'), w = dd.querySelector('.pd-week');
    if (p.raw == null && line && w) { line.innerHTML = p.line; w.innerHTML = p.days; return; } // the button stays (focus, open week)
    dd.innerHTML = hoursHTML(p, !!b && b.getAttribute('aria-expanded') === 'true'); // a no-claim stretch began or ended
  }
  // the panel replaces its content when the page changes: a wait for a spot that was left, and the minute timer, end at once
  function guard(el) {
    if (typeof MutationObserver === 'undefined' || !el.parentNode) return;
    if (!mo) mo = new MutationObserver(sweep);
    mo.observe(el.parentNode, { childList: true });
  }
  function sweep() {
    if (want && !want.el.isConnected) { clearTimeout(timer); want = null; }
    if (live && !live.el.isConnected) stop();
    if (!want && !live && mo) mo.disconnect();
  }

  // ---------- the cache (this device only) ----------
  // [hash, { t, d: { type, id, tags shown } or null }]: no name, position or log key
  let cache = null;
  function load() {
    if (cache) return cache;
    cache = new Map();
    try { localStorage.removeItem('sbs-details-v1'); localStorage.removeItem('sbs-details-v2'); } catch (e) {} // older versions: v1's keys held names and positions; v2 came from another service
    try { const a = JSON.parse(localStorage.getItem(KEY) || '[]'); if (Array.isArray(a)) for (const x of a) if (Array.isArray(x) && typeof x[0] === 'string' && x[1] && typeof x[1] === 'object' && typeof x[1].t === 'number') cache.set(x[0], x[1]); } catch (e) {}
    return cache;
  }
  function put(k, d) {
    load().delete(k); cache.set(k, { t: Date.now(), d: d || null });
    const a = [...cache].sort((p, q) => q[1].t - p[1].t).slice(0, MAX); cache = new Map(a);
    try { localStorage.setItem(KEY, JSON.stringify(a)); } catch (e) {}
  }
  const cached = k => { const c = load().get(k); return c && Date.now() - c.t < TTL ? c : null; };

  // ---------- asking, politely ----------
  let want = null, busy = false, last = -Infinity, timer = null, rest = 0; // rest: until when the service is left alone
  const failed = new Map(); // a lookup that failed is not asked again for 5 minutes (it is never cached)
  const still = w => w.el.isConnected && spotKey(w.id, opts.isOpen(w.id)) === w.key;
  const later = ms => { clearTimeout(timer); timer = setTimeout(pump, ms); };
  function mount(el, id, sp) {
    if (!el) return;
    const key = spotKey(id, sp); if (!key) return;
    const c = cached(key);
    if (c) { fill(el, c.d); return; } // known (found or not): no request
    if (!opts.ok() || failed.get(key) > now() - RETRY_AFTER) return;
    guard(el);
    if (want && want.key === key && want.id === id) { want.el = el; return; } // a re-render of the same spot: the wait goes on
    const w = want = { el, id, key, sp: { name: sp.name, lat: sp.lat, lon: sp.lon } };
    clearTimeout(timer); timer = setTimeout(() => { if (want === w) pump(); }, WAIT);
  }
  function pump() {
    const w = want; if (!w || busy) return;
    if (!still(w)) { want = null; return; }
    const c = cached(w.key); if (c) { want = null; fill(w.el, c.d); return; }
    if (failed.get(w.key) > now() - RETRY_AFTER) { want = null; return; } // it failed while the panel was redrawn: not asked again
    const gap = last + GAP - Date.now(); if (gap > 0) { later(gap); return; }
    if (rest > now()) { later(Math.max(GAP, rest - now())); return; } // the service is resting
    want = null; busy = true;
    lookup(w.sp).then(d => {
      put(w.key, d);
      const tgt = want && want.key === w.key && want.id === w.id ? want : w; // the panel was redrawn while this was asked
      if (tgt === want) want = null;
      if (still(tgt)) fill(tgt.el, d);
    }, e => { failed.set(w.key, now()); if (e && e.busy) rest = now() + PAUSE; }).finally(() => { busy = false; last = Date.now(); if (want) later(GAP); });
  }
  // the search for a spot: its name near its position, in a box about 150 m each way (west, north, east, south), only inside the box
  function query(sp) {
    const q = [...String(sp.name).replace(/[\x00-\x1f\x7f-\x9f\u2028\u2029]/g, ' ').replace(/\s+/g, ' ').trim()].slice(0, Q_MAX).join('');
    const dLat = BOX / 111320, dLon = BOX / (111320 * Math.cos(sp.lat * Math.PI / 180)), f = v => v.toFixed(5);
    return `${API}?q=${encodeURIComponent(q)}&viewbox=${[f(sp.lon - dLon), f(sp.lat + dLat), f(sp.lon + dLon), f(sp.lat - dLat)].join(',')}&bounded=1&extratags=1&format=jsonv2&limit=${LIMIT}`;
  }
  // one request: the matching feature's shown tags, or null for nothing found (an empty list, or no result the spot's name and
  // position accept). Throws for a failed lookup; e.busy when the service should be left alone
  async function lookup(sp) {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null, t = ctl && setTimeout(() => ctl.abort(), TIMEOUT);
    const url = query(sp), log = { at: Date.now(), url }; api.requests.push(log); // for tests and the console: when, what, and how it went
    const fail = (msg, busy) => Object.assign(new Error(msg), { busy });
    try {
      let r;
      // no referrer: the page address carries the private log key
      try { r = await (api.fetcher || fetch)(url, { signal: ctl && ctl.signal, referrerPolicy: 'no-referrer', credentials: 'omit' }); }
      catch (e) { throw fail(e && e.name === 'AbortError' ? 'timeout' : 'no answer', true); } // a timeout, or no answer the page may read
      log.status = r && r.status; log.ms = Date.now() - log.at;
      if (!r || !r.ok) throw fail('details: ' + (r && r.status), !!r && [429, 502, 503, 504].includes(r.status));
      let j; try { j = await r.json(); } catch (e) { j = null; }
      if (!Array.isArray(j)) throw fail('details: no list', true); // a broken answer: a failed lookup (not "nothing here"), and a rest
      log.n = j.length;
      const e = pick(sp, j.slice(0, 5 * LIMIT).map(fromNominatim).filter(Boolean));
      return e ? keep(e) : null;
    } catch (e) { log.error = String(e.message || e).slice(0, 80); throw e; } finally { clearTimeout(t); }
  }

  // o: { ok() (may this page reach OpenStreetMap; false inside the artifact), isOpen(id) (the spot when its page is the one open,
  // else null), scope() (the log's key, or 'local': part of the hashed cache key) }
  function init(o) { opts = Object.assign(opts, o); }
  // the slot app.js puts below the Maps buttons: empty (and not displayed) until there is something to show, so nothing above it moves
  const slot = '<div class="pdet"></div>';
  const api = window.Details = { init, mount, slot, parseHours, hoursAt, nameKey, sameName, pick, keep, tidyCuisine, safeUrl, cleanPhone, fromNominatim, query, html, now: () => Date.now(), fetcher: null, requests: [], state: () => ({ waiting: !!want, ticking: !!live, busy, paused: Math.max(0, rest - now()) }), clear() { cache = null; failed.clear(); rest = 0; try { localStorage.removeItem(KEY); } catch (e) {} } };
})();
