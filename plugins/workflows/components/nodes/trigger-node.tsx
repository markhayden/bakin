'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Radio } from 'lucide-react'

export function TriggerNode(_props: NodeProps) {
  return (
    <div className="flex h-full w-full flex-col justify-center rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-3 shadow-lg">
      <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-blue-400">
        <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-blue-500/10">
          <Radio className="size-3.5" />
        </span>
        Start
      </div>
      <div className="line-clamp-2 text-[11px] leading-snug text-zinc-500">
        Task context &amp; description passed to first step
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-blue-500" />
    </div>
  )
}
