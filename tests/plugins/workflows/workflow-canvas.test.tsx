// @vitest-environment jsdom

import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import { join } from 'path'
import { tmpdir } from 'os'
import type { ReactNode } from 'react'

const testDir = join(tmpdir(), `bakin-test-workflow-canvas-${Date.now()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@/core/task-store', () => ({}))

interface ReactFlowStubProps {
  children?: ReactNode
  nodes?: Array<{ id: string; type?: string }>
  edges?: Array<{ id: string; source: string; target: string }>
  nodeTypes?: Record<string, unknown>
  onNodeClick?: (event: unknown, node: { id: string }) => void
}

mock.module('@xyflow/react', () => ({
  __esModule: true,
  ReactFlow: ({ children, nodes = [], edges = [], nodeTypes = {}, onNodeClick }: ReactFlowStubProps) => (
    <div data-testid="react-flow-stub" data-node-types={Object.keys(nodeTypes).sort().join(',')}>
      <div data-testid="flow-nodes">
        {nodes.map((node) => (
          <button
            key={node.id}
            type="button"
            data-testid={`node-${node.id}`}
            data-node-type={node.type}
            onClick={(event) => onNodeClick?.(event, node)}
          >
            {node.id}
          </button>
        ))}
      </div>
      <div data-testid="flow-edges">
        {edges.map((edge) => (
          <span key={edge.id} data-testid={`edge-${edge.source}-${edge.target}`} />
        ))}
      </div>
      {children}
    </div>
  ),
  Background: () => null,
  BackgroundVariant: { Dots: 'dots' },
  Controls: () => null,
  MiniMap: () => null,
  applyNodeChanges: (_changes: unknown, nodes: unknown) => nodes,
}))

import { WorkflowCanvas } from '../../../plugins/workflows/components/workflow-canvas'
import type { WorkflowDefinition, WorkflowStep } from '../../../plugins/workflows/types'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('WorkflowCanvas', () => {
  it('preserves plugin-owned step types so registered renderers can display them', () => {
    const pluginStep = {
      id: 'denoise',
      type: 'media.noise-gate',
      label: 'Denoise',
      threshold: 0.7,
    } as unknown as WorkflowStep
    const definition: WorkflowDefinition = {
      name: 'Plugin workflow',
      description: 'Uses a plugin node',
      version: 1,
      steps: [pluginStep],
    }

    render(<WorkflowCanvas definition={definition} />)

    expect(screen.getByTestId('node-denoise').getAttribute('data-node-type')).toBe('media.noise-gate')
  })
})
