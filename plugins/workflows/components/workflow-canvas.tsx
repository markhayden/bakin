'use client'

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
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

/** Strip default ReactFlow node chrome so only our styled components show */
const RESET_NODE_STYLES = `
  .react-flow__node {
    background: transparent !important;
    border: none !important;
    box-shadow: none !important;
    padding: 0 !important;
    border-radius: 0 !important;
  }
`

import { getNodeRendererSnapshot, subscribeNodeRenderers } from '../lib/node-renderer-registry'
import type { WorkflowDefinition, WorkflowStep, WorkflowSkillDriftSummary } from '../types'

const NODE_WIDTH = 280
const NODE_HEIGHT = 120
const Y_SPACING = 164
const STANDARD_NODE_STYLE = { width: NODE_WIDTH, height: NODE_HEIGHT }
const SUBFLOW_PADDING_X = 30
const SUBFLOW_PADDING_TOP = 48
const SUBFLOW_PADDING_BOTTOM = 32

interface WorkflowCanvasProps {
  definition: WorkflowDefinition
  subWorkflows?: Record<string, WorkflowDefinition>
  skillDrift?: WorkflowSkillDriftSummary
  onNodeClick?: (nodeId: string) => void
}

/** Map a step type to its ReactFlow node type */
function stepNodeType(step: WorkflowStep): string {
  if (step.type === 'gate') return 'gate'
  if (step.type === 'parallel') return 'parallel'
  if (step.type === 'output') return 'output'
  if (step.type === 'workflow') return 'workflow'
  if (step.type === 'createTask') return 'createTask'
  return step.type
}

/** Build node data from a step */
function stepSkillNames(step: WorkflowStep): string[] {
  const skill = (step as { skill?: unknown }).skill
  const names = typeof skill === 'string' ? [skill] : []
  if (step.type === 'parallel') {
    for (const child of step.steps) {
      names.push(...stepSkillNames(child))
    }
  }
  return Array.from(new Set(names))
}

function stepNodeData(step: WorkflowStep, skillDrift?: WorkflowSkillDriftSummary) {
  const skill = (step as { skill?: unknown }).skill
  const skillName = typeof skill === 'string' ? skill : undefined
  const skillNames = stepSkillNames(step)
  const drift = skillNames.length > 0
    ? skillDrift?.reports.find(report => skillNames.includes(report.skillName))
    : undefined
  return {
    label: step.label,
    skill: skillName,
    skillDrift: drift,
    agent: step.type === 'agent' || step.type === 'output' || step.type === 'createTask'
      ? step.agent
      : undefined,
    task: step.type === 'agent' ? step.task : undefined,
    title: step.type === 'createTask' ? step.title : undefined,
    column: step.type === 'createTask' ? step.column : undefined,
    channels: step.type === 'output' ? step.channels : undefined,
    description: step.type === 'gate' ? step.description
      : step.type === 'workflow' ? step.description
      : step.type === 'map_workflow' ? step.description
      : step.type === 'output' ? step.description
      : step.type === 'createTask' ? step.description
      : undefined,
    workflow_id: step.type === 'workflow' || step.type === 'map_workflow'
      ? (step as { workflow_id?: string }).workflow_id
      : undefined,
    source: step.type === 'map_workflow' ? (step as { source?: string }).source : undefined,
    max_children: step.type === 'map_workflow' ? (step as { max_children?: number }).max_children : undefined,
  }
}

function measureSubWorkflowStepCount(def: WorkflowDefinition, subWorkflows: Record<string, WorkflowDefinition>): number {
  let count = 0
  for (const step of def.steps) {
    if (step.type === 'workflow') {
      const wfId = (step as { workflow_id?: string }).workflow_id
      const subDef = wfId ? subWorkflows[wfId] : undefined
      if (subDef) {
        count += measureSubWorkflowStepCount(subDef, subWorkflows)
        continue
      }
    }
    count++
  }
  return count
}

