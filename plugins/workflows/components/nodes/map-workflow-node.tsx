'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Layers } from 'lucide-react'

interface MapWorkflowNodeData extends Record<string, unknown> {
  label: string
  workflow_id?: string
  source?: string
  max_children?: number
  description?: string
}

/**
 * Canvas node for map_workflow fan-out steps. The canvas renders the
 * DEFINITION — children are runtime instances and never appear as nodes;
 * live child state (rollup, per-child retry/cancel) surfaces on the task
 * detail panel where instance state lives.
 */
export function MapWorkflowNode({ data }: NodeProps) {
  const { label, workflow_id, source, max_children, description } = data as MapWorkflowNodeData

  return (
    <div className="flex h-full w-full flex-col justify-center rounded-lg border-2 border-dashed border-violet-500/60 bg-zinc-900 px-4 py-3 shadow-lg">
      <div className="mb-2 flex items-center gap-2">
        <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-violet-900/50 ring-1 ring-violet-500/40">
          <Layers className="size-3.5 text-violet-400" />
        </span>
        <span className="text-xs font-bold uppercase tracking-wider text-violet-400">
          Map Fan-out
        </span>
      </div>
      <div className="truncate text-sm font-medium text-zinc-100">{label}</div>
      {workflow_id && (
        <div className="mt-1 truncate font-mono text-[10px] text-zinc-500">{workflow_id}</div>
      )}
      {source && (
        <div className="mt-0.5 truncate font-mono text-[10px] text-violet-400/70">
          × {source}{max_children ? ` (max ${max_children})` : ''}
        </div>
      )}
      {description && (
        <p className="mt-0.5 truncate text-[11px] leading-snug text-zinc-500">{description}</p>
      )}
      <Handle type="target" position={Position.Top} className="!bg-zinc-500" />
      <Handle type="source" position={Position.Bottom} className="!bg-zinc-500" />
    </div>
  )
}
