'use client'

/**
 * Data-wired adapters over the presentational agent patterns.
 *
 * The public `@makinbakin/sdk/patterns` AgentAvatar/AgentSelect are
 * identity-fed and store-free by design; these thin wrappers supply the
 * registered roster (and existing team-route data) the way every other
 * conformed plugin does, so workflow surfaces never touch the frozen
 * `/components` barrel.
 */

import type { AriaAttributes } from 'react'
import { useEffect, useMemo, useState } from 'react'
import {
  AgentAvatar,
  AgentSelect as AgentSelectPresentation,
  type AgentAvatarProps,
} from '@makinbakin/sdk/patterns'
import { useAgent, useAgentColor, useAgentDisplayName, useAgentList, useAgentStore } from '@makinbakin/sdk/hooks'

export function WorkflowAgentAvatar({
  agentId,
  size,
  className,
}: {
  agentId: string
  size?: AgentAvatarProps['size']
  className?: string
}) {
  const agent = useAgent(agentId)
  const color = useAgentColor(agentId)
  const displayName = useAgentDisplayName(agentId)
  return (
    <AgentAvatar
      agent={{
        id: agentId,
        name: displayName ?? agent?.name ?? agentId,
        imageSrc: agent?.headshot || undefined,
        color,
      }}
      size={size}
      className={className}
    />
  )
}

interface SelectableTeam {
  id: string
  label: string
  color?: string
}

interface WorkflowAgentSelectProps extends Pick<AriaAttributes, 'aria-describedby' | 'aria-invalid'> {
  id?: string
  value: string
  onValueChange: (value: string) => void
  includeAssigned?: boolean
  allowNone?: boolean
  className?: string
}

/** Roster + team-aware assignment selector for workflow step forms. */
export function WorkflowAgentSelect({
  value,
  onValueChange,
  includeAssigned = false,
  allowNone = false,
  className,
  id,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
}: WorkflowAgentSelectProps) {
  const allAgents = useAgentList()
  const displaySettings = useAgentStore((state) => state.displaySettings)
  const agents = useMemo(() => allAgents.map((agent) => ({
    id: agent.id,
    name: displaySettings[agent.id]?.displayName ?? agent.name,
    imageSrc: agent.headshot || undefined,
    color: displaySettings[agent.id]?.accentColor,
  })), [allAgents, displaySettings])

  const [teams, setTeams] = useState<SelectableTeam[]>([])
  useEffect(() => {
    let active = true
    fetch('/api/plugins/team/teams')
      .then((response) => response.json())
      .then((data) => {
        const list = Array.isArray(data) ? data : (data as { teams?: SelectableTeam[] })?.teams
        if (active && Array.isArray(list)) setTeams(list)
      })
      .catch(() => {})
    return () => { active = false }
  }, [])

  return (
    <AgentSelectPresentation
      id={id}
      value={value}
      onValueChange={onValueChange}
      agents={agents}
      teams={teams}
      includeAssigned={includeAssigned}
      allowNone={allowNone}
      ariaLabel={id ? undefined : 'Select agent'}
      className={className}
      aria-describedby={ariaDescribedBy}
      aria-invalid={ariaInvalid}
    />
  )
}
