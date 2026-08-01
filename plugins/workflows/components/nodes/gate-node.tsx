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
    <div className="flex h-full w-full flex-col justify-center rounded-bakin-surface border-2 border-bakin-signal-highlight bg-bakin-surface-default px-4 py-3 shadow-lg">
      <div className="mb-2 flex items-center gap-2 text-bakin-typography-size-meta font-bakin-typography-weight-bold uppercase tracking-wider text-bakin-signal-highlight">
        <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-bakin-control bg-bakin-signal-highlight/10">
          <CheckCircle2 className="size-3.5" />
        </span>
        Approval Gate
      </div>
      <div className="truncate text-bakin-typography-size-body font-bakin-typography-weight-medium text-bakin-text-primary">{label}</div>
      {description && (
        <p className="mt-1 line-clamp-2 text-bakin-typography-size-meta leading-snug text-bakin-text-muted">{description}</p>
      )}
      <Handle type="target" position={Position.Top} className="!bg-bakin-text-muted" />
      <Handle type="source" position={Position.Bottom} className="!bg-bakin-text-muted" />
    </div>
  )
}
