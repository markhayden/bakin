'use client'

import type { AriaAttributes } from 'react'
import {
  Avatar,
  AvatarBadge,
  AvatarFallback,
  AvatarImage,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
  type AvatarSize,
} from '@bakin/ui'

/** Presentation-ready agent identity supplied by a host or plugin. */
export interface AgentIdentity {
  id: string
  name: string
  imageSrc?: string | null
  color?: string
  initials?: string
}

export type AgentPresenceStatus = 'online' | 'working' | 'available' | 'offline' | 'error'

const presence = {
  online: { label: 'Online', dot: 'bg-bakin-action-primary-background' },
  working: { label: 'Working', dot: 'bg-bakin-signal-highlight' },
  available: { label: 'Available', dot: 'bg-bakin-action-primary-background' },
  offline: { label: 'Offline', dot: 'bg-bakin-text-muted' },
  error: { label: 'Needs attention', dot: 'bg-bakin-signal-danger' },
} as const satisfies Record<AgentPresenceStatus, { label: string; dot: string }>

const presentationColor = /^(?:#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgb|hsl)a?\([0-9.,%+\-\s/]+\)|var\(--[a-z0-9][a-z0-9-]*\)|[a-z]+)$/i

function safePresentationColor(value?: string): string | undefined {
  const color = value?.trim()
  return color && presentationColor.test(color) ? color : undefined
}

function identityInitials(agent: AgentIdentity): string {
  if (agent.initials?.trim()) return agent.initials.trim().slice(0, 2).toUpperCase()
  const words = agent.name.trim().split(/\s+/).filter(Boolean)
  if (!words.length) return '?'
  return `${words[0]?.[0] ?? ''}${words.length > 1 ? words.at(-1)?.[0] ?? '' : ''}`.toUpperCase()
}

export interface AgentAvatarProps {
  agent: AgentIdentity
  size?: AvatarSize
  showStatus?: boolean
  status?: AgentPresenceStatus
  /** Hide redundant identity semantics when an adjacent label already names the agent. */
  decorative?: boolean
  className?: string
}

/** Agent portrait or initials with optional exact, non-color-only presence semantics. */
export function AgentAvatar({
  agent,
  size = 'md',
  showStatus = false,
  status,
  decorative = false,
  className,
}: AgentAvatarProps) {
  const statusLabel = showStatus && status ? presence[status].label : null
  const label = statusLabel ? `${agent.name}, ${statusLabel}` : agent.name
  const fallbackColor = safePresentationColor(agent.color)
  return (
    <span
      data-agent-avatar=""
      data-agent-id={agent.id}
      data-status={statusLabel ? status : undefined}
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : label}
      className={`relative inline-flex shrink-0 ${className ?? ''}`}
    >
      <Avatar size={size}>
        {agent.imageSrc ? <AvatarImage src={agent.imageSrc} alt="" className="object-cover object-top" /> : null}
        <AvatarFallback>
          {identityInitials(agent)}
          {fallbackColor ? (
            <svg aria-hidden="true" viewBox="0 0 100 100" className="pointer-events-none absolute inset-0 size-full">
              <circle cx="50" cy="50" r="47" fill="none" stroke={fallbackColor} strokeWidth="6" />
            </svg>
          ) : null}
        </AvatarFallback>
        {statusLabel ? (
          <AvatarBadge aria-hidden="true" className={presence[status!].dot}>
            <span className="sr-only">{statusLabel}</span>
          </AvatarBadge>
        ) : null}
      </Avatar>
    </span>
  )
}

export interface AgentDotProps {
  status: AgentPresenceStatus
  ariaLabel?: string
  decorative?: boolean
  className?: string
}

/** Compact presence mark; use `decorative` only when adjacent visible copy names the state. */
export function AgentDot({ status, ariaLabel, decorative = false, className }: AgentDotProps) {
  return (
    <span
      data-agent-dot={status}
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : (ariaLabel ?? presence[status].label)}
      className={`inline-flex size-bakin-2 shrink-0 rounded-bakin-pill ring-2 ring-bakin-canvas-default ${presence[status].dot} ${className ?? ''}`}
    />
  )
}

export interface AgentStatusProps {
  name: string
  status: AgentPresenceStatus
  detail?: string
  className?: string
}

/** Agent name, visible presence language, and optional current activity. */
export function AgentStatus({ name, status, detail, className }: AgentStatusProps) {
  return (
    <span
      role="status"
      aria-label={`${name} status`}
      data-agent-status={status}
      className={`inline-flex min-w-0 max-w-full flex-wrap items-center gap-x-bakin-2 gap-y-bakin-1 font-bakin-typography-family-ui [font-size:var(--bakin-typography-size-meta)] ${className ?? ''}`}
    >
      <AgentDot status={status} decorative />
      <span className="min-w-0 truncate font-bakin-typography-weight-semibold text-bakin-text-primary">{name}</span>
      <span className="text-bakin-text-muted">{presence[status].label}</span>
      {detail ? <span className="basis-full break-words pl-bakin-4 text-bakin-text-muted">{detail}</span> : null}
    </span>
  )
}

/** Prefix marking a team assignment in the select's string value. */
export const TEAM_VALUE_PREFIX = 'team:'
export const ASSIGNED_AGENT_VALUE = '$assigned'

