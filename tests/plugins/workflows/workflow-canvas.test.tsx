// @vitest-environment jsdom

import { afterEach, describe, expect, it, mock } from 'bun:test'
import { render, screen } from '@testing-library/react'
import '../../rtl-settle'
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
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@/core/task-store', () => ({}))

interface ReactFlowStubProps {
  children?: ReactNode
  nodes?: Array<{ id: string; type?: string; data?: Record<string, unknown> }>
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
            data-has-skill-drift={Boolean(node.data?.skillDrift)}
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

  it('renders a map_workflow step as its own node type', () => {
    const definition: WorkflowDefinition = {
      name: 'Map workflow',
      description: 'Fan out',
      version: 1,
      steps: [
        { id: 'seg', type: 'agent', label: 'Segment', agent: 'chef' },
        { id: 'fan', type: 'map_workflow', label: 'Fan', source: 'seg.items', workflow_id: 'child' } as unknown as WorkflowStep,
      ],
    }

    render(<WorkflowCanvas definition={definition} />)

    expect(screen.getByTestId('node-fan').getAttribute('data-node-type')).toBe('map_workflow')
  })

  it('passes stale skill drift through node data for highlighted steps', () => {
    const definition: WorkflowDefinition = {
      name: 'Image workflow',
      description: 'Uses a generated image skill',
      version: 1,
      steps: [{
        id: 'generate',
        type: 'agent',
        label: 'Generate',
        agent: 'pixel',
        skill: 'generate-image',
      }],
    }

    render(
      <WorkflowCanvas
        definition={definition}
        skillDrift={{
          count: 1,
          repairableCount: 0,
          skills: ['generate-image'],
          byStep: { generate: ['generate-image'] },
          reports: [{
            skillName: 'generate-image',
            filePath: '/tmp/generate-image.md',
            currentSha256: 'old',
            managedSource: { kind: 'plugin', id: 'images', skillName: 'generate-image' },
            findings: [],
            userEdited: false,
            installedBy: null,
            repairability: 'custom-advisory',
            repairable: false,
          }],
        }}
      />,
    )

    expect(screen.getByTestId('node-generate').getAttribute('data-has-skill-drift')).toBe('true')
  })

  it('passes child stale skill drift through parallel group node data', () => {
    const definition: WorkflowDefinition = {
      name: 'Parallel image workflow',
      description: 'Uses a generated image skill inside a parallel group',
      version: 1,
      steps: [{
        id: 'parallel-work',
        type: 'parallel',
        label: 'Parallel Work',
        steps: [{
          id: 'generate',
          type: 'agent',
          label: 'Generate',
          agent: 'pixel',
          skill: 'generate-image',
        }],
      }],
    }

    render(
      <WorkflowCanvas
        definition={definition}
        skillDrift={{
          count: 1,
          repairableCount: 0,
          skills: ['generate-image'],
          byStep: { generate: ['generate-image'] },
          reports: [{
            skillName: 'generate-image',
            filePath: '/tmp/generate-image.md',
            currentSha256: 'old',
            managedSource: { kind: 'plugin', id: 'images', skillName: 'generate-image' },
            findings: [],
            userEdited: false,
            installedBy: null,
            repairability: 'custom-advisory',
            repairable: false,
          }],
        }}
      />,
    )

    expect(screen.getByTestId('node-parallel-work').getAttribute('data-has-skill-drift')).toBe('true')
  })
})
