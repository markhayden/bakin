import { describe, it, expect, afterEach, beforeEach, mock } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = mkdtempSync(join(tmpdir(), 'bakin-doctor-repair-'))

process.env.BAKIN_HOME = testDir

mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

import {
  planDoctorRepair,
  applyDoctorRepair,
} from '../../src/core/doctor-repair'
import {
  registerHealthCheck,
  unregisterHealthCheck,
} from '../../src/core/health-check-registry'
import type {
  HealthCheckDef,
  HealthCheckResult,
  HealthRepairApplyResult,
  HealthRepairPlanItem,
} from '../../packages/core/src/plugin-types'

const registered: string[] = []

function warn(check: string, message = 'needs repair'): HealthCheckResult {
  return { check, status: 'warn', message, autoFixable: true }
}

function ok(check: string, message = 'healthy'): HealthCheckResult {
  return { check, status: 'ok', message, autoFixable: false }
}

function registerTestCheck(input: Partial<HealthCheckDef> & Pick<HealthCheckDef, 'id' | 'run'>): HealthCheckDef {
  const def: HealthCheckDef = {
    runtime: 'plugin',
    pluginId: 'repair-test',
    name: input.name ?? input.id,
    autoFix: input.autoFix,
    repair: input.repair,
    ...input,
  }
  registerHealthCheck(def)
  registered.push(def.id)
  return def
}

beforeEach(() => {
  rmSync(testDir, { recursive: true, force: true })
})

afterEach(() => {
  for (const id of registered.splice(0)) {
    unregisterHealthCheck(id)
  }
})

describe('planDoctorRepair', () => {
  it('plans repair items from checks that expose repair handlers', async () => {
    const planItems: HealthRepairPlanItem[] = [{
      id: 'repair.safe',
      checkId: 'drift',
      title: 'Repair drift',
      reason: 'drifted',
      safety: 'safe',
      requiresConfirmation: true,
      changes: [{ kind: 'file', target: 'AGENTS.md', action: 'update', description: 'Rewrite managed block' }],
    }]
    registerTestCheck({
      id: 'repair-test.drift',
      run: async () => [warn('drift', 'drifted')],
      repair: {
        plan: async (rows) => {
          expect(rows).toHaveLength(1)
          expect(rows[0].check).toBe('drift')
          return planItems
        },
        apply: async () => [],
      },
    })
    registerTestCheck({
      id: 'repair-test.report-only',
      run: async () => [warn('report-only')],
    })

    const report = await planDoctorRepair({ contentDir: testDir, projectRoot: testDir })

    expect(report.diagnostics).toHaveLength(2)
    expect(report.items).toHaveLength(1)
    expect(report.items[0]).toMatchObject({
      id: 'repair.safe',
      checkId: 'drift',
      healthCheckId: 'repair-test.drift',
      pluginId: 'repair-test',
      checkName: 'repair-test.drift',
    })
    expect(report.summary).toMatchObject({ totalItems: 1, safeItems: 1, blockedItems: 0, planErrors: 0 })
  })

  it('keeps non-safe plan items blocked from automatic application', async () => {
    registerTestCheck({
      id: 'repair-test.manual',
      run: async () => [warn('manual')],
      repair: {
        plan: async () => [{
          id: 'repair.manual',
          checkId: 'manual',
          title: 'Manual repair',
          reason: 'needs judgement',
          safety: 'manual',
          requiresConfirmation: true,
          changes: [{ kind: 'other', target: 'operator', action: 'invoke', description: 'Decide manually' }],
        }],
        apply: async () => {
          throw new Error('manual item should not apply')
        },
      },
    })

    const report = await planDoctorRepair({ contentDir: testDir, projectRoot: testDir })

    expect(report.items).toHaveLength(1)
    expect(report.items[0].safety).toBe('manual')
    expect(report.summary).toMatchObject({ totalItems: 1, safeItems: 0, blockedItems: 1 })
  })
})

