/**
 * Which hold a todo card shows (#907): kill switch > dead model > budget cap.
 * Pure helpers — no board render needed.
 */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-task-holds-${Date.now()}`)
const contentDirMock = () => ({ getContentDir: () => testDir, getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }) })
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)

import { modelHoldReason, pickTaskHold, type BudgetGateStatus } from '../../../plugins/tasks/hooks/use-budget-status'

const status = (over: Partial<BudgetGateStatus> = {}): BudgetGateStatus => ({ paused: false, configured: false, perAgent: {}, perTask: {}, deferredProviders: [], policyUnavailable: false, ...over })
const dead = { ref: 'agent:enrich:model', model: 'openai/gpt-5.6-luna', detail: 'no credentials for openai' }

describe('pickTaskHold', () => {
  it('a dead model on a zero-limit install shows "Model can\'t run" linking to the exact selection', () => {
    const hold = pickTaskHold(status(), dead, { id: 't1', agent: 'enrich' })
    expect(hold).toEqual({ label: "Model can't run", detail: 'openai/gpt-5.6-luna — no credentials for openai', href: '/models?ref=agent%3Aenrich%3Amodel', kind: 'model' })
  })

  it('a dead model outranks a budget cap; the kill switch outranks both', () => {
    const capped = status({ configured: true, perTask: { t1: 'deferred' } })
    expect(pickTaskHold(capped, dead, { id: 't1' })?.kind).toBe('model')
    expect(pickTaskHold(capped, undefined, { id: 't1' })?.label).toBe('Budget-deferred')
    expect(pickTaskHold(status({ paused: true }), dead, { id: 't1' })?.label).toBe('Dispatch paused')
  })

  it('no hold when nothing is dead, capped or paused', () => {
    expect(pickTaskHold(status(), undefined, { id: 't1' })).toBeNull()
    expect(modelHoldReason(undefined)).toBeNull()
  })
})

describe('policy unavailable (S13)', () => {
  it('a missing spend plugin (status route 404) holds every task with a Health link — above a dead model, below the kill switch', () => {
    const s = status({ policyUnavailable: true })
    expect(pickTaskHold(s, dead, { id: 't1', agent: 'enrich' })).toMatchObject({ label: 'Limits unavailable', href: '/health', kind: 'budget' })
    expect(pickTaskHold(status({ policyUnavailable: true, paused: true }), undefined, { id: 't1' })?.label).toBe('Dispatch paused')
  })
})
