'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { ClipboardPlus } from 'lucide-react'
import { NodeCard } from '@makinbakin/sdk/patterns'
import { AgentAssignmentLabel } from './agent-assignment-label'

interface CreateTaskNodeData extends Record<string, unknown> {
  label: string
  agent?: string
  title?: string
  column?: string
  description?: string
}

export function CreateTaskNode({ data }: NodeProps) {
  const { label, agent, title, column, description } = data as CreateTaskNodeData
  const detail = title || description

  return (
    <NodeCard
      tone="info"
      border="tone"
      centered
      typeLabel="Create Task"
      icon={<ClipboardPlus className="size-bakin-3" />}
      title={label}
    >
      {agent && <AgentAssignmentLabel agent={agent} className="mt-bakin-1" />}
      {detail && (
        <p className="mt-bakin-1 truncate text-bakin-typography-size-meta leading-snug text-bakin-text-muted">
          {detail}
        </p>
      )}
      {column && (
        <div className="mt-bakin-1 truncate text-bakin-typography-size-meta text-bakin-text-muted">Column: {column}</div>
      )}
      <Handle type="target" position={Position.Top} className="!bg-bakin-text-muted" />
      <Handle type="source" position={Position.Bottom} className="!bg-bakin-text-muted" />
    </NodeCard>
  )
}
