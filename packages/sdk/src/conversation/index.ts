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
