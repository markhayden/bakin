/**
 * Map-child recovery surfaces (#203 PR2): REST routes, exec tools, and hooks
 * over the map-children.ts ops. The ops themselves are covered in
 * runtime-map.test.ts — these tests prove the wiring (params, status codes,
 * audit-safe error shapes), not the semantics.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  activatePlugin,
  callRoute,
  callTool,
  findRoute,
  type ActivatedPlugin,
} from '../test-helpers'
import { seedWorkflowFixtures, taskStoreMock, taskServiceMock, resetRuntimeHarness } from './helpers/runtime-harness'

const testDir = join(tmpdir(), `bakin-test-map-surfaces-${Date.now()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))
mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  resetContentDir: mock(),
  initBakinHome: mock(),
  isUsingBakinHome: () => false,
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
  resetContentDir: mock(),
  initBakinHome: mock(),
  isUsingBakinHome: () => false,
}))
mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))
mock.module('../../../src/core/watcher', () => ({
  registerSyncHook: mock(),
  registerUnlinkHook: mock(),
}))
mock.module('../../../src/core/audit', () => ({ appendAudit: mock() }))
mock.module('../../../src/core/task-store', () => taskStoreMock)
mock.module('@/core/task-store', () => taskStoreMock)
mock.module('../../../src/core/task-service', taskServiceMock)
mock.module('@/core/task-service', taskServiceMock)

const triggerDispatchSpy = mock()
mock.module('../../../plugins/workflows/lib/trigger-dispatch', () => ({
  triggerDispatch: triggerDispatchSpy,
}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => testDir,
  getOpenClawPath: (...parts: string[]) => join(testDir, ...parts),
  resetOpenClawHome: mock(),
}))
;(globalThis as unknown as { __bakinBroadcast?: unknown }).__bakinBroadcast = mock()

import workflowsPlugin from '../../../plugins/workflows'
import { createInstance, completeStep, loadInstance } from '../../../plugins/workflows/lib/runtime'

let activated: ActivatedPlugin
let seq = 0

beforeAll(async () => {
  if (!existsSync(testDir)) mkdirSync(testDir, { recursive: true })
  seedWorkflowFixtures(testDir)
  activated = await activatePlugin(workflowsPlugin, testDir)
})

afterAll(() => {
  rmSync(testDir, { recursive: true, force: true })
})

beforeEach(() => {
  resetRuntimeHarness()
  triggerDispatchSpy.mockClear()
  seedWorkflowFixtures(testDir)
})

/** Fan a fresh 3-child map instance and return its taskId. */
function fanned(): string {
  const taskId = `task-surface-${++seq}`
  createInstance(taskId, 'map-flow', testDir)
  completeStep(taskId, 'source-step', { items: ['a', 'b', 'c'] }, undefined, testDir)
  return taskId
}

