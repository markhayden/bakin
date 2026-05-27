'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { CheckCircle2 } from 'lucide-react'

interface GateNodeData extends Record<string, unknown> {
  label: string
  description?: string
}

export function GateNode({ data }: NodeProps) {
  const { label, description } = data as GateNodeData

  return (
    <div className="flex h-full w-full flex-col justify-center rounded-lg border-2 border-amber-400 bg-zinc-900 px-4 py-3 shadow-lg">
      <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-amber-400">
        <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-amber-500/10">
          <CheckCircle2 className="size-3.5" />
        </span>
        Approval Gate
      </div>
      <div className="truncate text-sm font-medium text-zinc-100">{label}</div>
      {description && (
        <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-zinc-500">{description}</p>
      )}
      <Handle type="target" position={Position.Top} className="!bg-zinc-500" />
      <Handle type="source" position={Position.Bottom} className="!bg-zinc-500" />
    </div>
  )
}
