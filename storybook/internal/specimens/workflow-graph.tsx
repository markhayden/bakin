import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
  type ReactFlowInstance,
} from '@xyflow/react'
import { useCallback, useState } from 'react'

import '@xyflow/react/dist/style.css'

import { Action, BoundedOverflow, Inline, Status } from './candidate-ui'

export const WORKFLOW_GRAPH_CSS = `
.bakin-workflow { container-type: inline-size; display: grid; gap: var(--candidate-section-gap); min-width: 0; }
.bakin-workflow__layout { display: grid; grid-template-columns: minmax(0, 1fr) minmax(12rem, 0.42fr); gap: var(--candidate-item-gap); align-items: start; min-width: 0; }
.bakin-workflow-canvas-shell { width: 100%; height: 28rem; }
.bakin-workflow-canvas {
  width: 100%;
  height: 100%;
  background: color-mix(in srgb, var(--bakin-color-canvas-default) 88%, var(--bakin-color-surface-default));
  --xy-background-color: var(--bakin-color-canvas-default);
  --xy-background-pattern-color: var(--bakin-color-border-subtle);
  --xy-controls-button-background-color: var(--bakin-color-surface-default);
  --xy-controls-button-background-color-hover: var(--bakin-color-canvas-default);
  --xy-controls-button-border-color: var(--bakin-color-border-subtle);
  --xy-controls-button-color: var(--bakin-color-text-primary);
  --xy-controls-button-color-hover: var(--bakin-color-text-primary);
  --xy-controls-box-shadow: none;
  --xy-edge-stroke: var(--bakin-color-text-muted);
  --xy-edge-stroke-selected: var(--bakin-color-focus-ring);
  --xy-minimap-background-color: var(--bakin-color-surface-default);
  --xy-minimap-mask-background-color: color-mix(in srgb, var(--bakin-color-canvas-default) 72%, transparent);
  --xy-minimap-mask-stroke-color: var(--bakin-color-border-subtle);
}
.bakin-workflow-canvas .react-flow__node { border: 0; background: transparent; padding: var(--bakin-layout-space-0); box-shadow: none; }
.bakin-workflow-canvas .react-flow__node:focus-visible { outline: 2px solid var(--bakin-color-focus-ring); outline-offset: 3px; }
.bakin-workflow-canvas .react-flow__node.selected .bakin-workflow-node { border-color: var(--bakin-color-focus-ring); }
.bakin-workflow-canvas .react-flow__controls, .bakin-workflow-canvas .react-flow__minimap { overflow: hidden; border: 1px solid var(--bakin-color-border-subtle); border-radius: var(--candidate-control-radius); }
.bakin-workflow[data-orientation='vertical'] .react-flow__minimap { width: 8rem; height: 6rem; }
.bakin-workflow-node { position: relative; display: grid; align-content: start; gap: var(--bakin-layout-space-2); width: 13rem; min-height: 6.5rem; border: 1px solid var(--bakin-color-border-subtle); border-left-width: 4px; border-radius: var(--candidate-surface-radius); padding: var(--bakin-layout-space-3); background: var(--bakin-color-surface-default); color: var(--bakin-color-text-primary); }
.bakin-workflow-node[data-domain='trigger'] { border-left-color: var(--bakin-color-signal-highlight); }
.bakin-workflow-node[data-domain='agent'] { border-left-color: var(--bakin-color-signal-accent); }
.bakin-workflow-node[data-domain='transform'] { border-left-color: var(--bakin-color-action-primary-background); }
.bakin-workflow-node[data-domain='output'] { border-left-color: var(--bakin-color-signal-danger); }
.bakin-workflow-node__kind { color: var(--bakin-color-text-muted); font-size: var(--candidate-meta-size); font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
.bakin-workflow-node strong { overflow-wrap: anywhere; font-size: var(--candidate-body-size); }
.bakin-workflow-node code { overflow-wrap: anywhere; color: var(--bakin-color-text-muted); font-family: var(--candidate-font-mono); font-size: var(--candidate-meta-size); }
.bakin-workflow-node__handle { width: var(--bakin-layout-space-3); height: var(--bakin-layout-space-3); border: 2px solid var(--bakin-color-text-muted); background: var(--bakin-color-surface-default); }
.bakin-inspector { display: grid; gap: var(--candidate-section-gap); min-width: 0; border-left: 1px solid var(--bakin-color-border-subtle); padding-left: var(--candidate-section-gap); }
.bakin-inspector h3 { margin: var(--bakin-layout-space-0); overflow-wrap: anywhere; font-size: var(--candidate-section-title-size); }
.bakin-inspector p { margin: var(--bakin-layout-space-0); color: var(--bakin-color-text-muted); line-height: 1.55; }
.bakin-inspector dl { display: grid; gap: var(--candidate-item-gap); margin: var(--bakin-layout-space-0); }
.bakin-inspector div { display: grid; gap: var(--bakin-layout-space-1); padding-top: var(--candidate-item-gap); border-top: 1px solid var(--bakin-color-border-subtle); }
.bakin-inspector dt { color: var(--bakin-color-text-muted); font-size: var(--candidate-meta-size); }
.bakin-inspector dd { min-width: 0; margin: var(--bakin-layout-space-0); overflow-wrap: anywhere; }
.bakin-workflow-status { min-width: 0; margin: var(--bakin-layout-space-0); overflow-wrap: anywhere; color: var(--bakin-color-text-muted); font-family: var(--candidate-font-mono); font-size: var(--candidate-meta-size); }
@container (max-width: 52rem) {
  .bakin-workflow__layout { grid-template-columns: minmax(0, 1fr); }
  .bakin-inspector { border-left: 0; border-top: 1px solid var(--bakin-color-border-subtle); padding: var(--candidate-section-gap) var(--bakin-layout-space-0) var(--bakin-layout-space-0); }
}
@container (max-width: 30rem) {
  .bakin-workflow-canvas .react-flow__minimap { display: none; }
}
@media (max-width: 42rem) {
  .bakin-workflow__layout { grid-template-columns: minmax(0, 1fr); }
  .bakin-inspector { border-left: 0; border-top: 1px solid var(--bakin-color-border-subtle); padding: var(--candidate-section-gap) var(--bakin-layout-space-0) var(--bakin-layout-space-0); }
  .bakin-workflow-canvas .react-flow__minimap { display: none; }
}
`.trim()

