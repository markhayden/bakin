/**
 * GET /api/plugins/explore/catalog?check=1 — update probes are module-
 * mocked (the real ones hit git/network); plugin markers re-read from the
 * lockfile, agent probe results folded into the response only.
 */
import { describe, it, expect, beforeAll, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
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

const runChecksMock = mock(async (ids: readonly string[]) => {
  // Simulate the real behavior: persist a fresh remote marker for messaging.
  expect(ids).toEqual(['messaging'])
  const lockPath = join(testDir, 'plugins', 'lock.json')
  const lock = JSON.parse(require('fs').readFileSync(lockPath, 'utf-8'))
  lock.plugins.messaging.remoteHeadSha = SHA_B
  writeFileSync(lockPath, JSON.stringify(lock))
  return []
})
mock.module('../../../src/core/plugins/upgrade-check', () => ({
  runChecks: runChecksMock,
}))

const checkPackageUpdateMock = mock((packageId: string) => {
  if (packageId === 'pixel@1.2.0') {
    return { currentVersion: '1.2.0', latestVersion: '2.0.0', currentCommitSha: SHA_A, latestCommitSha: SHA_B, upgradeAvailable: true, checkedAt: 'now' }
  }
  throw new Error(`unexpected probe for ${packageId}`)
})
mock.module('../../../src/core/agent-packages/checker', () => ({
  checkPackageUpdate: checkPackageUpdateMock,
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
        // No probe markers yet — base GET reports no update.
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
    },
  }))

  activated = await activatePlugin(explorePlugin, testDir)
})

afterAll(() => rmSync(testDir, { recursive: true, force: true }))

function byKey(entries: ExploreCatalogEntry[], kind: string, id: string): ExploreCatalogEntry | undefined {
  return entries.find((entry) => entry.kind === kind && entry.id === id)
}

describe('GET /catalog?check=1', () => {
  it('base GET runs no probes and reports unknown/none', async () => {
    const route = findRoute(activated.routes, 'GET', '/catalog')
    const { body } = await callRoute(route!, activated.ctx)
    const entries = body.entries as ExploreCatalogEntry[]
    expect(byKey(entries, 'plugin', 'messaging')?.updateAvailable).toBe(false)
    expect(byKey(entries, 'agent', 'pixel')?.updateAvailable).toBeNull()
    expect(runChecksMock).not.toHaveBeenCalled()
    expect(checkPackageUpdateMock).not.toHaveBeenCalled()
  })

  it('check=1 probes plugins (persisted) and agents (response-only)', async () => {
    const route = findRoute(activated.routes, 'GET', '/catalog')
    const { status, body } = await callRoute(route!, activated.ctx, { searchParams: { check: '1' } })
    expect(status).toBe(200)
    const entries = body.entries as ExploreCatalogEntry[]

    expect(runChecksMock).toHaveBeenCalled()
    expect(checkPackageUpdateMock).toHaveBeenCalledWith('pixel@1.2.0')
    // Plugin marker was persisted by the (mocked) probe and re-read
    expect(byKey(entries, 'plugin', 'messaging')?.updateAvailable).toBe(true)
    // Agent probe result folded into the response
    expect(byKey(entries, 'agent', 'pixel')?.updateAvailable).toBe(true)
  })
})
