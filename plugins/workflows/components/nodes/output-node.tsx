'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'

interface OutputNodeData extends Record<string, unknown> {
  label: string
  channels?: string[]
}

export function OutputNode({ data }: NodeProps) {
  const { label, channels } = data as OutputNodeData

  return (
    <div className="w-[260px] rounded-lg border-2 border-zinc-700 bg-zinc-900 p-3 shadow-lg">
      <div className="mb-0.5 text-xs font-bold uppercase tracking-wider text-purple-400">
        📤 {label}
      </div>
      {channels && channels.length > 0 && (
        <div className="text-xs text-zinc-400">
          {channels.join(', ')}
        </div>
      )}
      <Handle type="target" position={Position.Top} className="!bg-zinc-500" />
    </div>
  )
}
