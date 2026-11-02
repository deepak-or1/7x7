// The phone sheet: translateY only (no layout work), three detents, drag from the handle, the header,
// or the content when it is scrolled to the top; velocity decides where it settles.
(function () {
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  window.Sheet = function (el, opt) {
    const grip = opt.grip, head = opt.head, panel = opt.panel, root = document.documentElement;
    let detent = 'peek', fullPx = 0, vis = 0, dragging = null;
    const isPhone = () => window.innerWidth <= 880;
    const safeTop = () => { const v = parseFloat(getComputedStyle(root).getPropertyValue('--sat')) || 0; return v; };
    function heights() {
      const H = window.innerHeight, top = Math.max(10, safeTop() + 8);
      const full = H - top, peek = Math.min(full, (grip.offsetHeight || 18) + (head.offsetHeight || 54) + 2), half = clamp(Math.round(H * 0.46), peek + 60, full - 40);
      return { peek, half, full, H };
    }
    function apply(v, animate) {
      vis = v; const y = fullPx - v;
      el.classList.toggle('lifting', !animate); opt.ctl && opt.ctl.classList.toggle('lifting', !animate);
      root.style.setProperty('--sheet-y', y.toFixed(1) + 'px'); root.style.setProperty('--sheet-vis', v.toFixed(1) + 'px');
    }
    function set(d, o = {}) {
      if (!isPhone()) { detent = d; el.classList.add('full'); root.classList.remove('sheet-full'); root.style.setProperty('--sheet-vis', '0px'); root.style.setProperty('--sheet-y', '0px'); el.style.height = ''; if (opt.onChange) opt.onChange(detent, 0, o); return; }
      const h = heights(); fullPx = h.full; el.style.height = fullPx + 'px';
      detent = d; apply(h[d], !o.instant);
      el.classList.toggle('full', d === 'full'); root.classList.toggle('sheet-full', d === 'full');
      if (d !== 'full') panel.scrollTop = 0;
      if (opt.onChange) opt.onChange(detent, h[d], o);
    }
    function settle(y, v) { // y: current visible px, v: px/ms upward positive
      const h = heights(), order = ['peek', 'half', 'full'], proj = y + v * 180;
      let best = order[0], bd = 1e9; for (const d of order) { const dd = Math.abs(h[d] - proj); if (dd < bd) { bd = dd; best = d; } }
      if (Math.abs(v) > 0.9) { const cur = order.indexOf(detent); best = order[clamp(cur + (v > 0 ? 1 : -1), 0, 2)]; }
      set(best);
    }
    // handle + header: pointer events
    function startDrag(y) { dragging = { y0: y, y: y, v0: vis, t: performance.now(), v: 0, moved: 0 }; }
    function moveDrag(y) { if (!dragging) return; const t = performance.now(), dt = Math.max(1, t - dragging.t), dy = dragging.y - y; dragging.v = dragging.v * .6 + (dy / dt) * .4; dragging.moved += Math.abs(dy); dragging.y = y; dragging.t = t; const h = heights(); let nv = dragging.v0 + (dragging.y0 - y); if (nv > h.full) nv = h.full + (nv - h.full) * .25; if (nv < h.peek) nv = h.peek - (h.peek - nv) * .35; apply(nv, false); }
    function endDrag(tap) { if (!dragging) return; const d = dragging; dragging = null; if (d.moved < 6) { if (tap !== false) set(detent === 'peek' ? 'half' : detent === 'half' ? 'full' : 'half'); else set(detent); } else settle(vis, performance.now() - d.t > 80 ? 0 : d.v); }
    for (const h of [grip, head]) {
      h.addEventListener('pointerdown', e => { if (!isPhone() || e.target.closest('button, a, input')) return; try { h.setPointerCapture(e.pointerId); } catch (err) {} startDrag(e.clientY); });
      h.addEventListener('pointermove', e => dragging && moveDrag(e.clientY));
      h.addEventListener('pointerup', () => endDrag(true)); h.addEventListener('pointercancel', () => endDrag(false));
    }
    // content: touch events, so native scrolling keeps working when the sheet is open and scrolled
    let touch = null;
    panel.addEventListener('touchstart', e => { if (!isPhone() || e.touches.length !== 1) return; touch = { y: e.touches[0].clientY, took: false }; }, { passive: true });
    panel.addEventListener('touchmove', e => {
      if (!touch || e.touches.length !== 1) return; const y = e.touches[0].clientY, dy = y - touch.y;
      if (!touch.took) { const canScroll = detent === 'full' && !(panel.scrollTop <= 0 && dy > 0); if (canScroll) { touch = null; return; } if (Math.abs(dy) < 3) return; touch.took = true; startDrag(touch.y); }
      e.preventDefault(); moveDrag(y);
    }, { passive: false });
    const endTouch = () => { if (touch && touch.took) endDrag(false); touch = null; };
    panel.addEventListener('touchend', endTouch); panel.addEventListener('touchcancel', endTouch);
    panel.addEventListener('click', e => { if (isPhone() && detent === 'peek' && !e.target.closest('button, a, input, select, textarea, label, summary')) set('half'); });
    panel.addEventListener('scroll', () => el.classList.toggle('scrolled', panel.scrollTop > 2), { passive: true });
    window.addEventListener('resize', () => set(detent, { instant: true, resize: true }));
    return { set, get detent() { return detent; }, get visible() { return isPhone() ? vis : 0; }, heights, isPhone };
  };
})();
