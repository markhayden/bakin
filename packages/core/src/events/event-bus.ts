/**
 * EventBus implementation that layers on top of the existing SSE broadcast.
 * Supports exact-match and prefix-glob subscriptions (e.g. "task.*").
 */
import type { EventBus } from '../plugin-types'

type Handler = (event: string, data: Record<string, unknown>) => void
type BroadcastFn = (data: Record<string, unknown>) => void

interface Subscription {
  pattern: string
  handler: Handler
  once: boolean
}

function matchPattern(pattern: string, event: string): boolean {
  if (pattern === event) return true
  // Prefix glob: "task.*" matches "task.created", "task.moved", etc.
  if (pattern.endsWith('.*')) {
    const prefix = pattern.slice(0, -2)
    return event === prefix || event.startsWith(prefix + '.')
  }
  return false
}

export class BakinEventBus implements EventBus {
  private subscriptions: Subscription[] = []
  private broadcast: BroadcastFn

  constructor(broadcast: BroadcastFn) {
    this.broadcast = broadcast
  }

  emit(event: string, data: Record<string, unknown> = {}): void {
    // Send to SSE clients
    this.broadcast({ type: 'plugin-event', event, ...data, timestamp: new Date().toISOString() })

    // Notify local subscribers
    this.notifyLocal(event, data)
  }

  on(pattern: string, handler: Handler): () => void {
    const sub: Subscription = { pattern, handler, once: false }
    this.subscriptions.push(sub)
    return () => {
      const idx = this.subscriptions.indexOf(sub)
      if (idx !== -1) this.subscriptions.splice(idx, 1)
    }
  }

  once(pattern: string, handler: Handler): () => void {
    const sub: Subscription = { pattern, handler, once: true }
    this.subscriptions.push(sub)
    return () => {
      const idx = this.subscriptions.indexOf(sub)
      if (idx !== -1) this.subscriptions.splice(idx, 1)
    }
  }

  /**
   * Called by server.ts handleFileEvent to notify plugins of file changes.
   */
  injectFileEvent(relativePath: string, event: string, content?: string): void {
    const data: Record<string, unknown> = { file: relativePath, event }
    if (content !== undefined) data.content = content
    this.notifyLocal(`file.${event}`, data)
  }

  private notifyLocal(event: string, data: Record<string, unknown>): void {
    const toRemove: Subscription[] = []
    for (const sub of this.subscriptions) {
      if (matchPattern(sub.pattern, event)) {
        try {
          sub.handler(event, data)
        } catch (err) {
          console.error(`EventBus handler error for "${sub.pattern}":`, err)
        }
        if (sub.once) toRemove.push(sub)
      }
    }
    for (const sub of toRemove) {
      const idx = this.subscriptions.indexOf(sub)
      if (idx !== -1) this.subscriptions.splice(idx, 1)
    }
  }
}
