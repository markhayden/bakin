/**
 * Workflow Canvas Editor — pure graph/state model
 *
 * Layout constants, step→node-data mapping, id/body builders, the legacy-layout
 * heuristics, and the seed/derive/auto-arrange functions over EditorState. All
 * pure (operate on EditorState + WorkflowDefinition + xyflow types + dagre);
 * zero JSX. Extracted from workflow-canvas-editor.tsx so the graph logic is
 * unit-testable without jsdom, following the lib/dagre-layout precedent.
 */
import type { Node, Edge } from '@xyflow/react'
import type { WorkflowDefinition, WorkflowStep, NodePosition } from '../types'
import { layoutNodes } from './dagre-layout'

export const NODE_WIDTH = 280
export const NODE_HEIGHT = 120
export const Y_SPACING = 164
export const LEGACY_COMPACT_Y_SPACING = 130
export const STANDARD_NODE_STYLE = { width: NODE_WIDTH, height: NODE_HEIGHT }
export const TRIGGER_NODE_ID = '__trigger'
export const APPEND_NODE_ID = '__append'
export const RESERVED_STEP_IDS = [TRIGGER_NODE_ID, APPEND_NODE_ID]

export const BUILTIN_STEP_LABELS: Record<string, string> = {
  agent: 'Agent Task',
  gate: 'Approval Gate',
  parallel: 'Parallel Group',
  output: 'Completion',
  workflow: 'Nested Workflow',
  createTask: 'Create Task',
}

export interface EditorState {
  steps: Record<string, WorkflowStep>
  order: string[]
  positions: Record<string, NodePosition>
  measurements: Record<string, { width?: number; height?: number }>
}

/** Build node data shown on the canvas from a step body. */
export function stepNodeData(step: WorkflowStep): Record<string, unknown> {
  const data: Record<string, unknown> = { label: step.label }
  if (step.type === 'agent') {
    data.agent = step.agent
    data.task = step.task
  } else if (step.type === 'gate') {
    data.description = step.description
  } else if (step.type === 'output') {
    data.agent = step.agent
    data.channels = step.channels
    data.description = step.description
  } else if (step.type === 'workflow') {
    data.description = step.description
    data.workflow_id = step.workflow_id
  } else if (step.type === 'createTask') {
    data.agent = step.agent
    data.title = step.title
    data.column = step.column
    data.description = step.description
  }
  return data
}

/** Generate a unique step id for a dropped kind. */
export function nextStepId(kind: string, existing: Set<string>): string {
  const base = kind.includes('.') ? kind.split('.').slice(1).join('-') : kind
  for (let i = 1; i < 1000; i++) {
    const candidate = i === 1 ? base : `${base}-${i}`
    if (!existing.has(candidate)) return candidate
  }
  return `${base}-${Date.now()}`
}

/** Build a default body for a newly-dropped step of the given kind. */
export function defaultStepBody(id: string, kind: string): WorkflowStep {
  const label = BUILTIN_STEP_LABELS[kind] ?? id
  // Builtins have known required fields; plugin kinds get a minimal shell.
  if (kind === 'agent') return { id, type: 'agent', label, agent: '$assigned' }
  if (kind === 'gate') return { id, type: 'gate', label, on_approve: '' }
  if (kind === 'output') return { id, type: 'output', label }
  if (kind === 'workflow') return { id, type: 'workflow', label, workflow_id: '' }
  if (kind === 'parallel') return { id, type: 'parallel', label, steps: [] }
  if (kind === 'createTask') return { id, type: 'createTask', label, title: '' }
  // Plugin kind — preserve `type` as-is; the drawer will validate against the
  // plugin's zodSchema when the user edits the node.
  return { id, type: kind, label: id } as unknown as WorkflowStep
}

export function cloneStep(step: WorkflowStep): WorkflowStep {
  if (typeof structuredClone === 'function') {
    return structuredClone(step)
  }
  return JSON.parse(JSON.stringify(step)) as WorkflowStep
}

export function looksLikeLegacyHorizontalLayout(order: string[], positions: Record<string, NodePosition>): boolean {
  if (order.length < 2) return false
  const coords = order.map((id) => positions[id])
  if (coords.some((pos) => !pos)) return false
  const xs = coords.map((pos) => pos.x)
  const ys = coords.map((pos) => pos.y)
  const xRange = Math.max(...xs) - Math.min(...xs)
  const yRange = Math.max(...ys) - Math.min(...ys)
  return xRange > NODE_WIDTH && yRange < 12
}

export function looksLikeLegacyCompactVerticalLayout(order: string[], positions: Record<string, NodePosition>): boolean {
  if (order.length < 2) return false
  const coords = order.map((id) => positions[id])
  if (coords.some((pos) => !pos)) return false

  const xs = coords.map((pos) => pos.x)
  const xRange = Math.max(...xs) - Math.min(...xs)
  if (xRange > 12) return false

  const yDeltas = coords.slice(1).map((pos, index) => pos.y - coords[index].y)
  return yDeltas.every((delta) => delta > 0 && delta <= LEGACY_COMPACT_Y_SPACING + 16)
}

