'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Radio } from 'lucide-react'
import { NodeCard } from '@makinbakin/sdk/patterns'
import { Text } from '@makinbakin/sdk/ui'

export function TriggerNode(_props: NodeProps) {
  return (
    <NodeCard
      tone="info"
      centered
      typeLabel="Start"
      icon={<Radio className="size-bakin-3" />}
    >
      <Text size="meta" tone="muted" as="div" className="line-clamp-2 leading-snug">
        Task context &amp; description passed to first step
      </Text>
      <Handle type="source" position={Position.Bottom} className="!bg-bakin-signal-info" />
    </NodeCard>
  )
}
