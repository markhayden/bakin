/**
 * adapter-pi P11 — honest-empty surfaces + health checks.
 */
import { describe, test, expect, beforeAll, afterAll, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
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
import { createPiRuntimeAdapter } from '../../packages/adapter-pi/src/index'
import { resetPiHome } from '../../packages/adapter-pi/src/home'
import { resetModelRegistry } from '../../packages/adapter-pi/src/models'

const adapter = createPiRuntimeAdapter()

beforeAll(async () => {
  resetPiHome()
  resetModelRegistry()
  const agentDir = join(testDir, 'pi', 'agent')
  mkdirSync(agentDir, { recursive: true })
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
  test('channels: empty list, typed failures on send/approval, no-op unsubscribe', async () => {
    expect(await adapter.channels.list()).toEqual([])
    await expectUnsupported(adapter.channels.sendNotification({ severity: 'info', message: 'x' } as never))
    await expectUnsupported(adapter.channels.createApproval({} as never))
    const unsubscribe = adapter.channels.subscribeApprovalResponses(() => {})
    expect(typeof unsubscribe).toBe('function')
    unsubscribe()
  })

  test('cron: empty reads, typed failures on mutation', async () => {
    expect(await adapter.cron.list()).toEqual([])
    expect(await adapter.cron.get('x')).toBeNull()
    expect(await adapter.cron.listRuns('x')).toEqual([])
    expect(await adapter.cron.getRaw('x', 'test-reason')).toBeNull()
    await expectUnsupported(adapter.cron.create({ name: 'j', schedule: '* * * * *', command: 'x' } as never))
    await expectUnsupported(adapter.cron.runNow('x'))
  })

  test('tools.invoke: typed failure', async () => {
    await expectUnsupported(adapter.tools.invoke('main', 'anything', {}))
  })

  test('optional members: images present (shim-backed, #627); the rest genuinely absent', () => {
    expect(adapter.images).toBeDefined()
    expect(adapter.media).toBeUndefined()
    expect(adapter.channels.createThread).toBeUndefined()
    expect(adapter.channels.editMessage).toBeUndefined()
  })
})

describe('health checks', () => {
  test('all green on a healthy fixture home', async () => {
    const checks = adapter.getHealthChecks()
    expect(checks.length).toBe(2)
    const results = (await Promise.all(checks.map((c) => c.run()))).flat()
    expect(results.every((r) => r.status === 'ok')).toBe(true)
  })

  test('missing auth reported as error', async () => {
    rmSync(join(testDir, 'pi', 'agent', 'auth.json'))
    resetModelRegistry()
    const checks = adapter.getHealthChecks()
    const results = (await Promise.all(checks.map((c) => c.run()))).flat()
    const auth = results.find((r) => r.check === 'pi.auth')
    expect(auth?.status).toBe('error')
  })
})
