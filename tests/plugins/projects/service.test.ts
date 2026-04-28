import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-projects-svc-${Date.now()}`)
const projectsDir = join(testDir, 'projects')

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../../src/core/content-dir', () => ({
  getBakinPaths: () => ({ projects: projectsDir }),
  getContentDir: () => testDir,
}))

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({
    info: mock(),
    warn: mock(),
    error: mock(),
    debug: mock(),
  }),
}))

mock.module('../../../src/core/audit', () => ({
  appendAudit: mock(),
}))

const mockCreateTask = mock((_opts?: unknown) => Promise.resolve({ id: 'newtask1' }))
mock.module('../../../src/core/task-service', () => ({
  createTaskWithEffects: (opts: unknown) => mockCreateTask(opts),
}))

const mockTaskboardColumns = {
  todo: [{ id: 'board01', title: 'Board Task 1' }],
  inProgress: [],
  review: [],
  done: [{ id: 'board02', title: 'Done Task' }],
  archived: [],
  blocked: [],
  backlog: [],
}

mock.module('../../../src/core/task-store', () => ({
  readTaskboard: mock(() => ({ columns: mockTaskboardColumns })),
}))
mock.module('@/core/task-store', () => ({
  readTaskboard: mock(() => ({ columns: mockTaskboardColumns })),
}))

// Suppress broadcast
;(globalThis as any).__bakinBroadcast = mock()

// Clear project index between tests
function clearIndex() {
  ;(globalThis as any).__bakinProjectIndex = undefined
  ;(globalThis as any).__bakinProjectLock = undefined
}

import {
  createProject,
  updateProject,
  deleteProject,
  addChecklistItem,
  markChecklistItem,
  updateChecklistItem,
  removeChecklistItem,
  linkChecklistItem,
  promoteItemToTask,
  attachAsset,
  detachAsset,
  autoCheckLinkedItem,
  autoUnlinkTask,
  rebuildIndex,
  getProjectForTask,
  getProjectTitleForTask,
  resolveLinkedTaskStatuses,
} from '../../../plugins/projects/lib/project-service'
import { readProject } from '../../../plugins/projects/lib/parser'

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  mkdirSync(projectsDir, { recursive: true })
  clearIndex()
  mockCreateTask.mockClear()
})

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

describe('createProject', () => {
  it('creates a project file and returns id', async () => {
    const result = await createProject({ title: 'New Project' })
    expect(result.id).toBeDefined()
    expect(result.id.length).toBe(8)

    const project = readProject(result.id)
    expect(project).not.toBeNull()
    expect(project!.title).toBe('New Project')
    expect(project!.status).toBe('draft')
    expect(project!.owner).toBe('main')
  })

  it('creates initial checklist items', async () => {
    const result = await createProject({ title: 'With Tasks', tasks: ['Task A', 'Task B'] })
    expect(result.taskItems).toHaveLength(2)
    expect(result.taskItems[0].title).toBe('Task A')
    expect(result.taskItems[1].title).toBe('Task B')

    const project = readProject(result.id)
    expect(project!.tasks).toHaveLength(2)
    expect(project!.tasks[0].id).toBe('t001')
    expect(project!.tasks[1].id).toBe('t002')
  })

  it('accepts optional body and owner', async () => {
    const result = await createProject({ title: 'Custom', body: '# Hello', owner: 'scout' })
    const project = readProject(result.id)
    expect(project!.body).toBe('# Hello')
    expect(project!.owner).toBe('scout')
  })
})

describe('updateProject', () => {
  it('updates title and status', async () => {
    const { id } = await createProject({ title: 'Original' })
    await updateProject(id, { title: 'Updated', status: 'active' })

    const project = readProject(id)
    expect(project!.title).toBe('Updated')
    expect(project!.status).toBe('active')
  })

  it('prevents completing with unchecked items', async () => {
    const { id } = await createProject({ title: 'Incomplete', tasks: ['Task'] })
    await expect(updateProject(id, { status: 'completed' })).rejects.toThrow('unchecked items')
  })

  it('allows completing when all items checked', async () => {
    const { id } = await createProject({ title: 'Complete', tasks: ['Task'] })
    await markChecklistItem(id, 't001', true)
    await updateProject(id, { status: 'completed' })

    const project = readProject(id)
    expect(project!.status).toBe('completed')
  })

  it('throws for non-existent project', async () => {
    await expect(updateProject('nonexistent', { title: 'Nope' })).rejects.toThrow('not found')
  })
})

describe('deleteProject', () => {
  it('deletes a project', async () => {
    const { id } = await createProject({ title: 'To Delete' })
    await deleteProject(id)
    expect(readProject(id)).toBeNull()
  })

  it('throws for non-existent project', async () => {
    await expect(deleteProject('nonexistent')).rejects.toThrow('not found')
  })
})

// ---------------------------------------------------------------------------
// Checklist operations
// ---------------------------------------------------------------------------

describe('addChecklistItem', () => {
  it('adds an item and updates progress', async () => {
    const { id } = await createProject({ title: 'P', tasks: ['Existing'] })
    await markChecklistItem(id, 't001', true)

    const { taskItemId } = await addChecklistItem(id, 'New Item')
    expect(taskItemId).toBe('t002')

    const project = readProject(id)
    expect(project!.tasks).toHaveLength(2)
    expect(project!.tasks[1].title).toBe('New Item')
    expect(project!.progress).toBe(50) // 1 of 2 checked
  })
})

describe('markChecklistItem', () => {
  it('checks and unchecks items', async () => {
    const { id } = await createProject({ title: 'P', tasks: ['A', 'B'] })

    await markChecklistItem(id, 't001', true)
    let project = readProject(id)
    expect(project!.tasks[0].checked).toBe(true)
    expect(project!.progress).toBe(50)

    await markChecklistItem(id, 't001', false)
    project = readProject(id)
    expect(project!.tasks[0].checked).toBe(false)
    expect(project!.progress).toBe(0)
  })

  it('auto-completes active project when all checked', async () => {
    const { id } = await createProject({ title: 'P', tasks: ['Only'] })
    await updateProject(id, { status: 'active' })

    await markChecklistItem(id, 't001', true)
    const project = readProject(id)
    expect(project!.status).toBe('completed')
    expect(project!.progress).toBe(100)
  })

  it('does not auto-complete draft projects', async () => {
    const { id } = await createProject({ title: 'P', tasks: ['Only'] })

    await markChecklistItem(id, 't001', true)
    const project = readProject(id)
    expect(project!.status).toBe('draft') // stays draft
  })
})

describe('updateChecklistItem', () => {
  it('updates title and description', async () => {
    const { id } = await createProject({ title: 'P', tasks: ['Original'] })
    await updateChecklistItem(id, 't001', { title: 'Renamed', description: 'Details here' })

    const project = readProject(id)
    expect(project!.tasks[0].title).toBe('Renamed')
    expect(project!.tasks[0].description).toBe('Details here')
  })

  it('clears description with empty string', async () => {
    const { id } = await createProject({ title: 'P', tasks: ['Task'] })
    await updateChecklistItem(id, 't001', { description: 'First' })
    await updateChecklistItem(id, 't001', { description: '' })

    const project = readProject(id)
    expect(project!.tasks[0].description).toBeUndefined()
  })
})

describe('removeChecklistItem', () => {
  it('removes an item and updates progress', async () => {
    const { id } = await createProject({ title: 'P', tasks: ['A', 'B'] })
    await markChecklistItem(id, 't001', true)

    await removeChecklistItem(id, 't001')
    const project = readProject(id)
    expect(project!.tasks).toHaveLength(1)
    expect(project!.tasks[0].title).toBe('B')
    expect(project!.progress).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Task linking
// ---------------------------------------------------------------------------

describe('linkChecklistItem', () => {
  it('links a board task to a checklist item', async () => {
    const { id } = await createProject({ title: 'P', tasks: ['Task'] })
    await linkChecklistItem(id, 't001', 'board01')

    const project = readProject(id)
    expect(project!.tasks[0].taskId).toBe('board01')
  })
})

describe('promoteItemToTask', () => {
  it('creates a board task and links it', async () => {
    const { id } = await createProject({ title: 'P', tasks: ['Promote me'] })
    const result = await promoteItemToTask(id, 't001')

    expect(result.taskId).toBe('newtask1')
    expect(mockCreateTask).toHaveBeenCalledTimes(1)

    const project = readProject(id)
    expect(project!.tasks[0].taskId).toBe('newtask1')
  })

  it('rejects if already linked', async () => {
    const { id } = await createProject({ title: 'P', tasks: ['Linked'] })
    await linkChecklistItem(id, 't001', 'existing')

    await expect(promoteItemToTask(id, 't001')).rejects.toThrow('already linked')
  })
})

// ---------------------------------------------------------------------------
// Index
// ---------------------------------------------------------------------------

describe('rebuildIndex / getProjectForTask / getProjectTitleForTask', () => {
  it('indexes linked tasks', async () => {
    const { id } = await createProject({ title: 'Indexed', tasks: ['Task'] })
    await linkChecklistItem(id, 't001', 'board01')

    rebuildIndex()

    const entry = getProjectForTask('board01')
    expect(entry).toBeDefined()
    expect(entry!.projectId).toBe(id)
    expect(entry!.taskItemId).toBe('t001')

    const title = getProjectTitleForTask('board01')
    expect(title).toBe('Indexed')
  })

  it('returns undefined for unlinked tasks', () => {
    rebuildIndex()
    expect(getProjectForTask('nonexistent')).toBeUndefined()
    expect(getProjectTitleForTask('nonexistent')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Auto-check / Auto-unlink
// ---------------------------------------------------------------------------

describe('autoCheckLinkedItem', () => {
  it('checks the linked item when board task completes', async () => {
    const { id } = await createProject({ title: 'P', tasks: ['Auto'] })
    await linkChecklistItem(id, 't001', 'board01')
    rebuildIndex()

    await autoCheckLinkedItem('board01')

    const project = readProject(id)
    expect(project!.tasks[0].checked).toBe(true)
  })

  it('no-ops for unlinked board tasks', async () => {
    await autoCheckLinkedItem('unlinked')
    // Should not throw
  })
})

describe('autoUnlinkTask', () => {
  it('unlinks and unchecks when board task is deleted', async () => {
    const { id } = await createProject({ title: 'P', tasks: ['Unlink'] })
    await linkChecklistItem(id, 't001', 'board01')
    await markChecklistItem(id, 't001', true)
    rebuildIndex()

    await autoUnlinkTask('board01')

    const project = readProject(id)
    expect(project!.tasks[0].taskId).toBeUndefined()
    expect(project!.tasks[0].checked).toBe(false)
    expect(getProjectForTask('board01')).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

describe('attachAsset / detachAsset', () => {
  it('attaches and detaches assets', async () => {
    const { id } = await createProject({ title: 'P' })

    await attachAsset(id, '20260401-logo-a1b2c3d4.png', 'Logo')
    let project = readProject(id)
    expect(project!.assets).toHaveLength(1)
    expect(project!.assets[0]).toEqual({ filename: '20260401-logo-a1b2c3d4.png', label: 'Logo' })

    // Duplicate attach is ignored
    await attachAsset(id, '20260401-logo-a1b2c3d4.png')
    project = readProject(id)
    expect(project!.assets).toHaveLength(1)

    await detachAsset(id, '20260401-logo-a1b2c3d4.png')
    project = readProject(id)
    expect(project!.assets).toHaveLength(0)
  })

  it('detach no-ops for unattached asset', async () => {
    const { id } = await createProject({ title: 'P' })
    await detachAsset(id, 'nonexistent')
    // Should not throw
  })
})

// ---------------------------------------------------------------------------
// resolveLinkedTaskStatuses
// ---------------------------------------------------------------------------

describe('resolveLinkedTaskStatuses', () => {
  it('resolves linked task columns', async () => {
    const { id } = await createProject({ title: 'P', tasks: ['A', 'B'] })
    await linkChecklistItem(id, 't001', 'board01')
    await linkChecklistItem(id, 't002', 'missing99')

    const project = readProject(id)!
    const resolved = await resolveLinkedTaskStatuses(project)

    expect(resolved.resolvedTasks['board01']).toEqual({ column: 'todo', title: 'Board Task 1' })
    expect(resolved.resolvedTasks['missing99']).toBeNull() // not found on board
  })
})
