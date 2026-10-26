export { foldConversation, formatQuestionAnswer } from './fold'
export type {
  BakinQuestion,
  QuestionAnswer,
  QuestionState,
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
} from './fold'

export {
  dayKey,
  formatAbsoluteTime,
  formatDayLabel,
  formatRelativeTime,
} from './relative-time'

export {
  ActivityGroup,
  formatDuration,
  humanizeActivity,
  ToolCallRow,
} from './activity-group'
export type { ActivityGroupProps, ToolCallRowProps } from './activity-group'

export {
  AgentTurn,
  ThinkingIndicator,
} from './agent-turn'
export type {
  AgentTurnProps,
  ConversationAgent,
  ConversationAvatarRenderer,
  ConversationTextRenderer,
  ConversationTextTransform,
  ThinkingIndicatorProps,
} from './agent-turn'

export { CopyButton, TurnTimestamp } from './turn-controls'
export type { CopyButtonProps, TurnTimestampProps } from './turn-controls'

export { UserMessage } from './user-message'
export type {
  ConversationAttachmentRenderer,
  UserMessageProps,
} from './user-message'

export { Conversation } from './conversation'
export type { ConversationMode, ConversationProps } from './conversation'

export { formatTokenCount, formatUsageCost } from './turn-usage'
export type { ConversationTurnUsage } from './turn-usage'

export { ConversationEmptyState } from './conversation-empty-state'
export type { ConversationEmptyStateProps } from './conversation-empty-state'

export { Composer, writeComposerDraft } from './composer'
export type {
  ComposerAttachmentItem,
  ComposerAttachments,
  ComposerAttachmentStatus,
  ComposerHandle,
  ComposerProps,
} from './composer'

export { QueuedMessageList } from './queued-message-list'

/** Attention primitives shared by every conversational surface's badge/toast provider. */
export { attentionForDone, badgeFor, visibleIdFromLocation, withUnreadPrefix } from './attention'
export type { AttentionActions, ConversationAttentionContext, ConversationDonePayload } from './attention'
export { playReplyChime } from './notification-sound'
export { ReplyToastBody } from './reply-toast-body'
export type { ReplyToastBodyProps } from './reply-toast-body'
export type {
  ConversationQueuedItem,
  QueuedMessageListProps,
} from './queued-message-list'

export { ToolCallDrawer } from './tool-call-drawer'
export type { ToolCallDrawerProps } from './tool-call-drawer'

export { ConversationPanel } from './conversation-panel'
export type { ConversationPanelProps } from './conversation-panel'

export { TurnOutputView, TurnToolChip, foldTurnChunks } from './turn-output'
export type {
  FoldedTurnOutput,
  TurnOutputViewProps,
  TurnTextSegment,
  TurnToolChipState,
} from './turn-output'

export { ConversationHeader } from './conversation-header'
export type { ConversationHeaderProps } from './conversation-header'

export { ContextMeter, contextMeterHasContent } from './context-meter'
export type { ContextMeterStats } from './context-meter'
