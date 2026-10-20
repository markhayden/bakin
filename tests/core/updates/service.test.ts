/** The process-wide updates service: registered sources → one engine + timer, started and stopped by the server lifecycle. */
import { afterAll, afterEach, describe, expect, it, mock } from 'bun:test'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

const testDir = join(tmpdir(), `bakin-test-updates-service-${Date.now()}-${randomUUID()}`)
mkdirSync(testDir, { recursive: true })
process.env.BAKIN_HOME = testDir
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, root: testDir, db: join(testDir, 'bakin.db'), media: join(testDir, 'media') }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
const loggerMock = () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) })
mock.module('../../../src/core/logger', loggerMock)
mock.module('../../../packages/core/src/logger', loggerMock)
const broadcasts: Array<Record<string, unknown>> = []
mock.module('../../../src/core/sse', () => ({ broadcast: (data: Record<string, unknown>) => { broadcasts.push(data) } }))
afterAll(() => { delete process.env.BAKIN_HOME; rmSync(testDir, { recursive: true, force: true }) })

import { resetSettingsCache } from '../../../src/core/settings'
import { fingerprintOf } from '../../../src/core/updates/inventory'
import { getUpdatesEngine, getUpdatesTimer, registerUpdateSource, registeredUpdateSources, resetUpdateSources, startUpdates, stopUpdates, UPDATES_FILE_NAME } from '../../../src/core/updates/service'
import type { UpdateSource } from '../../../src/core/updates/types'
import { waitUntil } from '../../helpers/wait'

afterEach(() => { stopUpdates(); resetUpdateSources(); broadcasts.length = 0 })

const source = (kind: UpdateSource['kind'], id: string): UpdateSource => ({
  kind,
  inventory: async () => [{ subject: { kind, id, label: id }, group: 'available', fingerprint: fingerprintOf({ id }), source: { kind: 's', endpoint: `s://${id}` } }],
  observe: async () => ({ installed: { version: '1', display: '1' }, outcome: 'current' }),
})

describe('updates service', () => {
  it('starts one engine over the registered sources (one per kind, last wins), persists under the home, and broadcasts updates.changed', async () => {
    registerUpdateSource(source('plugin', 'first'))
    registerUpdateSource(source('plugin', 'second'))
    registerUpdateSource(source('bakin', 'bakin'))
    expect(registeredUpdateSources().map((s) => s.kind)).toEqual(['plugin', 'bakin'])
    const engine = startUpdates(testDir)
    expect(getUpdatesEngine()).toBe(engine)
    expect(getUpdatesTimer()).not.toBeNull()
    const { records } = await engine.snapshot()
    expect(records.map((r) => r.id)).toEqual(['plugin:second', 'bakin:bakin'])
    expect(existsSync(join(testDir, UPDATES_FILE_NAME))).toBe(true)
    await engine.observe('bakin:bakin')
    expect(broadcasts.at(-1)).toEqual({ type: 'updates.changed', ids: ['bakin:bakin'] })
  })

  it('reads the interval and the enabled flag from settings', async () => {
    writeFileSync(join(testDir, 'settings.json'), JSON.stringify({ updates: { enabled: false, intervalMs: 60 * 60 * 1000 } }))
    resetSettingsCache()
    registerUpdateSource(source('bakin', 'bakin'))
    const engine = startUpdates(testDir)
    await engine.observe('bakin:bakin')
    const schedule = await engine.scheduleFor('bakin:bakin')
    expect(Date.parse(schedule!.nextDueAt!) - Date.parse(schedule!.lastCheckedAt!)).toBe(60 * 60 * 1000)
    rmSync(join(testDir, 'settings.json'))
    resetSettingsCache()
  })

  it('stopUpdates clears the engine and timer; a second start replaces the first', async () => {
    registerUpdateSource(source('bakin', 'bakin'))
    const first = startUpdates(testDir)
    const second = startUpdates(testDir)
    expect(second).not.toBe(first)
    expect(getUpdatesEngine()).toBe(second)
    await waitUntil(() => existsSync(join(testDir, UPDATES_FILE_NAME)), { label: 'file persisted' })
    stopUpdates()
    expect(getUpdatesEngine()).toBeNull()
    expect(getUpdatesTimer()).toBeNull()
  })
})
