// The 3D map's measuring tools, for a real phone: ?m3d-stats=1 shows a small readout of the frames the engine draws while the map
// moves; ?m3d-bench=1 runs a speed test by itself (about a minute) and ends with a table of results to copy. index.html loads this
// file only with one of those in the address, after the 3D map's own files; it uses the engine's debug members (stats, bench, tune,
// onDraw) and window.__sbs, nothing else. Without the switches it is not loaded, and nothing here runs.
(function () {
  'use strict';
  const QS = location.search, BENCH = /[?&]m3d-bench=1(?:&|$)/.test(QS), STATS = /[?&]m3d-stats=1(?:&|$)/.test(QS);
  if (!BENCH && !STATS) return;
  const now = () => performance.now(), sleep = ms => new Promise(r => setTimeout(r, ms)), frame = () => new Promise(r => { requestAnimationFrame(() => r()); setTimeout(r, 500); });
  const r1 = v => v == null || !isFinite(v) ? '-' : (+v).toFixed(1);
  const pct = (a, q) => { if (!a.length) return NaN; const s = a.slice().sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * q))]; };
  const pad = (s, n) => { s = String(s); return s.length >= n ? s + ' ' : s + ' '.repeat(n - s.length); };
  const mk = (tag, s, text) => { const el = document.createElement(tag); el.style.cssText = s || ''; if (text != null) el.textContent = text; return el; };

  // the map, once the app has made it: the 3D engine when it is ready, or null (the flat map, or no answer within 30 s)
  async function mapReady() {
    const t0 = now();
    while (now() - t0 < 30000) {
      const S = window.__sbs, m = S && S.map;
      if (m && !m.is3d) return null;
      if (m && m.is3d && m.stats && m.stats(true).ready) return m;
      await sleep(200);
    }
    return null;
  }

  // ---- the readout (?m3d-stats=1): the frames drawn while the map moves or animates, over the last two seconds ----
  function readout(m) {
    const box = mk('div', 'position:fixed;z-index:9000;left:12px;top:60px;pointer-events:none;background:rgba(10,14,20,.72);color:#fff;font:11px/1.35 ui-monospace,Menlo,Consolas,monospace;padding:4px 7px;border-radius:6px;white-space:pre;');
    box.className = 'm3d-stats'; box.setAttribute('aria-hidden', 'true'); document.body.appendChild(box);
    const place = () => { const a = document.getElementById('areas'), r = a && a.getBoundingClientRect(); if (r && r.width) { box.style.left = Math.round(r.left) + 'px'; box.style.top = Math.round(r.bottom + 6) + 'px'; } };
    const gaps = []; let last = 0, lastMv = false, over = 0; const prev = m.onDraw;
    m.onDraw = (t, mv, only) => { if (prev) prev(t, mv, only); if (mv && lastMv && last) { const g = t - last; if (g < 250) { gaps.push([t, g]); if (g > 25) over++; } } last = t; lastMv = mv; while (gaps.length && t - gaps[0][0] > 2000) gaps.shift(); };
    const show = () => {
      place(); const t = now(), g = gaps.filter(e => t - e[0] <= 2000).map(e => e[1]), s = m.stats(true), sum = g.reduce((a, b) => a + b, 0);
      box.textContent = (g.length ? `${r1(g.length / (sum / 1000))} fps  mid ${r1(pct(g, .5))}  worst ${r1(Math.max.apply(null, g))} ms` : 'at rest') + `\n>25 ms: ${over}  q ${s.quality}  pr ${s.pr}\ntris ${s.triangles}  calls ${s.calls}`;
    };
    show(); setInterval(show, 500);
  }

  // ---- the speed test (?m3d-bench=1) ----
  const SETTINGS = [
    ['as live at rest', null], ['pr 3', { pr: 3 }], ['pr 2', { pr: 2 }], ['pr 1.5', { pr: 1.5 }], ['pr 2, no shadows', { pr: 2, shadows: false }],
    ['pr 2, no building shadows', { pr: 2, fabShadow: false }], ['pr 2, half the buildings', { pr: 2, fab: 0.5 }], ['pr 2, no ambient life', { pr: 2, life: false }],
    ['pr 2, old shadow rule', { pr: 2, shadowHold: false }], ['pr 2, plain materials', { pr: 2, plain: true }],
  ];
  const BACK = { pr: 0, shadows: null, fabShadow: null, fab: null, life: null, shadowHold: null, plain: null }; // every tune field back to the normal rule
  const VIEWS = [['the first screen', null], ['Noe Valley', { hood: 'Noe Valley' }], ['Financial District', { hood: 'Financial District' }], ['Center Strip, Las Vegas', { hood: 'Center Strip' }]];

  function panel() {
    const p = mk('div', 'position:fixed;z-index:9001;left:0;right:0;bottom:0;height:50vh;box-sizing:border-box;display:flex;flex-direction:column;gap:10px;padding:16px 16px calc(16px + env(safe-area-inset-bottom,0px));background:rgba(12,16,22,.94);color:#f4efe6;font:14px/1.4 system-ui,-apple-system,sans-serif;border-radius:16px 16px 0 0;box-shadow:0 -6px 24px rgba(0,0,0,.35);');
    p.className = 'm3d-bench';
    const head = mk('div', 'font-weight:700;font-size:16px;', 'Speed test running, about a minute. Please don\'t touch the screen.'), line = mk('div', 'font:12px/1.4 ui-monospace,Menlo,Consolas,monospace;opacity:.85;', 'Waiting for the 3D map…');
    p.append(head, line); document.body.appendChild(p);
    return { p, head, line };
  }
  // every requestAnimationFrame gap from now until the returned stop() is called
  function recorder() { const g = []; let last = 0, on = true; const tick = t => { if (!on) return; if (last) g.push(t - last); last = t; requestAnimationFrame(tick); }; requestAnimationFrame(tick); return () => { on = false; return g; }; }
  const gapLine = g => g.length ? `${g.length} frames, middle ${r1(pct(g, .5))} ms, 95th ${r1(pct(g, .95))}, worst ${r1(Math.max.apply(null, g))}, over 25 ms ${g.filter(x => x > 25).length}, over 50 ms ${g.filter(x => x > 50).length}` : 'no frames recorded';

  async function run() {
    const ui = panel(), out = [], t00 = now(); let hid = '', step = 'waiting for the map', m = null;
    const say = s => { step = s; ui.line.textContent = s + `  (${Math.round((now() - t00) / 1000)} s)`; };
    document.addEventListener('visibilitychange', () => { if (document.hidden && !hid) hid = step; });
    const check = () => { if (hid) throw new Error('interrupted'); };
    const sw = (QS.match(/[?&]m3d-[a-z0-9]+=[^&]*/gi) || []).map(s => s.slice(1)).join(' ');
    out.push('3D map speed test, ' + new Date().toISOString());
    out.push('switches in the address: ' + sw);
    out.push('commit: ' + (window.SBS_COMMIT || document.documentElement.getAttribute('data-commit') || 'not known (the page carries no build stamp)'));
    out.push('user agent: ' + navigator.userAgent);
    const dpr = window.devicePixelRatio || 1;
    out.push(`screen ${screen.width}x${screen.height}, window ${innerWidth}x${innerHeight}, device pixel ratio ${dpr}`);
    say('Waiting for the 3D map');
    m = await mapReady();
    if (!m) { out.push('', 'The 3D map did not start here (the page shows the flat map), so there is nothing to measure.'); return finish(ui, out, hid); }
    const S = window.__sbs, st = () => m.stats(true);
    // the test leaves the app as it found it: no history entries (push: false), the place, the camera and the saved area put back at the end,
    // after an error or an interruption, and the saved area also if the page is closed mid-run
    let prefs0 = null, cam0 = null, running = true; try { prefs0 = localStorage.getItem('sbs-prefs-v3'); } catch (e) {}
    const loc0 = JSON.parse(JSON.stringify(S.state.loc));
    const putBack = () => { try { if (prefs0 != null) localStorage.setItem('sbs-prefs-v3', prefs0); else localStorage.removeItem('sbs-prefs-v3'); } catch (e) {} };
    window.addEventListener('pagehide', () => { if (running) putBack(); });
    // the flight in progress has ended and the streaming queues are empty (then a breath for the new chunks to grow in), at most ms
    const settle = async ms => { const t0 = now(); while (now() - t0 < ms) { const s = st(); if (!s.moving && !s.fabric.queue && !s.real.queue) { await sleep(700); return true; } await sleep(100); } return false; };
    // a flight by the app's own navigation, every screen refresh recorded from just before it until it ends
    const fly = async to => { const stop = recorder(), t0 = now(); S.go(to, { push: false }); let began = false, end = 0;
      while (now() - t0 < 10000) { await sleep(40); const s = st(); if (s.moving) began = true; else if (began || now() - t0 > 1500) { end = now(); break; } }
      const g = stop(), ms = (end || now()) - t0, ok = end ? await settle(10000 - (now() - t0)) : false; return { g, ms, ok }; };
    try {
      out.push('GPU: ' + (st().gpu || 'not given'));
      say('Letting the first screen fill in'); const ok0 = await settle(10000); check();
      say('Measuring the screen\'s refresh rate');
      const idle = await new Promise(res => { const g = []; let last = 0; const tick = t => { if (last) g.push(t - last); last = t; if (g.length >= 60 || hid) return res(g); requestAnimationFrame(tick); }; requestAnimationFrame(tick); setTimeout(() => res(g), 6000); });
      const mid = pct(idle, .5); out.push(`refresh rate: ${r1(1000 / mid)} Hz (middle of ${idle.length} idle frame gaps: ${r1(mid)} ms)`); check();
      cam0 = Object.assign({}, m.cam);
      for (const [name, to] of VIEWS) {
        out.push('', `== ${name}`);
        if (!to) { if (!ok0) out.push('  (did not settle within 10 s: measured anyway)'); }
        else { say(`Flying to ${name}`); const f = await fly(to); check(); out.push(`  flight here (${Math.round(f.ms)} ms): ${gapLine(f.g)}`); if (!f.ok) out.push('  (did not settle within 10 s: measured anyway)'); }
        const s = st(); out.push(`  at rest: quality ${s.quality}, pixel ratio ${s.pr}, ${s.triangles} triangles, ${s.calls} draw calls`);
        out.push('  cost of one frame (ms, bench(30) after bench(8), each finished on the GPU):', '  ' + pad('setting', 28) + pad('middle', 8) + pad('95th', 8) + 'shadow redraws');
        for (const [label, o] of SETTINGS) {
          if (o && o.pr === 3 && dpr < 3) { out.push('  ' + pad(label, 28) + 'skipped (the screen\'s ratio is below 3)'); continue; }
          say(`${name}: ${label}`); m.tune(Object.assign({}, BACK, o || {})); await frame(); await frame(); check();
          m.bench(8); const d0 = st().shadowDraws, b = m.bench(30), d1 = st().shadowDraws;
          out.push('  ' + pad(label, 28) + pad(r1(b.p50), 8) + pad(r1(b.p95), 8) + (d1 - d0));
          m.tune(BACK); await frame();
        }
        // the cost of a resolution switch: one frame drawn straight after the ratio changed, against one at the same ratio
        say(`${name}: a resolution switch`);
        const hi = Math.min(3, dpr), lo = hi >= 3 ? 2 : 1.5;
        if (hi > lo) { const a = [], b = [], c = [];
          for (let k = 0; k < 3; k++) { m.tune({ pr: hi }); m.bench(1); await frame(); let t = now(); m.tune({ pr: lo }); m.bench(1); a.push(now() - t); await frame(); t = now(); m.tune({ pr: hi }); m.bench(1); b.push(now() - t); await frame(); t = now(); m.bench(1); c.push(now() - t); await frame(); check(); }
          out.push(`  resolution switch (middle of 3): to pr ${lo} ${r1(pct(a, .5))} ms, to pr ${hi} ${r1(pct(b, .5))} ms; the same frame with no switch at pr ${hi}: ${r1(pct(c, .5))} ms`); }
        else out.push('  resolution switch: not measured (the screen\'s ratio is ' + dpr + ')');
        m.tune(BACK); await frame();
      }
      // a finger cannot be scripted: three seconds of a steady pan at the first screen instead, a little further every frame
      out.push('', '== a steady pan at the first screen');
      say('Flying back to the first screen'); const f = await fly(loc0); check(); out.push(`  flight back (${Math.round(f.ms)} ms): ${gapLine(f.g)}`);
      say('A steady pan, 3 s');
      const c0 = Object.assign({}, m.cam), stop = recorder(), t0 = now();
      await new Promise(res => { const tick = () => { const t = now() - t0; if (t >= 3000 || hid) return res(); m.flyToView({ x: c0.x + c0.w * 0.12 * t / 1000, y: c0.y, w: c0.w }, 120); requestAnimationFrame(tick); }; requestAnimationFrame(tick); setTimeout(res, 6000); });
      const g = stop(); check(); out.push(`  pan (3 s, the camera moved by the engine's flyToView every frame): ${gapLine(g)}`);
      const s = st(); out.push(`  quality at the end ${s.quality} (governor ${JSON.stringify(s.gov)}), shadow redraws since the page opened ${s.shadowDraws}`);
    } catch (e) { if (!hid) out.push('', 'stopped by an error: ' + (e && e.message || e)); }
    try { m.tune(BACK); } catch (e) {}
    try { S.go(loc0, { push: false }); if (cam0) m.flyToView(cam0, 300); } catch (e) {}
    putBack(); running = false;
    out.push('', `run time ${Math.round((now() - t00) / 1000)} s`);
    return finish(ui, out, hid);
  }

  function finish(ui, out, hid) {
    if (hid) out.splice(1, 0, `INTERRUPTED: the page was hidden during "${hid}"; the results stop there.`);
    const text = out.join('\n'); window.__m3dBench = text; console.log(text);
    ui.head.textContent = hid ? 'Speed test interrupted' : 'Speed test done'; ui.line.remove();
    const pre = mk('pre', 'flex:1;min-height:0;margin:0;overflow:auto;-webkit-overflow-scrolling:touch;white-space:pre;font:11px/1.35 ui-monospace,Menlo,Consolas,monospace;background:rgba(255,255,255,.06);padding:8px;border-radius:8px;user-select:text;-webkit-user-select:text;', text);
    const row = mk('div', 'display:flex;gap:10px;'), copy = mk('button', 'flex:1;min-height:52px;font:700 17px system-ui,sans-serif;border:0;border-radius:12px;background:#f4efe6;color:#111;', 'Copy results'), close = mk('button', 'min-height:52px;padding:0 20px;font:600 15px system-ui,sans-serif;border:1px solid rgba(255,255,255,.4);border-radius:12px;background:transparent;color:#f4efe6;', 'Close');
    copy.type = close.type = 'button'; row.append(copy, close); ui.p.append(pre, row);
    // the copy inside the tap; where the clipboard refuses, the text in a box, selected, to copy by hand
    const byHand = () => { const ta = mk('textarea', 'flex:1;min-height:0;font:11px/1.35 ui-monospace,Menlo,Consolas,monospace;background:#fff;color:#111;border-radius:8px;'); ta.value = text; ta.readOnly = true; (ui.p.contains(pre) ? pre : ui.p.querySelector('textarea')).replaceWith(ta); ta.focus(); ta.select(); try { ta.setSelectionRange(0, text.length); } catch (e) {} copy.textContent = 'Selected: copy it by hand'; };
    copy.addEventListener('click', () => { try { navigator.clipboard.writeText(text).then(() => { copy.textContent = 'Copied'; }, byHand); } catch (e) { byHand(); } });
    close.addEventListener('click', () => ui.p.remove());
    return text;
  }

  (async () => {
    if (BENCH) run().catch(e => console.error('3D speed test: ' + (e && e.stack || e)));
    if (STATS) { const m = await mapReady(); if (m) readout(m); }
  })();
})();
