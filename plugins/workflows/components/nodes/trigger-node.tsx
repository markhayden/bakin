'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'

interface TriggerNodeData extends Record<string, unknown> {
  description?: string
}

export function TriggerNode({ data }: NodeProps) {
  const { description } = data as TriggerNodeData

  return (
    <div className="w-[280px] rounded-lg border border-zinc-700 bg-zinc-900 p-4 shadow-lg">
      <div className="mb-1 text-xs font-bold uppercase tracking-wider text-blue-400">
        📥 Start
      </div>
      <div className="text-[10px] text-zinc-500 leading-relaxed">
        Task context &amp; description passed to first step
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-blue-500" />
    </div>
  )
}
