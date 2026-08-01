'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Radio } from 'lucide-react'

export function TriggerNode(_props: NodeProps) {
  return (
    <div className="flex h-full w-full flex-col justify-center rounded-bakin-surface border border-bakin-border-subtle bg-bakin-surface-default px-4 py-3 shadow-lg">
      <div className="mb-2 flex items-center gap-2 text-bakin-typography-size-meta font-bakin-typography-weight-bold uppercase tracking-wider text-bakin-signal-info">
        <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-bakin-control bg-bakin-signal-info/10">
          <Radio className="size-3.5" />
        </span>
        Start
      </div>
      <div className="line-clamp-2 text-bakin-typography-size-meta leading-snug text-bakin-text-muted">
        Task context &amp; description passed to first step
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-bakin-signal-info" />
    </div>
  )
}