type NodeDomain = 'trigger' | 'agent' | 'transform' | 'output'
type WorkflowNodeId = 'schedule' | 'draft' | 'assemble' | 'publish'
export type WorkflowOrientation = 'vertical' | 'horizontal'

interface WorkflowNodeData extends Record<string, unknown> {
  domain: NodeDomain
  title: string
  detail: string
  orientation: WorkflowOrientation
}

type SpecimenNode = Node<WorkflowNodeData, 'workflowSpecimen'>

const workflowNodeDefinitions = [
  { id: 'schedule', domain: 'trigger', title: 'Weekly campaign schedule', detail: 'Mon 09:00 America/Denver' },
  { id: 'draft', domain: 'agent', title: 'Draft launch copy', detail: 'provider/openai/gpt-5.2' },
  { id: 'assemble', domain: 'transform', title: 'Assemble social video', detail: 'asset:campaign/spring-hero-final-v18.webp' },
  { id: 'publish', domain: 'output', title: 'Queue publishing review', detail: 'team:marketing-operations' },
] as const

const workflowPositions: Record<WorkflowOrientation, Record<WorkflowNodeId, { x: number; y: number }>> = {
  vertical: { schedule: { x: 135, y: 0 }, draft: { x: 0, y: 160 }, assemble: { x: 270, y: 160 }, publish: { x: 135, y: 320 } },
  horizontal: { schedule: { x: 0, y: 80 }, draft: { x: 270, y: 0 }, assemble: { x: 270, y: 160 }, publish: { x: 540, y: 80 } },
}

const workflowLayouts = {
  vertical: { axis: 'y', step: 160, maximum: 320, backwardLabel: 'Move up', forwardLabel: 'Move down', backwardAria: 'Move selected node up', forwardAria: 'Move selected node down' },
  horizontal: { axis: 'x', step: 270, maximum: 540, backwardLabel: 'Move left', forwardLabel: 'Move right', backwardAria: 'Move selected node left', forwardAria: 'Move selected node right' },
} as const

