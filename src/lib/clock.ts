import { useEffect, useState } from "react";

/**
 * Ticks on an interval so time-based pricing (night rates, 10pm–6am)
 * re-renders and flips the moment the clock crosses a boundary.
 */
export function useClock(intervalMs = 30_000): Date {
  const [now, setNow] = useState<Date>(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);

  return now;
}
