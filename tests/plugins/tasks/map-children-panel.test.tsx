/**
 * MapChildrenPanel (#203 PR3): live rollup + per-child retry/cancel on the
 * task detail panel, and the typed map_source_invalid recovery banner.
 * Pure component test — data-layer handlers are stubbed.
 */
import { describe, it, expect, afterEach, mock } from 'bun:test'
import React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import '../../rtl-settle'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-map-panel-${Date.now()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))
mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('@/core/task-store', () => ({
  getTask: mock(),
  createTask: mock(),
  moveTask: mock(),
  addTaskLog: mock(),
}))

import { MapChildrenPanel } from '../../../plugins/tasks/components/task-workflow-panels'
import type { TaskDetail } from '../../../plugins/tasks/components/use-task-detail'

function makeModel(overrides: Record<string, unknown> = {}): TaskDetail {
  return {
    wfInstance: {
      instanceId: 'i1',
      workflowId: 'image-multi-select',
      taskId: 'task-1',
      currentStepId: 'generate-variants',
      status: 'in_progress',
      stepStates: {
        'generate-variants': {
          status: 'in_progress',
          children: [
            { index: 0, childTaskId: 'task-1--generate-variants--0', status: 'complete' },
            { index: 1, childTaskId: 'task-1--generate-variants--1', status: 'in_progress' },
            { index: 2, childTaskId: 'task-1--generate-variants--2', status: 'in_progress' },
          ],
        },
      },
    },
    wfDefinition: {
      name: 'image-multi-select',
      steps: [
        { id: 'develop-prompt', type: 'agent', label: 'Develop Prompt' },
        { id: 'generate-variants', type: 'map_workflow', label: 'Generate Variants', source: 'develop-prompt.variants' },
      ],
    },
    mapStepId: 'generate-variants',
    mapChildren: [
      // Live status disagrees with the cached entry for child 2 (cancelled out of band).
      { index: 2, childTaskId: 'task-1--generate-variants--2', entryStatus: 'in_progress', liveStatus: 'cancelled' },
    ],
    mapActionLoading: false,
    handleMapChildAction: mock(),
    failedStep: null,
    handleReopenWorkflow: mock(),
    ...overrides,
  } as unknown as TaskDetail
}

describe('MapChildrenPanel', () => {
  it('renders the rollup and per-child rows with live statuses winning', () => {
    render(<MapChildrenPanel m={makeModel()} />)
    expect(screen.getByText('1/3 complete · 1 cancelled')).toBeTruthy()
    expect(screen.getByText('task-1--generate-variants--0')).toBeTruthy()
    // Child 2's live status (cancelled) wins over the cached in_progress entry.
    expect(screen.getByText('Cancelled')).toBeTruthy()
  })

  it('offers retry on non-complete children and cancel on live ones', () => {
    const m = makeModel()
    render(<MapChildrenPanel m={m} />)
    const retries = screen.getAllByText('Retry')
    // children 1 (in_progress) and 2 (cancelled) are retryable; child 0 is complete.
    expect(retries).toHaveLength(2)
    fireEvent.click(retries[0])
    expect(m.handleMapChildAction).toHaveBeenCalledWith('retry', 1)
    // only child 1 is live → one cancel button.
    const cancels = screen.getAllByText('Cancel')
    expect(cancels).toHaveLength(1)
    fireEvent.click(cancels[0])
    expect(m.handleMapChildAction).toHaveBeenCalledWith('cancel', 1)
  })

  it('renders nothing without an active map step', () => {
    const { container } = render(<MapChildrenPanel m={makeModel({ mapStepId: null, mapChildren: [] })} />)
    expect(container.textContent).toBe('')
  })

  it('shows the typed failure banner and re-runs the source step', () => {
    const m = makeModel({
      failedStep: {
        stepId: 'generate-variants',
        status: 'failed',
        code: 'map_source_invalid',
        error: 'source "develop-prompt.variants" must resolve to an array',
      },
    })
    render(<MapChildrenPanel m={m} />)
    expect(screen.getByText('map_source_invalid')).toBeTruthy()
    expect(screen.getByText(/must resolve to an array/)).toBeTruthy()
    fireEvent.click(screen.getByText('Re-run source step'))
    // The source step id is derived from the failed map step's source field.
    expect(m.handleReopenWorkflow).toHaveBeenCalledWith('develop-prompt')
  })
})
