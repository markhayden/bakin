'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { AlertTriangle, GitBranch } from 'lucide-react'

interface ParallelNodeData extends Record<string, unknown> {
  label: string
  width?: number
  height?: number
  skillDrift?: unknown
}

export function ParallelNode({ data }: NodeProps) {
  const { label, skillDrift } = data as ParallelNodeData
  const hasSkillDrift = Boolean(skillDrift)

  return (
    <div className={`flex h-full w-full flex-col justify-center overflow-hidden rounded-lg border bg-zinc-900/70 px-4 py-3 shadow-lg ${hasSkillDrift ? 'border-amber-500/70 ring-1 ring-amber-500/25' : 'border-dashed border-blue-500/50'}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-xs font-bold uppercase tracking-wider text-blue-300">
          <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-blue-500/10">
            <GitBranch className="size-3.5" />
          </span>
          <span className="truncate">Parallel Group</span>
        </div>
        {hasSkillDrift && (
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded border border-amber-500/35 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium leading-none text-amber-200"
            title="This group includes a stale workflow skill"
          >
            <AlertTriangle className="size-3" />
            Stale
          </span>
        )}
      </div>
      <div className="truncate text-sm font-medium leading-5 text-zinc-100">{label}</div>
      <Handle type="target" position={Position.Top} className="!bg-zinc-500" />
      <Handle type="source" position={Position.Bottom} className="!bg-zinc-500" />
    </div>
  )
}
