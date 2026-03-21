'use client'

import { useCallback, useMemo, useState } from 'react'
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeTypes,
  type NodeChange,
  applyNodeChanges,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'

import { TriggerNode } from './nodes/trigger-node'
import { AgentNode } from './nodes/agent-node'
import { GateNode } from './nodes/gate-node'
import { ParallelNode } from './nodes/parallel-node'
import { OutputNode } from './nodes/output-node'
import type { WorkflowDefinition } from '../types'

const nodeTypes: NodeTypes = {
  trigger: TriggerNode,
  agent: AgentNode,
  gate: GateNode,
  parallel: ParallelNode,
  output: OutputNode,
}

const NODE_WIDTH = 320
const NODE_HEIGHT = 140
const X_SPACING = 400
const Y_SPACING = 200
const PARALLEL_PADDING = 40

interface WorkflowCanvasProps {
  definition: WorkflowDefinition
}

function buildGraph(definition: WorkflowDefinition) {
  const nodes: Node[] = []
  const edges: Edge[] = []

  let x = 0

  // Trigger node
  const inputDesc = definition.inputs
    ? Object.entries(definition.inputs).map(([k, v]) => `${k}: ${v.description}`).join(', ')
    : 'No inputs'

  nodes.push({
    id: '__trigger',
    type: 'trigger',
    position: { x, y: 0 },
    data: { description: inputDesc },
  })

  let prevNodeIds = ['__trigger']
  x += X_SPACING

  for (const step of definition.steps) {
    if (step.type === 'parallel') {
      const subSteps = step.steps
      const totalHeight = subSteps.length * Y_SPACING
      const startY = -(totalHeight - Y_SPACING) / 2

      const containerHeight = totalHeight + PARALLEL_PADDING * 2
      const containerWidth = NODE_WIDTH + PARALLEL_PADDING * 2 + 30
      nodes.push({
        id: step.id,
        type: 'parallel',
        position: { x: x - 20, y: -(containerHeight - NODE_HEIGHT) / 2 },
        data: { label: step.label, width: containerWidth, height: containerHeight },
        style: { width: containerWidth, height: containerHeight },
      })

      const subNodeIds: string[] = []
      subSteps.forEach((sub, i) => {
        const subX = x + 30
        const subY = startY + i * Y_SPACING

        nodes.push({
          id: sub.id,
          type: sub.type === 'gate' ? 'gate' : 'agent',
          position: { x: subX, y: subY },
          data: {
            label: sub.label,
            agent: sub.type === 'agent' ? sub.agent : undefined,
            task: sub.type === 'agent' ? sub.task : undefined,
            description: sub.type === 'gate' ? sub.description : undefined,
          },
        })
        subNodeIds.push(sub.id)

        for (const prevId of prevNodeIds) {
          edges.push({
            id: `${prevId}-${sub.id}`,
            source: prevId,
            target: sub.id,
          })
        }
      })

      prevNodeIds = subNodeIds
      x += containerWidth + X_SPACING - 40
    } else {
      let nodeType: string = step.type
      if (nodeType !== 'gate' && nodeType !== 'output') {
        nodeType = 'agent'
      }

      nodes.push({
        id: step.id,
        type: nodeType,
        position: { x, y: 0 },
        data: {
          label: step.label,
          agent: step.type === 'agent' ? step.agent : undefined,
          task: step.type === 'agent' ? step.task : undefined,
          channels: step.type === 'output' ? step.channels : undefined,
          description: step.type === 'gate' ? step.description : undefined,
        },
      })

      for (const prevId of prevNodeIds) {
        edges.push({
          id: `${prevId}-${step.id}`,
          source: prevId,
          target: step.id,
        })
      }

      prevNodeIds = [step.id]
      x += X_SPACING
    }
  }

  return { nodes, edges }
}

export function WorkflowCanvas({ definition }: WorkflowCanvasProps) {
  const { nodes: initialNodes, edges } = useMemo(() => buildGraph(definition), [definition])
  const [nodes, setNodes] = useState<Node[]>(initialNodes)

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes(nds => applyNodeChanges(changes, nds)),
    [],
  )

  // Reset nodes when definition changes
  useMemo(() => {
    setNodes(initialNodes)
  }, [initialNodes])

  return (
    <div className="h-full w-full bg-zinc-950">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={true}
        nodesConnectable={false}
        defaultEdgeOptions={{
          style: { stroke: '#525252', strokeWidth: 2 },
        }}
      >
        <Background variant={BackgroundVariant.Dots} color="#3f3f46" gap={24} size={1.5} />
        <Controls
          showInteractive={false}
          className="[&>button]:border-zinc-700 [&>button]:bg-zinc-900 [&>button]:text-zinc-400 [&>button]:hover:bg-zinc-800"
        />
        <MiniMap
          nodeColor="#3f3f46"
          maskColor="rgba(0,0,0,0.7)"
          className="rounded-lg border border-zinc-800 bg-zinc-900"
        />
      </ReactFlow>
    </div>
  )
}
