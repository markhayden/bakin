'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'

interface TriggerNodeData extends Record<string, unknown> {
  description?: string
}

export function TriggerNode({ data }: NodeProps) {
  const { description } = data as TriggerNodeData

  return (
    <div className="w-[260px] rounded-lg border border-zinc-700 bg-zinc-900 p-3 shadow-lg">
      <div className="mb-1 text-xs font-bold uppercase tracking-wider text-blue-400">
        📥 Start
      </div>
      {description && (
        <div className="text-xs text-zinc-400 leading-relaxed">{description}</div>
      )}
      <Handle type="source" position={Position.Bottom} className="!bg-blue-500" />
    </div>
  )
}
