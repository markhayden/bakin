import { describe, it, expect, beforeEach, afterEach, mock, type Mock } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { FSWatcher } from 'chokidar'

const mockHome = join(tmpdir(), `bakin-watcher-test-home-${Date.now()}`)
mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => mockHome,
  getBakinPaths: () => ({ tasks: join(mockHome, 'tasks') }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => mockHome,
  getBakinPaths: () => ({ tasks: join(mockHome, 'tasks') }),
}))

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

mock.module('../../src/core/sse', () => ({
  broadcast: mock(),
  broadcastAuditEvent: mock(),
}))

mock.module('../../src/core/audit', () => ({
  appendAudit: mock(),
}))

mock.module('chokidar', () => ({
  watch: mock().mockReturnValue({
    on: mock().mockReturnThis(),
    close: mock().mockResolvedValue(undefined),
  }),
}))

import {
  start,
  stop,
  registerSyncHook,
  createInboxHandler,
  shouldIgnoreContentWatcherPath,
  resetCustomWorktreeRelCache,
} from '../../src/core/watcher'
import { broadcast } from '../../src/core/sse'
import { appendAudit } from '../../src/core/audit'
import { BakinEventBus } from '../../src/lib/events/event-bus'

describe('watcher', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'bakin-watcher-'))
    mock.clearAllMocks()
  })

  afterEach(async () => {
    await stop()
    rmSync(tempDir, { recursive: true, force: true })
  })

  // -------------------------------------------------------------------------
  // start / stop
  // -------------------------------------------------------------------------

  describe('start and stop', () => {
    it('starts chokidar watcher', async () => {
      const chokidar = await import('chokidar')
      const eventBus = new BakinEventBus(() => {})
      start({ contentDir: tempDir, eventBus, onInboxFile: mock() })
      expect(chokidar.watch).toHaveBeenCalledWith(tempDir, expect.any(Object))
    })

    it('ignores installed and linked plugin files under content/plugins', async () => {
      const chokidar = await import('chokidar')
      const eventBus = new BakinEventBus(() => {})
      start({ contentDir: tempDir, eventBus, onInboxFile: mock() })

      const opts = vi.mocked(chokidar.watch).mock.calls[0][1] as { ignored: (path: string) => boolean }
      expect(opts.ignored(tempDir)).toBe(false)
      expect(opts.ignored(join(tempDir, 'plugins'))).toBe(true)
      expect(opts.ignored(join(tempDir, 'plugins', 'projects', 'lib', 'project-service.ts'))).toBe(true)
      expect(shouldIgnoreContentWatcherPath(tempDir, join(tempDir, 'assets', '.trash'))).toBe(false)
    })

    it('ignores task files — the store broadcast is authoritative', () => {
      // Store-managed task JSON: the store's own emit is the single broadcast
      // source; the watcher must not produce a second one ~300ms later.
      expect(shouldIgnoreContentWatcherPath(tempDir, join(tempDir, 'tasks'))).toBe(true)
      expect(shouldIgnoreContentWatcherPath(tempDir, join(tempDir, 'tasks', '2026-06', 'task-abc.json'))).toBe(true)
      // Salvage output written directly by dispatch — also no broadcast needed.
      expect(shouldIgnoreContentWatcherPath(tempDir, join(tempDir, 'tasks', 'salvage', 'task-x-d1.md'))).toBe(true)
      // Sibling dirs that merely start with "tasks" are NOT ignored.
      expect(shouldIgnoreContentWatcherPath(tempDir, join(tempDir, 'tasks-other', 'file.json'))).toBe(false)
    })

    it('ignores the private antfly data dir — its churn deadlocks the process', () => {
      // ~/.bakin/antfly is the private antfly instance's --data-dir. The
      // server churns WAL/segment files there constantly; watching it floods
      // chokidar (and has deadlocked Bun's file-watcher thread against the
      // main thread, wedging the whole HTTP server).
      expect(shouldIgnoreContentWatcherPath(tempDir, join(tempDir, 'antfly'))).toBe(true)
      expect(shouldIgnoreContentWatcherPath(tempDir, join(tempDir, 'antfly', 'data', 'replicas', 'group-1', 'table-db', 'indexes', 'full_text_index_v0', 'segments', '377.seg'))).toBe(true)
      // Sibling dirs that merely start with "antfly" are NOT ignored.
      expect(shouldIgnoreContentWatcherPath(tempDir, join(tempDir, 'antfly-notes', 'file.md'))).toBe(false)
    })

    it('ignores run-workspaces and git-worktrees — worktree churn fd-exhausts the server', () => {
      expect(shouldIgnoreContentWatcherPath(tempDir, join(tempDir, 'run-workspaces'))).toBe(true)
      expect(shouldIgnoreContentWatcherPath(tempDir, join(tempDir, 'run-workspaces', 'jessica', 'task-a-d1-ab12cd34', 'repo', 'node_modules', 'x.js'))).toBe(true)
      expect(shouldIgnoreContentWatcherPath(tempDir, join(tempDir, 'git-worktrees'))).toBe(true)
      expect(shouldIgnoreContentWatcherPath(tempDir, join(tempDir, 'git-worktrees', 'task-x', 'src', 'main.ts'))).toBe(true)
      // Sibling-prefix names stay watched.
      expect(shouldIgnoreContentWatcherPath(tempDir, join(tempDir, 'run-workspaces-notes', 'a.md'))).toBe(false)
    })

    it('ignores a CUSTOM git worktree root configured under the content dir', () => {
      resetCustomWorktreeRelCache()
      mkdirSync(join(tempDir, 'plugin-settings'), { recursive: true })
      writeFileSync(join(tempDir, 'plugin-settings', 'git.json'), JSON.stringify({ worktreeRoot: join(tempDir, 'my-trees') }))
      expect(shouldIgnoreContentWatcherPath(tempDir, join(tempDir, 'my-trees', 'wt-1', 'file.ts'))).toBe(true)
      expect(shouldIgnoreContentWatcherPath(tempDir, join(tempDir, 'my-trees-other', 'file.ts'))).toBe(false)
      resetCustomWorktreeRelCache()
    })

    it('ignores backup/snapshot siblings of ANY content root, never live content', () => {
      // Dead sibling copies (assets.pre-pivot-*, tasks.bak) cost a kqueue fd
      // per file under Bun and resurface stale files as import badges. The
      // rule is marker-based so it covers the CLASS, not one past incident.
      expect(shouldIgnoreContentWatcherPath(tempDir, join(tempDir, 'assets.pre-pivot-20260417-215547'))).toBe(true)
      expect(shouldIgnoreContentWatcherPath(tempDir, join(tempDir, 'assets.pre-pivot-20260417-215547', 'images', 'old.png'))).toBe(true)
      expect(shouldIgnoreContentWatcherPath(tempDir, join(tempDir, 'tasks.bak', 'task.json'))).toBe(true)
      expect(shouldIgnoreContentWatcherPath(tempDir, join(tempDir, 'workflows.old-2026', 'w.yaml'))).toBe(true)
      // Live content and legitimate dotted top-level files stay watched.
      expect(shouldIgnoreContentWatcherPath(tempDir, join(tempDir, 'assets', 'store', '2026-07', 'a1', 'v1.png'))).toBe(false)
      expect(shouldIgnoreContentWatcherPath(tempDir, join(tempDir, 'assets.md'))).toBe(false)
      expect(shouldIgnoreContentWatcherPath(tempDir, join(tempDir, 'MEMORY-LOG.md'))).toBe(false)
    })

    it('stop is idempotent', async () => {
      await stop()
      // second call should not throw; bun:test's toThrow matcher doesn't
      // compose with an async resolves, so await directly and assert no throw.
      await stop()
    })

    it('never replays the initial scan through the event pipeline (ignoreInitial)', async () => {
      // Regression guard: without ignoreInitial, boot fired `add` for every
      // existing file and the sync hooks REWROTE every indexed row into
      // antfly — per-boot WAL/enrichment churn that grew the next boot's
      // catch-up window. Boot state belongs to reconcile/backfill.
      const chokidar = await import('chokidar')
      const eventBus = new BakinEventBus(() => {})
      start({ contentDir: tempDir, eventBus, onInboxFile: mock() })

      const opts = vi.mocked(chokidar.watch).mock.calls[0][1] as { ignoreInitial?: boolean }
      expect(opts.ignoreInitial).toBe(true)
    })

    it('sweeps ONLY completion reports at start — asset drops never auto-ingest (D7)', async () => {
      // The one path that legitimately depends on an offline sweep: agent
      // completion reports dropped while Bakin was down. Asset drops are
      // the Import view's business — no boot hook, no auto-ingest.
      mkdirSync(join(tempDir, 'inbox'), { recursive: true })
      mkdirSync(join(tempDir, 'assets', 'inbox'), { recursive: true })
      // Pre-existing indexed content that must NOT fire hooks at boot:
      mkdirSync(join(tempDir, 'assets', 'store', '2026-07', 'asset-1'), { recursive: true })
      writeFileSync(join(tempDir, 'assets', 'store', '2026-07', 'asset-1', 'manifest.json'), '{}')
      writeFileSync(join(tempDir, 'inbox', 'report.json'), JSON.stringify({ type: 'task-complete', title: 'T', agent: 'a' }))
      writeFileSync(join(tempDir, 'assets', 'inbox', 'dropped.png'), 'binary')

      const seen: string[] = []
      const unregister = registerSyncHook((rel) => { seen.push(rel) })
      const onInboxFile = mock()
      const eventBus = new BakinEventBus(() => {})
      start({ contentDir: tempDir, eventBus, onInboxFile })
      // sweep fires hooks fire-and-forget — let them settle
      await new Promise((r) => setTimeout(r, 20))

      expect(seen).toContain(join('inbox', 'report.json'))
      expect(seen).not.toContain(join('assets', 'inbox', 'dropped.png'))
      // The stored manifest fires no boot hook either.
      expect(seen.some((p) => p.includes('manifest.json'))).toBe(false)
      expect(onInboxFile).toHaveBeenCalledTimes(1)
      unregister()
    })
  })

  // -------------------------------------------------------------------------
  // createInboxHandler
  // -------------------------------------------------------------------------

  describe('createInboxHandler', () => {
    it('sends notification for task-complete inbox messages', () => {
      const sendNotification = mock()
      const handler = createInboxHandler({ contentDir: tempDir, sendNotification })

      const inboxFile = join(tempDir, 'inbox', 'report.json')
      mkdirSync(join(tempDir, 'inbox'), { recursive: true })
      writeFileSync(inboxFile, JSON.stringify({
        type: 'task-complete',
        title: 'Write blog post',
        agent: 'trainer',
        summary: 'Published blog post about AI',
      }))

      handler(inboxFile)

      expect(sendNotification).toHaveBeenCalledTimes(1)
      const msg = sendNotification.mock.calls[0][0]
      expect(msg).toContain('trainer')
      expect(msg).toContain('Write blog post')
    })

    it('calls appendAudit for completion reports', () => {
      const handler = createInboxHandler({ contentDir: tempDir, sendNotification: mock() })

      const inboxFile = join(tempDir, 'inbox', 'report.json')
      mkdirSync(join(tempDir, 'inbox'), { recursive: true })
      writeFileSync(inboxFile, JSON.stringify({
        type: 'task-complete',
        title: 'Task X',
        agent: 'pixel',
        summary: 'Done',
      }))

      handler(inboxFile)

      expect(vi.mocked(appendAudit)).toHaveBeenCalledWith(
        tempDir,
        'task.completion_report',
        'pixel',
        expect.objectContaining({ title: 'Task X' }),
      )
    })

    it('ignores non task-complete messages', () => {
      const sendNotification = mock()
      const handler = createInboxHandler({ contentDir: tempDir, sendNotification })

      const inboxFile = join(tempDir, 'inbox', 'other.json')
      mkdirSync(join(tempDir, 'inbox'), { recursive: true })
      writeFileSync(inboxFile, JSON.stringify({ type: 'status-update', agent: 'trainer' }))

      handler(inboxFile)
      expect(sendNotification).not.toHaveBeenCalled()
    })

    it('handles invalid JSON gracefully', () => {
      const sendNotification = mock()
      const handler = createInboxHandler({ contentDir: tempDir, sendNotification })

      const inboxFile = join(tempDir, 'inbox', 'bad.json')
      mkdirSync(join(tempDir, 'inbox'), { recursive: true })
      writeFileSync(inboxFile, '{ broken json')

      expect(() => handler(inboxFile)).not.toThrow()
      expect(sendNotification).not.toHaveBeenCalled()
    })
  })

  // -------------------------------------------------------------------------
  // registerSyncHook
  // -------------------------------------------------------------------------

  describe('registerSyncHook', () => {
    it('registers a hook without throwing', () => {
      expect(() => registerSyncHook(() => {})).not.toThrow()
    })
  })

  // -------------------------------------------------------------------------
  // file extension filter
  // -------------------------------------------------------------------------

  describe('file extension filter', () => {
    async function getChangeHandler(): Promise<(path: string) => void> {
      const chokidar = await import('chokidar')
      const mockWatcher = vi.mocked(chokidar.watch).mock.results[0].value as FSWatcher
      const onCalls = vi.mocked(mockWatcher.on).mock.calls
      const changeCall = onCalls.find((call: unknown[]) => call[0] === 'change')
      if (!changeCall) throw new Error('no change handler registered')
      return changeCall[1] as (path: string) => void
    }

    it('processes .yaml files and broadcasts content', async () => {
      const eventBus = new BakinEventBus(() => {})
      start({ contentDir: tempDir, eventBus, onInboxFile: mock() })

      mkdirSync(join(tempDir, 'workflows', 'definitions'), { recursive: true })
      const yamlPath = join(tempDir, 'workflows', 'definitions', 'sample.yaml')
      writeFileSync(yamlPath, 'name: sample\nsteps: []\n')

      const onChange = await getChangeHandler()
      onChange(yamlPath)

      expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({
        file: 'workflows/definitions/sample.yaml',
        event: 'change',
        content: 'name: sample\nsteps: []\n',
      }))
    })

    it('processes .yml files (short extension)', async () => {
      const eventBus = new BakinEventBus(() => {})
      start({ contentDir: tempDir, eventBus, onInboxFile: mock() })

      mkdirSync(join(tempDir, 'workflows', 'definitions'), { recursive: true })
      const ymlPath = join(tempDir, 'workflows', 'definitions', 'short.yml')
      writeFileSync(ymlPath, 'name: short\n')

      const onChange = await getChangeHandler()
      onChange(ymlPath)

      expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({
        file: 'workflows/definitions/short.yml',
        event: 'change',
        content: 'name: short\n',
      }))
    })

    it('ignores unsupported extensions', async () => {
      const eventBus = new BakinEventBus(() => {})
      start({ contentDir: tempDir, eventBus, onInboxFile: mock() })

      const exePath = join(tempDir, 'random.exe')
      writeFileSync(exePath, 'binary content')

      const onChange = await getChangeHandler()
      onChange(exePath)

      expect(broadcast).not.toHaveBeenCalled()
    })
  })
})