function buildGraph(
  definition: WorkflowDefinition,
  subWorkflows: Record<string, WorkflowDefinition> = {},
  skillDrift?: WorkflowSkillDriftSummary,
) {
  const nodes: Node[] = []
  const edges: Edge[] = []

  let y = 0
  const centerX = 0

  // Trigger node
  const inputDesc = definition.inputs
    ? Object.entries(definition.inputs).map(([k, v]) => `${k}: ${v.description}`).join(', ')
    : 'No inputs'

  nodes.push({
    id: '__trigger',
    type: 'trigger',
    position: { x: centerX, y },
    data: { description: inputDesc },
    style: STANDARD_NODE_STYLE,
  })

  let prevNodeIds = ['__trigger']
  y += Y_SPACING

  /**
   * Emit steps for a definition, optionally inside a parent group.
   * Returns the IDs of the last emitted node(s).
   */
  function emitSteps(
    steps: WorkflowStep[],
    startY: number,
    parentId?: string,
    idPrefix?: string,
  ): { lastNodeIds: string[]; endY: number } {
    let cy = startY
    let prevIds = [...prevNodeIds]

    for (const step of steps) {
      const nodeId = idPrefix ? `${idPrefix}__${step.id}` : step.id

      // Check if this is a workflow step with a resolvable sub-definition
      if (step.type === 'workflow') {
        const wfId = (step as { workflow_id?: string }).workflow_id
        const subDef = wfId ? subWorkflows[wfId] : undefined

        if (subDef) {
          // Inline expansion — create a group node and emit sub-workflow steps inside it
          const subStepCount = measureSubWorkflowStepCount(subDef, subWorkflows)
          const groupHeight = SUBFLOW_PADDING_TOP
            + Math.max(0, subStepCount - 1) * Y_SPACING
            + NODE_HEIGHT
            + SUBFLOW_PADDING_BOTTOM
          const groupWidth = NODE_WIDTH + SUBFLOW_PADDING_X * 2
          const groupId = nodeId

          const groupPosition = parentId
            ? { x: -SUBFLOW_PADDING_X, y: cy - startY }
            : { x: centerX - SUBFLOW_PADDING_X, y: cy }

          nodes.push({
            id: groupId,
            type: 'subflowGroup',
            position: groupPosition,
            data: { label: step.label, workflow_id: wfId, width: groupWidth, height: groupHeight },
            style: { width: groupWidth, height: groupHeight },
            ...(parentId ? { parentId, extent: 'parent' as const } : {}),
          })

          // Edge from previous nodes to the group
          for (const prevId of prevIds) {
            edges.push({
              id: `${prevId}-${groupId}`,
              source: prevId,
              target: groupId,
            })
          }

          // Save prevNodeIds, emit children inside the group
          const savedPrev = prevNodeIds
          // First child node inside the group connects from group entry (no explicit edges — they flow through group handles)
          // We'll emit the sub-steps and wire them internally
          const innerStartY = SUBFLOW_PADDING_TOP
          let innerY = innerStartY
          let innerPrevIds: string[] = []

          for (const subStep of subDef.steps) {
            const subNodeId = `${groupId}__${subStep.id}`
            const subNodeType = stepNodeType(subStep)

            // Nested sub-workflow inside sub-workflow
            if (subStep.type === 'workflow') {
              const nestedWfId = (subStep as { workflow_id?: string }).workflow_id
              const nestedDef = nestedWfId ? subWorkflows[nestedWfId] : undefined
              if (nestedDef) {
                const nestedCount = measureSubWorkflowStepCount(nestedDef, subWorkflows)
                const nestedGroupHeight = SUBFLOW_PADDING_TOP
                  + Math.max(0, nestedCount - 1) * Y_SPACING
                  + NODE_HEIGHT
                  + SUBFLOW_PADDING_BOTTOM
                const nestedGroupWidth = NODE_WIDTH + SUBFLOW_PADDING_X * 2

                nodes.push({
                  id: subNodeId,
                  type: 'subflowGroup',
                  position: { x: 0, y: innerY },
                  data: { label: subStep.label, workflow_id: nestedWfId, width: nestedGroupWidth, height: nestedGroupHeight },
                  style: { width: nestedGroupWidth, height: nestedGroupHeight },
                  parentId: groupId,
                  extent: 'parent' as const,
                })

                for (const pId of innerPrevIds) {
                  edges.push({ id: `${pId}-${subNodeId}`, source: pId, target: subNodeId })
                }

                // Emit nested steps inside
                let nestedY = SUBFLOW_PADDING_TOP
                let nestedPrevIds: string[] = []

                for (const nestedStep of nestedDef.steps) {
                  const nestedNodeId = `${subNodeId}__${nestedStep.id}`
                  nodes.push({
                    id: nestedNodeId,
                    type: stepNodeType(nestedStep),
                    position: { x: SUBFLOW_PADDING_X, y: nestedY },
                    data: stepNodeData(nestedStep, skillDrift),
                    style: STANDARD_NODE_STYLE,
                    parentId: subNodeId,
                    extent: 'parent' as const,
                  })
                  for (const nPId of nestedPrevIds) {
                    edges.push({ id: `${nPId}-${nestedNodeId}`, source: nPId, target: nestedNodeId })
                  }
                  nestedPrevIds = [nestedNodeId]
                  nestedY += Y_SPACING
                }

                innerPrevIds = nestedPrevIds
                innerY += nestedGroupHeight + (Y_SPACING - NODE_HEIGHT)
                continue
              }
            }

            nodes.push({
              id: subNodeId,
              type: subNodeType,
              position: { x: SUBFLOW_PADDING_X, y: innerY },
              data: stepNodeData(subStep, skillDrift),
              style: STANDARD_NODE_STYLE,
              parentId: groupId,
              extent: 'parent' as const,
            })

            for (const pId of innerPrevIds) {
              edges.push({ id: `${pId}-${subNodeId}`, source: pId, target: subNodeId })
            }

            innerPrevIds = [subNodeId]
            innerY += Y_SPACING
          }

          prevNodeIds = savedPrev
          prevIds = [groupId]
          cy += groupHeight + (Y_SPACING - NODE_HEIGHT)
          continue
        }
      }

      // Regular step (or unresolvable workflow step — falls back to workflow node)
      const nodeType = stepNodeType(step)

      const position = parentId
        ? { x: SUBFLOW_PADDING_X, y: cy - startY }
        : { x: centerX, y: cy }

      nodes.push({
        id: nodeId,
        type: nodeType,
        position,
        data: stepNodeData(step, skillDrift),
        style: STANDARD_NODE_STYLE,
        ...(parentId ? { parentId, extent: 'parent' as const } : {}),
      })

      for (const prevId of prevIds) {
        edges.push({
          id: `${prevId}-${nodeId}`,
          source: prevId,
          target: nodeId,
        })
      }

      prevIds = [nodeId]
      cy += Y_SPACING
    }

    return { lastNodeIds: prevIds, endY: cy }
  }

  const result = emitSteps(definition.steps, y)
  prevNodeIds = result.lastNodeIds

  return { nodes, edges }
}

