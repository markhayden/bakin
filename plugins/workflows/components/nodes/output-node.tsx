'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { AlertTriangle, Radio } from 'lucide-react'
import { AgentAssignmentLabel } from './agent-assignment-label'
import { StaleSkillChip } from './stale-skill-chip'

interface OutputNodeData extends Record<string, unknown> {
  label: string
  agent?: string
  channels?: string[]
  description?: string
  skillDrift?: unknown
}

export function OutputNode({ data }: NodeProps) {
  const { label, agent, channels, description, skillDrift } = data as OutputNodeData
  const hasSkillDrift = Boolean(skillDrift)
  const channelText = channels && channels.length > 0 ? channels.join(', ') : undefined

  return (
    <div className={`flex h-full w-full flex-col overflow-hidden rounded-bakin-surface border bg-bakin-surface-default px-4 py-3 shadow-lg ${hasSkillDrift ? 'border-bakin-signal-highlight/70 ring-1 ring-bakin-signal-highlight/25' : 'border-bakin-signal-accent/50'}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-bakin-typography-size-meta font-bakin-typography-weight-bold uppercase tracking-wider text-bakin-signal-accent">
          <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-bakin-control bg-bakin-signal-accent/10">
            <Radio className="size-3.5" />
          </span>
          <span className="truncate">Completion</span>
        </div>
        {hasSkillDrift && (
          <StaleSkillChip title="This step uses a stale workflow skill">
            <AlertTriangle className="size-3" />
            Stale
          </StaleSkillChip>
        )}
      </div>
      <div className="truncate text-bakin-typography-size-body font-bakin-typography-weight-medium leading-5 text-bakin-text-primary">{label}</div>
      {agent && <AgentAssignmentLabel agent={agent} className="mt-1" />}
      {channelText ? (
        <div className={`${agent ? 'mt-0.5' : 'mt-1'} truncate text-bakin-typography-size-meta text-bakin-text-muted`}>
          Channels: {channelText}
        </div>
      ) : description ? (
        <p className="mt-1 line-clamp-2 text-bakin-typography-size-meta leading-snug text-bakin-text-muted">{description}</p>
      ) : null}
      <Handle type="target" position={Position.Top} className="!bg-bakin-text-muted" />
    </div>
  )
}
