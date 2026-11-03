/**
 * The ONE `PluginSocket` implementation, over a minimal transport so the
 * host (a `ws` connection) and the SDK test harness (an in-memory pair)
 * share message, close and failure semantics.
 *
 * Deliberately no host send bound or drain signal. Measured on Bun 1.4.3's
 * built-in `ws` with a client that stops reading: `bufferedAmount` stays 0
 * for the first ~18 MiB, then grows, and stays stale after the client has
 * read everything — no reliable backlog or drain can be observed, so none is
 * promised. Protocols that must not outrun their reader acknowledge at the
 * application level (the Terminal plugin's output windows bound its queue).
 */
import type { PluginSocket } from '@makinbakin/sdk/types'
import { createLogger } from '../logger'

const log = createLogger('plugin-socket')

/** What a socket needs from its connection; `ws`'s WebSocket satisfies it. */
export interface SocketTransport {
  send(data: string | Uint8Array): void
  close(code: number, reason: string): void
}

export interface PluginSocketHandle {
  socket: PluginSocket
  /** Feed an incoming frame to the plugin's listeners. */
  deliver(data: string | Uint8Array): void
  /** The connection ended (either side); idempotent. */
  closed(code: number, reason: string): void
}

export function createPluginSocket(transport: SocketTransport): PluginSocketHandle {
  const messageListeners: Array<(data: string | Uint8Array) => void> = []
  const closeListeners: Array<(code: number, reason: string) => void> = []
  let isClosed = false

  const socket: PluginSocket = {
    send(data) {
      if (isClosed) return false
      transport.send(data)
      return true
    },
    onMessage(listener) { messageListeners.push(listener) },
    onClose(listener) { closeListeners.push(listener) },
    close(code = 1000, reason = '') { transport.close(code, reason) },
  }

  return {
    socket,
    deliver(data) {
      if (isClosed) return
      try {
        for (const listener of messageListeners) listener(data)
      } catch (err) {
        // The plugin's own protocol failed; the connection cannot be trusted.
        log.error('Plugin socket message handler failed', err)
        transport.close(1011, 'Plugin socket handler failed')
      }
    },
    closed(code, reason) {
      if (isClosed) return
      isClosed = true
      // One plugin cleanup failure must not skip the others or escape into
      // the host's connection handling.
      for (const listener of closeListeners) {
        try {
          listener(code, reason)
        } catch (err) {
          log.error('Plugin socket close handler failed', err)
        }
      }
    },
  }
}
