import { useState, useEffect } from "react";

/**
 * A hook that increments a tick counter at a given interval.
 * Useful for forcing re-renders to refresh relative timestamps
 * (e.g., "5m ago" → "6m ago") or triggering periodic polling.
 *
 * @param intervalMs - Interval in milliseconds (default: 30_000)
 * @returns The current tick count, incremented each interval
 */
export function useAutoRefresh(intervalMs: number = 30_000): number {
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return tick;
}
