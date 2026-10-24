/**
 * Self-healing PR1 slice 1.3b (plugins half): the plugin-assets and
 * plugin-registry incidents repointed at `plugin-upgrade` (when the updates
 * engine offers a release) or `plugin-reinstall` (re-homing rows 93, 94, 101)
 * under the old contract. The artifact check's own repointing is pinned in
 * plugin-artifacts.test.ts; the actions themselves in plugin-upgrade-repair.test.ts.
 */
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-plugin-incidents-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')

import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'

const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }), isUsingBakinHome: () => true })
mock.module('../../../../src/core/content-dir', contentDirMock)
mock.module('../../../../packages/core/src/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
const loggerMock = () => ({ createLogger: () => ({ debug: mock(), info: mock(), warn: mock(), error: mock() }) })
mock.module('../../../../src/core/logger', loggerMock)
mock.module('../../../../packages/core/src/logger', loggerMock)

type Scan = { missing?: unknown[]; drifted?: unknown[]; userEditedDrifted?: Array<{ name: string; pluginId: string }>; invalidSource?: Array<{ name: string; pluginId: string }>; bins?: { missing?: unknown[]; drifted?: unknown[]; unsupported?: unknown[]; invalid?: Array<{ pluginId: string; reason: string }> } }
let scan: Scan = {}
const applies: Array<Record<string, unknown> | undefined> = []
mock.module('../../../../src/core/onboarding/plugin-assets', () => ({
  PLUGIN_ASSETS_PLAN: { stages: [{ id: 'skills', kind: 'installing', label: 'Install' }, { id: 'bins', kind: 'installing', label: 'Bins' }], pointOfNoReturn: 'skills' },
  applyPluginAssets: async (_op: unknown, opts?: { restoreUserEdited?: string[] }) => { applies.push(opts); return { name: 'plugin-assets', status: 'installed', message: 'installed', durationMs: 1, restored: opts?.restoreUserEdited ?? [] } },
  pluginAssetsComponent: { check: async () => ({ status: 'warn', message: 'plugin assets differ', remediation: 'see details', details: scan }) },
}))
let registry: Array<Record<string, unknown>> = []
mock.module('../../../../plugins/health/lib/host-providers', () => ({ getRegistrySnapshot: () => registry }))

import type { UpdateRecord } from '@makinbakin/sdk/types'
import { noopOp } from '../../../helpers/operation-harness'
import { stampPlanItems } from '../../../helpers/repair-contract'
import { checkPluginAssets, installPluginAssetsRepair } from '../../../../plugins/health/lib/system-checks/plugin-assets'
import { checkPluginRegistry } from '../../../../plugins/health/lib/system-checks/plugin-registry'
import type { PluginArtifactDeps } from '../../../../plugins/health/lib/system-checks/plugin-artifacts'
import { parseHealthCheckRunInput } from '../../../../src/core/health-contract'

function lock(ids: string[], over: Record<string, unknown> = {}): void {
  mkdirSync(join(testDir, 'plugins'), { recursive: true })
  writeFileSync(join(testDir, 'plugins', 'lock.json'), JSON.stringify({
    version: 1,
    plugins: Object.fromEntries(ids.map((id) => [id, { source: `github:markhayden/bakin-bits-official#plugins/${id}`, type: 'github', ref: 'main', commitSha: 'a'.repeat(40), installedAt: '2026-10-01T00:00:00.000Z', version: '1.0.0', permissions: [], manifestSha: 'c'.repeat(64), ...over }])),
  }))
}
const record = (pluginId: string, version: string | null): UpdateRecord => ({
  id: `plugin:${pluginId}`, group: 'available', subject: { kind: 'plugin', id: pluginId, label: pluginId },
  source: { kind: 'artifact-index', endpoint: 'https://example.test/index.json' }, fingerprint: 'fp', observedAt: '2026-10-19T12:00:00.000Z', attempt: { at: '2026-10-19T12:00:00.000Z' },
  ...(version ? { outcome: 'update-available', installed: { version: '1.0.0', display: '1.0.0' }, available: { version, display: version }, reason: 'newer-version' } : { outcome: 'blocked', blockedReason: 'no published release runs on this Bakin yet' }),
} as UpdateRecord)
/** The engine's verdict per plugin: a version on offer, blocked, or no record at all. */
const offers = (byPlugin: Record<string, string | null>): PluginArtifactDeps => ({
  record: async (pluginId) => (pluginId in byPlugin ? record(pluginId, byPlugin[pluginId]!) : undefined),
})
const none: PluginArtifactDeps = { record: async () => undefined }

async function observed(run: Promise<unknown>) {
  const parsed = parseHealthCheckRunInput(await run as never)
  if (parsed.outcome !== 'observed') throw new Error(parsed.reason)
  return parsed.observations
}

afterAll(() => rmSync(testDir, { recursive: true, force: true }))
beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true }); mkdirSync(testDir, { recursive: true })
  scan = {}; registry = []; applies.length = 0
})

