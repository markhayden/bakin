/**
 * File watcher for Bakin content directory.
 * Uses chokidar to watch for changes and broadcasts via SSE.
 * Handles inbox completion reports inline.
 *
 * ─── Hook contract ────────────────────────────────────────────────────
 *
 * Modules can subscribe to filesystem events through two hook arrays:
 *
 *   registerSyncHook(cb)   — fired on `add` and `change` events
 *   registerUnlinkHook(cb) — fired on `unlink` events
 *
 * Both fire fire-and-forget: hooks are awaited in order but errors are
 * caught, logged, and swallowed so a single misbehaving hook never blocks
 * the rest of the chain or the event loop.
 *
 * ─── awaitWriteFinish lag ────────────────────────────────────────────
 *
 * Chokidar is configured with `awaitWriteFinish: { stabilityThreshold: 300ms }`.
 * That means hooks fire ~300ms AFTER a file write settles, not the moment
 * the write happens. Code paths that need immediate consistency (REST
 * routes responding to a client write, for example) MUST call their
 * search/index mutators directly. The hooks are a safety net for
 * filesystem writes that bypass the authoritative path — manual `cp`,
 * rsync, external agents writing to disk, restored backups — not a
 * replacement for synchronous mutation calls.
 *
 * ─── Path semantics ──────────────────────────────────────────────────
 *
 * Hook callbacks receive the file path RELATIVE to `contentDir`. This
 * matches the format used by `ctx.search.index(key, ...)` so the same
 * value flows from event → hook → index without translation. Sync hooks
 * also receive the file content as a UTF-8 string (empty for binary
 * assets, which the watcher recognizes by their `assets/` prefix).
 * Registration returns an unsubscribe function for dev/plugin reload
 * paths that replace watcher hooks without process restart.
 *
 * ─── Filter ──────────────────────────────────────────────────────────
 *
 * The non-asset path filter accepts `.md`, `.json`, `.jsonl`, `.yaml`,
 * `.yml`. Anything else under `~/.bakin/` is ignored. Asset binaries are
 * matched separately via the `assets/` prefix and broadcast WITHOUT a
 * file read (no content payload) since they may be very large.
 *
 * `~/.bakin/plugins/**` is explicitly ignored. Installed and linked plugins
 * are runtime artifacts, not user content; linked plugins are symlinks to
 * external source trees, and following them here races plugin lifecycle
 * operations like unlink/hot-reload.
 */
import { watch, type FSWatcher } from 'chokidar'
import { readFileSync, readdirSync, statSync } from 'fs'
import { homedir } from 'os'
import { join, relative, resolve } from 'path'
import { createLogger } from './logger'
import { broadcast } from './sse'
import { appendAudit } from './audit'
import type { BakinEventBus } from '../lib/events/event-bus'

const log = createLogger('watcher')

let watcher: FSWatcher | null = null

// Sync hooks — modules can register to be notified of file writes
type SyncHook = (relativePath: string, content: string) => void | Promise<void>
const syncHooks: SyncHook[] = []

// Unlink hooks — modules can register to be notified of file deletions
type UnlinkHook = (relativePath: string) => void | Promise<void>
const unlinkHooks: UnlinkHook[] = []
type UnsubscribeHook = () => void

/**
 * Subscribe to file `add` and `change` events.
 *
 * Hooks receive the file path relative to `contentDir` and the UTF-8
 * file content (empty string for binary asset files). Hooks are awaited
 * in registration order; errors are logged and swallowed.
 *
 * NOTE: hooks fire ~300ms after the write due to `awaitWriteFinish`.
 * Authoritative consistency paths should call mutators directly rather
 * than relying on this hook. See file header for the full contract.
 */
export function registerSyncHook(hook: SyncHook): UnsubscribeHook {
  syncHooks.push(hook)
  return () => {
    const idx = syncHooks.indexOf(hook)
    if (idx >= 0) syncHooks.splice(idx, 1)
  }
}

