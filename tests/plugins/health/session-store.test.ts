/**
 * `session-store` system check — early warning on runtime session-store
 * growth (#435). Pure-function tests over synthetic adapter stats; no
 * filesystem. Mocks below satisfy the global test-isolation rules even
 * though nothing here should touch storage.
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-health-session-store-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = pathJoin(testDir, 'openclaw')

import { describe, it, expect, afterAll, mock } from 'bun:test'
import { rmSync } from 'fs'

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, db: pathJoin(testDir, 'bakin.db') }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, db: pathJoin(testDir, 'bakin.db') }),
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}))

import {
  checkSessionStore,
  SESSION_STORE_WARN_BYTES,
  SESSION_STORE_ERROR_BYTES,
  SESSION_STORE_ORPHAN_RATIO,
  SESSION_STORE_ORPHAN_MIN_FILES,
} from '../../../plugins/health/lib/system-checks/session-store'
import type { RuntimeSessionStoreStats } from '@bakin/core/adapters/runtime'
import type { HealthCheckRunInput } from '@makinbakin/sdk'
import { parseHealthCheckRunInput } from '../../../src/core/health-contract'

afterAll(() => rmSync(testDir, { recursive: true, force: true }))

const MB = 1024 * 1024

function runtimeWith(stats: RuntimeSessionStoreStats[]) {
  return { sessions: { list: async () => [], get: async () => null, storeStats: async () => stats } }
}

function healthy(agentId: string): RuntimeSessionStoreStats {
  return { agentId, storeEntries: 20, fileCount: 60, diskBytes: 10 * MB }
}

function observed(run: HealthCheckRunInput) {
  const parsed = parseHealthCheckRunInput(run)
  expect(parsed.outcome).toBe('observed')
  if (parsed.outcome !== 'observed') throw new Error(parsed.reason)
  return parsed.observations
}

describe('session-store system check', () => {
  it('returns a single ok summary when all agents are within bounds', async () => {
    const results = observed(await checkSessionStore(runtimeWith([healthy('main'), healthy('scout')])))
    expect(results).toHaveLength(1)
    expect(results[0]?.status).toBe('healthy')
    expect(results[0]?.key).toBe('usage')
  })

  it('warns when an agent dir exceeds the warn byte threshold, rendering adapter remediation verbatim', async () => {
    const results = observed(await checkSessionStore(
      runtimeWith([healthy('scout'), {
        agentId: 'main',
        storeEntries: 50,
        fileCount: 80,
        diskBytes: SESSION_STORE_WARN_BYTES + 1,
        remediation: 'Run `fake-runtime gc --now`.',
      }]),
    ))
    expect(results).toHaveLength(1)
    expect(results[0]?.status).toBe('warning')
    expect(results[0]?.summary).toContain('main')
    // Adapter-owned guidance flows through untouched (R29) — the check has
    // no provider strings of its own.
    expect(results[0]?.incident?.resolution).toMatchObject({
      type: 'instructions',
      steps: ['Run `fake-runtime gc --now`.'],
    })
  })

  it('falls back to neutral remediation when the adapter offers none', async () => {
    const results = observed(await checkSessionStore(
      runtimeWith([{ agentId: 'main', storeEntries: 50, fileCount: 80, diskBytes: SESSION_STORE_WARN_BYTES + 1 }]),
    ))
    expect(results[0]?.incident?.resolution).toMatchObject({
      type: 'instructions',
      steps: [expect.stringContaining("Run the runtime's session cleanup")],
    })
  })

  it('errors when an agent dir exceeds the error byte threshold', async () => {
    const results = observed(await checkSessionStore(
      runtimeWith([{ agentId: 'main', storeEntries: 50, fileCount: 80, diskBytes: SESSION_STORE_ERROR_BYTES + 1 }]),
    ))
    expect(results[0]?.status).toBe('error')
  })

  it('warns on orphaned-artifact buildup (file count far above store entries)', async () => {
    const stats = {
      agentId: 'main',
      storeEntries: 10,
      fileCount: 10 * SESSION_STORE_ORPHAN_RATIO + 1,
      diskBytes: 10 * MB,
    }
    const results = observed(await checkSessionStore(runtimeWith([stats])))
    expect(results[0]?.status).toBe('warning')
    expect(results[0]?.detail).toContain('files per live entry')
  })

  it('suppresses the orphan ratio below the minimum file count', async () => {
    const stats = { agentId: 'tiny', storeEntries: 1, fileCount: SESSION_STORE_ORPHAN_MIN_FILES - 1, diskBytes: MB }
    const results = observed(await checkSessionStore(runtimeWith([stats])))
    expect(results[0]?.status).toBe('healthy')
  })

  it('treats zero store entries as a denominator of one', async () => {
    const stats = { agentId: 'main', storeEntries: 0, fileCount: SESSION_STORE_ORPHAN_MIN_FILES + 1, diskBytes: MB }
    const results = observed(await checkSessionStore(runtimeWith([stats])))
    expect(results[0]?.status).toBe('warning')
  })

  it('reports one result per offending agent', async () => {
    const results = observed(await checkSessionStore(
      runtimeWith([
        { agentId: 'a', storeEntries: 5, fileCount: 10, diskBytes: SESSION_STORE_WARN_BYTES + 1 },
        { agentId: 'b', storeEntries: 5, fileCount: 10, diskBytes: SESSION_STORE_ERROR_BYTES + 1 },
        healthy('c'),
      ]),
    ))
    expect(results).toHaveLength(2)
    expect(results.map((r) => r.status).sort()).toEqual(['error', 'warning'])
  })

  it('returns ok for an empty stats list (no agents with session stores)', async () => {
    const results = observed(await checkSessionStore(runtimeWith([])))
    expect(results).toHaveLength(1)
    expect(results[0]?.status).toBe('healthy')
  })

  it('returns ok when the runtime does not expose storeStats', async () => {
    const result = await checkSessionStore({ sessions: { list: async () => [], get: async () => null } })
    expect(result).toEqual({
      outcome: 'not_applicable',
      reason: expect.stringContaining('does not expose session-store statistics'),
    })
  })

  it('returns a single error result when storeStats throws', async () => {
    const runtime = {
      sessions: {
        list: async () => [],
        get: async () => null,
        storeStats: async (): Promise<RuntimeSessionStoreStats[]> => {
          throw new Error('boom')
        },
      },
    }
    const results = observed(await checkSessionStore(runtime))
    expect(results).toHaveLength(1)
    expect(results[0]?.status).toBe('unknown')
  })
})
