'use client'

import { useEffect, useRef } from 'react'
import { useContentStore } from './use-content-store'
import type { Heartbeat } from '@/types'

const MAX_RETRIES = 20
const BASE_DELAY = 1000
const MAX_DELAY = 30000

export function useSSE() {
  const updateFile = useContentStore((s) => s.updateFile)
  const setConnected = useContentStore((s) => s.setConnected)
  const setHeartbeats = useContentStore((s) => s.setHeartbeats)
  const initialize = useContentStore((s) => s.initialize)
  const appendAuditEntry = useContentStore((s) => s.appendAuditEntry)
  const esRef = useRef<EventSource | null>(null)
  const retryRef = useRef(0)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Debounce heartbeat refetches
  const hbTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    initialize()

    function connect() {
      // Clean up any prior connection
      if (esRef.current) {
        esRef.current.close()
        esRef.current = null
      }

      const es = new EventSource('/api/events')
      esRef.current = es

      es.onopen = () => {
        setConnected(true)
        retryRef.current = 0 // Reset backoff on successful connect
      }

      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data)
          if (data.type === 'audit' && data.entry) {
            appendAuditEntry(data.entry)
          }
          // Workflow gate events — trigger a full refresh so task cards update
          if (data.type === 'plugin-event' && typeof data.event === 'string' && data.event.startsWith('workflow.gate')) {
            initialize()
          }
          if (data.file && data.content !== undefined) {
            updateFile(data.file, data.content)

            // Debounced heartbeat refetch — coalesce rapid updates
            if (data.file.startsWith('heartbeats/') && data.file.endsWith('.json')) {
              if (hbTimerRef.current) clearTimeout(hbTimerRef.current)
              hbTimerRef.current = setTimeout(() => {
                fetch('/api/agents/health')
                  .then(r => r.ok ? r.json() : null)
                  .then(hb => { if (hb) setHeartbeats(hb as Record<string, Heartbeat>) })
                  .catch(() => { /* best effort */ })
              }, 500)
            }
          }
        } catch {
          // keep-alive or invalid
        }
      }

      es.onerror = () => {
        setConnected(false)
        es.close()
        esRef.current = null

        if (retryRef.current < MAX_RETRIES) {
          const delay = Math.min(BASE_DELAY * Math.pow(2, retryRef.current), MAX_DELAY)
          retryRef.current++
          timeoutRef.current = setTimeout(connect, delay)
        }
      }
    }

    connect()

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      if (hbTimerRef.current) clearTimeout(hbTimerRef.current)
      esRef.current?.close()
      esRef.current = null
    }
  }, [updateFile, setConnected, setHeartbeats, initialize, appendAuditEntry])
}
