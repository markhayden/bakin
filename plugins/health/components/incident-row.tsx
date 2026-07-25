'use client'

import { useId, useState } from 'react'
import type { HealthIncident } from '@makinbakin/sdk/types'
import { PluginLink, StatusBadge } from '@makinbakin/sdk/components'
import { Button, Popover, PopoverContent, PopoverTrigger, buttonVariants } from '@makinbakin/sdk/ui'
import { AlertTriangle, BellOff, ChevronRight, CircleHelp, Wrench } from 'lucide-react'
import type { OverviewIncident, OverviewTone } from '../lib/health-view-model'

export interface IncidentRowProps {
  item: OverviewIncident
  onRepair?: (incident: HealthIncident) => void
  onRerun?: (incident: HealthIncident) => void
  onAck?: (incident: HealthIncident, action: 'ack' | 'snooze' | 'clear', window?: '24h' | '7d') => void
}

function incidentStatus(incident: HealthIncident): {
  label: string
  tone: OverviewTone
  icon: typeof AlertTriangle
} {
  // Cards render EFFECTIVE urgency (#690) — error and unknown are never
  // demoted (evidence state is not a presentation choice), so Critical and
  // Verify keep precedence; a demoted or advisory incident reads calm.
  if (incident.status === 'error') return { label: 'Critical', tone: 'destructive', icon: AlertTriangle }
  if (incident.status === 'unknown') return { label: 'Verify', tone: 'neutral', icon: CircleHelp }
  if (incident.effectiveDisposition === 'advisory') {
    return { label: 'Advisory', tone: 'neutral', icon: CircleHelp }
  }
  return {
    label: incident.effectiveDisposition === 'action_required' ? 'Action' : 'Watch',
    tone: 'warning',
    icon: AlertTriangle,
  }
}

/** Plain-language category chip per behavior class — the card says what KIND of thing this is. */
const CLASS_LABEL: Record<NonNullable<HealthIncident['class']>, string> = {
  service_failure: 'Service issue',
  data_integrity: 'Data integrity',
  budget_block: 'Budget cap',
  evidence_gap: 'Cost accounting',
  usage_anomaly: 'Usage',
  unattributed_usage: 'Unattributed usage',
  runaway_usage: 'Runaway usage',
  cleanup_backlog: 'Housekeeping',
  policy_denial: 'Guardrail worked',
  unsupported_surface: 'Not supported here',
}

const DISPOSITION_LABEL: Record<HealthIncident['disposition'], string> = {
  advisory: 'advisory',
  watch: 'watch',
  action_required: 'action',
}

const TONE_CLASS: Record<OverviewTone, string> = {
  neutral: 'border-foreground/15 bg-foreground/[0.025]',
  success: 'border-success/25 bg-success/[0.035]',
  warning: 'border-warning/30 bg-warning/[0.045]',
  destructive: 'border-destructive/30 bg-destructive/[0.05]',
}

