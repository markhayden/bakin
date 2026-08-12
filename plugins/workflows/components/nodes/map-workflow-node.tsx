'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Layers } from 'lucide-react'
import { NodeCard } from '@makinbakin/sdk/patterns'

interface MapWorkflowNodeData extends Record<string, unknown> {
  label: string
  workflow_id?: string
  source?: string
  max_children?: number
  description?: string
}

/**
 * Canvas node for map_workflow fan-out steps. The canvas renders the
 * DEFINITION — children are runtime instances and never appear as nodes;
 * live child state (rollup, per-child retry/cancel) surfaces on the task
 * detail panel where instance state lives.
 */
export function MapWorkflowNode({ data }: NodeProps) {
  const { label, workflow_id, source, max_children, description } = data as MapWorkflowNodeData

  return (
    <NodeCard
      tone="accent"
      border="tone"
      dashed
      centered
      typeLabel="Map Fan-out"
      icon={<Layers className="size-bakin-3" />}
      title={label}
    >
      {workflow_id && (
        <div className="mt-bakin-1 truncate font-bakin-typography-family-mono text-bakin-typography-size-meta text-bakin-text-muted">{workflow_id}</div>
      )}
      {source && (
        <div className="mt-bakin-1 truncate font-bakin-typography-family-mono text-bakin-typography-size-meta text-bakin-signal-accent/70">
          × {source}{max_children ? ` (max ${max_children})` : ''}
        </div>
      )}
      {description && (
        <p className="mt-bakin-1 truncate text-bakin-typography-size-meta leading-snug text-bakin-text-muted">{description}</p>
      )}
      <Handle type="target" position={Position.Top} className="!bg-bakin-text-muted" />
      <Handle type="source" position={Position.Bottom} className="!bg-bakin-text-muted" />
    </NodeCard>
  )
}