function createWorkflowNodes(orientation: WorkflowOrientation): SpecimenNode[] {
  return workflowNodeDefinitions.map((node) => ({
    id: node.id,
    type: 'workflowSpecimen',
    position: workflowPositions[orientation][node.id],
    data: { domain: node.domain, title: node.title, detail: node.detail, orientation },
    ariaRole: 'button',
    ariaLabel: `${node.title}, ${node.domain} node`,
    selected: node.id === 'assemble',
  }))
}

const workflowEdges: Edge[] = [
  { id: 'schedule-draft', source: 'schedule', target: 'draft' },
  { id: 'schedule-assemble', source: 'schedule', target: 'assemble' },
  { id: 'draft-publish', source: 'draft', target: 'publish' },
  { id: 'assemble-publish', source: 'assemble', target: 'publish' },
]

function WorkflowNode({ data }: NodeProps<SpecimenNode>) {
  const { domain, orientation } = data
  const targetPosition = orientation === 'vertical' ? Position.Top : Position.Left
  const sourcePosition = orientation === 'vertical' ? Position.Bottom : Position.Right
  return (
    <div className="bakin-workflow-node" data-domain={domain}>
      {domain !== 'trigger' && <Handle className="bakin-workflow-node__handle" type="target" position={targetPosition} isConnectable={false} />}
      <span className="bakin-workflow-node__kind">{domain}</span>
      <strong>{data.title}</strong>
      <code>{data.detail}</code>
      {domain !== 'output' && <Handle className="bakin-workflow-node__handle" type="source" position={sourcePosition} isConnectable={false} />}
    </div>
  )
}

const workflowNodeTypes = { workflowSpecimen: WorkflowNode }

function miniMapNodeColor(node: Node): string {
  const domain = (node.data as Partial<WorkflowNodeData>).domain
  if (domain === 'trigger') return 'var(--bakin-color-signal-highlight)'
  if (domain === 'agent') return 'var(--bakin-color-signal-accent)'
  if (domain === 'transform') return 'var(--bakin-color-action-primary-background)'
  return 'var(--bakin-color-signal-danger)'
}

function workflowCoordinateScale(): number {
  if (typeof document === 'undefined') return 1
  const rootFontSize = Number.parseFloat(getComputedStyle(document.documentElement).fontSize)
  return Number.isFinite(rootFontSize) ? Math.max(1, rootFontSize / 16) : 1
}

function InspectorDrawer({ node, orientation, coordinateScale, onClose, onMove }: { node: SpecimenNode; orientation: WorkflowOrientation; coordinateScale: number; onClose: () => void; onMove: (delta: number) => void }) {
  const layout = workflowLayouts[orientation]
  const coordinate = node.position[layout.axis]
  const stage = Math.max(1, Math.min(3, Math.round(coordinate / (layout.step * coordinateScale)) + 1))
  return (
    <aside className="bakin-inspector" aria-label={`${node.data.title} node inspector`}>
      <Inline align="between"><h3>{node.data.title}</h3><Action aria-label="Close node inspector" onClick={onClose}>Close</Action></Inline>
      <p>Node configuration stays usable beside the graph and reflows below it on narrow screens.</p>
      <dl><div><dt>Category</dt><dd>{node.data.domain}</dd></div><div><dt>Stage</dt><dd>{stage}</dd></div><div><dt>Route</dt><dd><code>workflow://video-social-post/assemble-video</code></dd></div></dl>
      <Inline><Action aria-label={layout.backwardAria} disabled={coordinate <= 0} onClick={() => onMove(-1)}>{layout.backwardLabel}</Action><Action aria-label={layout.forwardAria} disabled={coordinate >= layout.maximum * coordinateScale} onClick={() => onMove(1)}>{layout.forwardLabel}</Action></Inline>
      <p>No dragging is required: focus a selected node and use arrow keys, or use these named move actions.</p>
    </aside>
  )
}

