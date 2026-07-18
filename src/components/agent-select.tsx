'use client'

import type { AriaAttributes } from 'react'
import { useEffect, useState } from 'react'
import { User, Users } from 'lucide-react'
import { AgentAvatar } from '@/components/agent-avatar'
import { useAgentList } from '@makinbakin/sdk/hooks'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

/** Prefix marking a team selection in the select's string value (#189).
 * Task surfaces split it back into {agent} vs {team} before talking to the
 * API; workflow STEP definitions store the token verbatim (#611 — the step's
 * team target, resolved sticky at dispatch). */
export const TEAM_VALUE_PREFIX = 'team:'

export function isTeamValue(value: string): boolean {
  return value.startsWith(TEAM_VALUE_PREFIX)
}

export function teamIdFromValue(value: string): string {
  return isTeamValue(value) ? value.slice(TEAM_VALUE_PREFIX.length) : ''
}

interface SelectableTeam {
  id: string
  label: string
  color?: string
}

function TeamDot({ color }: { color?: string }) {
  return color
    ? <span className="size-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
    : <Users className="size-3.5 text-muted-foreground" />
}

interface AgentSelectProps extends Pick<AriaAttributes, 'aria-describedby' | 'aria-invalid'> {
  id?: string
  value: string
  onValueChange: (value: string) => void
  /** Include the workflow/task runtime assignee token (`$assigned`) */
  includeAssigned?: boolean
  assignedLabel?: string
  /** Show a "None" / "Unassigned" option at the top (default: false) */
  allowNone?: boolean
  /** Label for the none option (default: "Unassigned") */
  noneLabel?: string
  /** Placeholder when nothing selected */
  placeholder?: string
  /** Restrict to a subset of agent IDs */
  agentIds?: string[]
  /** Offer teams as assignment targets (`team:<id>` values, #189) */
  includeTeams?: boolean
  className?: string
}

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
  const agents = agentIds ? allAgents.filter(a => agentIds.includes(a.id)) : allAgents
  const isAssignedToken = value === '$assigned'

  const [teams, setTeams] = useState<SelectableTeam[]>([])
  useEffect(() => {
    if (!includeTeams) return
    fetch('/api/plugins/team/teams')
      .then((r) => r.json())
      .then((data) => {
        // Route responds { teams: [...] }; accept a bare array defensively.
        const list = Array.isArray(data) ? data : (data as { teams?: SelectableTeam[] })?.teams
        if (Array.isArray(list)) setTeams(list)
      })
      .catch(() => {})
  }, [includeTeams])

  const selectedTeam = isTeamValue(value)
    ? teams.find(t => t.id === teamIdFromValue(value))
    : undefined

  return (
    <Select value={value} onValueChange={(v) => onValueChange(v ?? '')}>
      <SelectTrigger
        id={id}
        className={className}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
      >
        <SelectValue placeholder={placeholder}>
          {isAssignedToken ? (
            <span className="flex items-center gap-2">
              <User className="size-3.5 text-blue-400" />
              {assignedLabel}
            </span>
          ) : isTeamValue(value) ? (
            <span className="flex items-center gap-2">
              <TeamDot color={selectedTeam?.color} />
              {selectedTeam?.label || teamIdFromValue(value)}
            </span>
          ) : value ? (
            <span className="flex items-center gap-2">
              <AgentAvatar agentId={value} size="xs" />
              {agents.find(a => a.id === value)?.name || value}
            </span>
          ) : allowNone ? (
            noneLabel
          ) : undefined}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {allowNone && (
          <SelectItem value="">{noneLabel}</SelectItem>
        )}
        {includeAssigned && (
          <SelectItem value="$assigned">
            <User className="size-3.5 text-blue-400" />
            {assignedLabel}
          </SelectItem>
        )}
        {includeTeams && teams.length > 0 && (
          <SelectGroup>
            <SelectLabel>Teams</SelectLabel>
            {teams.map(t => (
              <SelectItem key={t.id} value={`${TEAM_VALUE_PREFIX}${t.id}`}>
                <TeamDot color={t.color} />
                {t.label}
              </SelectItem>
            ))}
          </SelectGroup>
        )}
        {includeTeams && teams.length > 0 ? (
          <SelectGroup>
            <SelectLabel>Agents</SelectLabel>
            {agents.map(a => (
              <SelectItem key={a.id} value={a.id}>
                <AgentAvatar agentId={a.id} size="xs" />
                {a.name}
              </SelectItem>
            ))}
          </SelectGroup>
        ) : (
          agents.map(a => (
            <SelectItem key={a.id} value={a.id}>
              <AgentAvatar agentId={a.id} size="xs" />
              {a.name}
            </SelectItem>
          ))
        )}
      </SelectContent>
    </Select>
  )
}
