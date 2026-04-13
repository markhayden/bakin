/**
 * Core settings system for Bakin.
 * Reads from content/settings.json with defaults for all values.
 */
import fs from 'fs'
import path from 'path'
import { createLogger } from './logger'
import { getContentDir } from './content-dir'
import { getOpenClawPath } from './openclaw-home'

const log = createLogger('settings')

export interface BakinSettings {
  dispatch: {
    intervalMs: number
    failureCooldownMs: number
    maxDispatched: number
    maxRetries: number
  }
  watchdog: {
    intervalMs: number
    stuckThresholdMs: number
    alertChannelId: string
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
  messaging: {
    intervalMs: number
  }
  sse: {
    maxClients: number
    keepAliveMs: number
  }
  openclaw: {
    binaryPath: string
    gatewayUrl: string
    gatewayPort: number
  }
  models: {
    allowlist?: string[]
    blocklist?: string[]
  }
  agents: string[]
  antfly: {
    enabled: boolean
    url: string
    auth?: { username: string; password: string }
    search: {
      strategy: 'rrf' | 'semantic_only' | 'full_text_only'
      defaultLimit: number
      /**
       * Cross-encoder reranker configuration. When `enabled` is true and a
       * query does not pass `rerank: false`, Bakin attaches this config to
       * every Antfly QueryRequest. Reranking adds ~100-500ms latency but
       * measurably improves result ordering for ambiguous queries.
       */
      reranker: {
        enabled: boolean
        provider: string
        model: string
        threshold?: number
      }
    }
    /**
     * @deprecated Use `embedders.default` instead. Still read for backward
     * compat — if present, its value is copied into `embedders.default` on
     * load and a deprecation warning is logged.
     */
    embedder?: {
      provider: string
      model: string
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
  doctor: {
    intervalMs: number
    autoFixSkill: boolean
    /**
     * When true, `runDiagnostics()` refuses to run its normal checks and
     * returns a single `onboarded: error` result until `~/.bakin/.onboarded`
     * exists with a version matching `ONBOARDING_VERSION`. Keeps doctor
     * quiet on a fresh machine and points new users at `bakin onboard`
     * instead of drowning them in unrelated errors.
     */
    requireOnboard: boolean
  }
  service: {
    enabled: boolean
  }
  notifications: {
    channel: 'discord' | 'slack' | 'none'
    target: string
    gateAlerts: boolean
  }
  workflow: {
    stepTimeoutMs: number
    maxRedispatches: number
    rejectRepeatThreshold: number
    enforceAgentScoping: boolean
    enforceWorkflowDoneGuard: boolean
  }
}

const DEFAULTS: BakinSettings = {
  dispatch: {
    intervalMs: 5 * 60 * 1000,
    failureCooldownMs: 30 * 60 * 1000,
    maxDispatched: 500,
    maxRetries: 5,
  },
  watchdog: {
    intervalMs: 5 * 60 * 1000,
    stuckThresholdMs: 30 * 60 * 1000,
    alertChannelId: '1483917792745885768',
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
  messaging: {
    intervalMs: 5 * 60 * 1000,
  },
  sse: {
    maxClients: 50,
    keepAliveMs: 30000,
  },
  openclaw: {
    binaryPath: process.env.OPENCLAW_PATH || '/opt/homebrew/bin/openclaw',
    gatewayUrl: 'http://127.0.0.1',
    gatewayPort: 18789,
  },
  models: {},
  agents: [], // populated dynamically from OpenClaw at load time
  antfly: {
    enabled: true,
    url: 'http://localhost:8080/api/v1',
    search: {
      strategy: 'rrf',
      defaultLimit: 20,
      reranker: {
        enabled: true,
        provider: 'termite',
        model: 'mixedbread-ai/mxbai-rerank-base-v1',
        threshold: 0.0,
      },
    },
    embedders: {
      // Default text embedder swapped to BAAI/bge-small-en-v1.5 (Termite)
      // as of search schema version 2. BGE is a stronger retrieval model
      // than Antfly's builtin MiniLM, especially for longer documents
      // with diverse vocabulary (which is most of what Bakin indexes —
      // task descriptions, markdown notes, PDF bodies, audit trails).
      // Runs locally via Termite; no cloud dependency. A boot-time
      // migration in src/core/search-migration.ts drops stale tables
      // whenever SCHEMA_VERSION advances beyond the persisted version
      // in `~/.bakin/.search-state.json`, forcing a clean reindex onto
      // the new embedder.
      default: { provider: 'termite', model: 'BAAI/bge-small-en-v1.5' },
      visual: { provider: 'termite', model: 'openai/clip-vit-base-patch32' },
    },
    chunking: {
      defaultTargetTokens: 200,
      defaultOverlapTokens: 25,
    },
    auditTtl: '90d',
    cleanupInterval: '7d',
  },
  doctor: {
    intervalMs: 30 * 60 * 1000, // 30 minutes
    autoFixSkill: true,
    requireOnboard: true,
  },
  service: {
    enabled: false,
  },
  notifications: {
    channel: 'none',
    target: '',
    gateAlerts: true,
  },
  workflow: {
    stepTimeoutMs: 60 * 60 * 1000,       // 1 hour
    maxRedispatches: 2,
    rejectRepeatThreshold: 0.95,
    enforceAgentScoping: true,
    enforceWorkflowDoneGuard: true,
  },
}

// Use globalThis to survive Next.js webpack module re-evaluation.
// Without this, resetSettingsCache() in a plugin route handler wouldn't
// bust the cache seen by the custom server's /api/settings handler.
const _g = globalThis as typeof globalThis & {
  __bakinSettingsCache?: BakinSettings | null
  __bakinOpenClawMtime?: number
  __bakinOpenClawAgents?: string[]
}
function getCachedSettings(): BakinSettings | null { return _g.__bakinSettingsCache ?? null }
function setCachedSettings(v: BakinSettings | null) { _g.__bakinSettingsCache = v }

const OPENCLAW_JSON_PATH = getOpenClawPath('openclaw.json')

/**
 * Read agent IDs from ~/.openclaw/openclaw.json with mtime-based caching.
 * Re-reads when the file changes on disk — picks up agents added via OpenClaw
 * without needing a Bakin restart or explicit cache bust.
 */
function readAgentIdsFromOpenClaw(): string[] {
  const OPENCLAW_TO_BAKIN: Record<string, string> = { main: 'main-operator' }
  try {
    const stat = fs.statSync(OPENCLAW_JSON_PATH)
    if (_g.__bakinOpenClawMtime === stat.mtimeMs && _g.__bakinOpenClawAgents) {
      return _g.__bakinOpenClawAgents
    }
    const config = JSON.parse(fs.readFileSync(OPENCLAW_JSON_PATH, 'utf-8'))
    const list = config?.agents?.list as Array<{ id: string }> | undefined
    if (!Array.isArray(list)) return []
    const agents = list.map((a) => OPENCLAW_TO_BAKIN[a.id] ?? a.id)
    _g.__bakinOpenClawMtime = stat.mtimeMs
    _g.__bakinOpenClawAgents = agents
    return agents
  } catch {
    return []
  }
}

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
  let settings = getCachedSettings()

  if (!settings) {
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

    settings = deepMerge(
      DEFAULTS as unknown as Record<string, unknown>,
      overrides
    ) as unknown as BakinSettings

    // Legacy embedder field — migrate to embedders.default if the user
    // set it directly without also setting embedders.default. This is
    // detected by inspecting the raw overrides, not the merged settings,
    // since defaults alone never populate the legacy field.
    const overrideAntfly = (overrides as { antfly?: Record<string, unknown> }).antfly
    const legacyEmbedder = overrideAntfly && (overrideAntfly as { embedder?: { provider: string; model: string } }).embedder
    const hasEmbedders = overrideAntfly && 'embedders' in overrideAntfly
    if (legacyEmbedder && !hasEmbedders) {
      settings.antfly.embedders.default = { provider: legacyEmbedder.provider, model: legacyEmbedder.model }
      log.warn('settings.antfly.embedder is deprecated — migrate to settings.antfly.embedders.default')
    } else if (legacyEmbedder && hasEmbedders) {
      log.warn('settings.antfly.embedder is deprecated and ignored — using settings.antfly.embedders instead')
    }

    setCachedSettings(settings)
  }

  // Always refresh agents from OpenClaw (mtime-cached, cheap when unchanged).
  // This ensures agents added via OpenClaw directly are picked up without
  // needing a Bakin restart or explicit cache bust.
  if (!settings.agents.length) {
    settings.agents = readAgentIdsFromOpenClaw()
  } else {
    // Check if openclaw.json changed — mtime comparison is a single stat() call
    try {
      const stat = fs.statSync(OPENCLAW_JSON_PATH)
      if (stat.mtimeMs !== _g.__bakinOpenClawMtime) {
        settings.agents = readAgentIdsFromOpenClaw()
      }
    } catch { /* keep cached agents */ }
  }

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
