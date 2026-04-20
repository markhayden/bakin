'use client'

/**
 * Editable workflow canvas.
 *
 * Drives the /workflows/{id}/edit and /workflows/new routes. Replaces the
 * form-driven WorkflowEditor.
 *
 * Source of truth: an internal `steps` record keyed by step id. Positions
 * and nodes are derived each render. When the drawer applies a patch we
 * mutate the step body; when a node is dragged we mutate positions; when
 * a palette item is dropped we mint a new step with a default body.
 *
 * Node renderers come from the NodeRendererRegistry (populated by the
 * plugin manifest at module load) so plugin-registered kinds work
 * without special-casing.
 */

import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  applyNodeChanges,
  applyEdgeChanges,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type NodeTypes,
  type ReactFlowInstance,
  type XYPosition,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Save } from 'lucide-react'
import { Button } from '@/components/ui/button'

// Side-effect import — guarantees the NodeRendererRegistry is populated
// before we snapshot it via getAllNodeRenderers().
import '@/lib/plugin-manifest'
import { getAllNodeRenderers } from '../lib/node-renderer-registry'
import { NodeTypePalette, PALETTE_DRAG_MIME_TYPE } from './node-type-palette'
import { NodeConfigDrawer } from './node-config-drawer'
import type {
  WorkflowDefinition,
  WorkflowStep,
  NodePosition,
} from '../types'

const RESET_NODE_STYLES = `
  .react-flow__node {
    background: transparent !important;
    border: none !important;
    box-shadow: none !important;
    padding: 0 !important;
    border-radius: 0 !important;
  }
`

const NODE_WIDTH = 280
const Y_SPACING = 130

const nodeTypes: NodeTypes = getAllNodeRenderers()

interface WorkflowCanvasEditorProps {
  mode: 'create' | 'edit'
  /** Required in edit mode — the id used in the PUT path. */
  initialId?: string
  initialDefinition: WorkflowDefinition
  source?: 'plugin' | 'user'
  onSaved?: (id: string) => void
  onCancel?: () => void
}

/** Build node data shown on the canvas from a step body. */
function stepNodeData(step: WorkflowStep): Record<string, unknown> {
  const data: Record<string, unknown> = { label: step.label }
  if (step.type === 'agent') {
    data.agent = step.agent
    data.task = step.task
  } else if (step.type === 'gate') {
    data.description = step.description
  } else if (step.type === 'output') {
    data.channels = step.channels
    data.description = step.description
  } else if (step.type === 'workflow') {
    data.description = step.description
    data.workflow_id = step.workflow_id
  }
  return data
}

/** Generate a unique step id for a dropped kind. */
function nextStepId(kind: string, existing: Set<string>): string {
  const base = kind.includes('.') ? kind.split('.').slice(1).join('-') : kind
  for (let i = 1; i < 1000; i++) {
    const candidate = i === 1 ? base : `${base}-${i}`
    if (!existing.has(candidate)) return candidate
  }
  return `${base}-${Date.now()}`
}

/** Build a default body for a newly-dropped step of the given kind. */
function defaultStepBody(id: string, kind: string): WorkflowStep {
  // Builtins have known required fields; plugin kinds get a minimal shell.
  if (kind === 'agent') return { id, type: 'agent', label: id, agent: '' }
  if (kind === 'gate') return { id, type: 'gate', label: id, on_approve: '' }
  if (kind === 'output') return { id, type: 'output', label: id }
  if (kind === 'workflow') return { id, type: 'workflow', label: id, workflow_id: '' }
  if (kind === 'parallel') return { id, type: 'parallel', label: id, steps: [] }
  // Plugin kind — preserve `type` as-is; the drawer will validate against the
  // plugin's zodSchema when the user edits the node.
  return { id, type: kind, label: id } as unknown as WorkflowStep
}

interface EditorState {
  steps: Record<string, WorkflowStep>
  order: string[]
  positions: Record<string, NodePosition>
}

function seedState(def: WorkflowDefinition): EditorState {
  const steps: Record<string, WorkflowStep> = {}
  const order: string[] = []
  const positions: Record<string, NodePosition> = { ...(def.layout?.positions ?? {}) }
  for (let i = 0; i < def.steps.length; i++) {
    const step = def.steps[i]
    steps[step.id] = step
    order.push(step.id)
    if (!positions[step.id]) {
      positions[step.id] = { x: 0, y: i * Y_SPACING }
    }
  }
  return { steps, order, positions }
}

function deriveNodes(state: EditorState): Node[] {
  return state.order.map((id) => {
    const step = state.steps[id]
    const pos = state.positions[id] ?? { x: 0, y: 0 }
    return {
      id,
      type: step.type,
      position: { x: pos.x, y: pos.y },
      data: stepNodeData(step),
      style: { width: NODE_WIDTH },
    }
  })
}

function deriveEdges(state: EditorState): Edge[] {
  const edges: Edge[] = []
  for (let i = 0; i < state.order.length - 1; i++) {
    const source = state.order[i]
    const target = state.order[i + 1]
    edges.push({ id: `${source}-${target}`, source, target })
  }
  return edges
}

