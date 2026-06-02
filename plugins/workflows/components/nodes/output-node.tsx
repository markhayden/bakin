'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { AlertTriangle, Radio } from 'lucide-react'
import { AgentAssignmentLabel } from './agent-assignment-label'

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
    <div className={`flex h-full w-full flex-col justify-center rounded-lg border bg-zinc-900 px-4 py-3 shadow-lg ${hasSkillDrift ? 'border-amber-500/70 ring-1 ring-amber-500/25' : 'border-purple-500/50'}`}>
      <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-purple-400">
        <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-purple-500/10">
          <Radio className="size-3.5" />
        </span>
        Completion
      </div>
      <div className="truncate text-sm font-medium text-zinc-100">{label}</div>
      {agent && <AgentAssignmentLabel agent={agent} className="mt-1" />}
      {hasSkillDrift && (
        <div className="mt-1 inline-flex w-fit items-center gap-1 rounded border border-amber-500/35 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-200">
          <AlertTriangle className="size-3" />
          Stale skill
        </div>
      )}
      {channelText ? (
        <div className={`${agent ? 'mt-0.5' : 'mt-1'} truncate text-[11px] text-zinc-400`}>
          Channels: {channelText}
        </div>
      ) : description ? (
        <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-zinc-500">{description}</p>
      ) : null}
      <Handle type="target" position={Position.Top} className="!bg-zinc-500" />
    </div>
  )
}
