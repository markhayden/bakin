'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Radio } from 'lucide-react'
import { NodeCard } from '@makinbakin/sdk/patterns'

export function TriggerNode(_props: NodeProps) {
  return (
    <NodeCard
      tone="info"
      centered
      typeLabel="Start"
      icon={<Radio className="size-bakin-3" />}
    >
      <div className="line-clamp-2 text-bakin-typography-size-meta leading-snug text-bakin-text-muted">
        Task context &amp; description passed to first step
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-bakin-signal-info" />
    </NodeCard>
  )
}
