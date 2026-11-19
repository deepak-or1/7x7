// Two voices: on a shared log each person keeps their own rating and note on a spot, says "me too" to a want-to-go spot, and
// leaves one reaction. A voice is the slug of a display name (lower case, a-z and 0-9 only, at most 24): the same name on two
// devices is the same voice; renaming yourself starts a new one. In the log, beside the spot's own fields:
//   spot.v  = { <slug>: { n: name, r: 1-5 or 0, note, at: ISO date-time } }   each person's rating and note
//   spot.w  = { <slug>: name }                                                who wants to go (while status is 'want')
//   spot.rx = { <slug>: one emoji of RX }                                      one reaction per person
// spot.rating and spot.note stay, kept in step as a summary for lists, search and older code: the rounded average of the set
// ratings, and the most recent voice's note (the most recent that has one). A spot with rating/note and no v is one legacy voice,
// attributed to spot.by, and is left as it is until someone edits it. Everything here comes from the shared log, which anyone
// with the link can write: own-key lookups, every field checked, at most MAX voices shown.
// Old code writes the whole log and its log form rebuilds a spot from the fields it knows, so an edit there drops v, w and rx of
// that spot; and two devices that save at about the same time each send a log without the other's change. So each device
// remembers what it wrote itself (localStorage, per log) and, when a log arrives that lacks it, puts it back (heal()).
window.Voices = (() => {
  const MAX = 6, NOTE_MAX = 400, SCAN = 200, DAY = 864e5;
  const RX = [['❤️', 'Love'], ['🔥', 'Fire'], ['🤤', 'Drooling'], ['😂', 'Ha'], ['👍', 'Thumbs up']], RXS = new Set(RX.map(x => x[0]));
  let o = null; // from app.js: state, who, cleanName, esc, verdict, persist, render, logEvent, askName, startLog, logKey
  const evd = new Set(), healed = new Set(); // this session: events already sent (one per kind per spot), heals already made
  const vslug = n => String(n ?? '').toLowerCase().trim().replace(/[^a-z0-9]/g, '').slice(0, 24);
  const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x);
  const own = (obj, k) => (isObj(obj) && Object.hasOwn(obj, k) ? obj[k] : undefined);
  const okKey = k => /^[a-z0-9]{1,24}$/.test(k), okId = id => /^[A-Za-z0-9_-]{1,64}$/.test(id) && id !== '__proto__';
  const keys = obj => (isObj(obj) ? Object.keys(obj).slice(0, SCAN).filter(okKey) : []);
  const copy = src => { if (!isObj(src)) return null; const out = {}; for (const k of keys(src)) out[k] = src[k]; return out; }; // the valid keys only, values as they were
  const me = () => vslug(o.who());
  const shared = () => o.state.store === 'sync' || o.state.store === 'db';
  const visible = () => !!me() || shared(); // an unshared log with no name on this device: exactly as before, nothing new
  const cleanNote = s => (typeof s === 'string' ? s.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').trim().slice(0, NOTE_MAX) : '');
  const starsOf = r => `<span class="vstars" role="img" aria-label="${r} of 5 stars"><span aria-hidden="true">${'★'.repeat(r)}<i>${'★'.repeat(5 - r)}</i></span></span>`;
  const same = (a, b) => !!a && !!b && a.n === b.n && a.r === b.r && a.note === b.note && a.t === b.t;
  const andList = a => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];

  // ---------- reading ----------
  function clean(k, e) {
    if (!okKey(k) || !isObj(e) || typeof e.n !== 'string') return null;
    const n = o.cleanName(e.n), r = Number.isInteger(e.r) && e.r >= 1 && e.r <= 5 ? e.r : 0, note = cleanNote(e.note), t = typeof e.at === 'string' && e.at.length <= 40 ? Date.parse(e.at) : NaN;
    return n && (r || note) ? { k, n, r, note, t: isFinite(t) ? t : 0 } : null;
  }
  const listed = v => keys(v).map(k => clean(k, v[k])).filter(Boolean);
  function legacy(sp) { // rating and note with no v: one voice, the person who logged it (none: unnamed, and this device's to edit)
    const r = sp.status === 'want' ? 0 : Math.max(0, Math.min(5, sp.rating | 0)), note = cleanNote(sp.note); if (!r && !note) return null;
    const n = o.cleanName(sp.by); return { k: vslug(n), n, r, note, t: 0, legacy: true };
  }
  // the voices to show: yours first, then the most recent; at most MAX
  function voices(sp) {
    const m = me(); let vs = listed(sp.v);
    if (!vs.length) { const L = legacy(sp); vs = L ? [L] : []; }
    vs.sort((a, b) => (!!m && b.k === m) - (!!m && a.k === m) || b.t - a.t);
    vs = vs.slice(0, MAX); vs.forEach(x => { x.mine = x.legacy && !x.k ? true : !!m && x.k === m; });
    return vs;
  }
  // the one number lists show: the rounded average of the ratings shown
  function rating(sp) { if (!sp || sp.status === 'want') return 0; const rs = voices(sp).map(x => x.r).filter(Boolean); return rs.length ? Math.round(rs.reduce((a, b) => a + b, 0) / rs.length) : 0; }
  function summarize(sp) { const vs = voices(sp); if (!vs.length || vs[0].legacy) return; sp.rating = rating(sp); const n = vs.filter(x => x.note).sort((a, b) => b.t - a.t)[0]; sp.note = n ? n.note : ''; }
  // who wants to go: w; a spot from before w (or with nothing valid in it) counts the person who logged it
  function wanters(sp) {
    if (!sp || sp.status !== 'want') return [];
    const ws = keys(sp.w).map(k => ({ k, n: typeof sp.w[k] === 'string' ? o.cleanName(sp.w[k]) : '' })).filter(x => x.n);
    if (ws.length) return ws;
    const n = o.cleanName(sp.by), k = vslug(n); return k ? [{ k, n }] : [];
  }
  const seedW = sp => { const w = {}; for (const x of wanters(sp)) w[x.k] = x.n; return w; };
  const both = sp => wanters(sp).length >= 2;
  function nameOf(sp, k) { const v = clean(k, own(sp.v, k)); if (v) return v.n; const w = own(sp.w, k); if (typeof w === 'string' && o.cleanName(w)) return o.cleanName(w); const by = o.cleanName(sp.by); return vslug(by) === k ? by : k; }
  const needsVoice = sp => shared() && voices(sp).some(x => x.k); // a voice with a name on it: editing goes through voices

  // ---------- the spot page ----------
  // single: today's 'Logged by' line and quote; with two or more voices, each person's stars and note instead
  function block(id, single) {
    const sp = own(o.state.spots, id), vs = sp ? voices(sp) : []; if (vs.length < 2) return single;
    const n = sp.status === 'want' ? 0 : vs.filter(x => x.r).length, by = o.cleanName(sp.by), line = [by ? 'Logged by ' + o.esc(by) : '', n > 1 ? n + ' ratings' : ''].filter(Boolean).join(' · ');
    return (line ? `<p class="vby">${line}</p>` : '') + `<ul class="voices" aria-label="What each of you thought">${vs.map(x => `<li class="voice"><p class="vwho"><b>${x.mine ? 'You' : o.esc(x.n || 'Someone')}</b>${x.r && sp.status !== 'want' ? starsOf(x.r) + `<span class="vword">${o.verdict[x.r]}</span>` : ''}</p>${x.note ? `<p class="pull">${o.esc(x.note)}</p>` : ''}</li>`).join('')}</ul>`;
  }
  // under the voices: Add your rating, who wants to go and Me too / Not for me, the reactions
  function extras(id) {
    const sp = own(o.state.spots, id); if (!sp || !visible()) return '';
    const m = me(), vs = voices(sp), dis = o.state.canWrite ? '' : ' disabled', mineSpot = !!m && vslug(sp.by) === m; let h = '';
    if (sp.status !== 'want' && o.state.canWrite && !vs.some(x => x.mine) && (vs.length || (vslug(sp.by) && !mineSpot))) h += `<div class="textlinks vadd"><button type="button" id="v-add">Add your rating</button></div>`;
    if (sp.status === 'want') {
      const ws = wanters(sp), inW = !!m && ws.some(x => x.k === m), others = ws.filter(x => x.k !== m), names = others.slice(0, MAX).map(x => o.esc(x.n));
      if (others.length > MAX) names.push(others.length - MAX + ' more');
      const txt = ws.length >= 2 ? (inW && ws.length === 2 ? 'You both want this' : (inW ? andList(['You', ...names]) : andList(names)) + (ws.length === 2 ? ' both want this' : ' want this')) : others.length === 1 ? names[0] + ' wants to go' : '';
      const ctl = !inW && others.length ? `<button type="button" class="btn" id="v-metoo" aria-label="Me too: I want to go to ${o.esc(sp.name)}"${dis}>Me too</button>` : inW && !mineSpot ? `<button type="button" class="btn quiet" id="v-notme"${dis}>Not for me</button>` : '';
      if (txt || ctl) h += `<div class="vwant">${txt ? `<p class="vboth${ws.length >= 2 ? ' two' : ''}"><i aria-hidden="true"></i><span>${txt}</span></p>` : ''}${ctl}</div>`;
    }
    const by = {}, mineRx = m ? own(sp.rx, m) : undefined;
    for (const k of keys(sp.rx)) { const e = sp.rx[k]; if (typeof e === 'string' && RXS.has(e)) (by[e] = by[e] || []).push(k); }
    const whoSaid = ks => andList(ks.slice(0, MAX).map(k => (k === m ? 'you' : nameOf(sp, k))).concat(ks.length > MAX ? [ks.length - MAX + ' more'] : []));
    const said = Object.keys(by).flatMap(e => by[e].filter(k => k !== m).map(k => [k, e])).slice(0, MAX);
    h += `<div class="vrx" role="group" aria-label="Reactions">${RX.map(([e, label], i) => { const ks = by[e] || [], t = label + (ks.length ? ': ' + whoSaid(ks) : ''); return `<button type="button" data-rx="${i}" aria-pressed="${!!m && mineRx === e}" title="${o.esc(t)}" aria-label="${o.esc(t)}"${dis}><span aria-hidden="true">${e}</span>${ks.length ? `<small>${ks.length}</small>` : ''}</button>`; }).join('')}</div>`
      + (said.length ? `<p class="vrxwho">${said.map(([k, e]) => `${o.esc(nameOf(sp, k))} ${e}`).join(' · ')}</p>` : '');
    return h;
  }
  // listeners look the spot up when used (an identical re-render keeps the panel and these)
  function wire(root, id) {
    const q = s => root.querySelector(s);
    const a = q('#v-add'); if (a) a.addEventListener('click', () => o.startLog(id));
    const mt = q('#v-metoo'); if (mt) mt.addEventListener('click', () => setWant(id, true));
    const nm = q('#v-notme'); if (nm) nm.addEventListener('click', () => setWant(id, false));
    root.querySelectorAll('[data-rx]').forEach(b => b.addEventListener('click', () => react(id, +b.dataset.rx)));
  }
  // the lists: a small mark on a spot two or more want
  const wantLabel = sp => { const n = wanters(sp).length; return n >= 2 ? `<b class="vw2">${n === 2 ? 'Both want' : n + ' want'}</b>` : ''; };

  // ---------- writing ----------
  // a shared log and no name yet: the name prompt (again, even if it was skipped once); '' when there is still none
  async function needMe() { if (me() || !shared()) return me(); await new Promise(r => o.askName(r)); return me(); }
  async function setWant(id, on) {
    if (!o.state.canWrite) return; const m = await needMe(); if (!m) return;
    const sp = own(o.state.spots, id); if (!sp || sp.status !== 'want') return;
    const w = keys(sp.w).some(k => typeof sp.w[k] === 'string' && o.cleanName(sp.w[k])) ? copy(sp.w) : seedW(sp);
    if (on) w[m] = o.who(); else delete w[m];
    if (Object.keys(w).length) sp.w = w; else delete sp.w;
    remember(id, { w: on ? 1 : 0, wt: Date.now() }); o.render();
    const ok = await o.persist();
    if (ok !== false && on && !evd.has('w:' + id)) { evd.add('w:' + id); o.logEvent('metoo', { id, name: sp.name, hood: sp.hood }); }
  }
  async function react(id, i) {
    const e = RX[i] && RX[i][0]; if (!o.state.canWrite || !e) return; const m = await needMe(); if (!m) return;
    const sp = own(o.state.spots, id); if (!sp) return;
    const rx = copy(sp.rx) || {}, on = own(rx, m) !== e;
    if (on) rx[m] = e; else delete rx[m];
    if (Object.keys(rx).length) sp.rx = rx; else delete sp.rx;
    remember(id, { rx: on ? e : '', rxt: Date.now() });
    const had = document.activeElement && document.activeElement.matches && document.activeElement.matches('[data-rx]');
    o.render(); if (had) { const b = document.querySelector(`#panel [data-rx="${i}"]`); if (b) b.focus({ preventScroll: true }); }
    const ok = await o.persist();
    if (ok !== false && on && !evd.has('rx:' + id)) { evd.add('rx:' + id); o.logEvent('react', { id, name: sp.name, hood: sp.hood }); } // none for clearing; one a spot a session
  }
  // the log form: your own rating and note. No name: as before (the summary), unless the spot already has a named voice; then blank,
  // and saving asks for the name
  function draft(sp) { if (!sp) return {}; if (!me()) return needsVoice(sp) ? { rating: 0, note: '' } : {}; const v = voices(sp).find(x => x.mine); return { rating: v ? v.r : 0, note: v ? v.note : '' }; }
  const wantsName = prev => !me() && !!prev && o.state.canWrite && needsVoice(prev);
  const label = (d, txt) => { const sp = d && d.id ? own(o.state.spots, d.id) : null; return sp && me() && voices(sp).some(x => !x.mine) ? 'Your ' + txt.toLowerCase() : txt; };
  const legacyAt = sp => { const d = typeof sp.at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sp.at) ? Date.parse(sp.at + 'T12:00:00Z') : NaN; return new Date(Math.min(isFinite(d) ? d : 0, Date.now() - 1000)).toISOString(); };
  // v with the legacy voice as its own entry when it is someone else's (spot.by): the first edit by another person keeps it
  function withLegacy(sp, m) { const v = copy(sp.v) || {}; if (!listed(sp.v).length) { const L = legacy(sp); if (L && L.k && L.k !== m) v[L.k] = { n: L.n, r: L.r, note: L.note, at: legacyAt(sp) }; } return v; }
  function putVoice(sp, m, entry) { const v = withLegacy(sp, m); if (entry) v[m] = entry; else delete v[m]; if (Object.keys(v).length) sp.v = v; else delete sp.v; summarize(sp); }
  // app.js has just rebuilt state.spots[id] from the form (fields it knows only): carry v, w and rx over, write your voice, and keep
  // the summary in step. Returns { rated } when your rating changed (for the feed, once a spot a session)
  function saved(id, prev, d) {
    const sp = own(o.state.spots, id); if (!sp) return null; const m = me();
    if (prev) for (const f of ['v', 'w', 'rx']) { const c = copy(prev[f]); if (c && Object.keys(c).length) sp[f] = c; }
    if (!m) { if (prev && needsVoice(prev)) { sp.rating = prev.rating; sp.note = prev.note; summarize(sp); } return null; } // no name: never over someone's voice
    const r = Math.max(0, Math.min(5, d.rating | 0)), note = cleanNote(d.note); // kept while the spot is want to go (not shown, not averaged)
    const old = clean(m, own(prev && prev.v, m)) || (prev && !listed(prev.v).length && (() => { const L = legacy(prev); return L && (!L.k || L.k === m) ? L : null; })());
    let entry = old && old.r === r && old.note === note ? (own(prev.v, m) || null) : null, changed = false;
    if (!r && !note) { entry = null; changed = !!old; }
    else if (!entry) { entry = { n: o.who(), r, note, at: new Date().toISOString() }; changed = true; }
    else if (entry.n !== o.who()) entry = Object.assign({}, entry, { n: o.who() }); // same voice, the name written differently now
    if (prev || entry) { const v = withLegacy(prev || sp, m); if (entry) v[m] = entry; else delete v[m]; if (Object.keys(v).length) sp.v = v; else delete sp.v; }
    if (sp.status === 'want' && (!prev || prev.status !== 'want')) { const w = (prev && copy(prev.w)) || {}; w[m] = o.who(); sp.w = w; remember(id, { w: 1, wt: Date.now() }); } // adding it as want to go: you want to go
    if (sp.v) summarize(sp);
    if (changed) remember(id, entry ? { v: entry } : { v: null, vt: Date.now() });
    if (prev && changed && r && sp.status === 'been' && (!old || old.r !== r) && !evd.has('r:' + id)) { evd.add('r:' + id); return { rated: r }; }
    return null;
  }

  // ---------- what this device wrote, put back when a log arrives without it ----------
  const memKey = () => { const k = o.logKey(); return k ? 'sbs-mine-' + k : null; };
  function loadMem() { const k = memKey(); if (!k) return null; try { const m = JSON.parse(localStorage.getItem(k) || '{}'); return isObj(m) ? m : {}; } catch (e) { return {}; } }
  function saveMem(m) { const k = memKey(); if (!k) return; const ids = Object.keys(m); if (ids.length > SCAN) ids.sort((a, b) => (+m[a].t || 0) - (+m[b].t || 0)).slice(0, ids.length - SCAN).forEach(i => delete m[i]); try { localStorage.setItem(k, JSON.stringify(m)); } catch (e) {} }
  function remember(id, patch) { if (!shared() || !okId(id)) return; const m = loadMem(); if (!m) return; const s = me(); let r = own(m, id); if (!isObj(r) || r.s !== s) r = { s }; m[id] = Object.assign(r, patch, { t: Date.now() }); saveMem(m); }
  // after a remote log is adopted: true when something was put back (app.js then saves). Your voice by its time (a newer one from
  // your other device wins and is kept); w and rx, which carry no time, once a spot a session and for a day after you set them
  function heal() {
    const s = me(), mem = shared() && s ? loadMem() : null; if (!mem) return false;
    let changed = false, dirty = false; const now = Date.now();
    for (const id of Object.keys(mem)) {
      const r = mem[id]; if (!isObj(r) || !okId(id)) { delete mem[id]; dirty = true; continue; }
      if (r.s !== s) continue;
      if (!Object.hasOwn(o.state.spots, id)) { delete mem[id]; dirty = true; continue; } // deleted: nothing to put back
      const sp = o.state.spots[id];
      if (Object.hasOwn(r, 'v')) {
        const want = clean(s, r.v) ? r.v : null, wantT = want ? clean(s, want).t : +r.vt || 0, curRaw = own(sp.v, s), cur = clean(s, curRaw);
        if (cur && cur.t > wantT) { delete r.v; delete r.vt; dirty = true; } // newer, from your other device: it stands
        else if (want ? !same(cur, clean(s, want)) : curRaw !== undefined) { putVoice(sp, s, want); changed = true; } // by content: the database returns keys in its own order
      }
      if (Object.hasOwn(r, 'w') && sp.status === 'want' && now - (+r.wt || 0) < DAY && !healed.has('w:' + id)) {
        const has = wanters(sp).some(x => x.k === s);
        if (r.w === 1 && !has) { const w = keys(sp.w).length ? copy(sp.w) : seedW(sp); w[s] = o.who(); sp.w = w; healed.add('w:' + id); changed = true; }
        else if (r.w === 0 && own(sp.w, s) !== undefined) { const w = copy(sp.w); delete w[s]; if (Object.keys(w).length) sp.w = w; else delete sp.w; healed.add('w:' + id); changed = true; }
      }
      if (Object.hasOwn(r, 'rx') && now - (+r.rxt || 0) < DAY && !healed.has('rx:' + id)) {
        const want = RXS.has(r.rx) ? r.rx : '', cur = own(sp.rx, s);
        if ((typeof cur === 'string' ? cur : '') !== want) { const rx = copy(sp.rx) || {}; if (want) rx[s] = want; else delete rx[s]; if (Object.keys(rx).length) sp.rx = rx; else delete sp.rx; healed.add('rx:' + id); changed = true; }
      }
    }
    if (changed || dirty) saveMem(mem);
    return changed;
  }

  function init(opts) { o = opts; }
  return { init, voices, rating, block, extras, wire, wantLabel, both, draft, wantsName, label, saved, heal, slug: vslug, RX };
})();
