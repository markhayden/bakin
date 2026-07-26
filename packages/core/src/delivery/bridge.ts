/**
 * Runtime-neutral channel bridge contract (issue #669).
 *
 * A ChannelBridge gives a runtime WITHOUT a native channel/delivery layer
 * (Pi) a `runtime.channels` surface by delegation. The concrete Discord
 * implementation lives in `src/core/delivery/` — app code; this package only
 * defines the seam so adapter packages can accept a bridge without importing
 * app modules (adapters never import `src/`).
 *
 * Lifecycle: the HANDLE is threaded through `AdapterInitOpts.channelBridge`
 * at adapter init (cheap, no I/O); `boot()`/`shutdown()` are called by the
 * server only — never inside `createAppServices()`, which read-only CLI
 * paths also call. `isConfigured()` must be side-effect-free and callable
 * before boot: adapters use it to decide whether to expose `channels` and
 * whether `capabilities().delivery.mode` reports `'shimmed'` or
 * `'unavailable'`.
 */
import type { AgentRuntimeAdapter } from '../adapters/runtime/concepts'

/** The full channel surface, contract-identical to a native adapter's. */
export type ChannelSurface = NonNullable<AgentRuntimeAdapter['channels']>

export interface ChannelBridge {
  /**
   * True when non-secret config AND the transport secret are present.
   * Side-effect-free; the gate for exposing `channels` on an adapter.
   */
  isConfigured(): boolean
  /** Connect transports. Server-boot only; idempotent. */
  boot(): Promise<void>
  /** Disconnect and release transports. Safe when never booted. */
  shutdown(): Promise<void>
  /**
   * The delegated channel surface. Only meaningful when `isConfigured()`;
   * adapters must not expose it otherwise.
   */
  channels: ChannelSurface
}
