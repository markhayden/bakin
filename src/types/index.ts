// Shell-only client types. The task/calendar/memory/project types that once
// lived here were Next.js-era residue (12 dead exports) — deleted; task types
// are single-homed in the SDK / core store. These three back the SSE content
// store and agent-status UI.

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
