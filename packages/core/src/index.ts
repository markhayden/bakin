// @bakin/core — shared types, utilities, and services
// This is the leaf package with zero React/Next.js dependencies.

// Branding constants
export {
  APP_NAME,
  APP_SLUG,
  APP_HOME_DEFAULT,
  CONFIG_FILE,
  PLUGIN_MANIFEST_FILE,
  MAIN_AGENT_ROLE,
  DEFAULT_PORT,
  ENV_PREFIX,
} from './constants'

// Plugin system types
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
} from './plugin-types'

// Storage
export { MarkdownStorageAdapter } from './storage/markdown-adapter'

// Events
export { BakinEventBus } from './events/event-bus'

// Content directory
export {
  getContentDir,
  isUsingBakinHome,
  resetContentDir,
  getBakinPaths,
  initBakinHome,
} from './content-dir'
export type { BakinPaths } from './content-dir'

// Settings
export { DEFAULT_SETTINGS, getSettings, updateSettings, resetSettingsCache } from './settings'
export type { BakinSettings, RuntimeAdapterSettings, RuntimeAdapterName, SearchAdapterSettings, SearchAdapterName } from './settings'

// Adapter contracts
export type { AppServices, HealthService } from './app-services'
export { createHealthService } from './app-services'
export type {
  AdapterAuditEvent,
  AdapterHealthCheckDefinition,
  AdapterHealthCheckResult,
  AdapterInitOpts,
  AdapterLogger,
  AdapterVersionInfo,
  Unsubscribe,
} from './adapters/shared'
export type {
  AgentRuntimeAdapter,
  ApprovalDelivery,
  ApprovalOption,
  ApprovalPatch,
  ApprovalRenderRef,
  ApprovalRenderResult,
  ApprovalResolveEvent,
  ApprovalResponse,
  CancelApprovalArgs,
  ChannelCapability,
  ChannelInfo,
  ChannelInteractionEvent,
  ChannelMessageArgs,
  ChannelMessageEvent,
  ChatChunk,
  ContentDeliveryArgs,
  CreateApprovalArgs,
  CreateCronJobInput,
  CreateRuntimeAgentInput,
  CronJob,
  CronRun,
  DeliveryResult,
  DurableApprovalRecord,
  EditApprovalArgs,
  ListExecutionsOpts,
  MessageArgs,
  MessageResult,
  NotificationArgs,
  ResolveApprovalArgs,
  RuntimeAgent,
  RuntimeAllowlistPatch,
  RuntimeConfigAccess,
  RuntimeMemoryEntry,
  RuntimeMemoryTier,
  RuntimeMetadata,
  RuntimePermissionPatch,
  RuntimeSession,
  RuntimeSkill,
  TaskDispatchArgs,
  TaskDispatchResult,
  TaskExecutionEvent,
  TaskExecutionStatus,
  ToolDefinition,
  ToolResult,
  UpdateCronJobInput,
  UpdateRuntimeAgentInput,
  WorkspaceFile,
} from './adapters/runtime'
export {
  getRuntimeMainAgent,
  getRuntimeMainAgentId,
  getRuntimeMainAgentName,
  hasChannelCapability,
  selectRuntimeMainAgent,
} from './adapters/runtime'
export { createMockRuntimeAdapter } from './adapters/runtime/testing'
export type {
  AggregationRequest,
  BatchResult,
  Document,
  FacetCount,
  Filter,
  IndexItem,
  IndexOpts,
  Query,
  QueryDiagnostics,
  QueryResult,
  RebuildReport,
  ScanOpts,
  ScannedDocument,
  ScoreBreakdown,
  SearchAdapter,
  SearchFieldConfig,
  SearchHit,
  SearchIndexConfig,
  SortSpec,
  TableConfig,
  TableHealth,
  TableInfo,
  TableStats,
  TransformFn,
} from './adapters/search'
export { createMockSearchAdapter } from './adapters/search/testing'

// Bakin task store
export type {
  BakinTask,
  BakinTaskPatch,
  BakinTaskStore,
  BakinTaskStoreEvent,
  CreateBakinTaskInput,
  SyncBakinTaskStore,
  TaskComment,
  TaskDependencyPatch,
  TaskListOpts,
  TaskLogEntry,
} from './tasks/store'
export { createEmptyBakinTask, createFileBakinTaskStore } from './tasks/store'
export { createMockBakinTaskStore } from './tasks/testing'

// Logger
export { createLogger } from './logger'

// Utilities
export { formatAge, isStale } from './format'
export { generateTaskId } from './ids'

// Documentation metadata contracts
export * from './docs'
