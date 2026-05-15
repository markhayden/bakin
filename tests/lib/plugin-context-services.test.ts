import { describe, expect, it } from 'bun:test'
import { createMockRuntimeAdapter } from '@bakin/core/adapters/runtime/testing'
import { createMockBakinTaskStore } from '@bakin/core/tasks/testing'
import {
  createPluginRuntimeFacade,
  createPluginTaskService,
} from '../../src/lib/plugin-context-services'

describe('plugin context services', () => {
  it('maps task-store rows into the public task service shape', async () => {
    const store = createMockBakinTaskStore()
    await store.create({
      id: 'task-1',
      title: 'Draft campaign',
      agent: 'trainer',
      column: 'todo',
      projectId: 'project-1',
      availableAt: '2026-05-18T15:00:00.000Z',
      dueAt: '2026-05-22T15:00:00.000Z',
      source: {
        pluginId: 'messaging',
        entityType: 'deliverable',
        entityId: 'deliverable-1',
        purpose: 'kickoff',
      },
    })

    const tasks = createPluginTaskService(store)
    expect(await tasks.list({ projectId: 'project-1' })).toMatchObject([
      {
        id: 'task-1',
        title: 'Draft campaign',
        agent: 'trainer',
        checked: false,
        column: 'todo',
        projectId: 'project-1',
        availableAt: '2026-05-18T15:00:00.000Z',
        dueAt: '2026-05-22T15:00:00.000Z',
        source: {
          pluginId: 'messaging',
          entityType: 'deliverable',
          entityId: 'deliverable-1',
          purpose: 'kickoff',
        },
      },
    ])

    const updated = await tasks.update('task-1', { checked: true })
    expect(updated.column).toBe('done')
    expect(updated.checked).toBe(true)
  })

  it('keeps runtime provider config behind the host boundary', async () => {
    const runtime = createPluginRuntimeFacade(createMockRuntimeAdapter())

    await expect(runtime.config.get()).rejects.toThrow(/not exposed to plugins/)
    await expect(runtime.agents.create({ name: 'New Agent' })).rejects.toThrow(/not exposed to plugins/)
    await expect(runtime.agents.list()).resolves.toEqual([])
  })
})
