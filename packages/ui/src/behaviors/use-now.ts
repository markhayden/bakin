import { useEffect, useState } from 'react'

/**
 * A clock a component can render from: the instant at mount, refreshed on an
 * interval (one minute by default) so "today" markings, countdowns and
 * "resets in …" copy roll over while the view stays open. Reading the clock
 * in render is impure (#966); this is the sanctioned way to depend on it.
 * Event handlers that need the instant of the event read `new Date()`
 * directly — handlers are not render.
 */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) return
    const timer = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}
