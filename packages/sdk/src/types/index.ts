/**
 * `@bakin/sdk/types` — shared types plugin authors can import.
 *
 * Covers: plugin contract types (PluginContext, BakinPlugin, etc.), core
 * shared types (Task, AssetMeta, NavItem), and cross-plugin types plugins
 * often need (AvailableModel, agent types).
 */

// Plugin contract and core infrastructure types
export type {
  StorageAdapter,
  EventBus,
  NavItem,
  APIRoute,
  UISlotRegistration,
  ContentFile,
  ExecToolResult,
  ExecToolDefinition,
  SkillDefinition,
  PluginContext,
  BakinPlugin,
  PluginManifest,
  PluginEntry,
  BakinConfig,
  HealthCheckResult,
  PluginHealthCheckInput,
} from '@bakin/core/plugin-types'

export type { BakinSettings } from '@bakin/core/settings'
export type { BakinPaths } from '@bakin/core/content-dir'

// Shared domain types
export type {
  Task,
  TaskColumns,
  TaskBoard,
  TaskLogEntry,
  ColumnId,
  CalendarEvent,
  CalendarDay,
  RecurringEvent,
  MemoryEntry,
  MemoryDay,
  Heartbeat,
  ProjectMeta,
  AssetVariantMeta,
  AssetMeta,
  TrashedAssetMeta,
} from '@/types'

// Cross-plugin types
export type { AvailableModel } from '@bakin/models/types'
export type { WorkflowDefinition, WorkflowInstance, WorkflowStep, WorkflowTemplate } from '@bakin/workflows/types'
