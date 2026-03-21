'use client'

import { useMemo } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type Node,
  type Edge,
  type NodeTypes,
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

const NODE_WIDTH = 260
const NODE_HEIGHT = 120
const Y_SPACING = 200
const X_SPACING = 300
const PARALLEL_PADDING = 40

interface WorkflowCanvasProps {
  definition: WorkflowDefinition
}

function buildGraph(definition: WorkflowDefinition) {
  const nodes: Node[] = []
  const edges: Edge[] = []

  let y = 0

  // Trigger node
  const inputDesc = definition.inputs
    ? Object.entries(definition.inputs).map(([k, v]) => `${k}: ${v.description}`).join(', ')
    : 'No inputs'

  nodes.push({
    id: '__trigger',
    type: 'trigger',
    position: { x: 0, y },
    data: { description: inputDesc },
  })

  let prevNodeIds = ['__trigger']
  y += Y_SPACING

  for (const step of definition.steps) {
    if (step.type === 'parallel') {
      const subSteps = step.steps
      const totalWidth = subSteps.length * X_SPACING
      const startX = -(totalWidth - X_SPACING) / 2

      const containerWidth = totalWidth + PARALLEL_PADDING * 2
      const containerHeight = NODE_HEIGHT + PARALLEL_PADDING * 2 + 30
      nodes.push({
        id: step.id,
        type: 'parallel',
        position: { x: -(containerWidth - NODE_WIDTH) / 2, y: y - 20 },
        data: { label: step.label, width: containerWidth, height: containerHeight },
        style: { width: containerWidth, height: containerHeight },
      })

      const subNodeIds: string[] = []
      subSteps.forEach((sub, i) => {
        const subX = startX + i * X_SPACING
        const subY = y + 30

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
      y += containerHeight + Y_SPACING - 40
    } else {
      let nodeType: string = step.type
      if (nodeType !== 'gate' && nodeType !== 'output') {
        nodeType = 'agent'
      }

      nodes.push({
        id: step.id,
        type: nodeType,
        position: { x: 0, y },
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
      y += Y_SPACING
    }
  }

  return { nodes, edges }
}

export function WorkflowCanvas({ definition }: WorkflowCanvasProps) {
  const { nodes, edges } = useMemo(() => buildGraph(definition), [definition])

  return (
    <div className="h-full w-full bg-zinc-950">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        defaultEdgeOptions={{
          style: { stroke: '#525252', strokeWidth: 2 },
        }}
      >
        <Background color="#27272a" gap={20} />
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
