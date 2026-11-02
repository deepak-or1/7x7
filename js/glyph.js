// Landmark glyphs: tiny 2.5D monoline drawings. Each glyph lives in a unit box, x and y in 0..1, y downward,
// with the ground anchor at (0.5, 1). `h` is the drawn height in px; the width is h * (g.w || 1).
// Shapes draw in order. Kinds: poly (closed), line (open), ellipse. Fills: face (light), shade (darker side),
// roof (top plane, lightest), accent (bridge-orange), none.
(function () {
  function drawGlyph(ctx, g, x, y, h, pal) {
    const w = h * (g.w || 1);
    const X = p => x + (p[0] - 0.5) * w, Y = p => y + (p[1] - 1) * h;
    const fills = { face: pal.face, shade: pal.shade, roof: pal.roof, accent: pal.accent, ink: pal.ink };
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.lineWidth = pal.lw; ctx.strokeStyle = pal.ink;
    for (const s of g.shapes) {
      ctx.beginPath();
      if (s.t === 'ellipse') ctx.ellipse(X(s.c), Y(s.c), s.r[0] * w, s.r[1] * h, 0, 0, Math.PI * 2);
      else { s.p.forEach((p, i) => i ? ctx.lineTo(X(p), Y(p)) : ctx.moveTo(X(p), Y(p))); if (s.t === 'poly') ctx.closePath(); }
      if (s.f && s.f !== 'none' && s.t !== 'line') { ctx.fillStyle = fills[s.f] || pal.face; ctx.fill(); }
      if (s.s !== false) { ctx.lineWidth = pal.lw * (s.lw || 1); ctx.stroke(); }
    }
    ctx.restore();
  }
  window.drawGlyph = drawGlyph;
})();
