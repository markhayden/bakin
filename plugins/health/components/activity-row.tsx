'use client'

import { ListRow, StatusBadge, type StatusTone } from '@makinbakin/sdk/patterns'
import type { UsageEntry } from '../types'

export function formatActivityName(value: string): string {
  const formatted = value
    .replace(/^bakin_exec_/, '')
    .replace(/^\/api\/plugins\//, '')
    .replace(/[._:/-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/\bMcp\b/g, 'MCP')
    .replace(/\bApi\b/g, 'API')
  return /^\s*MCP\s*$/i.test(formatted) ? 'MCP Endpoint' : formatted
}

const HTTP_FAILURE_LABEL: Record<number, string> = {
  400: 'Invalid request',
  401: 'Authentication required',
  403: 'Access denied',
  404: 'Endpoint not found',
  408: 'Request timed out',
  409: 'Request conflicted with current state',
  429: 'Rate limit exceeded',
  500: 'Server error',
  502: 'Upstream service returned an invalid response',
  503: 'Service unavailable',
  504: 'Upstream service timed out',
}

export function activityFailureReason(entry: UsageEntry): string {
  const meta = entry.meta ?? {}
  for (const key of ['error', 'errorMessage', 'message', 'reason']) {
    const value = meta[key]
    if (typeof value !== 'string') continue
    const normalized = value.trim()
    if (normalized.length > 0 && !/^(unknown|undefined|null)$/i.test(normalized)) return normalized
  }
  const status = typeof meta.httpStatus === 'number'
    ? meta.httpStatus
    : typeof meta.statusCode === 'number' ? meta.statusCode : null
  if (status !== null) {
    return `${HTTP_FAILURE_LABEL[status] ?? 'Request failed'} (HTTP ${status}).`
  }
  return 'No failure reason was reported.'
}

export function activityOwner(entry: UsageEntry): string {
  if (entry.agent) return entry.agent
  if (entry.activityClass === 'system' || entry.activityClass === 'routine') return 'Bakin system'
  return 'Agent not recorded'
}

export function isCanceledActivity(entry: UsageEntry): boolean {
  const terminalStatus = entry.meta?.terminalStatus ?? entry.meta?.turnTerminalStatus
  return entry.status === 'ok' && terminalStatus === 'aborted'
}

export function isUnverifiedActivity(entry: UsageEntry): boolean {
  return entry.status === 'ok'
    && entry.meta?.resultMissing === true
    && entry.meta?.turnTerminalStatus === 'completed'
}

export function activityImpact(entry: UsageEntry): string {
  if (isCanceledActivity(entry)) {
    if (entry.kind === 'agent') return 'Agent work was canceled before completion.'
    if (entry.kind === 'rest') return 'The request was canceled before completion.'
    return 'The tool call was canceled before completion.'
  }
  if (isUnverifiedActivity(entry)) {
    return 'The owning turn ended, but Bakin did not receive this tool call’s final result event.'
  }
  if (entry.status === 'ok') {
    if (entry.kind === 'agent') return 'Agent work completed successfully.'
    if (entry.kind === 'rest') return 'The request completed successfully.'
    return 'The tool completed successfully.'
  }
  if (entry.kind === 'agent') return 'Agent work did not complete. Retry it; if this keeps happening, run health checks.'
  if (entry.kind === 'rest') return 'A request did not complete. If this keeps happening, run health checks or review the calling integration.'
  return 'A tool call did not complete. Retry it; if this keeps happening, run health checks.'
}

function formatWhen(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export function ActivityRow({ entry }: { entry: UsageEntry }) {
  const failed = entry.status === 'error'
  const aborted = isCanceledActivity(entry)
  const unverified = isUnverifiedActivity(entry)
  const state = failed
    ? { label: 'Failed', tone: 'danger' as StatusTone }
    : aborted
      ? { label: 'Canceled', tone: 'neutral' as StatusTone }
      : unverified
        ? { label: 'Result not observed', tone: 'attention' as StatusTone }
        : { label: 'Succeeded', tone: 'success' as StatusTone }
  return (
    <ListRow data-status={aborted ? 'aborted' : unverified ? 'unverified' : entry.status}>
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-bakin-3">
        <div className="min-w-0 space-y-bakin-1">
          <div className="flex flex-wrap items-center gap-bakin-2">
            <span className="font-bakin-typography-weight-medium text-bakin-text-primary">{formatActivityName(entry.name)}</span>
            <StatusBadge tone={state.tone} variant="solid">{state.label}</StatusBadge>
            {entry.activityClass === 'routine' && <StatusBadge tone="neutral" variant="soft">Routine</StatusBadge>}
          </div>
          {failed && <p className="text-bakin-typography-size-body text-bakin-text-primary">{activityFailureReason(entry)}</p>}
          <p className={failed ? 'text-bakin-typography-size-meta text-bakin-text-muted' : 'text-bakin-typography-size-body text-bakin-text-muted'}>{activityImpact(entry)}</p>
        </div>
        <time dateTime={entry.ts} className="shrink-0 text-bakin-typography-size-meta text-bakin-text-muted">{formatWhen(entry.ts)}</time>
      </div>

      <details className="mt-bakin-3 text-bakin-typography-size-meta text-bakin-text-muted">
        <summary className="w-fit rounded-bakin-control underline-offset-4 hover:text-bakin-text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bakin-focus-ring">
          Technical details
        </summary>
        <dl className="mt-bakin-2 grid gap-x-bakin-4 gap-y-bakin-1 border-l-2 border-bakin-border-subtle bg-bakin-canvas-default px-bakin-3 py-bakin-2 sm:grid-cols-[max-content_1fr]">
          <dt>Raw name</dt><dd className="break-all font-bakin-typography-family-mono text-bakin-text-primary">{entry.name}</dd>
          <dt>Kind</dt><dd className="text-bakin-text-primary">{entry.kind}</dd>
          <dt>Class</dt><dd className="text-bakin-text-primary">{entry.activityClass}</dd>
          <dt>Agent</dt><dd className="text-bakin-text-primary">{activityOwner(entry)}</dd>
          <dt>Duration</dt><dd className="text-bakin-text-primary">{entry.durationMs === null ? 'Not recorded' : `${entry.durationMs.toLocaleString()} ms`}</dd>
          {entry.meta && <><dt>Metadata</dt><dd className="min-w-0 overflow-x-auto whitespace-pre-wrap break-all font-bakin-typography-family-mono text-bakin-text-primary">{JSON.stringify(entry.meta, null, 2)}</dd></>}
        </dl>
      </details>
    </ListRow>
  )
}
