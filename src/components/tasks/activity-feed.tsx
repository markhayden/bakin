'use client'

import { useState, useEffect } from 'react'
import { ChevronRight, Workflow, Zap, Radio, MonitorDot, Plug } from 'lucide-react'
import { useActivityContext } from '@/context/activity-context'
import { useAgent, useContentStore } from '@makinbakin/sdk/hooks'
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
      className="text-[11px] font-medium"
      style={{ color: SYSTEM_SOURCES.has(agent) ? 'var(--muted-foreground)' : `var(--agent-${agent}, var(--muted-foreground))` }}
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
        <Icon className="size-3.5 text-muted-foreground" />
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
    <div className="mt-2 rounded-md bg-muted/40 px-2 py-1.5 text-[10px] text-muted-foreground">
      {rows.length > 0 && (
        <div className="grid grid-cols-2 gap-x-2 gap-y-1">
          {rows.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <span className="text-muted-foreground/60">{label}: </span>
              <span className="text-foreground/70">{value}</span>
            </div>
          ))}
        </div>
      )}
      {rawError && (
        <details className="mt-1">
          <summary className="cursor-pointer text-muted-foreground/70">Raw error</summary>
          <p className="mt-1 break-words font-mono text-[10px] leading-snug">{rawError}</p>
        </details>
      )}
    </div>
  )
}

export function ActivityFeed() {
  const { open, toggle } = useActivityContext()
  const events = useContentStore((s) => s.activityEvents)
  const connected = useContentStore((s) => s.sseConnected)
  const debug = useContentStore((s) => s.debug)
  const [, setTick] = useState(0)

  // Force re-render every 30s to keep relative timestamps fresh
  useEffect(() => {
    const timer = setInterval(() => setTick((t) => t + 1), 30_000)
    return () => clearInterval(timer)
  }, [])

  return (
    <>
      {/* Collapsed toggle tab — always visible */}
      {!open && (
        <button
          onClick={toggle}
          aria-label="Open Live Activity"
          title="Live Activity"
          className="fixed bottom-bakin-4 right-bakin-4 top-auto z-50 flex h-[var(--bakin-layout-size-control)] w-[var(--bakin-layout-size-control)] translate-y-0 items-center justify-center rounded-bakin-pill border border-border bg-card/95 p-0 shadow-bakin-elevation-overlay backdrop-blur-sm transition-colors hover:bg-surface-elevated"
        >
          <Radio aria-hidden="true" className="size-bakin-4 text-muted-foreground" />
          <span className={`absolute right-bakin-1 top-bakin-1 h-2 w-2 rounded-full ${connected ? 'bg-success animate-pulse' : 'bg-muted-foreground'}`} />
          <span className="sr-only">
            Live Activity
          </span>
        </button>
      )}

      {/* Full-height panel */}
      <div
        className="flex h-full w-[min(360px,100vw)] flex-col bg-background"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${connected ? 'bg-success animate-pulse' : 'bg-muted-foreground'}`} />
            <span className="text-sm font-medium text-foreground">Live Activity</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={toggle}
              aria-label="Close Live Activity"
              className="text-muted-foreground hover:text-foreground transition-colors p-1 rounded-md hover:bg-[rgba(255,255,255,0.06)]"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </div>

        {/* Event list */}
        <div className="flex-1 overflow-y-auto py-1 flex flex-col">
          {events.length === 0 && (
            <p className="text-xs text-muted-foreground text-center mt-8">No activity yet</p>
          )}
          {events.filter((evt) => debug || !evt.duplicate).map((evt, i) => (
            <div
              key={`${evt.id}-${i}`}
              className={`flex gap-2.5 px-3 py-2.5 hover:bg-muted/50 transition-colors border-b border-border/60 last:border-0 ${
                evt.type === 'alert' ? 'bg-warning/10' : ''
              }`}
            >
              <FeedAvatar agent={evt.agent} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1.5 mb-0.5">
                  <FeedAgentName agent={evt.agent} />
                  <span className="text-muted-foreground text-[10px] shrink-0 tabular-nums">{relativeTime(evt.ts)}</span>
                </div>
                {evt.taskTitle && evt.type === 'log' && (
                  <p className="text-[10px] text-muted-foreground mb-0.5 truncate">{evt.taskTitle}</p>
                )}
                <p className={`text-[12px] leading-snug break-words ${
                  evt.type === 'alert' ? 'text-warning' : 'text-foreground/80'
                }`}>{evt.message}</p>
                {evt.eventName && (
                  <p className="text-[10px] text-muted-foreground/60 mt-0.5 truncate font-mono">{evt.eventName}</p>
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