export function WorkflowCanvas({ definition, subWorkflows, skillDrift, onNodeClick }: WorkflowCanvasProps) {
  // Subscribe to registry mutations so late-arriving kinds (lazy plugin
  // load, hot install) trigger a re-render — ESM hoisting means a
  // module-scope snapshot would be empty, and a one-shot mount-time memo
  // would miss anything registered after the canvas mounts.
  const nodeTypes = useSyncExternalStore(subscribeNodeRenderers, getNodeRendererSnapshot, getNodeRendererSnapshot) as NodeTypes
  const { nodes: initialNodes, edges } = useMemo(
    () => buildGraph(definition, subWorkflows, skillDrift),
    [definition, subWorkflows, skillDrift],
  )
  const [nodes, setNodes] = useState<Node[]>(initialNodes)

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes(nds => applyNodeChanges(changes, nds)),
    [],
  )

  // Reset nodes when definition changes.
  useEffect(() => {
    setNodes(initialNodes)
  }, [initialNodes])

  return (
    <div className="h-full w-full bg-bakin-canvas-default">
      <style dangerouslySetInnerHTML={{ __html: RESET_NODE_STYLES }} />
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onNodeClick={onNodeClick ? (_event, node) => onNodeClick(node.id) : undefined}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        proOptions={{ hideAttribution: true }}
        nodesDraggable={true}
        nodesConnectable={false}
        defaultEdgeOptions={{
          style: { stroke: 'var(--bakin-color-border-subtle)', strokeWidth: 2 },
        }}
      >
        <Background variant={BackgroundVariant.Dots} color="var(--bakin-color-border-subtle)" gap={24} size={1.5} />
        <Controls showInteractive={false} />
        <MiniMap
          className="hidden md:block"
          nodeColor="var(--bakin-color-border-subtle)"
          maskColor="rgb(15 14 14 / 0.78)"
        />
      </ReactFlow>
    </div>
  )
}
