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
    <div className="h-full w-full rounded-bakin-surface border-2 border-dashed border-bakin-signal-info/30 bg-bakin-signal-info/5 p-3">
      <div className="flex items-center gap-1.5 mb-1">
        <Workflow className="size-3 text-bakin-signal-info" />
        <span className="text-bakin-typography-size-meta font-bakin-typography-weight-bold uppercase tracking-wider text-bakin-signal-info">
          {label}
        </span>
        {workflow_id && (
          <span className="text-bakin-typography-size-meta font-bakin-typography-family-mono text-bakin-signal-info/50 ml-1">{workflow_id}</span>
        )}
      </div>
      <Handle type="target" position={Position.Top} className="!bg-bakin-signal-info" />
      <Handle type="source" position={Position.Bottom} className="!bg-bakin-signal-info" />
    </div>
  )
}
