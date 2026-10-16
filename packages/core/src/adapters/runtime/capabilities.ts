/**
 * One capability's provisioning state on a runtime:
 * - 'native'      — the runtime provides it directly.
 * - 'shimmed'     — the runtime doesn't, but a Bakin-owned shim fills it.
 * - 'unavailable' — neither; degrade honestly + surface in the UI.
 *
 * Lives in this LEAF module (no imports) so the delivery seam can name it
 * without importing the runtime contract (shared -> bridge -> readiness
 * must stay acyclic).
 */
export type CapabilityMode = 'native' | 'shimmed' | 'unavailable'

export type ChannelCapability =
  | 'message'
  | 'rich-content'
  | 'interactive-approval'
  | 'modal-input'
  | 'threaded-replies'
  | 'edit-after-send'
  | 'cancel-rendered'

export function hasChannelCapability(
  capabilities: readonly ChannelCapability[],
  capability: ChannelCapability
): boolean {
  return capabilities.includes(capability)
}
