// A pasted Maps link, read: the search field takes an Apple or Google Maps link (or a phone's share text, a name and then the link)
// and the app offers that place, ready to save. parse(text) is pure and never throws; read(short link) asks the link helper for the
// full link a short one hides. Only Apple and Google Maps links count: any other text is { t: 'other' } and search treats it as typed.
window.Link = (() => {
  // the link helper (helper/link-helper.js, the Cloudflare Worker `sbs-link`): GET HELPER?u=<short link> answers 200 { url, lat?, lon? }
  // with the full link a short one leads to, or 4xx { error }. It only answers the live site and localhost / 127.0.0.1 previews
  const HELPER = 'https://sbs-link.deepak-d-or1.workers.dev/';
  const NAME = 80, WHERE = 120, TEXT = 8192, WAIT = 8000;
  const cut = (s, n) => Array.from(String(s).slice(0, n * 2)).slice(0, n).join('');
  const clean = (s, n = NAME) => typeof s === 'string' ? cut(s.slice(0, n * 4).replace(/[\x00-\x1f\x7f]/g, ' ').replace(/\s+/g, ' ').trim(), n).trim() : '';
  const okLL = (lat, lon) => typeof lat === 'number' && typeof lon === 'number' && isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);

  // ---------- text in, { t: 'place' | 'name' | 'short' | 'hidden' | 'other', name, lat, lon, where, url } out ----------
  // place: a position (and a name when the link has one); name: a name and no position; short: a link the helper must read; hidden:
  // a Maps link with neither a position nor a name; other: not an Apple or Google Maps link
  const other = () => ({ t: 'other' }), hidden = () => ({ t: 'hidden', name: '' }); // a fresh object each time: a name written on one never shows up in the next
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
  // Apple's address ('3663 S Las Vegas Blvd, Unit 183, Las Vegas, NV 89109, United States'): street · city, as the place search writes it
  function addrWhere(a) {
    const p = clean(a, 300).split(',').map(s => s.trim()).filter(Boolean); if (p.length < 2) return clean(a, WHERE);
    if (/^(united states( of america)?|usa|us)$/i.test(p[p.length - 1])) p.pop();
    const st = p.findIndex(s => /^[A-Z]{2}(\s+\d{5}(-\d{4})?)?$/.test(s)), city = st > 1 ? p[st - 1] : p.length > 1 ? p[p.length - 1] : '';
    return clean(city && city !== p[0] ? p[0] + ' · ' + city : p[0], WHERE);
  }
  function parse(input) { try { return parse1(input); } catch (e) { return other(); } }
  function parse1(input) {
    if (typeof input !== 'string') return other();
    const text = input.slice(0, TEXT).replace(/\r\n?/g, '\n').trim(); if (!text) return other();
    const m = /https?:\/\/[^\s<>"]+/i.exec(text); if (!m) return other(); // plain text, coordinates, geo: are typed text, not a link
    const r = fromUrl(m[0]); if (r.t === 'other') return r;
    // share text: the name before the link (on its line, or the first line without a link; a single-line field joins the lines)
    const before = clean(text.slice(0, m.index).split('\n').filter(l => clean(l)).shift() || '').replace(/[\s:–—-]+$/, '').trim();
    const first = before && !coords(before) && !/https?:\/\//i.test(before) ? clean(before) : '';
    if (r.t === 'hidden') return first ? { t: 'name', name: first, from: 'text' } : r;
    if (first && !r.name && r.t !== 'name') r.name = first;
    return r;
  }
  function fromUrl(raw) {
    raw = String(raw).replace(/[.,;!?'")\]]+$/, '');
    let u; try { u = new URL(raw); } catch (e) { return other(); }
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return other();
    const host = u.hostname.toLowerCase().replace(/^www\./, ''), p = u.pathname;
    if (host === 'maps.app.goo.gl' || (host === 'goo.gl' && /^\/maps/i.test(p)) || (host === 'maps.apple' && /^\/p\//i.test(p))) return { t: 'short', url: 'https://' + u.hostname + u.pathname + u.search, name: '' };
    if (/^(maps\.)?google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(host) && (host.startsWith('maps.') || /^\/maps(\/|$)/.test(p))) return google(u);
    if (host === 'maps.apple.com' || host === 'maps.apple') return apple(u);
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
    return hidden(); // a cid, ftid or place_id, or the bare map: a Maps link, but nothing in it says where
  }
  function apple(u) {
    const pin = s => /^\s*(dropped pin|marked location)\s*$/i.test(s) ? '' : s; // Apple's words for a spot without a name
    const name = pin(qp(u, 'name', 'q', 'query')), dest = pin(qp(u, 'daddr', 'destination')), addr = qp(u, 'address');
    const pick = [coords(qp(u, 'coordinate')), coords(qp(u, 'll')), coords(name), coords(dest)].find(Boolean); // sll and center are where a search looked, not a place
    const nm = [name, dest].find(s => s && !coords(s)) || '';
    if (pick) return place(pick, nm, 'apple', addr ? addrWhere(addr) : '');
    return named(nm, 'apple') || hidden();
  }

  // ---------- a short link, read by the helper: a place or a name (as parse gives them), or null when it could not be read ----------
  // one request; it ends after WAIT ms, or when `signal` aborts (the field changed). The answer is at most 4 KB and its link must
  // itself be a full Apple or Google Maps link; it is only read, never opened
  async function read(short, signal) {
    const c = new AbortController(), t = setTimeout(() => c.abort(), WAIT), stop = () => c.abort();
    if (signal) { if (signal.aborted) return null; signal.addEventListener('abort', stop); }
    try {
      const res = await fetch(HELPER + '?u=' + encodeURIComponent(short), { signal: c.signal, credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' });
      if (!res.ok || +res.headers.get('content-length') > 4096) return null;
      const s = await res.text(); if (s.length > 4096) return null;
      const body = JSON.parse(s), long = body && typeof body.url === 'string' && body.url.length < TEXT ? body.url : '';
      const r = /^https:\/\//i.test(long) ? fromUrl(long) : other(), lat = body && +body.lat, lon = body && +body.lon;
      if (r.t === 'place') return r;
      if ((r.t === 'name' || r.t === 'hidden') && body.lat != null && body.lon != null && okLL(lat, lon)) return place({ lat, lon }, r.name, r.from || 'link', r.where);
      return r.t === 'name' ? r : null; // another short link, a non-Maps address, a link with nothing in it: not read
    } catch (e) { return null; } finally { clearTimeout(t); if (signal) signal.removeEventListener('abort', stop); }
  }

  return { parse, fromUrl, read, HELPER };
})();
