'use client'

import { AgentFilter } from "@bakin/sdk/components"
import { FacetFilter } from "@bakin/sdk/components"
import { useAgentIds } from "@bakin/sdk/hooks"
import { COLUMN_CONFIG, STATUS_DOT_COLORS } from '../constants'
import type { ColumnId } from '../types'

const STATUS_OPTIONS: { value: string; label: string; icon: React.ReactNode }[] =
  (['backlog', 'todo', 'blocked', 'inProgress', 'review', 'done', 'archived'] as ColumnId[]).map(id => ({
    value: id,
    label: COLUMN_CONFIG[id].label,
    icon: <span className={`size-2 rounded-full ${STATUS_DOT_COLORS[id]}`} />,
  }))

interface TaskFiltersProps {
  agentFilter: string
  onAgentChange: (agent: string) => void
  statusFilter?: string[]
  onStatusChange?: (statuses: string[]) => void
  showStatusFilter?: boolean
  /** Aggregation counts from search (status → count) */
  statusCounts?: Record<string, number>
}

export function TaskFilters({
  agentFilter, onAgentChange,
  statusFilter, onStatusChange,
  showStatusFilter = false,
  statusCounts,
}: TaskFiltersProps) {
  const agentIds = useAgentIds()

  return (
    <div className="flex items-center gap-3 overflow-x-auto">
      <AgentFilter agentIds={agentIds} value={agentFilter} onChange={onAgentChange} />

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

    </div>
  )
}
