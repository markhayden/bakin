'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'

interface GateNodeData extends Record<string, unknown> {
  label: string
  description?: string
}

export function GateNode({ data }: NodeProps) {
  const { label, description } = data as GateNodeData

  return (
    <div className="w-[280px] rounded-lg border-2 border-amber-400 bg-zinc-900 p-3 shadow-lg">
      <div className="mb-0.5 text-xs font-bold uppercase tracking-wider text-amber-400">
        🚦 Approval Gate
      </div>
      <div className="text-sm text-zinc-200">{label}</div>
      {description && (
        <p className="mt-1 text-[11px] text-zinc-500 leading-snug line-clamp-2">{description}</p>
      )}
      <Handle type="target" position={Position.Top} className="!bg-zinc-500" />
      <Handle type="source" position={Position.Bottom} className="!bg-zinc-500" />
    </div>
  )
}
