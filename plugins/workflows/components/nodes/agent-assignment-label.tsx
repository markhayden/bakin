'use client'

import { User, Users } from 'lucide-react'
import { useAgent } from '@makinbakin/sdk/hooks'
import { AgentAvatar } from '@makinbakin/sdk/components'
import { isTeamStepToken, teamIdFromToken } from '@bakin/core/workflows/team-token'

interface AgentAssignmentLabelProps {
  agent?: string
  className?: string
}

const isDynamic = (agent?: string) => agent === '$assigned' || isTeamStepToken(agent)

export function AgentAssignmentLabel({ agent, className }: AgentAssignmentLabelProps) {
  const lookedUp = useAgent(agent && !isDynamic(agent) ? agent : '')
  const isTeam = isTeamStepToken(agent)
  const label = isTeam
    ? `Team · ${teamIdFromToken(agent)}`
    : agent === '$assigned'
      ? 'Assigned agent'
      : lookedUp?.name ?? agent ?? 'No agent selected'

  return (
    <div className={`flex min-w-0 items-center gap-1.5 text-[11px] text-zinc-400 ${className ?? ''}`}>
      {agent && !isDynamic(agent) ? (
        <AgentAvatar agentId={agent} size="xs" />
      ) : isTeam ? (
        <Users className="size-3 shrink-0 text-zinc-500" />
      ) : (
        <User className="size-3 shrink-0 text-zinc-500" />
      )}
      <span className="truncate">{label}</span>
    </div>
  )
}
