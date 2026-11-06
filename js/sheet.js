// The phone sheet: translateY only (no layout work), three detents, drag from the handle, the header,
// or the content when it is scrolled to the top; velocity decides where it settles.
(function () {
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  window.Sheet = function (el, opt) {
    const grip = opt.grip, head = opt.head, panel = opt.panel, root = document.documentElement;
    let detent = 'peek', fullPx = 0, vis = 0, dragging = null;
    const isPhone = () => window.innerWidth <= 880;
    // safe-area insets: env() only resolves inside CSS, so a hidden probe carries them as padding we can read
    const probe = document.createElement('div'); probe.id = 'sa-probe';
    probe.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)';
    document.body.appendChild(probe);
    const insets = () => { const cs = getComputedStyle(probe); return { t: parseFloat(cs.paddingTop) || 0, b: parseFloat(cs.paddingBottom) || 0 }; };
    function heights() {
      // full clears the Dynamic Island (or, while searching, the pinned top card); peek adds the home-indicator inset as paper under the title
      const H = window.innerHeight, i = insets(), topEl = document.querySelector('.top');
      const pin = root.classList.contains('searching') && topEl ? topEl.getBoundingClientRect().bottom + 8 : 0;
      const top = Math.max(10, i.t + 6, pin), full = H - top;
      const peek = Math.min(full, (grip.offsetHeight || 18) + (head.offsetHeight || 54) + 2 + i.b), half = clamp(Math.round(H * 0.46), peek + 60, full - 40);
      return { peek, half, full, H };
    }
    function apply(v, animate) {
      vis = v; const y = fullPx - v;
      el.classList.toggle('lifting', !animate); opt.ctl && opt.ctl.classList.toggle('lifting', !animate); opt.legend && opt.legend.classList.toggle('lifting', !animate);
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
    // keyboard: a field opens the sheet to full (half does not scroll) and scrolls into view; --kb pads the panel above the keyboard
    panel.addEventListener('focusin', e => { if (!isPhone() || !e.target.matches('input:not([type=checkbox]):not([type=file]), textarea, select')) return; if (detent !== 'full') set('full'); setTimeout(() => { try { e.target.scrollIntoView({ block: 'center', behavior: 'smooth' }); } catch (err) {} }, 450); });
    if (window.visualViewport) { const kb = () => root.style.setProperty('--kb', Math.max(0, window.innerHeight - visualViewport.height - visualViewport.offsetTop).toFixed(0) + 'px'); visualViewport.addEventListener('resize', kb); visualViewport.addEventListener('scroll', kb); kb(); }
    window.addEventListener('resize', () => set(detent, { instant: true, resize: true }));
    return { set, get detent() { return detent; }, get visible() { return isPhone() ? vis : 0; }, heights, isPhone };
  };
})();
