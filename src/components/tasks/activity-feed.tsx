'use client'

import { useState, useEffect } from 'react'
import { ChevronRight, Workflow, Zap, Radio, MonitorDot, Plug } from 'lucide-react'
import { useAgent, useContentStore } from '@makinbakin/sdk/hooks'
import { Button } from '@makinbakin/sdk/ui'
import { useActivityContext } from '@/context/activity-context'
import { AgentAvatar } from '@/components/agent-avatar'

/** Non-agent sources that will never have a headshot image */
const SYSTEM_SOURCES = new Set(['system', 'workflow', 'dispatch', 'watchdog', 'dashboard', 'api'])

const SYSTEM_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  workflow: Workflow,
  system: Zap,
  dispatch: Radio,
  watchdog: MonitorDot,
  dashboard: MonitorDot,
  api: Plug,
}

/** Agent rows show the DISPLAY name (H'enrich, not enrich); system sources keep their id. */
function FeedAgentName({ agent }: { agent: string }) {
  const resolved = useAgent(agent)
  const label = SYSTEM_SOURCES.has(agent) ? agent : resolved?.name || agent
  return (
    <span
      className="text-bakin-typography-size-meta font-medium"
      style={{ color: SYSTEM_SOURCES.has(agent) ? 'var(--bakin-color-text-muted)' : `var(--agent-${agent}, var(--bakin-color-text-muted))` }}
    >
      {label}
    </span>
  )
}

function FeedAvatar({ agent }: { agent: string }) {
  if (SYSTEM_SOURCES.has(agent)) {
    const Icon = SYSTEM_ICONS[agent] || Zap
    return (
      <span className="size-6 rounded-full bg-muted flex items-center justify-center shrink-0">
        <Icon className="size-3.5 text-bakin-text-muted" />
      </span>
    )
  }
  return <AgentAvatar agentId={agent} size="sm" />
}

function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime()
  if (isNaN(diff) || diff < 0) return 'just now'
  const seconds = Math.floor(diff / 1000)
  if (seconds < 10) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function textField(data: Record<string, unknown>, key: string): string | null {
  const value = data[key]
  return typeof value === 'string' && value.trim() ? value : null
}

function DispatchFailureDebug({ data }: { data?: Record<string, unknown> }) {
  if (!isRecord(data)) return null
  const rows = [
    ['Cause', textField(data, 'specificReason')],
    ['Provider', textField(data, 'provider')],
    ['Model', textField(data, 'model')],
    ['Retryable', typeof data.retryable === 'boolean' ? (data.retryable ? 'Yes' : 'No') : null],
  ].filter((row): row is [string, string] => !!row[1])
  const rawError = textField(data, 'rawError')
  if (rows.length === 0 && !rawError) return null

  return (
    <div className="mt-2 rounded-md bg-muted/40 px-2 py-1.5 text-bakin-typography-size-meta text-bakin-text-muted">
      {rows.length > 0 && (
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          {rows.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <span className="text-bakin-text-muted/60">{label}: </span>
              <span className="text-bakin-text-primary/70">{value}</span>
            </div>
          ))}
        </div>
      )}
      {rawError && (
        <details className="mt-1">
          <summary className="cursor-pointer text-bakin-text-muted/70">Raw error</summary>
          <p className="mt-1 break-words font-mono text-bakin-typography-size-meta leading-snug">{rawError}</p>
        </details>
      )}
    </div>
  )
}

export function ActivityFeed() {
  const { open, toggle } = useActivityContext()
  const events = useContentStore((s) => s.activityEvents)
  const debug = useContentStore((s) => s.debug)
  const [, setTick] = useState(0)

  // Force re-render every 30s to keep relative timestamps fresh
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 30_000)
    return () => clearInterval(timer)
  }, [])

  return (
    <>
      {/* Desktop collapsed toggle; mobile activity lives in the host nav. */}
      {!open && (
        <Button
          type="button"
          variant="outline"
          size="icon-md"
          onClick={toggle}
          aria-label="Open Live Activity"
          title="Live Activity"
          className="fixed bottom-bakin-4 right-bakin-4 top-auto z-50 hidden translate-y-0 rounded-bakin-pill border-bakin-border-subtle/30 bg-bakin-surface-default/95 shadow-bakin-elevation-overlay backdrop-blur-sm hover:bg-surface-elevated active:not-aria-[haspopup]:translate-y-0 md:inline-flex"
        >
          <Radio aria-hidden="true" className="size-bakin-4 text-bakin-text-muted" />
          <span className="sr-only">
            Live Activity
          </span>
        </Button>
      )}

      {/* Full-height panel */}
      <div
        className="flex h-full w-[min(360px,100vw)] flex-col bg-bakin-canvas-default"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-bakin-border-subtle/30 px-3 py-2">
          <div className="flex items-center">
            <span className="text-sm font-medium text-bakin-text-primary">Live Activity</span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={toggle}
              aria-label="Close Live Activity"
              className="text-bakin-text-muted hover:text-bakin-text-primary"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>

        {/* Event list */}
        <div className="flex-1 overflow-y-auto py-1 flex flex-col">
          {events.length === 0 && (
            <p className="text-xs text-bakin-text-muted text-center mt-8">No activity yet</p>
          )}
          {events.filter((evt) => debug || !evt.duplicate).map((evt, i) => (
            <div
              key={`${evt.id}-${i}`}
              className={`flex gap-2.5 px-3 py-2.5 hover:bg-muted/50 transition-colors border-b border-bakin-border-subtle/18 last:border-0 ${
                evt.type === 'alert' ? 'bg-warning/10' : ''
              }`}
            >
              <FeedAvatar agent={evt.agent} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1.5 mb-0.5">
                  <FeedAgentName agent={evt.agent} />
                  <span className="text-bakin-text-muted text-bakin-typography-size-meta shrink-0 tabular-nums">{relativeTime(evt.ts)}</span>
                </div>
                {evt.taskTitle && evt.type === 'log' && (
                  <p className="text-bakin-typography-size-meta text-bakin-text-muted mb-0.5 truncate">{evt.taskTitle}</p>
                )}
                <p className={`text-bakin-typography-size-body leading-snug break-words ${
                  evt.type === 'alert' ? 'text-warning' : 'text-bakin-text-primary/80'
                }`}>{evt.message}</p>
                {evt.eventName && (
                  <p className="text-bakin-typography-size-meta text-bakin-text-muted/60 mt-0.5 truncate font-mono">{evt.eventName}</p>
                )}
                {debug && evt.eventName === 'task.dispatch_failed' && (
                  <DispatchFailureDebug data={evt.data} />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
