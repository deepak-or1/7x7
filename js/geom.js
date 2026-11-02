// Geometry helpers: Mercator projection into the map's unit space, point-in-polygon, and the
// half-plane clipping that cuts a neighborhood into sub-area cells (a Voronoi partition clipped to the polygon).
(function () {
  const G = window.GEO;
  const NX = G.nx, NY = G.ny;
  const [LON0, LAT0, LON1, LAT1] = G.bbox;
  const mercY = lat => { const r = lat * Math.PI / 180; return Math.log(Math.tan(r) + 1 / Math.cos(r)); };
  const MY0 = mercY(LAT1), MY1 = mercY(LAT0);
  const proj = p => [(p[0] - LON0) / (LON1 - LON0) * NX, (mercY(p[1]) - MY0) / (MY1 - MY0) * NY];
  const unproj = (x, y) => { const lon = LON0 + x / NX * (LON1 - LON0), my = MY0 + y / NY * (MY1 - MY0); return [lon, Math.atan(Math.sinh(my)) * 180 / Math.PI]; };
  // one map unit in metres, at the middle latitude (used for distances and the scale bar)
  const UNIT_M = (LON1 - LON0) / NX * 111320 * Math.cos((LAT0 + LAT1) / 2 * Math.PI / 180);

  function pip(ring, x, y) { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; }
  // polys: [[outer, hole, hole], ...] in map units
  const inPolys = (polys, x, y) => polys.some(poly => pip(poly[0], x, y) && !poly.slice(1).some(h => pip(h, x, y)));
  function bboxOf(rings) { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; rings.forEach(r => r.forEach(([x, y]) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; })); return [x0, y0, x1, y1]; }
  function area(ring) { let a = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1]); return a / 2; }
  function centroid(ring) { let a = 0, cx = 0, cy = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]; a += f; cx += (ring[j][0] + ring[i][0]) * f; cy += (ring[j][1] + ring[i][1]) * f; } a *= 3; return a ? [cx / a, cy / a] : ring[0]; }
  // Sutherland–Hodgman: keep the side of the line through (px,py) with normal (nx,ny) where n·(p - P) <= 0
  function clipHalf(ring, px, py, nx, ny) {
    const out = []; const n = ring.length; if (!n) return out;
    const side = p => (p[0] - px) * nx + (p[1] - py) * ny;
    for (let i = 0; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n], sa = side(a), sb = side(b);
      if (sa <= 0) out.push(a);
      if ((sa <= 0) !== (sb <= 0)) { const t = sa / (sa - sb); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
    }
    return out;
  }
  // Voronoi cells of `seeds` ([x,y] in map units) clipped to the outer rings of `polys`.
  // Returns per seed: { rings: [ring, ...], bbox, c: label point }
  function cells(polys, seeds) {
    return seeds.map((s, i) => {
      const rings = [];
      polys.forEach(poly => {
        let ring = poly[0];
        for (let j = 0; j < seeds.length && ring.length; j++) {
          if (j === i) continue; const o = seeds[j];
          const mx = (s[0] + o[0]) / 2, my = (s[1] + o[1]) / 2; // bisector through the midpoint, normal pointing at the other seed
          ring = clipHalf(ring, mx, my, o[0] - s[0], o[1] - s[1]);
        }
        if (ring.length >= 3 && Math.abs(area(ring)) > 1e-6) rings.push(ring);
      });
      if (!rings.length) return { rings: [], bbox: [s[0], s[1], s[0], s[1]], c: s, a: 0 };
      const big = rings.reduce((m, r) => Math.abs(area(r)) > Math.abs(area(m)) ? r : m, rings[0]);
      let c = centroid(big); if (!pip(big, c[0], c[1])) c = s;
      return { rings, bbox: bboxOf(rings), c, a: rings.reduce((t, r) => t + Math.abs(area(r)), 0) };
    });
  }
  function pathOf(rings) { const p = new Path2D(); rings.forEach(r => { r.forEach((q, k) => k ? p.lineTo(q[0], q[1]) : p.moveTo(q[0], q[1])); p.closePath(); }); return p; }
  window.Geom = { NX, NY, proj, unproj, UNIT_M, pip, inPolys, bboxOf, area, centroid, cells, pathOf, clipHalf };
})();
