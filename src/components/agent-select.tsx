'use client'

import type { AriaAttributes } from 'react'
import { User } from 'lucide-react'
import { AgentAvatar } from '@/components/agent-avatar'
import { useAgentList } from '@makinbakin/sdk/hooks'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

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
  className,
  id,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
}: AgentSelectProps) {
  const allAgents = useAgentList()
  const agents = agentIds ? allAgents.filter(a => agentIds.includes(a.id)) : allAgents
  const isAssignedToken = value === '$assigned'

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
        {agents.map(a => (
          <SelectItem key={a.id} value={a.id}>
            <AgentAvatar agentId={a.id} size="xs" />
            {a.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