export function WorkflowCanvasEditor({
  mode,
  initialId,
  initialDefinition,
  source,
  onSaved,
  onCancel,
}: WorkflowCanvasEditorProps) {
  const [state, setState] = useState<EditorState>(() => seedState(initialDefinition))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const rfInstanceRef = useRef<ReactFlowInstance | null>(null)

  const nodes = useMemo(() => deriveNodes(state), [state])
  const edges = useMemo(() => deriveEdges(state), [state])

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // Persist position updates into state.positions; ignore everything else
      // (applyNodeChanges returns the full node array we can diff against).
      setState((prev) => {
        const derived = deriveNodes(prev)
        const nextNodes = applyNodeChanges(changes, derived)
        const nextPositions = { ...prev.positions }
        for (const n of nextNodes) {
          nextPositions[n.id] = { x: n.position.x, y: n.position.y }
        }
        return { ...prev, positions: nextPositions }
      })
    },
    [],
  )
  const onEdgesChange = useCallback((_changes: EdgeChange[]) => {
    // Edges are derived from step order; user-initiated edge changes land in T12.
  }, [])

  const onNodeClick = useCallback(
    (_e: React.MouseEvent, node: Node) => setSelectedId(node.id),
    [],
  )

  const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }, [])

  const onDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    const kind =
      event.dataTransfer.getData(PALETTE_DRAG_MIME_TYPE) ||
      event.dataTransfer.getData('text/plain')
    if (!kind) return

    const bounds = wrapperRef.current?.getBoundingClientRect()
    const rf = rfInstanceRef.current
    const position: XYPosition =
      bounds && rf
        ? rf.screenToFlowPosition({
            x: event.clientX - bounds.left,
            y: event.clientY - bounds.top,
          })
        : { x: event.clientX, y: event.clientY }

    setState((prev) => {
      const id = nextStepId(kind, new Set(prev.order))
      return {
        steps: { ...prev.steps, [id]: defaultStepBody(id, kind) },
        order: [...prev.order, id],
        positions: { ...prev.positions, [id]: { x: position.x, y: position.y } },
      }
    })
  }, [])

  const handleApply = useCallback(
    (patch: Record<string, unknown>) => {
      const prevId = selectedId
      if (!prevId) return
      setState((prev) => {
        const base = prev.steps[prevId]
        if (!base) return prev
        const merged = { ...base, ...patch } as WorkflowStep
        const nextId = (patch.id as string | undefined) ?? prevId
        if (nextId === prevId) {
          return { ...prev, steps: { ...prev.steps, [prevId]: merged } }
        }
        // Id rename — keep order stable, move position + drop the old key.
        const { [prevId]: _, ...restSteps } = prev.steps
        const { [prevId]: oldPos, ...restPositions } = prev.positions
        const nextOrder = prev.order.map((o) => (o === prevId ? nextId : o))
        return {
          steps: { ...restSteps, [nextId]: { ...merged, id: nextId } },
          order: nextOrder,
          positions: { ...restPositions, [nextId]: oldPos ?? { x: 0, y: 0 } },
        }
      })
      if (typeof patch.id === 'string' && patch.id !== prevId) {
        setSelectedId(patch.id)
      }
      setSelectedId(null)
    },
    [selectedId],
  )

  const readOnlyPlugin = source === 'plugin'

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const nextDefinition: WorkflowDefinition = {
        ...initialDefinition,
        steps: state.order.map((id) => state.steps[id]).filter(Boolean),
        layout: { positions: { ...state.positions } },
      }

      const url =
        mode === 'edit' && initialId
          ? `/api/plugins/workflows/definitions/${initialId}`
          : '/api/plugins/workflows/definitions'
      const method = mode === 'edit' && initialId ? 'PUT' : 'POST'
      const body =
        method === 'POST'
          ? JSON.stringify({ id: initialId ?? initialDefinition.id ?? '', ...nextDefinition })
          : JSON.stringify(nextDefinition)

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body,
      })
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (!res.ok) {
        setError((data.error as string) || `Save failed (${res.status})`)
        return
      }
      onSaved?.(data.id as string)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const selectedStep = selectedId ? (state.steps[selectedId] as {
    id: string
    type: string
    label: string
    [k: string]: unknown
  } | undefined) : null

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex items-center justify-between border-b border-border bg-card px-4 py-2">
        <div className="text-sm">
          <span className="font-medium">
            {mode === 'create' ? 'New workflow' : `Edit · ${initialId}`}
          </span>
          {readOnlyPlugin && (
            <span className="ml-2 text-xs text-amber-300">
              (plugin-owned — saving creates a user shadow)
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {error && <span className="text-xs text-red-300">{error}</span>}
          {onCancel && (
            <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
              Cancel
            </Button>
          )}
          <Button size="sm" onClick={handleSave} disabled={saving}>
            <Save className="mr-1 size-3.5" /> Save
          </Button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <NodeTypePalette />

        <div
          ref={wrapperRef}
          className="relative flex-1 bg-zinc-950"
          onDragOver={onDragOver}
          onDrop={onDrop}
        >
          <style dangerouslySetInnerHTML={{ __html: RESET_NODE_STYLES }} />
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeClick={onNodeClick}
            onInit={(rf) => {
              rfInstanceRef.current = rf
            }}
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

        {selectedStep && (
          <NodeConfigDrawer
            step={selectedStep}
            onApply={handleApply}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>
    </div>
  )
}

// Explicitly re-export the ReactNode type to keep TS happy in strict builds
// where React types are only imported transitively.
export type { ReactNode }
