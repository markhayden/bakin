/**
 * End-to-end reproduction of the margo dependency loop (task 12939a37) and
 * its fix (spec `task-dependency-liveness.md`). Real task store, task
 * service, continuation, dispatch and execution ledger in a temp dir; the
 * runtime is a scripted `messaging.send` that drives the tasks plugin's REAL
 * exec-tool handlers exactly as the agent would.
 *
 * CLAUDE.md isolation: both content-dir resolvers, OpenClaw home and
 * getBakinPaths().db point under testDir; closeDb() before rmSync.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-dependency-loop-${Date.now()}-${randomUUID()}`)
mkdirSync(join(testDir, 'tasks'), { recursive: true })
process.env.BAKIN_HOME = testDir
process.env.OPENCLAW_HOME = join(testDir, 'openclaw')

const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    root: testDir,
    home: testDir,
    db: join(testDir, 'bakin.db'),
    tasks: join(testDir, 'tasks'),
    settings: join(testDir, 'settings.json'),
    audit: join(testDir, 'audit.jsonl'),
    logs: join(testDir, 'logs'),
    media: join(testDir, 'media'),
  }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

const loggerMock = () => ({ createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }) })
mock.module('../../src/core/logger', loggerMock)
mock.module('../../packages/core/src/logger', loggerMock)

mock.module('../../src/core/settings', () => ({
  resetSettingsCache: () => {},
  getSettings: mock().mockReturnValue({
    dispatch: {
      intervalMs: 1000,
      maxRetries: 3,
      failureCooldownMs: 30 * 60 * 1000,
      transientCooldownMs: 60 * 1000,
      maxDispatched: 500,
      oversizedOutputBytes: 128 * 1024,
      maxConcurrentTurns: 3,
      maxTurnsPerAgent: 1,
    },
    watchdog: { intervalMs: 300000, stuckThresholdMs: 30 * 60 * 1000, autoRecover: true, maxAutoRecoveries: 3 },
    agentPackages: { lessonsRetrieval: { enabled: false } },
    notifications: { channel: '', target: '', gateAlerts: true, channelAliases: {} },
  }),
}))

const auditEvents: Array<{ event: string; agent: string; data: Record<string, unknown> }> = []
const appendAuditMock = mock((_dir: string, event: string, agent: string, data?: Record<string, unknown>) => {
  auditEvents.push({ event, agent, data: data ?? {} })
})
mock.module('../../src/core/audit', () => ({ appendAudit: appendAuditMock }))
mock.module('@/core/audit', () => ({ appendAudit: appendAuditMock }))
mock.module('../../src/core/usage', () => ({ recordUsage: mock() }))
mock.module('../../src/core/watcher', () => ({
  watchContentDir: mock(),
  getWatcher: () => ({ on: mock(), close: mock() }),
  registerSyncHook: mock(() => {}),
  registerUnlinkHook: mock(() => {}),
}))

// Scripted runtime: each turn runs the script registered for its task id,
// calling the tasks plugin's REAL exec-tool handlers as that agent.
type TurnScript = (ctx: { taskId: string; agentId: string; seq: number }) => Promise<void>
const scripts = new Map<string, TurnScript>()
const turnsPerTask = new Map<string, number>()
const mockRuntimeSend = mock(async (args: { agentId: string; threadId: string }) => {
  const m = /^task:(.+):d(\d+)$/.exec(args.threadId)
  if (!m) return { id: 'msg' }
  const taskId = m[1]
  turnsPerTask.set(taskId, (turnsPerTask.get(taskId) ?? 0) + 1)
  const script = scripts.get(taskId)
  if (script) await script({ taskId, agentId: args.agentId, seq: Number(m[2]) })
  return { id: 'msg' }
})
const mockAppServices = {
  runtime: {
    agents: { list: async () => [
      { id: 'main', name: 'Main', status: 'active' },
      { id: 'jessica', name: 'Jessica', status: 'active' },
      { id: 'patch', name: 'Patch', status: 'active' },
    ] },
    messaging: { send: (...args: unknown[]) => mockRuntimeSend(...(args as [never])) },
  },
}
mock.module('../../src/core/app-services', () => ({ getAppServices: () => mockAppServices }))
mock.module('../../src/core/app-services-store', () => ({ getAppServices: () => mockAppServices }))
mock.module('@/core/app-services', () => ({ getAppServices: () => mockAppServices }))
mock.module('@/core/app-services-store', () => ({ getAppServices: () => mockAppServices }))

const hookRegistryMock = () => ({
  getHookRegistry: mock().mockReturnValue({
    invoke: mock(async (hook: string) => (hook === 'workflows.getActiveAgents' ? [] : undefined)),
    has: mock((name: string) => name === 'spend.getBudgetPolicy'),
    register: mock(),
    call: mock(async <T,>(_name: string, data: T) => data),
    callAll: mock(async () => undefined),
  }),
})
mock.module('../../src/core/plugin-registry', hookRegistryMock)
mock.module('@bakin/core/hooks/hook-registry-singleton', hookRegistryMock)

import tasksPlugin from '../../plugins/tasks/index'
import { activatePlugin, callTool, findTool, type ActivatedPlugin } from '../plugins/test-helpers'
import { dispatchTasks, awaitDispatchIdle } from '../../src/core/dispatch'
import { createTask, getTaskWithColumn } from '../../src/core/task-store'
import { logProgress, reportComplete } from '../../src/core/task-service'
import { closeDb } from '../../packages/core/src/storage/db'
import { waitUntil } from '../helpers/wait'

let activated: ActivatedPlugin
const tool = (name: string) => findTool(activated.execTools, name)!

async function agentCalls(agentId: string, name: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
  return callTool(tool(name), params, agentId)
}

function logsOf(taskId: string): Array<{ author: string; message: string }> {
  return (getTaskWithColumn(taskId)?.task.log ?? []) as Array<{ author: string; message: string }>
}

async function runDispatchCycle(): Promise<void> {
  await dispatchTasks(testDir, 3737)
  await awaitDispatchIdle()
}

beforeEach(async () => {
  scripts.clear()
  turnsPerTask.clear()
  auditEvents.length = 0
  rmSync(join(testDir, 'tasks'), { recursive: true, force: true })
  mkdirSync(join(testDir, 'tasks'), { recursive: true })
  rmSync(join(testDir, '.dispatch-state.json'), { force: true })
  activated = await activatePlugin(tasksPlugin, testDir)
})

afterAll(() => {
  closeDb()
  rmSync(testDir, { recursive: true, force: true })
})

describe('the margo dependency loop (task 12939a37)', () => {
  it('A — a dependency on a DONE task is refused and the agent proceeds to completion in one dispatch', async () => {
    const x = await createTask('Evaluation design', 'todo', 'patch')
    await logProgress(x.id, 'patch', 'delivered')
    await reportComplete(x.id, 'patch', 'done', 'mcp')
    const y = await createTask('Final synthesis — FIRST register dependency on the design task and exit', 'todo', 'jessica')

    // What jessica did on margo every re-dispatch, now against the fixed tool.
    scripts.set(y.id, async ({ taskId, agentId }) => {
      const refusal = await agentCalls(agentId, 'bakin_exec_tasks_set_dependency', { taskId, dependsOn: x.id })
      expect(refusal.ok).toBe(false)
      expect(refusal.reason).toBe('complete')
      expect(String(refusal.error)).toMatch(/continue your task now/i)
      await agentCalls(agentId, 'bakin_exec_tasks_log_progress', { taskId, message: 'Dependency already done — proceeding' })
      await agentCalls(agentId, 'bakin_exec_tasks_complete', { taskId, summary: 'brief + inventory delivered' })
    })

    await runDispatchCycle()

    const after = getTaskWithColumn(y.id)!
    expect(after.column).toBe('done')
    expect(after.task.dependsOn).toBeUndefined()
    expect(after.task.recoveries).toBe(0)
    expect(turnsPerTask.get(y.id)).toBe(1)
    expect(auditEvents.some((e) => e.event === 'task.dependency_set' && e.data.id === y.id)).toBe(false)
    expect(auditEvents.some((e) => e.event === 'task.auto_recovered')).toBe(false)
  })

  it('B — a dependency on an OPEN task parks the dependent at settle; completing the dependency re-dispatches it once', async () => {
    // The upstream stays in todo but is assigned to an agent the roster lacks,
    // so only jessica's task is dispatchable this cycle (eligibility: agent).
    const z = await createTask('Upstream research', 'todo', 'offline-researcher')
    const y = await createTask('Downstream synthesis', 'todo', 'jessica')

    scripts.set(y.id, async ({ taskId, agentId, seq }) => {
      if (seq === 1) {
        const ok = await agentCalls(agentId, 'bakin_exec_tasks_set_dependency', { taskId, dependsOn: z.id })
        expect(ok.ok).toBe(true)
        return // "Stop now."
      }
      await agentCalls(agentId, 'bakin_exec_tasks_log_progress', { taskId, message: 'upstream landed, synthesizing' })
      await agentCalls(agentId, 'bakin_exec_tasks_complete', { taskId, summary: 'delivered' })
    })

    await runDispatchCycle()

    // Parked at settle — not stranded in progress for the watchdog to find.
    const parked = getTaskWithColumn(y.id)!
    expect(parked.column).toBe('todo')
    expect(parked.task.dependsOn).toBe(z.id)
    expect(logsOf(y.id).map((e) => e.message)).toContain(`Waiting on ${z.id} — parked in Todo; re-dispatched when it completes.`)

    // Another cycle must NOT dispatch it (dependency gate).
    await runDispatchCycle()
    expect(turnsPerTask.get(y.id)).toBe(1)

    // The upstream completes → continuation re-dispatches jessica exactly once.
    await logProgress(z.id, 'patch', 'done')
    await reportComplete(z.id, 'patch', 'research delivered', 'mcp')
    await awaitDispatchIdle()
    await waitUntil(() => getTaskWithColumn(y.id)?.column === 'done', { label: 'dependent completes after continuation' })

    expect(turnsPerTask.get(y.id)).toBe(2)
    expect(getTaskWithColumn(y.id)!.task.recoveries).toBe(0)
    expect(auditEvents.some((e) => e.event === 'task.auto_recovered')).toBe(false)
  })

  it('C — the dependency completes DURING the waiting turn: continuation leaves dependsOn, the settle parks + clears, the next cycle dispatches', async () => {
    const z = await createTask('Upstream research', 'todo', 'offline-researcher')
    const y = await createTask('Downstream synthesis', 'todo', 'jessica')

    scripts.set(y.id, async ({ taskId, agentId, seq }) => {
      if (seq === 1) {
        const ok = await agentCalls(agentId, 'bakin_exec_tasks_set_dependency', { taskId, dependsOn: z.id })
        expect(ok.ok).toBe(true)
        // Z finishes while jessica's turn is still open.
        await logProgress(z.id, 'patch', 'done')
        await reportComplete(z.id, 'patch', 'research delivered', 'mcp')
        return
      }
      await agentCalls(agentId, 'bakin_exec_tasks_log_progress', { taskId, message: 'synthesizing' })
      await agentCalls(agentId, 'bakin_exec_tasks_complete', { taskId, summary: 'delivered' })
    })

    await runDispatchCycle()

    const parked = getTaskWithColumn(y.id)!
    expect(parked.column).toBe('todo')
    expect(parked.task.dependsOn).toBeUndefined()
    expect(logsOf(y.id).map((e) => e.message)).toContain(`Dependency ${z.id} already complete — re-queued for dispatch.`)
    expect(turnsPerTask.get(y.id)).toBe(1)

    // An ordinary cycle picks it up — no watchdog, no recovery increment.
    await runDispatchCycle()
    expect(getTaskWithColumn(y.id)!.column).toBe('done')
    expect(getTaskWithColumn(y.id)!.task.recoveries).toBe(0)
    expect(turnsPerTask.get(y.id)).toBe(2)
    expect(auditEvents.some((e) => e.event === 'task.auto_recovered')).toBe(false)
  })
})
