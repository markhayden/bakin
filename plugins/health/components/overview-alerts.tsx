'use client'

import type { HealthIncident } from '@makinbakin/sdk/types'
import { PluginLink, StatusBadge } from '@makinbakin/sdk/components'
import { Popover, PopoverContent, PopoverTrigger } from '@makinbakin/sdk/ui'
import { CheckCircle2, ChevronDown, ChevronRight } from 'lucide-react'
import type { HealthOverviewViewModel, OverviewIncident } from '../lib/health-view-model'
import { IncidentRow } from './incident-row'

interface OverviewAlertsProps {
  model: HealthOverviewViewModel
  onRepair?: (incident: HealthIncident) => void
  onRerun?: (incident: HealthIncident) => void
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
}: {
  incidents: OverviewIncident[]
  testId?: string
  onRepair?: (incident: HealthIncident) => void
  onRerun?: (incident: HealthIncident) => void
}) {
  const columnClasses = [
    incidents.length > 1 && '@[36rem]/health:grid-cols-2',
    incidents.length > 2 && '@[48rem]/health:grid-cols-3',
  ].filter(Boolean).join(' ')

  return (
    <ul
      data-testid={testId}
      className={`grid gap-3 ${columnClasses}`}
    >
      {incidents.map((item) => (
        <li key={item.incident.id} className="min-w-0">
          <IncidentRow item={item} onRepair={onRepair} onRerun={onRerun} />
        </li>
      ))}
    </ul>
  )
}

function Notices({ incidents }: { incidents: OverviewIncident[] }) {
  if (incidents.length === 0) return null
  return (
    <Popover>
      <PopoverTrigger className="group flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-muted-foreground hover:bg-foreground/[0.04] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {incidents.length} {incidents.length === 1 ? 'notice' : 'notices'}
        <ChevronDown className="size-3.5 transition-transform group-data-[popup-open]:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(24rem,calc(100vw-2rem))] p-2">
        <ul className="max-h-72 space-y-1 overflow-auto">
          {incidents.map((item) => (
            <li key={item.incident.id} className="flex items-start gap-2 rounded-lg px-2 py-2 text-sm">
              <StatusBadge tone={item.incident.status === 'unknown' ? 'neutral' : 'warning'} variant="outline">
                {item.incident.status === 'unknown' ? 'Verify' : 'Watch'}
              </StatusBadge>
              <span className="min-w-0 leading-snug text-foreground">{item.incident.title}</span>
            </li>
          ))}
        </ul>
        <PluginLink
          to="/health?tab=system"
          className="mt-1 flex items-center justify-end gap-1 rounded-md px-2 py-2 text-sm font-medium text-primary hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Review system details <ChevronRight className="size-3.5" aria-hidden="true" />
        </PluginLink>
      </PopoverContent>
    </Popover>
  )
}

export function OverviewAlerts({ model, onRepair, onRerun }: OverviewAlertsProps) {
  const primary = [...model.needsAction, ...model.unableToVerify]
  const { visible, hidden } = splitDistinctIncidents(primary)
  const actionLabel = model.unableToVerify.length === 0
    ? `${primary.length} ${primary.length === 1 ? 'action' : 'actions'}`
    : `${primary.length} ${primary.length === 1 ? 'item' : 'items'}`

  if (primary.length === 0) {
    return (
      <section className="flex min-h-12 items-center gap-3 rounded-xl border border-success/20 bg-success/[0.035] px-4 py-3">
        <CheckCircle2 className="size-5 shrink-0 text-success" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-success">No problems need attention</h2>
        <div className="ml-auto"><Notices incidents={model.watching} /></div>
      </section>
    )
  }

  return (
    <section aria-labelledby="overview-fix-first-title" className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="overview-fix-first-title" className="text-lg font-semibold text-foreground">Fix first</h2>
        <StatusBadge tone={model.needsAction.length > 0 ? 'destructive' : 'neutral'}>
          {actionLabel}
        </StatusBadge>
        <div className="ml-auto"><Notices incidents={model.watching} /></div>
      </div>

      <AlertGrid
        incidents={visible}
        testId="overview-primary-alerts"
        onRepair={onRepair}
        onRerun={onRerun}
      />

      {hidden.length > 0 && (
        <details className="group rounded-lg border border-border/70 bg-foreground/[0.02]">
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <ChevronDown className="size-4 -rotate-90 transition-transform group-open:rotate-0 motion-reduce:transition-none" aria-hidden="true" />
            View {hidden.length} more {hidden.length === 1 ? 'problem' : 'problems'}
          </summary>
          <div className="border-t border-border/70 p-3">
            <AlertGrid incidents={hidden} onRepair={onRepair} onRerun={onRerun} />
          </div>
        </details>
      )}
    </section>
  )
}
