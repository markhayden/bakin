// Part of the @makinbakin/sdk/types contract — see ./index.ts for the
// module's self-containment + two-tier rationale.
import type { HttpMethod } from './primitives'
import type { NavItem } from './registration'

/** Capability a plugin can request in its manifest (gates access to APIs). */
export type PluginPermission =
  | 'storage.read'
  | 'storage.write'
  | 'events.emit'
  | 'runtime.read'
  | 'runtime.agents'
  | 'runtime.messaging'
  | 'runtime.channels'
  | 'runtime.cron'
  | 'runtime.skills'
  | 'runtime.models'
  | 'runtime.images'
  | 'tasks.read'
  | 'tasks.write'
  | 'search.read'
  | 'search.write'
  | 'assets.read'
  | 'assets.write'

/** Runtime feature a plugin declares it needs (used by doctor/health checks). */
export type RuntimeCapability =
  | 'agents'
  | 'messaging'
  | 'channels.message'
  | 'channels.rich-content'
  | 'channels.interactive-approval'
  | 'channels.threaded-replies'
  | 'cron'
  | 'skills'
  | 'models'
  | 'tasks'
  | 'search'

/** Secret (env var) a plugin declares it needs (rendered in setup/health). */
export interface SecretDeclaration {
  /** Canonical environment variable name, for example `ANTHROPIC_API_KEY`. */
  name: string
  /** Human-readable setup note. Never include a secret value here. */
  description: string
  /** Missing required secrets should be reported by setup/health checks. Defaults to true. */
  required: boolean
}

/** Manifest declaration of an HTTP route the plugin exposes. */
export interface ApiRouteContribution {
  method: HttpMethod
  /** Plugin-relative path. Exposed as `/api/plugins/{pluginId}{path}`. */
  path: string
  summary: string
  description?: string
  operationId?: string
  tags?: string[]
  visibility?: 'public' | 'internal' | 'experimental'
  stability?: 'stable' | 'beta' | 'experimental' | 'deprecated'
  parameters?: ApiParameterContribution[]
  requestBody?: ApiRequestBodyContribution
  responses?: Record<string, ApiResponseContribution>
  permissions?: PluginPermission[]
}

/** Raw JSON Schema object embedded in API contributions. */
export type JsonSchemaContribution = Record<string, unknown>

/** Path/query/header/cookie parameter declaration for an API route. */
export interface ApiParameterContribution {
  name: string
  in: 'path' | 'query' | 'header' | 'cookie'
  required?: boolean
  description?: string
  schema?: JsonSchemaContribution
  example?: unknown
}

/** Request body declaration for an API route. */
export interface ApiRequestBodyContribution {
  description?: string
  required?: boolean
  contentType?: string
  schema?: JsonSchemaContribution
  example?: unknown
}

/** Response declaration for one HTTP status code on an API route. */
export interface ApiResponseContribution {
  description: string
  contentType?: string
  schema?: JsonSchemaContribution
  example?: unknown
}

/** Manifest declaration of a client-side route the plugin contributes. */
export interface ClientRouteContribution {
  /** Absolute app route, e.g. `/messaging/calendar`. */
  path: string
  summary: string
  slot?: string
}

/**
 * Manifest declaration of one client route *pattern* the plugin's client
 * registers via `registerPlugin({ routes })`. Unlike `clientRoutes` (concrete
 * documentation paths), these patterns must exactly match the keys passed to
 * `registerPlugin({ routes })` — including dynamic segments (`/projects/[id]`)
 * — so the host knows which plugin owns a path before its client has loaded.
 */
export interface ClientRoutePatternContribution {
  /** Route pattern, e.g. `/projects/[id]`. Supports `[id]`, `:id`, `$id` segments. */
  path: string
  summary?: string
}

/** Manifest declaration of an MCP exec tool the plugin exposes. */
export interface ExecToolContribution {
  name: string
  summary: string
  description?: string
  permissions?: PluginPermission[]
}

/** Manifest declaration of a CLI command the plugin contributes. */
export interface CliCommandContribution {
  name: string
  usage: string
  summary: string
  description?: string
  aliases?: string[]
  /** Optional. When present, the manifest-driven CLI dispatcher routes the
   *  command through either the named exec-tool or the given API route.
   *  When absent, the command is documentation-only — its real
   *  implementation lives in `cli/bakin.ts`'s imperative switch. */
  dispatch?: {
    type: 'apiRoute'
    method: HttpMethod
    path: string
  } | {
    type: 'execTool'
    name: string
  }
}

