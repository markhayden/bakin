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
    <div className="flex h-full w-full flex-col justify-center rounded-lg border-2 border-dashed border-cyan-500/60 bg-zinc-900 px-4 py-3 shadow-lg">
      <div className="mb-2 flex items-center gap-2">
        <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-cyan-900/50 ring-1 ring-cyan-500/40">
          <Workflow className="size-3.5 text-cyan-400" />
        </span>
        <span className="text-xs font-bold uppercase tracking-wider text-cyan-400">
          Nested Workflow
        </span>
      </div>
      <div className="truncate text-sm font-medium text-zinc-100">{label}</div>
      {workflow_id && (
        <div className="mt-1 truncate font-mono text-[10px] text-zinc-500">{workflow_id}</div>
      )}
      {description && (
        <p className="mt-0.5 truncate text-[11px] leading-snug text-zinc-500">{description}</p>
      )}
      <Handle type="target" position={Position.Top} className="!bg-zinc-500" />
      <Handle type="source" position={Position.Bottom} className="!bg-zinc-500" />
    </div>
  )
}
