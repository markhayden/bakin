'use client'

import { Heart, Pencil } from 'lucide-react'
import { MarkdownContent } from '@makinbakin/sdk/content'
import { Section } from '@makinbakin/sdk/layout'
import { StatusBadge } from '@makinbakin/sdk/patterns'
import { Button, SystemState } from '@makinbakin/sdk/ui'
import { useJsonFetch } from '@makinbakin/sdk/hooks'
import type { HeartbeatRaw } from '../types'

const HEARTBEAT_DISABLED_REASON =
  'HEARTBEAT.md is maintained by the agent. Editing it here would conflict with the next agent-written update.'

export interface HeartbeatTabProps {
  agentId: string
}

function formatRelative(isoTimestamp: string | null): string {
  if (!isoTimestamp) return ''
  const timestamp = new Date(isoTimestamp).getTime()
  if (Number.isNaN(timestamp)) return ''
  const seconds = Math.round((Date.now() - timestamp) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
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

  const lastUpdated = formatRelative(heartbeat.lastUpdated)

  return (
    <Section spacing="compact">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-bakin-3">
        <div>
          <h2 className="m-0 text-bakin-typography-size-title font-bakin-typography-weight-semibold text-bakin-text-primary">
            Agent heartbeat
          </h2>
          <p className="m-0 mt-bakin-1 text-bakin-text-muted">
            Read-only narrative maintained by the agent while it works.
          </p>
        </div>
        <div className="flex items-center gap-bakin-2">
          {lastUpdated ? (
            <StatusBadge tone="neutral" variant="solid" size="xs">
              Last updated {lastUpdated}
            </StatusBadge>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled
            aria-disabled="true"
            title={HEARTBEAT_DISABLED_REASON}
            aria-label={`Edit disabled — ${HEARTBEAT_DISABLED_REASON}`}
          >
            <Pencil aria-hidden="true" />
          </Button>
        </div>
      </div>

      <div className="min-h-96 rounded-bakin-surface border border-bakin-border-subtle bg-bakin-surface-default p-bakin-4">
        <MarkdownContent content={heartbeat.content} />
      </div>
    </Section>
  )
}
