'use client'

import { useAgent } from '@makinbakin/sdk/hooks'
import { AgentAvatar } from '@makinbakin/sdk/patterns'
import { Avatar, AvatarFallback } from '@makinbakin/sdk/ui'
import { Shell } from 'lucide-react'

type BadgeSize = 'sm' | 'md' | 'lg'

const sizeMap: Record<BadgeSize, 'xs' | 'sm' | 'md'> = {
  sm: 'xs',
  md: 'sm',
  lg: 'md',
}

const fontMap: Record<BadgeSize, string> = {
  sm: 'text-bakin-typography-size-meta',
  md: 'text-bakin-typography-size-body',
  lg: 'text-bakin-typography-size-body',
}

const gapMap: Record<BadgeSize, string> = {
  sm: 'gap-bakin-1',
  md: 'gap-bakin-2',
  lg: 'gap-bakin-2',
}

const iconInnerMap: Record<BadgeSize, string> = {
  sm: 'size-bakin-3',
  md: 'size-bakin-3',
  lg: 'size-bakin-4',
}

function SystemBadge({ size, showName }: { size: BadgeSize; showName: boolean }) {
  return (
    <span className={`inline-flex items-center ${gapMap[size]}`}>
      <Avatar size={sizeMap[size]}>
        <AvatarFallback>
          <Shell className={`${iconInnerMap[size]} text-bakin-text-muted`} aria-hidden="true" />
        </AvatarFallback>
      </Avatar>
      {showName && <span className={`${fontMap[size]} text-bakin-text-muted`}>System</span>}
    </span>
  )
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
  const agent = useAgent(agentId ?? '')

  if (!agent) {
    return <SystemBadge size={size} showName={showName} />
  }

  return (
    <span className={`inline-flex items-center ${gapMap[size]}`}>
      <AgentAvatar
        agent={{
          id: agent.id,
          name: agent.name,
          imageSrc: agent.headshot || null,
        }}
        size={sizeMap[size]}
        decorative={showName}
      />
      {showName && <span className={`${fontMap[size]} text-bakin-text-primary`}>{agent.name}</span>}
    </span>
  )
}
