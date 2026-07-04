import { beforeEach, describe, expect, it, mock } from 'bun:test'
import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'

const auditEntries: Array<{
  contentDir: string
  event: string
  agent: string
  data: Record<string, unknown>
  channel?: string
}> = []

mock.module('../../src/core/audit', () => ({
  appendAudit: (
    contentDir: string,
    event: string,
    agent: string,
    data: Record<string, unknown>,
    channel?: string,
  ) => {
    auditEntries.push({ contentDir, event, agent, data, channel })
  },
}))

mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => '/tmp/bakin-runtime-config-raw-test',
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => '/tmp/bakin-runtime-config-raw-test',
}))

mock.module('../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

describe('runtime config raw access gate', () => {
  let rawCalls: Array<{ key: string; reason: string }>
  let runtime: AgentRuntimeAdapter
  let readAllowedRuntimeConfigRaw: typeof import('../../src/core/runtime-config-raw').readAllowedRuntimeConfigRaw

  beforeEach(async () => {
    auditEntries.length = 0
    rawCalls = []
    runtime = {
      config: {
        raw: async (key: string, reason: string) => {
          rawCalls.push({ key, reason })
          return { ok: true }
        },
      },
    } as AgentRuntimeAdapter
    vi.resetModules()
    readAllowedRuntimeConfigRaw = (await import('../../src/core/runtime-config-raw')).readAllowedRuntimeConfigRaw
  })

  it('allows configured raw reads and audits the key/reason only', async () => {
    const result = await readAllowedRuntimeConfigRaw(
      runtime,
      'agents.main.authProfiles',
      'onboarding.llm.check'
    )

    expect(result).toEqual({ ok: true })
    expect(rawCalls).toEqual([{ key: 'agents.main.authProfiles', reason: 'onboarding.llm.check' }])
    expect(auditEntries).toHaveLength(1)
    expect(auditEntries[0]).toMatchObject({
      contentDir: '/tmp/bakin-runtime-config-raw-test',
      event: 'runtime.config.raw',
      agent: 'system',
      channel: 'system',
      data: {
        key: 'agents.main.authProfiles',
        reason: 'onboarding.llm.check',
        tracking: 'adapter-layer:onboarding-credential-checks',
      },
    })
  })

  it('rejects raw reads that are not explicitly allowlisted', async () => {
    await expect(
      readAllowedRuntimeConfigRaw(runtime, 'agents.main.secrets', 'onboarding.llm.check')
    ).rejects.toThrow('not allowlisted')

    expect(rawCalls).toEqual([])
    expect(auditEntries).toEqual([])
  })
})
