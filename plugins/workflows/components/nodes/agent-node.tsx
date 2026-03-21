'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { AGENTS } from '@/lib/constants'

interface AgentNodeData extends Record<string, unknown> {
  label: string
  agent?: string
  task?: string
}

export function AgentNode({ data }: NodeProps) {
  const { label, agent, task } = data as AgentNodeData
  const agentMeta = agent ? AGENTS.find(a => a.id === agent) : undefined
  const agentDisplay = agentMeta ? `${agentMeta.emoji} ${agentMeta.name}` : agent ?? 'Agent'

  // Show first ~60 chars of task as excerpt
  const excerpt = task && task.length > 60 ? task.slice(0, 60).trim() + '…' : task

  return (
    <div className="w-[260px] rounded-lg border-2 border-zinc-700 bg-zinc-900 p-3 shadow-lg">
      <div className="mb-0.5 text-xs font-bold uppercase tracking-wider text-emerald-400">
        {agentDisplay}
      </div>
      <div className="mb-1 text-sm text-zinc-200">{label}</div>
      {excerpt && (
        <p className="text-xs text-zinc-500 leading-relaxed line-clamp-2">{excerpt}</p>
      )}
      <Handle type="target" position={Position.Top} className="!bg-zinc-500" />
      <Handle type="source" position={Position.Bottom} className="!bg-zinc-500" />
    </div>
  )
}