describe('applyDoctorRepair', () => {
  it('requires explicit acceptance before applying repairs', async () => {
    let applied = false
    registerTestCheck({
      id: 'repair-test.confirm',
      run: async () => [warn('confirm')],
      repair: {
        plan: async () => [{
          id: 'repair.confirm',
          checkId: 'confirm',
          title: 'Repair confirm',
          reason: 'needs repair',
          safety: 'safe',
          requiresConfirmation: true,
          changes: [{ kind: 'file', target: 'file', action: 'update', description: 'update file' }],
        }],
        apply: async () => {
          applied = true
          return []
        },
      },
    })

    const report = await applyDoctorRepair({ contentDir: testDir, projectRoot: testDir, accepted: false })

    expect(report.status).toBe('confirmation_required')
    expect(report.plan.items).toHaveLength(1)
    expect(report.applied).toEqual([])
    expect(applied).toBe(false)
  })

  it('applies safe items, skips non-safe items, and reruns affected checks', async () => {
    let repaired = false
    registerTestCheck({
      id: 'repair-test.apply',
      run: async () => repaired ? [ok('apply')] : [warn('apply')],
      repair: {
        plan: async () => [
          {
            id: 'repair.apply.safe',
            checkId: 'apply',
            title: 'Safe repair',
            reason: 'drifted',
            safety: 'safe',
            requiresConfirmation: true,
            changes: [{ kind: 'file', target: 'file', action: 'update', description: 'update file' }],
          },
          {
            id: 'repair.apply.manual',
            checkId: 'apply',
            title: 'Manual repair',
            reason: 'ambiguous',
            safety: 'manual',
            requiresConfirmation: true,
            changes: [{ kind: 'other', target: 'operator', action: 'invoke', description: 'manual step' }],
          },
        ],
        apply: async (items): Promise<HealthRepairApplyResult[]> => {
          expect(items.map(item => item.id)).toEqual(['repair.apply.safe'])
          repaired = true
          return [{
            id: 'repair.apply.safe',
            checkId: 'apply',
            status: 'applied',
            message: 'updated file',
            changes: items[0].changes,
          }]
        },
      },
    })

    const report = await applyDoctorRepair({ contentDir: testDir, projectRoot: testDir, accepted: true })

    expect(report.status).toBe('applied')
    expect(report.applied).toHaveLength(1)
    expect(report.skipped).toHaveLength(1)
    expect(report.verification).toEqual([ok('apply')])
    expect(report.summary).toMatchObject({ applied: 1, skipped: 1, failed: 0, verificationErrors: 0, verificationWarnings: 0 })
  })

  it('isolates apply failures and continues unrelated repairs', async () => {
    registerTestCheck({
      id: 'repair-test.fail',
      run: async () => [warn('fail')],
      repair: {
        plan: async () => [{
          id: 'repair.fail',
          checkId: 'fail',
          title: 'Failing repair',
          reason: 'broken',
          safety: 'safe',
          requiresConfirmation: true,
          changes: [{ kind: 'service', target: 'svc', action: 'install', description: 'install svc' }],
        }],
        apply: async () => {
          throw new Error('boom')
        },
      },
    })
    registerTestCheck({
      id: 'repair-test.ok',
      run: async () => [warn('ok')],
      repair: {
        plan: async () => [{
          id: 'repair.ok',
          checkId: 'ok',
          title: 'Working repair',
          reason: 'broken',
          safety: 'safe',
          requiresConfirmation: true,
          changes: [{ kind: 'file', target: 'ok', action: 'update', description: 'update ok' }],
        }],
        apply: async (items) => [{
          id: items[0].id,
          checkId: 'ok',
          status: 'applied',
          message: 'ok',
          changes: items[0].changes,
        }],
      },
    })

    const report = await applyDoctorRepair({ contentDir: testDir, projectRoot: testDir, accepted: true })

    expect(report.status).toBe('applied')
    expect(report.applied.some(result => result.id === 'repair.ok' && result.status === 'applied')).toBe(true)
    expect(report.applied.some(result => result.id === 'repair-test.fail.apply-error' && result.status === 'failed')).toBe(true)
    expect(report.errors).toContainEqual(expect.objectContaining({
      phase: 'apply',
      healthCheckId: 'repair-test.fail',
      message: 'boom',
    }))
  })
})
