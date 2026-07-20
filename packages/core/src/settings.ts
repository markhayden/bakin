/**
 * Core settings system for Bakin.
 * Reads from content/settings.json with defaults for all values.
 */
import fs from 'fs'
import path from 'path'
import { createLogger } from './logger'
import { getContentDir } from './content-dir'
import { deepMerge } from './merge'
import { setStoredProviderKey } from './media/secret-store'
import { DEFAULT_OVERSIZED_OUTPUT_BYTES } from './adapters/runtime'

const log = createLogger('settings')

export type RuntimeAdapterName = 'openclaw' | 'pi'
/** Colocated with the type; the factory's Record<RuntimeAdapterName, …> keeps it exhaustive. */
export const RUNTIME_ADAPTER_NAMES: readonly RuntimeAdapterName[] = ['openclaw', 'pi']
export type SearchAdapterName = 'antfly'

export type RuntimeAdapterSettings = Record<string, unknown>
export interface SearchAdapterSettings extends Record<string, unknown> {
  enabled: boolean
  url: string
  /**
   * Basic-auth username only. The password lives in the secret store
   * (`providers.antfly` in ~/.bakin/secrets.json; env `ANTFLY_PASSWORD`
   * overrides) — settings.json is broadcast by GET /api/settings and must
   * stay secret-free. The app composition point injects the resolved
   * password into the adapter's init settings.
   */
  auth?: { username: string }
  search: {
    strategy: 'rrf' | 'semantic_only' | 'full_text_only'
    defaultLimit: number
    /**
     * Wall budget (ms) for one search request, applied per table (tables
     * run in parallel). Passed to the engine as a cooperative deadline and
     * enforced client-side with a small grace; a source that misses it
     * degrades to keyword-only or is omitted — labeled, never silent.
     */
    queryBudgetMs?: number
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
    default: { provider: string; model: string; dimension: number }
    visual: { provider: string; model: string; dimension: number }
    [key: string]: { provider: string; model: string; dimension: number }
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
    /**
     * Kill switch (cost-control v2): true pauses ALL Bakin-initiated task
     * dispatch and billed media calls (typed reason `dispatch_paused`).
     * Bakin's own health probes (watchdog/doctor sends) stay allowed.
     * In-flight turns finish; nothing new fires until unpaused.
     */
    paused: boolean
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
     * Max dispatch turns in flight per agent. Honored only on runtimes
     * declaring `concurrency.sameAgentTurns: 'isolated'` (per-run working
     * directories); serialized runtimes clamp to 1 with an audit receipt —
     * both gates (global + per-agent) apply together.
     */
    maxTurnsPerAgent: number
    /**
     * Days a SUCCESSFUL run's scratch dir is retained under
     * ~/.bakin/run-workspaces before the sweep removes it. Failed/aborted
     * scratch keeps a fixed 30-day salvage window (not configurable).
     */
    runDirRetentionDays: number
    /**
     * Hard ceiling on total run-workspaces disk usage. When exceeded the
     * sweep evicts oldest settled dirs first (never live or just-allocated
     * dirs); retention days are ceilings, never floors that outrank the
     * disk. 0 disables the budget.
     */
    runDirMaxTotalBytes: number
    /**
     * Byte budget for the WORKFLOW CONTEXT block (prior step outputs) in
     * workflow-step dispatch prompts (#357). Newest outputs are kept whole;
     * older ones are omitted with a visible marker. 0/unset → default;
     * clamped to a 1024-byte minimum.
     */
    maxWorkflowContextBytes: number
    /**
     * Byte budget for the brand card injected into branded dispatch prompts
     * (#419). Whole-unit retention in card priority order; anything dropped
     * leaves a visible omission marker. 0/unset → default; clamped to a
     * 1024-byte minimum.
     */
    maxBrandContextBytes: number
    /**
     * Warn threshold for the doctor's context.startup-size check (#357):
     * estimated Bakin-injected per-dispatch context (static sections +
     * configured caps) per agent. Warn-only — never blocks dispatch.
     */
    contextBudgetBytes: number
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
  /**
   * Agent token-burn heuristics (#385): effort-vs-outcome, spike vs own
   * baseline, and unattributed (outside Bakin-managed tasks) usage. Consumed
   * by the usage.agent-burn doctor check and the /agent-effort endpoint —
   * warn-only signals, never enforcement.
   */
  burn: {
    /** Rolling window (hours) for effort-vs-outcome and unattributed checks. */
    windowHours: number
    /** Minimum attributed tokens in the window before any effort flag fires. */
    minTokensFloor: number
    /** Today's observed tokens must exceed baseline-average × this to count as a spike. */
    spikeMultiplier: number
    /** Trailing days (excluding today) that form the spike baseline. */
    baselineDays: number
    /** Interactive/unexplained fraction of observed tokens above which those flags fire. */
    unattributedShare: number
    /** Minimum interactive/unexplained tokens before those flags fire. */
    unattributedFloorTokens: number
    /** Token-bearing assistant turns a zero-user-turn external session needs to look runaway. */
    runawayAssistantTurns: number
    /** Minimum tokens a zero-user-turn external session needs to look runaway. */
    runawayFloorTokens: number
  }
  doctor: {
    intervalMs: number
    /** Maximum time a single diagnostic check may run before it becomes Unknown. */
    checkTimeoutMs?: number
    /**
     * Health sensitivity (#690): 'developer' shows raw dispositions
     * everywhere; 'standard' (default) demotes expected-noise incident
     * classes to advisory in the central report projection; 'quiet'
     * additionally badges/escalates only action_required. Applied at
     * projection time — flipping it needs no restart.
     */
    sensitivity: 'developer' | 'standard' | 'quiet'
    /**
     * When true, `runDiagnostics()` refuses to run its normal checks and
     * returns a single `onboarded: error` result until `~/.bakin/.onboarded`
     * exists with a version matching `ONBOARDING_VERSION`. Keeps doctor
     * quiet on a fresh machine and points new users at `bakin onboard`
     * instead of drowning them in unrelated errors.
     */
    requireOnboard: boolean
    /**
     * What the PERIODIC doctor does when a cycle produces ERROR findings:
     * 'task' creates ONE deduplicated delegated-repair task for the main
     * agent (skipped while a covering repair task is open and younger than
     * escalationStaleAfterMs, and rate-limited by escalationCooldownMs);
     * 'notify' messages the main agent; 'off'
     * keeps the old dashboard-only behavior. Manual `bakin doctor` runs are
     * never affected. Both agent-facing modes cost an agent turn and ride
     * the normal budget gates.
     */
    escalation: 'off' | 'notify' | 'task'
    /** Minimum gap before re-escalating the SAME error set as a new task. */
    escalationCooldownMs: number
    /**
     * How long an OPEN covering repair task suppresses re-escalation. The
     * 2026-07-14 search wedge sat behind one stalled repair task for 34h
     * because an open task muted escalation forever; past this age, a
     * still-failing error set escalates a fresh task even though the old
     * one is open.
     */
    escalationStaleAfterMs: number
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
      // 127.0.0.1, NOT localhost — dial exactly what the server binds
      // (localhost can resolve to ::1 or be proxy-intercepted).
      url: 'http://127.0.0.1:3738',
      search: {
        strategy: 'rrf',
        defaultLimit: 20,
        // ~2s wall budget per search request (spec: search-trust-and-speed
        // SD2). Applied per table; tables fan out in parallel.
        queryBudgetMs: 2000,
        reranker: {
          // Still disabled at v0.2.0-rc.9, for a new reason. The rc.2 mxbai
          // SIGABRT (bakin#456) is fixed — reranking no longer crashes the
          // server and ranks correctly on Metal — but it's throughput-bound:
          // ~200ms/candidate (linear; 20 docs ~4s), it serializes, and it needs
          // an explicit TERMITE_PREFERRED_BACKEND=metal (auto-select hits the
          // onnx variant -> MissingWeight). Default-on across the multi-table
          // fan-out is too slow; opt in per-query with a bounded top-K instead.
          enabled: false,
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
        // dependency. A boot-time migration in src/core/blue/green table migrations (packages/core/src/search/tables.ts)
        // drops stale tables whenever SCHEMA_VERSION advances beyond the
        // persisted version in `~/.bakin/.search-state.json`, forcing a
        // clean reindex onto the new embedder.
        // `dimension` is required: the v0.2 server demands declared dims for
        // dense embeddings indexes (BGE-small = 384, clipclap CLIP = 512).
        // Visual uses antfly's native multimodal CLIP (antflydb/clipclap), a
        // built-in registry model that runs in-process on Metal — it replaces
        // the Xenova ONNX mirror we used while openai/ had no ONNX (bakin#456).
        default: { provider: 'antfly', model: 'BAAI/bge-small-en-v1.5', dimension: 384 },
        visual: { provider: 'antfly', model: 'antflydb/clipclap', dimension: 512 },
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
    paused: false,
    intervalMs: 5 * 60 * 1000,
    failureCooldownMs: 30 * 60 * 1000,
    transientCooldownMs: 60 * 1000,
    maxDispatched: 500,
    maxRetries: 5,
    oversizedOutputBytes: DEFAULT_OVERSIZED_OUTPUT_BYTES,
    maxConcurrentTurns: 3,
    maxTurnsPerAgent: 2,
    runDirRetentionDays: 7,
    runDirMaxTotalBytes: 4 * 1024 * 1024 * 1024,
    maxWorkflowContextBytes: 16 * 1024,
    maxBrandContextBytes: 12 * 1024,
    contextBudgetBytes: 64 * 1024,
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
  burn: {
    windowHours: 24,
    minTokensFloor: 500_000,
    spikeMultiplier: 3,
    baselineDays: 7,
    unattributedShare: 0.5,
    unattributedFloorTokens: 100_000,
    runawayAssistantTurns: 20,
    runawayFloorTokens: 1_000_000,
  },
  doctor: {
    intervalMs: 30 * 60 * 1000, // 30 minutes
    checkTimeoutMs: 30_000,
    sensitivity: 'standard',
    requireOnboard: true,
    escalation: 'task',
    escalationCooldownMs: 6 * 60 * 60 * 1000, // 6 hours
    escalationStaleAfterMs: 12 * 60 * 60 * 1000, // 12 hours
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

function normalizeDoctorSettings(input: BakinSettings['doctor']): BakinSettings['doctor'] {
  const sensitivity = input.sensitivity === 'developer' || input.sensitivity === 'standard' || input.sensitivity === 'quiet'
    ? input.sensitivity
    : DEFAULT_SETTINGS.doctor.sensitivity
  return { ...input, sensitivity }
}

function normalizeSettings(settings: BakinSettings): BakinSettings {
  return {
    ...settings,
    diagnostics: normalizeDiagnosticsSettings(settings.diagnostics),
    doctor: normalizeDoctorSettings(settings.doctor),
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

  applyRuntimeAdapterEnvOverride(settings, overrides)

  setCachedSettings(settings)
  return settings
}

/**
 * BAKIN_RUNTIME_ADAPTER: process-scoped adapter override (dev rig / tests).
 * Applied at the cache chokepoint so every consumer sees it; never persisted —
 * updateSettings writes file overrides only, so the file cannot record it.
 */
function applyRuntimeAdapterEnvOverride(
  settings: BakinSettings,
  overrides: Record<string, unknown>,
): void {
  const envAdapter = process.env.BAKIN_RUNTIME_ADAPTER
  if (!envAdapter) return
  if (!(RUNTIME_ADAPTER_NAMES as readonly string[]).includes(envAdapter)) {
    log.warn('Ignoring invalid BAKIN_RUNTIME_ADAPTER', { value: envAdapter })
    return
  }
  const stored = (overrides.runtime as { adapter?: string } | undefined)?.adapter
  if (stored && stored !== envAdapter) {
    // e.g. `bakin runtime use` wrote one adapter but the env forces another.
    log.warn('BAKIN_RUNTIME_ADAPTER shadows the adapter stored in settings.json', {
      env: envAdapter,
      stored,
    })
  }
  // Replace, never mutate: deepMerge reuses DEFAULT_SETTINGS.runtime by
  // reference when the file carries no runtime override — in-place mutation
  // would contaminate the process-global defaults across cache resets.
  settings.runtime = { ...settings.runtime, adapter: envAdapter as RuntimeAdapterName }
}

/**
 * settings.json must never carry secrets (GET /api/settings serves it
 * unredacted). A write that smuggles the search auth password back in —
 * the exact shape the boot-time migration relocates — is intercepted
 * here: the password moves to the secret store and never lands in the
 * file, instead of lingering until the next boot re-runs the migration.
 */
function relocateSecretsFromWrite(merged: Record<string, unknown>): void {
  const search = merged.search as { settings?: { auth?: Record<string, unknown> } } | undefined
  const auth = search?.settings?.auth
  const password = typeof auth?.password === 'string' && auth.password.trim() !== '' ? auth.password : undefined
  if (!auth || !password) return
  setStoredProviderKey('antfly', password)
  delete auth.password
  if (Object.keys(auth).length === 0) delete search!.settings!.auth
  log.info('Relocated search auth password from a settings write to the secret store')
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
  relocateSecretsFromWrite(merged)
  fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2), 'utf-8')
  log.info('Settings updated', { keys: Object.keys(partial) })

  // Invalidate cache
  setCachedSettings(null)
  return getSettings()
}

export function resetSettingsCache(): void {
  setCachedSettings(null)
}
