'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'

interface ParallelNodeData extends Record<string, unknown> {
  label: string
  width?: number
  height?: number
}

export function ParallelNode({ data }: NodeProps) {
  const { label } = data as ParallelNodeData

  return (
    <div className="h-full w-full rounded-xl border border-dashed border-zinc-600 bg-zinc-900/50 p-3">
      <div className="text-xs font-bold uppercase tracking-wider text-zinc-500">
        ⚡ {label}
      </div>
      <Handle type="target" position={Position.Top} className="!bg-zinc-500" />
      <Handle type="source" position={Position.Bottom} className="!bg-zinc-500" />
    </div>
  )
}