describe('plugin-assets incidents (rows 93–94)', () => {
  it('an invalid bin declaration becomes the plugin-upgrade repair when the engine offers a release, labelled with the version', async () => {
    lock(['terminal'])
    scan = { bins: { invalid: [{ pluginId: 'terminal', reason: 'extractedSha256 required' }] } }
    const [row] = await observed(checkPluginAssets(offers({ terminal: '0.4.0' })))
    expect(row!.incident).toMatchObject({ key: 'plugin-bins-invalid', disposition: 'action_required', resolution: { type: 'repair', actionId: 'plugin-upgrade', label: 'Upgrade terminal to 0.4.0' } })
    expect(row!.incident?.resources).toEqual([{ kind: 'plugin', id: 'terminal', label: 'terminal' }])
  })
  it('with no offer (blocked, no record, or a linked plugin) it is the plugin-reinstall repair', async () => {
    lock(['terminal'])
    scan = { bins: { invalid: [{ pluginId: 'terminal', reason: 'x' }] } }
    expect((await observed(checkPluginAssets(offers({ terminal: null }))))[0]!.incident?.resolution).toMatchObject({ type: 'repair', actionId: 'plugin-reinstall', label: 'Reinstall terminal' })
    expect((await observed(checkPluginAssets(none)))[0]!.incident?.resolution).toMatchObject({ type: 'repair', actionId: 'plugin-reinstall' })
    lock(['terminal'], { linkedSource: '/dev/terminal' })
    expect((await observed(checkPluginAssets(offers({ terminal: '0.4.0' }))))[0]!.incident?.resolution).toMatchObject({ type: 'repair', actionId: 'plugin-reinstall' })
  })
  it('a skill that is not text points at plugin-reinstall; a user-edited skill points at the install repair whose Restore item is the decision (Keep = acknowledge)', async () => {
    lock(['sdr'])
    scan = { userEditedDrifted: [], invalidSource: [{ pluginId: 'sdr', name: 'blobby' }] }
    expect((await observed(checkPluginAssets(none)))[0]!.incident).toMatchObject({ key: 'skill-source-invalid', resolution: { type: 'repair', actionId: 'plugin-reinstall' } })
    scan = { userEditedDrifted: [{ pluginId: 'sdr', name: 'mine' }], invalidSource: [] }
    expect((await observed(checkPluginAssets(none)))[0]!.incident).toMatchObject({ key: 'user-edited-drifted', resolution: { type: 'repair', actionId: 'install-plugin-assets', label: 'Restore the shipped copies' } })
  })

  it('the install repair offers a one-click Restore item (it replaces your edit) per drifted user-edited skill only for a targeted row — never under all-actionable; apply releases exactly those', async () => {
    scan = { userEditedDrifted: [{ pluginId: 'sdr', name: 'mine' }, { pluginId: 'sdr', name: 'other' }], invalidSource: [] }
    const action = installPluginAssetsRepair()
    const all = await action.plan({ type: 'all_actionable', reportId: 'r' })
    expect(all.map((item) => item.id)).toEqual(['install-plugin-assets'])
    const targeted = await action.plan({ type: 'incidents', reportId: 'r', ids: ['health.plugin-assets:user-edited-drifted'] })
    expect(targeted.map((item) => [item.id, item.effects?.deletesUserContent ?? false])).toEqual([['install-plugin-assets', false], ['restore:mine', true], ['restore:other', true]])
    const results = await action.apply(stampPlanItems(action, targeted.filter((item) => item.id === 'restore:mine')), noopOp())
    expect(applies).toEqual([{ restoreUserEdited: ['mine'] }])
    expect(results[0]).toMatchObject({ itemId: 'restore:mine', status: 'applied' })
    expect(results[0]!.message).toContain('restored')
  })
})

describe('plugin-registry activation-failed (row 101)', () => {
  it('points at plugin-upgrade when the engine offers a release for that plugin', async () => {
    lock(['notes'])
    registry = [{ id: 'notes', status: 'failed', errorCode: 'activation_failed', errorMessage: 'boom' }]
    const [row] = await observed(checkPluginRegistry(offers({ notes: '2.0.0' })))
    expect(row!.incident).toMatchObject({ key: 'activation-failed:notes', resolution: { type: 'repair', actionId: 'plugin-upgrade', label: 'Upgrade notes to 2.0.0' } })
  })
  it('hands the activation failure to the fallback lane without an offer (core.diagnose, row 101)', async () => {
    lock(['notes'])
    registry = [{ id: 'notes', status: 'failed', errorCode: 'activation_failed', errorMessage: 'boom' }]
    const [row] = await observed(checkPluginRegistry(none))
    expect(row!.incident).toMatchObject({ key: 'activation-failed:notes', declarationId: 'activation-failed', subject: { kind: 'plugin', id: 'notes' }, resolution: { type: 'repair', actionId: 'core.diagnose' } })
  })
})
