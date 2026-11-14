/**
 * Server entity registry: the kinds loaded plugins declare, by public id.
 *
 * Pure module: no filesystem, no app services.
 */
import { describe, expect, mock, test } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-entity-registry-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ home: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('../../../src/core/content-dir', contentDirMock)
mock.module('../../../packages/core/src/content-dir', contentDirMock)

import { createEntityRegistry } from '../../../packages/core/src/plugins/entity-registry'

const project = { kind: 'project', label: 'Project', icon: 'FolderKanban', href: '/projects/{id}', handoff: true }
const task = { kind: 'task', label: 'Task', icon: 'SquareCheck', href: '/tasks?taskId={id}' }

describe('entity registry', () => {
  test('a published kind is found by its public id', () => {
    const registry = createEntityRegistry()
    registry.publish('projects', [project])
    expect(registry.get('projects:project')).toEqual({ ...project, pluginId: 'projects', id: 'projects:project' })
    expect(registry.get('tasks:project')).toBeUndefined()
  })

  test('publishing again replaces that plugin\'s kinds and leaves other plugins alone', () => {
    const registry = createEntityRegistry()
    registry.publish('projects', [project, { ...task, kind: 'milestone' }])
    registry.publish('tasks', [task])
    registry.publish('projects', [{ ...project, label: 'Plan' }])

    expect(registry.list().map((entity) => entity.id).sort()).toEqual(['projects:project', 'tasks:task'])
    expect(registry.get('projects:project')?.label).toBe('Plan')
  })

  test('sweeping removes one plugin\'s kinds', () => {
    const registry = createEntityRegistry()
    registry.publish('projects', [project])
    registry.publish('tasks', [task])
    registry.sweep('projects')
    expect(registry.list().map((entity) => entity.id)).toEqual(['tasks:task'])
  })
})
