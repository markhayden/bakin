/**
 * Doctor orchestrator — plugin health check integration.
 *
 * Tests `runPluginHealthChecks()` directly rather than the full
 * `runDiagnostics()` sweep. The full sweep has ~18 dependencies and
 * mocking every one of them is fragile. The plugin-check loop is
 * independently testable as an extracted function, and that's what we
 * exercise here: per-check try/catch isolation, multi-row support,
 * cross-plugin results.
 */
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-doctor-plugin-checks-${Date.now()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => `${testDir}/.openclaw`,
  getOpenClawPath: (p: string = '') => `${testDir}/.openclaw/${p}`,
}))
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))
mock.module('../../plugins/tasks/lib/flow-store', () => ({
  readTaskboard: () => ({ columns: { todo: [], 'in-progress': [], done: [] } }),
  getAllTasks: () => ({ columns: { todo: [], 'in-progress': [], done: [] } }),
  getTask: () => null,
}))

import {
  registerPluginHealthCheck,
  unregisterPluginHealthChecks,
} from '../../plugins/health/lib/health-check-registry'
import { runPluginHealthChecks } from '../../src/core/doctor'

beforeEach(() => {
  // Clean registry before each test
  unregisterPluginHealthChecks('test-a')
  unregisterPluginHealthChecks('test-b')
})

afterEach(() => {
  unregisterPluginHealthChecks('test-a')
  unregisterPluginHealthChecks('test-b')
})

describe('runPluginHealthChecks', () => {
  it('returns empty array when no plugin checks are registered', async () => {
    const results = await runPluginHealthChecks()
    expect(results).toEqual([])
  })

  it('runs a registered check and returns its results', async () => {
    registerPluginHealthCheck('test-a', {
      id: 'my-check',
      name: 'My test check',
      run: async () => [{
        check: 'my-check',
        status: 'ok',
        message: 'All good',
        autoFixable: false,
      }],
    })

    const results = await runPluginHealthChecks()
    expect(results).toHaveLength(1)
    expect(results[0]).toEqual({
      check: 'my-check',
      status: 'ok',
      message: 'All good',
      autoFixable: false,
    })
  })

  it('isolates a check that throws synchronously — other checks still run', async () => {
    registerPluginHealthCheck('test-a', {
      id: 'thrower',
      name: 'Thrower',
      run: async () => {
        throw new Error('Intentional failure')
      },
    })
    registerPluginHealthCheck('test-b', {
      id: 'healthy',
      name: 'Healthy',
      run: async () => [{
        check: 'healthy',
        status: 'ok',
        message: 'B is fine',
        autoFixable: false,
      }],
    })

    const results = await runPluginHealthChecks()
    expect(results).toHaveLength(2)

    const thrower = results.find(r => r.check === 'test-a.thrower')!
    expect(thrower).toBeDefined()
    expect(thrower.status).toBe('error')
    expect(thrower.message).toMatch(/Intentional failure/)

    const healthy = results.find(r => r.message === 'B is fine')!
    expect(healthy).toBeDefined()
    expect(healthy.status).toBe('ok')
  })

  it('isolates async rejections — synthetic error result', async () => {
    registerPluginHealthCheck('test-a', {
      id: 'rejecter',
      name: 'Rejecter',
      run: () => Promise.reject(new Error('Async fail')),
    })

    const results = await runPluginHealthChecks()
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('error')
    expect(results[0].message).toMatch(/Async fail/)
    expect(results[0].autoFixable).toBe(false)
  })

  it('handles non-Error throws with a reasonable string', async () => {
    registerPluginHealthCheck('test-a', {
      id: 'string-thrower',
      name: 'String thrower',
      run: () => Promise.reject('raw string error'),
    })

    const results = await runPluginHealthChecks()
    expect(results).toHaveLength(1)
    expect(results[0].status).toBe('error')
    expect(results[0].message).toMatch(/raw string error/)
  })

  it('one check can contribute multiple result rows', async () => {
    registerPluginHealthCheck('test-a', {
      id: 'multi',
      name: 'Multi-row',
      run: async () => [
        { check: 'multi.a', status: 'ok',   message: 'Row A', autoFixable: false },
        { check: 'multi.b', status: 'warn', message: 'Row B', autoFixable: false },
        { check: 'multi.c', status: 'ok',   message: 'Row C', autoFixable: false },
      ],
    })

    const results = await runPluginHealthChecks()
    expect(results).toHaveLength(3)
    expect(results.map(r => r.check)).toEqual(['multi.a', 'multi.b', 'multi.c'])
  })

  it('isolates a check that returns a non-array — synthetic error result', async () => {
    registerPluginHealthCheck('test-a', {
      id: 'bad-shape',
      name: 'Returns undefined',
      // Type-cast to bypass the contract — this simulates a buggy/malicious plugin
      run: (async () => undefined) as unknown as () => Promise<import('../../packages/core/src/plugin-types').HealthCheckResult[]>,
    })

    const results = await runPluginHealthChecks()
    expect(results).toHaveLength(1)
    expect(results[0].check).toBe('test-a.bad-shape')
    expect(results[0].status).toBe('error')
    expect(results[0].message).toMatch(/non-array/)
  })
})
