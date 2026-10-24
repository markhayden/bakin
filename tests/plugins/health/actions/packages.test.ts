/**
 * Self-healing PR1 slice 1.3b (packages half): the `package-sync` and
 * `package-reinstall` repair actions wrapping the ONE pack sync engine, and
 * the capabilities check repointed at them under the old contract
 * (re-homing row 6: skill/npm/model legs → sync; bin missing/drifted or an
 * invalid installed manifest → reinstall; secrets/prereqs stay human;
 * platform-only stays an observation).
 */
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-package-actions-${Date.now()}-${randomUUID()}`)
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')

import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'

const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db'), bin: join(testDir, 'bin') }) })
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

import type { CapabilityReadiness } from '../../../../src/core/agent-packages/capability-readiness'

// The ONE readiness engine, faked per test; the check and the actions both read it.
let capabilities: CapabilityReadiness[] = []
mock.module('../../../../src/core/agent-packages/capability-readiness', () => ({
  listCapabilities: async () => capabilities,
}))

// The ONE pack sync engine, faked: records how it was asked.
const syncs: Array<{ packageId: string; reinstall?: boolean; check?: boolean; hasOp: boolean }> = []
let syncChanged = true
let syncFails = false
mock.module('../../../../src/core/agent-packages/sync', () => ({
  syncPack: async (packageId: string, opts: { reinstall?: boolean; check?: boolean; op?: unknown }) => {
    syncs.push({ packageId, reinstall: opts.reinstall, check: opts.check, hasOp: Boolean(opts.op) })
    if (syncFails) throw new Error('upstream unreachable')
    return { packageId, kind: 'skill-pack', syncedAt: 'now', checkOnly: false, versionBefore: '1.0.0', versionAfter: '1.0.0', commitBefore: 'a'.repeat(40), commitAfter: 'a'.repeat(40), changed: syncChanged }
  },
}))
let reloads = 0
mock.module('../../../../src/core/agent-packages/post-sync-reload', () => ({
  reloadAgentPackageRegistries: async () => { reloads++ },
}))

import type { HealthRepairTarget } from '@makinbakin/sdk'
import { noopOp } from '../../../helpers/operation-harness'
import { expectRepairContract, runRepairContract } from '../../../helpers/repair-contract'
import { capabilityRemedy as realRemedy } from '../../../../src/core/agent-packages/capability-remedy'
import { packageReinstallRepair, packageSyncRepair } from '../../../../plugins/health/lib/system-checks/package-repairs'
import { checkCapabilities } from '../../../../plugins/health/lib/system-checks/capabilities'
import { parseHealthCheckRunInput } from '../../../../src/core/health-contract'

function cap(over: Partial<CapabilityReadiness> & Pick<CapabilityReadiness, 'capability' | 'packageId'>): CapabilityReadiness {
  return {
    version: '1.0.0', name: over.capability, description: '', skills: [], bins: [], npm: [], models: [], prereqs: [], secrets: [],
    platformSupported: true, manifestValid: true, ready: false, missing: ['something'], ...over,
  }
}
const all: HealthRepairTarget = { type: 'all_actionable', reportId: 'report-test' }

afterAll(() => rmSync(testDir, { recursive: true, force: true }))
beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true }); mkdirSync(testDir, { recursive: true })
  capabilities = []; syncs.length = 0; syncChanged = true; syncFails = false; reloads = 0
})

describe('capabilityRemedy (the ONE classification the check and the actions share)', () => {
  it('bins missing or drifted, or an invalid installed manifest, want a reinstall of the recorded pack', () => {
    expect(realRemedy(cap({ capability: 'ocr', packageId: 'ocr', bins: [{ name: 'tesseract', status: 'missing' }] }))).toBe('package-reinstall')
    expect(realRemedy(cap({ capability: 'ocr', packageId: 'ocr', bins: [{ name: 'tesseract', status: 'drifted' }] }))).toBe('package-reinstall')
    expect(realRemedy(cap({ capability: 'ocr', packageId: 'ocr', manifestValid: false }))).toBe('package-reinstall')
  })
  it('skills, npm payloads and models want a sync; a reinstall need outranks it', () => {
    expect(realRemedy(cap({ capability: 'web', packageId: 'web', skills: [{ name: 'web-search', status: 'missing' }] }))).toBe('package-sync')
    expect(realRemedy(cap({ capability: 'web', packageId: 'web', npm: [{ name: 'pdfjs', status: 'unresolved' }] }))).toBe('package-sync')
    expect(realRemedy(cap({ capability: 'web', packageId: 'web', models: [{ name: 'whisper', bytes: 1, status: 'missing' }] }))).toBe('package-sync')
    expect(realRemedy(cap({ capability: 'web', packageId: 'web', skills: [{ name: 'x', status: 'missing' }], bins: [{ name: 'b', status: 'missing' }] }))).toBe('package-reinstall')
  })
  it('a missing required secret or prereq is a human need; an unsupported platform is an observation; ready is nothing', () => {
    expect(realRemedy(cap({ capability: 'web', packageId: 'web', secrets: [{ name: 'KEY', required: true, status: 'missing' }] }))).toBe('human')
    expect(realRemedy(cap({ capability: 'web', packageId: 'web', prereqs: [{ name: 'ffmpeg', kind: 'binary', help: 'https://x', optional: false, status: 'missing' }] }))).toBe('human')
    expect(realRemedy(cap({ capability: 'web', packageId: 'web', prereqs: [{ name: 'ffmpeg', kind: 'binary', help: 'https://x', optional: true, status: 'missing' }] }))).toBe('observation')
    expect(realRemedy(cap({ capability: 'web', packageId: 'web', platformSupported: false }))).toBe('observation')
    expect(realRemedy(cap({ capability: 'web', packageId: 'web', bins: [{ name: 'b', status: 'unsupported-platform' }] }))).toBe('observation')
    expect(realRemedy(cap({ capability: 'web', packageId: 'web', ready: true, missing: [] }))).toBeNull()
  })
})

describe('checkCapabilities — repointed under the old contract', () => {
  const observed = async () => {
    const parsed = parseHealthCheckRunInput(await checkCapabilities())
    if (parsed.outcome !== 'observed') throw new Error(parsed.reason)
    return parsed.observations
  }
  it('a machine-fixable leg points the incident at the matching repair, naming the pack', async () => {
    capabilities = [
      cap({ capability: 'ocr', packageId: 'ocr-pack', bins: [{ name: 'tesseract', status: 'drifted' }] }),
      cap({ capability: 'web-search', packageId: 'web-pack', skills: [{ name: 'web-search', status: 'missing' }] }),
    ]
    const rows = await observed()
    expect(rows[0]!.incident).toMatchObject({ key: 'not-ready:ocr', disposition: 'action_required', resolution: { type: 'repair', actionId: 'package-reinstall' } })
    expect(rows[1]!.incident).toMatchObject({ key: 'not-ready:web-search', resolution: { type: 'repair', actionId: 'package-sync' } })
    expect(rows[0]!.incident?.resources).toEqual([{ kind: 'capability', id: 'ocr', label: 'ocr' }])
    expect(rows[0]!.evidence).toMatchObject({ packageId: 'ocr-pack', remedy: 'package-reinstall' })
  })
  it('a human need keeps the Explore navigate; a platform-only gap keeps its incident too (observation rows move in 1.7)', async () => {
    capabilities = [
      cap({ capability: 'notion', packageId: 'notion-pack', secrets: [{ name: 'NOTION_KEY', required: true, status: 'missing' }] }),
      cap({ capability: 'arm-only', packageId: 'arm-pack', platformSupported: false }),
    ]
    const rows = await observed()
    expect(rows[0]!.incident?.resolution).toMatchObject({ type: 'navigate', href: expect.stringContaining('capability=notion') })
    expect(rows[1]!.incident?.resolution).toMatchObject({ type: 'navigate' })
  })
})

describe('package-sync / package-reinstall', () => {
  it('reinstall plans one manual item per not-ready pack whose legs want a reinstall, and applies through syncPack(reinstall) under the operation', async () => {
    capabilities = [
      cap({ capability: 'ocr', packageId: 'ocr-pack', bins: [{ name: 'tesseract', status: 'missing' }] }),
      cap({ capability: 'web-search', packageId: 'web-pack', skills: [{ name: 'web-search', status: 'missing' }] }),
      cap({ capability: 'fine', packageId: 'fine-pack', ready: true, missing: [] }),
    ]
    const action = packageReinstallRepair()
    expect(action.resources).toEqual(['install-state'])
    const plan = await action.plan(all)
    expect(plan).toHaveLength(1)
    expect(plan[0]).toMatchObject({ id: 'ocr-pack', actionId: 'package-reinstall', safety: 'manual' })
    expect(plan[0]!.changes[0]).toMatchObject({ kind: 'file', target: 'package:ocr-pack@1.0.0', action: 'update' })

    const run = await runRepairContract(action, plan)
    expectRepairContract(action, run)
    expect(syncs).toEqual([{ packageId: 'ocr-pack', reinstall: true, check: undefined, hasOp: false }])
    expect(reloads).toBe(1)
    expect(run.results[0]).toMatchObject({ itemId: 'ocr-pack', status: 'applied', affectedCheckIds: ['health.capabilities'] })
  })

  it('sync plans the sync-shaped packs; a targeted incident plans only its pack; an unchanged sync still reports applied without a reload', async () => {
    capabilities = [
      cap({ capability: 'web-search', packageId: 'web-pack', skills: [{ name: 'web-search', status: 'missing' }] }),
      cap({ capability: 'pdf', packageId: 'pdf-pack', npm: [{ name: 'pdfjs', status: 'missing' }] }),
    ]
    const action = packageSyncRepair()
    expect((await action.plan(all)).map((item) => item.id)).toEqual(['web-pack', 'pdf-pack'])
    const one = await action.plan({ type: 'incidents', reportId: 'report-test', ids: ['health.capabilities:not-ready:pdf'] })
    expect(one.map((item) => item.id)).toEqual(['pdf-pack'])
    const byObservation = await action.plan({ type: 'observations', reportId: 'report-test', ids: ['health.capabilities:web-search'] })
    expect(byObservation.map((item) => item.id)).toEqual(['web-pack'])

    syncChanged = false
    const [result] = await action.apply(one, noopOp())
    expect(syncs).toEqual([{ packageId: 'pdf-pack', reinstall: undefined, check: undefined, hasOp: false }])
    expect(reloads).toBe(0)
    expect(result).toMatchObject({ status: 'applied' })
  })

  it('a failed sync reports failed with the engine message and leaves the other packs to run', async () => {
    capabilities = [
      cap({ capability: 'a', packageId: 'a-pack', skills: [{ name: 'a', status: 'missing' }] }),
      cap({ capability: 'b', packageId: 'b-pack', skills: [{ name: 'b', status: 'missing' }] }),
    ]
    const action = packageSyncRepair()
    const plan = await action.plan(all)
    syncFails = true
    const results = await action.apply(plan, noopOp())
    expect(results.map((r) => r.status)).toEqual(['failed', 'failed'])
    expect(results[0]!.message).toContain('upstream unreachable')
    expect(syncs.map((s) => s.packageId)).toEqual(['a-pack', 'b-pack'])
  })

  it('plans nothing when no pack needs it', async () => {
    capabilities = [cap({ capability: 'fine', packageId: 'fine-pack', ready: true, missing: [] })]
    expect(await packageSyncRepair().plan(all)).toEqual([])
    expect(await packageReinstallRepair().plan(all)).toEqual([])
  })
})
