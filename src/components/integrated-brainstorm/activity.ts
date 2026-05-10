import type { RuntimeChatChunk } from '@bakin/sdk/types'
import type { BrainstormMessage } from './types'
import { normalizeBrainstormActivityForStorage } from './session'

export interface BrainstormActivityInput {
  kind: string
  content: string
  data?: unknown
}

export interface BrainstormTimelineMessageInput {
  id: string
  role: 'user' | 'assistant' | 'agent'
  content: string
  timestamp?: string
}

export interface BrainstormTimelineActivityInput extends BrainstormActivityInput {
  id: string
  timestamp?: string
}

function newActivityId(): string {
  return `act-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function runtimeChunkToBrainstormActivity(chunk: RuntimeChatChunk): BrainstormActivityInput | null {
  if (chunk.type === 'status') {
    return {
      kind: 'runtime_status',
      content: chunk.content || 'Agent status update',
      data: chunk.data,
    }
  }
  if (chunk.type === 'tool') {
    return {
      kind: 'tool_call',
      content: chunk.content || 'Tool call',
      data: chunk.data,
    }
  }
  if (chunk.type === 'error') {
    return {
      kind: 'error',
      content: chunk.content || 'Runtime stream error',
      data: chunk.data,
    }
  }
  return null
}

export function brainstormActivityMessageFromCustom(name: string, data: unknown): BrainstormMessage | null {
  if (name !== 'activity') return null
  const payload = data && typeof data === 'object' && 'activity' in data
    ? (data as { activity?: unknown }).activity
    : data
  if (!payload || typeof payload !== 'object') return null
  const activity = payload as Record<string, unknown>
  const content = typeof activity.content === 'string' ? activity.content : ''
  if (!content) return null
  const normalized = normalizeBrainstormActivityForStorage({
    kind: typeof activity.kind === 'string' ? activity.kind : 'runtime_status',
    content,
    data: activity.data,
  })
  if (!normalized) return null
  return {
    id: typeof activity.id === 'string' ? activity.id : newActivityId(),
    role: 'activity',
    kind: normalized.kind,
    content: normalized.content,
    ...(normalized.data !== undefined ? { data: normalized.data } : {}),
    timestamp: typeof activity.timestamp === 'string' ? activity.timestamp : new Date().toISOString(),
  }
}

export function toBrainstormTimeline(
  agentId: string,
  input: {
    messages: BrainstormTimelineMessageInput[]
    activities?: BrainstormTimelineActivityInput[]
  },
): BrainstormMessage[] {
  return [
    ...input.messages.map((message): BrainstormMessage => ({
      id: message.id,
      role: message.role === 'user' ? 'user' : 'assistant',
      content: message.content,
      agentId: message.role === 'user' ? undefined : agentId,
      timestamp: message.timestamp,
    })),
    ...(input.activities ?? []).map((activity): BrainstormMessage => ({
      id: activity.id,
      role: 'activity',
      kind: activity.kind,
      content: activity.content,
      data: activity.data,
      timestamp: activity.timestamp,
    })),
  ].sort((a, b) => {
    const aTime = a.timestamp ? Date.parse(a.timestamp) : 0
    const bTime = b.timestamp ? Date.parse(b.timestamp) : 0
    return aTime - bTime
  })
}
