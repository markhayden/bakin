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
} from '@xyflow/react'
import { useCallback, useEffect, useState } from 'react'

import '@xyflow/react/dist/style.css'

import {
  InspectorPanel,
  InspectorPanelContent,
  InspectorPanelFooter,
  InspectorPanelHeader,
  PageCanvas,
  type PageCanvasOrientation,
} from '@makinbakin/sdk/patterns'
import { Badge, Button, SystemState } from '@makinbakin/sdk/ui'

type WorkflowNodeId = 'schedule' | 'draft' | 'assemble' | 'review'
type WorkflowNodeDomain = 'trigger' | 'agent' | 'transform' | 'output'

interface WorkflowNodeData extends Record<string, unknown> {
  detail: string
  domain: WorkflowNodeDomain
  orientation: PageCanvasOrientation
  title: string
}

type StoryNode = Node<WorkflowNodeData, 'workflowStory'>

const nodeDefinitions = [
  {
    id: 'schedule',
    domain: 'trigger',
    title: 'Weekly campaign schedule',
    detail: 'Mon 09:00 America/Denver',
  },
  {
    id: 'draft',
    domain: 'agent',
    title: 'Draft launch copy',
    detail: 'provider/openai/gpt-5.2',
  },
  {
    id: 'assemble',
    domain: 'transform',
    title: 'Assemble social video',
    detail: 'asset:campaign/spring-hero-final-v18.webp',
  },
  {
    id: 'review',
    domain: 'output',
    title: 'Queue publishing review',
    detail: 'team:marketing-operations',
  },
] as const

const basePositions: Record<
  PageCanvasOrientation,
  Record<WorkflowNodeId, { x: number; y: number }>
> = {
  vertical: {
    schedule: { x: 250, y: 0 },
    draft: { x: 0, y: 280 },
    assemble: { x: 500, y: 280 },
    review: { x: 250, y: 560 },
  },
  horizontal: {
    schedule: { x: 0, y: 140 },
    draft: { x: 500, y: 0 },
    assemble: { x: 500, y: 280 },
    review: { x: 1000, y: 140 },
  },
}

const edges: Edge[] = [
  { id: 'schedule-draft', source: 'schedule', target: 'draft' },
  { id: 'schedule-assemble', source: 'schedule', target: 'assemble' },
  { id: 'draft-review', source: 'draft', target: 'review' },
  { id: 'assemble-review', source: 'assemble', target: 'review' },
]

function createNodes(orientation: PageCanvasOrientation): StoryNode[] {
  return nodeDefinitions.map((node) => {
    const position = basePositions[orientation][node.id]
    return {
      id: node.id,
      type: 'workflowStory',
      position,
      data: {
        detail: node.detail,
        domain: node.domain,
        orientation,
        title: node.title,
      },
      ariaRole: 'button',
      ariaLabel: `${node.title}, ${node.domain} node`,
      selected: node.id === 'assemble',
    }
  })
}

function WorkflowStoryNode({ data }: NodeProps<StoryNode>) {
  const vertical = data.orientation === 'vertical'
  return (
    <div className="bakin-workflow-story__node" data-domain={data.domain}>
      {data.domain !== 'trigger' ? (
        <Handle
          className="bakin-workflow-story__handle"
          type="target"
          position={vertical ? Position.Top : Position.Left}
          isConnectable={false}
        />
      ) : null}
      <span>{data.domain}</span>
      <strong>{data.title}</strong>
      <code>{data.detail}</code>
      {data.domain !== 'output' ? (
        <Handle
          className="bakin-workflow-story__handle"
          type="source"
          position={vertical ? Position.Bottom : Position.Right}
          isConnectable={false}
        />
      ) : null}
    </div>
  )
}

const nodeTypes = { workflowStory: WorkflowStoryNode }

function miniMapColor(node: Node): string {
  const domain = (node.data as Partial<WorkflowNodeData>).domain
  if (domain === 'trigger') return 'var(--bakin-color-signal-highlight)'
  if (domain === 'agent') return 'var(--bakin-color-signal-accent)'
  if (domain === 'transform') return 'var(--bakin-color-action-primary-background)'
  return 'var(--bakin-color-signal-danger)'
}

