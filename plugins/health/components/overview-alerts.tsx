'use client'

import type { HealthIncident } from '@makinbakin/sdk/types'
import { PluginLink } from '@makinbakin/sdk/navigation'
import { DisclosurePanel, Inline, Section, Stack } from '@makinbakin/sdk/layout'
import { StatusBadge } from '@makinbakin/sdk/patterns'
import { Banner, Popover, PopoverContent, PopoverTrigger } from '@makinbakin/sdk/ui'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { HealthOverviewViewModel, OverviewIncident } from '../lib/health-view-model'
import { IncidentRow } from './incident-row'

interface OverviewAlertsProps {
  model: HealthOverviewViewModel
  onRepair?: (incident: HealthIncident) => void
  onRerun?: (incident: HealthIncident) => void
  onAck?: (incident: HealthIncident, action: 'ack' | 'snooze' | 'clear', window?: '24h' | '7d') => void
}

/** Suppressed is never hidden: acked/snoozed incidents stay visible here,
 *  collapsed and calm, with un-ack one click away. */
function AcknowledgedSection({ model, onRepair, onRerun, onAck }: OverviewAlertsProps) {
  if (model.acknowledged.length === 0) return null
  return (
    <DisclosurePanel
      data-testid="overview-acknowledged"
      summary="Acknowledged"
      summaryMeta={String(model.acknowledged.length)}
    >
      <AlertGrid incidents={model.acknowledged} onRepair={onRepair} onRerun={onRerun} onAck={onAck} />
    </DisclosurePanel>
  )
}

/** Prefer distinct titles so repeated failures from one subsystem do not consume the snapshot. */
function splitDistinctIncidents(incidents: OverviewIncident[], limit = 3): {
  visible: OverviewIncident[]
  hidden: OverviewIncident[]
} {
  const selected = new Set<number>()
  const titles = new Set<string>()

  for (const [index, item] of incidents.entries()) {
    if (selected.size >= limit) break
    if (titles.has(item.incident.title)) continue
    selected.add(index)
    titles.add(item.incident.title)
  }
  for (let index = 0; index < incidents.length && selected.size < limit; index += 1) selected.add(index)

  return {
    visible: incidents.filter((_, index) => selected.has(index)),
    hidden: incidents.filter((_, index) => !selected.has(index)),
  }
}

function AlertGrid({
  incidents,
  testId,
  onRepair,
  onRerun,
  onAck,
}: {
  incidents: OverviewIncident[]
  testId?: string
  onRepair?: (incident: HealthIncident) => void
  onRerun?: (incident: HealthIncident) => void
  onAck?: (incident: HealthIncident, action: 'ack' | 'snooze' | 'clear', window?: '24h' | '7d') => void
}) {
  const columnClasses = [
    incidents.length > 1 && '@[36rem]/health:grid-cols-2',
    incidents.length > 2 && '@[48rem]/health:grid-cols-3',
  ].filter(Boolean).join(' ')

  return (
    <ul
      data-testid={testId}
      className={`grid gap-bakin-3 ${columnClasses}`}
    >
      {incidents.map((item) => (
        <li key={item.incident.id} className="min-w-0">
          <IncidentRow item={item} onRepair={onRepair} onRerun={onRerun} onAck={onAck} />
        </li>
      ))}
    </ul>
  )
}

function noticeBadge(item: OverviewIncident): { label: string; tone: 'neutral' | 'attention' } {
  if (item.incident.status === 'unknown') return { label: 'Verify', tone: 'neutral' }
  // Advisory here includes sensitivity-demoted findings (#690) — calm, but
  // still listed: demotion means quiet, never hidden.
  if (item.incident.effectiveDisposition === 'advisory') return { label: 'Advisory', tone: 'neutral' }
  return { label: 'Watch', tone: 'attention' }
}

function Notices({ incidents }: { incidents: OverviewIncident[] }) {
  if (incidents.length === 0) return null
  return (
    <Popover>
      <PopoverTrigger className="group flex items-center gap-bakin-1 rounded-bakin-control px-bakin-2 py-bakin-1 text-bakin-typography-size-meta font-bakin-typography-weight-medium text-bakin-text-muted hover:bg-bakin-surface-default hover:text-bakin-text-primary focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-bakin-focus-ring">
        {incidents.length} {incidents.length === 1 ? 'notice' : 'notices'}
        <ChevronDown className="size-bakin-3 transition-transform duration-[var(--bakin-motion-duration-transition)] group-data-[popup-open]:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] p-bakin-2">
        <ul className="max-h-72 space-y-bakin-1 overflow-auto">
          {incidents.map((item) => {
            const badge = noticeBadge(item)
            return (
              <li key={item.incident.id} className="flex items-start gap-bakin-2 rounded-bakin-control px-bakin-2 py-bakin-2 text-bakin-typography-size-meta">
                <StatusBadge tone={badge.tone} variant="outline">{badge.label}</StatusBadge>
                <span className="min-w-0 leading-snug text-bakin-text-primary">{item.incident.title}</span>
              </li>
            )
          })}
        </ul>
        <PluginLink
          to="/health?tab=system"
          className="mt-bakin-1 flex items-center justify-end gap-bakin-1 rounded-bakin-control px-bakin-2 py-bakin-2 text-bakin-typography-size-meta font-bakin-typography-weight-medium text-bakin-signal-accent hover:bg-bakin-surface-default focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-bakin-focus-ring"
        >
          Review system details <ChevronRight className="size-bakin-3" aria-hidden="true" />
        </PluginLink>
      </PopoverContent>
    </Popover>
  )
}

export function OverviewAlerts({ model, onRepair, onRerun, onAck }: OverviewAlertsProps) {
  const primary = [...model.needsAction, ...model.unableToVerify]
  const { visible, hidden } = splitDistinctIncidents(primary)
  const actionLabel = model.unableToVerify.length === 0
    ? `${primary.length} ${primary.length === 1 ? 'action' : 'actions'}`
    : `${primary.length} ${primary.length === 1 ? 'item' : 'items'}`

  if (primary.length === 0) {
    return (
      <>
        <Banner
          tone="success"
          title="No problems need attention"
          action={<Notices incidents={[...model.watching, ...model.advisories]} />}
        />
        <AcknowledgedSection model={model} onRepair={onRepair} onRerun={onRerun} onAck={onAck} />
      </>
    )
  }

  return (
    <Section spacing="compact" aria-labelledby="overview-fix-first-title">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-bakin-3">
        <Stack gap="dense">
          <Inline gap="dense">
            <h2 id="overview-fix-first-title">Fix first</h2>
            <StatusBadge tone={model.needsAction.length > 0 ? 'danger' : 'neutral'} variant="solid">
              {actionLabel}
            </StatusBadge>
          </Inline>
          <p className="m-0 text-bakin-typography-size-meta leading-relaxed text-bakin-text-muted">
            Actionable conditions come before supporting telemetry.
          </p>
        </Stack>
        <Notices incidents={[...model.watching, ...model.advisories]} />
      </div>

      <AlertGrid
        incidents={visible}
        testId="overview-primary-alerts"
        onRepair={onRepair}
        onRerun={onRerun}
        onAck={onAck}
      />

      {hidden.length > 0 && (
        <DisclosurePanel summary={`View ${hidden.length} more ${hidden.length === 1 ? 'problem' : 'problems'}`}>
          <AlertGrid incidents={hidden} onRepair={onRepair} onRerun={onRerun} onAck={onAck} />
        </DisclosurePanel>
      )}
      <AcknowledgedSection model={model} onRepair={onRepair} onRerun={onRerun} onAck={onAck} />
    </Section>
  )
}
