'use client'

import { useEffect, useRef } from 'react'
import { useContentStore } from './use-content-store'
import type { Heartbeat } from '@/types'

export function useSSE() {
  const updateFile = useContentStore((s) => s.updateFile)
  const setConnected = useContentStore((s) => s.setConnected)
  const setHeartbeats = useContentStore((s) => s.setHeartbeats)
  const initialize = useContentStore((s) => s.initialize)
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    initialize()

    function connect() {
      const es = new EventSource('/api/events')
      esRef.current = es

      es.onopen = () => setConnected(true)

      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data)
          if (data.file && data.content !== undefined) {
            updateFile(data.file, data.content)

            // If a heartbeat file changed, re-fetch all heartbeats so the
            // Team page stays live without a full page reload.
            if (data.file.startsWith('heartbeats/') && data.file.endsWith('.json')) {
              fetch('/api/agents/health')
                .then(r => r.ok ? r.json() : null)
                .then(hb => { if (hb) setHeartbeats(hb as Record<string, Heartbeat>) })
                .catch(() => { /* best effort */ })
            }
          }
        } catch {
          // keep-alive or invalid
        }
      }

      es.onerror = () => {
        setConnected(false)
        es.close()
        setTimeout(connect, 3000)
      }
    }

    connect()

    return () => {
      esRef.current?.close()
    }
  }, [updateFile, setConnected, setHeartbeats, initialize])
}
