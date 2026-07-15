import { describe, expect, it } from 'bun:test'
import {
  isContextSettingsData,
  isContextSummaryData,
  isLiveNowData,
} from '../../../plugins/health/lib/agent-operational-route-guards'

describe('agent operational route guards', () => {
  it('accepts the live, context, and settings evidence used by Agent pulse', () => {
    expect(isLiveNowData({
      generatedAt: '2026-07-14T18:00:00.000Z',
      runs: [{
        agent: 'main',
        taskId: 'task-1',
        taskTitle: 'Verify search',
        runId: 'run-1',
        startedAt: 1,
        runningForMs: 2,
        heartbeatAgeMs: 3,
      }],
    })).toBe(true)
    expect(isContextSummaryData({
      ok: true,
      tokenEstimateNote: 'Approximate bytes per dispatch.',
      agents: [{
        agentId: 'main',
        staticTaskBytes: 1,
        staticWorkflowBytes: 2,
        estimatedMaxTaskBytes: 3,
        workspaceAvailable: true,
        workspaceTotalBytes: 4,
        lastObserved: null,
      }],
    })).toBe(true)
    expect(isContextSettingsData({
      dispatch: { contextBudgetBytes: 65_536 },
      unrelatedSetting: true,
    })).toBe(true)
  })

  it('rejects invalid timestamps and negative operational measurements', () => {
    expect(isLiveNowData({ generatedAt: 'not-a-time', runs: [] })).toBe(false)
    expect(isLiveNowData({ generatedAt: 'July 14, 2026 12:00:00', runs: [] })).toBe(false)
    expect(isLiveNowData({
      generatedAt: '2026-07-14T18:00:00.000Z',
      runs: [{
        agent: 'main',
        taskId: 'task-1',
        taskTitle: null,
        runId: 'run-1',
        startedAt: 1,
        runningForMs: -1,
        heartbeatAgeMs: 3,
      }],
    })).toBe(false)
    expect(isContextSettingsData({ dispatch: { contextBudgetBytes: -1 } })).toBe(false)
  })
})
