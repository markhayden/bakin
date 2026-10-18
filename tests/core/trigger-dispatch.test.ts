/**
 * Dispatch kicks are IN-PROCESS (never an HTTP POST to a guessed port): both
 * `triggerDispatch` helpers — core task-service and the workflows plugin's —
 * reach the dispatcher's `requestImmediateDispatch` and send zero requests.
 * The HTTP version POSTed to `localhost:${PORT || 3737}/api/dispatch`, which
 * from the test suite (or a CLI on another home) ran a LIVE server's
 * dispatch cycle.
 */
import { afterAll, describe, expect, it, mock, spyOn } from 'bun:test'
import { rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-trigger-dispatch-${Date.now()}-${randomUUID()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
const loggerMock = () => ({ createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }) })
mock.module('../../src/core/logger', loggerMock)
mock.module('../../packages/core/src/logger', loggerMock)
mock.module('../../src/core/watcher', () => ({ startWatcher: mock(), stopWatcher: mock() }))
const kicks: string[] = []
mock.module('../../src/core/dispatch-cycle', () => ({ requestImmediateDispatch: (reason: string) => { kicks.push(reason) } }))
afterAll(() => rmSync(testDir, { recursive: true, force: true }))

import { waitUntil } from '../helpers/wait'
import { triggerDispatch } from '../../src/core/task-service'
import { triggerDispatch as triggerWorkflowDispatch } from '../../plugins/workflows/lib/trigger-dispatch'

describe('triggerDispatch', () => {
  it('core and workflows kicks reach the in-process dispatcher with zero HTTP requests', async () => {
    const fetchSpy = spyOn(globalThis, 'fetch')
    try {
      triggerDispatch()
      triggerWorkflowDispatch()
      await waitUntil(() => kicks.length === 2, { label: 'both kicks reached requestImmediateDispatch' })
      expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy.mockRestore()
    }
  })
})
