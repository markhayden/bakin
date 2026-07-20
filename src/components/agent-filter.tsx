'use client'

import { useMemo } from 'react'
import { AgentFilter as AgentFilterPresentation } from '@bakin/ui/patterns'
import { useAgentStore } from '@makinbakin/sdk/hooks'
import { AgentAvatar } from '@/components/agent-avatar'

export interface AgentFilterProps {
  agentIds: string[]
  value: string
  onChange: (agentId: string) => void
  showIcon?: boolean
}

/** Compatibility adapter that supplies Bakin agent metadata to the presentation pattern. */
export function AgentFilter({ agentIds, value, onChange, showIcon = true }: AgentFilterProps) {
  const agentMap = useAgentStore((state) => state.agentMap)
  const displaySettings = useAgentStore((state) => state.displaySettings)
  const options = useMemo(() => agentIds.map((id) => ({
    value: id,
    label: displaySettings[id]?.displayName ?? agentMap[id]?.name ?? id,
    visual: <AgentAvatar agentId={id} size="xs" />,
  })), [agentIds, agentMap, displaySettings])

  return (
    <AgentFilterPresentation
      options={options}
      value={value}
      onValueChange={onChange}
      showIcon={showIcon}
      compact
    />
  )
}
