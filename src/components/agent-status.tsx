'use client'

import {
  AgentDot as AgentDotPresentation,
  AgentStatus as AgentStatusPresentation,
  type AgentPresenceStatus,
} from '@makinbakin/sdk/patterns'
import type { Heartbeat } from '@/types'

function heartbeatStatus(heartbeat?: Heartbeat): AgentPresenceStatus {
  if (!heartbeat) return 'offline'
  const ageMinutes = (Date.now() - new Date(heartbeat.timestamp).getTime()) / 60_000
  if (!Number.isFinite(ageMinutes) || ageMinutes > 15) return 'offline'
  if (heartbeat.status === 'working') return 'working'
  if (heartbeat.status === 'idle') return 'available'
  return 'error'
}

/** Compatibility adapter that derives public presence language from the host heartbeat model. */
export function AgentDot({ heartbeat }: { heartbeat?: Heartbeat }) {
  return <AgentDotPresentation status={heartbeatStatus(heartbeat)} />
}

/** Compatibility adapter that derives public presence language from the host heartbeat model. */
export function AgentStatus({ name, heartbeat }: { name: string; heartbeat?: Heartbeat }) {
  return <AgentStatusPresentation name={name} status={heartbeatStatus(heartbeat)} />
}
