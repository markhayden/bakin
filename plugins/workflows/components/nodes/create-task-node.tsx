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
    <div className="flex h-full w-full flex-col justify-center rounded-lg border border-sky-500/50 bg-zinc-900 px-4 py-3 shadow-lg">
      <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-sky-300">
        <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-sky-500/10">
          <ClipboardPlus className="size-3.5" />
        </span>
        Create Task
      </div>
      <div className="truncate text-sm font-medium text-zinc-100">{label}</div>
      {agent && <AgentAssignmentLabel agent={agent} className="mt-1" />}
      {detail && (
        <p className={`${agent ? 'mt-0.5' : 'mt-1'} truncate text-[11px] leading-snug text-zinc-500`}>
          {detail}
        </p>
      )}
      {column && (
        <div className="mt-0.5 truncate text-[11px] text-zinc-400">Column: {column}</div>
      )}
      <Handle type="target" position={Position.Top} className="!bg-zinc-500" />
      <Handle type="source" position={Position.Bottom} className="!bg-zinc-500" />
    </div>
  )
}
