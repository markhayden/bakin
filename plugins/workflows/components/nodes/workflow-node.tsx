'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Workflow } from 'lucide-react'
import { NodeCard } from '@makinbakin/sdk/patterns'

interface WorkflowNodeData extends Record<string, unknown> {
  label: string
  workflow_id?: string
  description?: string
}

export function WorkflowNode({ data }: NodeProps) {
  const { label, workflow_id, description } = data as WorkflowNodeData

  return (
    <NodeCard
      tone="info"
      border="tone"
      dashed
      centered
      typeLabel="Nested Workflow"
      icon={<Workflow className="size-bakin-3" />}
      title={label}
    >
      {workflow_id && (
        <div className="mt-bakin-1 truncate font-bakin-typography-family-mono text-bakin-typography-size-meta text-bakin-text-muted">{workflow_id}</div>
      )}
      {description && (
        <p className="mt-bakin-1 truncate text-bakin-typography-size-meta leading-snug text-bakin-text-muted">{description}</p>
      )}
      <Handle type="target" position={Position.Top} className="!bg-bakin-text-muted" />
      <Handle type="source" position={Position.Bottom} className="!bg-bakin-text-muted" />
    </NodeCard>
  )
}
