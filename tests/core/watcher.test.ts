import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { FSWatcher } from 'chokidar'

vi.mock('../../src/core/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}))

vi.mock('../../src/core/sse', () => ({
  broadcast: vi.fn(),
  broadcastAuditEvent: vi.fn(),
}))

vi.mock('../../src/core/audit', () => ({
  appendAudit: vi.fn(),
}))

vi.mock('chokidar', () => ({
  watch: vi.fn().mockReturnValue({
    on: vi.fn().mockReturnThis(),
    close: vi.fn().mockResolvedValue(undefined),
  }),
}))

import { start, stop, registerSyncHook, createInboxHandler } from '../../src/core/watcher'
import { broadcast } from '../../src/core/sse'
import { appendAudit } from '../../src/core/audit'
import { BakinEventBus } from '../../src/lib/events/event-bus'

describe('watcher', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'bakin-watcher-'))
    vi.clearAllMocks()
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
      start({ contentDir: tempDir, eventBus, onInboxFile: vi.fn() })
      expect(chokidar.watch).toHaveBeenCalledWith(tempDir, expect.any(Object))
    })

    it('stop is idempotent', async () => {
      await stop()
      await expect(stop()).resolves.not.toThrow()
    })
  })

  // -------------------------------------------------------------------------
  // createInboxHandler
  // -------------------------------------------------------------------------

  describe('createInboxHandler', () => {
    it('sends notification for task-complete inbox messages', () => {
      const sendNotification = vi.fn()
      const handler = createInboxHandler({ contentDir: tempDir, sendNotification })

      const inboxFile = join(tempDir, 'inbox', 'report.json')
      mkdirSync(join(tempDir, 'inbox'), { recursive: true })
      writeFileSync(inboxFile, JSON.stringify({
        type: 'task-complete',
        title: 'Write blog post',
        agent: 'nemo',
        summary: 'Published blog post about AI',
      }))

      handler(inboxFile)

      expect(sendNotification).toHaveBeenCalledOnce()
      const msg = sendNotification.mock.calls[0][0]
      expect(msg).toContain('nemo')
      expect(msg).toContain('Write blog post')
    })

    it('calls appendAudit for completion reports', () => {
      const handler = createInboxHandler({ contentDir: tempDir, sendNotification: vi.fn() })

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
      const sendNotification = vi.fn()
      const handler = createInboxHandler({ contentDir: tempDir, sendNotification })

      const inboxFile = join(tempDir, 'inbox', 'other.json')
      mkdirSync(join(tempDir, 'inbox'), { recursive: true })
      writeFileSync(inboxFile, JSON.stringify({ type: 'status-update', agent: 'nemo' }))

      handler(inboxFile)
      expect(sendNotification).not.toHaveBeenCalled()
    })

    it('handles invalid JSON gracefully', () => {
      const sendNotification = vi.fn()
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
      start({ contentDir: tempDir, eventBus, onInboxFile: vi.fn() })

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
      start({ contentDir: tempDir, eventBus, onInboxFile: vi.fn() })

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
      start({ contentDir: tempDir, eventBus, onInboxFile: vi.fn() })

      const exePath = join(tempDir, 'random.exe')
      writeFileSync(exePath, 'binary content')

      const onChange = await getChangeHandler()
      onChange(exePath)

      expect(broadcast).not.toHaveBeenCalled()
    })
  })
})
