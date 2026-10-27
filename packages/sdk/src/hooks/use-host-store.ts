import { create } from 'zustand'
import { isNoisyEvent } from '@bakin/core/events/audit-message'
import type { ActivityEvent, HostState } from '../types'

/** Rows the activity feed keeps — newest first. */
const ACTIVITY_CAP = 100

interface HostStore extends HostState {
  setConnected: (connected: boolean) => void
  setDebug: (debug: boolean) => void
  toggleDebug: () => void
  appendActivityEvent: (event: ActivityEvent) => void
  /**
   * Fetch the activity snapshot and merge it with the live events already
   * held. The host SSE hook calls this once per successful connection.
   */
  refreshActivity: () => Promise<void>
}

/** Debug survives reloads via localStorage; unreadable storage means off. */
function storedDebug(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem('bakin-debug') === 'true'
  } catch {
    return false
  }
}

function persistDebug(debug: boolean): void {
  try { localStorage.setItem('bakin-debug', String(debug)) } catch { /* storage unavailable — in-memory only */ }
}

/** Newest first, one row per id, capped. */
function mergeActivity(held: ActivityEvent[], incoming: ActivityEvent[]): ActivityEvent[] {
  const byId = new Map<string, ActivityEvent>()
  for (const event of [...held, ...incoming]) {
    if (!isNoisyEvent(event) && !byId.has(event.id)) byId.set(event.id, event)
  }
  return [...byId.values()]
    .sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts))
    .slice(0, ACTIVITY_CAP)
}

let latestActivityRequest = 0

/**
 * Host-wide browser state: the live-connection flag, the debug toggle and the
 * activity feed. Nothing else lives here — domain data belongs to its plugin.
 */
export const useHostStore = create<HostStore>((set, get) => ({
  connected: false,
  debug: storedDebug(),
  activityEvents: [],

  setConnected: (connected) => set({ connected }),
  setDebug: (debug) => {
    set({ debug })
    persistDebug(debug)
  },
  toggleDebug: () => get().setDebug(!get().debug),
  appendActivityEvent: (event) => set((state) => {
    if (isNoisyEvent(event) || state.activityEvents.some((e) => e.id === event.id)) return state
    return { activityEvents: [event, ...state.activityEvents].slice(0, ACTIVITY_CAP) }
  }),
  refreshActivity: async () => {
    const request = ++latestActivityRequest
    let events: ActivityEvent[]
    try {
      const res = await fetch('/api/activity')
      if (!res.ok) return
      events = ((await res.json()) as { events?: ActivityEvent[] }).events ?? []
    } catch {
      return // offline — the next connection refreshes again
    }
    // A slower, older response must not land after a newer one.
    if (request !== latestActivityRequest) return
    set((state) => ({ activityEvents: mergeActivity(state.activityEvents, events) }))
  },
}))
