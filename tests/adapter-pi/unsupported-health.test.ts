/**
 * adapter-pi P11 — honest-empty surfaces + canonical health registrations.
 */
import { describe, test, expect, beforeAll, afterAll, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-pi-unsup-${Date.now()}-${randomUUID()}`)
process.env.PI_HOME = join(testDir, 'pi')
process.env.BAKIN_HOME = join(testDir, 'bakin')

const contentDirMock = () => ({
  getContentDir: () => join(testDir, 'bakin'),
  getBakinPaths: () => ({ home: join(testDir, 'bakin'), db: join(testDir, 'bakin', 'bakin.db') }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}))

import type { RuntimeError } from '../../packages/core/src/adapters/runtime'
import { createPiHealthChecks, createPiRuntimeAdapter } from '../../packages/adapter-pi/src/index'
import { getPiAgentsRoot, resetPiHome } from '../../packages/adapter-pi/src/home'
import { resetModelRegistry } from '../../packages/adapter-pi/src/models'
import { parseHealthCheckRegistration, parseHealthCheckRunInput } from '../../src/core/health-contract'

const adapter = createPiRuntimeAdapter()

beforeAll(async () => {
  resetPiHome()
  resetModelRegistry()
  const agentDir = join(testDir, 'pi', 'agent')
  mkdirSync(agentDir, { recursive: true })
  mkdirSync(getPiAgentsRoot(), { recursive: true })
  writeFileSync(join(agentDir, 'auth.json'), JSON.stringify({ fakeai: { type: 'api_key', key: 'k' } }))
  writeFileSync(join(agentDir, 'models.json'), JSON.stringify({
    providers: {
      fakeai: { name: 'F', baseUrl: 'http://127.0.0.1:9', api: 'openai-completions', models: [{ id: 'm', name: 'M', input: ['text'], reasoning: false, contextWindow: 1000, maxTokens: 100, cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } }] },
    },
  }))
  await adapter.initialize({ contentDir: join(testDir, 'bakin') })
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

async function expectUnsupported(promise: Promise<unknown>): Promise<void> {
  try {
    await promise
    throw new Error('expected a typed unsupported failure')
  } catch (err) {
    expect((err as RuntimeError).kind).toBe('runtime_failed')
    expect((err as Error).message).toContain('not supported by the pi runtime')
  }
}

describe('honest-empty surfaces', () => {
  test('channels/cron: OMITTED — absence IS the signal (P2.1)', () => {
    // No throwing stubs to maintain: the optional-capability contract means
    // consumers feature-detect and degrade. capabilities() reports the same
    // fact declaratively (delivery unavailable).
    expect(adapter.channels).toBeUndefined()
    expect(adapter.cron).toBeUndefined()
  })

  test('capabilities() reports delivery unavailable, matching the omitted surface', async () => {
    const caps = await adapter.capabilities()
    expect(caps.delivery.mode).toBe('unavailable')
  })


  test('optional members: images present (shim-backed, #627); the rest genuinely absent', () => {
    expect(adapter.images).toBeDefined()
    expect(adapter.media).toBeUndefined()
  })
})

describe('canonical health registrations', () => {
  test('exports four healthy, structured probes for a usable Pi home', async () => {
    const checks = createPiHealthChecks()
    expect(checks.map((check) => check.id)).toEqual(['home', 'agents-root', 'auth', 'models'])
    for (const check of checks) expect(parseHealthCheckRegistration(check).id).toBe(check.id)

    const runs = await Promise.all(checks.map((check) => check.run()))
    for (const run of runs) expect(parseHealthCheckRunInput(run).outcome).toBe('observed')
    expect(runs.every((run) => (
      run.outcome === 'observed'
      && run.observations.length === 1
      && run.observations[0]?.status === 'healthy'
    ))).toBe(true)
  })

  test('missing auth reports one actionable canonical incident', async () => {
    rmSync(join(testDir, 'pi', 'agent', 'auth.json'))
    resetModelRegistry()
    const auth = createPiHealthChecks().find((check) => check.id === 'auth')
    const run = await auth?.run()

    expect(run?.outcome).toBe('observed')
    if (run?.outcome !== 'observed') throw new Error('expected observed auth health output')
    expect(run.observations[0]?.status).toBe('error')
    expect(run.observations[0]?.incident?.disposition).toBe('action_required')
  })

  test('the agent-root probe does not create a missing directory', async () => {
    rmSync(getPiAgentsRoot(), { recursive: true, force: true })
    const root = createPiHealthChecks().find((check) => check.id === 'agents-root')

    const run = await root?.run()

    expect(run?.outcome).toBe('observed')
    expect(existsSync(getPiAgentsRoot())).toBe(false)
  })
})
