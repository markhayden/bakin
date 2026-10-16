/**
 * Neutral channel-bridge seam (#669, reshaped by channel-readiness #908).
 *
 * A runtime WITHOUT a native delivery layer (Pi) is handed a ChannelBridge
 * through AdapterInitOpts and serves `runtime.channels` by delegation. The
 * handle is always constructible and cheap; the transport only connects
 * when the SERVER reconciles it. Channel contract types live in the leaf
 * module ../adapters/runtime/channels so shared -> bridge -> channels stays
 * acyclic.
 */
import type { RuntimeChannelSurface } from '../adapters/runtime/channels'
import type { BridgeStatus } from './readiness'

export type ChannelSurface = RuntimeChannelSurface

export type ReconcileReason = 'boot' | 'settings' | 'secret' | 'operator' | 'runtime'

export interface ChannelBridge {
  /**
   * Non-secret config says "on" AND the transport secret is present AND at
   * least one guild is configured. Side-effect-free — adapters call this to
   * decide what `capabilities().delivery.mode` claims.
   */
  isConfigured(): boolean
  /** What the bridge knows right now (no settings, no runtime facts). */
  status(): BridgeStatus
  /**
   * Converge the transport on the CURRENT configuration. Resolves with the
   * status for the LATEST generation (a change that lands mid-attempt is
   * honored before the promise settles), or the idle status once stopped.
   * Safe to call concurrently; `'operator'` joins a running loop.
   */
  reconcile(reason: ReconcileReason): Promise<BridgeStatus>
  /** Every published status transition. Listeners are isolated from each other. */
  subscribe(listener: (status: BridgeStatus) => void): () => void
  /** Server shutdown: drains the loop and destroys the transport. */
  shutdown(): Promise<void>
  /**
   * The runtime channel surface. ALWAYS present: subscribe members are
   * safe at any time; delivering members throw a typed DeliveryError
   * (`not_configured` / `not_connected`, with the readiness state in
   * `detail`) until the transport is applied.
   */
  channels: ChannelSurface
}
