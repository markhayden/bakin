'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { ClipboardPlus } from 'lucide-react'
import { AgentAssignmentLabel } from './agent-assignment-label'

interface CreateTaskNodeData extends Record<string, unknown> {
  label: string
  agent?: string
  title?: string
  column?: string
  description?: string
}

export function CreateTaskNode({ data }: NodeProps) {
  const { label, agent, title, column, description } = data as CreateTaskNodeData
  const detail = title || description

  return (
    <div className="flex h-full w-full flex-col justify-center rounded-bakin-surface border border-bakin-signal-info/50 bg-bakin-surface-default px-4 py-3 shadow-lg">
      <div className="mb-2 flex items-center gap-2 text-bakin-typography-size-meta font-bakin-typography-weight-bold uppercase tracking-wider text-bakin-signal-info">
        <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-bakin-control bg-bakin-signal-info/10">
          <ClipboardPlus className="size-3.5" />
        </span>
        Create Task
      </div>
      <div className="truncate text-bakin-typography-size-body font-bakin-typography-weight-medium text-bakin-text-primary">{label}</div>
      {agent && <AgentAssignmentLabel agent={agent} className="mt-1" />}
      {detail && (
        <p className={`${agent ? 'mt-0.5' : 'mt-1'} truncate text-bakin-typography-size-meta leading-snug text-bakin-text-muted`}>
          {detail}
        </p>
      )}
      {column && (
        <div className="mt-0.5 truncate text-bakin-typography-size-meta text-bakin-text-muted">Column: {column}</div>
      )}
      <Handle type="target" position={Position.Top} className="!bg-bakin-text-muted" />
      <Handle type="source" position={Position.Bottom} className="!bg-bakin-text-muted" />
    </div>
  )
}
