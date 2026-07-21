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

/** Response-scoped SSE reader and state machine for streamed turns. */
export { readConversationSseStream } from './sse'
export type { ConversationSseHandlers } from './sse'
/** One-at-a-time streamed-turn state for focused conversation surfaces. */
export { useConversationStream } from './use-conversation-stream'
export type {
  ConversationStream,
  ConversationStreamOptions,
} from './use-conversation-stream'

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
export { Composer } from '@bakin/ui/conversation'
export type {
  ComposerAttachmentItem,
  ComposerAttachments,
  ComposerAttachmentStatus,
  ComposerProps,
} from '@bakin/ui/conversation'
