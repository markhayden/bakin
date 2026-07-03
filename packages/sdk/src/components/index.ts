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
/** Single-agent picker dropdown for form fields. */
export { AgentSelect } from '@/components/agent-select'
/** Small status dot showing an agent's online/offline state. */
export { AgentDot } from '@/components/agent-status'
/** Compound agent status (dot + label + last-seen timestamp). */
export { AgentStatus } from '@/components/agent-status'
/** Right-side slide-out drawer with backdrop and focus trap. */
export { BakinDrawer } from '@/components/bakin-drawer'
/** Color picker swatch grid for tag/agent color assignment. */
export { ColorPicker } from '@/components/color-picker'
/** Controlled confirmation dialog for destructive actions (busy/error aware). */
export { ConfirmDialog } from '@/components/confirm-dialog'
export type { ConfirmDialogProps } from '@/components/confirm-dialog'
/** Centered empty-state component with icon, title, and CTA. */
export { EmptyState } from '@/components/empty-state'

export { SearchUnavailable } from '@/components/search-unavailable'
/** Inline error banner with dismiss + retry actions. */
export { ErrorBanner } from '@/components/error-banner'
/** Full-page error state with title, description, and retry button. */
export { ErrorState } from '@/components/error-state'
/** Popover multi-select facet filter (column, owner, tag, etc.). */
export { FacetFilter } from '@/components/facet-filter'
export type { FacetOption } from '@/components/facet-filter'
/** Chat + plan-proposal review panel for brainstorm sessions. */
export { IntegratedBrainstorm } from '@/components/integrated-brainstorm'
export type {
  BrainstormMessage,
  IntegratedBrainstormProps,
  BrainstormOnSend,
  SendContext,
  AssistantTransformed,
  BrainstormActivityInput,
  BrainstormActivityStorageInput,
  BrainstormActivityStorageRecord,
  BrainstormTimelineActivityInput,
  BrainstormTimelineMessageInput,
} from '@/components/integrated-brainstorm'
/** Convert a custom activity message back into a brainstorm activity. */
export { brainstormActivityMessageFromCustom } from '@/components/integrated-brainstorm'
/** Compute the canonical thread ID for a brainstorm session. */
export { brainstormThreadId } from '@/components/integrated-brainstorm'
/** Normalize a brainstorm activity payload for persistence. */
export { normalizeBrainstormActivityForStorage } from '@/components/integrated-brainstorm'
/** Normalize a single brainstorm message for persistence. */
export { normalizeBrainstormActivityMessageForStorage } from '@/components/integrated-brainstorm'
/** Read an SSE response stream into brainstorm activity events. */
export { readBrainstormSseResponse } from '@/components/integrated-brainstorm'
/** Convert a runtime chat chunk to a brainstorm activity event. */
export { runtimeChunkToBrainstormActivity } from '@/components/integrated-brainstorm'
/** Fold a brainstorm session's events into a renderable timeline. */
export { toBrainstormTimeline } from '@/components/integrated-brainstorm'
/** Render markdown content with syntax highlighting and link handling. */
export { MarkdownContent } from '@/components/markdown-content'
/** Editable markdown text area with preview toggle. */
export { MarkdownEditor } from '@/components/markdown-editor'
/** Model picker dropdown listing available models from the catalog. */
export { ModelSelect } from '@/components/model-select'
/** Standard plugin page wrapper with header, content area, and toaster. */
export { PageLayout } from '@/components/page-layout'
/** Plugin page header with title, count badge, search, and action buttons. */
export { PluginHeader } from '@/components/plugin-header'
/** Render a settings form from a PluginSettingsSchema definition. */
export { PluginSettingsRenderer } from '@/components/plugin-settings-renderer'
export type { PluginSettingsSchema } from '@/components/plugin-settings-renderer'
// Note: PluginSlot is NOT re-exported here. The Phase 2 `<Slot>` primitive
// (with cleaner plugin-contributed renderer registration) supersedes it. The
// existing `PluginSlot` pulls in server-only plugin-registry state and breaks
// client SSR bundling when re-exported through this barrel.
/** Sortable table column header with ascending/descending indicator. */
export { SortableHead } from '@/components/sortable-head'
export type { SortDir } from '@/components/sortable-head'
/** Tab list with animated underline indicator. */
export { UnderlineTabs } from '@/components/underline-tabs'
export type { UnderlineTab } from '@/components/underline-tabs'

// Notification channel icon (from workflows plugin registry)

/** Icon component for a notification channel (Discord, Slack, email, etc.). */
export { ChannelIcon } from '@bakin/workflows/hooks/channel-icon'
