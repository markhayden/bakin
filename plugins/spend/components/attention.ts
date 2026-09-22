/**
 * The ladder's attention rules — pure, so the badge provider, the header
 * bars and the tests share ONE reading of a milestone (spec §6 ladder:
 * 50/75 = toast + OS notification, 90 = yellow bar until dismissed,
 * 100 = red bar with actions = the cap incident).
 */
import type { NavBadge } from '@makinbakin/sdk/types'

export interface MilestoneEventPayload {
  eventId: string
  milestoneId: number
  ruleId: string
  scope: string
  scopeId?: string
  lane: 'metered' | 'subscription'
  window: 'daily' | 'monthly'
  unit: 'usd_micros' | 'tokens'
  highest: number
  count: number
  spentValue: number
  capValue: number
}

export interface LiveMilestoneRow {
  id: number
  ruleId: string
  window: 'daily' | 'monthly'
  milestone: number
  spentValue: number
  capValue: number
  unit: 'usd_micros' | 'tokens'
  acknowledgedAt: number | null
}

export interface OpenIncidentRow {
  id: number
  eventId: string
  episode: number
  scope: string
  scopeId: string
  lane: 'metered' | 'subscription'
  window: 'daily' | 'monthly'
  unit: 'usd_micros' | 'tokens'
  capValue: number
  spentValue: number
  atCap: 'defer' | 'pause'
  status: 'open' | 'acknowledged' | 'resolved'
}

export function formatValue(unit: 'usd_micros' | 'tokens', value: number): string {
  if (unit === 'usd_micros') return `$${(value / 1_000_000).toFixed(2)}`
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M tokens`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k tokens`
  return `${value} tokens`
}

export function scopeLabel(scope: string, scopeId?: string | null): string {
  return scopeId ? `${scope} “${scopeId}”` : 'Global'
}

/** 50 and 75 are a heads-up (toast + OS); 90 and above are bars — no toast. */
export function milestoneNotifies(highest: number): boolean {
  return highest < 90
}

export function milestoneToast(payload: MilestoneEventPayload): { title: string; body: string; url: string } {
  return {
    title: `${payload.highest}% of your ${payload.window} limit`,
    body: `${scopeLabel(payload.scope, payload.scopeId)} · ${formatValue(payload.unit, payload.spentValue)} of ${formatValue(payload.unit, payload.capValue)} ${payload.lane}.`,
    url: '/spend',
  }
}

/** The yellow bars: unacknowledged 90% rows of the current windows. */
export function warningBars(rows: LiveMilestoneRow[]): LiveMilestoneRow[] {
  return rows.filter((row) => row.milestone === 90 && row.acknowledgedAt === null)
}

/** The red bars: open cap incidents (acknowledged ones are quiet). */
export function capBars(incidents: OpenIncidentRow[]): OpenIncidentRow[] {
  return incidents.filter((incident) => incident.status === 'open')
}

/** Nav badge: bars needing attention; error tone once a cap is hit. */
export function spendBadge(rows: LiveMilestoneRow[], incidents: OpenIncidentRow[]): NavBadge | null {
  const caps = capBars(incidents).length
  const warnings = warningBars(rows).length
  if (caps > 0) return { count: caps + warnings, tone: 'error' }
  if (warnings > 0) return { count: warnings, tone: 'attention' }
  return null
}
