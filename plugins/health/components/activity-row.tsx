'use client'

import { Badge } from '@makinbakin/sdk/ui'
import type { UsageEntry } from '../types'

function humanize(value: string): string {
  return value
    .replace(/^bakin_exec_/, '')
    .replace(/^\/api\/plugins\//, '')
    .replace(/[._:/-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function impact(entry: UsageEntry): string {
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
  return (
    <li className="rounded-xl border border-border/80 bg-card p-4" data-status={entry.status}>
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-foreground">{humanize(entry.name)}</span>
            <Badge variant="outline" className={failed ? 'border-destructive/30 text-destructive' : 'text-muted-foreground'}>
              {failed ? 'Failed' : 'Succeeded'}
            </Badge>
            {entry.activityClass === 'routine' && <Badge variant="secondary">Routine</Badge>}
          </div>
          <p className="text-sm text-muted-foreground">{impact(entry)}</p>
        </div>
        <time dateTime={entry.ts} className="shrink-0 text-xs text-muted-foreground">{formatWhen(entry.ts)}</time>
      </div>

      <details className="mt-3 text-xs text-muted-foreground">
        <summary className="w-fit rounded-sm underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Technical details
        </summary>
        <dl className="mt-2 grid gap-x-4 gap-y-1 rounded-lg bg-muted/40 p-3 sm:grid-cols-[max-content_1fr]">
          <dt>Raw name</dt><dd className="break-all font-mono text-foreground">{entry.name}</dd>
          <dt>Kind</dt><dd className="text-foreground">{entry.kind}</dd>
          <dt>Class</dt><dd className="text-foreground">{entry.activityClass}</dd>
          <dt>Agent</dt><dd className="text-foreground">{entry.agent ?? 'System / unknown'}</dd>
          <dt>Duration</dt><dd className="text-foreground">{entry.durationMs === null ? 'Not recorded' : `${entry.durationMs.toLocaleString()} ms`}</dd>
          {entry.meta && <><dt>Metadata</dt><dd className="min-w-0 overflow-x-auto whitespace-pre-wrap break-all font-mono text-foreground">{JSON.stringify(entry.meta, null, 2)}</dd></>}
        </dl>
      </details>
    </li>
  )
}
