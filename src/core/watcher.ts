/**
 * File watcher for Beacon content directory.
 * Uses chokidar to watch for changes and broadcasts via SSE.
 * Handles inbox completion reports inline.
 */
import { watch, type FSWatcher } from 'chokidar'
import { readFileSync } from 'fs'
import { join, relative } from 'path'
import { createLogger } from './logger'
import { broadcast, broadcastAuditEvent } from './sse'
import { appendAudit } from './audit'
import type { MCEventBus } from '../lib/events/event-bus'

const log = createLogger('watcher')

let watcher: FSWatcher | null = null

// Sync hooks — modules can register to be notified of file writes
type SyncHook = (relativePath: string, content: string) => void | Promise<void>
const syncHooks: SyncHook[] = []

export function registerSyncHook(hook: SyncHook): void {
  syncHooks.push(hook)
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

interface WatcherDeps {
  contentDir: string
  eventBus: MCEventBus
  onInboxFile: (fullPath: string) => void
}

function handleFileEvent(deps: WatcherDeps, fullPath: string, event: string): void {
  if (!/\.(md|json|jsonl)$/.test(fullPath)) return
  const rel = relative(deps.contentDir, fullPath)

  // Skip audit.jsonl — it's append-only and grows large.
  // Audit events are broadcast individually via broadcastAuditEvent().
  if (rel === 'audit.jsonl') return

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
    ignored: /(^|[/\\])\./,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 50 },
  })

  watcher.on('change', (fullPath: string) => handleFileEvent(deps, fullPath, 'change'))
  watcher.on('add', (fullPath: string) => handleFileEvent(deps, fullPath, 'add'))

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
        const reviewMsg = `Agent ${msg.agent} reports task complete: "${msg.title}". Summary: ${msg.summary || 'No summary provided.'}. Please review and if satisfied, move the task to Done via the Beacon API (beacon tasks move <id> done). If rework is needed, add notes and leave it in In Progress.`
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
