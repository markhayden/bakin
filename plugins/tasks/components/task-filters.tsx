'use client'

import { AgentAvatar } from '@/components/agent-avatar'
import { FacetFilter } from '@/components/facet-filter'
import { useAgentIds } from '@bakin/team/hooks/use-agent-store'
import { ListFilter } from 'lucide-react'
import { COLUMN_CONFIG, STATUS_DOT_COLORS } from '../constants'
import type { ColumnId } from '../types'

const STATUS_OPTIONS: { value: string; label: string; icon: React.ReactNode }[] =
  (['backlog', 'todo', 'blocked', 'inProgress', 'review', 'done', 'archived'] as ColumnId[]).map(id => ({
    value: id,
    label: COLUMN_CONFIG[id].label,
    icon: <span className={`size-2 rounded-full ${STATUS_DOT_COLORS[id]}`} />,
  }))

function AgentPill({ agentId, isActive, onClick }: { agentId: string; isActive: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs font-medium transition-all ${
        isActive
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:text-foreground opacity-60 hover:opacity-100'
      }`}
    >
      <AgentAvatar agentId={agentId} size="xs" />
    </button>
  )
}

interface TaskFiltersProps {
  agentFilter: string
  onAgentChange: (agent: string) => void
  statusFilter?: string[]
  onStatusChange?: (statuses: string[]) => void
  showStatusFilter?: boolean
  /** Aggregation counts from Antfly search (status → count) */
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
      <ListFilter className="size-3.5 text-muted-foreground shrink-0" />
      {/* Agent filter — avatars */}
      <div className="flex items-center gap-0.5 bg-muted/50 rounded-lg p-0.5">
        <button
          onClick={() => onAgentChange('all')}
          className={`px-2 py-0.5 rounded-md text-xs font-medium transition-all ${
            agentFilter === 'all'
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          All
        </button>
        {agentIds.map(id => (
          <AgentPill
            key={id}
            agentId={id}
            isActive={agentFilter === id}
            onClick={() => onAgentChange(id)}
          />
        ))}
      </div>

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
