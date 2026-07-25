/**
 * `@makinbakin/sdk/components` — shared layout + compound components.
 *
 * Plugin-author-visible components that wrap shadcn primitives with Bakin-
 * specific behavior (headers, filters, markdown, agent displays, etc.). Does
 * not include layout chrome (sidebar, header, toaster) — those are Bakin's
 * shell, not plugin-author territory.
 */

/** Round avatar image for an agent, falls back to initials. */
export { AgentAvatar } from '@/components/agent-avatar'
/** Multi-select facet filter scoped to agents. */
export { AgentFilter } from '@/components/agent-filter'
export type { AgentFilterProps } from '@/components/agent-filter'
/** Single-agent (or team, #189) picker dropdown for form fields. */
export { AgentSelect, TEAM_VALUE_PREFIX, isTeamValue, teamIdFromValue } from '@/components/agent-select'
/** Small status dot showing an agent's online/offline state. */
export { AgentDot } from '@/components/agent-status'
/** Compound agent status (dot + label + last-seen timestamp). */
export { AgentStatus } from '@/components/agent-status'
/** Modal asset chooser (thumbnail grid + search + upload-new) over the assets plugin — never a raw id select. */
export { AssetPicker } from '@/components/asset-picker'
export type { AssetPickerProps, AssetPickerAsset } from '@/components/asset-picker'
/** Right-side slide-out drawer with backdrop and focus trap. */
export { BakinDrawer } from '@/components/bakin-drawer'
export type { BakinDrawerProps } from '@/components/bakin-drawer'
/** Color picker swatch grid for tag/agent color assignment. */
export { ColorPicker } from '@/components/color-picker'
/** Controlled confirmation dialog for destructive actions (busy/error aware; optional typed confirmation via `confirmValue`). */
export { ConfirmDialog } from '@/components/confirm-dialog'
export type { ConfirmDialogProps } from '@/components/confirm-dialog'
/** Red-bordered destructive settings section with typed-confirmation delete — bottom of every settings surface. */
export { DangerZone } from '@/components/danger-zone'
export type { DangerZoneProps } from '@/components/danger-zone'
/** Centered empty-state component with icon, title, and CTA. */
export { EmptyState } from '@/components/empty-state'
/** Sticky save/discard bar for staged-draft pages (THE dirty-state pattern). */
export { SaveBar } from '@/components/save-bar'
export type { SaveBarProps } from '@/components/save-bar'
/** @deprecated Unload-only protection; use the complete guard from `@makinbakin/sdk/navigation`. */
export { useUnsavedGuard } from '@/components/save-bar'
/** @deprecated Import the complete dirty-exit guard from `@makinbakin/sdk/navigation`. */
export { useUnsavedChangesGuard } from '@/components/unsaved-changes-guard'
export type { UnsavedChangesGuardOptions } from '@/components/unsaved-changes-guard'
/** Titled card with icon + a one-line "why this matters" description — the standard section wrapper. */
export { SectionCard } from '@/components/section-card'
export type { SectionCardProps } from '@/components/section-card'
/** THE segmented control / mode toggle (Edit|Preview, Board|Log, time windows) — tablist semantics, neutral active segment. */
export { SegmentedControl } from '@/components/segmented-control'
export type { SegmentedControlProps, SegmentedControlOption } from '@/components/segmented-control'
/** THE metric tile — icon + uppercase micro-label + tabular big number, optional sub/meter. */
export { StatTile } from '@/components/stat-tile'
export type { StatTileProps } from '@/components/stat-tile'
/** THE status chip — one tone scale (neutral/success/warning/destructive/accent) for every state badge. */
export { StatusBadge } from '@/components/status-badge'
export type { StatusBadgeProps, StatusTone } from '@/components/status-badge'

