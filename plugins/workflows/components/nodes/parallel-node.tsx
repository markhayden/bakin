'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { AlertTriangle, GitBranch } from 'lucide-react'
import { NodeCard } from '@makinbakin/sdk/patterns'
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
    <NodeCard
      tone="info"
      border="tone"
      dashed
      centered
      typeLabel="Parallel Group"
      icon={<GitBranch className="size-bakin-3" />}
      attention={hasSkillDrift}
      badge={hasSkillDrift ? (
        <StaleSkillChip srLabel="This group includes a stale workflow skill">
          <AlertTriangle className="size-bakin-3" />
          Stale
        </StaleSkillChip>
      ) : undefined}
      title={label}
    >
      <Handle type="target" position={Position.Top} className="!bg-bakin-text-muted" />
      <Handle type="source" position={Position.Bottom} className="!bg-bakin-text-muted" />
    </NodeCard>
  )
}