export function WorkflowStoryWorkspace({
  orientation,
}: {
  orientation: PageCanvasOrientation
}) {
  const [nodes, setNodes] = useState<StoryNode[]>(() => createNodes(orientation))
  const [selectedId, setSelectedId] = useState<WorkflowNodeId | null>('assemble')

  useEffect(() => {
    setNodes(createNodes(orientation))
    setSelectedId('assemble')
  }, [orientation])

  const selectNode = useCallback((id: WorkflowNodeId | null) => {
    setSelectedId(id)
    setNodes((current) => current.map((node) => ({ ...node, selected: node.id === id })))
  }, [])

  const onNodesChange = useCallback((changes: NodeChange<StoryNode>[]) => {
    setNodes((current) => applyNodeChanges(changes, current))
  }, [])

  const moveSelected = useCallback((delta: -1 | 1) => {
    if (!selectedId) return
    const axis = orientation === 'vertical' ? 'y' : 'x'
    setNodes((current) => current.map((node) => (
      node.id === selectedId
        ? {
            ...node,
            position: {
              ...node.position,
              [axis]: Math.max(0, node.position[axis] + delta * 20),
            },
          }
        : node
    )))
  }, [orientation, selectedId])

  const selectedNode = nodes.find((node) => node.id === selectedId)
  const axis = orientation === 'vertical' ? 'y' : 'x'

  return (
    <>
      <PageCanvas
        label={`${orientation === 'vertical' ? 'Vertical' : 'Horizontal'} launch publishing workflow canvas`}
        orientation={orientation}
      >
        <div className="bakin-workflow-story__graph-shell">
          <ReactFlow
            className="bakin-workflow-story__graph"
            colorMode="dark"
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange}
            onNodeClick={(_event, node) => selectNode(node.id as WorkflowNodeId)}
            onPaneClick={() => selectNode(null)}
            onSelectionChange={({ nodes: selectedNodes }) => {
              const next = selectedNodes[0]?.id as WorkflowNodeId | undefined
              setSelectedId(next ?? null)
            }}
            nodesConnectable={false}
            nodesDraggable
            nodesFocusable
            disableKeyboardA11y={false}
            deleteKeyCode={null}
            minZoom={0.35}
            maxZoom={1.5}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            defaultEdgeOptions={{
              type: 'smoothstep',
              markerEnd: { type: MarkerType.ArrowClosed },
            }}
            defaultMarkerColor="var(--bakin-color-text-muted)"
            proOptions={{ hideAttribution: true }}
          >
            <Background
              variant={BackgroundVariant.Dots}
              color="var(--bakin-color-border-subtle)"
              gap={24}
              size={1.4}
            />
            <Controls showInteractive={false} />
            <MiniMap
              position={orientation === 'vertical' ? 'top-right' : 'bottom-right'}
              nodeColor={miniMapColor}
              nodeStrokeWidth={2}
              pannable
              zoomable
            />
          </ReactFlow>
        </div>
      </PageCanvas>

      <InspectorPanel label="Selected workflow node inspector">
        <InspectorPanelHeader
          eyebrow="Workflow node"
          title={selectedNode?.data.title ?? 'No node selected'}
          description={selectedNode
            ? `Selected at ${axis} ${Math.round(selectedNode.position[axis])}`
            : 'Choose a node to inspect its place in the action flow.'}
          actions={selectedNode ? (
            <Button
              size="sm"
              variant="ghost"
              aria-label="Close node inspector"
              onClick={() => selectNode(null)}
            >
              Close
            </Button>
          ) : undefined}
        />
        <InspectorPanelContent
          state={!selectedNode ? (
            <SystemState
              kind="initial-empty"
              title="No workflow node selected"
              description="Select a node on the canvas to inspect it."
            />
          ) : undefined}
        >
          {selectedNode ? (
            <dl className="bakin-workflow-story__facts">
              <div><dt>Category</dt><dd><Badge variant="outline">{selectedNode.data.domain}</Badge></dd></div>
              <div><dt>Step ID</dt><dd><code>{selectedNode.id}</code></dd></div>
              <div><dt>Route</dt><dd><code>workflow://video-social-post/{selectedNode.id}</code></dd></div>
            </dl>
          ) : null}
        </InspectorPanelContent>
        {selectedNode ? (
          <InspectorPanelFooter>
            <Button variant="outline" onClick={() => moveSelected(-1)}>
              Move {orientation === 'vertical' ? 'up' : 'left'}
            </Button>
            <Button variant="outline" onClick={() => moveSelected(1)}>
              Move {orientation === 'vertical' ? 'down' : 'right'}
            </Button>
          </InspectorPanelFooter>
        ) : null}
      </InspectorPanel>

      <p className="bakin-workflow-story__selection" role="status">
        {selectedNode
          ? `${selectedNode.data.title} selected at ${axis} ${Math.round(selectedNode.position[axis])}`
          : 'No node selected'}
      </p>
    </>
  )
}
