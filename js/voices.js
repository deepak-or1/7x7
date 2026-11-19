// Two voices: on a shared log each person keeps their own rating and note on a spot, says "me too" to a want-to-go spot, and
// leaves one reaction. A voice is the slug of a display name (vslug): the same name on two devices is the same voice. In the log,
// beside the spot's own fields:
//   spot.v  = { <slug>: { n: name, r: 1-5 or 0, note, at: ISO date-time } }   each person's rating and note; '_' (no name) holds
//                                                                             the rating and note from before, kept beside the
//                                                                             first voice added to a spot that had no v
//   spot.w  = { <slug>: name }                                                who wants to go (while status is 'want')
//   spot.rx = { <slug>: one emoji of RX }                                      one reaction per person
// spot.rating and spot.note stay, kept in step as a summary for lists, search and older code: the rounded average of the set
// ratings, and the most recent voice's note (the most recent that has one). A spot with rating/note and no v is one legacy voice,
// shown as the logger's (spot.by), and is left as it is until someone changes the rating or note. Everything here comes from the
// shared log, which anyone with the link can write: own-key lookups, every field checked, at most MAX voices shown.
// The log is saved whole and the last save wins. Two devices that save at about the same time each send a log without the other's
// change, so for two minutes after a write this device remembers it (in memory) and, if a log from another device arrives without
// it, puts it back once (arrived()). Nothing else is put back: a device still on older code rebuilds a spot it edits from the fields
// it knows and so drops that spot's v, w and rx; that is accepted, and the spot's rating and note remain as its summary.
window.Voices = (() => {
  const MAX = 6, NOTE_MAX = 400, SCAN = 200, WINDOW = 120e3, ANON = '_';
  const RX = [['❤️', 'Love'], ['🔥', 'Fire'], ['🤤', 'Drooling'], ['😂', 'Ha'], ['👍', 'Thumbs up']], RXS = new Set(RX.map(x => x[0]));
  let o = null; // from app.js: state, who, cleanName, esc, verdict, persist, render, logEvent, askName, startLog
  const evd = new Set(); // this session: events already sent (one per kind per spot)
  const pend = new Map(), bases = new Map(); // this device's writes of the last two minutes ('id:f'), and each spot as it was before them
  // a slug: lower case a-z and 0-9, at most 24. A name with none of those (another script, only emoji) gets 'x' and a hash of the
  // name; one starting with a digit gets 'n' in front (the database turns objects with integer-like keys into arrays)
  const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); };
  const vslug = n => { const t = String(n ?? '').toLowerCase().trim(); if (!t) return ''; const s = t.replace(/[^a-z0-9]/g, '').slice(0, 24); return !s ? 'x' + hash(t) : /^[0-9]/.test(s) ? ('n' + s).slice(0, 24) : s; };
  const isObj = x => !!x && typeof x === 'object' && !Array.isArray(x); // an array where an object belongs is ignored (tidy() drops it)
  const own = (obj, k) => (isObj(obj) && Object.hasOwn(obj, k) ? obj[k] : undefined);
  const okKey = (k, anon) => (anon && k === ANON) || /^[a-z][a-z0-9]{0,23}$/.test(k), okId = id => /^[A-Za-z0-9_-]{1,64}$/.test(id) && id !== '__proto__';
  const keys = (obj, anon) => (isObj(obj) ? Object.keys(obj).filter(k => okKey(k, anon)).slice(0, SCAN) : []);
  const copy = (src, anon) => { if (!isObj(src)) return null; const out = {}; for (const k of keys(src, anon)) out[k] = src[k]; return out; }; // the valid keys only, values as they were
  const me = () => vslug(o.who());
  const bySlug = sp => vslug(o.cleanName(sp.by));
  const shared = () => o.state.store === 'sync' || o.state.store === 'db';
  const visible = () => !!me() || shared(); // an unshared log with no name on this device: exactly as before, nothing new
  const cleanNote = s => (typeof s === 'string' ? s.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').trim().slice(0, NOTE_MAX) : '');
  const starsOf = r => `<span class="vstars" role="img" aria-label="${r} of 5 stars"><span aria-hidden="true">${'★'.repeat(r)}<i>${'★'.repeat(5 - r)}</i></span></span>`;
  const andList = a => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
  // a spot as text with its keys in order and without nulls or _xy: the database returns keys in its own order and drops nulls
  const canon = sp => JSON.stringify(sp, (k, x) => k === '_xy' || x === null ? undefined : isObj(x) ? Object.fromEntries(Object.keys(x).sort().map(j => [j, x[j]])) : x);

  // ---------- reading ----------
  function clean(k, e) {
    if (!okKey(k, true) || !isObj(e)) return null; const anon = k === ANON; if (!anon && typeof e.n !== 'string') return null;
    const n = anon ? '' : o.cleanName(e.n), r = Number.isInteger(e.r) && e.r >= 1 && e.r <= 5 ? e.r : 0, note = cleanNote(e.note), t = typeof e.at === 'string' && e.at.length <= 40 ? Date.parse(e.at) : NaN;
    return (n || anon) && (r || note) ? { k, n, r, note, t: isFinite(t) ? t : 0, anon } : null;
  }
  const listed = v => keys(v, true).map(k => clean(k, v[k])).filter(Boolean);
  function legacy(sp) { // rating and note with no v: one voice, shown as the logger's; with no logger it is nobody's (never yours by default)
    const r = sp.status === 'want' ? 0 : Math.max(0, Math.min(5, sp.rating | 0)), note = cleanNote(sp.note); if (!r && !note) return null;
    const n = o.cleanName(sp.by); return { k: vslug(n), n, r, note, t: 0, legacy: true };
  }
  // the voices to show: yours first, then the most recent; at most MAX
  function voices(sp) {
    const m = me(); let vs = listed(sp.v);
    if (!vs.length) { const L = legacy(sp); vs = L ? [L] : []; }
    vs.sort((a, b) => (!!m && b.k === m) - (!!m && a.k === m) || b.t - a.t);
    vs = vs.slice(0, MAX); vs.forEach(x => { x.mine = !!m && x.k === m; });
    return vs;
  }
  // the one number lists show: the rounded average of the ratings shown
  function rating(sp) { if (!sp || sp.status === 'want') return 0; const rs = voices(sp).map(x => x.r).filter(Boolean); return rs.length ? Math.round(rs.reduce((a, b) => a + b, 0) / rs.length) : 0; }
  function summarize(sp) { const vs = voices(sp); if (!vs.length || vs[0].legacy) return; sp.rating = rating(sp); const n = vs.filter(x => x.note).sort((a, b) => b.t - a.t)[0]; sp.note = n ? n.note : ''; }
  // who wants to go: w; a spot from before w (or with nothing valid in it) counts the person who logged it
  const hasW = sp => keys(sp.w).some(k => typeof sp.w[k] === 'string' && o.cleanName(sp.w[k]));
  function wanters(sp) {
    if (!sp || sp.status !== 'want') return [];
    const ws = keys(sp.w).map(k => ({ k, n: typeof sp.w[k] === 'string' ? o.cleanName(sp.w[k]) : '' })).filter(x => x.n);
    if (ws.length) return ws;
    const n = o.cleanName(sp.by), k = vslug(n); return k ? [{ k, n }] : [];
  }
  const seedW = sp => { const w = {}; for (const x of wanters(sp)) w[x.k] = x.n; return w; };
  const both = sp => wanters(sp).length >= 2;
  function nameOf(sp, k) { const v = clean(k, own(sp.v, k)); if (v && v.n) return v.n; const w = own(sp.w, k); if (typeof w === 'string' && o.cleanName(w)) return o.cleanName(w); const by = o.cleanName(sp.by); return vslug(by) === k ? by : k; }
  const needsVoice = sp => shared() && voices(sp).some(x => x.k); // a voice with a name (or the earlier one) on it: editing goes through voices
  // the log form starts blank (your own rating and note) rather than from the summary
  const personal = sp => (me() ? voices(sp).some(x => !x.mine) : shared() && (needsVoice(sp) || !!bySlug(sp)));

  // ---------- the spot page ----------
  // single: today's 'Logged by' line and quote; each person's stars and note instead with two or more voices, or with one voice
  // that is not the logger's
  function block(id, single) {
    const sp = own(o.state.spots, id), vs = sp ? voices(sp) : [], by = sp ? o.cleanName(sp.by) : '';
    if (!(vs.length >= 2 || (vs.length === 1 && !vs[0].legacy && vs[0].k !== vslug(by)))) return single;
    const n = sp.status === 'want' ? 0 : vs.filter(x => x.r).length, line = [by ? 'Logged by ' + o.esc(by) : '', n > 1 ? n + ' ratings' : ''].filter(Boolean).join(' · ');
    return (line ? `<p class="vby">${line}</p>` : '') + `<ul class="voices" aria-label="What each of you thought">${vs.map(x => `<li class="voice"><p class="vwho"><b>${x.mine ? 'You' : x.anon ? 'Earlier' : o.esc(x.n || 'Someone')}</b>${x.r && sp.status !== 'want' ? starsOf(x.r) + `<span class="vword">${o.verdict[x.r]}</span>` : ''}</p>${x.note ? `<p class="pull">${o.esc(x.note)}</p>` : ''}</li>`).join('')}</ul>`;
  }
  // under the voices: Add your rating, who wants to go and Me too / Not for me, the reactions
  function extras(id) {
    const sp = own(o.state.spots, id); if (!sp || !visible()) return '';
    const m = me(), vs = voices(sp), dis = o.state.canWrite ? '' : ' disabled', mineSpot = !!m && bySlug(sp) === m; let h = '';
    if (sp.status !== 'want' && o.state.canWrite && !vs.some(x => x.mine) && (vs.length || (bySlug(sp) && !mineSpot))) h += `<div class="textlinks vadd"><button type="button" id="v-add">Add your rating</button></div>`;
    if (sp.status === 'want') {
      const ws = wanters(sp), inW = !!m && ws.some(x => x.k === m), others = ws.filter(x => x.k !== m), names = others.slice(0, MAX).map(x => o.esc(x.n));
      if (others.length > MAX) names.push(others.length - MAX + ' more');
      const txt = ws.length >= 2 ? (inW && ws.length === 2 ? 'You both want this' : (inW ? andList(['You', ...names]) : andList(names)) + (ws.length === 2 ? ' both want this' : ' want this')) : others.length === 1 ? names[0] + ' wants to go' : '';
      const ctl = !inW && others.length ? `<button type="button" class="btn" id="v-metoo" aria-label="Me too: I want to go to ${o.esc(sp.name)}"${dis}>Me too</button>` : inW && (ws.length >= 2 || !mineSpot) ? `<button type="button" class="btn quiet" id="v-notme"${dis}>Not for me</button>` : '';
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
  // the re-render replaced the button that was tapped: the focus goes to the one in its place
  const refocus = () => { const p = document.getElementById('panel'); if (!p || p.contains(document.activeElement)) return; const b = p.querySelector('#v-notme, #v-metoo'); if (b && !b.disabled) b.focus({ preventScroll: true }); };
  async function setWant(id, on) {
    if (!o.state.canWrite) return; const m = await needMe(); if (!m || !o.state.canWrite) return;
    const sp = own(o.state.spots, id); if (!sp || sp.status !== 'want') return;
    const base = canon(sp), w = hasW(sp) ? copy(sp.w) : seedW(sp);
    if (on) w[m] = o.who(); else delete w[m];
    if (Object.keys(w).length) sp.w = w; else delete sp.w;
    remember(id, 'w', on, base); o.render(); refocus();
    const ok = await o.persist();
    if (ok !== false && on && !evd.has('w:' + id)) { evd.add('w:' + id); o.logEvent('metoo', { id, name: sp.name, hood: sp.hood }); }
  }
  async function react(id, i) {
    const e = RX[i] && RX[i][0]; if (!o.state.canWrite || !e) return; const m = await needMe(); if (!m || !o.state.canWrite) return;
    const sp = own(o.state.spots, id); if (!sp) return;
    const base = canon(sp), rx = copy(sp.rx) || {}, on = own(rx, m) !== e;
    if (on) rx[m] = e; else delete rx[m];
    if (Object.keys(rx).length) sp.rx = rx; else delete sp.rx;
    remember(id, 'rx', on ? e : '', base);
    const had = document.activeElement && document.activeElement.matches && document.activeElement.matches('[data-rx]');
    o.render(); if (had) { const b = document.querySelector(`#panel [data-rx="${i}"]`); if (b) b.focus({ preventScroll: true }); }
    const ok = await o.persist();
    if (ok !== false && on && !evd.has('rx:' + id)) { evd.add('rx:' + id); o.logEvent('react', { id, name: sp.name, hood: sp.hood }); } // none for clearing; one a spot a session
  }
  // the log form: your own rating and note. No name: as before (the summary), unless the spot has someone's voice or was logged by
  // someone; then blank, and a rating or note asks for the name (named())
  function draft(sp) { if (!sp) return {}; if (!me()) return personal(sp) ? { rating: 0, note: '' } : {}; const v = voices(sp).find(x => x.mine); return { rating: v ? v.r : 0, note: v ? v.note : '' }; }
  const wantsName = (prev, d) => !me() && !!prev && o.state.canWrite && personal(prev) && !!(cleanNote(d.note) || (d.status !== 'want' && d.rating | 0));
  // Save: a rating or note that has to be someone's asks for the name (unless app.js has just asked); still none: the form stays
  // open with a line saying why, and nothing is saved
  async function named(prev, d, asked) {
    if (!wantsName(prev, d)) return true;
    if (!asked) await new Promise(r => o.askName(r));
    if (o.state.draft !== d) return false; if (!wantsName(prev, d)) return true;
    const f = document.getElementById('logform'), acts = f && f.querySelector('#lf-actions');
    if (acts) { let p = f.querySelector('.vneed'); if (!p) { p = document.createElement('p'); p.className = 'vneed'; p.setAttribute('role', 'alert'); acts.before(p); } p.textContent = 'Your rating and note need a name'; }
    return false;
  }
  const label = (d, txt) => { const sp = d && d.id ? own(o.state.spots, d.id) : null; return sp && personal(sp) ? 'Your ' + txt.toLowerCase() : txt; };
  const legacyAt = sp => { const d = typeof sp.at === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(sp.at) ? Date.parse(sp.at + 'T12:00:00Z') : NaN; return new Date(Math.min(isFinite(d) ? d : 0, Date.now() - 1000)).toISOString(); };
  // app.js has just rebuilt state.spots[id] from the form (fields it knows only): carry v and rx over (w while it stays want to go),
  // write your voice, and keep the summary in step. Returns { rated, sent } when your rating changed (for the feed, once a spot a
  // session: sent() once the save went through).
  // A spot with no v (a legacy rating and note): left as it is (no v written) unless you change the rating or note. Then your voice
  // is written, and the old rating and note stay beside it as the logger's voice (spot.by; the unnamed earlier voice '_' when there
  // is no logger), unless they were yours (the spot's logger is you) or are exactly what you saved. Known cost: if an older device
  // dropped v from a spot two people had rated, the summary it left is an average and is credited to the logger here.
  function saved(id, prev, d) {
    const sp = own(o.state.spots, id); if (!sp) return null; const m = me(), want = sp.status === 'want';
    if (prev) { const v = copy(prev.v, true), rx = copy(prev.rx); if (v && Object.keys(v).length) sp.v = v; if (rx && Object.keys(rx).length) sp.rx = rx; }
    if (want && prev && prev.status === 'want') { const w = copy(prev.w); if (w && Object.keys(w).length) sp.w = w; } // turned been: w goes; added as, or turned back to, want to go: you
    else if (want && m) { sp.w = { [m]: o.who() }; remember(id, 'w', true, prev ? canon(prev) : null); }
    if (!want) forget(id, 'w');
    if (!m) { if (prev && personal(prev)) { sp.rating = want ? 0 : prev.rating; sp.note = prev.note; summarize(sp); } return null; } // no name: never over someone's voice (named() stopped a rating or note)
    const pv = prev ? listed(prev.v) : [], L = prev && !pv.length ? legacy(prev) : null, Lmine = !!L && !!L.k && L.k === m;
    const old = clean(m, own(prev && prev.v, m)) || (Lmine ? L : null);
    const r = want ? (old ? old.r : 0) : Math.max(0, Math.min(5, d.rating | 0)), note = cleanNote(d.note); // want to go: the rating you had stays (hidden), never stars tapped before switching
    const kept = old ? old.r === r && old.note === note : !r && !note;
    let entry = kept ? (old && !old.legacy ? own(prev.v, m) : null) : r || note ? { n: o.who(), r, note, at: new Date().toISOString() } : null, anon;
    if (entry && entry.n !== o.who()) entry = Object.assign({}, entry, { n: o.who() }); // same voice, the name written differently now
    if (!kept || pv.length) {
      const v = copy(prev && prev.v, true) || {};
      if (!kept && L && !Lmine && !(entry && entry.r === L.r && entry.note === L.note)) { const k = L.k && okKey(L.k) ? L.k : ANON; anon = { k, e: { n: k === ANON ? '' : L.n, r: L.r, note: L.note, at: legacyAt(prev) } }; v[k] = anon.e; } // the old rating and note stay as the logger's voice (they logged it); with no logger, as the unnamed earlier voice
      if (entry) v[m] = entry; else delete v[m];
      if (Object.keys(v).length) sp.v = v; else delete sp.v;
    }
    if (sp.v) summarize(sp); else if (prev && kept) { sp.rating = want ? 0 : prev.rating; sp.note = prev.note; } // a legacy spot left as it was
    if (!kept) remember(id, 'v', entry, prev ? canon(prev) : null, anon);
    if (prev && !kept && r && !want && (!old || old.r !== r) && !evd.has('r:' + id)) return { rated: r, sent: () => evd.add('r:' + id) };
    return null;
  }
  // Mark as been: who wants to go is done with, and the summary counts the ratings again
  function been(id) { const sp = own(o.state.spots, id); if (!sp) return; delete sp.w; forget(id, 'w'); summarize(sp); }
  // Settings, a new name on a shared log: your entries move to the new slug (this treats the name as who you are), except on a spot
  // where the new slug already has one (that spot keeps the old entry). One save.
  function renamed(was, now) {
    const a = vslug(o.cleanName(was)), b = vslug(o.cleanName(now)), n = o.cleanName(now); if (!o.state.canWrite || !shared() || !a || !b || a === b) return 0;
    let moved = 0;
    for (const id of Object.keys(o.state.spots)) {
      const sp = o.state.spots[id]; if (!isObj(sp)) continue; let hit = false;
      for (const f of ['v', 'w', 'rx']) {
        if (own(sp[f], a) === undefined || own(sp[f], b) !== undefined) continue;
        const c = copy(sp[f], f === 'v'), e = c[a]; delete c[a]; c[b] = f === 'w' ? n : f === 'v' && isObj(e) ? Object.assign({}, e, { n }) : e; sp[f] = c; hit = true;
      }
      if (hit) moved++;
    }
    if (moved) { o.persist(); o.render(); }
    return moved;
  }

  // ---------- this device's last writes, put back once if another device's save dropped them ----------
  function remember(id, f, val, base, anon) {
    if (!shared() || !o.state.canWrite || !okId(id)) return;
    if (![...pend.values()].some(p => p.id === id)) bases.set(id, base);
    pend.set(id + ':' + f, { id, f, val, anon, s: me(), t: Date.now(), ok: false });
  }
  function forget(id, f) { pend.delete(id + ':' + f); if (![...pend.values()].some(p => p.id === id)) bases.delete(id); }
  // the log shows the write (a newer voice of yours from another device counts: it stands). Voices by rating and note, not the name
  function shows(sp, p) {
    if (p.f === 'v') { const cur = clean(p.s, own(sp.v, p.s)), want = p.val ? clean(p.s, p.val) : null; if (cur && cur.t > (want ? want.t : p.t)) return true; return want ? !!cur && cur.r === want.r && cur.note === want.note : !cur; }
    if (p.f === 'w') return sp.status !== 'want' || wanters(sp).some(x => x.k === p.s) === p.val;
    const cur = own(sp.rx, p.s); return (typeof cur === 'string' && RXS.has(cur) ? cur : '') === p.val;
  }
  function put(sp, p) {
    if (p.f === 'v') {
      const was = listed(sp.v), v = {}; for (const x of was) v[x.k] = sp.v[x.k]; // the voices listed, nothing made from the summary
      if (p.val) v[p.s] = p.val; else delete v[p.s];
      if (p.anon && !was.length) v[p.anon.k] = p.anon.e; // the earlier voice this write kept, when the log came back with no v at all
      if (Object.keys(v).length) { sp.v = v; summarize(sp); } else { delete sp.v; if (was.length) { sp.rating = 0; sp.note = ''; } }
    } else if (p.f === 'w') { const w = hasW(sp) ? copy(sp.w) : seedW(sp); if (p.val) w[p.s] = o.who(); else delete w[p.s]; if (Object.keys(w).length) sp.w = w; else delete sp.w; }
    else { const rx = copy(sp.rx) || {}; if (p.val) rx[p.s] = p.val; else delete rx[p.s]; if (Object.keys(rx).length) sp.rx = rx; else delete sp.rx; }
  }
  // app.js: this device's own save came back from the database. Every write so far has reached it; a log arriving after this
  // that lacks one was saved over it
  function echo() { for (const p of pend.values()) p.ok = true; }
  // app.js: a log from elsewhere has just been adopted. true when something was put back (app.js then saves)
  function arrived() {
    if (!pend.size) return false;
    if (!o.state.canWrite || !shared()) { pend.clear(); bases.clear(); return false; } // a read-only device writes nothing
    const now = Date.now(), s = me(), d = o.state.draft; let changed = false;
    for (const [k, p] of [...pend]) {
      const sp = Object.hasOwn(o.state.spots, p.id) ? o.state.spots[p.id] : null, id = p.id;
      if (!isObj(sp) || p.s !== s || now - p.t > WINDOW || shows(sp, p)) { forget(id, p.f); continue; }
      if (!p.ok || (o.state.view === 'log' && d && d.id === id)) continue; // older than this write (its echo is still to come), or the spot's form is open
      const oldCode = !isObj(sp.v) && !isObj(sp.w) && !isObj(sp.rx) && canon(sp) !== bases.get(id); // edited by older code: accepted
      if (!oldCode) { put(sp, p); changed = true; }
      pend.delete(k); if (![...pend.values()].some(x => x.id === id)) bases.delete(id);
    }
    return changed;
  }
  // a log read from anywhere: v, w or rx that is not an object (an array, a string) is dropped, never written back
  function tidy(spots) { if (!isObj(spots)) return; for (const id of Object.keys(spots)) { const sp = spots[id]; if (isObj(sp)) for (const f of ['v', 'w', 'rx']) if (Object.hasOwn(sp, f) && !isObj(sp[f])) delete sp[f]; } }

  function init(opts) {
    o = opts;
    try { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.startsWith('sbs-mine-')) localStorage.removeItem(k); } } catch (e) {} // the earlier, long-lived memory of this device's writes
  }
  return { init, voices, rating, block, extras, wire, wantLabel, both, draft, named, label, saved, been, renamed, echo, arrived, tidy, slug: vslug, RX };
})();
