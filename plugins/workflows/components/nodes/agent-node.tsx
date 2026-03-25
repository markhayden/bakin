'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { User } from 'lucide-react'
import { AGENTS } from '@/lib/constants'

interface AgentNodeData extends Record<string, unknown> {
  label: string
  agent?: string
  task?: string
}

const isDynamic = (agent?: string) => agent === '$assigned'

export function AgentNode({ data }: NodeProps) {
  const { label, agent, task } = data as AgentNodeData
  const agentMeta = agent && !isDynamic(agent) ? AGENTS.find(a => a.id === agent) : undefined

  // Show first ~80 chars of task as excerpt
  const excerpt = task && task.length > 80 ? task.slice(0, 80).trim() + '…' : task

  return (
    <div className="w-[280px] rounded-lg border-2 border-zinc-700 bg-zinc-900 p-3 shadow-lg">
      <div className="mb-1.5 flex items-center gap-2">
        {agentMeta ? (
          <img
            src={agentMeta.headshot}
            alt={agentMeta.name}
            className="size-7 rounded-full object-cover ring-1 ring-zinc-600"
          />
        ) : isDynamic(agent) ? (
          <span className="inline-flex size-7 items-center justify-center rounded-full bg-blue-900/50 ring-1 ring-blue-500/40">
            <User className="size-3.5 text-blue-400" />
          </span>
        ) : (
          <span className="inline-flex size-7 items-center justify-center rounded-full bg-zinc-800 text-xs ring-1 ring-zinc-600">
            ?
          </span>
        )}
        <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
          {isDynamic(agent) ? 'Assigned Agent' : agentMeta?.name ?? agent ?? 'Agent'}
        </span>
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
