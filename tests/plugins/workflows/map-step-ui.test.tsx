/**
 * map_workflow UI (#203 PR3): canvas node renderer + step-detail-drawer
 * definitional section. The canvas renders definitions only — live child
 * state surfaces on the task detail panel (tasks plugin), tested there.
 */
import { describe, it, expect, afterEach, mock } from 'bun:test'
import React from 'react'
import { act, render, screen } from '@testing-library/react'
import '../../rtl-settle'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-map-ui-${Date.now()}`)

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
// Node components render Handles that need a ReactFlow provider — stub them.
mock.module('@xyflow/react', () => ({
  Handle: () => null,
  Position: { Top: 'top', Bottom: 'bottom' },
}))

import { MapWorkflowNode } from '../../../plugins/workflows/components/nodes/map-workflow-node'
import { StepDetailDrawer } from '../../../plugins/workflows/components/step-detail-drawer'
import type { MapWorkflowStep } from '../../../plugins/workflows/types'
import type { NodeProps } from '@xyflow/react'

const mapStep: MapWorkflowStep = {
  id: 'generate-variants',
  type: 'map_workflow',
  label: 'Generate Variants',
  source: 'develop-prompt.variants',
  workflow_id: 'image-variant',
  item_key: 'variant',
  max_children: 3,
  description: 'One child per variant directive',
}

describe('MapWorkflowNode', () => {
  it('renders label, child workflow id, and the fan-out source', async () => {
    await act(async () => {
      render(
        <MapWorkflowNode
          {...({ data: {
            label: mapStep.label,
            workflow_id: mapStep.workflow_id,
            source: mapStep.source,
            max_children: mapStep.max_children,
          } } as unknown as NodeProps)}
        />,
      )
    })
    expect(screen.getByText('Generate Variants')).toBeTruthy()
    expect(screen.getByText('image-variant')).toBeTruthy()
    expect(screen.getByText(/develop-prompt\.variants/)).toBeTruthy()
    expect(screen.getByText(/Map Fan-out/i)).toBeTruthy()
  })
})

describe('StepDetailDrawer — map_workflow', () => {
  it('shows the definitional map fields', async () => {
    await act(async () => {
      render(
        <StepDetailDrawer
          step={mapStep}
          open={true}
          onOpenChange={() => {}}
        />,
      )
    })
    expect(screen.getByText('image-variant')).toBeTruthy()
    expect(screen.getByText('develop-prompt.variants')).toBeTruthy()
    expect(screen.getByText('variant')).toBeTruthy()
    expect(screen.getByText('3')).toBeTruthy()
    expect(screen.getByText('One child per variant directive')).toBeTruthy()
  })
})
