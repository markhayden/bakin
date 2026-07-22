'use client'

import { AgentFilter } from "@makinbakin/sdk/components"
import { FacetFilter } from "@makinbakin/sdk/components"
import { useAgentIds } from "@makinbakin/sdk/hooks"
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

  const brandFacetOptions = (brandOptions ?? []).map(b => ({
    value: b.id,
    label: b.name,
    icon: <span className="size-2 rounded-full bg-fuchsia-500/50" />,
  }))
  if (brandFacetOptions.length > 0) {
    brandFacetOptions.push({
      value: NO_BRAND_VALUE,
      label: 'No brand',
      icon: <span className="size-2 rounded-full border border-muted-foreground/50 bg-transparent" />,
    })
  }

  return (
    <div className="flex items-center gap-3 overflow-x-auto">
      <AgentFilter agentIds={agentIds} value={agentFilter} onChange={onAgentChange} />

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
        <label
          data-slot="scheduled-tasks-filter"
          className="flex h-8 cursor-pointer select-none items-center gap-2 rounded-md px-2 text-xs font-medium text-muted-foreground"
          title={showScheduled ? 'Hide scheduled tasks' : 'Show scheduled tasks'}
        >
          {showScheduled ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
          <span>Scheduled Tasks</span>
          <Switch
            checked={showScheduled}
            onCheckedChange={(checked: boolean) => onShowScheduledChange(checked)}
            size="sm"
            aria-label={showScheduled ? 'Hide scheduled tasks' : 'Show scheduled tasks'}
          />
        </label>
      )}

    </div>
  )
}
