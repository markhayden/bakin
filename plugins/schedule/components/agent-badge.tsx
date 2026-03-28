'use client'

import { useState } from 'react'
import { AGENTS } from '@/lib/constants'
import { AGENT_AVATAR_COLORS } from '../../tasks/constants'

type BadgeSize = 'sm' | 'md' | 'lg'

const sizes = {
  sm: { img: 'size-5', text: 'text-[10px]', ring: 'ring-1', gap: 'gap-1', font: 'text-xs' },
  md: { img: 'size-6', text: 'text-xs', ring: 'ring-1', gap: 'gap-1.5', font: 'text-sm' },
  lg: { img: 'size-8', text: 'text-sm', ring: 'ring-2', gap: 'gap-2', font: 'text-sm' },
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
  const [imgError, setImgError] = useState(false)
  const agent = AGENTS.find(a => a.id === agentId)
  const s = sizes[size]

  if (!agent) {
    return (
      <span className={`inline-flex items-center ${s.gap}`}>
        <span className={`${s.img} rounded-full bg-muted flex items-center justify-center ${s.text} text-muted-foreground shrink-0`}>?</span>
        {showName && <span className={`${s.font} text-muted-foreground`}>Unassigned</span>}
      </span>
    )
  }

  const color = AGENT_AVATAR_COLORS[agent.id] || 'bg-zinc-400'

  return (
    <span className={`inline-flex items-center ${s.gap}`}>
      {!imgError ? (
        <img
          src={`/headshots/${agent.id}.png`}
          alt={agent.name}
          onError={() => setImgError(true)}
          className={`${s.img} rounded-full object-cover object-top ${s.ring} ring-zinc-700 shrink-0`}
        />
      ) : (
        <span className={`${s.img} rounded-full flex items-center justify-center ${s.text} shrink-0 ${color}`}>
          {agent.emoji}
        </span>
      )}
      {showName && <span className={`${s.font} text-foreground`}>{agent.name}</span>}
    </span>
  )
}
