/**
 * `@makinbakin/sdk/conversation` — isolated conversation UI and models.
 *
 * Import this focused entrypoint for conversation models and pure helpers so
 * unrelated UI does not pull the conversation domain into its bundle.
 */
/** Fold persisted rows and live chunks into ordered render-ready turns. */
export { foldConversation } from '@bakin/ui/conversation'
export type {
  ConversationChunk,
  ConversationMessage,
  ConversationTextFormat,
  ConversationToolActivity,
  ConversationToolCall,
  ConversationTurn,
  DisplayAttachment,
  FoldOptions,
  TurnItem,
  TurnStatus,
} from '@bakin/ui/conversation'

/** Compact single-turn output for task and workflow embeds. */
export { TurnOutputView, TurnToolChip, foldTurnChunks } from '@bakin/ui/conversation'
export type {
  FoldedTurnOutput,
  TurnOutputViewProps,
  TurnTextSegment,
  TurnToolChipState,
} from '@bakin/ui/conversation'

/** Bounded, resizable single-session composition for embedded reviews. */
export { ConversationPanel } from '@bakin/ui/conversation'
/** Exact, resizable detail for one conversation tool call. */
export { ToolCallDrawer } from '@bakin/ui/conversation'
export type {
  ConversationPanelProps,
  ToolCallDrawerProps,
} from '@bakin/ui/conversation'

/** Durable bus-driven thread state for server-owned conversational turns. */
export { useConversationThread } from './use-conversation-thread'
export type {
  ConversationQueuedItem,
  ConversationThread,
  ConversationThreadLoad,
  ConversationThreadOptions,
} from './use-conversation-thread'
/** Shared attention, badge, notification, and reply-state primitives. */
export {
  attentionForDone,
  badgeFor,
  visibleIdFromLocation,
  withUnreadPrefix,
} from '@/components/conversation/attention'
export type {
  AttentionActions,
  ConversationAttentionContext,
  ConversationDonePayload,
} from '@/components/conversation/attention'
export { playReplyChime } from '@/components/conversation/notification-sound'
export { ConversationReplyToast } from '@/components/conversation/reply-toast'
export { useConversationAttention } from '@/components/conversation/use-conversation-attention'
export type {
  ConversationAttentionConfig,
  ConversationAttentionTotals,
} from '@/components/conversation/use-conversation-attention'

/** Stable compact, absolute, and calendar-day timestamp helpers. */
export {
  dayKey,
  formatAbsoluteTime,
  formatDayLabel,
  formatRelativeTime,
} from '@bakin/ui/conversation'

/** Collapsible exact tool-activity presentation and compact formatters. */
export {
  ActivityGroup,
  formatDuration,
  humanizeActivity,
  ToolCallRow,
} from '@bakin/ui/conversation'
export type { ActivityGroupProps, ToolCallRowProps } from '@bakin/ui/conversation'

/** Agent and user turn presentation with consumer-owned identity and rich text. */
export {
  AgentTurn,
  CopyButton,
  ThinkingIndicator,
  TurnTimestamp,
  UserMessage,
} from '@bakin/ui/conversation'
export type {
  AgentTurnProps,
  ConversationAgent,
  ConversationAttachmentRenderer,
  ConversationAvatarRenderer,
  ConversationTextRenderer,
  ConversationTextTransform,
  CopyButtonProps,
  ThinkingIndicatorProps,
  TurnTimestampProps,
  UserMessageProps,
} from '@bakin/ui/conversation'
export { formatTokenCount, formatUsageCost } from '@bakin/ui/conversation'
export type { ConversationTurnUsage } from '@bakin/ui/conversation'

/** Document-first conversation timeline and honest zero-message state. */
export {
  Conversation,
  ConversationEmptyState,
} from '@bakin/ui/conversation'
export type {
  ConversationEmptyStateProps,
  ConversationMode,
  ConversationProps,
} from '@bakin/ui/conversation'

/** Persistent, IME-safe composer with consumer-owned attachment mutations. */
export { Composer, writeComposerDraft } from '@bakin/ui/conversation'
export type {
  ComposerAttachmentItem,
  ComposerAttachments,
  ComposerAttachmentStatus,
  ComposerHandle,
  ComposerProps,
} from '@bakin/ui/conversation'

/** Accepted follow-ups waiting behind an active turn. */
export { QueuedMessageList } from '@bakin/ui/conversation'
export type { QueuedMessageListProps } from '@bakin/ui/conversation'
