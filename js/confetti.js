// Confetti: one full-screen canvas over everything for a couple of seconds, then gone. Pieces (rects, discs and a
// few ribbons) fly up from the bottom centre and both lower corners, then fall with gravity, drag, spin and a tumble.
// One canvas, one requestAnimationFrame loop, no DOM work per frame. window.Confetti.burst(opts)
(function () {
  const TAU = Math.PI * 2;
  let cv = null, ctx = null, raf = 0, pieces = [], t0 = 0, dur = 0, W = 0, H = 0, dpr = 1, last = 0, still = false;
  const css = (name, fb) => { const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim(); return v || fb; };
  const rnd = (a, b) => a + Math.random() * (b - a);

  function size() {
    W = window.innerWidth; H = window.innerHeight; dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  }
  function mount() {
    if (!cv) {
      cv = document.createElement('canvas'); cv.setAttribute('aria-hidden', 'true'); cv.className = 'confetti';
      cv.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:60;display:block';
      ctx = cv.getContext('2d');
    }
    if (!cv.isConnected) { document.body.appendChild(cv); window.addEventListener('resize', size); }
    size();
  }
  function unmount() { cancelAnimationFrame(raf); raf = 0; pieces = []; if (cv && cv.isConnected) { cv.remove(); window.removeEventListener('resize', size); } }

  // a launch from (x, y) toward angle a (radians, 0 = up), speeds scaled to the viewport so every screen gets the same arc
  function piece(x, y, a, speed, colors) {
    const r = Math.random(), kind = r < .08 ? 'ribbon' : r < .38 ? 'disc' : 'rect';
    return {
      kind, x, y, vx: Math.sin(a) * speed, vy: -Math.cos(a) * speed,
      w: kind === 'ribbon' ? rnd(4, 5.5) : rnd(6, 10), h: kind === 'ribbon' ? rnd(20, 30) : rnd(4, 7),
      rot: rnd(0, TAU), vr: rnd(-9, 9), tilt: rnd(0, TAU), vt: rnd(6, 14), drag: rnd(1.1, 1.9), sway: rnd(0, TAU),
      c: colors[(Math.random() * colors.length) | 0], delay: rnd(0, .12),
    };
  }

  function frame(t) {
    raf = 0;
    const dt = Math.min(.05, (t - last) / 1000 || .016); last = t;
    const el = (t - t0) / 1000, g = H * 1.15;
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cv.width, cv.height);
    // fade everything over the last 35%, so the burst ends on its own whatever is still in the air
    const fade = el < dur * .65 ? 1 : Math.max(0, 1 - (el - dur * .65) / (dur * .35));
    for (const p of pieces) {
      if (el < p.delay) continue;
      if (!still) { const d = Math.exp(-p.drag * dt);
      p.vx *= d; p.vy = p.vy * d + g * dt; p.x += p.vx * dt + Math.sin(p.sway + el * 5) * 12 * dt; p.y += p.vy * dt;
      p.rot += p.vr * dt; p.tilt += p.vt * dt; }
      if (p.y > H + 40) continue;
      const flip = Math.cos(p.tilt), cr = Math.cos(p.rot) * dpr, sr = Math.sin(p.rot) * dpr;
      // rotate, then squash along the local y axis for the tumble: one setTransform per piece, no save/restore
      ctx.setTransform(cr, sr, -sr * flip, cr * flip, p.x * dpr, p.y * dpr);
      ctx.globalAlpha = fade * (.55 + .45 * Math.abs(flip));
      ctx.fillStyle = p.c;
      if (p.kind === 'rect') ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      else if (p.kind === 'disc') { ctx.beginPath(); ctx.ellipse(0, 0, p.w * .45, p.w * .45, 0, 0, TAU); ctx.fill(); }
      else { // ribbon: a short wave
        ctx.strokeStyle = p.c; ctx.lineWidth = p.w * .6; ctx.lineCap = 'round'; ctx.beginPath();
        const L = p.h, ph = (still ? 0 : el * 10) + p.sway; ctx.moveTo(-L / 2, Math.sin(ph) * 3);
        for (let q = 1; q <= 6; q++) { const x = -L / 2 + L * q / 6; ctx.lineTo(x, Math.sin(ph + q * 1.1) * 3); }
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    if (el < dur) raf = requestAnimationFrame(frame); else unmount();
  }

  function burst(opts = {}) {
    const reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const n = opts.count || (reduce ? 60 : 200);
    mount();
    const colors = opts.colors || [css('--accent', '#e85a1f'), css('--star', '#e0a81c'), css('--want', '#2f6fcf'), '#ffffff', css('--star', '#e0a81c')];
    const s = Math.min(H, 1000), out = [];
    for (let q = 0; q < n; q++) {
      const src = q % 3; // centre, left corner, right corner
      if (src === 0) out.push(piece(W / 2 + rnd(-W * .06, W * .06), H + 8, rnd(-.42, .42), s * rnd(1.55, 2.25), colors));
      else if (src === 1) out.push(piece(rnd(-6, W * .04), H + 8, rnd(.28, .72), s * rnd(1.45, 2.15), colors));
      else out.push(piece(W - rnd(-6, W * .04), H + 8, -rnd(.28, .72), s * rnd(1.45, 2.15), colors));
    }
    const now = performance.now();
    if (reduce) { // reduced motion: no flight, no spin. A still scatter over the screen that fades out
      out.forEach(p => { p.x = rnd(0, W); p.y = rnd(0, H); p.delay = 0; });
      pieces = out; still = true; t0 = now; last = now; dur = opts.duration || .7;
      if (!raf) raf = requestAnimationFrame(frame); return;
    }
    if (still) { pieces = []; still = false; }
    if (raf && pieces.length) { // already in the air: add to it and extend
      const el = (now - t0) / 1000; out.forEach(p => { p.delay += el; }); pieces = pieces.concat(out); dur = el + (opts.duration || 2.4);
    } else { pieces = out; t0 = now; last = now; dur = opts.duration || 2.4; }
    if (!raf) raf = requestAnimationFrame(frame);
  }

  window.Confetti = { burst, stop: unmount };
})();
