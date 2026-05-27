'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Radio } from 'lucide-react'
import { AgentAssignmentLabel } from './agent-assignment-label'

interface OutputNodeData extends Record<string, unknown> {
  label: string
  agent?: string
  channels?: string[]
  description?: string
}

export function OutputNode({ data }: NodeProps) {
  const { label, agent, channels, description } = data as OutputNodeData
  const channelText = channels && channels.length > 0 ? channels.join(', ') : undefined

  return (
    <div className="flex h-full w-full flex-col justify-center rounded-lg border border-purple-500/50 bg-zinc-900 px-4 py-3 shadow-lg">
      <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-purple-400">
        <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-purple-500/10">
          <Radio className="size-3.5" />
        </span>
        Completion
      </div>
      <div className="truncate text-sm font-medium text-zinc-100">{label}</div>
      {agent && <AgentAssignmentLabel agent={agent} className="mt-1" />}
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
