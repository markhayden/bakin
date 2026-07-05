/**
 * GET /api/plugins/explore/catalog — end-to-end route test with real
 * lockfiles and a real cached-remote catalog in a temp content dir.
 */
import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { ActivatedPlugin } from '../test-helpers'

const testDir = join(tmpdir(), `bakin-test-explore-catalog-${Date.now()}`)
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
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))
mock.module('../../../src/core/watcher', () => ({
  startWatcher: () => {},
  stopWatcher: () => {},
}))

import explorePlugin from '../../../plugins/explore'
import { activatePlugin, findRoute, callRoute } from '../test-helpers'
import type { ExploreCatalogEntry } from '../../../plugins/explore/types'

const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)

let activated: ActivatedPlugin

beforeAll(async () => {
  mkdirSync(join(testDir, 'plugins'), { recursive: true })
  mkdirSync(join(testDir, 'packages'), { recursive: true })

  // Plugin lockfile: messaging installed with a stale remote head → update available.
  writeFileSync(join(testDir, 'plugins', 'lock.json'), JSON.stringify({
    version: 1,
    plugins: {
      messaging: {
        type: 'github',
        source: 'github:markhayden/bakin-bits-official#plugins/messaging',
        ref: 'main',
        commitSha: SHA_A,
        version: '1.0.0',
        permissions: [],
        manifestSha: 'sha',
        installedAt: '2026-07-01T00:00:00Z',
        remoteHeadSha: SHA_B,
      },
    },
  }))

  // Agent-package lockfile: pixel managed.
  writeFileSync(join(testDir, 'packages', 'lock.json'), JSON.stringify({
    version: 1,
    packages: {
      'pixel@1.2.0': {
        kind: 'agent',
        version: '1.2.0',
        source: 'github:markhayden/bakin-bits-official#agents/pixel',
        ref: 'main',
        commitSha: SHA_A,
        installedAt: '2026-07-01T00:00:00Z',
        agentId: 'pixel',
        state: 'managed',
      },
    },
  }))

  activated = await activatePlugin(explorePlugin, testDir)
})

afterAll(() => rmSync(testDir, { recursive: true, force: true }))

function byKey(entries: ExploreCatalogEntry[], kind: string, id: string): ExploreCatalogEntry | undefined {
  return entries.find((entry) => entry.kind === kind && entry.id === id)
}

describe('GET /api/plugins/explore/catalog', () => {
  it('returns the joined catalog with correct install states', async () => {
    const route = findRoute(activated.routes, 'GET', '/catalog')
    expect(route).toBeDefined()
    const { status, body } = await callRoute(route!, activated.ctx)

    expect(status).toBe(200)
    expect(body.ok).toBe(true)
    const entries = body.entries as ExploreCatalogEntry[]

    // Managed agent
    expect(byKey(entries, 'agent', 'pixel')).toMatchObject({
      installed: true,
      installedVersion: '1.2.0',
      updateAvailable: null,
    })
    // Absent agent
    expect(byKey(entries, 'agent', 'rolo')).toMatchObject({ installed: false })
    // Installed plugin with persisted stale-head marker
    expect(byKey(entries, 'plugin', 'messaging')).toMatchObject({
      installed: true,
      updateAvailable: true,
      installedVersion: '1.0.0',
    })
    // Absent installable plugin
    expect(byKey(entries, 'plugin', 'projects')).toMatchObject({ installed: false })
    // Builtin core plugin
    expect(byKey(entries, 'plugin', 'team')).toMatchObject({
      installed: true,
      builtin: true,
      updateAvailable: null,
    })
    expect(body.remoteUpdatedAt).toBeNull()
  })

  it('merges a cached remote catalog — remote wins for non-builtin, builtin stays embedded', async () => {
    mkdirSync(join(testDir, 'plugin-data', 'explore'), { recursive: true })
    writeFileSync(join(testDir, 'plugin-data', 'explore', 'catalog.json'), JSON.stringify({
      version: 2,
      updatedAt: '2026-08-01T00:00:00Z',
      entries: [
        {
          id: 'pixel', kind: 'agent', name: 'Pixel Remixed', description: 'remote wins',
          category: 'Creative', source: 'github:markhayden/bakin-bits-official#agents/pixel',
          trust: 'official',
        },
        {
          id: 'new-agent', kind: 'agent', name: 'Newbie', description: 'fresh from remote',
          category: 'Research', source: 'github:markhayden/bakin-bits-official#agents/new-agent',
          trust: 'official',
        },
        {
          id: 'team', kind: 'plugin', name: 'Hijacked Team', description: 'must not override builtin',
          category: 'Platform', source: 'github:evil/repo#plugins/team', trust: 'official',
        },
      ],
    }))

    const route = findRoute(activated.routes, 'GET', '/catalog')
    const { body } = await callRoute(route!, activated.ctx)
    const entries = body.entries as ExploreCatalogEntry[]

    expect(byKey(entries, 'agent', 'pixel')?.name).toBe('Pixel Remixed')
    expect(byKey(entries, 'agent', 'pixel')?.installed).toBe(true)
    expect(byKey(entries, 'agent', 'new-agent')).toMatchObject({ installed: false })
    expect(byKey(entries, 'plugin', 'team')?.name).toBe('Team')
    expect(body.remoteUpdatedAt).toBe('2026-08-01T00:00:00Z')
  })

  it('ignores an invalid cached remote catalog', async () => {
    writeFileSync(join(testDir, 'plugin-data', 'explore', 'catalog.json'), '{ nope')
    const route = findRoute(activated.routes, 'GET', '/catalog')
    const { status, body } = await callRoute(route!, activated.ctx)
    expect(status).toBe(200)
    expect(body.remoteUpdatedAt).toBeNull()
    expect((body.entries as ExploreCatalogEntry[]).length).toBeGreaterThan(0)
  })
})
