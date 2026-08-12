'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { AlertTriangle, User } from 'lucide-react'
import { NodeCard } from '@makinbakin/sdk/patterns'
import { AgentAssignmentLabel } from './agent-assignment-label'
import { StaleSkillChip } from './stale-skill-chip'

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
    <NodeCard
      tone="primary"
      typeLabel="Agent Task"
      icon={<User className="size-bakin-3 text-bakin-action-primary-background" />}
      attention={hasSkillDrift}
      badge={hasSkillDrift ? (
        <StaleSkillChip srLabel="This step uses a stale workflow skill">
          <AlertTriangle className="size-bakin-3" />
          Stale
        </StaleSkillChip>
      ) : undefined}
      title={label}
    >
      <AgentAssignmentLabel agent={agent} className="mt-bakin-1" />
      {excerpt && (
        <p className="mt-bakin-1 line-clamp-2 text-bakin-typography-size-meta leading-snug text-bakin-text-muted">{excerpt}</p>
      )}
      <Handle type="target" position={Position.Top} className="!bg-bakin-text-muted" />
      <Handle type="source" position={Position.Bottom} className="!bg-bakin-text-muted" />
    </NodeCard>
  )
}
