/**
 * The runtime choice is committed inside the settings OPERATION, which
 * owns install-state (spec §2): two undecided runs that decide differently
 * at the same moment produce one winner and one typed refusal, and the
 * refusal's code reaches the operation outcome a caller reads.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = join(tmpdir(), `bakin-test-settings-commit-${Date.now()}-${randomUUID()}`)
let testDir = join(root, 'initial')
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, root: testDir, db: join(testDir, 'bakin.db'), settings: join(testDir, 'settings.json') }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
const loggerMock = () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) })
mock.module('../../../src/core/logger', loggerMock)
mock.module('../../../packages/core/src/logger', loggerMock)

import { _resetOperationRegistryForTests, getOperationRegistry } from '../../../src/core/operations'
import { componentInstallOperation } from '../../../src/core/onboarding/operation'
import { settingsComponent } from '../../../src/core/onboarding/settings'
import { resetSettingsCache } from '../../../src/core/settings'

const settingsFile = () => join(testDir, 'settings.json')
const storedAdapter = () => (JSON.parse(readFileSync(settingsFile(), 'utf-8')) as { runtime?: { adapter?: string } }).runtime?.adapter
const propose = (runtimeAdapter: string) => componentInstallOperation(settingsComponent, { autoApprove: true, allowServiceClaim: false, runtimeAdapter }, 'cli')

beforeEach(() => {
  testDir = join(root, randomUUID())
  mkdirSync(testDir, { recursive: true })
  resetSettingsCache()
  _resetOperationRegistryForTests()
})
afterEach(() => _resetOperationRegistryForTests())
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('settings operation: committing the runtime choice', () => {
  it('two proposals for different runtimes at once: one commits, the other settles runtime_already_set', async () => {
    const registry = getOperationRegistry()
    const [pi, openclaw] = await Promise.all([registry.start(propose('pi')), registry.start(propose('openclaw'))])
    // Different options are different operations: neither attached to the other.
    expect(pi.operationId).not.toBe(openclaw.operationId)
    const views = await Promise.all([registry.await(pi.operationId), registry.await(openclaw.operationId)])

    const succeeded = views.filter((view) => view.status === 'succeeded')
    const failed = views.filter((view) => view.status === 'failed')
    expect(succeeded).toHaveLength(1)
    expect(failed).toHaveLength(1)
    expect(failed[0]!.outcome?.code).toBe('runtime_already_set')
    // One runtime on disk, and it is the winner's.
    expect(storedAdapter()).toBe(succeeded[0] === views[0] ? 'pi' : 'openclaw')
  })

  it('the runtime is part of the operation identity: the same proposal attaches, a different one never does', async () => {
    const registry = getOperationRegistry()
    const first = await registry.start(propose('pi'))
    const same = await registry.start(propose('pi'))
    const other = await registry.start(propose('openclaw'))
    expect(same.operationId).toBe(first.operationId)
    expect(other.operationId).not.toBe(first.operationId)
    await Promise.all([registry.await(first.operationId), registry.await(other.operationId)])
  })

  it('the settings operation holds install-state for its whole run', async () => {
    const view = await getOperationRegistry().await((await getOperationRegistry().start(propose('pi'))).operationId)
    expect(view.resources).toEqual(['install-state'])
    expect(view.status).toBe('succeeded')
    expect(storedAdapter()).toBe('pi')
  })

  it.each([
    ['settings_untrustworthy', () => { mkdirSync(testDir, { recursive: true }); return Bun.write(settingsFile(), '{ not json') }, 'pi'],
    ['invalid_runtime', async () => {}, 'bogus'],
  ])('a refusal the caller must tell apart settles with its own code: %s', async (code, arrange, proposal) => {
    await arrange()
    const view = await getOperationRegistry().await((await getOperationRegistry().start(propose(proposal))).operationId)
    expect([view.status, view.outcome?.code]).toEqual(['failed', code])
    if (code === 'invalid_runtime') expect(existsSync(settingsFile())).toBe(false)
  })
})