export function seedEdges(
  order: string[],
  includeTrigger = false,
  onInsert?: (kind: string, index: number) => void,
  onOpenPalette?: () => void,
  includeAppendTarget = false,
): Edge[] {
  const edges: Edge[] = []
  const nodeOrder = includeTrigger
    ? [TRIGGER_NODE_ID, ...order]
    : order
  if (includeAppendTarget) nodeOrder.push(APPEND_NODE_ID)
  for (let i = 0; i < nodeOrder.length - 1; i++) {
    const source = nodeOrder[i]
    const target = nodeOrder[i + 1]
    edges.push({
      id: `${source}-${target}`,
      source,
      target,
      type: onInsert ? 'insertable' : undefined,
      data: onInsert && onOpenPalette
        ? { insertIndex: i, onInsert, onOpenPalette }
        : undefined,
    })
  }
  return edges
}

export function seedState(def: WorkflowDefinition): EditorState {
  const steps: Record<string, WorkflowStep> = {}
  const order: string[] = []
  for (const step of def.steps) {
    steps[step.id] = step
    order.push(step.id)
  }
  const edges = seedEdges(order, true)
  const seeded = def.layout?.positions

  // If the definition carries explicit positions, use them; otherwise run
  // dagre to give the canvas a sensible top-to-bottom layout instead of
  // stacking every node at (0, 0).
  let positions: Record<string, NodePosition>
  if (
    seeded &&
    Object.keys(seeded).length > 0 &&
    !looksLikeLegacyHorizontalLayout(order, seeded) &&
    !looksLikeLegacyCompactVerticalLayout(order, seeded)
  ) {
    positions = { ...seeded }
    for (let i = 0; i < order.length; i++) {
      if (!positions[order[i]]) positions[order[i]] = { x: 0, y: i * Y_SPACING }
    }
  } else {
    const bareNodes = [TRIGGER_NODE_ID, ...order].map((id) => ({
      id,
      position: { x: 0, y: 0 },
      data: {},
      style: STANDARD_NODE_STYLE,
    }))
    const arranged = layoutNodes(bareNodes, edges, {
      rankdir: 'TB',
      ranksep: Y_SPACING - NODE_HEIGHT,
      nodeWidth: NODE_WIDTH,
      nodeHeight: NODE_HEIGHT,
    })
    positions = {}
    for (const n of arranged) {
      if (n.id === TRIGGER_NODE_ID) continue
      positions[n.id] = { x: n.position.x, y: n.position.y }
    }
  }
  return { steps, order, positions, measurements: {} }
}

export function deriveNodes(state: EditorState): Node[] {
  const firstPosition = state.order.length > 0
    ? state.positions[state.order[0]]
    : undefined
  const lastId = state.order[state.order.length - 1]
  const lastPosition = lastId ? state.positions[lastId] : undefined
  const triggerNode: Node = {
    id: TRIGGER_NODE_ID,
    type: 'trigger',
    position: {
      x: firstPosition?.x ?? 0,
      y: (firstPosition?.y ?? Y_SPACING) - Y_SPACING,
    },
    data: {},
    measured: state.measurements[TRIGGER_NODE_ID],
    style: STANDARD_NODE_STYLE,
    selectable: false,
    draggable: false,
  }
  const stepNodes = state.order.map((id) => {
    const step = state.steps[id]
    const pos = state.positions[id] ?? { x: 0, y: 0 }
    return {
      id,
      type: step.type,
      position: { x: pos.x, y: pos.y },
      data: stepNodeData(step),
      measured: state.measurements[id],
      style: STANDARD_NODE_STYLE,
    }
  })
  const appendNode: Node = {
    id: APPEND_NODE_ID,
    type: 'appendStep',
    position: {
      x: lastPosition?.x ?? firstPosition?.x ?? 0,
      y: (lastPosition?.y ?? triggerNode.position.y) + Y_SPACING,
    },
    data: {},
    measured: state.measurements[APPEND_NODE_ID],
    style: { width: NODE_WIDTH },
    selectable: false,
    draggable: false,
  }
  return [triggerNode, ...stepNodes, appendNode]
}

export function autoArrangeState(state: EditorState): EditorState {
  const arranged = layoutNodes(deriveNodes(state), seedEdges(state.order, true), {
    rankdir: 'TB',
    ranksep: Y_SPACING - NODE_HEIGHT,
    nodeWidth: NODE_WIDTH,
    nodeHeight: NODE_HEIGHT,
  })
  const nextPositions: Record<string, NodePosition> = {}
  for (const n of arranged) {
    if (!(n.id in state.steps)) continue
    nextPositions[n.id] = { x: n.position.x, y: n.position.y }
  }
  return { ...state, positions: nextPositions }
}

export function samePosition(a: NodePosition | undefined, b: NodePosition): boolean {
  return a?.x === b.x && a?.y === b.y
}

export function sameMeasurement(
  a: { width?: number; height?: number } | undefined,
  b: { width?: number; height?: number },
): boolean {
  return a?.width === b.width && a?.height === b.height
}
