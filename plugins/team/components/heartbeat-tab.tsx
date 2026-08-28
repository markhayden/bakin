'use client'

import { Heart } from 'lucide-react'
import { MarkdownContent } from '@makinbakin/sdk/content'
import { Inline, Panel, Section } from '@makinbakin/sdk/layout'
import { StatusBadge } from '@makinbakin/sdk/patterns'
import { SystemState } from '@makinbakin/sdk/ui'
import { useJsonFetch } from '@makinbakin/sdk/hooks'
import type { HeartbeatRaw } from '../types'
import { formatAge } from '@makinbakin/sdk/utils'

const HEARTBEAT_DISABLED_REASON =
  'HEARTBEAT.md is maintained by the agent. Editing it here would conflict with the next agent-written update.'

export interface HeartbeatTabProps {
  agentId: string
}

/** Heartbeats are a liveness signal, so sub-minute ages must resolve. */
function formatHeartbeatAge(isoTimestamp: string | null): string {
  if (!isoTimestamp) return ''
  if (Number.isNaN(new Date(isoTimestamp).getTime())) return ''
  return formatAge(isoTimestamp, { precise: true })
}


export function HeartbeatTab({ agentId }: HeartbeatTabProps) {
  const { data, loading, error: fetchError } = useJsonFetch<{
    ok: boolean
    heartbeat: HeartbeatRaw | null
    error?: string
  }>(`/api/plugins/team/${agentId}/heartbeat`)
  const heartbeat = data?.ok ? data.heartbeat : null
  const error = fetchError ?? (data && !data.ok
    ? (data.error ?? 'Failed to load heartbeat')
    : null)

  if (loading) {
    return (
      <SystemState
        kind="loading"
        scope="page"
        title="Loading heartbeat"
        description="The agent-authored status narrative will appear when ready."
      />
    )
  }

  if (error) {
    return (
      <SystemState
        kind="error"
        recovery="unavailable"
        scope="page"
        title="Heartbeat unavailable"
        description={error}
      />
    )
  }

  if (!heartbeat) {
    return (
      <SystemState
        kind="initial-empty"
        scope="page"
        title="No heartbeat yet"
        description="HEARTBEAT.md appears after this agent writes its first narrative status update."
        action={(
          <span className="inline-flex items-center gap-bakin-2 text-bakin-typography-size-meta text-bakin-text-muted">
            <Heart aria-hidden="true" className="size-bakin-4" />
            Waiting for an agent update
          </span>
        )}
      />
    )
  }

  const lastUpdated = formatHeartbeatAge(heartbeat.lastUpdated)

  return (
    <Section spacing="compact">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-bakin-3">
        <div>
          <h2>
            Agent heartbeat
          </h2>
          <p className="m-0 mt-bakin-1 text-bakin-text-muted">
            Read-only narrative maintained by the agent while it works.
          </p>
        </div>
        <Inline gap="dense">
          {lastUpdated ? (
            <StatusBadge tone="neutral" variant="solid" size="xs">
              Last updated {lastUpdated}
            </StatusBadge>
          ) : null}
          <p className="m-0 max-w-prose text-bakin-typography-size-meta text-bakin-text-muted">
            {HEARTBEAT_DISABLED_REASON}
          </p>
        </Inline>
      </div>

      <Panel className="min-h-96">
        <MarkdownContent content={heartbeat.content} />
      </Panel>
    </Section>
  )
}
