import { create } from 'zustand'
import type { ContentState, Heartbeat } from '@/types'

interface AuditEntry {
  ts: string
  event: string
  agent: string
  data: Record<string, unknown>
}

interface ContentStore extends ContentState {
  loading: boolean
  auditEntries: AuditEntry[]
  setFiles: (files: Record<string, string>) => void
  updateFile: (key: string, content: string) => void
  setHeartbeats: (heartbeats: Record<string, Heartbeat>) => void
  setConnected: (connected: boolean) => void
  appendAuditEntry: (entry: AuditEntry) => void
  initialize: () => Promise<void>
}

export const useContentStore = create<ContentStore>((set, get) => ({
  files: {},
  heartbeats: {},
  connected: false,
  loading: true,
  auditEntries: [],

  setFiles: (files) => set({ files }),
  updateFile: (key, content) =>
    set((state) => ({ files: { ...state.files, [key]: content } })),
  setHeartbeats: (heartbeats) => set({ heartbeats: heartbeats as Record<string, Heartbeat> }),
  setConnected: (connected) => set({ connected }),
  appendAuditEntry: (entry) =>
    set((state) => ({ auditEntries: [...state.auditEntries, entry] })),

  initialize: async () => {
    try {
      const [stateRes, healthRes] = await Promise.all([
        fetch('/api/state'),
        fetch('/api/agents/health'),
      ])
      if (stateRes.ok) {
        const files = await stateRes.json()
        set({ files })
      }
      if (healthRes.ok) {
        const heartbeats = await healthRes.json()
        set({ heartbeats })
      }
    } catch {
      // SSE will populate data when connected
    } finally {
      set({ loading: false })
    }
  },
}))
