/**
 * Core settings system for Bakin.
 * Reads from content/settings.json with defaults for all values.
 */
import fs from 'fs'
import path from 'path'
import { createLogger } from './logger'
import { getContentDir } from './content-dir'

const log = createLogger('settings')

export type RuntimeAdapterName = 'openclaw'
export type SearchAdapterName = 'antfly'

export type RuntimeAdapterSettings = Record<string, unknown>
export interface SearchAdapterSettings extends Record<string, unknown> {
  enabled: boolean
  url: string
  auth?: { username: string; password: string }
  search: {
    strategy: 'rrf' | 'semantic_only' | 'full_text_only'
    defaultLimit: number
    /**
     * Cross-encoder reranker configuration. When `enabled` is true and a
     * query does not pass `rerank: false`, Bakin attaches this config to
     * every search adapter query request. Reranking adds ~100-500ms latency
     * but measurably improves result ordering for ambiguous queries.
     */
    reranker: {
      enabled: boolean
      provider: string
      model: string
    }
  }
  /**
   * Per-index embedder configs. `default` is the text embedder used by
   * every content type that doesn't declare an override. `visual` is the
   * multimodal (CLIP) embedder used by the assets plugin's visual index.
   * Plugins reference an entry by name via SearchIndexDefinition.embedderRef.
   */
  embedders: {
    default: { provider: string; model: string }
    visual: { provider: string; model: string }
    [key: string]: { provider: string; model: string }
  }
  chunking: {
    defaultTargetTokens: number
    defaultOverlapTokens: number
  }
  /** TTL for audit table entries (Go duration: '90d', '24h'). Empty string to disable. */
  auditTtl: string
  /**
   * Interval for the orphan cleanup BACKSTOP scan (Go duration: '7d', '24h').
   * The watcher unlink hook is the primary path for keeping search indexes
   * in sync with filesystem deletes — this scan only catches the rare
   * cases where the watcher missed an event (process down during the
   * delete, fs event lost, etc.). 7d is the right cadence for that role.
   */
  cleanupInterval: string
}

export interface BakinSettings {
  runtime: {
    adapter: RuntimeAdapterName
    settings: RuntimeAdapterSettings
  }
  search: {
    adapter: SearchAdapterName
    settings: SearchAdapterSettings
  }
  dispatch: {
    intervalMs: number
    /** Cooldown after a structural failure (4xx/5xx from the runtime). */
    failureCooldownMs: number
    /**
     * Cooldown after a transient failure (fetch/network error that survived
     * the sendMessage in-call retry). Shorter than `failureCooldownMs`
     * because transient errors should usually clear within a cycle — a
     * long cooldown masks a healthy runtime as a real outage. See #115.
     */
    transientCooldownMs: number
    maxDispatched: number
    maxRetries: number
    /**
     * A turn's final assistant output above this byte count is flagged
     * `oversizedOutput` in session-death diagnoses. Oversized completions
     * are what kill provider sessions (see session-death-hardening spec).
     */
    oversizedOutputBytes: number
    /** Max dispatch turns in flight across all agents. */
    maxConcurrentTurns: number
    /**
     * Max dispatch turns in flight per agent. Default 1 until the rig
     * validates provider-gateway per-agent concurrency.
     */
    maxTurnsPerAgent: number
  }
  watchdog: {
    intervalMs: number
    stuckThresholdMs: number
    autoRecover: boolean
    maxAutoRecoveries: number
    /** Window for the rolling MCP 5xx error-rate check. */
    mcpWindowMs: number
    /** Error rate (errors/total) over the window above which an alert fires. */
    mcpErrorThreshold: number
    /** Minimum sample size before the error rate is even evaluated. */
    mcpMinSamples: number
    /** Suppress duplicate MCP alerts within this window. */
    mcpAlertCooldownMs: number
    /** Window for the rolling REST 5xx error-rate check (parallel to mcp*). */
    restWindowMs: number
    restErrorThreshold: number
    restMinSamples: number
    restAlertCooldownMs: number
  }
  restartRecovery: {
    /**
     * One-shot startup repair for in-progress tasks whose active agent
     * heartbeat is missing/stale after a server restart. Uses the same
     * maxAutoRecoveries cap as the watchdog.
     */
    enabled: boolean
  }
  sse: {
    maxClients: number
    keepAliveMs: number
  }
  models: {
    allowlist?: string[]
    blocklist?: string[]
  }
  agentPackages: {
    lessonsRetrieval: {
      enabled: boolean
      /** Inject the top relevant enabled lessons directly into dispatch prompts. */
      injectIntoDispatch: boolean
      /** Expose the agent-facing MCP search tool for follow-up lesson lookup. */
      mcpTool: boolean
      maxLessons: number
      /** Approximate prompt budget for injected lesson bodies. */
      maxCharacters: number
      minScore: number
    }
  }
  doctor: {
    intervalMs: number
    /**
     * When true, `runDiagnostics()` refuses to run its normal checks and
     * returns a single `onboarded: error` result until `~/.bakin/.onboarded`
     * exists with a version matching `ONBOARDING_VERSION`. Keeps doctor
     * quiet on a fresh machine and points new users at `bakin onboard`
     * instead of drowning them in unrelated errors.
     */
    requireOnboard: boolean
  }
  diagnostics: {
    startup: {
      /** Emit structured startup spans for plugin/server boot diagnostics. */
      enabled: boolean
      /** Default slow-span warning threshold in milliseconds. */
      slowMs: number
    }
  }
  service: {
    enabled: boolean
  }
  notifications: {
    channel: string
    target: string
    gateAlerts: boolean
    channelAliases: Record<string, string>
  }
  workflow: {
    stepTimeoutMs: number
    maxRedispatches: number
    rejectRepeatThreshold: number
    enforceAgentScoping: boolean
    enforceWorkflowDoneGuard: boolean
  }
  plugins: {
    runtimeCapabilityMode: 'off' | 'warn' | 'enforce'
    /** When true, user plugin install/link/upgrade rejects unsigned or untrusted manifests. */
    requireSignatures: boolean
    /**
     * Trusted signer roots for plugin manifests. Entries may be
     * `sha256:<hex>` fingerprints, raw base64 Ed25519 SPKI public keys, or
     * `ed25519:<base64-public-key>`.
     */
    trustedSigners: string[]
  }
}