/** Replace an affected result region when search returns no trustworthy result. */
export { SearchUnavailable } from '../patterns/search-patterns'
/** Show fused and per-leg search relevance as exact, non-color-dependent evidence. */
export { ScoreOverlay } from '../patterns/search-patterns'
/** Approximate matched fields when the adapter has no exact metadata. */
export { computeMatchedFields } from '../patterns/search-patterns'
/** Disclose the exact sources that degraded or exceeded the search budget. */
export { SearchPartialChip } from '../patterns/search-patterns'
/** Disclose that usable results came from a named lower-quality fallback. */
export { SearchDegradedChip } from '../patterns/search-patterns'
export type {
  ScoreOverlayInfo,
  ScoreOverlayProps,
  SearchDegradedChipProps,
  SearchPartialChipProps,
  SearchPartialMeta,
  SearchUnavailableProps,
} from '../patterns/search-patterns'
/** Inline error banner with dismiss + retry actions. */
export { ErrorBanner } from '@/components/error-banner'
/** Full-page error state with title, description, and retry button. */
export { ErrorState } from '@/components/error-state'
/** Popover multi-select facet filter (column, owner, tag, etc.). */
export { FacetFilter } from '@/components/facet-filter'
export type { FacetFilterProps, FacetOption } from '@/components/facet-filter'
/** Chat + plan-proposal review panel for brainstorm sessions. */
// IntegratedBrainstorm was DELETED (2026-07): embedded conversation
// surfaces compose ConversationPanel + useConversationThread instead
// (see the conversation-kit exports below).
/** Render safe GFM, code, media, and visibly identified Bakin-managed sections. */
export { MarkdownContent } from '@makinbakin/sdk/content'
export type { MarkdownContentProps, MarkdownInternalLinkProps } from '@makinbakin/sdk/content'
/** Controlled edit or preview surface with semantic format and height options. */
export { MarkdownEditor } from '@makinbakin/sdk/content'
export type {
  MarkdownEditorFormat,
  MarkdownEditorHeight,
  MarkdownEditorMode,
  MarkdownEditorProps,
} from '@makinbakin/sdk/content'
/** Model picker dropdown listing available models from the catalog. */
export { ModelSelect } from '@/components/model-select'
/** Standard plugin page wrapper with header, content area, and toaster. */
export { PageLayout } from '@/components/page-layout'
/** @deprecated Import runtime-route links from `@makinbakin/sdk/navigation`. */
export { PluginLink } from './plugin-link'
export type { PluginLinkProps } from './plugin-link'
/** Plugin page header with title, count badge, search, and action buttons. */
export { PluginHeader } from '@/components/plugin-header'
export type { PluginHeaderProps } from '@/components/plugin-header'
/** Render a settings form from a PluginSettingsSchema definition. */
export { PluginSettingsRenderer } from '@/components/plugin-settings-renderer'
export type { PluginSettingsSchema } from '@/components/plugin-settings-renderer'
// Note: PluginSlot is NOT re-exported here. The Phase 2 `<Slot>` primitive
// (with cleaner plugin-contributed renderer registration) supersedes it. The
// existing `PluginSlot` pulls in server-only plugin-registry state and breaks
// client SSR bundling when re-exported through this barrel.
/** Sortable table column header with ascending/descending indicator. */
export { SortableHead } from '@/components/sortable-head'
export type { SortableHeadProps, SortDir } from '@/components/sortable-head'
/** Tab list with animated underline indicator. */
export { UnderlineTabs } from '@/components/underline-tabs'
export type { UnderlineTab, UnderlineTabsProps } from '@/components/underline-tabs'
/** THE single renderer for normalized turn chunks (text/tool/status/error) — turn-output surfaces consume this, never hand-rolled format heuristics. */
export { TurnOutputView, TurnToolChip, foldTurnChunks } from '@/components/turn-output-view'
export type { TurnOutputViewProps, TurnToolChipState, TurnTextSegment, FoldedTurnOutput } from '@/components/turn-output-view'

