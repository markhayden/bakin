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

import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, useSyncExternalStore, useLayoutEffect } from 'react'
import { useKeyedState } from '@makinbakin/sdk/hooks'
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Handle,
  NodeToolbar,
  Panel,
  BaseEdge,
  EdgeLabelRenderer,
  getSmoothStepPath,
  Position,
  type Node,
  type EdgeProps,
  type EdgeTypes,
  type NodeChange,
  type NodeTypes,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  ArrowLeft,
  ArrowDown,
  ArrowUp,
  Copy,
  LayoutGrid,
  Pencil,
  Save,
  Trash,
} from 'lucide-react'
import {
  PageHeader,
  WorkspacePage,
  WorkspacePageBody,
  WorkspacePageCompactHeader,
  WorkspacePageHeader,
  PageBody,
  PageCanvas,
} from '@makinbakin/sdk/patterns'
import { useUnsavedChangesGuard } from '@makinbakin/sdk/navigation'
import { Badge, Banner, Button, DropdownMenuItem } from '@makinbakin/sdk/ui'

import { getNodeRendererSnapshot, subscribeNodeRenderers } from '../lib/node-renderer-registry'
import { NodeTypePalette, PALETTE_DRAG_MIME_TYPE } from './node-type-palette'
import { NodeConfigDrawer } from './node-config-drawer'
import { WorkflowDetailsDrawer } from './workflow-details-drawer'
import { ManagedWorkflowCopyDialog } from './managed-workflow-copy-dialog'
import {
  clearWorkflowDialogFieldError,
  hasWorkflowDialogFieldErrors,
  parseWorkflowDialogServerError,
  validateWorkflowDialogFields,
  type WorkflowDialogFieldErrors,
} from './workflow-dialog-validation'
import { WorkflowDeleteDialog } from './workflow-delete-action'
import {
  TRIGGER_NODE_ID,
  APPEND_NODE_ID,
  RESERVED_STEP_IDS,
  nextStepId,
  defaultStepBody,
  cloneStep,
  seedEdges,
  seedState,
  deriveNodes,
  autoArrangeState,
  samePosition,
  sameMeasurement,
  type EditorState,
} from '../lib/canvas-editor-state'
import type {
  WorkflowDefinition,
  WorkflowStep,
  WorkflowShadowedSource,
} from '../types'

const RESET_NODE_STYLES = `
  .react-flow__node {
    background: transparent !important;
    border: none !important;
    box-shadow: none !important;
    padding: 0 !important;
    border-radius: 0 !important;
  }
  .react-flow__node.bakin-workflow-node-selected > div {
    box-shadow: 0 0 0 2px var(--bakin-color-focus-ring), var(--bakin-elevation-overlay) !important;
  }
  .react-flow__node {
    transition: transform var(--bakin-motion-duration-transition, 160ms) ease, opacity var(--bakin-motion-duration-transition, 160ms) ease;
  }
`

const NODE_DRAWER_DIRTY_MESSAGE = 'Apply or cancel the open step changes before selecting another step.'

function hasPaletteDragType(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types ?? []).includes(PALETTE_DRAG_MIME_TYPE)
}

// The real node renderers (agent/gate/parallel/output/workflow/createTask/
// trigger/subflowGroup) come from the node-renderer registry, populated by
// client.tsx — exactly like the read-only workflow-canvas.tsx viewer. Only
// 'appendStep' is editor-private (an invisible drop target the registry never
// provides), so it's the sole builtin fallback here.
function EditorAppendStepNode() {
  return (
    <div aria-hidden="true" className="h-px w-px opacity-0">
      <Handle type="target" position={Position.Top} className="!bg-transparent" />
    </div>
  )
}

const BUILTIN_NODE_TYPES: NodeTypes = {
  appendStep: EditorAppendStepNode,
}

