/**
 * tasks.statusChanged has ONE emitter (spec D21): the shared task store's
 * column write. Every path that changes a column — moves, blocks, recoveries,
 * plugin ctx.tasks.update/move — fires it exactly once; writes that leave the
 * column alone never do.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testHome = join(tmpdir(), `bakin-task-status-hook-${Date.now()}-${randomUUID()}`)
const tasksDir = join(testHome, 'tasks')
process.env.BAKIN_HOME = testHome
process.env.OPENCLAW_HOME = join(testHome, 'openclaw')
mkdirSync(tasksDir, { recursive: true })

function testBakinPaths() {
  return {
    home: testHome,
    audit: join(testHome, 'audit.jsonl'),
    assets: join(testHome, 'assets'),
    tasks: tasksDir,
    workflows: join(testHome, 'workflows'),
    settings: join(testHome, 'settings.json'),
    logs: join(testHome, 'logs'),
    antfly: join(testHome, 'antfly'),
    db: join(testHome, 'bakin.db'),
    media: join(testHome, 'media'),
  }
}
mock.module('../../src/core/content-dir', () => ({ getContentDir: () => testHome, getBakinPaths: testBakinPaths }))
mock.module('../../packages/core/src/content-dir', () => ({ getContentDir: () => testHome, getBakinPaths: testBakinPaths }))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testHome, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testHome, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../src/core/logger', () => ({
  createLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }),
}))
mock.module('../../src/core/watcher', () => ({ watchFile: () => () => {}, unwatchFile: () => {} }))
mock.module('../../src/core/dispatch-registry', () => ({ abortTurnsForTask: () => 0 }))
mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

const statusChanges: Array<Record<string, unknown>> = []
mock.module('@bakin/core/hooks/hook-registry-singleton', () => ({
  getHookRegistry: () => ({
    invoke: async () => undefined,
    callAll: async (hook: string, data: Record<string, unknown>) => {
      if (hook === 'tasks.statusChanged') statusChanges.push(data)
    },
    has: () => true,
    register: () => {},
  }),
}))
;(globalThis as Record<string, unknown>).__bakinBroadcast = () => {}

import { addTaskLog, blockTask, createTask, getSharedBakinTaskStore, moveTask, recoverTask, updateTask } from '../../src/core/task-store'
import { createPluginTaskService } from '../../src/lib/plugin-context-services'
import { waitUntil, settleFor } from '../helpers/wait'

async function newTask(title: string): Promise<string> {
  const { id } = await createTask(title, 'todo')
  await addTaskLog(id, 'pixel', 'started')
  return id
}

describe('tasks.statusChanged chokepoint', () => {
  beforeEach(async () => {
    // Let any deferred emission from the previous test land before resetting.
    await settleFor(20, 'deferred emissions from the previous test drain')
    statusChanges.length = 0
  })
  afterAll(() => rmSync(testHome, { recursive: true, force: true }))

  it('emits once for a core move, with the column it left and the written task', async () => {
    const id = await newTask('core move')
    await moveTask(id, 'inProgress')
    await waitUntil(() => statusChanges.length > 0, { label: 'statusChanged for the move' })
    await settleFor(20, 'no second emission for the same move')
    expect(statusChanges).toEqual([
      expect.objectContaining({ taskId: id, title: 'core move', from: 'todo', to: 'inProgress', task: expect.objectContaining({ id, column: 'inProgress' }) }),
    ])
  })

  it('emits once for a block, and not for re-blocking an already-blocked task', async () => {
    const id = await newTask('block me')
    await blockTask(id, 'waiting on input', 'pixel', 'human')
    await waitUntil(() => statusChanges.length > 0, { label: 'statusChanged for the block' })
    await blockTask(id, 'still waiting', 'pixel', 'human')
    await settleFor(20, 'a reason-only re-block is not a column change')
    expect(statusChanges).toEqual([expect.objectContaining({ taskId: id, from: 'todo', to: 'blocked' })])
  })

  it('emits for an automatic recovery back to todo', async () => {
    const id = await newTask('recover me')
    await moveTask(id, 'inProgress')
    await waitUntil(() => statusChanges.length === 1, { label: 'statusChanged for the move' })
    await recoverTask(id)
    await waitUntil(() => statusChanges.length === 2, { label: 'statusChanged for the recovery' })
    expect(statusChanges[1]).toEqual(expect.objectContaining({ taskId: id, from: 'inProgress', to: 'todo' }))
  })

  it('emits once each for plugin ctx.tasks.move and a column-changing ctx.tasks.update', async () => {
    const tasks = createPluginTaskService(getSharedBakinTaskStore())
    const id = await newTask('plugin paths')
    await tasks.move(id, 'review')
    await waitUntil(() => statusChanges.length === 1, { label: 'statusChanged for ctx.tasks.move' })
    await tasks.update(id, { column: 'done' })
    await waitUntil(() => statusChanges.length === 2, { label: 'statusChanged for ctx.tasks.update' })
    await settleFor(20, 'exactly one emission per write')
    expect(statusChanges).toEqual([
      expect.objectContaining({ taskId: id, from: 'todo', to: 'review' }),
      expect.objectContaining({ taskId: id, from: 'review', to: 'done' }),
    ])
  })

  it('stays silent for writes that keep the column', async () => {
    const tasks = createPluginTaskService(getSharedBakinTaskStore())
    const id = await newTask('quiet')
    await updateTask(id, { title: 'quiet, renamed' })
    await addTaskLog(id, 'pixel', 'more work')
    await tasks.update(id, { title: 'quiet again', column: 'todo' })
    await settleFor(30, 'no column changed, so no statusChanged')
    expect(statusChanges).toEqual([])
  })
})
