/**
 * `@bakin/sdk/components` — shared layout + compound components.
 *
 * Plugin-author-visible components that wrap shadcn primitives with Bakin-
 * specific behavior (headers, filters, markdown, agent displays, etc.). Does
 * not include layout chrome (sidebar, header, toaster) — those are Bakin's
 * shell, not plugin-author territory.
 */
export { AgentAvatar } from '@/components/agent-avatar'
export { AgentFilter } from '@/components/agent-filter'
export { AgentSelect } from '@/components/agent-select'
export { AgentDot, AgentStatus } from '@/components/agent-status'
export { BakinDrawer } from '@/components/bakin-drawer'
export { ColorPicker } from '@/components/color-picker'
export { EmptyState } from '@/components/empty-state'
export { ErrorBanner } from '@/components/error-banner'
export { ErrorState } from '@/components/error-state'
export { FacetFilter } from '@/components/facet-filter'
export type { FacetOption } from '@/components/facet-filter'
export { IntegratedBrainstorm } from '@/components/integrated-brainstorm'
export type {
  BrainstormMessage,
  IntegratedBrainstormProps,
  BrainstormOnSend,
  SendContext,
  AssistantTransformed,
} from '@/components/integrated-brainstorm'
export { MarkdownContent } from '@/components/markdown-content'
export { MarkdownEditor } from '@/components/markdown-editor'
export { ModelSelect } from '@/components/model-select'
export { PageLayout } from '@/components/page-layout'
export { PluginHeader } from '@/components/plugin-header'
export { PluginSettingsRenderer } from '@/components/plugin-settings-renderer'
export type { PluginSettingsSchema } from '@/components/plugin-settings-renderer'
// Note: PluginSlot is NOT re-exported here. The Phase 2 `<Slot>` primitive
// (with cleaner plugin-contributed renderer registration) supersedes it. The
// existing `PluginSlot` pulls in server-only plugin-registry state and breaks
// client SSR bundling when re-exported through this barrel.
export { SortableHead } from '@/components/sortable-head'
export type { SortDir } from '@/components/sortable-head'
export { UnderlineTabs } from '@/components/underline-tabs'
export type { UnderlineTab } from '@/components/underline-tabs'

// Notification channel icon (from workflows plugin registry)
export { ChannelIcon } from '@bakin/workflows/hooks/channel-icon'
