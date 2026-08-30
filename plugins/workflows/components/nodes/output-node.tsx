'use client'

import { Handle, Position, type NodeProps } from '@xyflow/react'
import { AlertTriangle, Radio } from 'lucide-react'
import { NodeCard } from '@makinbakin/sdk/patterns'
import { Text } from '@makinbakin/sdk/ui'
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
    <NodeCard
      tone="accent"
      border="tone"
      typeLabel="Completion"
      icon={<Radio className="size-bakin-3" />}
      attention={hasSkillDrift}
      badge={hasSkillDrift ? (
        <StaleSkillChip srLabel="This step uses a stale workflow skill">
          <AlertTriangle className="size-bakin-3" />
          Stale
        </StaleSkillChip>
      ) : undefined}
      title={label}
    >
      {agent && <AgentAssignmentLabel agent={agent} className="mt-bakin-1" />}
      {channelText ? (
        <Text size="meta" tone="muted" as="div" className="mt-bakin-1 truncate">
          Channels: {channelText}
        </Text>
      ) : description ? (
        <Text size="meta" tone="muted" as="p" className="mt-bakin-1 line-clamp-2 leading-snug">{description}</Text>
      ) : null}
      <Handle type="target" position={Position.Top} className="!bg-bakin-text-muted" />
    </NodeCard>
  )
}