export function isTeamValue(value: string): boolean {
  return value.startsWith(TEAM_VALUE_PREFIX)
}

export function teamIdFromValue(value: string): string {
  return isTeamValue(value) ? value.slice(TEAM_VALUE_PREFIX.length) : ''
}

export interface AgentSelectOption extends AgentIdentity {
  disabled?: boolean
}

export interface AgentTeamOption {
  id: string
  label: string
  color?: string
  disabled?: boolean
}

export interface AgentSelectProps extends Pick<AriaAttributes, 'aria-describedby' | 'aria-invalid'> {
  id?: string
  name?: string
  value: string
  onValueChange: (value: string) => void
  agents: readonly AgentSelectOption[]
  teams?: readonly AgentTeamOption[]
  includeAssigned?: boolean
  assignedLabel?: string
  allowNone?: boolean
  noneLabel?: string
  placeholder?: string
  /** Accessible name for a trigger without an associated external label. */
  ariaLabel?: string
  disabled?: boolean
  required?: boolean
  className?: string
}

function AssignedMark() {
  return (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-bakin-4 shrink-0 fill-none stroke-current stroke-[1.6] text-bakin-signal-accent">
      <circle cx="8" cy="5" r="2.5" />
      <path d="M3.5 13c.6-2.4 2.1-3.6 4.5-3.6s3.9 1.2 4.5 3.6" strokeLinecap="round" />
    </svg>
  )
}

function TeamMark({ color }: { color?: string }) {
  const markerColor = safePresentationColor(color)
  return markerColor ? (
    <svg aria-hidden="true" viewBox="0 0 12 12" className="size-bakin-3 shrink-0">
      <circle cx="6" cy="6" r="6" fill={markerColor} />
    </svg>
  ) : (
    <svg aria-hidden="true" viewBox="0 0 16 16" className="size-bakin-4 shrink-0 fill-none stroke-current stroke-[1.5] text-bakin-text-muted">
      <circle cx="6" cy="5" r="2" /><circle cx="11" cy="6" r="1.5" />
      <path d="M2.5 13c.5-2.3 1.7-3.5 3.5-3.5s3 1.2 3.5 3.5M9.5 10c1.9 0 3.1 1 3.6 3" strokeLinecap="round" />
    </svg>
  )
}

function AgentChoice({ agent }: { agent: AgentSelectOption }) {
  return (
    <span className="flex min-w-0 items-center gap-bakin-2">
      <AgentAvatar agent={agent} size="sm" decorative />
      <span className="min-w-0 truncate">{agent.name}</span>
    </span>
  )
}

/** Controlled agent/team assignment selector with no store, fetch, or routing ownership. */
export function AgentSelect({
  id,
  name,
  value,
  onValueChange,
  agents,
  teams = [],
  includeAssigned = false,
  assignedLabel = 'Assigned agent',
  allowNone = false,
  noneLabel = 'Unassigned',
  placeholder = 'Select agent…',
  ariaLabel,
  disabled = false,
  required = false,
  className,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
}: AgentSelectProps) {
  const selectedAgent = agents.find((agent) => agent.id === value)
  const selectedTeam = isTeamValue(value)
    ? teams.find((team) => team.id === teamIdFromValue(value))
    : undefined

  return (
    <Select
      name={name}
      value={value}
      onValueChange={(next) => onValueChange(next ?? '')}
      disabled={disabled}
      required={required}
    >
      <SelectTrigger
        id={id}
        aria-label={ariaLabel}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        className={className}
      >
        <SelectValue placeholder={placeholder}>
          {value === ASSIGNED_AGENT_VALUE ? (
            <span className="flex min-w-0 items-center gap-bakin-2"><AssignedMark /><span className="truncate">{assignedLabel}</span></span>
          ) : selectedTeam || isTeamValue(value) ? (
            <span className="flex min-w-0 items-center gap-bakin-2">
              <TeamMark color={selectedTeam?.color} />
              <span className="truncate">{selectedTeam?.label ?? teamIdFromValue(value)}</span>
            </span>
          ) : selectedAgent ? (
            <AgentChoice agent={selectedAgent} />
          ) : value ? (
            <span className="truncate">{value}</span>
          ) : allowNone ? noneLabel : undefined}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {allowNone ? <SelectItem value="">{noneLabel}</SelectItem> : null}
        {includeAssigned ? (
          <SelectItem value={ASSIGNED_AGENT_VALUE}><AssignedMark />{assignedLabel}</SelectItem>
        ) : null}
        {teams.length ? (
          <SelectGroup>
            <SelectLabel>Teams</SelectLabel>
            {teams.map((team) => (
              <SelectItem key={team.id} value={`${TEAM_VALUE_PREFIX}${team.id}`} disabled={team.disabled}>
                <TeamMark color={team.color} />{team.label}
              </SelectItem>
            ))}
          </SelectGroup>
        ) : null}
        {teams.length ? (
          <SelectGroup>
            <SelectLabel>Agents</SelectLabel>
            {agents.map((agent) => (
              <SelectItem key={agent.id} value={agent.id} disabled={agent.disabled}><AgentChoice agent={agent} /></SelectItem>
            ))}
          </SelectGroup>
        ) : agents.map((agent) => (
          <SelectItem key={agent.id} value={agent.id} disabled={agent.disabled}><AgentChoice agent={agent} /></SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
