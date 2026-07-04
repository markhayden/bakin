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

describe('context.startup-size check', () => {
  it('is ok when every agent fits the default budget', async () => {
    contextBudgetBytes = undefined
    const [res] = await checkStartupContextSize(fakeRuntime(['main', 'jessica']))
    expect(res.check).toBe('context.startup-size')
    expect(res.status).toBe('ok')
    expect(res.message).toContain('65536B')
    expect(res.autoFixable).toBe(false)
  })

  it('warns (never errors) with top sources when an agent exceeds the configured budget', async () => {
    contextBudgetBytes = 1024 // static sections alone exceed this
    const [res] = await checkStartupContextSize(fakeRuntime(['jessica']))
    expect(res.status).toBe('warn')
    expect(res.message).toContain('jessica')
    expect(res.message).toContain('top:')
    expect(res.message).toContain('never blocked')
    expect(res.message).toContain('bakin agents context')
  })

  it('re-reads settings every run — raising the budget clears the warn without restart', async () => {
    contextBudgetBytes = 1024
    expect((await checkStartupContextSize(fakeRuntime(['jessica'])))[0].status).toBe('warn')
    contextBudgetBytes = 512 * 1024
    expect((await checkStartupContextSize(fakeRuntime(['jessica'])))[0].status).toBe('ok')
  })

  it('skips quietly when the runtime is unreachable (the runtime check owns that alert)', async () => {
    contextBudgetBytes = undefined
    const [res] = await checkStartupContextSize(fakeRuntime('down'))
    expect(res.status).toBe('ok')
    expect(res.message).toContain('Skipped')
  })
})
