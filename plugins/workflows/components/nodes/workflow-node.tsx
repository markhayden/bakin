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
    <div className="w-[280px] rounded-lg border-2 border-dashed border-cyan-500/60 bg-zinc-900 p-4 shadow-lg">
      <div className="mb-2 flex items-center gap-2">
        <span className="inline-flex size-7 items-center justify-center rounded-full bg-cyan-900/50 ring-1 ring-cyan-500/40">
          <Workflow className="size-3.5 text-cyan-400" />
        </span>
        <span className="text-xs font-bold uppercase tracking-wider text-cyan-400">
          Sub-workflow
        </span>
      </div>
      <div className="mb-1 text-sm text-zinc-200">{label}</div>
      {workflow_id && (
        <div className="text-[10px] text-zinc-500 font-mono">{workflow_id}</div>
      )}
      {description && (
        <p className="text-xs text-zinc-500 leading-relaxed mt-1 line-clamp-2">{description}</p>
      )}
      <Handle type="target" position={Position.Top} className="!bg-zinc-500" />
      <Handle type="source" position={Position.Bottom} className="!bg-zinc-500" />
    </div>
  )
}
