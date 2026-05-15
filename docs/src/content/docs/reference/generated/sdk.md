---
title: SDK Reference
description: Generated audit reference for @makinbakin/sdk subpath exports.
---

## `@makinbakin/sdk`

Source: `packages/sdk/src/index.ts`

| Export declaration |
| --- |
| `export * from './types'` |
| `export {` |
| `export type { ClientRouteEntry, MatchedPluginRoute, NavItem, PluginRegistration } from './register'` |
| `export { defineRoute, defineCoreRoute, definePlugin } from './routing'` |
| `export type {` |

## `@makinbakin/sdk/ui`

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

## `@makinbakin/sdk/hooks`

Source: `packages/sdk/src/hooks/index.ts`

| Export declaration |
| --- |
| `export { useAssets, useTrash } from '@/hooks/use-assets'` |
| `export { useContentStore } from '@/hooks/use-content-store'` |
| `export { useDebug } from '@/hooks/use-debug'` |
| `export { useFormGuard } from '@/hooks/use-form-guard'` |
| `export { useRuntimeStatus } from '@/hooks/use-runtime-status'` |
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

## `@makinbakin/sdk/components`

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
| `export {` |
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

## `@makinbakin/sdk/slots`

Source: `packages/sdk/src/slots/index.tsx`

| Export declaration |
| --- |
| `export function registerSlot<TProps>(` |
| `export function getSlotEntries(name: string): ReadonlyArray<SlotEntry> {` |
| `export function clearSlotsOwnedBy(pluginId: string): void {` |
| `export function Slot({ name, ...props }: SlotProps): JSX.Element \| null {` |

## `@makinbakin/sdk/types`

Source: `packages/sdk/src/types/index.ts`

| Export declaration |
| --- |
| `export type HttpMethod = 'GET' \| 'POST' \| 'PUT' \| 'PATCH' \| 'DELETE'` |
| `export type ContractVisibility = 'public' \| 'internal' \| 'experimental'` |
| `export type ContractStability = 'stable' \| 'beta' \| 'experimental' \| 'deprecated'` |
| `export interface SchemaLike<T = unknown> {` |
| `export interface SourceLocation {` |
| `export interface DocsExample {` |
| `export type PluginPermission =` |
| `export type RuntimeCapability =` |
| `export interface PluginEntryPoints {` |
| `export interface SecretDeclaration {` |
| `export interface ApiRouteContribution {` |
| `export type JsonSchemaContribution = Record<string, unknown>` |
| `export interface ApiParameterContribution {` |
| `export interface ApiRequestBodyContribution {` |
| `export interface ApiResponseContribution {` |
| `export interface ClientRouteContribution {` |
| `export interface ExecToolContribution {` |
| `export interface CliCommandContribution {` |
| `export interface SettingsContribution {` |
| `export interface DocsContribution {` |
| `export interface PluginContributions {` |
| `export interface PluginManifestSignature {` |
| `export interface PluginManifest {` |
| `export interface StorageStat {` |
| `export interface StorageAdapter {` |
| `export interface EventBus {` |
| `export interface ActivityAPI {` |
| `export interface PluginLogger {` |
| `export interface HookAPI {` |
| `export interface HookRegistrationMetadata {` |
| `export type HookKind = 'rpc' \| 'event' \| 'waterfall'` |
| `export interface NavItem {` |
| `export interface APIRoute {` |
| `export interface UISlotRegistration {` |
| `export interface ContentFile {` |
| `export interface RuntimeAgent {` |
| `export interface RuntimeChannel {` |
| `export interface RuntimeMessageArgs {` |
| `export interface RuntimeMessageResult {` |
| `export interface RuntimeToolActivity {` |
| `export interface RuntimeChatChunk {` |
| `export interface CronJob {` |
| `export interface CronRun {` |
| `export interface RuntimeSkill {` |
| `export interface WorkspaceFile {` |
| `export interface AgentRuntimeAdapter {` |
| `export interface TaskLogEntry {` |
| `export interface Task {` |
| `export interface TaskSource {` |
| `export interface TaskColumns {` |
| `export interface TaskBoard {` |
| `export type ColumnId = keyof TaskColumns` |
| `export interface TaskCreateInput {` |
| `export interface TaskUpdateInput {` |
| `export interface TaskService {` |
| `export interface SearchSchemaField {` |
| `export interface SearchIndexDefinition {` |
| `export interface SearchContentTypeDefinition {` |
| `export interface FilePatternMapper {` |
| `export interface FileBackedContentTypeDefinition extends SearchContentTypeDefinition {` |
| `export interface SearchQueryParams {` |
| `export interface SearchResult {` |
| `export interface SearchResponse {` |
| `export interface SearchHealthSnapshot {` |
| `export interface SearchTransformOp {` |
| `export interface SearchAPI {` |
| `export interface AssetVariantMeta {` |
| `export interface AssetMeta {` |
| `export interface TrashedAssetMeta {` |
| `export interface AssetFileRef {` |
| `export interface AssetsAPI {` |
| `export interface ExecToolResult {` |
| `export interface PluginToolContext {` |
| `export interface ExecToolDefinition {` |
| `export interface SkillDefinition {` |
| `export interface WorkflowDefinitionInput {` |
| `export type FormFieldType = 'string' \| 'text' \| 'number' \| 'boolean' \| 'select' \| 'agent' \| 'skill' \| 'list'` |
| `export interface FormField {` |
| `export interface EdgeRules {` |
| `export interface PluginNodeTypeInput<T = unknown> {` |
| `export interface PluginNotificationChannelInput {` |
| `export interface HealthCheckResult {` |
| `export interface PluginHealthCheckInput {` |
| `export interface StringSettingsField extends BaseSettingsField {` |
| `export interface NumberSettingsField extends BaseSettingsField {` |
| `export interface BooleanSettingsField extends BaseSettingsField {` |
| `export interface SelectSettingsField extends BaseSettingsField {` |
| `export interface ListSettingsField extends BaseSettingsField {` |
| `export type SettingsField =` |
| `export interface PluginSettingsSchema {` |
| `export interface PluginContext {` |
| `export interface BakinPlugin {` |
| `export interface CalendarEvent {` |
| `export interface CalendarDay {` |
| `export interface RecurringEvent {` |
| `export interface MemoryEntry {` |
| `export interface MemoryDay {` |
| `export interface Heartbeat {` |
| `export interface ProjectMeta {` |
| `export interface AvailableModel {` |
| `export interface WorkflowDefinition {` |
| `export interface WorkflowInstance {` |
| `export interface WorkflowStep {` |
| `export type WorkflowTemplate = WorkflowDefinition` |
| `export interface BakinConfig {` |
| `export interface PluginEntry {` |

## `@makinbakin/sdk/utils`

Source: `packages/sdk/src/utils/index.ts`

| Export declaration |
| --- |
| `export { cn } from '@/lib/utils'` |
| `export { formatAge, formatSize, isStale } from '@bakin/core/format'` |
| `export {` |
| `export {` |
| `export type {` |
| `export type {` |
| `export { readBrainstormSseResponse } from '@/components/integrated-brainstorm/sse'` |

## `@makinbakin/sdk/metadata`

Source: `packages/sdk/src/metadata/index.ts`

| Export declaration |
| --- |
| `export type {` |
| `export {` |

## `@makinbakin/sdk/routing`

Source: `packages/sdk/src/routing/index.ts`

| Export declaration |
| --- |
| `export {` |
| `export type {` |

<aside class="generated-page-note" aria-label="Generated page metadata">
  <span>Generated May 12, 2026 · Bakin 0.0.0-dev</span>
</aside>
