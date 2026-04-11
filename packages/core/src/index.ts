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
  MCPlugin,
  PluginManifest,
  PluginEntry,
  BakinConfig,
  MCConfig,
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
export { getSettings, updateSettings, resetSettingsCache } from './settings'
export type { BakinSettings } from './settings'

// Main agent
export { getMainAgentId } from './main-agent'

// Logger
export { createLogger } from './logger'

// Vault
export * as vault from './vault'

// Utilities
export { formatAge, isStale } from './format'
