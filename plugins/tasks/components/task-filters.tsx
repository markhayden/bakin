'use client'

import { Input } from '@/components/ui/input'
import { Search } from 'lucide-react'
import { AgentAvatar } from '@/components/agent-avatar'
import { COLUMN_CONFIG } from '../constants'
import type { ColumnId } from '../types'

const AGENT_IDS = ['main-operator', 'chef', 'pixel', 'rolo', 'patch', 'explorer', 'trainer', 'coach']

const STATUS_TABS: { id: string; label: string }[] = [
  { id: 'all', label: 'All' },
  ...(['todo', 'blocked', 'inProgress', 'review', 'done', 'confirmed'] as ColumnId[]).map(id => ({
    id,
    label: COLUMN_CONFIG[id].label,
  })),
]

function AgentPill({ agentId, isActive, onClick }: { agentId: string; isActive: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs font-medium transition-all ${
        isActive
          ? 'bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:text-foreground opacity-60 hover:opacity-100'
      }`}
    >
      <AgentAvatar agentId={agentId} size="xs" />
    </button>
  )
}

interface TaskFiltersProps {
  search: string
  onSearchChange: (q: string) => void
  agentFilter: string
  onAgentChange: (agent: string) => void
  statusFilter?: string
  onStatusChange?: (status: string) => void
  showStatusFilter?: boolean
  taskCount: number
}

export function TaskFilters({
  search, onSearchChange,
  agentFilter, onAgentChange,
  statusFilter, onStatusChange,
  showStatusFilter = false,
  taskCount,
}: TaskFiltersProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        {/* Search input */}
        <div className="relative w-56">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search tasks..."
            className="pl-9 h-7 text-xs bg-surface border-border"
          />
        </div>

        {/* Agent filter — avatars */}
        <div className="flex items-center gap-0.5 bg-muted/50 rounded-lg p-0.5">
          <button
            onClick={() => onAgentChange('all')}
            className={`px-2 py-0.5 rounded-md text-xs font-medium transition-all ${
              agentFilter === 'all'
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            All
          </button>
          {AGENT_IDS.map(id => (
            <AgentPill
              key={id}
              agentId={id}
              isActive={agentFilter === id}
              onClick={() => onAgentChange(id)}
            />
          ))}
        </div>

        <span className="text-[11px] text-muted-foreground tabular-nums ml-auto">
          {taskCount} task{taskCount !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Status filter — only in table view */}
      {showStatusFilter && onStatusChange && (
        <div className="flex items-center gap-0.5 bg-muted/50 rounded-lg p-0.5 w-fit">
          {STATUS_TABS.map(tab => {
            const isActive = statusFilter === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => onStatusChange(tab.id)}
                className={`px-2 py-0.5 rounded-md text-xs font-medium transition-all ${
                  isActive
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {tab.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