describe('map-child REST routes', () => {
  it('GET children returns live-hydrated entries', async () => {
    const taskId = fanned()
    const route = findRoute(activated.routes, 'GET', '/instances/:taskId/map/:stepId/children')!
    expect(route).toBeDefined()

    const res = await callRoute(route, activated.ctx, { searchParams: { taskId, stepId: 'produce-items' } })
    expect(res.status).toBe(200)
    const children = res.body.children as Array<Record<string, unknown>>
    expect(children).toHaveLength(3)
    expect(children[0]).toMatchObject({ index: 0, entryStatus: 'in_progress', liveStatus: 'in_progress' })
  })

  it('GET children 404s for a step without map children', async () => {
    const taskId = fanned()
    const route = findRoute(activated.routes, 'GET', '/instances/:taskId/map/:stepId/children')!
    const res = await callRoute(route, activated.ctx, { searchParams: { taskId, stepId: 'source-step' } })
    expect(res.status).toBe(404)
  })

  it('POST cancel then retry round-trips a child through the routes', async () => {
    const taskId = fanned()
    const cancelRoute = findRoute(activated.routes, 'POST', '/instances/:taskId/map/:stepId/children/:index/cancel')!
    const retryRoute = findRoute(activated.routes, 'POST', '/instances/:taskId/map/:stepId/children/:index/retry')!

    const cancelled = await callRoute(cancelRoute, activated.ctx, {
      searchParams: { taskId, stepId: 'produce-items', index: '1' },
    })
    expect(cancelled.status).toBe(200)
    expect(loadInstance(`${taskId}--produce-items--1`, testDir)!.status).toBe('cancelled')

    const retried = await callRoute(retryRoute, activated.ctx, {
      searchParams: { taskId, stepId: 'produce-items', index: '1' },
      body: { reason: 'route retry' },
    })
    expect(retried.status).toBe(200)
    expect(loadInstance(`${taskId}--produce-items--1`, testDir)!.status).toBe('in_progress')
    expect(triggerDispatchSpy).toHaveBeenCalled()
  })

  it('POST retry 400s on a completed child and on bad params', async () => {
    const taskId = fanned()
    completeStep(`${taskId}--produce-items--0`, 'do-work', { made: 'a' }, undefined, testDir)
    const retryRoute = findRoute(activated.routes, 'POST', '/instances/:taskId/map/:stepId/children/:index/retry')!

    const completed = await callRoute(retryRoute, activated.ctx, {
      searchParams: { taskId, stepId: 'produce-items', index: '0' },
      body: {},
    })
    expect(completed.status).toBe(400)

    const badIndex = await callRoute(retryRoute, activated.ctx, {
      searchParams: { taskId, stepId: 'produce-items', index: 'nope' },
      body: {},
    })
    expect(badIndex.status).toBe(400)
  })
})

describe('map-child exec tools', () => {
  const tool = (name: string) => {
    const found = activated.execTools.find((t) => t.name === name)
    if (!found) throw new Error(`Tool ${name} not registered`)
    return found
  }

  it('cancel + retry tools round-trip a child', async () => {
    const taskId = fanned()

    const cancelled = await callTool(tool('bakin_exec_workflows_cancel_map_child'), {
      taskId, stepId: 'produce-items', index: 2,
    })
    expect(cancelled.ok).toBe(true)
    expect(loadInstance(`${taskId}--produce-items--2`, testDir)!.status).toBe('cancelled')

    const retried = await callTool(tool('bakin_exec_workflows_retry_map_child'), {
      taskId, stepId: 'produce-items', index: 2, reason: 'tool retry',
    })
    expect(retried.ok).toBe(true)
    expect(retried.childTaskId).toBe(`${taskId}--produce-items--2`)
    expect(loadInstance(`${taskId}--produce-items--2`, testDir)!.status).toBe('in_progress')
  })

  it('tools return typed errors instead of throwing', async () => {
    const bad = await callTool(tool('bakin_exec_workflows_retry_map_child'), {
      taskId: 'ghost', stepId: 'produce-items', index: 0,
    })
    expect(bad.ok).toBe(false)
    expect(Array.isArray(bad.errors)).toBe(true)
  })
})

describe('map-child hooks', () => {
  type HookHandler = (data: Record<string, unknown>) => unknown
  const registeredHook = (name: string): HookHandler | undefined => {
    const registerMock = activated.ctx.hooks.register as unknown as { mock: { calls: unknown[][] } }
    const call = registerMock.mock.calls.find((c) => c[0] === name)
    return call?.[1] as HookHandler | undefined
  }

  it('registers the three recovery hooks and listMapChildren round-trips', async () => {
    expect(registeredHook('workflows.retryMapChild')).toBeDefined()
    expect(registeredHook('workflows.cancelMapChild')).toBeDefined()

    const listHook = registeredHook('workflows.listMapChildren')
    expect(listHook).toBeDefined()

    const taskId = fanned()
    const listed = await listHook!({
      taskId, stepId: 'produce-items', contentDir: testDir,
    }) as { success: boolean; children: unknown[] }
    expect(listed.success).toBe(true)
    expect(listed.children).toHaveLength(3)
  })
})
