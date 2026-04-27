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
