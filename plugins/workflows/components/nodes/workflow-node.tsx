'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Workflow } from 'lucide-react'
import { NodeCard } from '@makinbakin/sdk/patterns'
import { Text } from '@makinbakin/sdk/ui'

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
        <Text size="meta" tone="muted" mono as="div" className="mt-bakin-1 truncate">{workflow_id}</Text>
      )}
      {description && (
        <Text size="meta" tone="muted" as="p" className="mt-bakin-1 truncate leading-snug">{description}</Text>
      )}
      <Handle type="target" position={Position.Top} className="!bg-bakin-text-muted" />
      <Handle type="source" position={Position.Bottom} className="!bg-bakin-text-muted" />
    </NodeCard>
  )
}
