/**
 * The read-only services over the REAL Pi adapter with a cold home (PR 8
 * review r4 #1): constructing the runtime and listing agents creates nothing
 * under PI_HOME — no auth store, no model store, no directories.
 */
import { afterAll, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const testDir = join(tmpdir(), `bakin-test-readonly-pi-${Date.now()}-${randomUUID()}`)
mkdirSync(testDir, { recursive: true })
process.env.BAKIN_HOME = testDir
process.env.PI_HOME = join(testDir, 'pi-home-that-does-not-exist')
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')
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
mock.module('../../src/core/search-adapter-factory', () => ({ createSearchAdapter: () => ({ name: 'fake-search', version: '1', initialize: mock(async () => {}) }) }))
mock.module('../../src/core/task-store', () => ({ getSharedBakinTaskStore: () => ({ kind: 'task-store' }) }))
mock.module('../../src/core/settings', () => ({
  getSettings: () => ({ runtime: { adapter: 'pi', settings: {} }, search: { adapter: 'fake', settings: {} } }),
  resetSettingsCache: () => {},
}))

import { createReadOnlyAppServices } from '../../src/core/app-services'
import { resetPiHome } from '../../packages/adapter-pi/src/home'
import { resetModelRegistry } from '../../packages/adapter-pi/src/models'

resetPiHome()
resetModelRegistry()
afterAll(() => { delete process.env.BAKIN_HOME; delete process.env.PI_HOME; rmSync(testDir, { recursive: true, force: true }) })

describe('createReadOnlyAppServices over Pi with a cold home', () => {
  it('lists agents (none) without creating PI_HOME, its auth store or its model store', async () => {
    const piHome = process.env.PI_HOME!
    expect(existsSync(piHome)).toBe(false)
    const services = await createReadOnlyAppServices()
    expect(services.runtime.name).toBe('pi')
    expect(await services.runtime.agents.list()).toEqual([])
    expect(await services.runtime.agents.readWorkspaceFile('main', 'SOUL.md')).toBeNull()
    expect(existsSync(piHome)).toBe(false)
    expect(existsSync(join(piHome, 'agent', 'auth.json'))).toBe(false)
    expect(existsSync(join(piHome, 'agent', 'models-store.json'))).toBe(false)
  })
})
