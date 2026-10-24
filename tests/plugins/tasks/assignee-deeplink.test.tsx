/**
 * `/tasks?taskId=<id>&field=assignee` (self-healing PR1 slice 1.4b; row 118):
 * the edit form focuses the assignee control when it opens with that field.
 */
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { act, cleanup, render, waitFor } from '@testing-library/react'
import '../../rtl-settle'

mock.module('@makinbakin/sdk/slots', () => ({ Slot: () => null }))
mock.module('@makinbakin/sdk/content', () => ({ MarkdownContent: ({ content }: { content: string }) => <p>{content}</p> }))
mock.module('../../../plugins/tasks/components/task-workflow-panels', () => ({ TaskApprovalsPanel: () => null, WorkflowProgressPanel: () => null, WorkflowPreview: () => null, MapChildrenPanel: () => null }))
mock.module('../../../plugins/tasks/components/task-notes-section', () => ({ TaskNotesSection: () => null }))
mock.module('../../../plugins/tasks/components/task-run-history', () => ({ TaskRunHistory: () => null }))

import { TaskDetailForm } from '../../../plugins/tasks/components/task-detail-modes'
import type { TaskDetail } from '../../../plugins/tasks/components/use-task-detail'
import type { Task } from '../../../plugins/tasks/types'

afterEach(cleanup)

function detail(): TaskDetail {
  return {
    title: 'Publish launch notes', setTitle: mock(), description: '', setDescription: mock(), agent: 'ghost', setAgent: mock(), column: 'todo', setColumn: mock(),
    workflowId: '', setWorkflowId: mock(), workflows: [], brandId: '', setBrandId: mock(), brands: [], availableAt: '', setAvailableAt: mock(), dueAt: '', setDueAt: mock(),
    repoPath: '', setRepoPath: mock(), projectId: '', setProjectId: mock(), projects: [], priority: 'normal', setPriority: mock(), tags: '', setTags: mock(),
    isCreate: false, taskAgentMeta: null, agentOptions: [{ id: 'main', name: 'Main' }], teamOptions: [], markDirty: mock(), handleDescriptionPaste: mock(), handleSave: mock(), handleAddLog: mock(),
    saving: false, dirty: false, error: null, logs: [], logsLoading: false, newLog: '', setNewLog: mock(), guard: { requestExit: mock(), reset: mock(), dialog: null },
  } as unknown as TaskDetail
}
const task = { id: 't1', title: 'Publish launch notes', agent: 'ghost', createdAt: 'x', updatedAt: 'x' } as unknown as Task

describe('assignee deep link', () => {
  it('focuses the assignee control when the form opens with field=assignee, and nothing without it', async () => {
    await act(async () => { render(<TaskDetailForm m={detail()} task={task} columnId="todo" open onClose={() => {}} onCancelEdit={() => {}} focusField="assignee" />) })
    await waitFor(() => expect(document.activeElement?.id).toBe('task-assignee'))
    cleanup()
    await act(async () => { render(<TaskDetailForm m={detail()} task={task} columnId="todo" open onClose={() => {}} onCancelEdit={() => {}} />) })
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)))
    expect(document.activeElement?.id).not.toBe('task-assignee')
  })
})
