// @vitest-environment jsdom

import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import '../../rtl-settle'

mock.module('@makinbakin/sdk/slots', () => ({
  Slot: () => null,
}))

mock.module('@makinbakin/sdk/content', () => ({
  MarkdownContent: ({ content }: { content: string }) => <p>{content}</p>,
}))

mock.module('../../../plugins/tasks/components/task-workflow-panels', () => ({
  GateApprovalPanel: () => null,
  WorkflowProgressPanel: () => null,
  WorkflowPreview: () => null,
  MapChildrenPanel: () => null,
}))

mock.module('../../../plugins/tasks/components/task-notes-section', () => ({
  TaskNotesSection: () => null,
}))

mock.module('../../../plugins/tasks/components/task-run-history', () => ({
  TaskRunHistory: () => null,
}))

import { TaskDetailForm, TaskDetailView } from '../../../plugins/tasks/components/task-detail-modes'
import type { TaskDetail } from '../../../plugins/tasks/components/use-task-detail'
import type { Task } from '../../../plugins/tasks/types'

afterEach(cleanup)

function taskDetail(overrides: Partial<TaskDetail> = {}): TaskDetail {
  return {
    title: 'Publish launch notes',
    setTitle: mock(),
    description: 'Coordinate the final launch handoff.',
    setDescription: mock(),
    agent: 'margo',
    setAgent: mock(),
    column: 'review',
    setColumn: mock(),
    workflowId: 'approval-copy',
    setWorkflowId: mock(),
    workflows: [{ filename: 'approval-copy.yaml', name: 'Approval copy', stepCount: 3 }],
    brandId: '',
    setBrandId: mock(),
    brands: [{ id: 'bakin', name: 'Bakin' }],
    saving: false,
    dirty: true,
    pasting: false,
    descriptionRef: createRef<HTMLTextAreaElement>(),
    logMessage: '',
    setLogMessage: mock(),
    addingLog: false,
    showAllNotes: false,
    setShowAllNotes: mock(),
    isCreate: true,
    wfInstance: null,
    wfDefinition: null,
    rejectReason: '',
    setRejectReason: mock(),
    showRejectInput: false,
    setShowRejectInput: mock(),
    gateLoading: false,
    isGatePending: false,
    gateStep: undefined,
    activeWorkflowId: 'approval-copy',
    priorStepOutput: null,
    outputLoading: false,
    outputUnavailable: false,
    fetchPriorOutput: mock(),
    mapStepId: null,
    mapChildren: [],
    mapActionLoading: false,
    handleMapChildAction: mock(),
    failedStep: null,
    handleReopenWorkflow: mock(),
    taskAgentMeta: {
      id: 'margo',
      name: 'Margo',
      headshot: '/agents/margo.webp',
    },
    agentOptions: [{ id: 'margo', name: 'Margo', imageSrc: '/agents/margo.webp' }],
    teamOptions: [{ id: 'content', label: 'Content' }],
    markDirty: mock(),
    handleDescriptionPaste: mock(),
    handleSave: mock(),
    handleAddLog: mock(),
    handleApproveGate: mock(),
    handleRejectGate: mock(),
    ...overrides,
  } as TaskDetail
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-launch',
    title: 'Publish launch notes',
    checked: false,
    agent: 'margo',
    workflowId: 'approval-copy',
    description: 'Coordinate the final launch handoff.',
    ...overrides,
  }
}

describe('Task detail modes', () => {
  it('uses the canonical form contract for create mode', () => {
    const m = taskDetail()

    render(
      <TaskDetailForm
        m={m}
        task={null}
        columnId={null}
        open
        onClose={mock()}
        onCancelEdit={mock()}
      />,
    )

    const form = screen.getByRole('form', { name: 'Create task' })
    expect(form.getAttribute('data-slot')).toBe('form')
    expect((screen.getByRole('textbox', { name: 'Title' }) as HTMLInputElement).value).toBe('Publish launch notes')
    expect((screen.getByRole('textbox', { name: 'Details' }) as HTMLTextAreaElement).value).toBe('Coordinate the final launch handoff.')
    expect(form.querySelectorAll('[data-slot="field"]').length).toBeGreaterThanOrEqual(5)
    expect(form.querySelector('[data-slot="form-actions"]')).toBeTruthy()

    fireEvent.submit(form)
    expect(m.handleSave).toHaveBeenCalledTimes(1)
  })

  it('uses a labelled task action menu and solid status language in view mode', () => {
    const m = taskDetail({ isCreate: false })

    render(
      <TaskDetailView
        m={m}
        task={task()}
        columnId="review"
        open
        onClose={mock()}
        onEdit={mock()}
        onDelete={mock()}
        onDuplicate={mock()}
      />,
    )

    expect(screen.getByRole('dialog', { name: 'Publish launch notes' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Task actions' })).toBeTruthy()
    const hero = document.querySelector('[data-task-detail-hero]')
    expect(hero).toBeTruthy()
    expect(hero?.querySelector('[data-status-badge="attention"]')?.getAttribute('data-variant')).toBe('solid')
    expect(hero?.textContent).toContain('Approval copy')
    expect(hero?.querySelectorAll('[data-status-badge]')).toHaveLength(1)
  })

  it('keeps note submission outside the edit form instead of nesting forms', () => {
    const m = taskDetail({ isCreate: false })

    render(
      <TaskDetailForm
        m={m}
        task={task()}
        columnId="review"
        open
        onClose={mock()}
        onCancelEdit={mock()}
      />,
    )

    const editForm = screen.getByRole('form', { name: 'Edit task' })
    expect(editForm.querySelector('form')).toBeNull()
  })
})