export function IncidentRow({ item, onRepair, onRerun, onAck }: IncidentRowProps) {
  const instructionsId = useId()
  const impactId = useId()
  const [showInstructions, setShowInstructions] = useState(false)
  const [showImpact, setShowImpact] = useState(false)
  const { incident } = item
  const resolution = incident.resolution
  const status = incidentStatus(incident)
  const Icon = status.icon

  let action
  switch (resolution.type) {
    case 'repair':
      action = (
        <Button size="sm" variant="outline" onClick={() => onRepair?.(incident)}>
          <Wrench aria-hidden="true" />
          {resolution.label}
        </Button>
      )
      break
    case 'navigate':
      action = (
        <PluginLink to={resolution.href} className={buttonVariants({ size: 'sm', variant: 'outline' })}>
          {resolution.label}
          <ChevronRight aria-hidden="true" />
        </PluginLink>
      )
      break
    case 'instructions':
      action = (
        <Button
          size="sm"
          variant="outline"
          aria-expanded={showInstructions}
          aria-controls={instructionsId}
          onClick={() => setShowInstructions((shown) => !shown)}
        >
          <ChevronRight className={showInstructions ? 'rotate-90' : ''} aria-hidden="true" />
          {resolution.label}
        </Button>
      )
      break
    case 'rerun':
      action = (
        <Button size="sm" variant="outline" onClick={() => onRerun?.(incident)}>
          Check again
        </Button>
      )
      break
  }

  return (
    <article
      className={`flex h-full min-w-0 flex-col rounded-xl border p-4 ${TONE_CLASS[status.tone]}`}
      data-incident-id={incident.id}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-background/70 ring-1 ring-foreground/10">
          <Icon className={status.tone === 'destructive' ? 'size-4 text-destructive' : status.tone === 'warning' ? 'size-4 text-warning' : 'size-4 text-muted-foreground'} aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
            {incident.class && (
              <StatusBadge tone="neutral" variant="outline">{CLASS_LABEL[incident.class]}</StatusBadge>
            )}
            {incident.effectiveDisposition !== incident.disposition && (
              <StatusBadge tone="neutral" variant="outline">
                {`Calmed from ${DISPOSITION_LABEL[incident.disposition]}`}
              </StatusBadge>
            )}
            {item.freshness === 'stale' && <StatusBadge tone="neutral" variant="outline">Last known</StatusBadge>}
            {incident.ackState && (
              <StatusBadge tone="neutral" variant="outline">
                {incident.ackState === 'acked' ? 'Acknowledged' : 'Snoozed'}
              </StatusBadge>
            )}
          </div>
          <h3 className="mt-2 font-semibold leading-snug text-foreground">{incident.title}</h3>
          <p
            id={impactId}
            className={`mt-1 text-sm leading-snug text-muted-foreground ${showImpact ? '' : 'line-clamp-2'}`}
          >
            {incident.impact}
          </p>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            className="mt-1 h-auto px-0 py-0 text-xs text-muted-foreground hover:bg-transparent"
            aria-expanded={showImpact}
            aria-controls={impactId}
            aria-label={`${showImpact ? 'Collapse' : 'Show full'} explanation for ${incident.title}`}
            onClick={() => setShowImpact((shown) => !shown)}
          >
            {showImpact ? 'Less' : 'More'}
          </Button>
        </div>
      </div>

      {resolution.type === 'instructions' && showInstructions && (
        <div id={instructionsId} className="mt-3 rounded-lg bg-background/70 p-3 text-sm ring-1 ring-foreground/10">
          <ol className="list-decimal space-y-1 pl-5">
            {resolution.steps.map((step) => <li key={step}>{step}</li>)}
          </ol>
          {resolution.command && (
            <code className="mt-3 block overflow-auto rounded bg-background p-2 text-xs ring-1 ring-foreground/10">
              {resolution.command}
            </code>
          )}
        </div>
      )}

      <div className="mt-auto flex items-center justify-end gap-2 pt-4">
        {onAck && (incident.ackState ? (
          <Button size="sm" variant="ghost" onClick={() => onAck(incident, 'clear')}>
            Un-ack
          </Button>
        ) : (
          <>
            {incident.effectiveDisposition !== 'action_required' && (
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Acknowledge ${incident.title}`}
                onClick={() => onAck(incident, 'ack')}
              >
                <BellOff aria-hidden="true" />
                Ack
              </Button>
            )}
            <Popover>
              <PopoverTrigger
                aria-label={`Snooze ${incident.title}`}
                className={buttonVariants({ size: 'sm', variant: 'ghost' })}
              >
                Snooze
              </PopoverTrigger>
              <PopoverContent align="end" className="flex w-32 flex-col p-1">
                <Button size="sm" variant="ghost" onClick={() => onAck(incident, 'snooze', '24h')}>24 hours</Button>
                <Button size="sm" variant="ghost" onClick={() => onAck(incident, 'snooze', '7d')}>7 days</Button>
              </PopoverContent>
            </Popover>
          </>
        ))}
        {action}
      </div>
    </article>
  )
}
