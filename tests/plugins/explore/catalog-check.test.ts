/**
 * GET /api/plugins/explore/catalog — install state is joined with the updates
 * engine's records (#1007): the route never probes a source. The engine is
 * module-mocked with a scripted snapshot; lockfiles are real files under the
 * temp home.
 */
import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { UpdateRecord } from '@makinbakin/sdk/types'
import type { ActivatedPlugin } from '../test-helpers'

const testDir = join(tmpdir(), `bakin-test-explore-check-${Date.now()}`)
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

const SHA_A = 'a'.repeat(40)
const SHA_B = 'b'.repeat(40)

const record = (over: Partial<UpdateRecord> & Pick<UpdateRecord, 'id' | 'outcome'>): UpdateRecord => ({
  group: 'available',
  subject: { kind: over.id.slice(0, over.id.indexOf(':')) as UpdateRecord['subject']['kind'], id: over.id.slice(over.id.indexOf(':') + 1), label: over.id },
  source: { kind: 'fixture', endpoint: 'fixture' },
  fingerprint: 'fp',
  ...over,
})

let records: UpdateRecord[] = []
let engineUp = true
mock.module('../../../src/core/updates/service', () => ({
  getUpdatesEngine: () => (engineUp ? { snapshot: async () => ({ records, generatedAt: 'now', running: false }) } : null),
  getUpdatesTimer: () => null,
}))

import explorePlugin from '../../../plugins/explore'
import { activatePlugin, findRoute, callRoute } from '../test-helpers'
import type { ExploreCatalogEntry } from '../../../plugins/explore/types'

let activated: ActivatedPlugin

beforeAll(async () => {
  mkdirSync(join(testDir, 'plugins'), { recursive: true })
  mkdirSync(join(testDir, 'packages'), { recursive: true })
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
      },
    },
  }))
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
      'jessica@1.0.0': {
        kind: 'agent',
        version: '1.0.0',
        source: 'github:markhayden/bakin-bits-official#agents/jessica',
        ref: 'main',
        commitSha: SHA_A,
        installedAt: '2026-07-01T00:00:00Z',
        agentId: 'jessica',
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

async function catalog(): Promise<ExploreCatalogEntry[]> {
  const route = findRoute(activated.routes, 'GET', '/catalog')
  const { status, body } = await callRoute(route!, activated.ctx)
  expect(status).toBe(200)
  return body.entries as ExploreCatalogEntry[]
}

describe('GET /catalog with the updates engine', () => {
  it('projects each installed entry from its engine record', async () => {
    records = [
      record({ id: 'plugin:messaging', outcome: 'update-available', installed: { version: '1.0.0', display: '1.0.0' }, available: { version: '1.1.0', sha: SHA_B, display: '1.1.0' }, observedAt: 'now' }),
      record({ id: 'package:pixel', outcome: 'current', installed: { version: '1.2.0', display: '1.2.0' }, observedAt: 'now' }),
      record({ id: 'package:jessica', outcome: 'unknown', attempt: { at: 'now', error: 'ls-remote: offline' } }),
    ]
    const entries = await catalog()
    expect(byKey(entries, 'plugin', 'messaging')?.updateAvailable).toBe(true)
    expect(byKey(entries, 'agent', 'pixel')?.updateAvailable).toBe(false)
    // A failed observation stays unknown — never "up to date".
    expect(byKey(entries, 'agent', 'jessica')?.updateAvailable).toBeNull()
  })

  it('a skipped offer is not an update', async () => {
    records = [
      record({ id: 'plugin:messaging', outcome: 'update-available', available: { version: '1.1.0', sha: SHA_B, display: '1.1.0' }, skipped: { version: '1.1.0', sha: SHA_B }, observedAt: 'now' }),
    ]
    const entries = await catalog()
    expect(byKey(entries, 'plugin', 'messaging')?.updateAvailable).toBe(false)
  })

  it('without a record (or a running engine) every installed entry is unknown, uninstalled ones too', async () => {
    records = []
    let entries = await catalog()
    expect(byKey(entries, 'plugin', 'messaging')?.updateAvailable).toBeNull()
    expect(byKey(entries, 'agent', 'pixel')?.updateAvailable).toBeNull()

    engineUp = false
    try {
      entries = await catalog()
      expect(byKey(entries, 'plugin', 'messaging')?.updateAvailable).toBeNull()
      expect(byKey(entries, 'agent', 'pixel')?.installed).toBe(true)
    } finally {
      engineUp = true
    }
  })

  it('no response carries a probe-error count or honours ?check=1 — checks are POST /api/updates/check', async () => {
    records = []
    const route = findRoute(activated.routes, 'GET', '/catalog')
    const { status, body } = await callRoute(route!, activated.ctx, { searchParams: { check: '1' } })
    expect(status).toBe(200)
    expect(body.probeErrors).toBeUndefined()
  })
})
