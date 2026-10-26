/**
 * The ONE `PluginSocket` implementation, over a minimal transport so the
 * host (a `ws` connection) and the SDK test harness (an in-memory pair)
 * share the send bound, drain and close semantics.
 */
import type { PluginSocket } from '@makinbakin/sdk/types'
import { createLogger } from '../logger'

const log = createLogger('plugin-socket')

/** What a socket needs from its connection; `ws`'s WebSocket satisfies it. */
export interface SocketTransport {
  /** Bytes queued but not yet written. */
  readonly bufferedAmount: number
  /** Queue a frame; `done` runs once it has been written (or failed). */
  send(data: string | Uint8Array, done: (err?: Error) => void): void
  close(code: number, reason: string): void
}

export const DEFAULT_SOCKET_SEND_BOUND = 2 * 1024 * 1024

export interface PluginSocketHandle {
  socket: PluginSocket
  /** Feed an incoming frame to the plugin's listeners. */
  deliver(data: string | Uint8Array): void
  /** The connection ended (either side); idempotent. */
  closed(code: number, reason: string): void
}

export function createPluginSocket(transport: SocketTransport, opts: { sendBound?: number } = {}): PluginSocketHandle {
  const sendBound = opts.sendBound ?? DEFAULT_SOCKET_SEND_BOUND
  const messageListeners: Array<(data: string | Uint8Array) => void> = []
  const drainListeners: Array<() => void> = []
  const closeListeners: Array<(code: number, reason: string) => void> = []
  let wantDrain = false
  let isClosed = false

  const afterWrite = () => {
    if (!wantDrain || transport.bufferedAmount > sendBound / 2) return
    wantDrain = false
    for (const listener of drainListeners) listener()
  }

  const socket: PluginSocket = {
    send(data) {
      if (isClosed) return false
      if (transport.bufferedAmount > sendBound) {
        wantDrain = true
        return false
      }
      transport.send(data, afterWrite)
      return true
    },
    get bufferedBytes() { return transport.bufferedAmount },
    onMessage(listener) { messageListeners.push(listener) },
    onDrain(listener) { drainListeners.push(listener) },
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
      for (const listener of closeListeners) listener(code, reason)
    },
  }
}