interface WorkflowCanvasEditorProps {
  mode: 'create' | 'edit'
  /** Required in edit mode — the id used in the PUT path. */
  initialId?: string
  /** Omit in create mode to start from a blank workflow. */
  initialDefinition?: WorkflowDefinition
  source?: 'plugin' | 'agent-package' | 'user'
  shadowedSource?: WorkflowShadowedSource
  onSaved?: (id: string) => void
  onCopied?: (id: string) => void
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


interface InsertEdgeData extends Record<string, unknown> {
  insertIndex: number
  onInsert: (kind: string, index: number) => void
  onOpenPalette: () => void
}

function InsertableEdge({
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  markerEnd,
  data,
}: EdgeProps) {
  const [isDragOver, setIsDragOver] = useState(false)
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  })
  const insertData = data as InsertEdgeData | undefined

  return (
    <>
      <BaseEdge path={edgePath} markerEnd={markerEnd} />
      {insertData && (
        <EdgeLabelRenderer>
          <button
            type="button"
            aria-label="Drop node here"
            className={`nodrag nopan pointer-events-auto flex items-center justify-center rounded-bakin-pill border transition ${
              isDragOver
                ? 'size-8 border-bakin-signal-info/80 bg-bakin-signal-info/20 ring-4 ring-bakin-signal-info/15'
                : 'size-5 border-transparent bg-transparent hover:border-bakin-signal-info/40 hover:bg-bakin-signal-info/10'
            }`}
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            }}
            onClick={(event) => {
              event.stopPropagation()
              insertData.onOpenPalette()
            }}
            onDragEnter={(event) => {
              if (!hasPaletteDragType(event.dataTransfer)) return
              setIsDragOver(true)
            }}
            onDragOver={(event) => {
              if (!hasPaletteDragType(event.dataTransfer)) return
              event.preventDefault()
              if (!isDragOver) setIsDragOver(true)
              event.dataTransfer.dropEffect = 'copy'
            }}
            onDragLeave={(event) => {
              const nextTarget = event.relatedTarget
              if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return
              setIsDragOver(false)
            }}
            onDrop={(event) => {
              event.preventDefault()
              event.stopPropagation()
              setIsDragOver(false)
              if (!hasPaletteDragType(event.dataTransfer)) return
              const kind = event.dataTransfer.getData(PALETTE_DRAG_MIME_TYPE)
              if (!kind) return
              insertData.onInsert(kind, insertData.insertIndex)
            }}
          >
            <span
              className={`rounded-bakin-pill transition-all ${
                isDragOver
                  ? 'size-4 bg-bakin-signal-info'
                  : 'size-2.5 bg-bakin-text-muted hover:bg-bakin-signal-info'
              }`}
            />
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

export function WorkflowCanvasEditor({
  mode,
  initialId,
  initialDefinition,
  source,
  shadowedSource,
  onSaved,
  onCopied,
  onDeleted,
  onCancel,
}: WorkflowCanvasEditorProps) {
  const baseDefinition = initialDefinition ?? BLANK_DEFINITION
  // The editor is seeded per (mode, source, id, definition) (issue 966b): opening
  // another workflow re-seeds every piece of editor state in the same render
  // the subject changes. Callers pass a stable `initialDefinition`.
  const editorSeed = useMemo(() => ({ mode, source, initialId, initialDefinition }), [mode, source, initialId, initialDefinition])
  const [definition, setDefinition] = useKeyedState<WorkflowDefinition>(editorSeed, () => baseDefinition)
  const [state, setState] = useKeyedState<EditorState>(editorSeed, () => seedState(baseDefinition))
  const [editingId, setEditingId] = useKeyedState(editorSeed, () => initialId)
  const [selectedId, setSelectedId] = useKeyedState<string | null>(editorSeed, () => null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useKeyedState<string | null>(editorSeed, () => null)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [isDirty, setIsDirty] = useKeyedState(editorSeed, () => false)
  const [nodeDrawerDirty, setNodeDrawerDirty] = useKeyedState(editorSeed, () => false)
  const [workflowDetailsOpen, setWorkflowDetailsOpen] = useKeyedState(editorSeed, () => false)
  const [effectiveSource, setEffectiveSource] = useKeyedState(editorSeed, () => source)
  // The managed-copy prompt follows the effective source of an edit; the
  // operator can dismiss it (it is state, keyed by what it is about).
  const [managedCopyOpen, setManagedCopyOpen] = useKeyedState(`${effectiveSource}\u0000${mode}`, () => mode === 'edit' && (effectiveSource === 'plugin' || effectiveSource === 'agent-package'))
  const [copyError, setCopyError] = useKeyedState<string | null>(editorSeed, () => null)
  const [copyFieldErrors, setCopyFieldErrors] = useKeyedState<WorkflowDialogFieldErrors>(editorSeed, () => ({}))
  const [creatingLocalCopy, setCreatingLocalCopy] = useState(false)
  const [copyName, setCopyName] = useKeyedState(editorSeed, () => baseDefinition.name ? `${baseDefinition.name} Copy` : '')
  const [copyId, setCopyId] = useKeyedState(editorSeed, () => baseDefinition.name ? slugify(`${baseDefinition.name} Copy`) : '')
  const [copyIdEdited, setCopyIdEdited] = useKeyedState(editorSeed, () => false)
  const [copyDescription, setCopyDescription] = useKeyedState(editorSeed, () => baseDefinition.description ?? '')
  const [disableOriginal, setDisableOriginal] = useKeyedState(editorSeed, () => true)
  const [paletteCollapsed, setPaletteCollapsed] = useState(() => (
    typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(max-width: 47.999rem)').matches
  ))
  const [createSetupOpen, setCreateSetupOpen] = useKeyedState(editorSeed, () => mode === 'create' && !initialDefinition?.id)

  const rfInstanceRef = useRef<ReactFlowInstance | null>(null)
  const lastFitViewKeyRef = useRef<string | null>(null)
  const hasUnsavedChanges = isDirty || nodeDrawerDirty
  const isManagedSource = effectiveSource === 'plugin' || effectiveSource === 'agent-package'
  const canSaveInPlace = mode === 'create' || !isManagedSource

  // Navigation guard: owns the exit-confirmation flow (beforeunload + TanStack
  // history block + anchor interception) and the unsaved-changes dialog.
  const unsavedChangesGuard = useUnsavedChangesGuard({
    hasUnsavedChanges,
    saving,
    canSaveInPlace,
    saveDisabled: nodeDrawerDirty,
    title: 'Unsaved workflow changes',
    description: 'You have unsaved changes on this workflow. Save them before leaving, discard them, or stay on the canvas.',
    onCancel,
    onSaveAndExit: async () => {
      if (nodeDrawerDirty) {
        setError(NODE_DRAWER_DIRTY_MESSAGE)
        return false
      }
      const saved = await saveDefinition(buildDefinition(), { notifySaved: false })
      if (!saved) return false
      setIsDirty(false)
      setNodeDrawerDirty(false)
      return true
    },
    onDiscardAndExit: () => {
      setIsDirty(false)
      setNodeDrawerDirty(false)
    },
  })

  // Subscribe to registry mutations — see note in workflow-canvas.tsx.
  const registeredNodeTypes = useSyncExternalStore(subscribeNodeRenderers, getNodeRendererSnapshot, getNodeRendererSnapshot) as NodeTypes
  const nodeTypes = useMemo(
    () => ({ ...BUILTIN_NODE_TYPES, ...registeredNodeTypes }),
    [registeredNodeTypes],
  )
  const edgeTypes = useMemo<EdgeTypes>(() => ({ insertable: InsertableEdge }), [])
  const hasCompletionStep = useMemo(
    () => state.order.some((id) => state.steps[id]?.type === 'output'),
    [state.order, state.steps],
  )
  const disabledPaletteKinds = useMemo(
    () => (hasCompletionStep ? new Set(['output']) : undefined),
    [hasCompletionStep],
  )
  const insertStepAt = useCallback((kind: string, index: number) => {
    if (nodeDrawerDirty) {
      setError(NODE_DRAWER_DIRTY_MESSAGE)
      return
    }
    if (kind === 'output' && hasCompletionStep) return
    const id = nextStepId(kind, new Set(state.order))
    setIsDirty(true)
    setNodeDrawerDirty(false)
    setState((prev) => {
      const order = [...prev.order]
      const insertIndex = Math.max(0, Math.min(index, order.length))
      order.splice(insertIndex, 0, id)
      return autoArrangeState({
        ...prev,
        steps: { ...prev.steps, [id]: defaultStepBody(id, kind) },
        order,
        positions: { ...prev.positions, [id]: { x: 0, y: 0 } },
      })
    })
    setWorkflowDetailsOpen(false)
    setSelectedId(id)
  }, [hasCompletionStep, nodeDrawerDirty, state.order, setError, setIsDirty, setNodeDrawerDirty, setSelectedId, setState, setWorkflowDetailsOpen])
  const openStepPalette = useCallback(() => {
    setPaletteCollapsed(false)
  }, [])
  const nodes = useMemo(
    () =>
      deriveNodes(state).map((node) => (
        node.id === selectedId
          ? { ...node, selected: true, className: 'bakin-workflow-node-selected' }
          : node
      )),
    [selectedId, state],
  )
  const edges = useMemo(
    () => seedEdges(state.order, true, insertStepAt, openStepPalette, true),
    [insertStepAt, openStepPalette, state.order],
  )
  const fitViewKey = useMemo(
    () => `${mode}:${initialId ?? 'new'}:${initialDefinition?.id ?? ''}:${initialDefinition?.steps.map((step) => step.id).join('|') ?? ''}`,
    [initialDefinition, initialId, mode],
  )

  // The guard's API is rebuilt every render (plain functions); the reset
  // effect wants the LATEST reset without re-running on every render.
  const resetUnsavedChangesGuard = useEffectEvent(() => { unsavedChangesGuard.reset() })
  // A new subject also forgets any pending exit decision (the state itself
  // re-seeds through `editorSeed` above). A layout effect: it must settle the
  // pending navigation as "stay" BEFORE the guard's own clean-again effect
  // would let it through.
  useLayoutEffect(() => { resetUnsavedChangesGuard() }, [editorSeed])

  useEffect(() => {
    if (state.order.length === 0) return
    if (lastFitViewKeyRef.current === fitViewKey) return
    lastFitViewKeyRef.current = fitViewKey
    const frame = requestAnimationFrame(() => {
      void rfInstanceRef.current?.fitView({ padding: 0.3 })
    })
    return () => cancelAnimationFrame(frame)
  }, [fitViewKey, state.order.length])

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => {
      // Persist only the editor-owned pieces of React Flow's controlled node
      // state. Dimension changes must be retained so React Flow can unhide
      // custom nodes and route edges against their real rendered bounds.
      setState((prev) => {
        const nextPositions = { ...prev.positions }
        const nextMeasurements = { ...prev.measurements }
        let changed = false
        let dirtyChanged = false

        for (const change of changes) {
          if (change.type === 'position' && change.position && change.id in prev.steps) {
            if (!samePosition(prev.positions[change.id], change.position)) {
              nextPositions[change.id] = { x: change.position.x, y: change.position.y }
              changed = true
              dirtyChanged = true
            }
          }

          if (change.type === 'dimensions' && change.dimensions) {
            const isEditorNode = change.id === TRIGGER_NODE_ID || change.id === APPEND_NODE_ID || change.id in prev.steps
            if (!isEditorNode) continue
            const nextMeasurement = {
              width: change.dimensions.width,
              height: change.dimensions.height,
            }
            if (!sameMeasurement(prev.measurements[change.id], nextMeasurement)) {
              nextMeasurements[change.id] = nextMeasurement
              changed = true
            }
          }
        }

        if (dirtyChanged) setIsDirty(true)
        return changed ? { ...prev, positions: nextPositions, measurements: nextMeasurements } : prev
      })
    },
    [setIsDirty, setState],
  )
  const onNodeClick = useCallback(
    (_e: React.MouseEvent, node: Node) => {
      if (nodeDrawerDirty && node.id !== selectedId) {
        setError(NODE_DRAWER_DIRTY_MESSAGE)
        return
      }
      setWorkflowDetailsOpen(false)
      setSelectedId(node.id === TRIGGER_NODE_ID || node.id === APPEND_NODE_ID ? null : node.id)
    },
    [nodeDrawerDirty, selectedId, setError, setSelectedId, setWorkflowDetailsOpen],
  )
  const onPaneClick = useCallback(() => {
    if (nodeDrawerDirty) {
      setError(NODE_DRAWER_DIRTY_MESSAGE)
      return
    }
    setSelectedId(null)
  }, [nodeDrawerDirty, setError, setSelectedId])

  const closeNodeDrawer = useCallback(() => {
    setNodeDrawerDirty(false)
    setSelectedId(null)
  }, [setNodeDrawerDirty, setSelectedId])

  const openWorkflowDetails = useCallback(() => {
    if (nodeDrawerDirty) {
      setError(NODE_DRAWER_DIRTY_MESSAGE)
      return
    }
    setSelectedId(null)
    setWorkflowDetailsOpen(true)
  }, [nodeDrawerDirty, setError, setSelectedId, setWorkflowDetailsOpen])

  const closeWorkflowDetails = useCallback(() => {
    setWorkflowDetailsOpen(false)
  }, [setWorkflowDetailsOpen])

  const setDrawerDirty = useCallback((dirty: boolean) => {
    setNodeDrawerDirty(dirty)
    if (dirty) setError(null)
  }, [setError, setNodeDrawerDirty])

  // The "apply or cancel first" message is only true while the drawer is
  // dirty — adjusted during render (issue 966b).
  if (!nodeDrawerDirty && error === NODE_DRAWER_DIRTY_MESSAGE) setError(null)

  const handleAutoArrange = useCallback(() => {
    setState((prev) => autoArrangeState(prev))
    setIsDirty(true)
  }, [setIsDirty, setState])

  const handleApply = useCallback(
    (patch: Record<string, unknown>) => {
      const prevId = selectedId
      if (!prevId) return
      const nextId = (patch.id as string | undefined) ?? prevId
      if (nextId !== prevId && state.steps[nextId]) {
        setError('Step IDs must be unique.')
        return
      }
      setState((prev) => {
        const base = prev.steps[prevId]
        if (!base) return prev
        const merged = { ...base, ...patch } as WorkflowStep
        if (nextId === prevId) {
          return { ...prev, steps: { ...prev.steps, [prevId]: merged } }
        }
        // Id rename — keep order stable, move position + drop the old key.
        const restSteps = { ...prev.steps }
        delete restSteps[prevId]
        const { [prevId]: oldPos, ...restPositions } = prev.positions
        const { [prevId]: oldMeasurement, ...restMeasurements } = prev.measurements
        const nextOrder = prev.order.map((o) => (o === prevId ? nextId : o))
        const nextMeasurements = oldMeasurement
          ? { ...restMeasurements, [nextId]: oldMeasurement }
          : restMeasurements
        return {
          steps: { ...restSteps, [nextId]: { ...merged, id: nextId } },
          order: nextOrder,
          positions: { ...restPositions, [nextId]: oldPos ?? { x: 0, y: 0 } },
          measurements: nextMeasurements,
        }
      })
      if (typeof patch.id === 'string' && patch.id !== prevId) {
        setSelectedId(patch.id)
      }
      setIsDirty(true)
      setNodeDrawerDirty(false)
      setSelectedId(null)
    },
    [selectedId, state.steps, setError, setIsDirty, setNodeDrawerDirty, setSelectedId, setState],
  )

  const moveSelectedStep = useCallback((delta: -1 | 1) => {
    if (!selectedId) return
    setState((prev) => {
      const current = prev.order.indexOf(selectedId)
      const next = current + delta
      if (current < 0 || next < 0 || next >= prev.order.length) return prev
      setIsDirty(true)
      const order = [...prev.order]
      const [moved] = order.splice(current, 1)
      order.splice(next, 0, moved)
      return autoArrangeState({ ...prev, order })
    })
  }, [selectedId, setIsDirty, setState])

  const duplicateSelectedStep = useCallback(() => {
    if (!selectedId) return
    setState((prev) => {
      const base = prev.steps[selectedId]
      if (!base) return prev
      if (base.type === 'output') return prev
      setIsDirty(true)
      const id = nextStepId(`${selectedId}-copy`, new Set(prev.order))
      const clone = cloneStep(base) as unknown as Record<string, unknown>
      clone.id = id
      clone.label = `${String(base.label || selectedId)} copy`
      const current = prev.order.indexOf(selectedId)
      const order = [...prev.order]
      order.splice(current >= 0 ? current + 1 : order.length, 0, id)
      return autoArrangeState({
        ...prev,
        steps: { ...prev.steps, [id]: clone as unknown as WorkflowStep },
        order,
        positions: { ...prev.positions, [id]: { x: 0, y: 0 } },
      })
    })
  }, [selectedId, setIsDirty, setState])

  const deleteSelectedStep = useCallback(() => {
    if (!selectedId) return
    setState((prev) => {
      if (!prev.steps[selectedId]) return prev
      setIsDirty(true)
      const steps = { ...prev.steps }
      delete steps[selectedId]
      const positions = { ...prev.positions }
      delete positions[selectedId]
      const measurements = { ...prev.measurements }
      delete measurements[selectedId]
      return autoArrangeState({
        ...prev,
        steps,
        order: prev.order.filter((id) => id !== selectedId),
        positions,
        measurements,
      })
    })
    setSelectedId(null)
  }, [selectedId, setIsDirty, setSelectedId, setState])

  useEffect(() => {
    if (!selectedId) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Delete' && event.key !== 'Backspace') return
      const target = event.target as HTMLElement | null
      if (
        target?.closest('input, textarea, [contenteditable="true"], [role="textbox"], [role="combobox"]')
      ) {
        return
      }
      event.preventDefault()
      deleteSelectedStep()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [deleteSelectedStep, selectedId])

  const canDelete = mode === 'edit' && effectiveSource === 'user'

  function buildDefinition(definitionOverride = definition): WorkflowDefinition {
    return {
      ...definitionOverride,
      steps: state.order.map((id) => state.steps[id]).filter(Boolean),
      layout: { ...(definitionOverride.layout ?? {}), positions: { ...state.positions } },
    }
  }

  async function postOrPut(
    method: 'POST' | 'PUT',
    url: string,
    body: unknown,
    options: { notifySaved?: boolean } = {},
  ): Promise<boolean> {
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
        return false
      }
      if (options.notifySaved !== false) {
        onSaved?.(data.id as string)
      }
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    } finally {
      setSaving(false)
    }
  }

  async function saveDefinition(
    next: WorkflowDefinition,
    options: { notifySaved?: boolean } = {},
  ): Promise<boolean> {
    const targetId = editingId ?? initialId
    if ((mode === 'edit' || editingId) && targetId && canSaveInPlace) {
      return postOrPut('PUT', `/api/plugins/workflows/definitions/${targetId}`, next, options)
    }
    const id = (next.id || initialDefinition?.id || slugify(next.name)) || ''
    if (!id) {
      setError('Name is required to derive an id')
      return false
    }
    return postOrPut('POST', '/api/plugins/workflows/definitions', { id, ...next }, options)
  }

  async function handleSave() {
    if (nodeDrawerDirty) {
      setError(NODE_DRAWER_DIRTY_MESSAGE)
      return
    }
    if (mode === 'edit' && canSaveInPlace && !isDirty) return
    const saved = await saveDefinition(buildDefinition())
    if (saved) setIsDirty(false)
  }

  async function handleWorkflowDetailsApply(patch: Pick<WorkflowDefinition, 'name' | 'description'>) {
    const nextDefinition = { ...definition, ...patch }
    if (mode === 'edit' && canSaveInPlace) {
      const saved = await saveDefinition(buildDefinition(nextDefinition), { notifySaved: false })
      if (!saved) return
      setDefinition(nextDefinition)
      setIsDirty(false)
      setNodeDrawerDirty(false)
      setWorkflowDetailsOpen(false)
      return
    }
    setDefinition(nextDefinition)
    setIsDirty(true)
    setWorkflowDetailsOpen(false)
  }

  async function handleCreateWorkflowSetup() {
    const nextId = copyId.trim()
    const nextName = copyName.trim()
    const fieldErrors = validateWorkflowDialogFields({ id: nextId, name: nextName })
    if (hasWorkflowDialogFieldErrors(fieldErrors)) {
      setCopyFieldErrors(fieldErrors)
      setCopyError(null)
      return
    }

    setCreatingLocalCopy(true)
    setCopyError(null)
    setCopyFieldErrors({})
    setError(null)
    try {
      const nextDefinition = buildDefinition({
        ...definition,
        id: nextId,
        name: nextName,
        description: copyDescription.trim(),
      })
      const res = await fetch('/api/plugins/workflows/definitions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...nextDefinition, id: nextId }),
      })
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (!res.ok) {
        const parsedError = parseWorkflowDialogServerError(data, `Create failed (${res.status})`)
        setCopyFieldErrors(parsedError.fieldErrors)
        setCopyError(parsedError.error)
        return
      }

      setDefinition(nextDefinition)
      setEditingId(nextId)
      setEffectiveSource('user')
      setIsDirty(false)
      setNodeDrawerDirty(false)
      setCreateSetupOpen(false)
      onSaved?.((data.id as string | undefined) ?? nextId)
    } catch (e) {
      setCopyError((e as Error).message)
    } finally {
      setCreatingLocalCopy(false)
    }
  }

  async function handleCreateLocalCopy() {
    if (!initialId) return
    const nextId = copyId.trim()
    const nextName = copyName.trim()
    const fieldErrors = validateWorkflowDialogFields({
      id: nextId,
      name: nextName,
      nameRequiredMessage: 'Copy name is required.',
    })
    if (hasWorkflowDialogFieldErrors(fieldErrors)) {
      setCopyFieldErrors(fieldErrors)
      setCopyError(null)
      return
    }
    setCreatingLocalCopy(true)
    setCopyError(null)
    setCopyFieldErrors({})
    setError(null)
    try {
      const nextDefinition = {
        ...buildDefinition(),
        id: nextId,
        name: nextName,
      }
      const res = await fetch('/api/plugins/workflows/definitions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...nextDefinition, id: nextId }),
      })
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (!res.ok) {
        const parsedError = parseWorkflowDialogServerError(data, `Copy failed (${res.status})`)
        setCopyFieldErrors(parsedError.fieldErrors)
        setCopyError(parsedError.error)
        return
      }
      if (disableOriginal) {
        const availabilityRes = await fetch(`/api/plugins/workflows/definitions/${initialId}/availability`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ disabled: true }),
        })
        if (!availabilityRes.ok) {
          const availabilityData = (await availabilityRes.json().catch(() => ({}))) as Record<string, unknown>
          setError((availabilityData.error as string | undefined) || `Copied, but disabling the managed workflow failed (${availabilityRes.status})`)
        }
      }
      setDefinition(nextDefinition)
      setEditingId(nextId)
      setEffectiveSource('user')
      setIsDirty(false)
      setNodeDrawerDirty(false)
      setManagedCopyOpen(false)
      onCopied?.(nextId)
    } catch (e) {
      setCopyError((e as Error).message)
    } finally {
      setCreatingLocalCopy(false)
    }
  }

  async function handleDelete() {
    const targetId = editingId ?? initialId
    if (!targetId) return false
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/plugins/workflows/definitions/${targetId}`, {
        method: 'DELETE',
      })
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
      if (!res.ok) {
        setError((data.error as string) || `Delete failed (${res.status})`)
        return false
      }
      onDeleted?.()
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
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
  const selectedIndex = selectedId ? state.order.indexOf(selectedId) : -1
  const workflowIdLabel = editingId ?? initialId ?? (mode === 'create' ? 'new' : 'unknown')
  const workflowNameLabel = definition.name?.trim() || 'Untitled workflow'
  const workflowDescriptionLabel = definition.description?.trim() || 'No description'

  return (
    <WorkspacePage mode="immersive">
      <WorkspacePageHeader>
        <PageHeader
        navigation={onCancel ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Back to workflows"
              onClick={unsavedChangesGuard.requestExit}
            >
              <ArrowLeft aria-hidden="true" />
            </Button>
        ) : undefined}
        eyebrow={mode === 'create' ? 'Workflows / new' : 'Workflows / edit'}
        measure="wide"
        title={workflowNameLabel}
        description={workflowDescriptionLabel}
        meta={(
          <>
            <code className="font-bakin-typography-family-mono">{workflowIdLabel}</code>
            {isManagedSource ? (
              <Badge tone="accent" variant="solid" size="xs">Managed workflow</Badge>
            ) : null}
            {effectiveSource === 'user' && shadowedSource ? (
              <Badge tone="accent" variant="soft" size="xs">Shadows managed default</Badge>
            ) : null}
          </>
        )}
        actions={(
          <div
            className="flex w-full min-w-0 items-center gap-bakin-2 @3xl/page-header:w-auto"
            data-workflow-editor-header-actions
          >
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-w-0 flex-1 @3xl/page-header:flex-none"
              aria-label="Edit workflow details"
              onClick={openWorkflowDetails}
              disabled={workflowDetailsOpen || Boolean(selectedStep)}
            >
              <Pencil aria-hidden="true" />
              Details
            </Button>
            {canSaveInPlace && (
              <Button
                size="sm"
                className="min-w-0 flex-1 @3xl/page-header:flex-none"
                onClick={handleSave}
                disabled={saving || workflowDetailsOpen || createSetupOpen || Boolean(selectedStep)}
              >
                <Save aria-hidden="true" /> Save
              </Button>
            )}
          </div>
        )}
        overflowActionsLabel="Workflow actions"
        overflowActions={canDelete ? (
          <DropdownMenuItem
            variant="danger"
            disabled={saving}
            onClick={() => {
              setError(null)
              setDeleteDialogOpen(true)
            }}
          >
            <Trash aria-hidden="true" />
            Delete
          </DropdownMenuItem>
        ) : undefined}
        />
      </WorkspacePageHeader>
      <WorkspacePageCompactHeader
        navigation={onCancel ? (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Back to workflows"
            onClick={unsavedChangesGuard.requestExit}
          >
            <ArrowLeft aria-hidden="true" />
          </Button>
        ) : undefined}
        title={workflowNameLabel}
        action={canSaveInPlace ? (
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || workflowDetailsOpen || createSetupOpen || Boolean(selectedStep)}
          >
            <Save aria-hidden="true" />
            Save
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-label="Edit workflow details"
            onClick={openWorkflowDetails}
            disabled={workflowDetailsOpen || Boolean(selectedStep)}
          >
            <Pencil aria-hidden="true" />
            Details
          </Button>
        )}
        overflowActionsLabel="Workflow actions"
        overflowActions={canSaveInPlace || canDelete ? (
          <>
            {canSaveInPlace ? (
              <DropdownMenuItem
                disabled={workflowDetailsOpen || Boolean(selectedStep)}
                onClick={openWorkflowDetails}
              >
                <Pencil aria-hidden="true" />
                Details
              </DropdownMenuItem>
            ) : null}
            {canDelete ? (
              <DropdownMenuItem
                variant="danger"
                disabled={saving}
                onClick={() => {
                  setError(null)
                  setDeleteDialogOpen(true)
                }}
              >
                <Trash aria-hidden="true" />
                Delete
              </DropdownMenuItem>
            ) : null}
          </>
        ) : undefined}
      />

      <WorkflowDeleteDialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          setDeleteDialogOpen(open)
          if (!open) setError(null)
        }}
        workflowName={definition.name || editingId || initialId || 'this workflow'}
        deleting={saving}
        error={error}
        onDelete={handleDelete}
      />

      <WorkspacePageBody>
        <PageBody
          gap="content"
          className="w-full gap-0"
          feedback={error ? (
            <div className="px-bakin-4 pb-bakin-4 @md/page-shell:px-bakin-6 @xl/page-shell:px-bakin-8">
              <Banner
                tone="danger"
                title="Workflow change failed"
                description={error}
                announce="polite"
              />
            </div>
          ) : undefined}
        >
          <PageCanvas
            orientation="vertical"
            className="min-h-32 flex-1 overflow-hidden rounded-none border-x-0 border-y-0 @md/page-shell:border-t"
            label="Workflow editor"
          >
            <div className="flex h-full min-h-0 min-w-0">
            <NodeTypePalette
              collapsed={paletteCollapsed}
              disabledKinds={disabledPaletteKinds}
              onCollapsedChange={setPaletteCollapsed}
            />

            <div className="relative min-h-0 min-w-0 flex-1 bg-bakin-canvas-default [--xy-edge-stroke:var(--bakin-color-border-subtle)] [--xy-edge-stroke-width:2]">
          <style>{RESET_NODE_STYLES}</style>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onNodeClick={onNodeClick}
            onPaneClick={onPaneClick}
            onDragOver={(event) => {
              if (!hasPaletteDragType(event.dataTransfer)) return
              event.preventDefault()
              event.dataTransfer.dropEffect = 'copy'
            }}
            onDrop={(event) => {
              if (!hasPaletteDragType(event.dataTransfer)) return
              const kind = event.dataTransfer.getData(PALETTE_DRAG_MIME_TYPE)
              if (!kind) return
              event.preventDefault()
              insertStepAt(kind, state.order.length)
            }}
            onInit={(rf) => {
              rfInstanceRef.current = rf
            }}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            fitView
            fitViewOptions={{ padding: 0.3 }}
            proOptions={{ hideAttribution: true }}
            nodesDraggable={true}
            nodesConnectable={false}
          >
            {selectedStep && (
              <NodeToolbar
                nodeId={selectedStep.id}
                isVisible
                position={Position.Top}
                align="end"
                offset={8}
                className="flex items-center gap-1 rounded-bakin-control border border-bakin-border-subtle bg-bakin-surface-default/95 p-1 shadow-lg backdrop-blur"
              >
                <Button
                  aria-label="Move selected step up"
                  variant="ghost"
                  size="sm"
                  onClick={() => moveSelectedStep(-1)}
                  disabled={selectedIndex <= 0 || nodeDrawerDirty}
                >
                  <ArrowUp className="size-3.5" />
                </Button>
                <Button
                  aria-label="Move selected step down"
                  variant="ghost"
                  size="sm"
                  onClick={() => moveSelectedStep(1)}
                  disabled={selectedIndex < 0 || selectedIndex >= state.order.length - 1 || nodeDrawerDirty}
                >
                  <ArrowDown className="size-3.5" />
                </Button>
                <Button
                  aria-label="Duplicate selected step"
                  variant="ghost"
                  size="sm"
                  onClick={duplicateSelectedStep}
                  disabled={selectedStep.type === 'output' || nodeDrawerDirty}
                >
                  <Copy className="size-3.5" />
                </Button>
                <Button
                  aria-label="Delete selected step"
                  variant="danger"
                  size="sm"
                  onClick={deleteSelectedStep}
                  disabled={nodeDrawerDirty}
                >
                  <Trash className="size-3.5" />
                </Button>
              </NodeToolbar>
            )}
            <Panel
              position="top-left"
              className="m-bakin-2 flex rounded-bakin-control border border-bakin-border-subtle bg-bakin-surface-default/95 p-bakin-1 shadow-bakin-elevation-overlay backdrop-blur"
            >
              <Button variant="ghost" size="sm" onClick={handleAutoArrange} disabled={saving}>
                <LayoutGrid aria-hidden="true" /> Auto-arrange
              </Button>
            </Panel>
            <Background variant={BackgroundVariant.Dots} color="var(--bakin-color-border-subtle)" gap={24} size={1.5} />
            <Controls position="bottom-left" showInteractive={false} />
            <MiniMap
              className="hidden md:block"
              nodeColor="var(--bakin-color-border-subtle)"
              maskColor="color-mix(in srgb, var(--bakin-color-canvas-default) 78%, transparent)"
            />
          </ReactFlow>
            </div>

            {workflowDetailsOpen && !selectedStep && (
              <WorkflowDetailsDrawer
                definition={definition}
                onApply={handleWorkflowDetailsApply}
                onClose={closeWorkflowDetails}
                applyLabel={mode === 'edit' && canSaveInPlace ? 'Save details' : 'Apply'}
                applying={saving}
              />
            )}

            {selectedStep && !workflowDetailsOpen && (
              <NodeConfigDrawer
                key={`${selectedStep.id}:${selectedStep.type ?? ''}`}
                step={selectedStep}
                onApply={handleApply}
                onDelete={deleteSelectedStep}
                onClose={closeNodeDrawer}
                onDirtyChange={setDrawerDirty}
                existingStepIds={state.order}
                reservedStepIds={RESERVED_STEP_IDS}
              />
            )}
            </div>
          </PageCanvas>
        </PageBody>
      </WorkspacePageBody>

      <ManagedWorkflowCopyDialog
        open={createSetupOpen}
        variant="create"
        creating={creatingLocalCopy}
        error={copyError}
        fieldErrors={copyFieldErrors}
        copyName={copyName}
        copyId={copyId}
        workflowDescription={copyDescription}
        disableOriginal={false}
        showDescription
        showDisableOriginal={false}
        onOpenChange={(open) => {
          setCreateSetupOpen(open)
          if (!open) {
            setCopyError(null)
            setCopyFieldErrors({})
            onCancel?.()
          }
        }}
        onCopyNameChange={(value) => {
          setCopyName(value)
          setCopyError(null)
          setCopyFieldErrors((prev) => (
            copyIdEdited
              ? clearWorkflowDialogFieldError(prev, 'name')
              : clearWorkflowDialogFieldError(prev, 'name', 'id')
          ))
          if (!copyIdEdited) setCopyId(slugify(value))
        }}
        onCopyIdChange={(value) => {
          setCopyIdEdited(true)
          setCopyError(null)
          setCopyFieldErrors((prev) => clearWorkflowDialogFieldError(prev, 'id'))
          setCopyId(slugify(value))
        }}
        onWorkflowDescriptionChange={(value) => {
          setCopyDescription(value)
          setCopyError(null)
          setCopyFieldErrors((prev) => clearWorkflowDialogFieldError(prev, 'description'))
        }}
        onDisableOriginalChange={() => {}}
        onCancel={() => {
          setCreateSetupOpen(false)
          onCancel?.()
        }}
        onCreate={handleCreateWorkflowSetup}
      />

      <ManagedWorkflowCopyDialog
        open={managedCopyOpen}
        creating={creatingLocalCopy}
        error={copyError}
        fieldErrors={copyFieldErrors}
        copyName={copyName}
        copyId={copyId}
        disableOriginal={disableOriginal}
        onOpenChange={(open) => {
          setManagedCopyOpen(open)
          if (!open) {
            setCopyError(null)
            setCopyFieldErrors({})
            if (isManagedSource) onCancel?.()
          }
        }}
        onCopyNameChange={(value) => {
          setCopyName(value)
          setCopyError(null)
          setCopyFieldErrors((prev) => (
            copyIdEdited
              ? clearWorkflowDialogFieldError(prev, 'name')
              : clearWorkflowDialogFieldError(prev, 'name', 'id')
          ))
          if (!copyIdEdited) setCopyId(slugify(value))
        }}
        onCopyIdChange={(value) => {
          setCopyIdEdited(true)
          setCopyError(null)
          setCopyFieldErrors((prev) => clearWorkflowDialogFieldError(prev, 'id'))
          setCopyId(slugify(value))
        }}
        onDisableOriginalChange={setDisableOriginal}
        onCancel={() => {
          setManagedCopyOpen(false)
          onCancel?.()
        }}
        onCreate={handleCreateLocalCopy}
      />

      {unsavedChangesGuard.dialog}
    </WorkspacePage>
  )
}
