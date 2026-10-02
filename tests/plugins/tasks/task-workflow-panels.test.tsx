// @vitest-environment jsdom

import { afterEach, describe, expect, it, mock } from 'bun:test'
import { render, screen } from '@testing-library/react'
import '../../rtl-settle'

import {
  WorkflowPreview,
  WorkflowProgressPanel,
} from '../../../plugins/tasks/components/task-workflow-panels'
import type { TaskDetail } from '../../../plugins/tasks/components/use-task-detail'

afterEach(() => document.body.replaceChildren())

function model(overrides: Record<string, unknown> = {}): TaskDetail {
  return {
    activeWorkflowId: 'approval-copy',
    workflowId: 'approval-copy',
    workflows: [{
      filename: 'approval-copy.yaml',
      name: 'Approval copy',
      description: 'Draft, review, and approve launch copy.',
      stepCount: 2,
    }],
    wfDefinition: {
      name: 'approval-copy',
      steps: [
        { id: 'draft', type: 'agent', label: 'Draft copy' },
        { id: 'approve', type: 'gate', label: 'Approve copy' },
      ],
    },
    wfInstance: {
      instanceId: 'instance-1',
      workflowId: 'approval-copy',
      taskId: 'task-1',
      currentStepId: 'approve',
      status: 'pending_approval',
      stepStates: {
        draft: { status: 'complete' },
        approve: { status: 'pending_approval' },
      },
    },
    isGatePending: true,
    gateStep: { id: 'approve', type: 'gate', label: 'Approve copy' },
    outputLoading: false,
    outputUnavailable: false,
    priorStepOutput: null,
    fetchPriorOutput: mock(),
    ...overrides,
  } as unknown as TaskDetail
}

describe('task workflow drawer panels', () => {
  it('uses one vertical workflow-step language for progress and preview', () => {
    const m = model()
    const { rerender } = render(<WorkflowProgressPanel m={m} />)

    const progress = document.querySelector('[data-workflow-step-list]')
    expect(progress?.getAttribute('data-orientation')).toBe('vertical')
    expect(screen.getByText('Complete').closest('[data-status-badge]')?.getAttribute('data-tone')).toBe('success')
    expect(screen.getByText('Pending Approval').closest('[data-status-badge]')?.getAttribute('data-tone')).toBe('attention')

    rerender(<WorkflowPreview m={m} />)
    expect(document.querySelector('[data-workflow-step-list]')?.getAttribute('data-orientation')).toBe('vertical')
    expect(screen.getByText('Draft, review, and approve launch copy.')).toBeTruthy()
  })
})