export const DEFAULT_SETTINGS: BakinSettings = {
  runtime: {
    adapter: 'openclaw',
    settings: {},
  },
  search: {
    adapter: 'antfly',
    settings: {
      enabled: true,
      // Bakin's private antfly instance (3737 + 1). The v0.2 SDK owns the
      // /db/v1 path prefix, so the base URL carries no path suffix.
      url: 'http://localhost:3738',
      search: {
        strategy: 'rrf',
        defaultLimit: 20,
        reranker: {
          enabled: true,
          provider: 'antfly',
          model: 'mixedbread-ai/mxbai-rerank-base-v1',
        },
      },
      embedders: {
        // Default text embedder is BAAI/bge-small-en-v1.5 (as of search
        // schema version 2). BGE is a stronger retrieval model than the
        // search backend's builtin MiniLM, especially for longer documents
        // with diverse vocabulary (which is most of what Bakin indexes —
        // task descriptions, markdown notes, PDF bodies, audit trails).
        // Runs locally via antfly's embedded inference runtime; no cloud
        // dependency. A boot-time migration in src/core/search-migration.ts
        // drops stale tables whenever SCHEMA_VERSION advances beyond the
        // persisted version in `~/.bakin/.search-state.json`, forcing a
        // clean reindex onto the new embedder.
        default: { provider: 'antfly', model: 'BAAI/bge-small-en-v1.5' },
        visual: { provider: 'antfly', model: 'openai/clip-vit-base-patch32' },
      },
      chunking: {
        defaultTargetTokens: 200,
        defaultOverlapTokens: 25,
      },
      auditTtl: '90d',
      cleanupInterval: '7d',
    },
  },
  dispatch: {
    intervalMs: 5 * 60 * 1000,
    failureCooldownMs: 30 * 60 * 1000,
    transientCooldownMs: 60 * 1000,
    maxDispatched: 500,
    maxRetries: 5,
    oversizedOutputBytes: 128 * 1024,
    maxConcurrentTurns: 3,
    maxTurnsPerAgent: 1,
  },
  watchdog: {
    intervalMs: 5 * 60 * 1000,
    stuckThresholdMs: 30 * 60 * 1000,
    autoRecover: true,
    maxAutoRecoveries: 3,
    mcpWindowMs: 60 * 1000,
    mcpErrorThreshold: 0.5,
    mcpMinSamples: 3,
    mcpAlertCooldownMs: 5 * 60 * 1000,
    restWindowMs: 60 * 1000,
    restErrorThreshold: 0.5,
    restMinSamples: 3,
    restAlertCooldownMs: 5 * 60 * 1000,
  },
  restartRecovery: {
    enabled: true,
  },
  sse: {
    maxClients: 50,
    keepAliveMs: 30000,
  },
  models: {},
  agentPackages: {
    lessonsRetrieval: {
      enabled: true,
      injectIntoDispatch: true,
      mcpTool: true,
      maxLessons: 3,
      maxCharacters: 8000,
      minScore: 0,
    },
  },
  doctor: {
    intervalMs: 30 * 60 * 1000, // 30 minutes
    requireOnboard: true,
  },
  diagnostics: {
    startup: {
      enabled: false,
      slowMs: 250,
    },
  },
  service: {
    enabled: false,
  },
  notifications: {
    channel: '',
    target: '',
    gateAlerts: true,
    channelAliases: {},
  },
  workflow: {
    stepTimeoutMs: 60 * 60 * 1000,       // 1 hour
    maxRedispatches: 2,
    rejectRepeatThreshold: 0.95,
    enforceAgentScoping: true,
    enforceWorkflowDoneGuard: true,
  },
  plugins: {
    runtimeCapabilityMode: 'warn',
    requireSignatures: false,
    trustedSigners: [],
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizePluginSettings(input: unknown): BakinSettings['plugins'] {
  const raw = isRecord(input) ? input : {}
  const runtimeCapabilityMode = (
    raw.runtimeCapabilityMode === 'off' ||
    raw.runtimeCapabilityMode === 'warn' ||
    raw.runtimeCapabilityMode === 'enforce'
  )
    ? raw.runtimeCapabilityMode
    : DEFAULT_SETTINGS.plugins.runtimeCapabilityMode
  const requireSignatures = typeof raw.requireSignatures === 'boolean'
    ? raw.requireSignatures
    : DEFAULT_SETTINGS.plugins.requireSignatures
  const trustedSigners = Array.isArray(raw.trustedSigners)
    ? Array.from(new Set(
      raw.trustedSigners
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .map(value => value.trim()),
    ))
    : DEFAULT_SETTINGS.plugins.trustedSigners

  return {
    runtimeCapabilityMode,
    requireSignatures,
    trustedSigners,
  }
}

function normalizeDiagnosticsSettings(input: unknown): BakinSettings['diagnostics'] {
  const raw = isRecord(input) ? input : {}
  const startup = isRecord(raw.startup) ? raw.startup : {}
  const slowMs = typeof startup.slowMs === 'number' && Number.isFinite(startup.slowMs) && startup.slowMs >= 0
    ? Math.round(startup.slowMs)
    : DEFAULT_SETTINGS.diagnostics.startup.slowMs

  return {
    startup: {
      enabled: typeof startup.enabled === 'boolean'
        ? startup.enabled
        : DEFAULT_SETTINGS.diagnostics.startup.enabled,
      slowMs,
    },
  }
}

function normalizeSettings(settings: BakinSettings): BakinSettings {
  return {
    ...settings,
    diagnostics: normalizeDiagnosticsSettings(settings.diagnostics),
    plugins: normalizePluginSettings(settings.plugins),
  }
}

// Use globalThis so the settings cache is shared across every reach into
// this module. Without this, resetSettingsCache() from a plugin route
// handler wouldn't bust the cache seen by the server's /api/settings.
const _g = globalThis as typeof globalThis & {
  __bakinSettingsCache?: BakinSettings | null
}
function getCachedSettings(): BakinSettings | null { return _g.__bakinSettingsCache ?? null }
function setCachedSettings(v: BakinSettings | null) { _g.__bakinSettingsCache = v }

function getSettingsPath(): string {
  return path.join(getContentDir(), 'settings.json')
}

function deepMerge(defaults: Record<string, unknown>, overrides: Record<string, unknown>): Record<string, unknown> {
  const result = { ...defaults }
  for (const key of Object.keys(overrides)) {
    if (
      overrides[key] !== null &&
      typeof overrides[key] === 'object' &&
      !Array.isArray(overrides[key]) &&
      typeof defaults[key] === 'object' &&
      !Array.isArray(defaults[key]) &&
      defaults[key] !== null
    ) {
      result[key] = deepMerge(
        defaults[key] as Record<string, unknown>,
        overrides[key] as Record<string, unknown>
      )
    } else {
      result[key] = overrides[key]
    }
  }
  return result
}

export function getSettings(): BakinSettings {
  const cached = getCachedSettings()
  if (cached) return cached

  const settingsPath = getSettingsPath()
  let overrides: Record<string, unknown> = {}

  try {
    if (fs.existsSync(settingsPath)) {
      overrides = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
      log.info('Settings loaded', { path: settingsPath })
    }
  } catch (err) {
    log.warn('Failed to read settings, using defaults', err)
  }

  const settings = normalizeSettings(deepMerge(
    DEFAULT_SETTINGS as unknown as Record<string, unknown>,
    overrides
  ) as unknown as BakinSettings)

  setCachedSettings(settings)
  return settings
}

export function updateSettings(partial: Record<string, unknown>): BakinSettings {
  const settingsPath = getSettingsPath()
  const dir = path.dirname(settingsPath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  // Read current overrides (not merged defaults)
  let current: Record<string, unknown> = {}
  try {
    if (fs.existsSync(settingsPath)) {
      current = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
    }
  } catch {
    // start fresh
  }

  const merged = deepMerge(current, partial)
  fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2), 'utf-8')
  log.info('Settings updated', { keys: Object.keys(partial) })

  // Invalidate cache
  setCachedSettings(null)
  return getSettings()
}

export function resetSettingsCache(): void {
  setCachedSettings(null)
}
