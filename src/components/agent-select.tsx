'use client'

import { AgentAvatar } from '@/components/agent-avatar'
import { AGENTS } from '@/lib/constants'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

interface AgentSelectProps {
  value: string
  onValueChange: (value: string) => void
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
  allowNone = false,
  noneLabel = 'Unassigned',
  placeholder = 'Select agent...',
  agentIds,
  className,
}: AgentSelectProps) {
  const agents = agentIds ? AGENTS.filter(a => agentIds.includes(a.id)) : AGENTS

  return (
    <Select value={value} onValueChange={(v) => onValueChange(v ?? '')}>
      <SelectTrigger className={className}>
        <SelectValue placeholder={placeholder}>
          {value ? (
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
