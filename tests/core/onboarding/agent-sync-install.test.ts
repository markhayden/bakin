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

import { describe, it, expect, afterAll, afterEach, mock } from 'bun:test'
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
const driftReport = { findings: [packFinding], agentsScanned: 0, blocksOk: 0, projectionsOk: 0, migrationNeeded: false }
let scanReport: { findings: Array<Record<string, unknown>>; agentsScanned: number; blocksOk: number; projectionsOk: number; migrationNeeded: boolean } = driftReport
mock.module('../../../src/core/agent-packages/sync-scanner', () => ({
  scanAgentSync: async () => scanReport,
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
import type { ComponentInstallOptions } from '../../../src/core/onboarding/types'
import { installInOperation } from '../../helpers/operation-harness'

const OPTS: ComponentInstallOptions = { autoApprove: true, allowServiceClaim: false }

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

describe('agent-sync install() — pack repair honesty', () => {
  it('returns status failed when every repair target failed', async () => {
    repairShouldThrow = true
    const result = await installInOperation(agentSyncComponent, OPTS)
    expect(result.status).toBe('failed')
    expect(result.message).toContain('websearch@1.0.0')
    expect(result.message).toContain('Installed source missing')
  })

  it('reports repaired packs in the success message when repair works', async () => {
    repairShouldThrow = false
    const result = await installInOperation(agentSyncComponent, OPTS)
    expect(result.status).toBe('installed')
    expect(result.message).toContain('1 pack(s)')
    expect(result.message).not.toContain('failed')
  })
})

describe('agent-sync check() — what onboarding may repair on its own', () => {
  afterEach(() => { scanReport = driftReport })

  it('drift the local sync clears is a repairable warning', async () => {
    const check = await agentSyncComponent.check()
    expect(check.status).toBe('warn')
    expect(check.repairable).toBe(true)
  })

  it('the one-time block migration is confirmed by a person, never repaired implicitly', async () => {
    scanReport = { ...driftReport, migrationNeeded: true }
    const check = await agentSyncComponent.check()
    expect(check.status).toBe('warn')
    expect(check.repairable).toBeUndefined()
  })

  it('an error finding is an error, not something to repair in passing', async () => {
    scanReport = { ...driftReport, findings: [{ ...packFinding, severity: 'error' }] }
    const check = await agentSyncComponent.check()
    expect(check.status).toBe('error')
    expect(check.repairable).toBeUndefined()
  })
})
