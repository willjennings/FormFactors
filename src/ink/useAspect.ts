// Measured container aspect (width/height) for the ink layers: their square viewBox is
// stretched non-uniformly (preserveAspectRatio="none"), so inkStroke needs the real ratio
// to keep on-screen stroke width direction-independent (spec §3.1). Defaults to 1 until
// measured — first paint is isotropic-in-unit-space, corrected on the observer's first tick.
import { useEffect, useRef, useState, type RefObject } from 'react';

export function useAspect<T extends Element>(): [RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [aspect, setAspect] = useState(1);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) {
        // Clamp: a collapsing/transitioning container can transiently report an absurd ratio,
        // which would balloon every stroke's resample length (probe 2026-07-17). Real layer
        // aspects live in ~[0.3, 4]; [0.2, 8] leaves headroom without admitting pathology.
        const a = Math.min(8, Math.max(0.2, r.width / r.height));
        setAspect((prev) => (Math.abs(prev - a) < 0.01 ? prev : a));
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, aspect];
}
