// Adding faster: a pasted map link (Google, Apple, OpenStreetMap, geo:, plain coordinates) starts a filled-in draft; a photo's
// GPS position and date start one too; and a saved Google Maps list (the Takeout files) imports in one undoable save. Nothing
// is saved until the user confirms (the log form, or Import N places); lookups use only the place search the app already uses.
// init({ ... }) takes what it needs from app.js (see the call there); parse(text) is pure and never throws.
window.AddFast = (() => {
  // Short links (maps.app.goo.gl, goo.gl/maps, maps.apple/p) hide the place behind a redirect a page cannot follow. RESOLVE may
  // name an endpoint that answers GET <RESOLVE>?u=<short link> with { url: <the long link> }; the answer must parse as one of the
  // long forms below and is never opened. Empty: the user is told how to get the long link.
  const RESOLVE = '';
  const NAME = 80, NOTE = 400, WHERE = 120, CAP = 500, NEAR = 150, GAP = 1000, TEXT = 8192, FILE = 30 * 1024 * 1024;
  const LINE = {
    short: 'That short link hides the place. Open it in a browser and copy the long link, or search the name here.',
    unread: 'That short link could not be read. Open it in a browser and copy the long link, or search the name here.',
    hidden: 'That link does not include where the place is. Search the name here, or drop a pin.',
    other: 'That is not a map link. Paste a Google Maps, Apple Maps or OpenStreetMap link, or coordinates.',
    outside: 'That place is outside the map, which covers the Bay Area from Cloverdale to Gilroy.',
    paste: 'Paste the link into the field above.',
    noGps: 'This photo has no location in it. It stays attached: search the name or drop a pin.',
    outPhoto: 'That photo was taken outside the map. It stays attached: search the name or drop a pin.',
    nearby: 'Nearby places are listed above: pick one, or type the name.',
    noNear: 'No named places close by. Type the name.',
    down: 'the place search is not available right now',
  };
  let D = null, job = null; // D: what app.js passes to init; job: the Google import in progress
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const cut = (s, n) => Array.from(String(s).slice(0, n * 2)).slice(0, n).join('');
  const clean = (s, n = NAME) => typeof s === 'string' ? cut(s.slice(0, n * 4).replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim(), n).trim() : '';
  const okLL = (lat, lon) => typeof lat === 'number' && typeof lon === 'number' && isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);
  const inside = (lat, lon) => { const [a, b, c, d] = window.GEO.bbox; return okLL(lat, lon) && lon >= a && lon <= c && lat >= b && lat <= d; };
  const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/&/g, 'and').replace(/[^\p{L}\p{N}]+/gu, '');
  const metres = (a, b) => { const r = Math.PI / 180, x = (b.lon - a.lon) * r * Math.cos((a.lat + b.lat) * r / 2), y = (b.lat - a.lat) * r; return Math.hypot(x, y) * 6371000; };

  // ---------- parsing: text in, { t: 'place' | 'name' | 'short' | 'hidden' | 'other' | 'none', name, lat, lon, where, url } out ----------
  const none = () => ({ t: 'none' }), other = () => ({ t: 'other' }), hidden = () => ({ t: 'hidden' }); // a fresh object each time: a name written on one never shows up in the next
  const dec = s => String(s).replace(/\+/g, ' ').replace(/(%[0-9A-Fa-f]{2})+/g, m => { try { return decodeURIComponent(m); } catch (e) { return m; } }); // a stray % stays as it is
  const NUM = '(-?\\d{1,3}(?:\\.\\d+)?)';
  const PAIR = new RegExp(`^\\(?\\s*${NUM}\\s*(?:,|;|\\s)\\s*${NUM}\\s*\\)?$`);
  // '37.76, -122.41', 'loc:37.76,-122.41', '37.76,-122.41 (Label)', DMS ('37°45'42.6"N 122°24'42.1"W'), hemispheres ('37.76° N, 122.41° W')
  function coords(s) {
    s = clean(dec(s), 200).replace(/^loc:\s*/i, ''); let label = '';
    const lm = /^(.*?)\s*\(([^()]*)\)$/.exec(s); if (lm && lm[1]) { s = lm[1]; label = clean(lm[2]); }
    let m = PAIR.exec(s), lat, lon;
    if (m) { lat = +m[1]; lon = +m[2]; if (Math.abs(lat) > 90 && Math.abs(lon) <= 90) [lat, lon] = [lon, lat]; }
    else if ((m = /^(\d{1,2})°\s*(\d{1,2})['′]\s*(\d{1,2}(?:\.\d+)?)(?:["″]|'')?\s*([NS])[\s,]+(\d{1,3})°\s*(\d{1,2})['′]\s*(\d{1,2}(?:\.\d+)?)(?:["″]|'')?\s*([EW])$/i.exec(s))) {
      lat = (+m[1] + m[2] / 60 + m[3] / 3600) * (/s/i.test(m[4]) ? -1 : 1); lon = (+m[5] + m[6] / 60 + m[7] / 3600) * (/w/i.test(m[8]) ? -1 : 1);
    } else if ((m = /^(\d{1,2}(?:\.\d+)?)°?\s*([NS])[\s,]+(\d{1,3}(?:\.\d+)?)°?\s*([EW])$/i.exec(s))) { lat = m[1] * (/s/i.test(m[2]) ? -1 : 1); lon = m[3] * (/w/i.test(m[4]) ? -1 : 1); }
    else return null;
    return okLL(lat, lon) ? { lat, lon, label } : null;
  }
  const place = (ll, name, from, where) => ({ t: 'place', name: clean(name || ll.label || ''), lat: ll.lat, lon: ll.lon, where: clean(where || '', WHERE), from });
  const named = (name, from) => { const n = clean(name); return n && !PAIR.test(n) ? { t: 'name', name: n, from } : null; }; // '0,0' or '200,300' is no name
  function parse(input) { try { return parse1(input); } catch (e) { return none(); } }
  function parse1(input) {
    if (typeof input !== 'string') return none();
    const text = input.slice(0, TEXT).replace(/\r\n?/g, '\n').trim(); if (!text) return none();
    if (/^(javascript|data|vbscript|file|blob|about|chrome|intent):/i.test(text)) return other();
    const lines = text.split('\n').map(l => clean(l, 400)).filter(Boolean), link = /(?:https?:\/\/|geo:)/i;
    const first = lines.find(l => !link.test(l)) || ''; // a share sheet's text: the name on the first line, then the address, then the link
    const m = /(?:https?:\/\/|geo:)[^\s<>"]+/i.exec(text);
    if (m) {
      const r = fromUrl(m[0]);
      if (r.t === 'place' && !r.name && first && !coords(first)) r.name = clean(first);
      if ((r.t === 'short' || r.t === 'hidden') && first && !coords(first)) r.name = clean(first);
      return r;
    }
    if (lines.length === 1) { const ll = coords(lines[0]); return ll ? place(ll, '', 'coords') : none(); }
    for (let i = lines.length - 1; i >= 0; i--) { const ll = coords(lines[i]); if (ll) return place(ll, lines.find((l, j) => j !== i && !coords(l)) || '', 'coords'); }
    const n = named(lines[0], 'text'); if (n && lines[1]) n.where = clean(lines[1], WHERE); // 'Name\naddress': the address is kept, to choose between search results
    return n || none();
  }
  function fromUrl(raw) {
    if (/^geo:/i.test(raw)) return geo(raw);
    raw = raw.replace(/[.,;!?'"]+$/, '');
    let u; try { u = new URL(raw); } catch (e) { return other(); }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return other();
    const host = u.hostname.toLowerCase().replace(/^www\./, ''), p = u.pathname;
    if (host === 'maps.app.goo.gl' || (host === 'goo.gl' && /^\/maps/i.test(p)) || (host === 'maps.apple' && /^\/p\//i.test(p)) || ((host === 'osm.org' || host === 'openstreetmap.org') && /^\/go\//.test(p))) return { t: 'short', url: u.href, name: '' };
    if (/^(maps\.)?google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(host) && (host.startsWith('maps.') || /^\/maps(\/|$)/.test(p))) return google(u);
    if (host === 'maps.apple.com' || host === 'maps.apple') return apple(u);
    if (host === 'openstreetmap.org' || host === 'osm.org') return osm(u);
    return other();
  }
  const qp = (u, ...ks) => { for (const k of ks) { const v = u.searchParams.get(k); if (v) return v.slice(0, 2000); } return ''; };
  function google(u) {
    const p = u.pathname, segs = p.split('/').map(s => s.slice(0, 1000)), href = u.href;
    const d = /!3d(-?\d{1,3}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/.exec(href), at = /\/@(-?\d{1,3}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)(?:,|\/|$)/.exec(p);
    const seg = k => { const i = segs.indexOf(k), s = i >= 0 ? segs[i + 1] : ''; return s && !/^(@|data=)/.test(s) ? dec(s) : ''; };
    const pl = seg('place'), se = seg('search'), q0 = qp(u, 'q', 'query', 'daddr', 'destination'), pid = /^place_id:/i.test(q0), q = pid ? '' : q0, llp = qp(u, 'll'); // q=place_id:… is an id, not a name
    const di = segs.indexOf('dir'), dd = di >= 0 ? dec(segs.slice(di + 1).filter(s => s && !/^(@|data=)/.test(s)).pop() || '') : ''; // /maps/dir/<from>/<destination>
    const dn = dd && !coords(dd) ? dd.split(',') : null, dirName = dn ? clean(dn[0]) : ''; // 'Tartine, 595 Alabama St, San Francisco': the name, then its address
    const pick = [d && { lat: +d[1], lon: +d[2] }, coords(pl), coords(se), coords(q), coords(dd), llp && coords(llp), (pl || (!se && di < 0)) && at && { lat: +at[1], lon: +at[2] }].find(x => x && okLL(x.lat, x.lon)); // the place itself (!3d!4d) before the map's centre (@)
    const name = [pl, se, q].find(s => s && !coords(s)) || dirName || (pick && pick.label) || '', where = dirName && name === dirName ? clean(dn.slice(1).join(','), WHERE) : '';
    if (pick) return place(pick, name, 'google', where);
    const n = named(name, 'google'); if (n) { if (where) n.where = where; return n; }
    if (u.searchParams.get('cid') || u.searchParams.get('ftid') || pid) return hidden();
    return other();
  }
  function apple(u) {
    const pin = s => /^\s*(dropped pin|marked location)\s*$/i.test(s) ? '' : s; // Apple's words for a spot without a name
    const name = pin(qp(u, 'name', 'q', 'query')), dest = pin(qp(u, 'daddr', 'destination')), addr = qp(u, 'address');
    const pick = [coords(qp(u, 'coordinate')), coords(qp(u, 'll')), coords(name), coords(dest)].find(Boolean); // sll and center are where a search looked, not a place
    const nm = [name, dest].find(s => s && !coords(s)) || '';
    if (pick) return place(pick, nm, 'apple', addr);
    return named(nm, 'apple') || (/^\/p\//.test(u.pathname) || u.searchParams.get('place-id') || u.searchParams.get('auid') ? hidden() : other());
  }
  function osm(u) {
    const ml = okLL(+u.searchParams.get('mlat'), +u.searchParams.get('mlon')) && u.searchParams.get('mlat') !== null ? { lat: +u.searchParams.get('mlat'), lon: +u.searchParams.get('mlon') } : null;
    const h = /map=\d{1,2}\/(-?\d{1,3}(?:\.\d+)?)\/(-?\d{1,3}(?:\.\d+)?)/.exec(u.hash), hm = h && { lat: +h[1], lon: +h[2] };
    const qy = qp(u, 'query'), qc = coords(qy); // a search page: its query is the place; #map is only where the map was looking
    if (ml) return place(ml, '', 'osm'); if (qc) return place(qc, '', 'osm');
    const n = named(qy, 'osm'); if (n) return n;
    if (hm && okLL(hm.lat, hm.lon)) return place(hm, '', 'osm');
    return /^\/(node|way|relation)\//.test(u.pathname) ? hidden() : other();
  }
  function geo(raw) { // geo:37.76,-122.41?q=Name, geo:0,0?q=37.76,-122.41(Name), geo:0,0?q=Name+SF
    const m = /^geo:([^?;#]*)(?:;[^?#]*)?(?:\?([^#]*))?/i.exec(raw.slice(0, 2000)); if (!m) return other();
    let q = ''; try { q = new URLSearchParams(m[2] || '').get('q') || ''; } catch (e) {}
    const base = coords(m[1]), qc = coords(q);
    if (qc) return place(qc, '', 'geo');
    if (base) return place(base, q, 'geo');
    return named(q, 'geo') || other();
  }

  // ---------- short links: the optional resolver ----------
  async function resolve(url) {
    const c = new AbortController(), t = setTimeout(() => c.abort(), 6000); // the timeout runs until the whole answer is read
    try {
      const res = await fetch(RESOLVE + (RESOLVE.includes('?') ? '&' : '?') + 'u=' + encodeURIComponent(url), { signal: c.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
      if (!res.ok) return null;
      const text = await capped(res, c); if (text == null) return null;
      const body = JSON.parse(text), long = body && typeof body.url === 'string' && body.url.length < TEXT ? body.url : '';
      const r = /^https:\/\//i.test(long) ? fromUrl(long) : none();
      return r.t === 'place' || r.t === 'name' ? r : null; // another short link, a non-maps address or anything else: refused
    } catch (e) { return null; } finally { clearTimeout(t); }
  }
  async function capped(res, c, max = 4096) { // the answer as text, at most 4 KB: anything longer is dropped unread
    if (+res.headers.get('content-length') > max) { c.abort(); return null; }
    if (!res.body || !res.body.getReader) { const s = await res.text(); return s.length > max ? null : s; }
    const rd = res.body.getReader(), got = []; let n = 0;
    for (;;) { const { done, value } = await rd.read(); if (done) break; n += value.byteLength; if (n > max) { c.abort(); return null; } got.push(value); }
    const all = new Uint8Array(n); let o = 0; for (const g of got) { all.set(g, o); o += g.byteLength; }
    return new TextDecoder().decode(all);
  }

  // ---------- the log form: paste, the Paste button, From a photo ----------
  // d._af (only on the draft, never saved): { msg, photo: File, url: preview, taken, kt: kind taps }
  const af = d => d._af || (d._af = { msg: '', photo: null, url: '', taken: '', kt: 0 });
  const formOf = d => D.state.draft === d && D.state.view === 'log' && D.panel.querySelector('#logform');
  function say(d, text) { af(d).msg = text || ''; const el = formOf(d) && D.panel.querySelector('#af-msg'); if (el) { el.textContent = text || ''; el.hidden = !text; } }
  const linked = r => r.t === 'place' || r.t === 'short' || r.t === 'hidden' || (r.t === 'name' && r.from !== 'text'); // a map link or coordinates, not any text
  function form(root, d) {
    const f = root.querySelector('#logform'), qi = f && f.querySelector('#lf-q'); if (!qi || d.id) return;
    const a = af(d), after = root.querySelector('#lf-nosearch') || qi.closest('.field');
    const near = d.lon != null && !(d.name || '').trim() && (d.src === 'photo' || d.src === 'link'); // a position without a name: nearby names only when asked (they cost a lookup of the position)
    after.insertAdjacentHTML('afterend', `<div class="textlinks af-add"><button type="button" id="af-paste">Paste a link</button><button type="button" id="af-photo">From a photo</button>${near ? '<button type="button" id="af-near">Suggest names nearby</button>' : ''}</div>`
      + `<p class="empty af-msg" id="af-msg" role="status" ${a.msg ? '' : 'hidden'}>${esc(a.msg)}</p>`
      + (a.photo ? `<div class="af-photo"><img alt="" src="${esc(a.url)}"><span>Photo attached${a.taken ? ' · taken ' + esc(D.niceDate(a.taken)) : ''}<small>${D.canPhoto() ? 'It is added to the spot when you save.' : 'Photos are kept only in a shared log: this one is not saved here.'}</small></span><button type="button" class="act" id="af-unphoto">Remove</button></div>` : '')
      + '<input type="file" id="af-file" accept="image/*" hidden>');
    // a link or coordinates pasted, dropped or entered in the name field are taken before the search sees them; typing is left alone until Enter
    f.addEventListener('paste', e => { if (e.target !== qi) return; const t = e.clipboardData && e.clipboardData.getData('text'); if (t && parse(t).t !== 'none') { e.preventDefault(); e.stopPropagation(); take(t, d); } }, true);
    f.addEventListener('input', e => {
      if (e.target !== qi) return; const v = qi.value;
      if (/^insertFrom(Paste|Drop)/.test(e.inputType || '')) { if (parse(v).t !== 'none') { e.stopPropagation(); take(v, d); } return; }
      if (a.msg === LINE.nearby) say(d, ''); const nb = D.panel.querySelector('#af-near'); if (nb) nb.hidden = !!v.trim(); // typing replaces the nearby list
      if (/^\s*(https?:|geo:)/i.test(v)) { d.name = v; e.stopPropagation(); D.hush(); } // a link being typed by hand: kept as typed, and not sent to the place search
    }, true);
    f.addEventListener('keydown', e => { if (e.target !== qi || e.key !== 'Enter') return; if (parse(qi.value).t !== 'none') { e.preventDefault(); e.stopPropagation(); take(qi.value, d); } }, true);
    root.querySelector('#af-paste').addEventListener('click', async () => { // the clipboard is read only on this tap, and only where the browser allows it
      let t = null; try { if (navigator.clipboard && navigator.clipboard.readText) t = await navigator.clipboard.readText(); } catch (e) {}
      if (D.state.draft !== d) return;
      if (t && linked(parse(t))) take(t, d);
      else if (t && t.trim()) say(d, LINE.other); // the clipboard may hold anything: it is not shown, kept or searched
      else { say(d, LINE.paste); const q = formOf(d) && D.panel.querySelector('#lf-q'); if (q) q.focus(); }
    });
    const file = root.querySelector('#af-file');
    root.querySelector('#af-photo').addEventListener('click', () => file.click());
    file.addEventListener('change', () => { const fl = file.files && file.files[0]; file.value = ''; if (fl) photo(fl, d); });
    const un = root.querySelector('#af-unphoto'); if (un) un.addEventListener('click', () => { dropPhoto(d); D.redraw(d); });
    const nb = root.querySelector('#af-near'); if (nb) nb.addEventListener('click', () => { nb.disabled = true; nearby(d).finally(() => { nb.hidden = true; }); });
    const ks = root.querySelector('#lf-kind'); if (ks) ks.addEventListener('click', e => { if (e.target.closest('[data-k]')) a.kt++; });
  }
  function setName(d, name) { d.name = name; const q = formOf(d) && D.panel.querySelector('#lf-q'); if (q) q.value = name; } // a value set from script fires no input event
  async function take(text, d) {
    const r = parse(text); say(d, '');
    if (r.t === 'none') return false;
    const keep = parse(d.name || '').t === 'none' ? clean(d.name || '') : ''; // what was typed before the paste, unless it is the link itself
    if (r.t === 'short') {
      if (!RESOLVE) { setName(d, r.name || keep); say(d, LINE.short); if (r.name) D.search(r.name); return true; }
      say(d, 'Reading the short link…'); const n0 = d.name, a0 = d.lat, o0 = d.lon, got = await resolve(r.url);
      if (D.state.draft !== d) return true;
      if (d.name !== n0 || d.lat !== a0 || d.lon !== o0) { if (af(d).msg === 'Reading the short link…') say(d, ''); return true; } // another place was chosen meanwhile: it stands
      if (got) { say(d, ''); return apply(got, d, keep); }
      setName(d, r.name || keep); say(d, LINE.unread); if (r.name) D.search(r.name); return true;
    }
    if (r.t === 'hidden' || r.t === 'other') { setName(d, r.name || keep); say(d, LINE[r.t]); if (r.name) D.search(r.name); return true; }
    return apply(r, d, keep);
  }
  function apply(r, d, keep) {
    if (r.t === 'name') { setName(d, r.name); if (r.where) byAddress(d, r); else D.search(r.name); return true; }
    if (!inside(r.lat, r.lon)) { setName(d, r.name || keep); say(d, LINE.outside); return true; }
    D.place(d, { name: r.name || keep, lat: r.lat, lon: r.lon, where: r.where || '', src: 'link' });
    if (r.name) kindOf(d, r); // no name: the quiet 'Suggest names nearby' link instead
    return true;
  }
  // the address a place is known by: its city, or its house number and street, appear in the address given (a: normalised)
  const SUF = /\s+(street|st|avenue|ave|boulevard|blvd|road|rd|drive|dr|lane|ln|way|place|pl|court|ct|terrace|ter|highway|hwy|parkway|pkwy)\.?$/i;
  const cityIn = (x, a) => { const c = norm(x.city || String(x.where || '').split(' · ').pop()); return c.length >= 3 && a.includes(c); };
  const agrees = (x, a) => { if (cityIn(x, a)) return true; const s = norm(String(x.street || '').replace(SUF, '')), h = norm(x.num || ''); return !!(s && h) && a.includes(h + s); };
  const alike = (x, n) => { const m = norm(x.name); return m === n || (m.length >= 4 && n.length >= 4 && (m.includes(n) || n.includes(m))); };
  // 'Name\naddress' pasted: one search result of that name whose address agrees is placed, with the pasted address as its line; otherwise the usual list
  async function byAddress(d, r) {
    let res = []; try { res = await window.Places.search(r.name, null, { explicit: true }); } catch (e) { res = []; }
    if (D.state.draft !== d || d.name !== r.name || d.lon != null) return; // typed over, or placed meanwhile
    const n = norm(r.name), a = norm(r.where); let c = (res || []).filter(x => alike(x, n) && agrees(x, a));
    if (c.length > 1 && c.every(x => metres(x, c[0]) <= NEAR)) c = [c[0]];
    if (c.length === 1) D.place(d, { name: r.name, lat: c[0].lat, lon: c[0].lon, where: r.where, src: 'search', kind: c[0].kind });
    else D.search(r.name);
  }
  // the kind, when the place search knows a place of exactly that name within about 150 m; the form changes in place, never by a rebuild
  async function kindOf(d, r) {
    const n = norm(r.name), k0 = d.kind, t0 = af(d).kt; if (!n) return;
    let res = []; try { res = await window.Places.search(r.name, [r.lon, r.lat]); } catch (e) { return; }
    if (D.state.draft !== d || d.lat !== r.lat || d.lon !== r.lon || d.kind !== k0 || af(d).kt !== t0) return; // moved, or a kind chosen meanwhile: the user's choice stands
    const hit = res.find(x => metres(x, r) <= NEAR && norm(x.name) === n);
    if (hit && hit.kind && D.kinds[hit.kind]) { d.kind = hit.kind; if (formOf(d)) D.panel.querySelectorAll('#lf-kind [data-k]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.k === d.kind))); }
  }
  // asked for ('Suggest names nearby'): the nearest named places from the place search, as suggestions; the user picks one or types
  async function nearby(d) {
    const lat = d.lat, lon = d.lon; if (lat == null || !window.Places.reverse) return; let res = [];
    try { res = await window.Places.reverse(lon, lat); } catch (e) { res = null; }
    if (D.state.draft !== d || d.lat !== lat || d.lon !== lon) return; // the spot moved meanwhile: these were for the old position
    const f = formOf(d), sug = f && D.panel.querySelector('#lf-sug'); if (!sug || (d.name || '').trim()) return;
    if (!res || !res.length) { say(d, LINE.noNear); return; }
    res = res.slice(0, 5);
    sug.innerHTML = res.map((r, i) => `<li><button type="button" data-af="${i}"><span><b>${esc(r.name)}</b><small>${esc(r.where)}</small></span><span class="k">${esc(r.osm)}</span></button></li>`).join(''); sug.hidden = false;
    say(d, LINE.nearby);
    sug.querySelectorAll('[data-af]').forEach(b => b.addEventListener('click', () => { const r = res[+b.dataset.af]; say(d, ''); D.place(d, { name: r.name, lat: r.lat, lon: r.lon, where: r.where, src: 'search', kind: r.kind }); }));
  }
  function dropPhoto(d) { const a = af(d); if (a.url) URL.revokeObjectURL(a.url); a.photo = null; a.url = ''; a.taken = ''; }
  async function photo(file, d) {
    const [g, taken] = await Promise.all([gpsOf(file), window.Photos && Photos.takenOf ? Photos.takenOf(file).catch(() => undefined) : undefined]);
    if (D.state.draft !== d) return;
    dropPhoto(d); const a = af(d); a.photo = file; try { a.url = URL.createObjectURL(file); } catch (e) {}
    if (typeof taken === 'string' && taken <= D.today()) { a.taken = taken; d.at = taken; }
    d.status = 'been';
    const free = d.lon == null || /^(gps|approx|pin|photo)$/.test(d.src || ''); // a place the user chose (a search pick, a link) stays: the photo is only attached
    if (free && g && inside(g.lat, g.lon)) { a.msg = ''; D.place(d, { name: parse(d.name || '').t === 'none' ? d.name : '', lat: g.lat, lon: g.lon, where: 'Where the photo was taken', src: 'photo' }); return g; }
    a.msg = !free ? '' : g ? LINE.outPhoto : LINE.noGps; D.redraw(d); return g;
  }
  // the spot's save (ok: it was saved): the photo goes up as its first, or the user hears it did not; the preview is let go either way
  function saved(d, id, ok) { const a = d && d._af; if (!a) return; if (a.photo && D.canPhoto()) { if (ok) D.addPhoto(id, a.photo, d.name); else D.toast('The photo was not added', 4000); } dropPhoto(d); }
  function left(d) { if (d && d._af) dropPhoto(d); } // the form was cancelled

  // ---------- EXIF GPS: the GPS IFD of the TIFF block in a JPEG's APP1 or a HEIC's Exif item (the same walk as js/photos.js takenOf) ----------
  async function gpsOf(file) {
    try {
      const v = new DataView(await file.slice(0, 131072).arrayBuffer());
      if (v.getUint16(0) === 0xFFD8) { for (let p = 2; p + 4 <= v.byteLength;) { if (v.getUint8(p) !== 0xFF) return null; const m = v.getUint8(p + 1); if (m === 0xFF) { p++; continue; } if (m === 0x01 || (m >= 0xD0 && m <= 0xD8)) { p += 2; continue; } if (m === 0xDA || m === 0xD9) return null; const len = v.getUint16(p + 2); if (m === 0xE1 && len > 16 && v.getUint32(p + 4) === 0x45786966 && v.getUint16(p + 8) === 0) return tiffGps(v, p + 10, Math.min(v.byteLength, p + 2 + len)); p += 2 + len; } return null; }
      if (v.getUint32(4) === 0x66747970) { const x = await heicExif(file, v); return x ? tiffGps(x, 4 + x.getUint32(0), x.byteLength) : null; }
    } catch (e) {}
    return null;
  }
  function tiffGps(v, t, end) {
    const bo = v.getUint16(t); if (bo !== 0x4949 && bo !== 0x4D4D) return null;
    const le = bo === 0x4949, lim = end - t, u16 = o => v.getUint16(t + o, le), u32 = o => v.getUint32(t + o, le);
    if (u16(2) !== 42) return null;
    const tag = (ifd, want) => { if (ifd < 8 || ifd + 2 > lim) return -1; const n = Math.min(u16(ifd), 400); for (let k = 0; k < n; k++) { const at = ifd + 2 + k * 12; if (at + 12 > lim) return -1; if (u16(at) === want) return at; } return -1; };
    const gp = tag(u32(4), 0x8825); if (gp < 0) return null; const g = u32(gp + 8); // the GPS IFD pointer in IFD0
    const deg = k => { const at = tag(g, k); if (at < 0 || u16(at + 2) !== 5 || u32(at + 4) !== 3) return NaN; const off = u32(at + 8); if (off + 24 > lim) return NaN; let s = 0; for (let i = 0; i < 3; i++) { const dd = u32(off + i * 8 + 4); if (!dd) return i ? s : NaN; s += u32(off + i * 8) / dd / 60 ** i; } return s; }; // three RATIONALs: degrees, minutes, seconds
    const ref = k => { const at = tag(g, k); return at < 0 ? '' : String.fromCharCode(v.getUint8(t + at + 8)); }; // 'N\0': two ASCII bytes, inline
    let lat = deg(2), lon = deg(4); if (ref(1) === 'S') lat = -lat; if (ref(3) === 'W') lon = -lon;
    return okLL(lat, lon) ? { lat, lon } : null;
  }
  async function heicExif(file, v) { // ISO BMFF: meta > iinf names the 'Exif' item, meta > iloc says where its bytes are
    const n64 = o => Number(v.getBigUint64(o)), int = (o, sz) => sz === 4 ? v.getUint32(o) : sz === 8 ? n64(o) : sz === 2 ? v.getUint16(o) : 0;
    const boxes = (s, e, fn) => { for (let p = s; p + 8 <= e;) { let n = v.getUint32(p), h = 8; if (n === 1) { n = n64(p + 8); h = 16; } else if (n === 0) n = e - p; if (n < h || p + n > e) return; fn(v.getUint32(p + 4), p + h, p + n); p += n; } };
    let meta = null, iinf = null, iloc = null, item = -1;
    boxes(0, v.byteLength, (ty, s, e) => { if (ty === 0x6D657461 && !meta) meta = [s + 4, e]; }); if (!meta) return null;
    boxes(meta[0], meta[1], (ty, s, e) => { if (ty === 0x69696E66) iinf = [s, e]; else if (ty === 0x696C6F63) iloc = [s, e]; }); if (!iinf || !iloc) return null;
    boxes(iinf[0] + (v.getUint8(iinf[0]) ? 8 : 6), iinf[1], (ty, s) => { if (ty !== 0x696E6665 || item >= 0) return; const fv = v.getUint8(s); if (fv < 2) return; const id = fv === 2 ? v.getUint16(s + 4) : v.getUint32(s + 4); if (v.getUint32(s + (fv === 2 ? 8 : 10)) === 0x45786966) item = id; });
    if (item < 0) return null;
    const lv = v.getUint8(iloc[0]), sizes = v.getUint8(iloc[0] + 4), more = v.getUint8(iloc[0] + 5), os = sizes >> 4, ls = sizes & 15, bs = more >> 4, xs = lv ? more & 15 : 0;
    let p = iloc[0] + 6; const count = lv < 2 ? v.getUint16(p) : v.getUint32(p); p += lv < 2 ? 2 : 4;
    for (let k = 0; k < count && p < iloc[1]; k++) {
      const id = lv < 2 ? v.getUint16(p) : v.getUint32(p); p += lv < 2 ? 2 : 4;
      let method = 0; if (lv) { method = v.getUint16(p) & 15; p += 2; }
      p += 2; const base = int(p, bs); p += bs; const ext = v.getUint16(p); p += 2;
      if (id !== item) { p += ext * (xs + os + ls); continue; }
      if (method !== 0 || !ext) return null;
      p += xs; const off = base + int(p, os); p += os; const len = int(p, ls) || 65536;
      return new DataView(await file.slice(off, off + Math.min(len, 65536)).arrayBuffer());
    }
    return null;
  }

  // ---------- Google Maps saved places (Takeout): Saved Places.json and the per-list .csv files ----------
  function settings(root) {
    const b = root.querySelector('#import'); if (!b || root.querySelector('#af-gimport')) return;
    b.insertAdjacentHTML('afterend', '<button type="button" class="btn sm" id="af-gimport">Import from Google Maps</button><input type="file" id="af-gfile" accept=".json,.csv,application/json,text/csv" multiple hidden>');
    const inp = root.querySelector('#af-gfile');
    root.querySelector('#af-gimport').addEventListener('click', () => inp.click());
    inp.addEventListener('change', () => { const fs = [...(inp.files || [])]; inp.value = ''; if (fs.length) load(fs); });
  }
  function csv(text) { // RFC 4180: quoted fields with commas, quotes ("") and newlines inside
    const out = []; let row = [], f = '', q = false, i = 0; const n = text.length;
    while (i < n) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i += 2; continue; } q = false; i++; continue; } const j = text.indexOf('"', i); const e = j < 0 ? n : j; f += text.slice(i, e); i = e; continue; }
      if (c === '"') { q = true; i++; } else if (c === ',') { row.push(f); f = ''; i++; } else if (c === '\n' || c === '\r') { row.push(f); out.push(row); row = []; f = ''; i += c === '\r' && text[i + 1] === '\n' ? 2 : 1; }
      else { let e = i; while (e < n && text[e] !== ',' && text[e] !== '"' && text[e] !== '\n' && text[e] !== '\r') e++; f += text.slice(i, e); i = e; }
    }
    if (f || row.length) { row.push(f); out.push(row); }
    return out;
  }
  const str = v => typeof v === 'string' ? v : '';
  const obj = v => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  function row(name, note, url, where, lat, lon, file) { // one candidate place: the link fills in a missing name or position
    const l = url ? parse(url) : none();
    if (!okLL(lat, lon) && l.t === 'place') { lat = l.lat; lon = l.lon; }
    name = clean(name) || (l.t === 'place' || l.t === 'name' ? l.name : '') || clean(where);
    if (!name) return null;
    return { name, note: clean(note, NOTE), where: clean(where, WHERE), lat: okLL(lat, lon) ? lat : null, lon: okLL(lat, lon) ? lon : null, kind: null, file, on: true };
  }
  function fromJSON(text, file) {
    let body; try { body = JSON.parse(text); } catch (e) { return null; }
    const feats = Array.isArray(obj(body).features) ? body.features : null; if (!feats) return null;
    const out = [];
    for (const f of feats) {
      const p = obj(obj(f).properties), loc = obj(p.location), old = obj(p.Location), g = obj(obj(f).geometry), c = Array.isArray(g.coordinates) ? g.coordinates : [], gc = obj(old['Geo Coordinates']);
      let lat = +c[1], lon = +c[0]; if (!okLL(lat, lon)) { lat = +gc.Latitude; lon = +gc.Longitude; }
      const r = row(str(p.Title) || str(loc.name) || str(old['Business Name']) || str(p.name), str(p.Comment) || str(p.comment) || str(p.Note), str(p.google_maps_url) || str(p['Google Maps URL']), str(loc.address) || str(old.Address), lat, lon, file);
      if (!r) continue;
      const cc = str(loc.country_code).trim().toUpperCase(); if (r.lat == null && cc && cc !== 'US') { r.why = 'outside the Bay Area'; r.on = false; } // another country: not looked up
      const t = Date.parse(str(p.date).slice(0, 40)); if (isFinite(t)) { const day = new Date(t).toISOString().slice(0, 10); if (day >= '1990-01-01' && day <= D.today()) r.at = day; } // when it was saved: the date of a 'been' import
      out.push(r);
    }
    return out;
  }
  function fromCSV(text, file) {
    const t = csv(text), h = (t[0] || []).map(s => s.trim().toLowerCase()), col = k => h.indexOf(k);
    const ti = col('title'); if (ti < 0) return null;
    const ni = col('note'), ui = col('url'), ci = col('comment'), out = [];
    for (let k = 1; k < t.length; k++) { const r = t[k], v = i => (i >= 0 && typeof r[i] === 'string' ? r[i] : ''); const x = row(v(ti), v(ni) || v(ci), v(ui), '', NaN, NaN, file); if (x) out.push(x); }
    return out;
  }
  async function load(files) {
    const rows = [], bad = [];
    for (const f of files.slice(0, 20)) {
      let got = null;
      if (f.size <= FILE) { let text = ''; try { text = (await f.text()).replace(/^﻿/, ''); } catch (e) {} got = /\.json$/i.test(f.name) || /^\s*[{[]/.test(text) ? fromJSON(text, f.name) : fromCSV(text, f.name); }
      if (got) rows.push(...got); else bad.push(clean(f.name, 60) || 'A file');
    }
    if (!rows.length) { D.toast(bad.length ? 'That is not a Google Maps saved places file' : 'No places in that file', 3200); return; }
    const total = rows.length, list = rows.slice(0, CAP), seen = [];
    const spots = Object.keys(D.state.spots).map(id => D.state.spots[id]).filter(s => s && typeof s.name === 'string').map(s => ({ n: norm(s.name), lat: s.lat, lon: s.lon }));
    for (const r of list) { // already in the log: the same name within about 150 m, or the same name when this row has no position yet
      const n = norm(r.name), near = s => s.n === n && (r.lat == null || !okLL(s.lat, s.lon) || metres(s, r) <= NEAR);
      if (spots.some(near)) { r.dup = 'already in your log'; r.on = false; } else if (seen.some(near)) { r.dup = 'also earlier in this import'; r.on = false; }
      if (r.lat != null && !inside(r.lat, r.lon)) { r.why = 'outside the map'; r.on = false; }
      seen.push({ n, lat: r.lat, lon: r.lon });
      if (r.lat != null && !r.why) hood(r);
    }
    job = { rows: list, total, bad, files: files.length, status: 'want', phase: 'review', k: 0, n: 0 };
    D.go(D.state.loc, { view: 'gimport', fly: false, replace: true, sheet: D.isPhone() ? 'full' : undefined });
  }
  const at = r => { const w = D.where(r.lon, r.lat); return { hood: w.hood, sub: w.sub }; };
  const hood = r => { Object.assign(r, at(r)); if (!r.hood) r.on = false; }; // inside the map but in no named place: it would show only on the map, so it is not ticked
  const landing = r => r.why ? r.why : r.lat == null ? 'needs a location' : (r.hood ? (r.sub ? r.sub + ', ' + r.hood : r.hood) : 'outside the named places (only shows on the map)') + (r.found ? ' · found by name' : '');
  const fixed = r => r.why === 'outside the map' || r.why === 'outside the Bay Area' || (r.tried && r.lat == null); // rows that cannot be imported: no tick box
  const plural = n => n + (n === 1 ? ' place' : ' places');
  function renderImport() {
    const j = job; if (!j) { D.state.view = null; D.render(); return; }
    D.setHead({ eyebrow: 'Settings', title: 'Import from Google Maps', onBack: leave, tools: [] });
    const P = D.panel, chosen = j.rows.filter(r => r.on).length;
    if (j.phase === 'done') {
      const miss = j.failed ? [] : j.rows.filter(r => r.miss);
      P.innerHTML = `<p class="lead">${j.failed ? 'The import could not be saved. Nothing was added.' : j.undone ? `Undone: ${plural(j.undone)} removed.` : `Imported ${plural(j.ids.length)} as ${j.status === 'been' ? 'been' : 'want to go'}.`}</p>`
        + (miss.length ? `<h3>Not imported <span class="n">${miss.length}</span></h3><ul class="rows">${miss.map(r => `<li><div class="row af-miss"><span class="nm">${esc(r.name)}<small>${esc(r.why || 'not found')}</small></span></div></li>`).join('')}</ul>` : '')
        + `<div class="actions af-bar"><button type="button" class="btn primary" id="af-done">Done</button></div>`;
      P.querySelector('#af-done').addEventListener('click', leave); return;
    }
    const finding = j.phase === 'finding', busy = j.phase === 'busy', found = j.rows.filter(r => r.found).length, files = Math.min(j.files, 20);
    P.innerHTML = `<p class="lead">${plural(j.rows.length)} from ${files === 1 ? 'your file' : files + ' files'}. Untick any you do not want.</p>`
      + (j.files > 20 ? `<p class="af-note">Read the first 20 of ${j.files} files.</p>` : '')
      + (j.total > CAP ? `<p class="af-note">That is ${j.total.toLocaleString()} places. One import takes at most ${CAP}, so only the first ${CAP} are listed.</p>` : '')
      + (j.bad.length ? `<p class="af-note">Not read: ${esc(j.bad.join(', '))}. Only Saved Places.json and the list .csv files from Google Takeout can be imported.</p>` : '')
      + (j.down && !finding ? '<p class="af-note">The place search is not available right now. The places it could not look up are unticked: tick them to try again later.</p>' : '')
      + (found && !finding ? `<p class="af-note">${plural(found)} found by name. Check where each landed, then import.</p>` : '')
      + `<div class="field"><label>Add them as</label><div class="seg" id="af-status"><button type="button" data-s="want" aria-pressed="${j.status === 'want'}" ${finding ? 'disabled' : ''}>Want to go</button><button type="button" data-s="been" aria-pressed="${j.status === 'been'}" ${finding ? 'disabled' : ''}>Been</button></div></div>`
      + `<ul class="rows af-rows">${j.rows.map((r, i) => `<li><label class="row af-row${r.on ? '' : ' off'}"><input type="checkbox" data-i="${i}" ${r.on ? 'checked' : ''} ${fixed(r) || finding ? 'disabled' : ''} aria-label="${esc(r.name)}"><span class="nm">${esc(r.name)}<small>${esc([landing(r), r.dup].filter(Boolean).join(' · '))}</small></span></label></li>`).join('')}</ul>`
      + `<div class="actions af-bar" id="af-bar">${finding ? `<div class="progress af-prog"><div class="bar"><i style="width:${j.n ? (j.k / j.n * 100).toFixed(1) : 0}%"></i></div><small id="af-k" aria-live="polite">Finding ${Math.min(j.k + 1, j.n)} of ${j.n}</small></div><button type="button" class="btn" id="af-stop">Cancel</button>` : `<button type="button" class="btn primary" id="af-go" ${chosen && !busy ? '' : 'disabled'}>Import ${plural(chosen)}</button><button type="button" class="btn" id="af-cancel">Cancel</button>`}</div>`;
    P.querySelectorAll('#af-status [data-s]').forEach(b => b.addEventListener('click', () => { j.status = b.dataset.s; P.querySelectorAll('#af-status [data-s]').forEach(x => x.setAttribute('aria-pressed', String(x === b))); }));
    P.querySelectorAll('.af-rows input').forEach(c => c.addEventListener('change', () => { const r = j.rows[+c.dataset.i]; r.on = c.checked; c.closest('.af-row').classList.toggle('off', !r.on); const n = j.rows.filter(x => x.on).length, g = P.querySelector('#af-go'); if (g) { g.textContent = `Import ${plural(n)}`; g.disabled = !n || j.phase !== 'review'; } }));
    const go = P.querySelector('#af-go'); if (go) go.addEventListener('click', () => { go.disabled = true; run(j); }); // off from the first tap
    const no = P.querySelector('#af-cancel'); if (no) no.addEventListener('click', leave);
    const st = P.querySelector('#af-stop'); if (st) st.addEventListener('click', () => stop(j));
  }
  function stop(j) { j.cancel = true; if (j.wake) j.wake(); if (j.ac) j.ac.abort(); } // Cancel: the wait between lookups and the lookup in flight both end now
  function leave() { if (job) stop(job); job = null; D.go(D.state.loc, { replace: true, fly: false }); }
  const live = j => job === j && !j.cancel && D.state.view === 'gimport';
  let last = 0; // the last place-search request: at most one a second
  async function gap(j) { const w = last + GAP - Date.now(); if (w > 0) await new Promise(r => { const t = setTimeout(r, w); j.wake = () => { clearTimeout(t); r(); }; }); j.wake = null; last = Date.now(); }
  // one lookup: null when cancelled, false when the search failed (or timed out); only the first search service, never its fallback
  async function ask(j, q) { await gap(j); if (!live(j)) return null; try { return await window.Places.search(q, null, { signal: j.ac && j.ac.signal }); } catch (e) { return e && e.name === 'AbortError' ? null : false; } }
  // a row without a position: the place search by name. With an address, a match counts only where its city (or house number and
  // street) is in that address, and failing that the address itself is searched, kept only when its city is in it too. Without an
  // address, only a single place of exactly that name is taken (several results within 150 m of each other count as one). Anything else stays unlocated: no guess. 'down': the search failed.
  async function locate(j, r) {
    r.why = '';
    const res = await ask(j, r.name); if (res === null) return; if (res === false) return 'down';
    const n = norm(r.name), a = r.where ? norm(r.where) : '';
    let c = a ? res.filter(x => alike(x, n) && agrees(x, a)) : res.filter(x => norm(x.name) === n);
    if (c.length > 1 && c.every(x => metres(x, c[0]) <= NEAR)) c = [c[0]]; // the search often lists one place twice: results within 150 m of each other are one place
    if (c.length === 1) { const x = c[0]; Object.assign(r, { lat: x.lat, lon: x.lon, kind: x.kind || null, where: r.where || clean(x.where || '', WHERE) }); return; }
    if (c.length > 1) { r.why = 'more than one place has this name'; return; }
    if (!a) { r.why = 'not found by the place search'; return; }
    const ra = await ask(j, r.where); if (ra === null) return; if (ra === false) return 'down';
    const x = ra.find(y => cityIn(y, a)); if (x) { Object.assign(r, { lat: x.lat, lon: x.lon }); return; }
    r.why = 'not found in the Bay Area';
  }
  // Import N places: first the rows without a position are looked up and the list comes back showing where each landed; the next tap saves
  async function run(j) {
    if (j.phase !== 'review') return; j.phase = 'busy'; // one run at a time: a second tap does nothing
    await D.beforeWrite(); if (job !== j || D.state.view !== 'gimport') { j.phase = 'review'; return; }
    const todo = j.rows.filter(r => r.on && r.lat == null && !r.tried);
    if (!todo.length) return save(j);
    j.phase = 'finding'; j.k = 0; j.n = todo.length; j.cancel = false; j.down = false; j.ac = new AbortController();
    renderImport();
    for (const r of todo) {
      if (!live(j)) break;
      const got = await locate(j, r); if (!live(j)) break;
      if (got === 'down') { j.down = true; for (const x of todo) if (!x.tried && x.lat == null) { x.why = LINE.down; x.on = false; } break; } // the search is down: no point trying the rest
      r.tried = true; j.k++; if (r.lat != null) { r.found = true; hood(r); } else r.on = false;
      const b = D.panel.querySelector('.af-prog'); if (b) { b.querySelector('i').style.width = (j.k / j.n * 100).toFixed(1) + '%'; b.querySelector('#af-k').textContent = `Finding ${Math.min(j.k + 1, j.n)} of ${j.n}`; }
    }
    j.ac = null; if (job !== j) return;
    j.cancel = false; j.phase = 'review'; // nothing is saved yet: the list again, with where each found place landed
    if (D.state.view === 'gimport') renderImport();
  }
  async function save(j) {
    const S = D.state, by = D.who(), day = D.today(), base = 's' + Date.now().toString(36), ids = [], snap = {};
    j.rows.forEach(r => { r.miss = !r.on && !!r.why && !r.dup; });
    for (const r of j.rows) {
      if (!r.on) continue;
      if (r.lat == null) { r.miss = true; r.why = r.why || 'no location found'; continue; }
      if (!inside(r.lat, r.lon)) { r.miss = true; r.why = 'outside the map'; continue; }
      let id = base + 'g' + ids.length.toString(36); while (Object.hasOwn(S.spots, id)) id += 'x';
      const w = at(r);
      S.spots[id] = { ...(by ? { by } : {}), name: r.name, kind: r.kind && D.kinds[r.kind] ? r.kind : 'other', status: j.status === 'been' ? 'been' : 'want', rating: 0, note: r.note, lon: +r.lon.toFixed(5), lat: +r.lat.toFixed(5), hood: w.hood, sub: w.sub || null, at: j.status === 'been' && r.at ? r.at : day, where: r.where, src: 'gmaps' };
      snap[id] = sig(S.spots[id]); ids.push(id);
    }
    j.ids = ids; j.undone = 0; j.failed = false;
    if (!ids.length) { j.phase = 'done'; if (job === j && S.view === 'gimport') renderImport(); D.toast('Nothing was imported', 2600); return; }
    D.map.redraw();
    const ok = await D.persist();
    if (ok === false) { // not saved: the spots come out again, so nothing half-added stays behind on this device
      for (const id of ids) delete S.spots[id];
      j.ids = []; j.failed = true; j.phase = 'done'; D.map.redraw(); await D.persist();
      if (job === j && S.view === 'gimport') renderImport(); else D.toast('The import could not be saved. Nothing was added.', 4000);
      return;
    }
    j.phase = 'done'; if (job === j && S.view === 'gimport') renderImport();
    D.toast(`Imported ${plural(ids.length)}`, 10000, { label: 'Undo', run: () => undo(j, ids, snap) });
  }
  // the same spot: its fields as stored (null and missing alike, any key order: a synced copy comes back sorted and without nulls)
  const sig = sp => JSON.stringify(Object.keys(sp).filter(k => k !== '_xy' && sp[k] != null).sort().map(k => [k, sp[k]]));
  async function undo(j, ids, snap) {
    const S = D.state; let gone = 0, kept = 0;
    for (const id of ids) { if (!Object.hasOwn(S.spots, id)) continue; if (sig(S.spots[id]) === snap[id]) { delete S.spots[id]; gone++; } else kept++; }
    if (S.loc.spot && !Object.hasOwn(S.spots, S.loc.spot)) D.go({ region: 'all' }, { replace: true, fly: false });
    await D.persist(); D.map.redraw();
    if (job === j) j.undone = gone;
    if (S.view === 'gimport' && job === j) renderImport(); else if (!S.view || S.view === 'spots') D.render();
    D.toast(kept ? `Removed ${plural(gone)}. ${kept} edited since ${kept === 1 ? 'stays' : 'stay'}.` : `Removed ${plural(gone)}`, 3200);
  }

  function init(o) { D = o; }
  return { init, parse, form, saved, left, settings, renderImport, gpsOf, RESOLVE, get job() { return job; } };
})();
