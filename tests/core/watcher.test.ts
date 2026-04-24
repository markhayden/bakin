import { describe, it, expect, beforeEach, afterEach, mock, type Mock } from 'bun:test'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { FSWatcher } from 'chokidar'

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

import { start, stop, registerSyncHook, createInboxHandler } from '../../src/core/watcher'
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
