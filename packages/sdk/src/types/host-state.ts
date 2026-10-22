// Host state the SSE content store publishes (`useContentStore` on
// `@makinbakin/sdk/hooks`): the activity feed rows, the per-agent heartbeat
// and the connected/files/heartbeats snapshot. Public because the store is.

export interface Heartbeat {
  status: 'working' | 'idle' | 'down'
  currentTask?: string
  timestamp: string
}

export interface ActivityEvent {
  id: string
  ts: string
  type: 'log' | 'audit' | 'alert'
  agent: string
  message: string
  taskId?: string
  taskTitle?: string
  eventName?: string
  duplicate?: boolean
  data?: Record<string, unknown>
}

export interface ContentState {
  files: Record<string, string>
  heartbeats: Record<string, Heartbeat>
  connected: boolean
}