/**
 * Subscribe to file `unlink` events.
 *
 * Hooks receive the file path relative to `contentDir`. Same fire-and-
 * forget semantics as `registerSyncHook`. Use for symmetric cleanup of
 * derived state (search indexes, in-memory trackers, caches).
 */
export function registerUnlinkHook(hook: UnlinkHook): UnsubscribeHook {
  unlinkHooks.push(hook)
  return () => {
    const idx = unlinkHooks.indexOf(hook)
    if (idx >= 0) unlinkHooks.splice(idx, 1)
  }
}

async function runSyncHooks(relativePath: string, content: string): Promise<void> {
  for (const hook of syncHooks) {
    try {
      await hook(relativePath, content)
    } catch (err) {
      log.error('Sync hook failed', err, { file: relativePath })
    }
  }
}

async function runUnlinkHooks(relativePath: string): Promise<void> {
  for (const hook of unlinkHooks) {
    try {
      await hook(relativePath)
    } catch (err) {
      log.error('Unlink hook failed', err, { file: relativePath })
    }
  }
}

interface WatcherDeps {
  contentDir: string
  eventBus: BakinEventBus
  onInboxFile: (fullPath: string) => void
}

/**
 * The git plugin's worktree root is settings-configurable — a user-custom
 * root elsewhere under ~/.bakin must be excluded too, not just the literal
 * `git-worktrees/` default. Read once per process (the ignore callback is
 * hot-path; a watcher restart requires a server restart anyway).
 * `undefined` = not yet resolved; `null` = default/outside-contentDir.
 */
let customWorktreeRelCache: string | null | undefined
export function resetCustomWorktreeRelCache(): void {
  customWorktreeRelCache = undefined
}
function customGitWorktreeRel(contentDir: string): string | null {
  if (customWorktreeRelCache !== undefined) return customWorktreeRelCache
  try {
    const raw = JSON.parse(readFileSync(join(contentDir, 'plugin-settings', 'git.json'), 'utf-8')) as { worktreeRoot?: unknown }
    const configured = typeof raw.worktreeRoot === 'string' ? raw.worktreeRoot.trim() : ''
    if (!configured) {
      customWorktreeRelCache = null
    } else {
      const abs = resolve(configured.startsWith('~/') ? join(homedir(), configured.slice(2)) : configured)
      const rel = relative(contentDir, abs).replace(/\\/g, '/')
      customWorktreeRelCache = rel && !rel.startsWith('..') && rel !== '' ? rel : null
    }
  } catch {
    customWorktreeRelCache = null
  }
  return customWorktreeRelCache
}

