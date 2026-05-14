'use client'

import { useState } from 'react'
import { User } from 'lucide-react'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { useAgent, useAgentColor } from '@makinbakin/sdk/hooks'
import { cn } from '@/lib/utils'

type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'
type StatusValue = 'online' | 'working' | 'available' | 'offline'

const SIZE_CONFIG: Record<AvatarSize, { avatar: string; text: string; icon: string; dot: string }> = {
  xs: { avatar: 'size-5',  text: 'text-[10px]', icon: 'size-2.5', dot: 'size-1.5 -right-px -bottom-px' },
  sm: { avatar: 'size-6',  text: 'text-xs',      icon: 'size-3',   dot: 'size-2 -right-px -bottom-px' },
  md: { avatar: 'size-8',  text: 'text-sm',      icon: 'size-3.5', dot: 'size-2.5 right-0 bottom-0' },
  lg: { avatar: 'size-10', text: 'text-base',    icon: 'size-4',   dot: 'size-3 right-0 bottom-0' },
  xl: { avatar: 'size-16', text: 'text-lg',      icon: 'size-5',   dot: 'size-3.5 right-0.5 bottom-0.5' },
}

const STATUS_COLORS: Record<StatusValue, string> = {
  online:    'bg-green-400',
  working:   'bg-amber-400',
  available: 'bg-green-400',
  offline:   'bg-zinc-500',
}

interface AgentAvatarProps {
  agentId: string
  size?: AvatarSize
  showStatus?: boolean
  status?: StatusValue
  className?: string
}

export function AgentAvatar({
  agentId,
  size = 'md',
  showStatus = false,
  status,
  className,
}: AgentAvatarProps) {
  const [imgError, setImgError] = useState(false)
  const agent = useAgent(agentId)
  const accentColor = useAgentColor(agentId)
  const config = SIZE_CONFIG[size]
  const initial = agent?.name?.charAt(0).toUpperCase() ?? '?'

  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      <Avatar className={cn(config.avatar, '!rounded-full')}>
        {!imgError && agent?.headshot ? (
          <AvatarImage
            src={agent.headshot}
            alt={agent.name}
            onError={() => setImgError(true)}
            className="object-cover object-top"
          />
        ) : null}
        <AvatarFallback
          className={cn(
            config.text,
            'font-medium',
            agent ? 'text-white' : 'bg-muted text-muted-foreground',
          )}
          style={agent ? { backgroundColor: accentColor } : undefined}
        >
          {agent ? initial : <User className={config.icon} />}
        </AvatarFallback>
      </Avatar>
      {showStatus && status && (
        <span
          className={cn(
            'absolute rounded-full ring-2 ring-background',
            config.dot,
            STATUS_COLORS[status],
          )}
        />
      )}
    </span>
  )
}
