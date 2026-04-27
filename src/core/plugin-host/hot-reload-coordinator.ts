/**
 * Hot-reload coordinator for linked plugins (Phase 2 P2.C8).
 *
 * Watches every linked plugin's source tree, rebuilds on save, and
 * dispatches the resulting reload through `runReloadPipeline`. Boots
 * server-side via `BAKIN_DEV_HOTRELOAD=1`; production builds never
 * import this file (gated at the call site in server.ts so chokidar
 * doesn't end up in the compiled binary).
 *
 * Per-plugin pipeline: each plugin id has its own queue. Inside a
 * single id, only ONE build+reload cycle runs at a time. If a file
 * change arrives while a cycle is in flight, the change is captured
 * as "pending" and a follow-up cycle fires after the current one
 * settles — this is the same shape `scripts/dev.ts:122-136` uses for
 * shell/sdk rebuilds, applied per-plugin and in-process.
 *
 * Build errors broadcast `dev:plugin:error`. Successful rebuilds run
 * the reload pipeline (which itself broadcasts `dev:plugin:reload`
 * and, on recovery from a prior failure, `dev:plugin:recover`).
 *
 * Globs: read from `bakin-plugin.json#devWatch` if present, otherwise
 * a sensible default that catches the common plugin source layout
 * (`index.ts`, `client.tsx`, `components/`, `lib/`).
 */
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import chokidar, { type FSWatcher } from 'chokidar'
import { createLogger } from '@/core/logger'
import { broadcastPluginError } from '@/core/sse'
import { isLinked, readPluginLockfile } from '@bakin/core/plugins/lockfile'
import { buildUserPlugin } from '../../../packages/host/src/plugin-host/user-plugin-builder'
import { runReloadPipeline } from './reload-pipeline'

const log = createLogger('hot-reload-coordinator')

const DEFAULT_DEBOUNCE_MS = 80

const DEFAULT_WATCH_PATHS = [
  'index.ts',
  'index.tsx',
  'client.ts',
  'client.tsx',
  'bakin-plugin.json',
  'package.json',
  'components',
  'lib',
  'hooks',
] as const

const ALWAYS_IGNORE = [
  /(^|[\\/])\../,        // dotfiles + .git/
  /node_modules/,
  /\bdist\b/,
  /\.tsbuildinfo$/,
]

interface CoordinatorState {
  watchers: Map<string, FSWatcher>
  inFlight: Set<string>
  pending: Set<string>
  debounceTimers: Map<string, NodeJS.Timeout>
  debounceMs: number
  started: boolean
}

const g = globalThis as unknown as { __bakinHotReloadCoordinator?: CoordinatorState }

function getState(): CoordinatorState {
  if (!g.__bakinHotReloadCoordinator) {
    g.__bakinHotReloadCoordinator = {
      watchers: new Map(),
      inFlight: new Set(),
      pending: new Set(),
      debounceTimers: new Map(),
      debounceMs: DEFAULT_DEBOUNCE_MS,
      started: false,
    }
  }
  return g.__bakinHotReloadCoordinator
}

/**
 * Resolve the watch globs for a plugin. Manifest's `devWatch` array
 * wins; fall back to the curated default that mirrors the common
 * plugin layout. Globs are converted to absolute paths so chokidar
 * doesn't have to interpret relative bases.
 */
export function resolveWatchTargets(pluginDir: string): string[] {
  const manifestPath = join(pluginDir, 'bakin-plugin.json')
  let manifestPaths: string[] | null = null
  if (existsSync(manifestPath)) {
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as { devWatch?: unknown }
      if (Array.isArray(manifest.devWatch)) {
        const filtered = manifest.devWatch.filter((p): p is string => typeof p === 'string' && p.length > 0)
        if (filtered.length > 0) manifestPaths = filtered
      }
    } catch {
      // Bad manifest — fall through to defaults.
    }
  }
  const targets = manifestPaths ?? [...DEFAULT_WATCH_PATHS]
  return targets.map((p) => join(pluginDir, p)).filter((p) => existsSync(p))
}

/**
 * Run the build + reload cycle for one plugin id. Caller serializes;
 * this function is single-shot.
 */
async function buildAndReload(pluginId: string, pluginDir: string): Promise<void> {
  try {
    await buildUserPlugin(pluginDir)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    log.error('hot-reload: build failed', err as Error, { pluginId })
    broadcastPluginError(pluginId, `build failed: ${message}`)
    return
  }

  const result = await runReloadPipeline({ pluginId, dir: pluginDir })
  if (!result.ok) {
    // runReloadPipeline already broadcast dev:plugin:error; nothing more
    // to do here. Returning normally keeps the watcher alive so the next
    // save kicks off a fresh attempt.
    log.warn('hot-reload: pipeline returned !ok', { pluginId, failedAt: result.failedAt, error: result.error })
  }
}

/**
 * Schedule a build+reload cycle for a plugin. Debounce coalesces a
 * burst of file events; the inflight/pending pattern guarantees only
 * one cycle runs at a time per plugin id.
 */