/** Manifest declaration of a settings key the plugin owns. */
export interface SettingsContribution {
  key: string
  summary: string
}

/** Manifest declaration of the plugin's docs page slug. */
export interface DocsContribution {
  slug: string
}

/** The full contributions block in `bakin-plugin.json` — everything a plugin adds to the host. */
export interface PluginContributions {
  /** HTTP routes the plugin exposes under `/api/plugins/{id}/...`. */
  apiRoutes?: ApiRouteContribution[]
  /** Client-side routes the plugin renders (sidebar nav targets). */
  clientRoutes?: ClientRouteContribution[]
  /** MCP exec tools agents can call. */
  execTools?: ExecToolContribution[]
  /** CLI commands the plugin contributes to the `bakin` binary. */
  cliCommands?: CliCommandContribution[]
  /** Settings keys this plugin owns in the settings UI. */
  settings?: SettingsContribution[]
  /** Optional docs page slug. */
  docs?: DocsContribution
  /**
   * Declarative sidebar nav items. Rendered from manifest JSON before the
   * plugin's client bundle loads — this is what makes lazy loading possible.
   * A plugin that also passes `navItems` to `registerPlugin` at runtime
   * overrides its manifest nav (the conditional-nav escape hatch); the two
   * are compared by the drift validation check.
   */
  nav?: NavItem[]
  /**
   * Client route patterns the plugin's client registers via
   * `registerPlugin({ routes })`. Must exactly match the registered keys —
   * the host uses these to lazy-load the client on first navigation.
   */
  routes?: ClientRoutePatternContribution[]
  /**
   * Slot names the plugin's client fills via `registerPlugin({ slots })`
   * (e.g. `page:/tasks`, `task-assets`). The host lazy-loads the client the
   * first time one of these slots renders.
   */
  slots?: string[]
  /**
   * Load the client bundle at boot instead of on first demand. The escape
   * hatch for plugins with background providers (`nav-badge-providers`),
   * conditional nav, or other module-load side effects the shell needs
   * immediately. Plugins with a client but no declarative `nav`/`routes`/
   * `slots` metadata are treated as eager for backward compatibility.
   */
  eager?: boolean
}

/** Optional Ed25519 signature block proving manifest authenticity. */
export interface PluginManifestSignature {
  algorithm: 'ed25519'
  /** Human-readable signer label. Trust is bound to publicKey/fingerprint, not this label. */
  signer: string
  /** Base64-encoded Ed25519 SPKI DER public key. */
  publicKey: string
  /** Base64-encoded signature over the canonical manifest without this signature block. */
  signature: string
}

/** The `bakin-plugin.json` manifest. Required for every plugin. */
export interface PluginManifest {
  /** Unique plugin identifier (kebab-case). */
  id: string
  /** Human-readable plugin name. */
  name: string
  /** Plugin version (semver). */
  version: string
  /**
   * Semver range of Bakin host versions this plugin supports (e.g.
   * `">=0.5.0"`). Enforced at install and at activation: an incompatible or
   * malformed range rejects with an actionable error. Dev-source hosts
   * (version `0.0.0-dev`) skip the satisfaction check but still reject
   * malformed ranges.
   */
  bakin: string
  /** One-line summary shown in the plugin manager. */
  description: string
  /** Static content files the plugin ships (rendered as docs/pages). */
  contentFiles?: string[]
  /** Environment-variable secrets the plugin requires. */
  secrets?: SecretDeclaration[]
  /** Other plugin IDs this plugin depends on. */
  dependencies?: string[]
  /** Capabilities this plugin requests access to. */
  permissions?: PluginPermission[]
  /** Runtime features this plugin needs to function. */
  runtimeCapabilities?: RuntimeCapability[]
  /** Everything the plugin adds to the host (routes, tools, settings, etc.). */
  contributes?: PluginContributions
  /** File globs that trigger a hot reload in dev. */
  devWatch?: string[]
  /** Optional Ed25519 signature for authenticity. */
  signature?: PluginManifestSignature
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/** The `bakin.config.ts` shape — root configuration for a Bakin installation. */
export interface BakinConfig {
  /** Plugins to load at startup. */
  plugins: PluginEntry[]
  /** Theme overrides for CSS custom properties. */
  theme?: Record<string, string>
  /** Storage configuration. */
  storage?: {
    /** Override the default content directory. */
    contentDir?: string
  }
}

/** A plugin entry in `bakin.config.ts`. */
export interface PluginEntry {
  /** Path or package specifier resolving to the plugin's entry file. */
  path: string
  /** If false, the plugin is loaded but not activated. Default true. */
  enabled?: boolean
}
