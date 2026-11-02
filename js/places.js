// Place search for logging spots: Photon (OpenStreetMap data, komoot's free geocoder), limited to the map's
// bounding box. Falls back silently when the network is blocked; the app then offers "drop a pin" instead.
(function () {
  const G = window.GEO, [LON0, LAT0, LON1, LAT1] = G.bbox;
  const KIND_BY_OSM = {
    restaurant: 'food', fast_food: 'food', food_court: 'food', bakery: 'food', ice_cream: 'food', deli: 'food', butcher: 'food', greengrocer: 'food', supermarket: 'food', marketplace: 'food',
    bar: 'drink', pub: 'drink', biergarten: 'drink', nightclub: 'drink', wine: 'drink', alcohol: 'drink', brewery: 'drink',
    cafe: 'coffee', coffee: 'coffee', tea: 'coffee',
    viewpoint: 'view', attraction: 'view', monument: 'view', museum: 'view', artwork: 'view', gallery: 'view', theatre: 'view', cinema: 'view', beach: 'view', lighthouse: 'view',
    park: 'park', garden: 'park', nature_reserve: 'park', playground: 'park', dog_park: 'park', wood: 'park', peak: 'park', trailhead: 'park',
    books: 'shop', clothes: 'shop', gift: 'shop', mall: 'shop', department_store: 'shop', boutique: 'shop', second_hand: 'shop', music: 'shop', florist: 'shop', hardware: 'shop', convenience: 'shop',
  };
  let ctrl = null;
  // Fallback for when Photon is unreachable: Nominatim, whose usage policy rules out per-keystroke
  // autocomplete, so it is only called for an explicit search (Enter), never while typing.
  async function nominatim(q, signal) {
    const u = new URL('https://nominatim.openstreetmap.org/search');
    u.searchParams.set('q', q.trim()); u.searchParams.set('format', 'jsonv2'); u.searchParams.set('limit', '8'); u.searchParams.set('addressdetails', '1');
    u.searchParams.set('viewbox', `${LON0},${LAT1},${LON1},${LAT0}`); u.searchParams.set('bounded', '1');
    const res = await fetch(u, { signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('search failed ' + res.status);
    const data = await res.json();
    return (data || []).map(r => {
      const lon = +r.lon, lat = +r.lat, a = r.address || {}; if (!(lon >= LON0 && lon <= LON1 && lat >= LAT0 && lat <= LAT1)) return null;
      const name = r.name || (r.display_name || '').split(',')[0]; if (!name) return null;
      const where = [[a.house_number, a.road].filter(Boolean).join(' '), a.neighbourhood || a.suburb, a.city || a.town || a.village].filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).join(' · ');
      const kind = KIND_BY_OSM[r.type] || (r.category === 'shop' ? 'shop' : r.category === 'leisure' ? 'park' : r.category === 'tourism' ? 'view' : null);
      return { name, where, lon, lat, kind, osm: (r.type || '').replace(/_/g, ' ') };
    }).filter(Boolean);
  }
  async function search(q, bias, opts = {}) {
    if (!q || q.trim().length < 2) return [];
    if (ctrl) ctrl.abort(); ctrl = new AbortController();
    if (opts.explicit && search.photonDown) return nominatim(q, ctrl.signal);
    try { return await photon(q, bias, ctrl.signal); }
    catch (e) { if (e.name === 'AbortError') throw e; search.photonDown = true; if (opts.explicit) return nominatim(q, ctrl.signal); throw e; }
  }
  async function photon(q, bias, signal) {
    // a hung connection should not hold up the fallback: give Photon four seconds
    if (typeof AbortSignal !== 'undefined' && AbortSignal.any && AbortSignal.timeout) signal = AbortSignal.any([signal, AbortSignal.timeout(4000)]);
    const u = new URL('https://photon.komoot.io/api/');
    u.searchParams.set('q', q.trim()); u.searchParams.set('limit', '8'); u.searchParams.set('lang', 'en');
    u.searchParams.set('bbox', `${LON0},${LAT0},${LON1},${LAT1}`);
    if (bias) { u.searchParams.set('lon', bias[0].toFixed(5)); u.searchParams.set('lat', bias[1].toFixed(5)); u.searchParams.set('location_bias_scale', '0.4'); u.searchParams.set('zoom', '14'); }
    const res = await fetch(u, { signal });
    if (!res.ok) throw new Error('search failed ' + res.status);
    const data = await res.json();
    return (data.features || []).map(f => {
      const p = f.properties || {}, [lon, lat] = f.geometry.coordinates;
      if (lon < LON0 || lon > LON1 || lat < LAT0 || lat > LAT1) return null;
      const name = p.name || [p.housenumber, p.street].filter(Boolean).join(' ') || p.city; if (!name) return null;
      const where = [p.street && !p.name ? null : (p.housenumber ? p.housenumber + ' ' + (p.street || '') : p.street), p.district || p.locality, p.city].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' · ');
      const osm = p.osm_value || p.osm_key, kind = KIND_BY_OSM[osm] || (p.osm_key === 'shop' ? 'shop' : p.osm_key === 'leisure' ? 'park' : p.osm_key === 'tourism' ? 'view' : null);
      return { name, where, lon, lat, kind, osm: (p.osm_value || '').replace(/_/g, ' ') };
    }).filter(Boolean);
  }
  window.Places = { search };
})();
