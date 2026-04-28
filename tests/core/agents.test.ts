import { describe, it, expect, beforeEach, afterAll, mock } from 'bun:test'
import { mkdtempSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createFileBakinTaskStore } from '@bakin/core/tasks/store'

const contentDir = mkdtempSync(join(tmpdir(), 'bakin-agents-test-'))
process.env.BAKIN_HOME = contentDir

const mockRuntimeSend = mock((...args: unknown[]) => {
  void args
  return Promise.resolve({ id: 'runtime-msg', content: 'agent reply' })
})

mock.module('@/core/runtime-registry', () => ({
  getRuntimeAdapter: () => ({
    agents: {
      get: mock(async (agentId: string) => ({ id: agentId, name: agentId, status: 'active' })),
      list: mock(async () => []),
    },
    messaging: {
      send: (...args: unknown[]) => mockRuntimeSend(...args),
    },
  }),
}))

mock.module('@/core/content-dir', () => ({
  getContentDir: () => contentDir,
  getBakinPaths: () => ({ root: contentDir, tasks: join(contentDir, 'tasks') }),
}))
mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => contentDir,
  getBakinPaths: () => ({ root: contentDir, tasks: join(contentDir, 'tasks') }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => contentDir,
  getBakinPaths: () => ({ root: contentDir, tasks: join(contentDir, 'tasks') }),
  resetContentDir: () => {},
}))

import { getAgentTasks, sendMessageToAgent } from '@/core/agents'

describe('agents', () => {
  beforeEach(() => {
    rmSync(join(contentDir, 'tasks'), { recursive: true, force: true })
    rmSync(join(contentDir, 'heartbeats'), { recursive: true, force: true })
    mkdirSync(join(contentDir, 'heartbeats'), { recursive: true })
    mockRuntimeSend.mockClear()
  })

  afterAll(() => {
    rmSync(contentDir, { recursive: true, force: true })
    delete process.env.BAKIN_HOME
  })

  describe('getAgentTasks', () => {
    it('should return empty array when no tasks exist', () => {
      expect(getAgentTasks('main', contentDir)).toEqual([])
    })

    it('should return tasks assigned to a specific agent', () => {
      const store = createFileBakinTaskStore(join(contentDir, 'tasks'))
      store.createSync({ id: 'fix-bug', title: 'Fix the bug', agent: 'main', column: 'inProgress' })
      store.createSync({ id: 'design-logo', title: 'Design logo', agent: 'pixel', column: 'inProgress' })
      store.createSync({ id: 'write-docs', title: 'Write docs', agent: 'main', column: 'todo' })

      const tasks = getAgentTasks('main', contentDir)
      expect(tasks).toHaveLength(2)
      expect(tasks[0].id).toBe('fix-bug')
      expect(tasks[0].column).toBe('in-progress')
      expect(tasks[1].id).toBe('write-docs')
      expect(tasks[1].column).toBe('todo')
    })

    it('should not return tasks assigned to other agents', () => {
      const store = createFileBakinTaskStore(join(contentDir, 'tasks'))
      store.createSync({ id: 'design-logo', title: 'Design logo', agent: 'pixel', column: 'inProgress' })

      const tasks = getAgentTasks('main', contentDir)
      expect(tasks).toHaveLength(0)
    })
  })

  describe('sendMessageToAgent', () => {
    it('sends through runtime messaging', async () => {
      const result = await sendMessageToAgent('pixel', 'Status?')

      expect(result).toEqual({ ok: true, reply: 'agent reply' })
      expect(mockRuntimeSend).toHaveBeenCalledWith({
        agentId: 'pixel',
        content: 'Status?',
      })
    })
  })
})
