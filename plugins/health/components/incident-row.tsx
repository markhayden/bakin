'use client'

import { useId, useState } from 'react'
import type { HealthIncident, HealthObservation, HealthObservationStatus } from '@makinbakin/sdk/types'
import { formatAbsoluteTime, formatRelativeTime, StatusBadge } from '@makinbakin/sdk/components'
import { Button, buttonVariants } from '@makinbakin/sdk/ui'
import { ChevronRight, ExternalLink, Wrench } from 'lucide-react'
import type { OverviewIncident, OverviewTone } from '../lib/health-view-model'

export interface IncidentRowProps {
  item: OverviewIncident
  onRepair?: (incident: HealthIncident) => void
  onRerun?: (incident: HealthIncident) => void
}

function healthStatus(status: HealthObservationStatus): { label: string; tone: OverviewTone } {
  switch (status) {
    case 'healthy': return { label: 'Healthy', tone: 'success' }
    case 'error': return { label: 'Error', tone: 'destructive' }
    case 'warning': return { label: 'Warning', tone: 'warning' }
    case 'unknown': return { label: 'Unknown', tone: 'neutral' }
  }
}

function EvidenceTime({ value, stale }: { value: string; stale: boolean }) {
  const relative = formatRelativeTime(value)
  return (
    <time dateTime={value} title={formatAbsoluteTime(value)}>
      {stale ? 'Stale evidence' : 'Oldest evidence'} · {relative || formatAbsoluteTime(value)}
    </time>
  )
}

function ObservationEvidence({ observation }: { observation: HealthObservation }) {
  const status = healthStatus(observation.status)
  return (
    <div className="space-y-2 rounded-lg bg-foreground/[0.03] p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">{observation.checkName}</p>
        <StatusBadge tone={status.tone} variant="outline">{status.label}</StatusBadge>
      </div>
      <p>{observation.summary}</p>
      {observation.detail && <p className="text-muted-foreground">{observation.detail}</p>}
      <dl className="grid gap-x-3 gap-y-1 text-xs text-muted-foreground sm:grid-cols-[auto_1fr]">
        <dt>Observed</dt>
        <dd><time dateTime={observation.observedAt}>{formatAbsoluteTime(observation.observedAt)}</time></dd>
        <dt>Checked</dt>
        <dd><time dateTime={observation.checkedAt}>{formatAbsoluteTime(observation.checkedAt)}</time></dd>
        <dt>Snapshot</dt>
        <dd>{observation.snapshot === 'last_known' ? 'Last known' : 'Current'}</dd>
      </dl>
      {observation.evidence && (
        <pre className="max-h-72 overflow-auto rounded-md bg-background p-3 text-xs text-foreground ring-1 ring-foreground/10">
          {JSON.stringify(observation.evidence, null, 2)}
        </pre>
      )}
    </div>
  )
}

export function IncidentRow({ item, onRepair, onRerun }: IncidentRowProps) {
  const instructionsId = useId()
  const [showInstructions, setShowInstructions] = useState(false)
  const { incident } = item
  const status = healthStatus(incident.status)
  const resolution = incident.resolution

  let primaryAction
  switch (resolution.type) {
    case 'repair':
      primaryAction = (
        <Button size="sm" variant="outline" onClick={() => onRepair?.(incident)}>
          <Wrench aria-hidden="true" />
          Review repair
        </Button>
      )
      break
    case 'navigate':
      primaryAction = (
        <a href={resolution.href} className={buttonVariants({ size: 'sm', variant: 'outline' })}>
          {resolution.label}
          <ExternalLink aria-hidden="true" />
        </a>
      )
      break
    case 'instructions':
      primaryAction = (
        <Button
          size="sm"
          variant="outline"
          aria-expanded={showInstructions}
          aria-controls={instructionsId}
          onClick={() => setShowInstructions((shown) => !shown)}
        >
          <ChevronRight className={showInstructions ? 'rotate-90' : ''} aria-hidden="true" />
          Show resolution steps
        </Button>
      )
      break
    case 'rerun':
      primaryAction = (
        <Button size="sm" variant="outline" onClick={() => onRerun?.(incident)}>
          Check again
        </Button>
      )
      break
  }

  return (
    <article className="rounded-xl bg-card p-4 ring-1 ring-foreground/10" data-incident-id={incident.id}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
            {item.freshness === 'stale' && <StatusBadge tone="neutral" variant="outline">Last known</StatusBadge>}
            <span className="text-xs text-muted-foreground">
              <EvidenceTime value={item.oldestEvidenceAt} stale={item.freshness === 'stale'} />
            </span>
          </div>
          <h3 className="font-semibold text-foreground">{incident.title}</h3>
          <p className="text-sm text-muted-foreground">{incident.impact}</p>
          {incident.resources.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Affected resources">
              {incident.resources.map((resource) => (
                <li key={`${resource.kind}:${resource.id}`}>
                  <StatusBadge tone="neutral" variant="outline">{resource.label ?? resource.id}</StatusBadge>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="shrink-0">{primaryAction}</div>
      </div>

      {resolution.type === 'instructions' && showInstructions && (
        <div id={instructionsId} className="mt-4 rounded-lg bg-foreground/[0.03] p-3 text-sm">
          <ol className="list-decimal space-y-1 pl-5">
            {resolution.steps.map((step) => <li key={step}>{step}</li>)}
          </ol>
          {resolution.command && (
            <code className="mt-3 block overflow-auto rounded-md bg-background p-2 text-xs ring-1 ring-foreground/10">
              {resolution.command}
            </code>
          )}
        </div>
      )}

      <details className="mt-4 border-t border-border/70 pt-3 text-sm">
        <summary className="cursor-pointer font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          Technical evidence
        </summary>
        <div className="mt-3 space-y-3">
          {item.observations.length > 0
            ? item.observations.map((observation) => <ObservationEvidence key={observation.id} observation={observation} />)
            : <p className="text-muted-foreground">No observation payload is available for this incident.</p>}
        </div>
      </details>
    </article>
  )
}
