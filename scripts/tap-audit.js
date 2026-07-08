// Tap-target acceptance audit (usability spec §5). Paste into the DevTools console.
// Bars: 0 targets <24px; ≤4 named <44px exceptions; 0 interactive labels <12px.
(() => {
  const sel = 'button, input, textarea, select, a[href], [role="button"], [data-element-id]';
  const hit = (e) => { // include ::after hit-area expansion in the measured target
    const r = e.getBoundingClientRect();
    const a = getComputedStyle(e, '::after');
    if (a.content !== 'none' && a.position === 'absolute') {
      const w = parseFloat(a.width) || 0, h = parseFloat(a.height) || 0;
      return { w: Math.max(r.width, w), h: Math.max(r.height, h) };
    }
    return { w: r.width, h: r.height };
  };
  const rows = [...document.querySelectorAll(sel)]
    .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; })
    .map(e => { const { w, h } = hit(e); return {
      label: (e.getAttribute('aria-label') || e.title || e.placeholder || e.textContent || e.tagName).trim().slice(0, 28),
      w: Math.round(w), h: Math.round(h),
      font: parseFloat(getComputedStyle(e).fontSize) || null,
      interactive: ['BUTTON','INPUT','TEXTAREA','SELECT','A'].includes(e.tagName) || e.getAttribute('role') === 'button',
    }; });
  const under24 = rows.filter(x => x.w < 24 || x.h < 24);
  const under44 = rows.filter(x => x.w < 44 || x.h < 44);
  const tinyText = rows.filter(x => x.interactive && x.font && x.font < 12);
  return JSON.stringify({ total: rows.length, under24, under44Count: under44.length, under44: under44.slice(0, 12), tinyTextCount: tinyText.length, tinyText: tinyText.slice(0, 8) }, null, 1);
})();
