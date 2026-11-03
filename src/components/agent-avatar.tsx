'use client'

import { AgentAvatar as AgentAvatarPresentation } from '@makinbakin/sdk/patterns'
import { useAgentIdentity } from '@makinbakin/sdk/hooks'

type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'
type StatusValue = 'online' | 'working' | 'available' | 'offline'

interface AgentAvatarProps {
  agentId: string
  size?: AvatarSize
  showStatus?: boolean
  status?: StatusValue
  className?: string
}

/** Host adapter: registered-agent identity (one mapping, `useAgentIdentity`) into the public presentation pattern. */
export function AgentAvatar({ agentId, size = 'md', showStatus = false, status, className }: AgentAvatarProps) {
  const agent = useAgentIdentity(agentId)
  return <AgentAvatarPresentation agent={agent} size={size} showStatus={showStatus} status={status} className={className} />
}
