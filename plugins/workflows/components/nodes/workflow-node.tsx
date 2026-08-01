'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Workflow } from 'lucide-react'

interface WorkflowNodeData extends Record<string, unknown> {
  label: string
  workflow_id?: string
  description?: string
}

export function WorkflowNode({ data }: NodeProps) {
  const { label, workflow_id, description } = data as WorkflowNodeData

  return (
    <div className="flex h-full w-full flex-col justify-center rounded-bakin-surface border-2 border-dashed border-bakin-signal-info/60 bg-bakin-surface-default px-4 py-3 shadow-lg">
      <div className="mb-2 flex items-center gap-2">
        <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-bakin-control bg-bakin-signal-info/15 ring-1 ring-bakin-signal-info/40">
          <Workflow className="size-3.5 text-bakin-signal-info" />
        </span>
        <span className="text-bakin-typography-size-meta font-bakin-typography-weight-bold uppercase tracking-wider text-bakin-signal-info">
          Nested Workflow
        </span>
      </div>
      <div className="truncate text-bakin-typography-size-body font-bakin-typography-weight-medium text-bakin-text-primary">{label}</div>
      {workflow_id && (
        <div className="mt-1 truncate font-bakin-typography-family-mono text-bakin-typography-size-meta text-bakin-text-muted">{workflow_id}</div>
      )}
      {description && (
        <p className="mt-0.5 truncate text-bakin-typography-size-meta leading-snug text-bakin-text-muted">{description}</p>
      )}
      <Handle type="target" position={Position.Top} className="!bg-bakin-text-muted" />
      <Handle type="source" position={Position.Bottom} className="!bg-bakin-text-muted" />
    </div>
  )
}
