'use client'

import { User, Users } from 'lucide-react'
import { useAgent } from '@makinbakin/sdk/hooks'
import { WorkflowAgentAvatar } from '../workflow-agent-identity'
import { isTeamStepToken, teamIdFromToken } from '../../lib/team-token'

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
    <div className={`flex min-w-0 items-center gap-1.5 text-bakin-typography-size-meta text-bakin-text-muted ${className ?? ''}`}>
      {agent && !isDynamic(agent) ? (
        <WorkflowAgentAvatar agentId={agent} size="xs" />
      ) : isTeam ? (
        <Users className="size-3 shrink-0 text-bakin-text-muted" />
      ) : (
        <User className="size-3 shrink-0 text-bakin-text-muted" />
      )}
      <span className="truncate">{label}</span>
    </div>
  )
}
