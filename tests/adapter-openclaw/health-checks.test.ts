/**
 * #880 — the OpenClaw adapter's override-authorization health check:
 * healthy when overrides are honored OR nothing is routed; action_required
 * when model routes exist on a connection the gateway refuses.
 */
import { describe, it, expect, mock, afterAll } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync } from 'fs'

const testDir = join(tmpdir(), `bakin-test-oc-health-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

let routingConfig: unknown = { routes: [], tagOverrides: [] }
let hookThrows = false
mock.module('../../packages/core/src/hooks/hook-registry-singleton', () => ({
  getHookRegistry: () => ({
    invoke: async () => {
      if (hookThrows) throw new Error('models plugin reloading')
      return routingConfig
    },
  }),
}))

import { createOpenClawHealthChecks } from '../../packages/adapter-openclaw/src/health-checks'

afterAll(() => rmSync(testDir, { recursive: true, force: true }))

function runCheck(perTurnModel: boolean, scopesVerified = true) {
  const [check] = createOpenClawHealthChecks({
    routingSupport: () => ({
      defaultModel: true, fallbackModels: true, defaultSubagentModel: true,
      aliases: true, perAgentSubagentModel: true,
      supportedThinkingLevels: ['off'], perTurnModel,
    }),
    scopesVerified: () => scopesVerified,
  })
  return check!.run()
}

describe('override-authorization check (#880)', () => {
  it('healthy when the connection is authorized', async () => {
    routingConfig = { routes: [{ workClass: 'relay', model: 'openai/gpt-5.5' }], tagOverrides: [] }
    const result = await runCheck(true)
    if (result.outcome !== 'observed') throw new Error('expected observed')
    expect(result.observations[0]!.status).toBe('healthy')
  })

  it('healthy (with note) when unauthorized but nothing is routed', async () => {
    routingConfig = { routes: [], tagOverrides: [] }
    const result = await runCheck(false)
    if (result.outcome !== 'observed') throw new Error('expected observed')
    expect(result.observations[0]!.status).toBe('healthy')
    expect(result.observations[0]!.summary).toContain('nothing is clamped')
  })

  it('action_required when model routes exist on an unauthorized connection', async () => {
    routingConfig = { routes: [{ workClass: 'relay', model: 'openai/gpt-5.5' }], tagOverrides: [{ tag: 'x', model: 'openai/gpt-5.4' }] }
    const result = await runCheck(false)
    if (result.outcome !== 'observed') throw new Error('expected observed')
    const obs = result.observations[0]!
    expect(obs.status).toBe('error')
    expect(obs.summary).toContain('2 model route(s)')
    expect((obs as { incident?: { disposition?: string; resolution?: { steps?: string[] } } }).incident?.disposition).toBe('action_required')
    expect((obs as { incident?: { resolution?: { steps?: string[] } } }).incident?.resolution?.steps?.join(' ')).toContain('operator.admin')
  })

  it('reports on authorization alone when the models plugin is unavailable', async () => {
    routingConfig = undefined
    const result = await runCheck(false)
    if (result.outcome !== 'observed') throw new Error('expected observed')
    expect(result.observations[0]!.status).toBe('healthy')
  })

  it('a failed routing-config read on an unauthorized connection is UNKNOWN, never healthy (review #2)', async () => {
    // The old behavior defaulted modelRoutes=0 → healthy "nothing is
    // clamped" while routes might exist — the exact incident masked.
    hookThrows = true
    const result = await runCheck(false)
    hookThrows = false
    if (result.outcome !== 'observed') throw new Error('expected observed')
    const obs = result.observations[0]!
    expect(obs.status).toBe('unknown')
    expect(obs.evidence).toMatchObject({ routesKnown: false })
  })

  it('a failed routing-config read on an AUTHORIZED connection stays healthy — routes are irrelevant', async () => {
    hookThrows = true
    const result = await runCheck(true)
    hookThrows = false
    if (result.outcome !== 'observed') throw new Error('expected observed')
    expect(result.observations[0]!.status).toBe('healthy')
  })

  it('reports UNKNOWN, never healthy, before the gateway verifies granted scopes', async () => {
    // Review finding R5: pre-connect, perTurnModel:true is an optimistic
    // assumption — missing evidence must not read as authorized.
    routingConfig = { routes: [{ workClass: 'relay', model: 'openai/gpt-5.5' }], tagOverrides: [] }
    const result = await runCheck(true, false)
    if (result.outcome !== 'observed') throw new Error('expected observed')
    const obs = result.observations[0]!
    expect(obs.status).toBe('unknown')
    expect((obs as { incident?: { disposition?: string } }).incident?.disposition).toBe('advisory')
  })
})
