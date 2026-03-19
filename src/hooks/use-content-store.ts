import { create } from 'zustand'
import type { ContentState, Heartbeat } from '@/types'

interface ContentStore extends ContentState {
  setFiles: (files: Record<string, string>) => void
  updateFile: (key: string, content: string) => void
  setHeartbeats: (heartbeats: Record<string, Heartbeat>) => void
  setConnected: (connected: boolean) => void
  initialize: () => Promise<void>
}

export const useContentStore = create<ContentStore>((set) => ({
  files: {},
  heartbeats: {},
  connected: false,

  setFiles: (files) => set({ files }),
  updateFile: (key, content) =>
    set((state) => ({ files: { ...state.files, [key]: content } })),
  setHeartbeats: (heartbeats) => set({ heartbeats: heartbeats as Record<string, Heartbeat> }),
  setConnected: (connected) => set({ connected }),

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
      // will retry via SSE reconnection
    }
  },
}))
