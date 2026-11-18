// The street map in a spot or section panel: OpenFreeMap vector tiles (OpenStreetMap data, keyless) drawn by MapLibre GL JS
// in the app's own palette. The library is vendored and is not part of the page's load: it comes on first need, or when the
// browser is idle after boot. One map (one WebGL context) for the page, moved into whichever panel shows it, so a re-render
// of the panel keeps it as drawn. Until a view has drawn, its box is the land colour with the pin already in place; anything
// that keeps the map from drawing (no WebGL, the library or the tiles not loading, 6 s without a frame) puts Google's keyless
// embed in the box instead, so it is never blank. app.js only calls this where streetOK() holds (never inside the artifact).
(function () {
  // MapLibre GL JS 5.24.0 (BSD-3-Clause, vendor/LICENSE-maplibre-gl.txt), from https://unpkg.com/maplibre-gl@5.24.0/dist/
  //   sha256 vendor/maplibre-gl.js  45a9b07a9189ce56054c620a947ccf41e291e58c95e9b61533b740aaa65ee5cb
  //   sha256 vendor/maplibre-gl.css ab1e70d59ec40465bae7e7030da2f3ccf28133fd502e62bd598eefbadfd7a732
  const LIB = 'vendor/maplibre-gl.js', LIB_CSS = 'vendor/maplibre-gl.css';
  const TILEJSON = 'https://tiles.openfreemap.org/planet', GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
  const FONT = ['Noto Sans Regular'], FONT_I = ['Noto Sans Italic'], WAIT = 6000, LIB_WAIT = 15000;
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  let lib = null, src = null, dead = !('WebGLRenderingContext' in window), drawn = false;
  let map = null, host = null, pending = null, shown = null, cur = null, omt = null, data = { sec: fc([]), dots: fc([]) }, dataKey = '';
  function fc(features) { return { type: 'FeatureCollection', features }; }

  // ---------- loading ----------
  function loadLib() {
    if (lib) return lib;
    const css = new Promise((res, rej) => { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = LIB_CSS; l.onload = res; l.onerror = rej; document.head.appendChild(l); });
    const js = window.maplibregl ? Promise.resolve() : new Promise((res, rej) => { const s = document.createElement('script'); s.src = LIB; s.async = true; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
    lib = Promise.all([js, css]).then(() => { if (!window.maplibregl) throw new Error('maplibre did not load'); try { maplibregl.prewarm(); } catch (e) {} return maplibregl; }); // prewarm: the tile workers start now, not on the first view
    lib.catch(e => { dead = true; console.warn('street map: library failed, using the Google embed', e); });
    return lib;
  }
  // the TileJSON names the current weekly tile build, so it is fetched (once) rather than written into the style; a failure
  // is not remembered, so the next panel tries again
  function source() {
    if (!src) { src = fetch(TILEJSON).then(r => r.ok ? r.json() : Promise.reject(new Error('tilejson ' + r.status))).then(j => ({ type: 'vector', tiles: j.tiles, minzoom: j.minzoom || 0, maxzoom: j.maxzoom || 14 })); src.catch(() => { src = null; }); }
    return src;
  }
  // preload: the library, the TileJSON and the Latin glyphs (cached a week by the tile host), so a first panel only waits for tiles
  function preload() {
    if (dead) return;
    loadLib(); source();
    for (const f of [FONT, FONT_I]) fetch(GLYPHS.replace('{fontstack}', encodeURIComponent(f.join(','))).replace('{range}', '0-255')).catch(() => {});
  }
  // after boot, once the page has loaded and the browser has nothing better to do
  function idle() {
    if (dead) return;
    const go = () => (window.requestIdleCallback || (f => setTimeout(f, 300)))(preload, { timeout: 3000 });
    if (document.readyState === 'complete') go(); else window.addEventListener('load', go, { once: true });
  }

  // ---------- style: every colour from the CSS tokens, so it follows the theme ----------
  const hex = c => { c = String(c).trim().replace('#', ''); if (c.length === 3) c = c.replace(/./g, x => x + x); return [0, 2, 4].map(i => parseInt(c.slice(i, i + 2), 16) || 0); };
  const mix = (a, b, t) => { const A = hex(a), B = hex(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join(''); };
  const lum = c => { const [r, g, b] = hex(c); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
  function palette() {
    const cs = getComputedStyle(document.documentElement), t = n => cs.getPropertyValue('--' + n).trim() || '#888888';
    const land = t('land'), dark = lum(land) < 0.4, ink2 = t('ink-2'), paper = t('paper');
    const K = {}; for (const k of ['food', 'drink', 'coffee', 'view', 'shop', 'park', 'other']) K[k] = t('k-' + k);
    return {
      dark, land, K, paper, accent: t('accent'),
      water: dark ? mix(t('water'), land, .22) : t('water'), waterLine: mix(t('water'), t('coast'), dark ? .35 : .25), wlbl: t('wlbl'),
      park: mix(land, t('k-park'), dark ? .28 : .3), wood: mix(land, t('k-park'), dark ? .22 : .24), sand: mix(land, t('v-sun'), .14),
      bld: mix(land, t('line-2'), dark ? .5 : .55), bldLine: mix(land, t('line-2'), dark ? .9 : 1),
      minor: dark ? mix(land, ink2, .13) : mix(paper, land, .15), major: dark ? mix(land, ink2, .2) : paper,
      casing: dark ? mix(land, t('water'), .55) : mix(land, t('line-2'), .9), path: dark ? mix(land, ink2, .2) : mix(land, t('muted'), .32),
      rail: dark ? mix(land, ink2, .24) : mix(land, t('muted'), .38),
      text: ink2, text3: mix(ink2, t('muted'), .55), text2: t('muted'), halo: land,
    };
  }
  function style() {
    const C = palette(), get = k => ['get', k], is = (...c) => ['match', get('class'), c, true, false];
    const name = ['coalesce', get('name:en'), get('name')], notTunnel = ['!=', get('brunnel'), 'tunnel'];
    const roads = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service'];
    // one zoom interpolate per expression: the per-class widths sit inside its stops
    const width = (svc, minor, mid, major) => ['interpolate', ['exponential', 1.6], ['zoom'], ...[13, 15, 17, 19].flatMap((z, i) => [z, ['match', get('class'), ['service'], svc[i], ['minor'], minor[i], ['tertiary'], mid[i], major[i]]])];
    const kind = ['match', get('k'), ...Object.entries(C.K).flatMap(([k, c]) => [k, c]), C.K.other];
    return {
      version: 8, glyphs: GLYPHS,
      sources: { omt, sec: { type: 'geojson', data: data.sec }, dots: { type: 'geojson', data: data.dots } },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': C.land } },
        { id: 'wood', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: is('wood', 'grass', 'farmland'), paint: { 'fill-color': C.wood } },
        { id: 'sand', type: 'fill', source: 'omt', 'source-layer': 'landcover', filter: is('sand'), paint: { 'fill-color': C.sand } },
        { id: 'park', type: 'fill', source: 'omt', 'source-layer': 'park', paint: { 'fill-color': C.park } },
        { id: 'green', type: 'fill', source: 'omt', 'source-layer': 'landuse', filter: is('cemetery', 'pitch', 'playground', 'stadium', 'garden', 'grass'), paint: { 'fill-color': C.park, 'fill-opacity': .8 } },
        { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', filter: ['!=', get('brunnel'), 'tunnel'], paint: { 'fill-color': C.water } },
        { id: 'waterway', type: 'line', source: 'omt', 'source-layer': 'waterway', filter: notTunnel, paint: { 'line-color': C.water, 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 1, 17, 3] } },
        { id: 'bld', type: 'fill', source: 'omt', 'source-layer': 'building', minzoom: 14.5, paint: { 'fill-color': C.bld, 'fill-outline-color': C.bldLine, 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 14.5, 0, 15.5, 1] } },
        { id: 'path', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 14, filter: ['all', is('path', 'track'), ['!', ['match', get('subclass'), ['footway', 'sidewalk', 'crossing', 'cycleway', 'steps', 'pedestrian'], true, false]], notTunnel], paint: { 'line-color': C.path, 'line-width': ['interpolate', ['linear'], ['zoom'], 14, .6, 18, 1.6], 'line-dasharray': [2.5, 2] } },
        { id: 'rail', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['all', is('rail'), notTunnel], paint: { 'line-color': C.rail, 'line-width': ['interpolate', ['linear'], ['zoom'], 13, .6, 18, 1.4] } },
        { id: 'tunnel', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['all', ['match', get('class'), roads, true, false], ['==', get('brunnel'), 'tunnel']], layout: { 'line-join': 'round' }, paint: { 'line-color': C.casing, 'line-opacity': .6, 'line-width': width([.5, 1, 3, 8], [1, 3, 7, 18], [1.5, 4, 9, 22], [2, 5, 11, 26]), 'line-dasharray': [1.5, 1] } },
        { id: 'case', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['all', ['match', get('class'), roads, true, false], notTunnel], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': C.casing, 'line-width': width([0, 2.6, 6, 14], [.9, 5.2, 12.5, 30], [2.6, 7.5, 16, 38], [3.6, 9.5, 19, 44]) } },
        { id: 'road', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['all', ['match', get('class'), roads, true, false], notTunnel], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['match', get('class'), ['minor', 'service'], C.minor, C.major], 'line-width': width([0, 1.4, 4.4, 12], [.5, 3.6, 10.5, 27], [1.7, 5.8, 14, 35], [2.6, 7.6, 17, 41]) } },
        { id: 'sec-fill', type: 'fill', source: 'sec', paint: { 'fill-color': C.accent, 'fill-opacity': C.dark ? .08 : .07 } },
        { id: 'sec-line', type: 'line', source: 'sec', layout: { 'line-join': 'round' }, paint: { 'line-color': C.accent, 'line-opacity': .55, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.2, 16, 1.8] } },
        { id: 'water-lbl', type: 'symbol', source: 'omt', 'source-layer': 'water_name', layout: { 'text-field': name, 'text-font': FONT_I, 'text-size': 12, 'text-letter-spacing': .06, 'text-max-width': 8 }, paint: { 'text-color': C.wlbl, 'text-halo-color': C.water, 'text-halo-width': 1 } },
        { id: 'road-lbl', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 13.5, filter: ['match', get('class'), roads, true, false], layout: { 'symbol-placement': 'line', 'text-field': name, 'text-font': FONT, 'text-size': ['interpolate', ['linear'], ['zoom'], 14, ['match', get('class'), ['minor', 'service'], 10, 11], 16, ['match', get('class'), ['minor', 'service'], 11.5, 12.5], 18, ['match', get('class'), ['minor', 'service'], 13, 14]], 'text-letter-spacing': .02, 'symbol-spacing': 280, 'text-padding': 4 }, paint: { 'text-color': ['match', get('class'), ['minor', 'service'], C.text3, C.text], 'text-halo-color': C.halo, 'text-halo-width': 1.6 } },
        { id: 'place-lbl', type: 'symbol', source: 'omt', 'source-layer': 'place', filter: is('neighbourhood', 'quarter', 'suburb', 'village', 'town', 'hamlet'), layout: { 'text-field': name, 'text-font': FONT, 'text-size': 11, 'text-transform': 'uppercase', 'text-letter-spacing': .12, 'text-max-width': 7, 'text-padding': 8 }, paint: { 'text-color': C.text2, 'text-halo-color': C.halo, 'text-halo-width': 1.4 } },
        { id: 'dots', type: 'circle', source: 'dots', paint: { 'circle-color': kind, 'circle-radius': 5, 'circle-stroke-color': C.paper, 'circle-stroke-width': 1.6 } },
      ],
    };
  }

  // ---------- the box ----------
  const ATTR = '<span class="smap-attr">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a></span>';
  // v: { key, name, href (where a tap goes on the phone), q and z (the Google fallback), and either lat, lon, zoom and pin
  // { c, e } (a spot) or rings [[[lon, lat], ...], ...] and seed [lon, lat] (a section); dots: [[lon, lat, kind], ...] }
  function box(v) {
    const pin = v.pin ? `<span class="smap-pin" style="--c:${esc(v.pin.c)}" aria-hidden="true"><i><b>${esc(v.pin.e)}</b></i></span>` : '';
    return `<div class="mapprev" data-key="${esc(v.key)}"><a class="smap-link" href="${esc(v.href)}" target="_blank" rel="noopener" aria-label="Open ${esc(v.name)} in Maps"></a>${pin}${ATTR}</div>`;
  }
  // Google's keyless embed. Its referrer is the origin only: the page URL carries the private ?log= key
  function fallback(el, v) {
    if (pending && pending.el === el) { clearTimeout(pending.timer); pending = null; }
    if (host && host.parentNode === el) host.remove();
    el.classList.remove('live'); el.classList.add('fb');
    if (!el.querySelector('iframe')) el.insertAdjacentHTML('afterbegin', `<iframe src="${esc(`https://www.google.com/maps?q=${encodeURIComponent(v.q)}&z=${v.z}&output=embed`)}" loading="lazy" title="Street map of ${esc(v.name)}" referrerpolicy="origin"></iframe>`);
  }
  function attach(el) { if (host.parentNode !== el) el.insertBefore(host, el.firstChild); map.resize(); }
  function placePin() { if (!cur || !cur.pin || !map) return; const pin = cur.el.querySelector('.smap-pin'); if (!pin) return; const p = map.project([cur.lon, cur.lat]); pin.style.left = p.x.toFixed(1) + 'px'; pin.style.top = p.y.toFixed(1) + 'px'; }
  function setData(v) {
    const sec = v.rings && v.rings.length ? fc([{ type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: v.rings.map(r => [r.concat([r[0]])]) } }]) : fc([]);
    const dots = fc((v.dots || []).map(d => ({ type: 'Feature', properties: { k: d[2] }, geometry: { type: 'Point', coordinates: [d[0], d[1]] } })));
    const k = JSON.stringify([sec, dots]); if (k === dataKey) return; dataKey = k; data = { sec, dots };
    if (map && map.getSource('sec')) { map.getSource('sec').setData(sec); map.getSource('dots').setData(dots); }
  }
  function camera(v) {
    if (!v.rings || !v.rings.length) return { center: v.seed || [v.lon, v.lat], zoom: v.zoom || 15 };
    let x0 = 180, y0 = 90, x1 = -180, y1 = -90; v.rings.forEach(r => r.forEach(([x, y]) => { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }));
    const c = map.cameraForBounds([[x0, y0], [x1, y1]], { padding: 22, maxZoom: 16 });
    return c ? { center: c.center, zoom: Math.max(12, c.zoom) } : { center: v.seed, zoom: 15 };
  }
  function create(gl, el, v) {
    host = document.createElement('div'); host.className = 'smap-host'; host.setAttribute('aria-hidden', 'true');
    el.insertBefore(host, el.firstChild);
    map = new gl.Map({ container: host, style: style(), center: v.seed || [v.lon, v.lat], zoom: v.zoom || 15, attributionControl: false, fadeDuration: 0, maxPitch: 0, dragRotate: false, pitchWithRotate: false, touchPitch: false, keyboard: false, cooperativeGestures: true, renderWorldCopies: false, validateStyle: false, refreshExpiredTiles: false });
    map.touchZoomRotate.disableRotation();
    map.getCanvas().setAttribute('tabindex', '-1');
    map.on('move', placePin); map.on('resize', placePin);
    map.on('style.load', () => { if (map.getSource('sec')) { map.getSource('sec').setData(data.sec); map.getSource('dots').setData(data.dots); } });
    // before anything has ever drawn, a tile or style error means the tiles are not reachable: the embed, now, not in 6 s
    map.on('error', e => { console.warn('street map:', e && e.error ? e.error.message || e.error : e); if (!drawn && pending) { const p = pending; src = null; fallback(p.el, p.v); } });
  }
  // for tests and timing: how long a view took from mount to drawn
  function report(key, t0) { api.last = { key, ms: Math.round(performance.now() - t0) }; window.dispatchEvent(new CustomEvent('streetmap:drawn', { detail: api.last })); }
  function arm(p, ms) { clearTimeout(p.timer); p.timer = setTimeout(() => { if (pending === p) { console.warn(`street map: nothing drawn in ${ms / 1000} s, using the Google embed`); fallback(p.el, p.v); } }, ms); }
  function show(p) {
    const { el, v } = p; arm(p, WAIT);
    attach(el); el.classList.remove('live', 'fb');
    setData(v); map.jumpTo(camera(v)); placePin();
    const done = () => {
      if (pending !== p) { map.off('idle', done); return; }
      map.off('idle', done); clearTimeout(p.timer); pending = null; drawn = true; shown = v.key;
      el.classList.add('live'); report(v.key, p.t0);
    };
    map.on('idle', done); map.triggerRepaint();
  }
  // after the panel is painted: put the map in the box at this view. The same view again (a re-render with other HTML) keeps
  // the map exactly as it was, panned or not (live before attach: attach measures, and a measured opacity 0 would fade in);
  // a new view stays hidden until it has drawn, then fades in
  function mount(el, v) {
    if (!el) return;
    const prev = cur, t0 = performance.now(); cur = Object.assign({ el }, v);
    if (dead) { fallback(el, v); return; }
    if (map && shown === v.key && prev && prev.key === v.key && !pending) { el.classList.add('live'); attach(el); setData(v); placePin(); map.triggerRepaint(); report(v.key, t0); return; }
    if (pending) { clearTimeout(pending.timer); pending = null; }
    shown = null;
    const p = pending = { el, v, t0 };
    arm(p, LIB_WAIT); // the library and the TileJSON on a slow line; the 6 s for the map itself start in show()
    if (map) { show(p); return; }
    Promise.all([loadLib(), source()]).then(([gl, s]) => {
      if (pending !== p) return;
      omt = s;
      try { if (!map) create(gl, el, v); } catch (e) { dead = true; console.warn('street map: no WebGL, using the Google embed', e); fallback(el, v); return; }
      show(p);
    }, () => { if (pending === p) fallback(el, v); });
  }
  // the theme changed: the same map, new colours (a diff of the style, so no tile reloads)
  function restyle() { if (map && omt) map.setStyle(style(), { diff: true }); }

  const api = window.StreetMap = { box, mount, restyle, preload, idle, last: null, get map() { return map; } };
})();