export function shouldIgnoreContentWatcherPath(contentDir: string, path: string): boolean {
  if (path === contentDir) return false
  const rel = relative(contentDir, path).replace(/\\/g, '/')
  if (rel === '' || rel === '.') return false

  // User plugin installs live under ~/.bakin/plugins. In dev-link mode each
  // plugin dir is a symlink into an external source checkout, so the content
  // watcher must never traverse or emit events for it.
  if (rel === 'plugins' || rel.startsWith('plugins/')) return true

  // Task JSON is store-managed: the store's own emit is the authoritative
  // (and only) broadcast for task writes — watching tasks/ produced a second
  // redundant read+SSE ~300ms after every write. Also covers tasks/salvage/.
  // External hand-edits to task files need a restart to broadcast (accepted:
  // the store is the single writer).
  if (rel === 'tasks' || rel.startsWith('tasks/')) return true

  // ~/.bakin/antfly is the private antfly instance's --data-dir (zig
  // migration, spec decision 10) — server-internal WAL/segment files churned
  // constantly by antfly itself, never Bakin content. Watching it floods
  // chokidar with thousands of events per compaction and has deadlocked
  // Bun's file-watcher thread against the main thread (every thread parked
  // on os_unfair_lock), wedging the entire HTTP server seconds after boot.
  if (rel === 'antfly' || rel.startsWith('antfly/')) return true

  // Per-run agent working directories (same-agent-concurrency D2) and the
  // git plugin's worktree root: agent scratch + full repo checkouts. One
  // worktree of a real repo is thousands of kqueue fds (a `bun install`
  // inside it is ~150k — macOS supervised processes get 256), plus the
  // antfly-style event-storm class above. Never watched, never SSE'd.
  if (rel === 'run-workspaces' || rel.startsWith('run-workspaces/')) return true
  if (rel === 'git-worktrees' || rel.startsWith('git-worktrees/')) return true
  const customWorktreeRel = customGitWorktreeRel(contentDir)
  if (customWorktreeRel && (rel === customWorktreeRel || rel.startsWith(`${customWorktreeRel}/`))) return true

  // Backup/snapshot siblings of ANY content root (assets.pre-pivot-*,
  // tasks.bak, workflows.old-2026) are dead copies, never live content.
  // Watching one costs a kqueue fd per file under Bun and resurfaces stale
  // files as unmanaged-import badges. Marker-based so legitimate top-level
  // files (assets.md, MEMORY-LOG.md) stay watched.
  const firstSegment = rel.split('/')[0]
  if (/\.(bak|backup|old|orig|prev|pre-pivot)([.-][^/]*)?$/i.test(firstSegment)) return true

  const basename = path.split(/[\\/]/).pop() || ''
  // Allow .trash inside assets (we handle skipping in handleFileEvent)
  if (basename === '.trash' && rel.startsWith('assets/')) return false
  return basename.startsWith('.')
}

function handleFileEvent(deps: WatcherDeps, fullPath: string, event: string): void {
  if (shouldIgnoreContentWatcherPath(deps.contentDir, fullPath)) return
  const rel = relative(deps.contentDir, fullPath)

  // Skip audit.jsonl — it's append-only and grows large.
  if (rel === 'audit.jsonl') return

  // Asset files (binary) — notify sync hooks but don't broadcast content via SSE
  if (rel.startsWith('assets/') && !rel.includes('.trash/')) {
    if (rel.endsWith('.meta.json')) {
      // Sidecar metadata is text — read and broadcast
      try {
        const content = readFileSync(fullPath, 'utf-8')
        broadcast({ file: rel, content, event, timestamp: new Date().toISOString() })
        runSyncHooks(rel, content).catch(err => {
          log.error('Sync hooks error', err, { file: rel })
        })
      } catch (err) {
        log.warn('Failed to read sidecar file', err, { file: rel })
      }
    } else {
      // Binary asset — broadcast a notification (no content) and fire sync hooks
      broadcast({ file: rel, content: '', event: 'asset.' + event, timestamp: new Date().toISOString() })
      runSyncHooks(rel, '').catch(err => {
        log.error('Sync hooks error', err, { file: rel })
      })
    }
    return
  }

  // Non-asset files: only handle text formats
  if (!/\.(md|json|jsonl|ya?ml)$/.test(fullPath)) return

  try {
    const content = readFileSync(fullPath, 'utf-8')
    broadcast({ file: rel, content, event, timestamp: new Date().toISOString() })
    deps.eventBus.injectFileEvent(rel, event, content)

    // Fire sync hooks (non-blocking)
    runSyncHooks(rel, content).catch(err => {
      log.error('Sync hooks error', err, { file: rel })
    })
  } catch (err) {
    log.warn('Failed to read changed file', err, { file: rel })
  }

  // Handle inbox completion reports inline
  if (rel.startsWith('inbox/') && rel.endsWith('.json')) {
    deps.onInboxFile(fullPath)
  }
}

