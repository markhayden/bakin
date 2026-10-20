/**
 * `createReadOnlyAppServices()` (PR 8 review r3 #1): the runtime comes up
 * for roster/workspace reads and NOTHING else is touched — the search
 * adapter is constructed but never initialized (antfly provisioning), no
 * health check registers.
 */
import { afterAll, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const testDir = join(tmpdir(), `bakin-test-app-services-readonly-${Date.now()}-${randomUUID()}`)
mkdirSync(testDir, { recursive: true })
process.env.BAKIN_HOME = testDir
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, root: testDir, db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
const loggerMock = () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) })
mock.module('../../src/core/logger', loggerMock)
mock.module('../../packages/core/src/logger', loggerMock)

const runtimeInit = mock(async (_opts: Record<string, unknown>) => {})
const searchInit = mock(async (_opts: Record<string, unknown>) => {})
const healthRegistrations: string[] = []
mock.module('../../src/core/runtime-adapter-factory', () => ({
  createRuntimeAdapter: () => ({ name: 'fake', version: '1', initialize: runtimeInit }),
  createRuntimeAdapterHealthChecks: () => [{ id: 'fake-check' }],
}))
mock.module('../../src/core/search-adapter-factory', () => ({
  createSearchAdapter: () => ({ name: 'fake-search', version: '1', initialize: searchInit }),
}))
mock.module('../../src/core/health-check-registry', () => ({
  registerAdapterHealthCheck: (_runtime: string, _label: string, check: { id: string }) => { healthRegistrations.push(check.id) },
  unregisterOwnerHealth: () => {},
}))
mock.module('../../src/core/task-store', () => ({ getSharedBakinTaskStore: () => ({ kind: 'task-store' }) }))
mock.module('../../src/core/settings', () => ({
  getSettings: () => ({ runtime: { adapter: 'fake', settings: {} }, search: { adapter: 'fake', settings: {} } }),
  resetSettingsCache: () => {},
}))

import { createReadOnlyAppServices, maybeGetAppServices } from '../../src/core/app-services'

afterAll(() => { delete process.env.BAKIN_HOME; rmSync(testDir, { recursive: true, force: true }) })

describe('createReadOnlyAppServices', () => {
  it('initializes the runtime only: no search initialization, no health registration', async () => {
    const services = await createReadOnlyAppServices()
    expect(runtimeInit).toHaveBeenCalledTimes(1)
    expect(searchInit).not.toHaveBeenCalled()
    expect(healthRegistrations).toEqual([])
    expect(services.runtime.name).toBe('fake')
    expect(maybeGetAppServices()).toBe(services)
    // No delivery bridge rides a read-only path.
    const init = runtimeInit.mock.calls[0]?.[0] as Record<string, unknown> | undefined
    expect(init && 'channelBridge' in init).toBe(false)
  })
})
