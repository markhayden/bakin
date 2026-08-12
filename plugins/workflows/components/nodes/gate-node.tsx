'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { CheckCircle2 } from 'lucide-react'
import { NodeCard } from '@makinbakin/sdk/patterns'

interface GateNodeData extends Record<string, unknown> {
  label: string
  description?: string
}

export function GateNode({ data }: NodeProps) {
  const { label, description } = data as GateNodeData

  return (
    <NodeCard
      tone="highlight"
      border="strong"
      centered
      typeLabel="Approval Gate"
      icon={<CheckCircle2 className="size-bakin-3" />}
      title={label}
    >
      {description && (
        <p className="mt-bakin-1 line-clamp-2 text-bakin-typography-size-meta leading-snug text-bakin-text-muted">{description}</p>
      )}
      <Handle type="target" position={Position.Top} className="!bg-bakin-text-muted" />
      <Handle type="source" position={Position.Bottom} className="!bg-bakin-text-muted" />
    </NodeCard>
  )
}
