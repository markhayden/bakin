'use client'

import { useEffect, useRef } from 'react'
import { useContentStore } from './use-content-store'
import { emitPluginEvent } from './use-plugin-event'
import type { Heartbeat } from '@/types'
import { mapAuditMessage } from '@/lib/map-audit-message'
import { sendBrowserNotification } from '@/lib/browser-notify'

const MAX_RETRIES = 20
const BASE_DELAY = 1000
const MAX_DELAY = 30000

function isDevPluginHotReloadActive(): boolean {
  return typeof document !== 'undefined' && !!document.querySelector('script[src="/__bakin-dev/client.js"]')
}

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
          // Fan every plugin-event payload out to usePluginEvent subscribers
          // over this single connection (plugins no longer open their own).
          if (data.type === 'plugin-event') {
            emitPluginEvent(data)
          }
          // Taskboard changed (SQLite mutation) — notify subscribers via the
          // same fan-out (the tasks board + nav badge subscribe to 'taskboard').
          if (data.type === 'taskboard') {
            emitPluginEvent({ event: 'taskboard' })
            return
          }

          // Installed/removed user plugins change the runtime manifest.
          // Dev tabs handle this through the dev hot-swap client; normal
          // tabs need a page reload so PluginHost re-fetches the manifest.
          if (data.type === 'plugin:manifest-changed') {
            if (!isDevPluginHotReloadActive()) {
              window.location.reload()
            }
            return
          }

          // Agent activity logs (from task log broadcasts via SSE)
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
            // A doctor run just refreshed the health-check cache — notify the
            // Health nav badge / summary (they subscribe to 'doctor.run').
            if (entry.event === 'doctor.run') emitPluginEvent({ event: 'doctor.run' })
            appendActivityEvent({
              id: `${entry.ts}-${entry.event}-${entry.agent}`,
              ts: entry.ts,
              type: 'audit',
              agent: entry.agent || 'system',
              message: mapAuditMessage(entry.event, entryData),
              taskId: entryData.taskId as string | undefined,
              taskTitle: entryData.title as string | undefined,
              eventName: entry.event,
              ...(entryData.duplicate ? { duplicate: true } : {}),
              data: entryData,
            })
          }

          // Workflow plugin events
          if (data.type === 'plugin-event' && typeof data.event === 'string' && data.event.startsWith('workflow.')) {
            // Trigger full UI refresh for gate events so task cards update
            if (data.event.startsWith('workflow.gate') || data.event === 'workflow.complete') {
              initialize()
            }
            // Browser notification for gates needing approval
            if (data.event === 'workflow.gate_reached') {
              sendBrowserNotification(
                'Approval needed',
                data.label || 'A workflow gate needs your review'
              )
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

          // Budget incidents (cost-control v2): browser notification (same
          // bell toggle as workflow gates) + an activity entry. Resolutions
          // ride emitPluginEvent (line above) for surface refreshes only.
          if (data.type === 'plugin-event' && data.event === 'budget.incident_opened') {
            sendBrowserNotification(
              'Budget alert',
              data.message || 'A budget cap was reached — dispatch may be deferred',
              '/models?tab=spend',
            )
            appendActivityEvent({
              id: `${data.timestamp || new Date().toISOString()}-budget-incident-${data.incidentId}`,
              ts: data.timestamp || new Date().toISOString(),
              type: 'alert',
              agent: 'system',
              message: data.message || 'Budget incident opened',
              eventName: 'budget.incident_opened',
              data: { incidentId: data.incidentId, scope: data.scope, scopeId: data.scopeId, lane: data.lane, window: data.window },
            })
          }

          // Brand-blocked tasks (#419): a linked brand vanished — scheduled
          // marketing must reach the operator, not wait to be found. Click
          // lands on the board pre-filtered to the affected brand.
          if (data.type === 'plugin-event' && data.event === 'brand.dispatch_blocked') {
            sendBrowserNotification(
              'Brand unavailable',
              data.message || `A task is waiting on brand '${data.brandId}'`,
              `/tasks?brand=${encodeURIComponent(data.brandId || '')}`,
            )
            appendActivityEvent({
              id: `${data.timestamp || new Date().toISOString()}-brand-blocked-${data.taskId}`,
              ts: data.timestamp || new Date().toISOString(),
              type: 'alert',
              agent: 'system',
              message: data.message || 'Task blocked on a missing brand',
              eventName: 'brand.dispatch_blocked',
              data: { taskId: data.taskId, brandId: data.brandId },
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

          // Per-table reindex events drive the Health page tiles only —
          // they don't write to the activity feed (which would be one
          // entry per table per reindex). The aggregate batch_* events
          // below give the activity feed a single start/pulse/complete
          // pair instead.
          if (data.type === 'search.rebuild.start') {
            emitPluginEvent({ event: 'search.rebuild.start', table: data.table })
          }
          if (data.type === 'search.rebuild.progress') {
            emitPluginEvent({ event: 'search.rebuild.progress', table: data.table, indexed: data.indexed ?? 0 })
          }
          if (data.type === 'search.rebuild.complete') {
            emitPluginEvent({ event: 'search.rebuild.complete', table: data.table, indexed: data.indexed ?? 0 })
          }

          // Aggregate reindex events for the activity feed — one entry
          // for the whole batch instead of one per table. batch_pulse
          // fires at most every 60s while a long reindex is in flight.
          if (data.type === 'reindex.batch_start') {
            appendActivityEvent({
              id: `${Date.now()}-reindex-batch-start`,
              ts: new Date().toISOString(),
              type: 'log',
              agent: 'system',
              message: `Starting full re-index (${data.tables} table${data.tables === 1 ? '' : 's'})`,
            })
          }
          if (data.type === 'reindex.batch_pulse') {
            const pct = data.tables_total
              ? Math.floor((data.tables_done / data.tables_total) * 100)
              : 0
            appendActivityEvent({
              id: `${Date.now()}-reindex-batch-pulse`,
              ts: new Date().toISOString(),
              type: 'log',
              agent: 'system',
              message: `Re-indexing… ${data.tables_done}/${data.tables_total} tables (${pct}%), ${data.indexed} documents so far`,
            })
          }
          if (data.type === 'reindex.batch_complete') {
            const seconds = Math.max(1, Math.round((data.elapsed_ms ?? 0) / 1000))
            appendActivityEvent({
              id: `${Date.now()}-reindex-batch-complete`,
              ts: new Date().toISOString(),
              type: 'log',
              agent: 'system',
              message: `Completed full re-index — ${data.indexed} documents across ${data.tables} table${data.tables === 1 ? '' : 's'} in ${seconds}s`,
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
