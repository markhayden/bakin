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

  // Show first ~80 chars of task as excerpt
  const excerpt = task && task.length > 80 ? task.slice(0, 80).trim() + '…' : task

  return (
    <div className="w-[320px] rounded-lg border-2 border-zinc-700 bg-zinc-900 p-4 shadow-lg">
      <div className="mb-2 flex items-center gap-2.5">
        {agentMeta ? (
          <img
            src={agentMeta.headshot}
            alt={agentMeta.name}
            className="size-7 rounded-full object-cover ring-1 ring-zinc-600"
          />
        ) : (
          <span className="inline-flex size-7 items-center justify-center rounded-full bg-zinc-800 text-xs ring-1 ring-zinc-600">
            ?
          </span>
        )}
        <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
          {agentMeta?.name ?? agent ?? 'Agent'}
        </span>
      </div>
      <div className="mb-1 text-sm text-zinc-200">{label}</div>
      {excerpt && (
        <p className="text-xs text-zinc-500 leading-relaxed line-clamp-2">{excerpt}</p>
      )}
      <Handle type="target" position={Position.Left} className="!bg-zinc-500" />
      <Handle type="source" position={Position.Right} className="!bg-zinc-500" />
    </div>
  )
}
