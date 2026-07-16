/**
 * agent-sync install() honesty pins (review finding, PR #673): pack-repair
 * failures must degrade the result — an all-targets-failed repair returns
 * status 'failed', and partial pack failures surface in the message instead
 * of being swallowed into a success toast over untouched drift.
 */
import { tmpdir } from 'os'
import { join as pathJoin } from 'path'
import { randomUUID } from 'crypto'

const testDir = pathJoin(tmpdir(), `bakin-test-agent-sync-install-${Date.now()}-${randomUUID()}`)
process.env.OPENCLAW_HOME = pathJoin(testDir, 'openclaw')
process.env.BAKIN_HOME = testDir

import { describe, it, expect, afterAll, mock } from 'bun:test'
import { rmSync } from 'fs'
import { join } from 'path'

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, bin: join(testDir, 'bin'), db: join(testDir, 'bakin.db') }),
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, bin: join(testDir, 'bin'), db: join(testDir, 'bakin.db') }),
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))
mock.module('../../../src/core/app-services', () => ({
  maybeGetAppServices: () => ({ runtime: {} }),
  createAppServices: async () => ({ runtime: {} }),
}))
mock.module('../../../src/core/team-context', () => ({
  refreshRoleContextBlocks: () => {},
}))

// One drifted pack finding; no agents to sync.
const packFinding = { type: 'projection-drift', severity: 'warn', packageId: 'websearch@1.0.0', message: 'skill drifted' }
mock.module('../../../src/core/agent-packages/sync-scanner', () => ({
  scanAgentSync: async () => ({ findings: [packFinding], agentsScanned: 0, blocksOk: 0, projectionsOk: 0 }),
}))
mock.module('../../../packages/core/src/agent-packages/lockfile', () => ({
  readLockfile: () => ({ packages: { 'websearch@1.0.0': { kind: 'skill-pack', version: '1.0.0' } } }),
}))

let repairShouldThrow = true
mock.module('../../../src/core/agent-packages/sync', () => ({
  syncAllAgents: async () => [],
  repairPackLocally: async (packId: string) => {
    if (repairShouldThrow) throw new Error(`Installed source missing for "${packId}"`)
    return { projections: [], skipped: [] }
  },
}))

import { agentSyncComponent } from '../../../src/core/onboarding/agent-sync'
import type { OnboardingOptions } from '../../../src/core/onboarding/types'

const OPTS: OnboardingOptions = { interactive: false, autoApprove: true, json: false, checkOnly: false, force: false }

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('agent-sync install() — pack repair honesty', () => {
  it('returns status failed when every repair target failed', async () => {
    repairShouldThrow = true
    const result = await agentSyncComponent.install!(OPTS)
    expect(result.status).toBe('failed')
    expect(result.message).toContain('websearch@1.0.0')
    expect(result.message).toContain('Installed source missing')
  })

  it('reports repaired packs in the success message when repair works', async () => {
    repairShouldThrow = false
    const result = await agentSyncComponent.install!(OPTS)
    expect(result.status).toBe('installed')
    expect(result.message).toContain('1 pack(s)')
    expect(result.message).not.toContain('failed')
  })
})
