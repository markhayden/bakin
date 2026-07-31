'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { AlertTriangle, User } from 'lucide-react'
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
    <div className={`flex h-full w-full flex-col overflow-hidden rounded-bakin-surface border-2 bg-bakin-surface-default px-4 py-3 shadow-lg ${hasSkillDrift ? 'border-bakin-signal-highlight/70 ring-1 ring-bakin-signal-highlight/25' : 'border-bakin-border-subtle'}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-bakin-control bg-bakin-action-primary-background/10 ring-1 ring-bakin-action-primary-background/25">
            <User className="size-3.5 text-bakin-action-primary-background" />
          </span>
          <span className="truncate text-bakin-typography-size-meta font-bakin-typography-weight-bold uppercase tracking-wider text-bakin-action-primary-background">
            Agent Task
          </span>
        </div>
        {hasSkillDrift && (
          <StaleSkillChip title="This step uses a stale workflow skill">
            <AlertTriangle className="size-3" />
            Stale
          </StaleSkillChip>
        )}
      </div>
      <div className="truncate text-bakin-typography-size-body font-bakin-typography-weight-medium leading-5 text-bakin-text-primary">{label}</div>
      <AgentAssignmentLabel agent={agent} className="mt-1" />
      {excerpt && (
        <p className="mt-1 line-clamp-2 text-bakin-typography-size-meta leading-snug text-bakin-text-muted">{excerpt}</p>
      )}
      <Handle type="target" position={Position.Top} className="!bg-bakin-text-muted" />
      <Handle type="source" position={Position.Bottom} className="!bg-bakin-text-muted" />
    </div>
  )
}
