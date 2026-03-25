'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Workflow } from 'lucide-react'

interface SubflowGroupNodeData extends Record<string, unknown> {
  label: string
  workflow_id?: string
  width?: number
  height?: number
}

export function SubflowGroupNode({ data }: NodeProps) {
  const { label, workflow_id } = data as SubflowGroupNodeData

  return (
    <div className="h-full w-full rounded-xl border-2 border-dashed border-cyan-500/30 bg-cyan-950/10 p-3">
      <div className="flex items-center gap-1.5 mb-1">
        <Workflow className="size-3 text-cyan-400" />
        <span className="text-[10px] font-bold uppercase tracking-wider text-cyan-400">
          {label}
        </span>
        {workflow_id && (
          <span className="text-[9px] font-mono text-cyan-500/50 ml-1">{workflow_id}</span>
        )}
      </div>
      <Handle type="target" position={Position.Top} className="!bg-cyan-500" />
      <Handle type="source" position={Position.Bottom} className="!bg-cyan-500" />
    </div>
  )
}
