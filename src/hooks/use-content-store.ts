import { create } from 'zustand'
import type { ActivityEvent, ContentState, Heartbeat } from '@/types'
import { isNoisyEvent } from '@/lib/map-audit-message'

interface AuditEntry {
  ts: string
  event: string
  agent: string
  data: Record<string, unknown>
}

interface ReindexProgressEntry {
  indexed: number
  done: boolean
}

interface ContentStore extends ContentState {
  loading: boolean
  auditEntries: AuditEntry[]
  activityEvents: ActivityEvent[]
  sseConnected: boolean
  taskboardVersion: number
  debug: boolean
  reindexProgress: Record<string, ReindexProgressEntry>
  setFiles: (files: Record<string, string>) => void
  updateFile: (key: string, content: string) => void
  setHeartbeats: (heartbeats: Record<string, Heartbeat>) => void
  setConnected: (connected: boolean) => void
  appendAuditEntry: (entry: AuditEntry) => void
  appendActivityEvent: (event: ActivityEvent) => void
  setActivityEvents: (events: ActivityEvent[]) => void
  setSseConnected: (connected: boolean) => void
  bumpTaskboard: () => void
  setDebug: (debug: boolean) => void
  toggleDebug: () => void
  setReindexProgress: (table: string, indexed: number, done: boolean) => void
  clearReindexProgress: () => void
  initialize: () => Promise<void>
}

export const useContentStore = create<ContentStore>((set, get) => ({
  files: {},
  heartbeats: {},
  connected: false,
  loading: true,
  auditEntries: [],
  activityEvents: [],
  sseConnected: false,
  taskboardVersion: 0,
  debug: false,
  reindexProgress: {},

  setFiles: (files) => set({ files }),
  updateFile: (key, content) =>
    set((state) => ({ files: { ...state.files, [key]: content } })),
  setHeartbeats: (heartbeats) => set({ heartbeats: heartbeats as Record<string, Heartbeat> }),
  setConnected: (connected) => set({ connected }),
  appendAuditEntry: (entry) =>
    set((state) => ({ auditEntries: [...state.auditEntries, entry] })),
  appendActivityEvent: (event) =>
    set((state) => {
      if (isNoisyEvent(event)) return state
      if (state.activityEvents.some((e) => e.id === event.id)) return state
      return { activityEvents: [event, ...state.activityEvents].slice(0, 100) }
    }),
  setActivityEvents: (events) =>
    set({ activityEvents: events.filter((e) => !isNoisyEvent(e)).slice(0, 100) }),
  setSseConnected: (connected) => set({ sseConnected: connected }),
  bumpTaskboard: () => set((state) => ({ taskboardVersion: state.taskboardVersion + 1 })),
  setDebug: (debug) => {
    set({ debug })
    try { localStorage.setItem('bakin-debug', String(debug)) } catch {}
  },
  toggleDebug: () => {
    const next = !get().debug
    set({ debug: next })
    try { localStorage.setItem('bakin-debug', String(next)) } catch {}
  },
  setReindexProgress: (table, indexed, done) =>
    set((state) => ({
      reindexProgress: { ...state.reindexProgress, [table]: { indexed, done } },
    })),
  clearReindexProgress: () => set({ reindexProgress: {} }),

  initialize: async () => {
    try { if (localStorage.getItem('bakin-debug') === 'true') set({ debug: true }) } catch {}
    try {
      const [stateRes, healthRes, activityRes] = await Promise.all([
        fetch('/api/state'),
        fetch('/api/agents/health'),
        fetch('/api/activity'),
      ])
      if (stateRes.ok) {
        const files = await stateRes.json()
        set({ files })
      }
      if (healthRes.ok) {
        const heartbeats = await healthRes.json()
        set({ heartbeats })
      }
      if (activityRes.ok) {
        const data = await activityRes.json()
        if (data?.events) {
          get().setActivityEvents(data.events)
        }
      }
    } catch {
      // SSE will populate data when connected
    } finally {
      set({ loading: false })
    }
  },
}))
