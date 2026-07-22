'use client'

import { useMemo } from 'react'
import { AgentAvatar, AgentFilter, FacetFilter } from '@makinbakin/sdk/patterns'
import { useAgentIds, useAgentStore } from '@makinbakin/sdk/hooks'
import { Switch } from "@makinbakin/sdk/ui"
import { Eye, EyeOff } from 'lucide-react'
import { COLUMN_CONFIG, STATUS_DOT_COLORS } from '../constants'
import type { ColumnId } from '../types'

const STATUS_OPTIONS: { value: string; label: string; icon: React.ReactNode }[] =
  (['backlog', 'todo', 'blocked', 'inProgress', 'review', 'done', 'archived'] as ColumnId[]).map(id => ({
    value: id,
    label: COLUMN_CONFIG[id].label,
    icon: <span className={`size-2 rounded-full ${STATUS_DOT_COLORS[id]}`} />,
  }))

/** Brand-facet sentinel for unbranded tasks — mirrors NO_BRAND in use-task-filters. */
const NO_BRAND_VALUE = '__none__'

interface TaskFiltersProps {
  agentFilter: string
  onAgentChange: (agent: string) => void
  statusFilter?: string[]
  onStatusChange?: (statuses: string[]) => void
  showStatusFilter?: boolean
  showScheduled?: boolean
  onShowScheduledChange?: (show: boolean) => void
  /** Aggregation counts from search (status → count) */
  statusCounts?: Record<string, number>
  /** Brand facet (#419) — rendered only when brands exist. */
  brandFilter?: string[]
  onBrandChange?: (brands: string[]) => void
  brandOptions?: Array<{ id: string; name: string }>
}

export function TaskFilters({
  agentFilter, onAgentChange,
  statusFilter, onStatusChange,
  showStatusFilter = false,
  showScheduled = true,
  onShowScheduledChange,
  statusCounts,
  brandFilter, onBrandChange, brandOptions,
}: TaskFiltersProps) {
  const agentIds = useAgentIds()
  const agentMap = useAgentStore((state) => state.agentMap)
  const displaySettings = useAgentStore((state) => state.displaySettings)
  const agentOptions = useMemo(() => agentIds.map((id) => {
    const agent = agentMap[id]
    const display = displaySettings[id]
    const name = display?.displayName ?? agent?.name ?? id
    return {
      value: id,
      label: name,
      visual: (
        <AgentAvatar
          agent={{
            id,
            name,
            imageSrc: agent?.headshot,
            color: display?.accentColor,
          }}
          size="sm"
          decorative
        />
      ),
    }
  }), [agentIds, agentMap, displaySettings])

  const brandFacetOptions = (brandOptions ?? []).map(b => ({
    value: b.id,
    label: b.name,
    icon: <span className="size-bakin-2 rounded-bakin-pill bg-bakin-signal-accent/50" />,
  }))
  if (brandFacetOptions.length > 0) {
    brandFacetOptions.push({
      value: NO_BRAND_VALUE,
      label: 'No brand',
      icon: <span className="size-bakin-2 rounded-bakin-pill border border-bakin-text-muted/50 bg-transparent" />,
    })
  }

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-bakin-3">
      <AgentFilter
        options={agentOptions}
        value={agentFilter}
        onValueChange={onAgentChange}
        compact
      />

      {/* Brand facet (#419) — appears once at least one brand exists */}
      {onBrandChange && brandFacetOptions.length > 0 && (
        <FacetFilter
          label="Brand"
          options={brandFacetOptions}
          selected={brandFilter ?? []}
          onChange={onBrandChange}
        />
      )}

      {/* Status facet filter — only in table view */}
      {showStatusFilter && onStatusChange && (
        <FacetFilter
          label="Status"
          options={STATUS_OPTIONS}
          selected={statusFilter ?? []}
          onChange={onStatusChange}
          counts={statusCounts}
        />
      )}

      {onShowScheduledChange && (
        <div
          data-slot="scheduled-tasks-filter"
          role="group"
          aria-label="Scheduled task visibility"
          className="flex h-bakin-8 select-none items-center gap-bakin-2 rounded-bakin-control px-bakin-2 font-bakin-typography-weight-semibold text-bakin-text-muted"
          title={showScheduled ? 'Hide scheduled tasks' : 'Show scheduled tasks'}
        >
          {showScheduled ? <Eye className="size-bakin-4" aria-hidden="true" /> : <EyeOff className="size-bakin-4" aria-hidden="true" />}
          <span className="text-bakin-typography-size-body">Scheduled Tasks</span>
          <Switch
            checked={showScheduled}
            onCheckedChange={(checked: boolean) => onShowScheduledChange(checked)}
            size="sm"
            aria-label={showScheduled ? 'Hide scheduled tasks' : 'Show scheduled tasks'}
          />
        </div>
      )}

    </div>
  )
}
