'use client'

import { AGENTS } from '@/lib/constants'
import { AgentAvatar } from '@/components/agent-avatar'

type BadgeSize = 'sm' | 'md' | 'lg'

const sizeMap: Record<BadgeSize, 'xs' | 'sm' | 'md'> = {
  sm: 'xs',
  md: 'sm',
  lg: 'md',
}

const fontMap: Record<BadgeSize, string> = {
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-sm',
}

const gapMap: Record<BadgeSize, string> = {
  sm: 'gap-1',
  md: 'gap-1.5',
  lg: 'gap-2',
}

export function AgentBadge({
  agentId,
  size = 'md',
  showName = true,
}: {
  agentId?: string
  size?: BadgeSize
  showName?: boolean
}) {
  const agent = AGENTS.find(a => a.id === agentId)

  if (!agent) {
    return (
      <span className={`inline-flex items-center ${gapMap[size]}`}>
        <AgentAvatar agentId={agentId ?? 'unknown'} size={sizeMap[size]} />
        {showName && <span className={`${fontMap[size]} text-muted-foreground`}>Unassigned</span>}
      </span>
    )
  }

  return (
    <span className={`inline-flex items-center ${gapMap[size]}`}>
      <AgentAvatar agentId={agent.id} size={sizeMap[size]} />
      {showName && <span className={`${fontMap[size]} text-foreground`}>{agent.name}</span>}
    </span>
  )
}
