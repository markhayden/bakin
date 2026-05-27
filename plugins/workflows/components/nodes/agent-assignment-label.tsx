'use client'

import { User } from 'lucide-react'
import { useAgent } from '@makinbakin/sdk/hooks'
import { AgentAvatar } from '@makinbakin/sdk/components'

interface AgentAssignmentLabelProps {
  agent?: string
  className?: string
}

const isDynamic = (agent?: string) => agent === '$assigned'

export function AgentAssignmentLabel({ agent, className }: AgentAssignmentLabelProps) {
  const lookedUp = useAgent(agent && !isDynamic(agent) ? agent : '')
  const label = isDynamic(agent)
    ? 'Assigned agent'
    : lookedUp?.name ?? agent ?? 'No agent selected'

  return (
    <div className={`flex min-w-0 items-center gap-1.5 text-[11px] text-zinc-400 ${className ?? ''}`}>
      {agent && !isDynamic(agent) ? (
        <AgentAvatar agentId={agent} size="xs" />
      ) : (
        <User className="size-3 shrink-0 text-zinc-500" />
      )}
      <span className="truncate">{label}</span>
    </div>
  )
}
