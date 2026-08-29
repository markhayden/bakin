'use client'

import { useState, useEffect } from 'react'
import { ChevronRight, Workflow, Zap, Radio, MonitorDot, Plug } from 'lucide-react'
import { useAgent, useContentStore } from '@makinbakin/sdk/hooks'
import { DisclosurePanel } from '@makinbakin/sdk/layout'
import { KeyValue, ListRow, ListRows } from '@makinbakin/sdk/patterns'
import { Avatar, AvatarFallback, Button, SystemState } from '@makinbakin/sdk/ui'
import { useActivityContext } from '@/context/activity-context'
import { AgentAvatar } from '@/components/agent-avatar'
import { cn, formatAge } from '@makinbakin/sdk/utils'

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
      className="text-bakin-typography-size-meta font-bakin-typography-weight-medium"
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
      <Avatar size="sm">
        <AvatarFallback>
          <Icon className="size-bakin-3" aria-hidden="true" />
        </AvatarFallback>
      </Avatar>
    )
  }
  return <AgentAvatar agentId={agent} size="sm" />
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
    <div className="mt-bakin-2 rounded-md bg-bakin-surface-elevated/40 px-bakin-2 py-1.5 text-bakin-typography-size-meta text-bakin-text-muted">
      {rows.length > 0 && (
        <KeyValue layout="inline" items={rows.map(([label, value]) => ({ label, value }))} />
      )}
      {rawError && (
        <DisclosurePanel variant="ghost" summary="Raw error" className="mt-bakin-1">
          <p className="m-0 break-words font-mono text-bakin-typography-size-meta leading-snug">{rawError}</p>
        </DisclosurePanel>
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
          className="fixed bottom-bakin-4 right-bakin-4 top-auto z-50 hidden translate-y-0 rounded-bakin-pill border-bakin-border-subtle/30 bg-bakin-surface-default/95 shadow-bakin-elevation-overlay backdrop-blur-sm hover:bg-bakin-surface-elevated active:not-aria-[haspopup]:translate-y-0 md:inline-flex"
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
        <div className="flex items-center justify-between border-b border-bakin-border-subtle/30 px-bakin-3 py-bakin-2">
          <div className="flex items-center">
            <span className="text-sm font-bakin-typography-weight-medium text-bakin-text-primary">Live Activity</span>
          </div>
          <div className="flex items-center gap-bakin-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={toggle}
              aria-label="Close Live Activity"
              className="text-bakin-text-muted hover:text-bakin-text-primary"
            >
              <ChevronRight className="size-bakin-4" />
            </Button>
          </div>
        </div>

        {/* Event list */}
        <div className="flex-1 overflow-y-auto py-bakin-1 flex flex-col">
          {events.length === 0 && (
            <SystemState kind="initial-empty" scope="section" title="No activity yet" />
          )}
          {/* ListRows sm is the documented dense rail/feed scale; rows are
              identity-led (avatar + agent), not status-led, and this 360px
              rail never reaches Timeline's gutter breakpoint. */}
          {events.length > 0 && (
            <ListRows variant="separated" size="sm" aria-label="Live activity">
              {events.filter((evt) => debug || !evt.duplicate).map((evt, i) => (
                <ListRow
                  key={`${evt.id}-${i}`}
                  className={cn('flex gap-bakin-2', evt.type === 'alert' && 'bg-bakin-signal-highlight/10')}
                >
                  <FeedAvatar agent={evt.agent} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1.5 mb-0.5">
                      <FeedAgentName agent={evt.agent} />
                      <span className="text-bakin-text-muted text-bakin-typography-size-meta shrink-0 tabular-nums">{formatAge(evt.ts, { precise: true })}</span>
                    </div>
                    {evt.taskTitle && evt.type === 'log' && (
                      <p className="text-bakin-typography-size-meta text-bakin-text-muted mb-0.5 truncate">{evt.taskTitle}</p>
                    )}
                    <p className={cn('text-bakin-typography-size-body leading-snug break-words', evt.type === 'alert' ? 'text-bakin-signal-highlight' : 'text-bakin-text-primary')}>{evt.message}</p>
                    {evt.eventName && (
                      <p className="text-bakin-typography-size-meta text-bakin-text-muted mt-0.5 truncate font-mono">{evt.eventName}</p>
                    )}
                    {debug && evt.eventName === 'task.dispatch_failed' && (
                      <DispatchFailureDebug data={evt.data} />
                    )}
                  </div>
                </ListRow>
              ))}
            </ListRows>
          )}
        </div>
      </div>
    </>
  )
}
