import { useEffect, useRef, useState } from 'react';

import { COUNT_UP_MS, durationOf, prefersReducedMotion } from './motion.js';

/**
 * A number that climbs to its value in the count-up time. The text is always the number, so a reader who cannot see the
 * motion has the same information. Reduced motion shows the value at once.
 */
export function CountUp({ value }: { readonly value: number }) {
  const [shown, setShown] = useState(value);
  const shownRef = useRef(value);

  useEffect(() => {
    const duration = durationOf(COUNT_UP_MS, prefersReducedMotion());
    const from = shownRef.current;
    if (duration === 0 || from === value) {
      shownRef.current = value;
      setShown(value);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const next = Math.round(from + (value - from) * progress);
      shownRef.current = next;
      setShown(next);
      if (progress < 1) {
        frame = requestAnimationFrame(step);
      }
    };
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [value]);

  return <>{String(shown)}</>;
}
