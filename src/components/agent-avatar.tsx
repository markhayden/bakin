'use client'

import { AgentAvatar as AgentAvatarPresentation } from '@makinbakin/sdk/patterns'
import { useAgent, useAgentColor, useAgentDisplayName } from '@makinbakin/sdk/hooks'

type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'
type StatusValue = 'online' | 'working' | 'available' | 'offline'

interface AgentAvatarProps {
  agentId: string
  size?: AvatarSize
  showStatus?: boolean
  status?: StatusValue
  className?: string
}

/** Compatibility adapter that supplies registered-agent identity to the public presentation pattern. */
export function AgentAvatar({ agentId, size = 'md', showStatus = false, status, className }: AgentAvatarProps) {
  const agent = useAgent(agentId)
  const displayName = useAgentDisplayName(agentId)
  const color = useAgentColor(agentId)
  return (
    <AgentAvatarPresentation
      agent={{
        id: agentId,
        name: displayName ?? agent?.name ?? (agentId || 'Unknown agent'),
        imageSrc: agent?.headshot || undefined,
        color: agent ? color : undefined,
        initials: agent ? undefined : '?',
      }}
      size={size}
      showStatus={showStatus}
      status={status}
      className={className}
    />
  )
}
