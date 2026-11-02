// Host state the browser host store publishes (`useHostStore` on
// `@makinbakin/sdk/hooks`): the live-connection flag, the debug toggle, the
// activity feed rows and full screen. Public because the store is.

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

export interface HostState {
  connected: boolean
  debug: boolean
  activityEvents: ActivityEvent[]
  /** Full screen (useFullscreen): the path of the page holding it, or null. The host hides its chrome while it is set. */
  fullscreen: string | null
}