/**
 * Boot sweep for the ONLY two paths that legitimately depended on chokidar's
 * initial-scan `add` events: files dropped while Bakin was down.
 *
 *   - `assets/inbox/`  — offline asset drops awaiting ingestion
 *   - `inbox/*.json`   — agent completion reports written while down
 *
 * Everything else on disk is covered at boot by the startup reconcile
 * (file-backed content types) and the memory backfill, so replaying the
 * initial scan through the sync hooks only produced no-op REWRITES of every
 * indexed row — each one a WAL entry + enrichment-worker pass + replay/
 * publish churn in antfly (embeds themselves are skipped by source-hash
 * when artifacts are intact), inflating every subsequent boot's catch-up
 * window. And whenever artifacts HAD been lost (the upstream durability
 * bug), these rewrites re-embedded for real.
 */
function sweepOfflineDrops(deps: WatcherDeps): void {
  // Content-root inbox/*.json only: agent completion reports dropped while
  // Bakin was down (dispatch-owned). assets/inbox is NOT swept — asset
  // drops never auto-ingest (D7); the Import view scans on demand.
  for (const dir of ['inbox']) {
    const full = join(deps.contentDir, dir)
    let entries: string[]
    try {
      entries = readdirSync(full)
    } catch {
      continue // dir absent — nothing dropped
    }
    for (const name of entries) {
      if (name.startsWith('.')) continue
      const fullPath = join(full, name)
      try {
        if (!statSync(fullPath).isFile()) continue
      } catch {
        continue
      }
      handleFileEvent(deps, fullPath, 'add')
    }
  }
}

export function start(deps: WatcherDeps): void {
  watcher = watch(deps.contentDir, {
    ignored: (path: string) => shouldIgnoreContentWatcherPath(deps.contentDir, path),
    persistent: true,
    // NEVER replay the initial scan through the event pipeline. Without this,
    // boot emitted `add` for every existing file under ~/.bakin/ and the sync
    // hooks rewrote every asset/workflow/lesson row into the search index —
    // unconditionally — flooding antfly with per-boot WAL/enrichment/replay
    // churn that lengthened its next startup catch-up (and re-embedding for
    // real whenever stored artifacts had been lost). Boot-state coverage
    // belongs to the startup reconcile + memory backfill; the two genuine
    // offline-drop paths are swept explicitly below.
    ignoreInitial: true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 50 },
  })

  sweepOfflineDrops(deps)

  watcher.on('change', (fullPath: string) => handleFileEvent(deps, fullPath, 'change'))
  watcher.on('add', (fullPath: string) => handleFileEvent(deps, fullPath, 'add'))
  watcher.on('unlink', (fullPath: string) => {
    if (shouldIgnoreContentWatcherPath(deps.contentDir, fullPath)) return
    const rel = relative(deps.contentDir, fullPath)
    if (rel === 'audit.jsonl') return
    log.info('File deleted', { file: rel })
    broadcast({ file: rel, content: '', event: 'unlink', timestamp: new Date().toISOString() })
    runUnlinkHooks(rel).catch(err => {
      log.error('Unlink hooks error', err, { file: rel })
    })
  })

  log.info('File watcher started', { dir: deps.contentDir })
}

export async function stop(): Promise<void> {
  if (watcher) {
    await watcher.close()
    watcher = null
    log.info('File watcher stopped')
  }
}

/**
 * Process an inbox completion report from an agent.
 */
export function createInboxHandler(deps: { contentDir: string, sendNotification: (message: string) => void }) {
  return function handleInboxFile(fullPath: string): void {
    try {
      const raw = readFileSync(fullPath, 'utf-8')
      const msg = JSON.parse(raw)
      if (msg.type === 'task-complete' && msg.title && msg.agent) {
        const reviewMsg = `Agent ${msg.agent} reports task complete: "${msg.title}". Summary: ${msg.summary || 'No summary provided.'}. Please review and if satisfied, move the task to Done via the Bakin API (bakin tasks move <id> done). If rework is needed, add notes and leave it in In Progress.`
        deps.sendNotification(reviewMsg)

        appendAudit(deps.contentDir, 'task.completion_report', msg.agent, {
          title: msg.title,
          summary: msg.summary,
        })
      }
    } catch (err) {
      log.warn('Invalid inbox file', err, { file: fullPath })
    }
  }
}
