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
  let map = null, host = null, pending = null, shown = null, cur = null, omt = null, data = { sec: fc([]), dots: fc([]), me: fc([]), edge: fc([]) }, dataKey = '', errs = 0;
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
  // preload: the library, the TileJSON and the Latin glyphs (cached a week by the tile host), so a first panel only waits for tiles.
  // Place names bring two more ranges for the regular face: Latin Extended (256-511) and typographic punctuation (8192-8447:
  // curly apostrophes, dashes), so those come now too rather than after the tiles
  function preload() {
    if (dead) return;
    loadLib(); source();
    const g = (f, r) => fetch(GLYPHS.replace('{fontstack}', encodeURIComponent(f.join(','))).replace('{range}', r)).catch(() => {});
    g(FONT, '0-255'); g(FONT_I, '0-255'); g(FONT, '256-511'); g(FONT, '8192-8447');
  }
  // after boot, once the page has loaded and the browser has nothing better to do
  function idle() {
    if (dead) return;
    const go = () => (window.requestIdleCallback || (f => setTimeout(f, 300)))(preload, { timeout: 3000 });
    if (document.readyState === 'complete') go(); else window.addEventListener('load', go, { once: true });
  }

  // ---------- style: every colour from the CSS tokens, so it follows the theme ----------
  const hex = c => { c = String(c).trim(); const m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(c); if (m) return m.slice(1, 4).map(v => Math.min(255, +v)); c = c.replace('#', ''); if (c.length === 3) c = c.replace(/./g, x => x + x); return [0, 2, 4].map(i => parseInt(c.slice(i, i + 2), 16) || 0); };
  const mix = (a, b, t) => { const A = hex(a), B = hex(b); return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join(''); };
  const lum = c => { const [r, g, b] = hex(c); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
  // WCAG contrast, and the smallest step of a colour towards `to` that reads at 4.5:1 (with a little margin) on every ground
  const lin = v => (v /= 255) <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4;
  const rl = c => { const [r, g, b] = hex(c).map(lin); return .2126 * r + .7152 * g + .0722 * b; };
  const ratio = (a, b) => { const A = rl(a), B = rl(b); return (Math.max(A, B) + .05) / (Math.min(A, B) + .05); };
  const legible = (c, on, to, min = 4.6) => { for (let i = 0; i <= 20; i++) { const m = mix(c, to, i / 20); if (on.every(g => ratio(m, g) >= min)) return m; } return to; };
  function palette() {
    // every colour as lowercase #rrggbb (the image ids carry them), whatever way the token is written; an unreadable one is grey
    const cs = getComputedStyle(document.documentElement), t = n => { const c = cs.getPropertyValue('--' + n).trim(); return /^(#([0-9a-f]{3}){1,2}|rgba?\(\s*\d+[\s,]+\d+[\s,]+\d+.*\))$/i.test(c) ? mix(c, c, 0) : '#888888'; };
    const land = t('land'), dark = lum(land) < 0.4, ink = t('ink'), ink2 = t('ink-2'), muted = t('muted'), paper = t('paper');
    const K = {}; for (const k of ['food', 'drink', 'coffee', 'view', 'shop', 'park', 'other']) K[k] = t('k-' + k);
    // dark: the streets are lighter than the blocks (as the light theme's paper streets are), the buildings sit a step above
    // the land, the water is the coast's blue rather than near black
    const water = dark ? mix(t('water'), t('coast'), .34) : t('water');
    const park = mix(land, K.park, dark ? .2 : .3), bld = dark ? mix(land, ink2, .07) : mix(land, t('line-2'), .55);
    const minor = dark ? mix(land, ink2, .19) : mix(paper, land, .15), major = dark ? mix(land, ink2, .3) : paper;
    const on = [land, bld, park], say = (c, min) => legible(c, on, ink, min); // every label is checked against the grounds it sits on
    const transit = mix(t('want'), ink2, .25);
    return {
      dark, land, K, paper, accent: t('accent'), transit,
      water, wlbl: legible(t('wlbl'), [water], ink, 3.2),
      park, wood: mix(land, K.park, dark ? .15 : .24), sand: mix(land, t('v-sun'), .14),
      bld, bldLine: dark ? mix(land, ink2, .13) : mix(land, t('line-2'), 1),
      minor, major, casing: dark ? mix(land, t('water'), .45) : mix(land, t('line-2'), .9), path: dark ? mix(land, ink2, .26) : mix(land, muted, .32),
      rail: dark ? mix(land, ink2, .32) : mix(land, muted, .38), arrow: dark ? mix(major, land, .62) : mix(paper, muted, .45),
      text: say(ink2), text3: say(mix(ink2, muted, .55)), text2: say(muted), halo: land,
      poi: Object.fromEntries(Object.entries(K).map(([k, c]) => [k, say(c)])), transitText: say(transit), hn: say(mix(muted, land, .25), 3),
    };
  }
  // nearby places from the tiles' poi layer: which ones, in which colour, and how notable (lower first). Only what a visitor
  // would steer by: transit, sights, parks, food and drink, hotels, civic buildings and libraries, a few kinds of shop. Banks,
  // salons, schools and the like stay off
  const SHOPS = ['bakery', 'books', 'chocolate', 'confectionery', 'deli', 'department_store', 'gift', 'mall', 'marketplace', 'supermarket', 'wine', 'music', 'outdoor'];
  const get = k => ['get', k], is = (...c) => ['match', get('class'), c, true, false];
  const CAT = ['match', get('class'),
    'railway', ['match', get('subclass'), ['station', 'subway', 'halt', 'light_rail'], 'transit', ''], 'ferry_terminal', 'transit',
    ['museum', 'attraction', 'theatre', 'cinema', 'music', 'castle', 'monument', 'stadium', 'zoo', 'aquarium'], 'view', 'art_gallery', ['match', get('subclass'), ['artwork'], '', 'view'],
    'park', 'park', ['restaurant', 'ice_cream'], 'food', 'fast_food', 'fast', ['bar', 'beer'], 'drink', 'cafe', 'coffee', ['lodging', 'town_hall'], 'other',
    ['grocery', 'shop', 'library'], ['match', get('subclass'), SHOPS, 'shop', 'library', 'other', ''], ''];
  const WEIGHT = { transit: 0, view: 1, park: 2, food: 3, drink: 3, coffee: 3, other: 4, fast: 5, shop: 5 };
  // a fitted section (zoom under 15) shows only stations, sights and parks; a spot adds food, drink, hotels and shops.
  // Collision and the sort key keep the handful that fit; the most notable (by kind, then the tiles' rank) win. Streetcar
  // and bus stops stay off: their names are only cross streets
  const poiFilter = transit => ['all', ['has', 'name'], transit ? ['==', CAT, 'transit'] : ['step', ['zoom'], ['match', CAT, ['view', 'park'], true, false], 15, ['match', CAT, ['', 'transit'], false, true]]];
  // the spot's own entry in the tiles (the same name, or its first significant word, within 150 m): the pin already names it,
  // so an invisible blocker goes on it (a blocker, not a filter: a filter per spot would lay every tile out again)
  const STOP = new Set(['the', 'cafe', 'café', 'bar', 'and', 'restaurant', 'coffee', 'bench', 'picnic', 'spot', 'park', 'ferry', 'building', 'market', 'plaza', 'street', 'hill', 'mission', 'north', 'south', 'east', 'west', 'city']);
  // the same place by name: equal, or one name inside the other when the shorter has 4 characters or more ("Pier 76 Lookout"
  // is not the "76" station), or the place's name holds the spot's first significant word w
  const twin = (n, m, w) => n === m || (Math.min(n.length, m.length) >= 4 && (n.includes(m) || m.includes(n))) || !!(w && m.includes(w));
  function twins(v) {
    const n = String(v.name || '').toLowerCase(), w = (n.match(/[\p{L}\p{N}']{4,}/gu) || []).find(x => !STOP.has(x)), k = Math.cos(v.lat * Math.PI / 180), seen = new Set(), out = [];
    if (!n) return out;
    for (const f of map.querySourceFeatures('omt', { sourceLayer: 'poi' })) {
      const m = String(f.properties.name || '').toLowerCase(), c = f.geometry && f.geometry.coordinates; if (!m || !c || f.geometry.type !== 'Point') continue;
      if (Math.hypot((c[0] - v.lon) * k, c[1] - v.lat) * 111320 > 150 || !twin(n, m, w)) continue;
      const key = c[0].toFixed(6) + ',' + c[1].toFixed(6); if (!seen.has(key)) { seen.add(key); out.push(c); }
    }
    return out;
  }
  // street names the way a map prints them: Mission St, Bernal Heights Blvd
  const ABBR = [['Street', 'St'], ['Avenue', 'Ave'], ['Boulevard', 'Blvd'], ['Road', 'Rd'], ['Drive', 'Dr'], ['Place', 'Pl'], ['Lane', 'Ln'], ['Court', 'Ct'], ['Terrace', 'Ter'], ['Highway', 'Hwy'], ['Parkway', 'Pkwy'], ['Alley', 'Aly']];
  const short = n => ['let', 'n', n, ['case', ...ABBR.flatMap(([a, b]) => { const len = ['length', ['var', 'n']], cut = ['-', len, a.length + 1]; return [['all', ['>', cut, 0], ['==', ['slice', ['var', 'n'], cut], ' ' + a]], ['concat', ['slice', ['var', 'n'], 0, cut], ' ' + b]]; }), ['var', 'n']]];
  function style() {
    const C = palette();
    const name = ['coalesce', get('name:en'), get('name')], notTunnel = ['!=', get('brunnel'), 'tunnel'];
    const roads = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service'];
    // one zoom interpolate per expression: the per-class widths sit inside its stops
    const width = (svc, minor, mid, major) => ['interpolate', ['exponential', 1.6], ['zoom'], ...[13, 15, 17, 19].flatMap((z, i) => [z, ['match', get('class'), ['service'], svc[i], ['minor'], minor[i], ['tertiary'], mid[i], major[i]]])];
    const h = c => c.slice(1), ring = h(C.halo);
    const spot = ['match', get('k'), ...Object.entries(C.K).flatMap(([k, c]) => [k, `smap-spot-${h(c)}-${h(C.paper)}`]), `smap-spot-${h(C.K.other)}-${h(C.paper)}`];
    const cat = CAT, poiKind = k => k === 'fast' ? 'food' : k === 'transit' ? null : k; // fast food wears the food colour
    const icon = ['match', cat, 'transit', `smap-sq-${h(C.transit)}-${ring}`, ...Object.keys(WEIGHT).filter(poiKind).flatMap(k => [k, `smap-dot-${h(C.K[poiKind(k)])}-${ring}`]), ''];
    const tint = ['match', cat, 'transit', C.transitText, ...Object.keys(WEIGHT).filter(poiKind).flatMap(k => [k, C.poi[poiKind(k)]]), C.text];
    const weight = ['match', cat, ...Object.entries(WEIGHT).flatMap(x => x), 9];
    const label = ['coalesce', get('name:en'), get('name'), ''];
    const out = {
      version: 8, glyphs: GLYPHS,
      sources: { omt, sec: { type: 'geojson', data: data.sec }, dots: { type: 'geojson', data: data.dots }, me: { type: 'geojson', data: data.me }, edge: { type: 'geojson', data: data.edge } },
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
        { id: 'rail', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['all', is('rail', 'transit'), notTunnel], paint: { 'line-color': C.rail, 'line-width': ['interpolate', ['linear'], ['zoom'], 13, .6, 18, 1.4] } },
        { id: 'tunnel', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['all', ['match', get('class'), roads, true, false], ['==', get('brunnel'), 'tunnel']], layout: { 'line-join': 'round' }, paint: { 'line-color': C.casing, 'line-opacity': .6, 'line-width': width([.5, 1, 3, 8], [1, 3, 7, 18], [1.5, 4, 9, 22], [2, 5, 11, 26]), 'line-dasharray': [1.5, 1] } },
        { id: 'case', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['all', ['match', get('class'), roads, true, false], notTunnel], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': C.casing, 'line-width': width([0, 2.6, 6, 14], [.9, 5.2, 12.5, 30], [2.6, 7.5, 16, 38], [3.6, 9.5, 19, 44]) } },
        { id: 'road', type: 'line', source: 'omt', 'source-layer': 'transportation', filter: ['all', ['match', get('class'), roads, true, false], notTunnel], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['match', get('class'), ['minor', 'service'], C.minor, C.major], 'line-width': width([0, 1.4, 4.4, 12], [.5, 3.6, 10.5, 27], [1.7, 5.8, 14, 35], [2.6, 7.6, 17, 41]) } },
        { id: 'sec-fill', type: 'fill', source: 'sec', paint: { 'fill-color': C.accent, 'fill-opacity': C.dark ? .08 : .07 } },
        { id: 'sec-line', type: 'line', source: 'sec', layout: { 'line-join': 'round' }, paint: { 'line-color': C.accent, 'line-opacity': .55, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1.2, 16, 1.8] } },
        // one-way streets: a small arrow along the street, only where no label wants the room
        { id: 'oneway', type: 'symbol', source: 'omt', 'source-layer': 'transportation', minzoom: 16, filter: ['all', ['match', get('class'), ['primary', 'secondary', 'tertiary', 'minor'], true, false], ['match', get('oneway'), [1, -1], true, false], notTunnel], layout: { 'symbol-placement': 'line', 'symbol-spacing': 110, 'icon-image': `smap-arrow-${h(C.arrow)}`, 'icon-rotate': ['match', get('oneway'), -1, 180, 0], 'icon-rotation-alignment': 'map', 'icon-ignore-placement': true, 'icon-padding': 2 } },
        { id: 'hn', type: 'symbol', source: 'omt', 'source-layer': 'housenumber', minzoom: 17.5, layout: { 'text-field': get('housenumber'), 'text-font': FONT, 'text-size': 9.5, 'text-padding': 2 }, paint: { 'text-color': C.hn, 'text-halo-color': C.bld, 'text-halo-width': 1 } },
        { id: 'water-lbl', type: 'symbol', source: 'omt', 'source-layer': 'water_name', layout: { 'text-field': name, 'text-font': FONT_I, 'text-size': 12, 'text-letter-spacing': .06, 'text-max-width': 8 }, paint: { 'text-color': C.wlbl, 'text-halo-color': C.water, 'text-halo-width': 1 } },
        { id: 'peak', type: 'symbol', source: 'omt', 'source-layer': 'mountain_peak', filter: ['has', 'name'], layout: { 'icon-image': `smap-peak-${h(C.text2)}-${ring}`, 'text-field': get('name'), 'text-font': FONT_I, 'text-size': 11, 'text-variable-anchor-offset': ['top', [0, .7], 'left', [1, 0], 'right', [-1, 0], 'bottom', [0, -.9]], 'text-max-width': 7, 'text-padding': 6, 'icon-optional': true }, paint: { 'text-color': C.text2, 'text-halo-color': C.halo, 'text-halo-width': 1.4 } },
        { id: 'poi', type: 'symbol', source: 'omt', 'source-layer': 'poi', minzoom: 13, filter: poiFilter(false), layout: { 'symbol-sort-key': ['+', ['*', weight, 100], ['min', ['coalesce', get('rank'), 99], 99]], 'icon-image': icon, 'text-field': label, 'text-font': FONT, 'text-size': ['interpolate', ['linear'], ['zoom'], 15, 10.5, 18, 12], 'text-max-width': 7, 'text-line-height': 1.1, 'text-variable-anchor': ['left', 'right'], 'text-radial-offset': .75, 'text-justify': 'auto', 'text-padding': 10, 'icon-padding': 4 }, paint: { 'text-color': tint, 'text-halo-color': C.halo, 'text-halo-width': 1.4 } },
        { id: 'road-lbl', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 12, filter: ['match', get('class'), roads, true, false], layout: { 'symbol-placement': 'line', 'text-field': short(name), 'text-font': FONT, 'text-size': ['interpolate', ['linear'], ['zoom'], 12, 10, 14, ['match', get('class'), ['minor', 'service'], 10, 11], 16, ['match', get('class'), ['minor', 'service'], 11.5, 12.5], 18, ['match', get('class'), ['minor', 'service'], 13, 14]], 'text-letter-spacing': .02, 'symbol-spacing': 110, 'text-padding': 4 }, paint: { 'text-color': ['match', get('class'), ['minor', 'service'], C.text3, C.text], 'text-halo-color': C.halo, 'text-halo-width': 1.6 } },
        // stations and ferry terminals, placed before the street names: the one nearby place a visitor can always steer by
        { id: 'transit', type: 'symbol', source: 'omt', 'source-layer': 'poi', minzoom: 13, filter: poiFilter(true), layout: { 'symbol-sort-key': ['min', ['coalesce', get('rank'), 99], 99], 'icon-image': icon, 'text-field': label, 'text-font': FONT, 'text-size': ['interpolate', ['linear'], ['zoom'], 15, 10.5, 18, 12], 'text-max-width': 7, 'text-line-height': 1.1, 'text-variable-anchor-offset': ['left', [1.1, 0], 'right', [-1.1, 0], 'top', [0, 1.6], 'bottom', [0, -1.1]], 'text-justify': 'auto', 'text-padding': 6, 'icon-padding': 3, 'icon-optional': true }, paint: { 'text-color': tint, 'text-halo-color': C.halo, 'text-halo-width': 1.4 } },
        { id: 'place-lbl', type: 'symbol', source: 'omt', 'source-layer': 'place', filter: is('neighbourhood', 'quarter', 'suburb', 'village', 'town', 'hamlet'), layout: { 'text-field': name, 'text-font': FONT, 'text-size': 11, 'text-transform': 'uppercase', 'text-letter-spacing': .12, 'text-max-width': 7, 'text-padding': 8, 'text-variable-anchor': ['center', 'top', 'bottom', 'left', 'right'], 'text-radial-offset': 1.2 }, paint: { 'text-color': C.text2, 'text-halo-color': C.halo, 'text-halo-width': 1.4 } },
        // the box's edges: placed before the labels below, so none of them is drawn cut off by the edge or under the credits
        { id: 'edge', type: 'symbol', source: 'edge', layout: { 'symbol-placement': 'line', 'symbol-spacing': 5, 'icon-image': 'smap-void-e', 'icon-allow-overlap': true }, paint: { 'icon-opacity': 0 } },
        // the other logged spots: drawn as images so the map's labels keep clear of them
        { id: 'dots', type: 'symbol', source: 'dots', layout: { 'icon-image': spot, 'icon-allow-overlap': true, 'icon-padding': 1 } },
        // the pin and its name are HTML (the pin in the spot's colour, the name in the app's type); this invisible copy of
        // them, placed first, keeps the map's own labels out of their way
        { id: 'me', type: 'symbol', source: 'me', layout: { 'icon-image': ['case', ['has', 'b'], 'smap-void-e', 'smap-void'], 'icon-anchor': ['case', ['has', 'b'], 'center', 'bottom'], 'icon-allow-overlap': true, 'text-allow-overlap': true, 'text-field': ['coalesce', get('name'), ''], 'text-font': FONT, 'text-size': 13, 'text-line-height': 1.15, 'text-max-width': 9.5, 'text-anchor': ['match', get('side'), 'l', 'right', 'left'], 'text-offset': ['match', get('side'), 'l', ['literal', [-1.6, -1.7]], ['literal', [1.6, -1.7]]], 'text-padding': 3 }, paint: { 'icon-opacity': 0, 'text-opacity': 0 } },
      ],
    };
    imgs = [...new Set(JSON.stringify(out.layers).match(/smap-(?:void-e|void|dot|spot|sq|arrow|peak)(?:-[0-9a-f]{6}){0,2}/g))];
    return out;
  }
  // the few small images the style uses, drawn here (no sprite to fetch). The colours are in the name, so a theme brings its own
  // set; all of them are added with the style, before any tile asks (an image added while a tile is being laid out makes
  // MapLibre lay that tile out again: a third of a second on Fast 4G)
  let imgs = [];
  const images = () => { for (const id of imgs) try { image(id); } catch (e) {} };
  function image(id) {
    const m = /^smap-(void|void-e|dot|spot|sq|arrow|peak)(?:-([0-9a-f]{6}))?(?:-([0-9a-f]{6}))?$/.exec(id); if (!m || map.hasImage(id)) return;
    const [, k, a, b] = m, fg = '#' + a, bg = '#' + b, r = Math.min(3, Math.max(1, Math.round(window.devicePixelRatio || 1)));
    const [w, hh] = { void: [40, 44], 'void-e': [5, 5], dot: [11, 11], spot: [14, 14], sq: [13, 13], arrow: [10, 8], peak: [10, 8] }[k];
    const cv = document.createElement('canvas'); cv.width = w * r; cv.height = hh * r; const x = cv.getContext('2d'); x.scale(r, r);
    const rr = (x0, y0, ww, h0, q) => { x.beginPath(); x.roundRect ? x.roundRect(x0, y0, ww, h0, q) : x.rect(x0, y0, ww, h0); };
    if (k === 'spot') { x.fillStyle = bg; x.beginPath(); x.arc(7, 7, 6.8, 0, 7); x.fill(); x.fillStyle = fg; x.beginPath(); x.arc(7, 7, 5, 0, 7); x.fill(); }
    if (k === 'dot') { x.fillStyle = bg; x.beginPath(); x.arc(5.5, 5.5, 5.5, 0, 7); x.fill(); x.fillStyle = fg; x.beginPath(); x.arc(5.5, 5.5, 3.9, 0, 7); x.fill(); }
    if (k === 'sq') { x.fillStyle = bg; rr(0, 0, 13, 13, 4); x.fill(); x.fillStyle = fg; rr(1.4, 1.4, 10.2, 10.2, 3); x.fill(); x.fillStyle = bg; rr(4.3, 3.4, 4.4, 4.6, 1.2); x.fill(); x.fillRect(4.3, 8.6, 1.3, 1.3); x.fillRect(7.4, 8.6, 1.3, 1.3); } // a tram's face
    if (k === 'arrow') { x.fillStyle = fg; x.beginPath(); x.moveTo(10, 4); x.lineTo(5, .5); x.lineTo(5, 3); x.lineTo(0, 3); x.lineTo(0, 5); x.lineTo(5, 5); x.lineTo(5, 7.5); x.closePath(); x.fill(); }
    if (k === 'peak') { x.fillStyle = fg; x.beginPath(); x.moveTo(5, .5); x.lineTo(9.5, 7.5); x.lineTo(.5, 7.5); x.closePath(); x.fill(); }
    map.addImage(id, x.getImageData(0, 0, cv.width, cv.height), { pixelRatio: r });
  }

  // ---------- the box ----------
  const ATTR = '<span class="smap-attr">© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a></span>';
  // v: { key, name, href (where a tap goes on the phone), q and z (the Google fallback), and either lat, lon, zoom and pin
  // { c, e } (a spot) or rings [[[lon, lat], ...], ...] and seed [lon, lat] (a section); dots: [[lon, lat, kind], ...] }
  // the name beside the pin shows two lines at most: the HTML takes a bounded slice (the line clamp still ends it with an
  // ellipsis), the invisible copy that reserves its room about what two lines hold
  const cut = (s, n) => [...String(s || '')].slice(0, n).join('');
  function box(v) {
    const pin = v.pin ? `<span class="smap-pin" style="--c:${esc(v.pin.c)}" aria-hidden="true"><i><b>${esc(v.pin.e)}</b></i><span class="smap-name">${esc(cut(v.name, 64))}</span></span>` : '';
    return `<div class="mapprev" data-key="${esc(v.key)}"><a class="smap-link" href="${esc(v.href)}" target="_blank" rel="noopener" aria-label="Open ${esc(v.name)} in Maps"></a>${pin}${ATTR}</div>`;
  }
  // Google's keyless embed. Its referrer is the origin only: the page URL carries the private ?log= key
  function fallback(el, v) {
    if (pending && pending.el === el) { clearTimeout(pending.timer); pending = null; }
    if (host && host.parentNode === el) host.remove();
    el.classList.remove('live'); el.classList.add('fb');
    if (!el.querySelector('iframe')) el.insertAdjacentHTML('afterbegin', `<iframe src="${esc(`https://www.google.com/maps?q=${encodeURIComponent(v.q)}&z=${v.z}&output=embed`)}" loading="lazy" title="Street map of ${esc(v.name)}" referrerpolicy="origin"></iframe>`);
  }
  function attach(el) { if (host.parentNode !== el) el.insertBefore(host, el.firstChild); measure(); map.resize(); }
  // the name's width and the box's, read once per mount and on resize (not on every frame of a pan)
  function measure() { if (!cur) return; const nm = cur.el.querySelector('.smap-name'); cur.nw = nm ? nm.offsetWidth : 0; cur.bw = cur.el.clientWidth; }
  // the pin follows the map; its name sits to the right of it, or to the left when the right would run out of the box
  function placePin() {
    if (!cur || !cur.pin || !map) return; const pin = cur.el.querySelector('.smap-pin'); if (!pin) return;
    const p = map.project([cur.lon, cur.lat]); pin.style.left = p.x.toFixed(1) + 'px'; pin.style.top = p.y.toFixed(1) + 'px';
    if (!cur.nw) return;
    const w = cur.nw, W = cur.bw, side = p.x + 21 + w <= W - 6 || p.x - 21 - w < 6 ? 'r' : 'l';
    pin.classList.toggle('l', side === 'l');
    if (side !== cur.side) { cur.side = side; setMe(); }
  }
  // the box's edges and the credit pill, as lines of invisible images: no label is drawn cut off by the edge or under the credits
  function setEdge() {
    if (!map || !cur || !map.getSource('edge')) return;
    const el = cur.el, W = el.clientWidth, H = el.clientHeight, u = (x, y) => { const l = map.unproject([x, y]); return [l.lng, l.lat]; };
    const lines = [[u(1, 1), u(W - 1, 1), u(W - 1, H - 1), u(1, H - 1), u(1, 1)]], a = el.querySelector('.smap-attr');
    if (a && a.offsetWidth) { const e = el.getBoundingClientRect(), b = a.getBoundingClientRect(), x0 = b.left - e.left - 2, x1 = b.right - e.left; for (let y = b.top - e.top - 2; y < b.bottom - e.top + 4; y += 5) lines.push([u(x0, y), u(x1, y)]); }
    put('edge', fc(lines.map(c => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: c } }))));
  }
  // a GeoJSON source gets new data only when it changed (each update is a trip through a worker and a new placement)
  const sent = {};
  function put(id, d) { data[id] = d; const j = JSON.stringify(d); if (sent[id] === j || !map || !map.getSource(id)) return; sent[id] = j; map.getSource(id).setData(d); }
  function setMe() {
    const v = cur, pt = c => ({ type: 'Point', coordinates: c });
    put('me', v && v.pin ? fc([{ type: 'Feature', properties: { name: cut(v.name, 32), side: v.side || 'r' }, geometry: pt([v.lon, v.lat]) }, ...(v.twins || []).map(c => ({ type: 'Feature', properties: { b: 1 }, geometry: pt(c) }))]) : fc([]));
  }
  function setData(v) {
    const sec = v.rings && v.rings.length ? fc([{ type: 'Feature', properties: {}, geometry: { type: 'MultiPolygon', coordinates: v.rings.map(r => [r.concat([r[0]])]) } }]) : fc([]);
    const dots = fc((v.dots || []).map(d => ({ type: 'Feature', properties: { k: d[2] }, geometry: { type: 'Point', coordinates: [d[0], d[1]] } })));
    const k = JSON.stringify([sec, dots]); if (k === dataKey) return; dataKey = k; data.sec = sec; data.dots = dots;
    if (map && map.getSource('sec')) { map.getSource('sec').setData(sec); map.getSource('dots').setData(dots); }
  }
  function camera(v) {
    if (!v.rings || !v.rings.length) return { center: v.seed || [v.lon, v.lat], zoom: (v.zoom || 15) - (v.pin ? .5 : 0) }; // a spot: its block and the blocks around it
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
    map.on('move', placePin); map.on('resize', () => { measure(); placePin(); });
    map.on('style.load', () => { images(); if (map.getSource('sec')) { for (const k in sent) delete sent[k]; map.getSource('sec').setData(data.sec); map.getSource('dots').setData(data.dots); put('me', data.me); setEdge(); } });
    map.on('moveend', setEdge); map.on('resize', setEdge);
    map.on('styleimagemissing', e => { try { image(e.id); } catch (err) {} });
    // before anything has ever drawn, a run of tile errors means the tiles are not reachable: the embed, now, not in 6 s.
    // One failed tile or glyph range is not that (and may belong to the view before this one), so it takes three
    map.on('error', e => { console.warn('street map:', e && e.error ? e.error.message || e.error : e); if (!drawn && pending && ++errs >= 3) { const p = pending; src = null; fallback(p.el, p.v); } });
  }
  const streets = () => new Set(map.queryRenderedFeatures({ layers: ['road-lbl'] }).map(f => f.properties['name:en'] || f.properties.name)).size;
  // for tests and timing: how long a view took from mount to drawn
  function report(key, t0) { api.last = { key, ms: Math.round(performance.now() - t0) }; window.dispatchEvent(new CustomEvent('streetmap:drawn', { detail: api.last })); }
  function arm(p, ms) { clearTimeout(p.timer); p.timer = setTimeout(() => { if (pending === p) { console.warn(`street map: nothing drawn in ${ms / 1000} s, using the Google embed`); if (!map) src = null; fallback(p.el, p.v); } }, ms); } // !map: a TileJSON read that hangs is asked for again by the next panel
  const gone = p => { if (p.el.isConnected) return false; if (pending === p) { clearTimeout(p.timer); pending = null; } return true; }; // the panel moved on while this view loaded: nothing is drawn or marked as shown
  function show(p) {
    const { el, v } = p; if (gone(p)) return;
    arm(p, WAIT); errs = 0;
    attach(el); el.classList.remove('live', 'fb');
    setData(v); setMe(); map.jumpTo(camera(v)); placePin(); setEdge();
    let wider = 0, looked = false;
    // the blocker: one pass over the tiles' places when the view's tiles are all in (before the first idle, so no extra wait)
    const look = e => { if (looked || !v.pin || pending !== p || !(e.sourceId === 'omt' && e.tile && e.isSourceLoaded)) return; looked = true; const t = twins(v); if (t.length) { cur.twins = t; setMe(); } };
    map.on('data', look);
    const done = () => {
      if (pending !== p || gone(p)) { map.off('idle', done); map.off('data', look); return; }
      // a spot should show at least two named streets: where the streets are sparse (a park, a hillside), step out half a
      // zoom, twice at most, before it is shown (the tiles are the same zoom 14 ones, overzoomed, so this is rarely a fetch).
      // Each extra wait for idle (a step-out, the blocker) gets its own 6 s, so a slow map that works is not given up on
      if (v.pin && wider < 2 && streets() < 2) { wider++; arm(p, WAIT); map.jumpTo({ zoom: map.getZoom() - .5 }); placePin(); setEdge(); map.triggerRepaint(); return; }
      if (v.pin && !looked) { looked = true; const t = twins(v); if (t.length) { arm(p, WAIT); cur.twins = t; setMe(); map.triggerRepaint(); return; } }
      map.off('idle', done); map.off('data', look); clearTimeout(p.timer); pending = null; drawn = true; shown = v.key;
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
    const c = v.seed || [v.lon, v.lat]; // MapLibre throws on a centre that is not a coordinate
    if (dead || !(isFinite(c[0]) && isFinite(c[1]) && Math.abs(c[1]) <= 90)) { fallback(el, v); return; }
    // (the side and the blocker are carried over before attach, whose resize places the pin; the key does not hold the name, so
    // a renamed spot drops the old name's blocker)
    if (map && shown === v.key && prev && prev.key === v.key && !pending) { cur.side = prev.side; if (prev.name === v.name) cur.twins = prev.twins; el.classList.add('live'); attach(el); setData(v); setMe(); placePin(); map.triggerRepaint(); report(v.key, t0); return; }
    if (pending) { clearTimeout(pending.timer); pending = null; }
    shown = null;
    const p = pending = { el, v, t0 };
    arm(p, LIB_WAIT); // the library and the TileJSON on a slow line; the 6 s for the map itself start in show()
    const go = () => { try { show(p); } catch (e) { console.warn('street map: this view failed, using the Google embed', e); fallback(el, v); } };
    if (map) { go(); return; }
    Promise.all([loadLib(), source()]).then(([gl, s]) => {
      if (pending !== p || gone(p)) return;
      omt = s;
      try { if (!map) create(gl, el, v); } catch (e) { dead = true; console.warn('street map: no WebGL, using the Google embed', e); fallback(el, v); return; }
      go();
    }, () => { if (pending === p) fallback(el, v); });
  }
  // the theme changed: the same map, new colours (a diff of the style, so no tile reloads)
  function restyle() { if (map && omt) { map.setStyle(style(), { diff: true }); images(); } }

  const api = window.StreetMap = { box, mount, restyle, preload, idle, last: null, get map() { return map; } };
})();
