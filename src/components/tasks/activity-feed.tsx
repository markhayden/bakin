'use client'

import { useState, useEffect, useCallback } from 'react'
import { ChevronRight, Workflow, Zap, Radio, MonitorDot, Plug, Code } from 'lucide-react'
import { useActivityContext } from '@/context/activity-context'
import { useContentStore } from '@/hooks/use-content-store'
import { AgentAvatar } from '@/components/agent-avatar'

/** Normalize agent IDs for display — "main" is the main-operator process */
const DISPLAY_AGENT: Record<string, string> = {
  main: 'system',
}

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

export function ActivityFeed() {
  const { open, toggle } = useActivityContext()
  const events = useContentStore((s) => s.activityEvents)
  const connected = useContentStore((s) => s.sseConnected)
  const [, setTick] = useState(0)
  const [verbose, setVerbose] = useState(() => {
    if (typeof window === 'undefined') return true
    return localStorage.getItem('bakin-activity-verbose') !== 'false'
  })
  const toggleVerbose = useCallback(() => {
    setVerbose((v) => {
      const next = !v
      localStorage.setItem('bakin-activity-verbose', String(next))
      return next
    })
  }, [])

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
          className="fixed right-0 top-[calc(50%+28px)] -translate-y-1/2 z-50 flex w-8 flex-col items-center justify-center gap-2 py-4 rounded-l-md border border-r-0 border-border bg-card/95 backdrop-blur-sm transition-colors hover:bg-surface-elevated"
        >
          <span className={`h-2 w-2 rounded-full ${connected ? 'bg-success animate-pulse' : 'bg-muted-foreground'}`} />
          <span className="text-[10px] font-medium text-muted-foreground [writing-mode:vertical-lr]">
            Live Activity
          </span>
        </button>
      )}

      {/* Full-height panel */}
      <div
        className="flex w-[360px] h-full flex-col bg-background"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${connected ? 'bg-success animate-pulse' : 'bg-muted-foreground'}`} />
            <span className="text-sm font-medium text-foreground">Live Activity</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={toggleVerbose}
              title={verbose ? 'Hide command names' : 'Show command names'}
              className={`transition-colors p-1 rounded-md hover:bg-[rgba(255,255,255,0.06)] ${verbose ? 'text-foreground' : 'text-muted-foreground/50'}`}
            >
              <Code className="size-3.5" />
            </button>
            <button
              onClick={toggle}
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
          {events.map((evt, i) => (
            <div
              key={`${evt.id}-${i}`}
              className={`flex gap-2.5 px-3 py-2.5 hover:bg-muted/50 transition-colors border-b border-border/60 last:border-0 ${
                evt.type === 'alert' ? 'bg-warning/10' : ''
              }`}
            >
              <FeedAvatar agent={DISPLAY_AGENT[evt.agent] ?? evt.agent} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-1.5 mb-0.5">
                  <span
                    className="text-[11px] font-medium"
                    style={{ color: SYSTEM_SOURCES.has(DISPLAY_AGENT[evt.agent] ?? evt.agent) ? 'var(--muted-foreground)' : `var(--agent-${DISPLAY_AGENT[evt.agent] ?? evt.agent}, var(--muted-foreground))` }}
                  >
                    {DISPLAY_AGENT[evt.agent] ?? evt.agent}
                  </span>
                  <span className="text-muted-foreground text-[10px] shrink-0 tabular-nums">{relativeTime(evt.ts)}</span>
                </div>
                {evt.taskTitle && evt.type === 'log' && (
                  <p className="text-[10px] text-muted-foreground mb-0.5 truncate">{evt.taskTitle}</p>
                )}
                <p className={`text-[12px] leading-snug break-words ${
                  evt.type === 'alert' ? 'text-warning' : 'text-foreground/80'
                }`}>{evt.message}</p>
                {verbose && evt.eventName && (
                  <p className="text-[10px] text-muted-foreground/60 mt-0.5 truncate font-mono">{evt.eventName}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}
