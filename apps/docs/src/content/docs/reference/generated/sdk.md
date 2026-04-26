---
title: SDK Reference
description: Generated audit reference for @bakin/sdk subpath exports.
---

Docs version: Bakin 1.0.0

This page is generated from `packages/sdk/package.json` and SDK barrel files. Full TypeDoc output will replace this audit view once public TSDoc coverage is complete.

## `@bakin/sdk`

Source: `packages/sdk/src/index.ts`

| Export declaration |
| --- |
| `export * from './types'` |
| `export {` |
| `export type { NavItem, PluginRegistration } from './register'` |

## `@bakin/sdk/ui`

Source: `packages/sdk/src/ui/index.ts`

| Export declaration |
| --- |
| `export * from '@/components/ui/alert'` |
| `export * from '@/components/ui/avatar'` |
| `export * from '@/components/ui/badge'` |
| `export * from '@/components/ui/button'` |
| `export * from '@/components/ui/card'` |
| `export * from '@/components/ui/checkbox'` |
| `export * from '@/components/ui/collapsible'` |
| `export * from '@/components/ui/command'` |
| `export * from '@/components/ui/dialog'` |
| `export * from '@/components/ui/dropdown-menu'` |
| `export * from '@/components/ui/form'` |
| `export * from '@/components/ui/input'` |
| `export * from '@/components/ui/input-group'` |
| `export * from '@/components/ui/label'` |
| `export * from '@/components/ui/popover'` |
| `export * from '@/components/ui/progress'` |
| `export * from '@/components/ui/select'` |
| `export * from '@/components/ui/separator'` |
| `export * from '@/components/ui/sheet'` |
| `export * from '@/components/ui/skeleton'` |
| `export * from '@/components/ui/switch'` |
| `export * from '@/components/ui/table'` |
| `export * from '@/components/ui/tabs'` |
| `export * from '@/components/ui/textarea'` |
| `export * from '@/components/ui/tooltip'` |

## `@bakin/sdk/hooks`

Source: `packages/sdk/src/hooks/index.ts`

| Export declaration |
| --- |
| `export { useAssets, useTrash } from '@/hooks/use-assets'` |
| `export { useContentStore } from '@/hooks/use-content-store'` |
| `export { useDebug } from '@/hooks/use-debug'` |
| `export { useFormGuard } from '@/hooks/use-form-guard'` |
| `export { useGatewayStatus } from '@/hooks/use-gateway-status'` |
| `export { useQueryState, useQueryArrayState } from '@/hooks/use-query-state'` |
| `export { useScheduleJobs, useRunHistory } from '@/hooks/use-schedule'` |
| `export type { ScheduleJob, RunEntry } from '@/hooks/use-schedule'` |
| `export { useSearch, reorderBySearchResults } from '@/hooks/use-search'` |
| `export type { SearchResult, SearchResponse, UseSearchOptions, UseSearchReturn } from '@/hooks/use-search'` |
| `export { useSidebar } from '@/hooks/use-sidebar'` |
| `export { useSSE } from '@/hooks/use-sse'` |
| `export { toast, useToastStore } from '@/hooks/use-toast'` |
| `export { useVerticalResize } from '@/hooks/use-vertical-resize'` |
| `export {` |
| `export {` |
| `export { useRouter, usePathname, useSearchParams, useParams } from './router'` |

## `@bakin/sdk/components`

Source: `packages/sdk/src/components/index.ts`

| Export declaration |
| --- |
| `export { AgentAvatar } from '@/components/agent-avatar'` |
| `export { AgentFilter } from '@/components/agent-filter'` |
| `export { AgentSelect } from '@/components/agent-select'` |
| `export { AgentDot, AgentStatus } from '@/components/agent-status'` |
| `export { BakinDrawer } from '@/components/bakin-drawer'` |
| `export { ColorPicker } from '@/components/color-picker'` |
| `export { EmptyState } from '@/components/empty-state'` |
| `export { ErrorBanner } from '@/components/error-banner'` |
| `export { ErrorState } from '@/components/error-state'` |
| `export { FacetFilter } from '@/components/facet-filter'` |
| `export type { FacetOption } from '@/components/facet-filter'` |
| `export { IntegratedBrainstorm } from '@/components/integrated-brainstorm'` |
| `export type {` |
| `export { MarkdownContent } from '@/components/markdown-content'` |
| `export { MarkdownEditor } from '@/components/markdown-editor'` |
| `export { ModelSelect } from '@/components/model-select'` |
| `export { PageLayout } from '@/components/page-layout'` |
| `export { PluginHeader } from '@/components/plugin-header'` |
| `export { PluginSettingsRenderer } from '@/components/plugin-settings-renderer'` |
| `export type { PluginSettingsSchema } from '@/components/plugin-settings-renderer'` |
| `export { SortableHead } from '@/components/sortable-head'` |
| `export type { SortDir } from '@/components/sortable-head'` |
| `export { UnderlineTabs } from '@/components/underline-tabs'` |
| `export type { UnderlineTab } from '@/components/underline-tabs'` |
| `export { ChannelIcon } from '@bakin/workflows/hooks/channel-icon'` |

## `@bakin/sdk/slots`

Source: `packages/sdk/src/slots/index.tsx`

| Export declaration |
| --- |
| `export function registerSlot<TProps>(` |
| `export function getSlotEntries(name: string): ReadonlyArray<SlotEntry> {` |
| `export function clearSlotsOwnedBy(pluginId: string): void {` |
| `export function Slot({ name, ...props }: SlotProps): JSX.Element \| null {` |

## `@bakin/sdk/types`

Source: `packages/sdk/src/types/index.ts`

| Export declaration |
| --- |
| `export type {` |
| `export type { BakinSettings } from '@bakin/core/settings'` |
| `export type { BakinPaths } from '@bakin/core/content-dir'` |
| `export type {` |
| `export type { AvailableModel } from '@bakin/models/types'` |
| `export type { WorkflowDefinition, WorkflowInstance, WorkflowStep, WorkflowTemplate } from '@bakin/workflows/types'` |

## `@bakin/sdk/utils`

Source: `packages/sdk/src/utils/index.ts`

| Export declaration |
| --- |
| `export { cn } from '@/lib/utils'` |
| `export { formatAge, formatSize, isStale } from '@bakin/core/format'` |

## `@bakin/sdk/metadata`

Source: `packages/sdk/src/metadata/index.ts`

| Export declaration |
| --- |
| `export {` |
| `export type {` |
