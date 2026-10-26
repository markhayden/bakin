/**
 * Plugin WebSocket routes — the PUBLISHED declaration. A LEAF module (no
 * `@bakin/core` imports), like `api-route.ts`.
 *
 * The host owns the upgrade: same-origin admission and closing every socket
 * when the plugin is disabled, reloaded or shut down. The plugin owns its
 * protocol, identity and flow control.
 */

/** One accepted connection, as the plugin sees it. */
export interface PluginSocket {
  /**
   * Send a text or binary frame; `false` once the connection is closed.
   * There is no host send bound or drain signal (the runtime cannot report a
   * reliable backlog): a protocol that must not outrun its reader
   * acknowledges at the application level.
   */
  send(data: string | Uint8Array): boolean
  /** Text frames arrive as strings, binary frames as bytes. */
  onMessage(listener: (data: string | Uint8Array) => void): void
  /** Fires once, for either side closing (or the host closing it). */
  onClose(listener: (code: number, reason: string) => void): void
  close(code?: number, reason?: string): void
}

export interface SocketRoute {
  /** Plugin-relative path; served at `/api/plugins/{pluginId}{path}`. */
  path: string
  summary: string
  /**
   * Optional extra admission after the host's same-origin check, before the
   * upgrade completes. Return a `Response` to refuse with its status.
   */
  admit?(request: Request): Response | void | Promise<Response | void>
  /** The upgraded connection. Errors thrown here close it with 1011. */
  open(socket: PluginSocket, request: Request): void | Promise<void>
}
