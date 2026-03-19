'use client'

import type { Heartbeat } from '@/types'

function getStatusColor(hb?: Heartbeat) {
  if (!hb) return 'bg-muted-foreground'
  const age = (Date.now() - new Date(hb.timestamp).getTime()) / 1000 / 60
  if (age > 15) return 'bg-muted-foreground'
  if (hb.status === 'working') return 'bg-success'
  if (hb.status === 'idle') return 'bg-warning'
  return 'bg-destructive'
}

export function AgentDot({ heartbeat }: { heartbeat?: Heartbeat }) {
  return <div className={`size-2 rounded-full ${getStatusColor(heartbeat)}`} />
}

export function AgentStatus({ name, heartbeat }: { name: string; heartbeat?: Heartbeat }) {
  return (
    <div className="flex items-center gap-2">
      <AgentDot heartbeat={heartbeat} />
      <span className="text-xs font-mono text-muted-foreground">{name}</span>
    </div>
  )
}
