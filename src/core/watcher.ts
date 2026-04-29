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
import { readFileSync } from 'fs'
import { relative } from 'path'
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

export function shouldIgnoreContentWatcherPath(contentDir: string, path: string): boolean {
  if (path === contentDir) return false
  const rel = relative(contentDir, path).replace(/\\/g, '/')
  if (rel === '' || rel === '.') return false

  // User plugin installs live under ~/.bakin/plugins. In dev-link mode each
  // plugin dir is a symlink into an external source checkout, so the content
  // watcher must never traverse or emit events for it.
  if (rel === 'plugins' || rel.startsWith('plugins/')) return true

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

export function start(deps: WatcherDeps): void {
  watcher = watch(deps.contentDir, {
    ignored: (path: string) => shouldIgnoreContentWatcherPath(deps.contentDir, path),
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 50 },
  })

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
