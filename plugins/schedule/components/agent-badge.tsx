'use client'

import { AGENTS } from '@/lib/constants'
import { AgentAvatar } from '@/components/agent-avatar'
import { Shell } from 'lucide-react'

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

const iconSizeMap: Record<BadgeSize, string> = {
  sm: 'size-5',
  md: 'size-6',
  lg: 'size-8',
}

const iconInnerMap: Record<BadgeSize, string> = {
  sm: 'size-2.5',
  md: 'size-3',
  lg: 'size-3.5',
}

function SystemBadge({ size, showName }: { size: BadgeSize; showName: boolean }) {
  return (
    <span className={`inline-flex items-center ${gapMap[size]}`}>
      <span className={`${iconSizeMap[size]} rounded-full bg-zinc-700 flex items-center justify-center shrink-0`}>
        <Shell className={`${iconInnerMap[size]} text-zinc-400`} />
      </span>
      {showName && <span className={`${fontMap[size]} text-muted-foreground`}>System</span>}
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
  const agent = AGENTS.find(a => a.id === agentId)

  if (!agent) {
    return <SystemBadge size={size} showName={showName} />
  }

  return (
    <span className={`inline-flex items-center ${gapMap[size]}`}>
      <AgentAvatar agentId={agent.id} size={sizeMap[size]} />
      {showName && <span className={`${fontMap[size]} text-foreground`}>{agent.name}</span>}
    </span>
  )
}
