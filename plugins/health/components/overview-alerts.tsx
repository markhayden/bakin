'use client'

import type { HealthIncident } from '@makinbakin/sdk/types'
import { PluginLink } from '@makinbakin/sdk/navigation'
import { DisclosurePanel, Inline, Section, Stack } from '@makinbakin/sdk/layout'
import { ListRows, StatusBadge } from '@makinbakin/sdk/patterns'
import { Banner, Text } from '@makinbakin/sdk/ui'
import { ChevronRight } from 'lucide-react'
import type { HealthOverviewViewModel, OverviewIncident } from '../lib/health-view-model'
import { IncidentRow } from './incident-row'

interface OverviewAlertsProps {
  model: HealthOverviewViewModel
  onRepair?: (incident: HealthIncident) => void
  onDecided?: (incident: HealthIncident) => void
  onAck?: (incident: HealthIncident, action: 'ack' | 'snooze' | 'clear', window?: '24h' | '7d') => void
}

/** Suppressed is never hidden: acked/snoozed incidents stay visible here,
 *  collapsed and calm, with un-ack one click away. */
function AcknowledgedSection({ model, onRepair, onDecided, onAck }: OverviewAlertsProps) {
  if (model.acknowledged.length === 0) return null
  return (
    <DisclosurePanel
      data-testid="overview-acknowledged"
      summary="Acknowledged"
      summaryMeta={String(model.acknowledged.length)}
    >
      <AlertGrid incidents={model.acknowledged} onRepair={onRepair} onDecided={onDecided} onAck={onAck} />
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
  onDecided,
  onAck,
}: {
  incidents: OverviewIncident[]
  testId?: string
  onRepair?: (incident: HealthIncident) => void
  onDecided?: (incident: HealthIncident) => void
  onAck?: (incident: HealthIncident, action: 'ack' | 'snooze' | 'clear', window?: '24h' | '7d') => void
}) {
  return (
    <ListRows variant="separated" aria-label="Health findings"
      data-testid={testId}
    >
      {incidents.map((item) => (
          <IncidentRow key={item.incident.id} item={item} onRepair={onRepair} onDecided={onDecided} onAck={onAck} />
      ))}
    </ListRows>
  )
}

/**
 * Watch and advisory findings (incl. sensitivity-demoted ones, #690) are
 * calm but never hidden — and never out of reach: their decisions (Keep /
 * Drop, Keep my edit / Restore shipped, …) live on the same incident row the
 * actionable ones use, collapsed under "Notices". The disposition is
 * preserved: no red, no nav badge, just the card when the operator opens it.
 */
function Notices({ model, onRepair, onDecided, onAck }: OverviewAlertsProps) {
  const incidents = [...model.watching, ...model.advisories]
  if (incidents.length === 0) return null
  return (
    <DisclosurePanel
      data-testid="overview-notices"
      summary="Notices"
      summaryMeta={`${incidents.length} ${incidents.length === 1 ? 'notice' : 'notices'}`}
    >
      <AlertGrid incidents={incidents} testId="overview-notice-alerts" onRepair={onRepair} onDecided={onDecided} onAck={onAck} />
      <PluginLink
        to="/health?tab=system"
        className="mt-bakin-1 flex items-center justify-end gap-bakin-1 rounded-bakin-control px-bakin-2 py-bakin-2 text-bakin-typography-size-meta font-bakin-typography-weight-medium text-bakin-text-muted hover:bg-bakin-surface-default hover:text-bakin-text-primary focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-bakin-focus-ring"
      >
        Review system details <ChevronRight className="size-bakin-3" aria-hidden="true" />
      </PluginLink>
    </DisclosurePanel>
  )
}

export function OverviewAlerts({ model, onRepair, onDecided, onAck }: OverviewAlertsProps) {
  const primary = [...model.needsAction, ...model.unableToVerify]
  const { visible, hidden } = splitDistinctIncidents(primary)
  const actionLabel = model.unableToVerify.length === 0
    ? `${primary.length} ${primary.length === 1 ? 'action' : 'actions'}`
    : `${primary.length} ${primary.length === 1 ? 'item' : 'items'}`

  if (primary.length === 0) {
    return (
      <>
        <Banner tone="success" title="No problems need attention" />
        <Notices model={model} onRepair={onRepair} onDecided={onDecided} onAck={onAck} />
        <AcknowledgedSection model={model} onRepair={onRepair} onDecided={onDecided} onAck={onAck} />
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
          <Text size="meta" tone="muted" as="p" className="leading-relaxed">
            Actionable conditions come before supporting telemetry.
          </Text>
        </Stack>
      </div>

      <AlertGrid
        incidents={visible}
        testId="overview-primary-alerts"
        onRepair={onRepair}
        onDecided={onDecided}
        onAck={onAck}
      />

      {hidden.length > 0 && (
        <DisclosurePanel summary={`View ${hidden.length} more ${hidden.length === 1 ? 'problem' : 'problems'}`}>
          <AlertGrid incidents={hidden} onRepair={onRepair} onDecided={onDecided} onAck={onAck} />
        </DisclosurePanel>
      )}
      <Notices model={model} onRepair={onRepair} onDecided={onDecided} onAck={onAck} />
      <AcknowledgedSection model={model} onRepair={onRepair} onDecided={onDecided} onAck={onAck} />
    </Section>
  )
}
