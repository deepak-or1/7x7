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
  async function search(q, bias) {
    if (!q || q.trim().length < 2) return [];
    if (ctrl) ctrl.abort(); ctrl = new AbortController();
    const u = new URL('https://photon.komoot.io/api/');
    u.searchParams.set('q', q.trim()); u.searchParams.set('limit', '8'); u.searchParams.set('lang', 'en');
    u.searchParams.set('bbox', `${LON0},${LAT0},${LON1},${LAT1}`);
    if (bias) { u.searchParams.set('lon', bias[0].toFixed(5)); u.searchParams.set('lat', bias[1].toFixed(5)); u.searchParams.set('location_bias_scale', '0.4'); u.searchParams.set('zoom', '14'); }
    const res = await fetch(u, { signal: ctrl.signal });
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
