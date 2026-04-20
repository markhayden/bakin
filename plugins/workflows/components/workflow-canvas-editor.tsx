'use client'

/**
 * Editable canvas (Phase 2B scaffold).
 *
 * Replacement for the form-driven WorkflowEditor. This first cut owns
 * only load + edit node positions + save — no palette, no config drawer,
 * no edge-rule enforcement. Those land in T10/T11/T12.
 *
 * Renderers come from the NodeRendererRegistry (populated by the plugin
 * manifest at module load), so plugin-registered kinds Just Work once
 * they ship a `nodeRenderers` export.
 */

import { useCallback, useMemo, useRef, useState } from 'react'
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
const DEFAULT_X = 0

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

/** Default auto-layout — stack steps vertically when no layout.positions present. */
function defaultPosition(index: number): XYPosition {
  return { x: DEFAULT_X, y: index * Y_SPACING }
}

function stepNodeType(step: WorkflowStep): string {
  // Builtins render by their bare kind; plugin kinds already carry their
  // namespaced `{pluginId}.{kind}` as `step.type`.
  return step.type
}

function stepNodeData(step: WorkflowStep): Record<string, unknown> {
  return {
    label: step.label,
    ...(step.type === 'agent' ? { agent: step.agent, task: step.task } : {}),
    ...(step.type === 'gate' ? { description: step.description } : {}),
    ...(step.type === 'output' ? { channels: step.channels, description: step.description } : {}),
    ...(step.type === 'workflow'
      ? { description: step.description, workflow_id: step.workflow_id }
      : {}),
  }
}

/**
 * Build the initial node + edge arrays from a definition. Positions come
 * from `layout.positions` when present, otherwise from the fallback stack.
 */
function buildInitialGraph(def: WorkflowDefinition): { nodes: Node[]; edges: Edge[] } {
  const positions = def.layout?.positions ?? {}
  const nodes: Node[] = def.steps.map((step, idx) => {
    const saved = positions[step.id]
    const position: XYPosition = saved ? { x: saved.x, y: saved.y } : defaultPosition(idx)
    return {
      id: step.id,
      type: stepNodeType(step),
      position,
      data: stepNodeData(step),
      style: { width: NODE_WIDTH },
    }
  })

  const edges: Edge[] = []
  for (let i = 0; i < def.steps.length - 1; i++) {
    const source = def.steps[i].id
    const target = def.steps[i + 1].id
    edges.push({ id: `${source}-${target}`, source, target })
  }

  return { nodes, edges }
}

/**
 * Extract `layout.positions` from the live node array in its current state.
 */
function extractPositions(nodes: Node[]): Record<string, NodePosition> {
  const out: Record<string, NodePosition> = {}
  for (const node of nodes) {
    out[node.id] = { x: node.position.x, y: node.position.y }
  }
  return out
}

/**
 * Generate a unique step id for a dropped kind. Prefers `{kind}-N` with N
 * = 1 for the first entry of that kind and bumping until free.
 */
function nextStepId(kind: string, existing: Set<string>): string {
  const base = kind.includes('.') ? kind.split('.').slice(1).join('-') : kind
  for (let i = 1; i < 1000; i++) {
    const candidate = i === 1 ? base : `${base}-${i}`
    if (!existing.has(candidate)) return candidate
  }
  return `${base}-${Date.now()}`
}

export function WorkflowCanvasEditor({
  mode,
  initialId,
  initialDefinition,
  source,
  onSaved,
  onCancel,
}: WorkflowCanvasEditorProps) {
  const { nodes: seedNodes, edges: seedEdges } = useMemo(
    () => buildInitialGraph(initialDefinition),
    [initialDefinition],
  )

  const [nodes, setNodes] = useState<Node[]>(seedNodes)
  const [edges, setEdges] = useState<Edge[]>(seedEdges)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const rfInstanceRef = useRef<ReactFlowInstance | null>(null)

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    [],
  )
  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    [],
  )

  const onDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }, [])

  const onDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
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

      setNodes((nds) => {
        const existing = new Set(nds.map((n) => n.id))
        const id = nextStepId(kind, existing)
        const newNode: Node = {
          id,
          type: kind,
          position,
          data: { label: id },
          style: { width: NODE_WIDTH },
        }
        return [...nds, newNode]
      })
    },
    [],
  )

  const readOnlyPlugin = source === 'plugin'

  async function handleSave() {
    setSaving(true)
    setError(null)
    try {
      const nextDefinition: WorkflowDefinition = {
        ...initialDefinition,
        layout: { positions: extractPositions(nodes) },
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

        <div ref={wrapperRef} className="relative flex-1 bg-zinc-950" onDragOver={onDragOver} onDrop={onDrop}>
          <style dangerouslySetInnerHTML={{ __html: RESET_NODE_STYLES }} />
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
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
      </div>
    </div>
  )
}
