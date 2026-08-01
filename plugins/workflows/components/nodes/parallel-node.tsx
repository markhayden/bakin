'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { AlertTriangle, GitBranch } from 'lucide-react'
import { StaleSkillChip } from './stale-skill-chip'

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
    <div className={`flex h-full w-full flex-col justify-center overflow-hidden rounded-bakin-surface border bg-bakin-surface-default/70 px-4 py-3 shadow-lg ${hasSkillDrift ? 'border-bakin-signal-highlight/70 ring-1 ring-bakin-signal-highlight/25' : 'border-dashed border-bakin-signal-info/50'}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-bakin-typography-size-meta font-bakin-typography-weight-bold uppercase tracking-wider text-bakin-signal-info">
          <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-bakin-control bg-bakin-signal-info/10">
            <GitBranch className="size-3.5" />
          </span>
          <span className="truncate">Parallel Group</span>
        </div>
        {hasSkillDrift && (
          <StaleSkillChip title="This group includes a stale workflow skill">
            <AlertTriangle className="size-3" />
            Stale
          </StaleSkillChip>
        )}
      </div>
      <div className="truncate text-bakin-typography-size-body font-bakin-typography-weight-medium leading-5 text-bakin-text-primary">{label}</div>
      <Handle type="target" position={Position.Top} className="!bg-bakin-text-muted" />
      <Handle type="source" position={Position.Bottom} className="!bg-bakin-text-muted" />
    </div>
  )
}