function scheduleReload(pluginId: string, pluginDir: string): void {
  const state = getState()
  const existing = state.debounceTimers.get(pluginId)
  if (existing) clearTimeout(existing)
  state.debounceTimers.set(pluginId, setTimeout(() => {
    state.debounceTimers.delete(pluginId)
    void triggerReload(pluginId, pluginDir)
  }, state.debounceMs))
}

async function triggerReload(pluginId: string, pluginDir: string): Promise<void> {
  const state = getState()
  if (state.inFlight.has(pluginId)) {
    state.pending.add(pluginId)
    return
  }
  state.inFlight.add(pluginId)
  try {
    await buildAndReload(pluginId, pluginDir)
  } finally {
    state.inFlight.delete(pluginId)
    if (state.pending.delete(pluginId)) {
      void triggerReload(pluginId, pluginDir)
    }
  }
}

interface WatcherSpec {
  pluginId: string
  /** Plugin directory the symlink resolves to (real source tree). */
  pluginDir: string
}

function attachWatcher(spec: WatcherSpec): FSWatcher | null {
  const targets = resolveWatchTargets(spec.pluginDir)
  if (targets.length === 0) {
    log.warn('hot-reload: no watch targets resolved for plugin', { pluginId: spec.pluginId, pluginDir: spec.pluginDir })
    return null
  }
  const watcher = chokidar.watch(targets, {
    ignoreInitial: true,
    ignored: ALWAYS_IGNORE,
    awaitWriteFinish: { stabilityThreshold: 50, pollInterval: 20 },
  })
  watcher.on('all', (_event, _path) => {
    scheduleReload(spec.pluginId, spec.pluginDir)
  })
  watcher.on('error', (err) => {
    log.warn('hot-reload: watcher error', { pluginId: spec.pluginId, err: String(err) })
  })
  log.info('hot-reload: watching plugin', { pluginId: spec.pluginId, targets })
  return watcher
}

/**
 * Discover currently-linked plugins from the lockfile and attach a
 * watcher to each one. Idempotent — re-attaching a watcher for a
 * plugin already being watched is a no-op (we close the previous
 * watcher first).
 */
export function attachWatchersFromLockfile(): void {
  const state = getState()
  let lock: ReturnType<typeof readPluginLockfile>
  try {
    lock = readPluginLockfile()
  } catch (err) {
    log.warn('hot-reload: failed to read lockfile (no plugins watched)', { err: String(err) })
    return
  }
  for (const [id, entry] of Object.entries(lock.plugins)) {
    if (!isLinked(entry)) continue
    const linkedSource = entry.linkedSource
    if (!linkedSource) continue

    const existing = state.watchers.get(id)
    if (existing) void existing.close()

    const watcher = attachWatcher({ pluginId: id, pluginDir: linkedSource })
    if (watcher) state.watchers.set(id, watcher)
  }
}

/**
 * Boot the coordinator. Idempotent — the second call is a no-op.
 * Returns whether the coordinator activated. Production callers gate
 * on `process.env.BAKIN_DEV_HOTRELOAD === '1'` BEFORE importing this
 * module so chokidar doesn't end up in the compiled binary.
 */
export function startHotReloadCoordinator(opts: { debounceMs?: number } = {}): boolean {
  const state = getState()
  if (state.started) return true
  if (typeof opts.debounceMs === 'number' && opts.debounceMs > 0) {
    state.debounceMs = opts.debounceMs
  }
  state.started = true
  attachWatchersFromLockfile()
  log.info('hot-reload coordinator started', {
    plugins: state.watchers.size,
    debounceMs: state.debounceMs,
  })
  return true
}

/** Tear down every watcher. Used by tests + graceful shutdown. */
export async function stopHotReloadCoordinator(): Promise<void> {
  const state = getState()
  for (const [, watcher] of state.watchers) {
    try { await watcher.close() } catch { /* swallow */ }
  }
  state.watchers.clear()
  state.inFlight.clear()
  state.pending.clear()
  for (const timer of state.debounceTimers.values()) clearTimeout(timer)
  state.debounceTimers.clear()
  state.started = false
  log.info('hot-reload coordinator stopped')
}

/**
 * Test hook — call the build+reload cycle directly without going
 * through chokidar. Returns once the cycle (and any pending follow-up)
 * has fully settled. Production callers don't use this; only the
 * integration test in P2.C10.
 */
export async function __triggerReloadForTest(pluginId: string, pluginDir: string): Promise<void> {
  await triggerReload(pluginId, pluginDir)
  // Drain any pending re-trigger that the recursive call queued.
  const state = getState()
  while (state.inFlight.has(pluginId) || state.pending.has(pluginId)) {
    await new Promise((r) => setTimeout(r, 5))
  }
}

export function __resetCoordinatorForTest(): void {
  const state = getState()
  state.watchers.clear()
  state.inFlight.clear()
  state.pending.clear()
  for (const timer of state.debounceTimers.values()) clearTimeout(timer)
  state.debounceTimers.clear()
  state.started = false
  state.debounceMs = DEFAULT_DEBOUNCE_MS
}
