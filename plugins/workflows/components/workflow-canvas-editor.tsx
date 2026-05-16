'use client'

/**
 * Editable workflow canvas — sole editor for /workflows/new and
 * /workflows/{id}/edit.
 *
 * Source of truth: an internal `steps` record keyed by step id. Positions
 * and edges are derived each render. When the drawer applies a patch we
 * mutate the step body; when a node is dragged we mutate positions; when
 * a palette item is dropped we mint a new step with a default body.
 *
 * Node renderers come from the NodeRendererRegistry (populated by the
 * plugin manifest at module load) so plugin-registered kinds work
 * without special-casing.
 */

import { useCallback, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  addEdge,
  applyNodeChanges,
  applyEdgeChanges,
  type Node,
  type Edge,
  type Connection,
  type NodeChange,
  type EdgeChange,
  type NodeTypes,
  type ReactFlowInstance,
  type XYPosition,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Copy, LayoutGrid, Save, Trash2 } from 'lucide-react'
import { Button } from "@makinbakin/sdk/ui"
import { Input } from "@makinbakin/sdk/ui"

import { getNodeRendererSnapshot, subscribeNodeRenderers } from '../lib/node-renderer-registry'
import { NodeTypePalette, PALETTE_DRAG_MIME_TYPE } from './node-type-palette'
import { NodeConfigDrawer } from './node-config-drawer'
import { canConnect } from '../lib/edge-rules'
import { layoutNodes } from '../lib/dagre-layout'
import { toast } from "@makinbakin/sdk/hooks"
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

interface WorkflowCanvasEditorProps {
  mode: 'create' | 'edit'
  /** Required in edit mode — the id used in the PUT path. */
  initialId?: string
  /** Omit in create mode to start from a blank workflow. */
  initialDefinition?: WorkflowDefinition
  source?: 'plugin' | 'user'
  onSaved?: (id: string) => void
  onDeleted?: () => void
  onCancel?: () => void
}

const BLANK_DEFINITION: WorkflowDefinition = {
  name: '',
  description: '',
  version: 1,
  steps: [],
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
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
  edges: Edge[]
}

function seedEdges(order: string[]): Edge[] {
  const edges: Edge[] = []
  for (let i = 0; i < order.length - 1; i++) {
    const source = order[i]
    const target = order[i + 1]
    edges.push({ id: `${source}-${target}`, source, target })
  }
  return edges
}

