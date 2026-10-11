import { useEffect, useRef, useState } from 'react';

/**
 * from から to まで数値をカウントアップさせる。
 * 加算の瞬間を「数字が積み上がる動き」で見せるために使う。
 * prefers-reduced-motion が有効なら即座に最終値を出す。
 */
export function useCountUp(to: number, opts: { from?: number; duration?: number; delay?: number } = {}): number {
  const { from = 0, duration = 1100, delay = 0 } = opts;
  const [value, setValue] = useState(from);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    const reduce = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce || to === from) {
      setValue(to);
      return;
    }

    setValue(from);
    let start: number | null = null;
    const timer = window.setTimeout(() => {
      const step = (t: number) => {
        if (start === null) start = t;
        const p = Math.min((t - start) / duration, 1);
        // 最後に減速させて「止まった」感を出す
        const eased = 1 - Math.pow(1 - p, 3);
        setValue(Math.round(from + (to - from) * eased));
        if (p < 1) raf.current = requestAnimationFrame(step);
      };
      raf.current = requestAnimationFrame(step);
    }, delay);

    return () => {
      window.clearTimeout(timer);
      if (raf.current !== null) cancelAnimationFrame(raf.current);
    };
  }, [to, from, duration, delay]);

  return value;
}
