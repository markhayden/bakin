/**
 * Pure install-state join tests: catalog entries × lockfiles.
 */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-explore-join-${Date.now()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = `${testDir}-openclaw`

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

import { joinInstallState } from '../../../plugins/explore/lib/install-state'
import type { CatalogEntry } from '../../../src/core/curated-catalog/schema'
import type { InstallStateSources } from '../../../plugins/explore/lib/install-state'

const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)

const entry = (overrides: Partial<CatalogEntry> & Pick<CatalogEntry, 'id' | 'kind'>): CatalogEntry => ({
  name: overrides.id,
  description: 'x',
  category: 'Test',
  tags: [],
  useCases: [],
  ref: null,
  trust: 'official',
  builtin: false,
  dependencies: [],
  defaultSelected: false,
  screenshots: [],
  source: overrides.builtin ? undefined : `github:markhayden/bakin-bits-official#x/${overrides.id}`,
  ...overrides,
})

const sources = (over: Partial<InstallStateSources> = {}): InstallStateSources => ({
  pluginLock: { version: 1, plugins: {} },
  packageLock: { version: 1, packages: {} },
  installedPluginDirs: new Set<string>(),
  ...over,
})

const pluginEntry = (over: Record<string, unknown> = {}) => ({
  type: 'github' as const,
  source: 'github:markhayden/bakin-bits-official#plugins/messaging',
  ref: 'main',
  commitSha: SHA_A,
  version: '1.0.0',
  permissions: [],
  manifestSha: 'sha',
  installedAt: '2026-07-01T00:00:00Z',
  ...over,
})

describe('joinInstallState', () => {
  it('builtin entries are always installed with unknown update state', () => {
    const [joined] = joinInstallState([entry({ id: 'team', kind: 'plugin', builtin: true })], sources())
    expect(joined).toMatchObject({ installed: true, updateAvailable: null, installedVersion: null })
  })

  it('agents join against agent-kind lockfile entries by agentId', () => {
    const src = sources({
      packageLock: {
        version: 1,
        packages: {
          'pixel@1.2.0': {
            kind: 'agent', version: '1.2.0', source: 'github:x#agents/pixel',
            ref: 'main', commitSha: SHA_A, installedAt: 'now', agentId: 'pixel', state: 'managed',
          },
        },
      } as InstallStateSources['packageLock'],
    })
    const [installed, absent] = joinInstallState(
      [entry({ id: 'pixel', kind: 'agent' }), entry({ id: 'rolo', kind: 'agent' })],
      src,
    )
    expect(installed).toMatchObject({ installed: true, installedVersion: '1.2.0', updateAvailable: null })
    expect(absent).toMatchObject({ installed: false, installedVersion: null, updateAvailable: null })
  })

  it('plugins report persisted-marker update availability', () => {
    const src = sources({
      pluginLock: {
        version: 1,
        plugins: {
          fresh: pluginEntry({ remoteHeadSha: SHA_A }),
          stale: pluginEntry({ remoteHeadSha: SHA_B }),
        },
      } as InstallStateSources['pluginLock'],
    })
    const [fresh, stale, absent] = joinInstallState(
      [
        entry({ id: 'fresh', kind: 'plugin' }),
        entry({ id: 'stale', kind: 'plugin' }),
        entry({ id: 'absent', kind: 'plugin' }),
      ],
      src,
    )
    expect(fresh).toMatchObject({ installed: true, updateAvailable: false, installedVersion: '1.0.0' })
    expect(stale).toMatchObject({ installed: true, updateAvailable: true })
    expect(absent).toMatchObject({ installed: false, updateAvailable: null })
  })

  it('a plugin directory without a lock entry still counts as installed', () => {
    // Pre-lockfile installs / seeded dev homes: dir exists, no ledger row.
    const src = sources({ installedPluginDirs: new Set(['messaging']) })
    const [messaging] = joinInstallState([entry({ id: 'messaging', kind: 'plugin' })], src)
    expect(messaging).toMatchObject({ installed: true, updateAvailable: null, installedVersion: null })
  })

  it('packs match lockfile keys of the form id or id@version', () => {
    const src = sources({
      packageLock: {
        version: 1,
        packages: {
          'writing-skills@2.0.0': {
            kind: 'skill-pack', version: '2.0.0', source: 'github:x#packs/writing-skills',
            ref: 'main', commitSha: SHA_A, installedAt: 'now',
          },
        },
      } as InstallStateSources['packageLock'],
    })
    const [installed, absent] = joinInstallState(
      [entry({ id: 'writing-skills', kind: 'skill-pack' }), entry({ id: 'other', kind: 'lesson-pack' })],
      src,
    )
    expect(installed).toMatchObject({ installed: true, installedVersion: '2.0.0' })
    expect(absent).toMatchObject({ installed: false })
  })

  it('pack matching never crosses kinds', () => {
    const src = sources({
      packageLock: {
        version: 1,
        packages: {
          'shared-name@1.0.0': {
            kind: 'workflow-pack', version: '1.0.0', source: 'github:x#packs/shared-name',
            ref: 'main', commitSha: SHA_A, installedAt: 'now',
          },
        },
      } as InstallStateSources['packageLock'],
    })
    const [lessonPack] = joinInstallState([entry({ id: 'shared-name', kind: 'lesson-pack' })], src)
    expect(lessonPack.installed).toBe(false)
  })
})
