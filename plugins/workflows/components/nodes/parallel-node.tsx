'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { GitBranch } from 'lucide-react'

interface ParallelNodeData extends Record<string, unknown> {
  label: string
  width?: number
  height?: number
}

export function ParallelNode({ data }: NodeProps) {
  const { label } = data as ParallelNodeData

  return (
    <div className="flex h-full w-full flex-col justify-center rounded-lg border border-dashed border-blue-500/50 bg-zinc-900/70 px-4 py-3 shadow-lg">
      <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-blue-300">
        <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-blue-500/10">
          <GitBranch className="size-3.5" />
        </span>
        Parallel Group
      </div>
      <div className="truncate text-sm font-medium text-zinc-100">{label}</div>
      <Handle type="target" position={Position.Top} className="!bg-zinc-500" />
      <Handle type="source" position={Position.Bottom} className="!bg-zinc-500" />
    </div>
  )
}
