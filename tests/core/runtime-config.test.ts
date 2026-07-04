/**
 * Governed whole-config wrapper (audit config-surface finding): replaces
 * carry a typed scope + append an audit row; reads are scope-typed but
 * deliberately un-audited (hot path).
 */
import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-runtime-config-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

const auditCalls: Array<{ event: string; data: Record<string, unknown> }> = []
mock.module('../../src/core/audit', () => ({
  appendAudit: (_dir: string, event: string, _actor: string, data: Record<string, unknown>) => {
    auditCalls.push({ event, data })
  },
}))

mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

import { readRuntimeConfig, replaceRuntimeConfig } from '../../src/core/runtime-config'
import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'

const replaceCalls: Array<{ next: unknown; reason: string }> = []
const fakeRuntime = {
  config: {
    get: async <T,>() => ({ agents: { list: [] } }) as T,
    replace: async (next: unknown, reason: string) => { replaceCalls.push({ next, reason }) },
    raw: async () => null,
  },
} as unknown as AgentRuntimeAdapter

beforeEach(() => {
  auditCalls.length = 0
  replaceCalls.length = 0
})

describe('governed runtime-config wrapper', () => {
  it('replace threads scope + detail into the adapter reason and audits the mutation', async () => {
    await replaceRuntimeConfig(fakeRuntime, { a: 1 }, 'models.routing', 'set pixel → opus')

    expect(replaceCalls).toHaveLength(1)
    expect(replaceCalls[0].reason).toBe('models.routing: set pixel → opus')
    expect(auditCalls).toEqual([{
      event: 'runtime.config.replace',
      data: { scope: 'models.routing', detail: 'set pixel → opus' },
    }])
  })

  it('replace without detail uses the bare scope', async () => {
    await replaceRuntimeConfig(fakeRuntime, {}, 'onboarding.openclaw-mcp')
    expect(replaceCalls[0].reason).toBe('onboarding.openclaw-mcp')
    expect(auditCalls[0].data).toEqual({ scope: 'onboarding.openclaw-mcp' })
  })

  it('reads return the adapter config and never audit', async () => {
    const config = await readRuntimeConfig(fakeRuntime, 'team.agent-inventory')
    expect(config).toEqual({ agents: { list: [] } })
    expect(auditCalls).toHaveLength(0)
  })
})
