/**
 * Plugin gates (spec D26) — ONE core kind handler for `plugin-gate` approvals
 * that fans each decision out to the plugin handler registered for
 * `(pluginId, gateKind)`. Plugins register gates during activate() (via
 * ctx.approvals) and lose them on deactivate/hot reload; core keeps the
 * record, the provenance policy and the one decision path.
 *
 * A record whose plugin is not loaded is never guessed at: resolve answers
 * ApprovalKindUnavailableError (503) and rehydration skips it (ownerState
 * throws), so an uninstalled or not-yet-activated plugin can never get its
 * pending sign-offs cancelled out from under it.
 */
import { getSettings } from '../settings'
import { ApprovalKindUnavailableError, ApprovalResolveError } from './errors'
import { getApprovalKind, registerApprovalKind, type ApprovalDecision, type ApprovalKindHandler, type ApprovalOwnerState, type RecordOf } from './kinds'

export type PluginGateRecord = RecordOf<'plugin-gate'>

export interface PluginGateHandler {
  /** Still waiting on this decision? `orphaned` cancels it at rehydration; `unknown` skips. */
  ownerState(record: PluginGateRecord): Promise<ApprovalOwnerState> | ApprovalOwnerState
  /** Apply the decision; throw ApprovalResolveError to refuse (the record stays pending). */
  onResolve(record: PluginGateRecord, decision: ApprovalDecision): Promise<unknown> | unknown
}

const gates = new Map<string, PluginGateHandler>()
const gateKey = (pluginId: string, gateKind: string) => `${pluginId}\u0000${gateKind}`

function handlerFor(record: PluginGateRecord): PluginGateHandler {
  const handler = gates.get(gateKey(record.owner.pluginId, record.owner.gateKind))
  if (!handler) throw new ApprovalKindUnavailableError(`plugin-gate:${record.owner.pluginId}/${record.owner.gateKind}`)
  return handler
}

const pluginGateApprovalKind: ApprovalKindHandler<'plugin-gate'> = {
  kind: 'plugin-gate',
  ownerState: async (record) => handlerFor(record).ownerState(record),
  onResolve: async (record, decision) => {
    const handler = handlerFor(record)
    // The one reject-reason rule, as for workflow gates: a typed surface
    // (board, CLI) must carry a reason when the setting asks for one; a
    // channel button without a reason modal is the provider's decision.
    const typedSurface = decision.provenance.channel !== 'discord' && decision.provenance.channel !== 'runtime'
    if (decision.option === 'reject' && !decision.comment?.trim() && typedSurface && getSettings().approvals.requireRejectReason) {
      throw new ApprovalResolveError('A reject reason is required', 400)
    }
    return handler.onResolve(record, decision)
  },
}

/** Idempotent: the kind exists whether or not any plugin has registered a gate yet. */
export function registerPluginGateKind(): void {
  if (getApprovalKind('plugin-gate') !== pluginGateApprovalKind) registerApprovalKind(pluginGateApprovalKind)
}

/** Register one plugin's gate; the returned function removes exactly this registration. */
export function registerPluginGate(pluginId: string, gateKind: string, handler: PluginGateHandler): () => void {
  registerPluginGateKind()
  const key = gateKey(pluginId, gateKind)
  gates.set(key, handler)
  return () => {
    if (gates.get(key) === handler) gates.delete(key)
  }
}

/** Teardown: drop every gate a plugin registered (deactivate / hot reload). */
export function unregisterPluginGates(pluginId: string): void {
  for (const key of [...gates.keys()]) {
    if (key.startsWith(`${pluginId}\u0000`)) gates.delete(key)
  }
}

export function hasPluginGate(pluginId: string, gateKind: string): boolean {
  return gates.has(gateKey(pluginId, gateKind))
}

/** Test-only: forget every plugin gate. */
export function clearPluginGates(): void {
  gates.clear()
}