export function WorkflowCanvas({ orientation = 'vertical' }: { orientation?: WorkflowOrientation }) {
  const [nodes, setNodes] = useState<SpecimenNode[]>(() => createWorkflowNodes(orientation))
  const [selectedId, setSelectedId] = useState<WorkflowNodeId | null>('assemble')
  const [coordinateScale, setCoordinateScale] = useState(1)
  const onNodesChange = useCallback((changes: NodeChange<SpecimenNode>[]) => {
    setNodes((current) => applyNodeChanges(changes, current))
  }, [])
  const selectNode = useCallback((id: WorkflowNodeId | null) => {
    setSelectedId(id)
    setNodes((current) => current.map((node) => ({ ...node, selected: node.id === id })))
  }, [])
  const moveNode = useCallback((id: WorkflowNodeId, delta: number) => {
    const layout = workflowLayouts[orientation]
    const step = layout.step * coordinateScale
    const maximum = layout.maximum * coordinateScale
    setSelectedId(id)
    setNodes((current) => current.map((node) => node.id === id ? { ...node, selected: true, position: { ...node.position, [layout.axis]: Math.max(0, Math.min(maximum, node.position[layout.axis] + delta * step)) } } : { ...node, selected: false }))
  }, [coordinateScale, orientation])
  const initialiseViewport = useCallback((instance: ReactFlowInstance<SpecimenNode, Edge>) => {
    const nextScale = workflowCoordinateScale()
    if (nextScale === 1) return
    setCoordinateScale(nextScale)
    setNodes((current) => current.map((node) => ({ ...node, position: { x: node.position.x * nextScale, y: node.position.y * nextScale } })))
    requestAnimationFrame(() => { void instance.fitView({ padding: 0.2 }) })
  }, [])
  const selectedNode = nodes.find((node) => node.id === selectedId)
  const primaryAxis = workflowLayouts[orientation].axis

  return (
    <div className="bakin-workflow" data-orientation={orientation}>
      <Inline align="between"><Status>Live workflow · last run 10:38</Status><span className="bakin-workflow-status" role="status">{selectedNode ? `${selectedNode.data.title} selected at ${primaryAxis} ${Math.round(selectedNode.position[primaryAxis])}` : 'No node selected'}</span></Inline>
      <div className="bakin-workflow__layout">
        <BoundedOverflow label="Scrollable two-dimensional workflow canvas">
          <div className="bakin-workflow-canvas-shell">
            <ReactFlow
              className="bakin-workflow-canvas"
              colorMode="dark"
              nodes={nodes}
              edges={workflowEdges}
              nodeTypes={workflowNodeTypes}
              onInit={initialiseViewport}
              onNodesChange={onNodesChange}
              onNodeClick={(_event, node) => selectNode(node.id as WorkflowNodeId)}
              onPaneClick={() => selectNode(null)}
              onSelectionChange={({ nodes: selectedNodes }) => { if (selectedNodes[0]) setSelectedId(selectedNodes[0].id as WorkflowNodeId) }}
              nodesConnectable={false}
              nodesDraggable
              nodesFocusable
              disableKeyboardA11y={false}
              deleteKeyCode={null}
              minZoom={0.35}
              maxZoom={1.5}
              fitView
              fitViewOptions={{ padding: 0.2 }}
              defaultEdgeOptions={{ type: 'smoothstep', markerEnd: { type: MarkerType.ArrowClosed } }}
              defaultMarkerColor="var(--bakin-color-text-muted)"
              proOptions={{ hideAttribution: true }}
            >
              <Background variant={BackgroundVariant.Dots} color="var(--bakin-color-border-subtle)" gap={24} size={1.4} />
              <Controls showInteractive={false} />
              <MiniMap position={orientation === 'vertical' ? 'top-right' : 'bottom-right'} nodeColor={miniMapNodeColor} nodeStrokeWidth={2} pannable zoomable />
            </ReactFlow>
          </div>
        </BoundedOverflow>
        {selectedNode && <InspectorDrawer node={selectedNode} orientation={orientation} coordinateScale={coordinateScale} onClose={() => selectNode(null)} onMove={(delta) => moveNode(selectedNode.id as WorkflowNodeId, delta)} />}
      </div>
    </div>
  )
}
