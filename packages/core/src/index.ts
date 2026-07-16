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
  NavSection,
  RegisteredAPIRoute,
  UISlotRegistration,
  ContentFile,
  ExecToolResult,
  ExecToolDefinition,
  SkillDefinition,
  PluginContext,
  BakinPlugin,
  PluginManifest,
  PluginManifestSignature,
  SecretDeclaration,
  PluginEntry,
  BakinConfig,
} from './plugin-types'
export {
  PLUGIN_ID_RE,
  PluginManifestError,
  parsePluginManifest,
  readPluginManifestJson,
} from './plugins/manifest'
export {
  PluginSignatureError,
  canonicalizePluginManifestForSignature,
  pluginSignatureFingerprint,
  verifyPluginManifestSignature,
} from './plugins/signatures'
export type { PluginSignaturePolicy, PluginSignatureVerification } from './plugins/signatures'
export {
  PermissionDenied,
  PERMISSION_DESCRIPTIONS,
  newPermissions,
  parseManifestPermissions,
  suggestPermission,
} from './plugins/permissions'
export type { Permission } from './plugins/permissions'

// Storage
export { MarkdownStorageAdapter } from './storage/markdown-adapter'
export { ScopedPluginStorageAdapter } from './storage/scoped-plugin-storage'

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
export type { AppServices } from './app-services'
export type {
  AdapterAuditEvent,
  AdapterInitOpts,
  AdapterLogger,
  AdapterToolActivityEvent,
  AdapterTurnActivityEvent,
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
  ChannelMessageArgs,
  ChatChunk,
  ChatTextFormat,
  ContentDeliveryArgs,
  CreateApprovalArgs,
  CreateCronJobInput,
  CreateRuntimeAgentInput,
  CronJob,
  CronRun,
  DeliveryResult,
  DurableApprovalRecord,
  EditApprovalArgs,
  MessageArgs,
  MessageResult,
  NotificationArgs,
  ResolveApprovalArgs,
  RuntimeAgent,
  RuntimeAllowlistPatch,
  RuntimeMemoryEntry,
  RuntimeMemoryTier,
  RuntimeErrorKind,
  RuntimeErrorOptions,
  RuntimeMetadata,
  RawCronSnapshot,
  RuntimeSession,
  RuntimeSkill,
  RuntimeTurnDiagnosis,
  RuntimeTurnFailureReason,
  UpdateCronJobInput,
  UpdateRuntimeAgentInput,
  WorkspaceFile,
} from './adapters/runtime'
export {
  getRuntimeMainAgent,
  getRuntimeMainAgentId,
  getRuntimeMainAgentName,
  hasChannelCapability,
  RuntimeError,
  RuntimeTurnError,
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
  Query,
  QueryDiagnostics,
  QueryResult,
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

// Routing primitives — typed route contracts (declarative shape)
export {
  defineRoute,
  defineCoreRoute,
  definePlugin,
} from './routing'
export type {
  HttpMethod as RoutingHttpMethod,
  HttpStatus,
  RouteContext,
  PluginContextLite,
  CoreContext,
  JsonBodySpec,
  MultipartBodySpec,
  RawBodySpec,
  NoBodySpec,
  BodySpec,
  JsonResponseSpec,
  NoContentResponseSpec,
  NonJsonResponseSpec,
  ResponseSpec,
  ParsedInput,
  PluginWithRoutes,
  DefinePluginInput,
  // Re-export the new declarative APIRoute under a distinct name so it does
  // not collide with the legacy `APIRoute` already exported above. After T17
  // the legacy interface is deleted and this export will be renamed.
  APIRoute as APIRouteContract,
} from './routing'
