/**
 * D30: tags reach the task. A plugin creates a task with tags through
 * ctx.tasks; they are stored, read back on the plugin task, carried on the
 * board view the dispatcher reads, and a models tag override routes them.
 */
import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testHome = join(tmpdir(), `bakin-task-tags-${Date.now()}-${randomUUID()}`)
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
mock.module('../../src/core/watcher', () => ({
  registerSyncHook: () => () => {},
  registerUnlinkHook: () => () => {},
  resetCustomWorktreeRelCache: () => {},
  shouldIgnoreContentWatcherPath: () => false,
  start: () => {},
  stop: async () => {},
  createInboxHandler: () => () => {},
}))
mock.module('../../src/core/dispatch-registry', () => ({ abortTurnsForTask: () => 0 }))
mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('@bakin/core/hooks/hook-registry-singleton', () => ({
  getHookRegistry: () => ({
    invoke: async () => undefined,
    callAll: async () => {},
    has: () => true,
    register: () => {},
  }),
}))
;(globalThis as Record<string, unknown>).__bakinBroadcast = () => {}

import { readTaskboard, getSharedBakinTaskStore } from '../../src/core/task-store'
import { createPluginTaskService } from '../../src/lib/plugin-context-services'
import { resolveTurnModel, type RoutingConfig } from '../../src/core/model-routing'

const config: RoutingConfig = {
  routes: [{ workClass: 'adhoc', model: 'anthropic/claude-opus-5-5' }],
  tagOverrides: [{ tag: 'project-steward', model: 'anthropic/claude-haiku-5-5' }],
}

function boardTask(id: string) {
  const all = Object.values(readTaskboard().columns).flat()
  const task = all.find((t) => t.id === id)
  if (!task) throw new Error(`not on the board: ${id}`)
  return task
}

describe('task tags through ctx.tasks', () => {
  afterAll(() => rmSync(testHome, { recursive: true, force: true }))

  it('create → stored → plugin readback → board view → tag route', async () => {
    const tasks = createPluginTaskService(getSharedBakinTaskStore())
    const created = await tasks.create({ title: 'Check in: Launch', tags: ['project-steward'], createdBy: 'projects' })

    expect(created.tags).toEqual(['project-steward'])
    expect(getSharedBakinTaskStore().getSync(created.id)?.tags).toEqual(['project-steward'])
    expect((await tasks.get(created.id))?.tags).toEqual(['project-steward'])

    const task = boardTask(created.id)
    expect(task.tags).toEqual(['project-steward'])
    expect(resolveTurnModel({ task, config })).toEqual(expect.objectContaining({
      model: 'anthropic/claude-haiku-5-5',
      source: 'tag:project-steward',
    }))
  })

  it('an untagged task takes the class route; update replaces and [] clears', async () => {
    const tasks = createPluginTaskService(getSharedBakinTaskStore())
    const created = await tasks.create({ title: 'plain work' })
    expect(created.tags).toEqual([])
    expect(boardTask(created.id).tags).toBeUndefined()
    expect(resolveTurnModel({ task: boardTask(created.id), config })).toEqual(expect.objectContaining({ source: 'class' }))

    expect((await tasks.update(created.id, { tags: ['project-steward'] })).tags).toEqual(['project-steward'])
    expect(resolveTurnModel({ task: boardTask(created.id), config }).source).toBe('tag:project-steward')
    expect((await tasks.update(created.id, { tags: [] })).tags).toEqual([])
    expect(boardTask(created.id).tags).toBeUndefined()
  })
})
