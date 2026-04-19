'use client'

import { ListFilter } from 'lucide-react'
import { AgentAvatar } from '@/components/agent-avatar'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { useAgent, useAgentDisplayName } from '@bakin/team/hooks/use-agent-store'

interface AgentFilterProps {
  agentIds: string[]
  value: string
  onChange: (agentId: string) => void
  showIcon?: boolean
}

export function AgentFilter({ agentIds, value, onChange, showIcon = true }: AgentFilterProps) {
  return (
    <TooltipProvider delay={200}>
      <div className="flex items-center gap-3">
        {showIcon && <ListFilter className="size-3.5 text-muted-foreground shrink-0" />}
        <div className="flex items-center gap-0.5 bg-muted/50 rounded-lg p-0.5">
          <button
            onClick={() => onChange('all')}
            className={`px-2 py-0.5 rounded-md text-xs font-medium transition-all ${
              value === 'all'
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            All
          </button>
          {agentIds.map((id) => (
            <AgentFilterItem
              key={id}
              id={id}
              active={value === id}
              onSelect={() => onChange(id)}
            />
          ))}
        </div>
      </div>
    </TooltipProvider>
  )
}

function AgentFilterItem({
  id,
  active,
  onSelect,
}: {
  id: string
  active: boolean
  onSelect: () => void
}) {
  const meta = useAgent(id)
  const displayNameOverride = useAgentDisplayName(id)
  const name = displayNameOverride ?? meta?.name ?? id

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            onClick={onSelect}
            className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md text-xs font-medium transition-all ${
              active
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:text-foreground opacity-60 hover:opacity-100'
            }`}
          />
        }
      >
        <AgentAvatar agentId={id} size="xs" />
      </TooltipTrigger>
      <TooltipContent>{name}</TooltipContent>
    </Tooltip>
  )
}
