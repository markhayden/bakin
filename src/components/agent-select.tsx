'use client'

import type { AriaAttributes } from 'react'
import { useEffect, useMemo, useState } from 'react'
import {
  AgentSelect as AgentSelectPresentation,
} from '@makinbakin/sdk/patterns'
import { useAgentList, useAgentStore } from '@makinbakin/sdk/hooks'

export { TEAM_VALUE_PREFIX, isTeamValue, teamIdFromValue } from '@makinbakin/sdk/patterns'

interface SelectableTeam {
  id: string
  label: string
  color?: string
}

interface AgentSelectProps extends Pick<AriaAttributes, 'aria-describedby' | 'aria-invalid'> {
  id?: string
  value: string
  onValueChange: (value: string) => void
  includeAssigned?: boolean
  assignedLabel?: string
  allowNone?: boolean
  noneLabel?: string
  placeholder?: string
  agentIds?: string[]
  includeTeams?: boolean
  className?: string
}

/** Compatibility adapter that supplies registered agents and existing team-route data. */
export function AgentSelect({
  value,
  onValueChange,
  includeAssigned = false,
  assignedLabel = 'Assigned agent',
  allowNone = false,
  noneLabel = 'Unassigned',
  placeholder = 'Select agent...',
  agentIds,
  includeTeams = false,
  className,
  id,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
}: AgentSelectProps) {
  const allAgents = useAgentList()
  const displaySettings = useAgentStore((state) => state.displaySettings)
  const agents = useMemo(() => allAgents
    .filter((agent) => !agentIds || agentIds.includes(agent.id))
    .map((agent) => ({
      id: agent.id,
      name: displaySettings[agent.id]?.displayName ?? agent.name,
      imageSrc: agent.headshot || undefined,
      color: displaySettings[agent.id]?.accentColor,
    })), [agentIds, allAgents, displaySettings])

  const [teams, setTeams] = useState<SelectableTeam[]>([])
  useEffect(() => {
    if (!includeTeams) return
    let active = true
    fetch('/api/plugins/team/teams')
      .then((response) => response.json())
      .then((data) => {
        const list = Array.isArray(data) ? data : (data as { teams?: SelectableTeam[] })?.teams
        if (active && Array.isArray(list)) setTeams(list)
      })
      .catch(() => {})
    return () => { active = false }
  }, [includeTeams])

  return (
    <AgentSelectPresentation
      id={id}
      value={value}
      onValueChange={onValueChange}
      agents={agents}
      teams={includeTeams ? teams : []}
      includeAssigned={includeAssigned}
      assignedLabel={assignedLabel}
      allowNone={allowNone}
      noneLabel={noneLabel}
      placeholder={placeholder}
      ariaLabel={id ? undefined : 'Select agent'}
      className={className}
      aria-describedby={ariaDescribedBy}
      aria-invalid={ariaInvalid}
    />
  )
}
