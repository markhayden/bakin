import { useMemo } from 'react'
import { useAgentList, useAgentStore } from '@makinbakin/sdk/hooks'
import type { AgentSelectOption } from '@makinbakin/sdk/patterns'

/** Plugin-local adapter: the public selector stays presentation-only. */
export function useBrandAgentOptions(): AgentSelectOption[] {
  const agents = useAgentList()
  const displaySettings = useAgentStore((state) => state.displaySettings)

  return useMemo(() => agents.map((agent) => ({
    id: agent.id,
    name: displaySettings[agent.id]?.displayName ?? agent.name,
    imageSrc: agent.headshot || undefined,
    color: displaySettings[agent.id]?.accentColor,
  })), [agents, displaySettings])
}
