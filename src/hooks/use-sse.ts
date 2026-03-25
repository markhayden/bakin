'use client'

import { useEffect, useRef } from 'react'
import { useContentStore } from './use-content-store'
import type { Heartbeat } from '@/types'
import { mapAuditMessage } from '@/lib/map-audit-message'

const MAX_RETRIES = 20
const BASE_DELAY = 1000
const MAX_DELAY = 30000

export function useSSE() {
  const updateFile = useContentStore((s) => s.updateFile)
  const setConnected = useContentStore((s) => s.setConnected)
  const setHeartbeats = useContentStore((s) => s.setHeartbeats)
  const initialize = useContentStore((s) => s.initialize)
  const appendAuditEntry = useContentStore((s) => s.appendAuditEntry)
  const appendActivityEvent = useContentStore((s) => s.appendActivityEvent)
  const setSseConnected = useContentStore((s) => s.setSseConnected)
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
        setSseConnected(true)
        retryRef.current = 0 // Reset backoff on successful connect
      }

      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data)
          // Agent activity logs (from /api/tasks/log broadcasts)
          if (data.type === 'activity') {
            appendActivityEvent({
              id: `${data.ts}-activity-${data.agent}`,
              ts: data.ts,
              type: 'log',
              agent: data.agent || 'system',
              message: data.message,
              taskId: data.taskId,
            })
            return
          }

          // Audit events from audit.jsonl broadcasts
          if (data.type === 'audit' && data.entry) {
            const entry = data.entry
            const entryData = entry.data || {}
            appendAuditEntry(entry)
            appendActivityEvent({
              id: `${entry.ts}-${entry.event}-${entry.agent}`,
              ts: entry.ts,
              type: 'audit',
              agent: entry.agent || 'system',
              message: mapAuditMessage(entry.event, entryData),
              taskId: entryData.taskId as string | undefined,
              taskTitle: entryData.title as string | undefined,
              eventName: entry.event,
            })
          }

          // Workflow plugin events
          if (data.type === 'plugin-event' && typeof data.event === 'string' && data.event.startsWith('workflow.')) {
            // Trigger full UI refresh for gate events so task cards update
            if (data.event.startsWith('workflow.gate') || data.event === 'workflow.complete') {
              initialize()
            }
            // Synthesize an audit entry so other consumers see it
            appendAuditEntry({
              ts: data.timestamp || new Date().toISOString(),
              event: data.event,
              agent: 'workflow',
              data: { taskId: data.taskId, label: data.label, agent: data.agent, reason: data.reason, workflowId: data.workflowId },
            })
            // Route to unified activity feed
            appendActivityEvent({
              id: `${data.timestamp || new Date().toISOString()}-${data.event}-workflow`,
              ts: data.timestamp || new Date().toISOString(),
              type: 'audit',
              agent: 'workflow',
              message: mapAuditMessage(data.event, data),
              taskId: data.taskId,
              eventName: data.event,
            })
          }

          // Watchdog alerts
          if (data.type === 'alert') {
            appendActivityEvent({
              id: `${data.timestamp || new Date().toISOString()}-alert-system`,
              ts: data.timestamp || new Date().toISOString(),
              type: 'alert',
              agent: 'system',
              message: data.message || 'Watchdog alert',
            })
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
        setSseConnected(false)
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
  }, [updateFile, setConnected, setHeartbeats, initialize, appendAuditEntry, appendActivityEvent, setSseConnected])
}
