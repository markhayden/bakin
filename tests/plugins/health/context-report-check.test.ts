/**
 * context.startup-size doctor check (#357) — warn-only budget guardrail over
 * estimated Bakin-injected per-dispatch context. Shares arithmetic with the
 * context-report engine; settings are re-read on every run.
 */
import { describe, it, expect, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-ctx-check-${Date.now()}`)

let contextBudgetBytes: number | undefined = undefined
const contentDirMock = () => ({ getContentDir: () => testDir })
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))
mock.module('../../../src/core/settings', () => ({
  resetSettingsCache: () => {},
  getSettings: () => ({
    dispatch: { ...(contextBudgetBytes !== undefined ? { contextBudgetBytes } : {}) },
    agentPackages: { lessonsRetrieval: { enabled: true, injectIntoDispatch: true, maxLessons: 3, maxCharacters: 8000 } },
  }),
}))

import { checkStartupContextSize } from '../../../plugins/health/lib/system-checks/context-report'
import type { AgentRuntimeAdapter } from '../../../packages/core/src/adapters/runtime'
import type { HealthCheckRunInput } from '@makinbakin/sdk'
import { parseHealthCheckRunInput } from '../../../src/core/health-contract'

function fakeRuntime(agentIds: string[] | 'down'): AgentRuntimeAdapter {
  return {
    agents: {
      list: async () => {
        if (agentIds === 'down') throw new Error('gateway unreachable')
        return agentIds.map((id) => ({ id, name: id, status: 'online' }))
      },
    },
  } as unknown as AgentRuntimeAdapter
}

function observed(run: HealthCheckRunInput) {
  const parsed = parseHealthCheckRunInput(run)
  expect(parsed.outcome).toBe('observed')
  if (parsed.outcome !== 'observed') throw new Error(parsed.reason)
  return parsed.observations
}

describe('context.startup-size check', () => {
  it('is ok when every agent fits the default budget', async () => {
    contextBudgetBytes = undefined
    const [res] = observed(await checkStartupContextSize(fakeRuntime(['main', 'jessica'])))
    expect(res.key).toBe('budget')
    expect(res.status).toBe('healthy')
    expect(res.detail).toContain('65536 bytes')
  })

  it('warns (never errors) with top sources when an agent exceeds the configured budget', async () => {
    contextBudgetBytes = 1024 // static sections alone exceed this
    const [res] = observed(await checkStartupContextSize(fakeRuntime(['jessica'])))
    expect(res.status).toBe('warning')
    expect(res.summary).toContain('jessica')
    expect(res.detail).toContain('Largest components')
    expect(res.detail).toContain('Dispatch remains enabled')
    expect(res.incident?.disposition).toBe('watch')
  })

  it('re-reads settings every run — raising the budget clears the warn without restart', async () => {
    contextBudgetBytes = 1024
    expect(observed(await checkStartupContextSize(fakeRuntime(['jessica'])))[0].status).toBe('warning')
    contextBudgetBytes = 512 * 1024
    expect(observed(await checkStartupContextSize(fakeRuntime(['jessica'])))[0].status).toBe('healthy')
  })

  it('skips quietly when the runtime is unreachable (the runtime check owns that alert)', async () => {
    contextBudgetBytes = undefined
    const [res] = observed(await checkStartupContextSize(fakeRuntime('down')))
    expect(res.status).toBe('unknown')
    expect(res.summary).toContain('could not be verified')
  })
})
