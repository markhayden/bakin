'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { AlertTriangle, User } from 'lucide-react'
import { AgentAssignmentLabel } from './agent-assignment-label'

interface AgentNodeData extends Record<string, unknown> {
  label: string
  agent?: string
  task?: string
  skillDrift?: unknown
}

export function AgentNode({ data }: NodeProps) {
  const { label, agent, task, skillDrift } = data as AgentNodeData
  const hasSkillDrift = Boolean(skillDrift)

  // Show first ~80 chars of task as excerpt
  const excerpt = task && task.length > 80 ? task.slice(0, 80).trim() + '…' : task

  return (
    <div className={`flex h-full w-full flex-col justify-center rounded-lg border-2 bg-zinc-900 px-4 py-3 shadow-lg ${hasSkillDrift ? 'border-amber-500/70 ring-1 ring-amber-500/25' : 'border-zinc-700'}`}>
      <div className="mb-2 flex items-center gap-2">
        <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 ring-1 ring-emerald-500/25">
          <User className="size-3.5 text-emerald-400" />
        </span>
        <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
          Agent Task
        </span>
      </div>
      <div className="truncate text-sm font-medium text-zinc-100">{label}</div>
      <AgentAssignmentLabel agent={agent} className="mt-1" />
      {hasSkillDrift && (
        <div className="mt-1 inline-flex w-fit items-center gap-1 rounded border border-amber-500/35 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-200">
          <AlertTriangle className="size-3" />
          Stale skill
        </div>
      )}
      {excerpt && (
        <p className="mt-0.5 truncate text-[11px] leading-snug text-zinc-500">{excerpt}</p>
      )}
      <Handle type="target" position={Position.Top} className="!bg-zinc-500" />
      <Handle type="source" position={Position.Bottom} className="!bg-zinc-500" />
    </div>
  )
}