// Conversation kit — THE folding engine + turn model + renderers every
// conversational surface builds on (chat plugin, embedded brainstorm
// panels, turn output). New chat-like surfaces compose these; never
// hand-roll message/tool rendering.
/** Fold persisted rows and live chunks into ordered render-ready turns. */
export { foldConversation } from '@makinbakin/sdk/conversation'
export type {
  ConversationMessage,
  ConversationTurn,
  ConversationToolCall,
  TurnItem,
  TurnStatus,
  DisplayAttachment,
  FoldOptions,
} from '@makinbakin/sdk/conversation'
/** Legacy contained adapter; use `@makinbakin/sdk/conversation` for new consumers. */
export { Conversation } from '@/components/conversation/conversation'
export type { ConversationProps } from '@/components/conversation/conversation'
/** Legacy turn presentation; use `@makinbakin/sdk/conversation` for new consumers. */
export { AgentTurn, ThinkingIndicator, CopyButton, TurnTimestamp } from '@/components/conversation/agent-turn'
export type { AgentTurnProps } from '@/components/conversation/agent-turn'
/** Legacy user-message presentation; use `@makinbakin/sdk/conversation` for new consumers. */
export { UserMessage } from '@/components/conversation/user-message'
export type { UserMessageProps } from '@/components/conversation/user-message'
/** Legacy tool-activity presentation; use `@makinbakin/sdk/conversation` for new consumers. */
export { ActivityGroup, ToolCallRow, formatDuration, humanizeActivity } from '@/components/conversation/activity-group'
export type { ActivityGroupProps } from '@/components/conversation/activity-group'
export { ToolCallDrawer } from '@/components/conversation/tool-call-drawer'
export type { ToolCallDrawerProps } from '@/components/conversation/tool-call-drawer'
/** Legacy composer adapter; use `@makinbakin/sdk/conversation` for new consumers. */
export { Composer } from '@/components/conversation/composer'
export type {
  ComposerProps,
  ComposerAttachments,
  ComposerAttachmentItem,
  ComposerAttachmentStatus,
} from '@/components/conversation/composer'
export { ConversationPanel } from '@/components/conversation/conversation-panel'
export type { ConversationPanelProps } from '@/components/conversation/conversation-panel'
export { useConversationThread } from '@makinbakin/sdk/conversation'
export type {
  ConversationThread,
  ConversationThreadLoad,
  ConversationThreadOptions,
} from '@makinbakin/sdk/conversation'
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
/** Legacy empty-state adapter; use `@makinbakin/sdk/conversation` for new consumers. */
export { ConversationEmptyState } from '@/components/conversation/conversation-empty-state'
export type { ConversationEmptyStateProps } from '@/components/conversation/conversation-empty-state'
/** Compact and absolute timestamp helpers retained for legacy consumers. */
export { formatRelativeTime, formatAbsoluteTime } from '@makinbakin/sdk/conversation'

// Notification channel icon (from workflows plugin registry)

/** Icon component for a notification channel (Discord, Slack, email, etc.). */
export { ChannelIcon } from '@bakin/workflows/hooks/channel-icon'

// Chart kit (#385) — dependency-free SVG charts with exact accessible tables.

/** Exact table/disclosure shared by visual chart summaries. */
export { ChartDataTable } from '@/components/charts/chart-data-table'
export type { ChartDataTableProps, ChartDatum, ChartSeries } from '@/components/charts/chart-data-table'
/** Multi-series SVG line chart with keyboard-equivalent marks. */
export { LineChart } from '@/components/charts/line-chart'
export type { LineChartProps } from '@/components/charts/line-chart'
/** Grouped or stacked SVG bar chart with keyboard-equivalent marks. */
export { BarChart } from '@/components/charts/bar-chart'
export type { BarChartProps } from '@/components/charts/bar-chart'
/** Stacked column chart with legend toggle + per-column pointer/keyboard breakdown. */
export { StackedColumnChart } from '@/components/charts/stacked-column-chart'
export type { StackedColumnChartProps, StackedColumnDatum } from '@/components/charts/stacked-column-chart'
/** Tiny inline SVG trend line for embedding beside a stat. */
export { Sparkline } from '@/components/charts/sparkline'
export type { SparklineProps } from '@/components/charts/sparkline'
/** One-line "what am I looking at / when to worry" chart footer. */
export { ChartExplainer } from '@/components/charts/chart-explainer'
/** CVD-validated series palette + deterministic entity→color assignment. */
export { CHART_SERIES_COLORS, CHART_OTHER_COLOR, CHART_MAX_SERIES, assignSeriesColors } from '@/components/charts/palette'