function seedState(def: WorkflowDefinition): EditorState {
  const steps: Record<string, WorkflowStep> = {}
  const order: string[] = []
  for (const step of def.steps) {
    steps[step.id] = step
    order.push(step.id)
  }
  const edges = seedEdges(order)
  const seeded = def.layout?.positions

  // If the definition carries explicit positions, use them; otherwise run
  // dagre to give the canvas a sensible left-to-right layout instead of
  // stacking every node at (0, 0).
  let positions: Record<string, NodePosition>
  if (seeded && Object.keys(seeded).length > 0) {
    positions = { ...seeded }
    for (let i = 0; i < order.length; i++) {
      if (!positions[order[i]]) positions[order[i]] = { x: 0, y: i * Y_SPACING }
    }
  } else {
    const bareNodes = order.map((id) => ({
      id,
      position: { x: 0, y: 0 },
      data: {},
      style: { width: NODE_WIDTH },
    }))
    const arranged = layoutNodes(bareNodes, edges)
    positions = {}
    for (const n of arranged) {
      positions[n.id] = { x: n.position.x, y: n.position.y }
    }
  }
  return { steps, order, positions, edges }
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

export function WorkflowCanvasEditor({
  mode,
  initialId,
  initialDefinition,
  source,
  onSaved,
  onDeleted,
  onCancel,
}: WorkflowCanvasEditorProps) {
  const baseDefinition = initialDefinition ?? BLANK_DEFINITION
  const [definition, setDefinition] = useState<WorkflowDefinition>(baseDefinition)
  const [state, setState] = useState<EditorState>(() => seedState(baseDefinition))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const rfInstanceRef = useRef<ReactFlowInstance | null>(null)

  // Subscribe to registry mutations — see note in workflow-canvas.tsx.
  const nodeTypes = useSyncExternalStore(subscribeNodeRenderers, getNodeRendererSnapshot, getNodeRendererSnapshot) as NodeTypes
  const nodes = useMemo(() => deriveNodes(state), [state])
  const edges = state.edges

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
  const onEdgesChange = useCallback((changes: EdgeChange[]) => {
    setState((prev) => ({ ...prev, edges: applyEdgeChanges(changes, prev.edges) }))
  }, [])

  const isValidConnection = useCallback(
    (conn: Connection | Edge) => {
      const source = (conn as Connection).source
      const target = (conn as Connection).target
      if (!source || !target) return false
      const result = canConnect(source, target, state.edges, (id) => state.steps[id]?.type)
      return result.ok
    },
    [state.edges, state.steps],
  )

  const onConnect = useCallback(
    (conn: Connection) => {
      if (!conn.source || !conn.target) return
      const result = canConnect(
        conn.source,
        conn.target,
        state.edges,
        (id) => state.steps[id]?.type,
      )
      if (!result.ok) {
        if (result.reason) toast(result.reason, 'error')
        return
      }
      setState((prev) => ({ ...prev, edges: addEdge(conn, prev.edges) }))
    },
    [state.edges, state.steps],
  )

  const onNodeClick = useCallback(
    (_e: React.MouseEvent, node: Node) => setSelectedId(node.id),
    [],
  )

  const handleAutoArrange = useCallback(() => {
    setState((prev) => {
      const arranged = layoutNodes(deriveNodes(prev), prev.edges)
      const nextPositions: Record<string, NodePosition> = {}
      for (const n of arranged) {
        nextPositions[n.id] = { x: n.position.x, y: n.position.y }
      }
      return { ...prev, positions: nextPositions }
    })
  }, [])

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
        ...prev,
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
        const restSteps = { ...prev.steps }
        delete restSteps[prevId]
        const { [prevId]: oldPos, ...restPositions } = prev.positions
        const nextOrder = prev.order.map((o) => (o === prevId ? nextId : o))
        const nextEdges = prev.edges.map((e) => ({
          ...e,
          source: e.source === prevId ? nextId : e.source,
          target: e.target === prevId ? nextId : e.target,
        }))
        return {
          steps: { ...restSteps, [nextId]: { ...merged, id: nextId } },
          order: nextOrder,
          positions: { ...restPositions, [nextId]: oldPos ?? { x: 0, y: 0 } },
          edges: nextEdges,
        }
      })
      if (typeof patch.id === 'string' && patch.id !== prevId) {
        setSelectedId(patch.id)
      }
      setSelectedId(null)
    },
    [selectedId],
  )

  const isPluginSource = source === 'plugin'
  const canSaveInPlace = mode === 'create' || !isPluginSource
  const canDelete = mode === 'edit' && source === 'user'

  function buildDefinition(): WorkflowDefinition {
    return {
      ...definition,
      steps: state.order.map((id) => state.steps[id]).filter(Boolean),
      layout: { positions: { ...state.positions } },
    }
  }

  async function postOrPut(method: 'POST' | 'PUT', url: string, body: unknown) {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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

  async function handleSave() {
    const next = buildDefinition()
    if (mode === 'edit' && initialId && canSaveInPlace) {
      await postOrPut('PUT', `/api/plugins/workflows/definitions/${initialId}`, next)
      return
    }
    const id = (initialDefinition?.id || slugify(definition.name)) || ''
    if (!id) {
      setError('Name is required to derive an id')
      return
    }
    await postOrPut('POST', '/api/plugins/workflows/definitions', { id, ...next })
  }

  async function handleSaveAsNew() {
    const suggestion = slugify(definition.name) || initialId || ''
    const newId = typeof window !== 'undefined'
      ? window.prompt('New workflow id:', suggestion)
      : suggestion
    if (!newId || !newId.trim()) return
    await postOrPut('POST', '/api/plugins/workflows/definitions', {
      id: newId.trim(),
      ...buildDefinition(),
    })
  }

  async function handleDelete() {
    if (!initialId) return
    if (!confirmingDelete) {
      setConfirmingDelete(true)
      return
    }
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/plugins/workflows/definitions/${initialId}`, {
        method: 'DELETE',
      })
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (!res.ok) {
        setError((data.error as string) || `Delete failed (${res.status})`)
        return
      }
      onDeleted?.()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
      setConfirmingDelete(false)
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
      <div className="flex items-center justify-between gap-3 border-b border-border bg-card px-4 py-2">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <span className="whitespace-nowrap text-sm font-medium">
            {mode === 'create' ? 'New workflow' : `Edit · ${initialId}`}
          </span>
          <Input
            aria-label="Workflow name"
            className="h-8 max-w-[240px]"
            value={definition.name}
            onChange={(e) => setDefinition((d) => ({ ...d, name: e.target.value }))}
            placeholder="Workflow name"
          />
          <Input
            aria-label="Workflow description"
            className="h-8 max-w-[360px]"
            value={definition.description}
            onChange={(e) => setDefinition((d) => ({ ...d, description: e.target.value }))}
            placeholder="Description"
          />
          {isPluginSource && (
            <span className="text-xs text-amber-300">
              plugin-owned — use Save as new
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {error && <span className="text-xs text-red-300">{error}</span>}
          <Button variant="ghost" size="sm" onClick={handleAutoArrange} disabled={saving}>
            <LayoutGrid className="mr-1 size-3.5" /> Auto-arrange
          </Button>
          {canDelete && (
            <Button
              variant={confirmingDelete ? 'destructive' : 'ghost'}
              size="sm"
              onClick={handleDelete}
              disabled={saving}
            >
              <Trash2 className="mr-1 size-3.5" />
              {confirmingDelete ? 'Confirm' : 'Delete'}
            </Button>
          )}
          {isPluginSource && (
            <Button variant="ghost" size="sm" onClick={handleSaveAsNew} disabled={saving}>
              <Copy className="mr-1 size-3.5" /> Save as new
            </Button>
          )}
          {onCancel && (
            <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
              Cancel
            </Button>
          )}
          {canSaveInPlace && (
            <Button size="sm" onClick={handleSave} disabled={saving}>
              <Save className="mr-1 size-3.5" /> Save
            </Button>
          )}
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
            onConnect={onConnect}
            isValidConnection={isValidConnection}
            onInit={(rf) => {
              rfInstanceRef.current = rf
            }}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.3 }}
            proOptions={{ hideAttribution: true }}
            nodesDraggable={true}
            nodesConnectable={true}
            defaultEdgeOptions={{
              style: { stroke: '#525252', strokeWidth: 2 },
            }}
          >
            <Background variant={BackgroundVariant.Dots} color="#3f3f46" gap={24} size={1.5} />
            <Controls showInteractive={false} />
            <MiniMap nodeColor="#3f3f46" maskColor="rgba(0,0,0,0.7)" />
          </ReactFlow>
        </div>

        {selectedStep && (
          <NodeConfigDrawer
            key={`${selectedStep.id}:${selectedStep.type ?? ''}`}
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
