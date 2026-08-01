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
    <div className="flex h-full w-full flex-col justify-center rounded-bakin-surface border-2 border-dashed border-bakin-signal-accent/60 bg-bakin-surface-default px-4 py-3 shadow-lg">
      <div className="mb-2 flex items-center gap-2">
        <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-bakin-control bg-bakin-signal-accent/15 ring-1 ring-bakin-signal-accent/40">
          <Layers className="size-3.5 text-bakin-signal-accent" />
        </span>
        <span className="text-bakin-typography-size-meta font-bakin-typography-weight-bold uppercase tracking-wider text-bakin-signal-accent">
          Map Fan-out
        </span>
      </div>
      <div className="truncate text-bakin-typography-size-body font-bakin-typography-weight-medium text-bakin-text-primary">{label}</div>
      {workflow_id && (
        <div className="mt-1 truncate font-bakin-typography-family-mono text-bakin-typography-size-meta text-bakin-text-muted">{workflow_id}</div>
      )}
      {source && (
        <div className="mt-0.5 truncate font-bakin-typography-family-mono text-bakin-typography-size-meta text-bakin-signal-accent/70">
          × {source}{max_children ? ` (max ${max_children})` : ''}
        </div>
      )}
      {description && (
        <p className="mt-0.5 truncate text-bakin-typography-size-meta leading-snug text-bakin-text-muted">{description}</p>
      )}
      <Handle type="target" position={Position.Top} className="!bg-bakin-text-muted" />
      <Handle type="source" position={Position.Bottom} className="!bg-bakin-text-muted" />
    </div>
  )
}
