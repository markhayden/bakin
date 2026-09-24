'use client'

import { useState } from 'react'
import { Banner, Button, Field, FieldError, Input } from '@makinbakin/sdk/ui'

import { budgetRuleLabel, budgetRuleSpend, formatRuleUnit, parseCapInput } from './spend-utils'
import type { BudgetIncidentWire, BudgetRuleWire, SpendResponse } from '../types'
import type { SpendData } from './use-spend-data'

/** One OTHER limit that is holding matching work right now, in the words the Limits tab uses. */
export interface OtherHold {
  label: string
  window: 'daily' | 'monthly'
  spent: string
  cap: string
}

function ruleIdentity(rule: BudgetRuleWire): string {
  return `${rule.scope}|${rule.scopeId ?? ''}|${rule.lane}`
}
function incidentIdentity(incident: Pick<BudgetIncidentWire, 'scope' | 'scopeId' | 'lane'>): string {
  return `${incident.scope}|${incident.scopeId}|${incident.lane}`
}

/**
 * The OTHER limits that hold matching work while this incident is live —
 * every rule but this incident's whose window is at/over its cap on current
 * spend, or whose pause hold is still live (a pause incident holds until
 * resolved whatever spend does). Resolving THIS incident releases none of
 * them, so the banner says so before the operator acts, and the resolved
 * notice says so after.
 */
export function otherHolds(
  incident: Pick<BudgetIncidentWire, 'scope' | 'scopeId' | 'lane'>,
  rules: BudgetRuleWire[] | null,
  facets: SpendResponse['facets'] | undefined,
  incidents: BudgetIncidentWire[],
): OtherHold[] {
  const self = incidentIdentity(incident)
  const holds: OtherHold[] = []
  for (const rule of rules ?? []) {
    if (ruleIdentity(rule) === self) continue
    for (const window of ['daily', 'monthly'] as const) {
      const cap = window === 'daily' ? rule.dailyCap : rule.monthlyCap
      if (cap === undefined) continue
      const capInUnit = rule.lane === 'metered' ? Math.round(cap * 1_000_000) : Math.round(cap)
      const spend = facets?.[window] ? budgetRuleSpend(rule, facets[window]) : null
      const pausedHold = rule.atCap === 'pause' && incidents.some((other) =>
        other.status !== 'resolved' && other.window === window && incidentIdentity(other) === ruleIdentity(rule))
      if ((spend !== null && spend >= capInUnit) || pausedHold) {
        holds.push({
          label: budgetRuleLabel(rule),
          window,
          spent: formatRuleUnit(rule.lane, spend ?? capInUnit, rule.lane === 'metered'),
          cap: formatRuleUnit(rule.lane, capInUnit, rule.lane === 'metered'),
        })
      }
    }
  }
  return holds
}

function describeHolds(holds: OtherHold[]): string {
  return holds.map((hold) => `${hold.label} · ${hold.window} (${hold.spent} of ${hold.cap})`).join('; ')
}

/** What the operator sees right after an incident resolves: whether matching work actually runs now. */
export function resolvedNotice(action: 'raise' | 'ack' | 'resume', holds: OtherHold[], paused: boolean): { tone: 'success' | 'attention'; title: string; description: string } {
  const verb = action === 'raise' ? 'Limit raised' : action === 'resume' ? 'Resumed' : 'Acknowledged'
  if (holds.length === 0 && !paused) {
    return { tone: 'success', title: `${verb} — matching work runs again`, description: 'No other limit is holding it.' }
  }
  const parts: string[] = []
  if (paused) parts.push('all dispatch is paused (the kill switch is on)')
  if (holds.length > 0) parts.push(`these limits are still at their cap: ${describeHolds(holds)}`)
  return {
    tone: 'attention',
    title: `${verb} — matching work is still held`,
    description: `${parts.join(', and ')[0]!.toUpperCase()}${parts.join(', and ').slice(1)}. Resolve those too before it runs.`,
  }
}

/**
 * One incident: the Banner's action slot stays a button row (its contract),
 * while the cap input and its rejection message live below the banner inside a
 * Field. A rejected raise is announced — FieldError carries `role="alert"`, so
 * the message reaches assistive tech instead of only being painted red.
 */
function IncidentBanner({
  incident,
  resolveIncident,
  stillOver,
  holds,
  paused,
  onResolved,
}: {
  incident: BudgetIncidentWire
  resolveIncident: SpendData['resolveIncident']
  /** Current spend is still at/over this cap — resuming would just re-breach (S12), so only a raise is offered. */
  stillOver: boolean
  /** The OTHER limits holding matching work right now. */
  holds: OtherHold[]
  /** The kill switch is on — nothing runs whatever this incident does. */
  paused: boolean
  onResolved: (action: 'raise' | 'ack' | 'resume') => void
}) {
  const [raiseValue, setRaiseValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const resolve = async (action: 'raise' | 'ack' | 'resume', cap?: number) => {
    const refusal = await resolveIncident(incident.id, action, cap)
    setError(refusal)
    if (refusal === null) onResolved(action)
  }

  return (
    <div className="flex min-w-0 flex-col gap-bakin-2">
      <Banner
        tone="danger"
        announce={incident.status === 'open' ? 'assertive' : 'off'}
        title="Budget cap reached"
        description={(
          <span>
            {incident.scopeId ? `${incident.scope} “${incident.scopeId}”` : 'Global'} · {incident.window} · {incident.lane} at{' '}
            {formatRuleUnit(incident.lane, incident.spentValue, incident.unit === 'usd_micros')} of{' '}
            {formatRuleUnit(incident.lane, incident.capValue, incident.unit === 'usd_micros')}
            {incident.atCap === 'pause' ? ' — matching work is paused until you act.' : ' — matching work waits for the next period.'}
            {stillOver && incident.atCap === 'pause' ? ' Still over the limit: raise it to resume.' : ''}
            {holds.length > 0 ? (
              <span data-testid={`incident-${incident.id}-other-holds`}>
                {' '}Also at their cap: {describeHolds(holds)} — resolving this one does not release the work they hold.
              </span>
            ) : null}
            {paused ? ' All dispatch is paused, too.' : ''}
          </span>
        )}
        action={(
          <>
            <Button
              type="button"
              size="sm"
              onClick={async () => {
                const cap = parseCapInput(raiseValue)
                if (cap === undefined) {
                  setError('Enter a valid cap first. Token caps accept k or M suffixes.')
                  return
                }
                await resolve('raise', cap)
              }}
            >
              Raise and resume
            </Button>
            {incident.status === 'open' ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => resolve('ack')}
              >
                Acknowledge
              </Button>
            ) : null}
            {/* Resume is only honest while spend is under the cap; a "wait"
                rule releases itself at rollover, so it has nothing to resume. */}
            {incident.atCap === 'pause' && !stillOver ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => resolve('resume')}
              >
                Resume as-is
              </Button>
            ) : null}
          </>
        )}
      />
      <Field name={`budget-incident-${incident.id}-cap`} invalid={Boolean(error)}>
        <Input
          aria-label={`New cap for incident ${incident.id}`}
          className="w-36"
          placeholder={incident.lane === 'metered' ? 'New dollar cap' : 'New token cap'}
          value={raiseValue}
          onChange={(event) => setRaiseValue(event.currentTarget.value)}
        />
        {error ? <FieldError match>{error}</FieldError> : null}
      </Field>
    </div>
  )
}

/** Whether an incident's rule is still at/over its cap on CURRENT spend (the page's facets); the recorded values decide when facets are absent. */
export function incidentStillOver(incident: BudgetIncidentWire, rules: BudgetRuleWire[] | null, facets: SpendResponse['facets'] | undefined): boolean {
  const rule = rules?.find((r) => r.scope === incident.scope && (r.scopeId ?? '') === incident.scopeId && r.lane === incident.lane)
  const window = facets?.[incident.window]
  if (!rule || !window) return incident.spentValue >= incident.capValue
  const cap = incident.window === 'daily' ? rule.dailyCap : rule.monthlyCap
  if (cap === undefined) return false
  const capInUnit = rule.lane === 'metered' ? Math.round(cap * 1_000_000) : Math.round(cap)
  return budgetRuleSpend(rule, window) >= capInUnit
}

export function IncidentBanners({
  incidents,
  resolveIncident,
  rules,
  facets,
  paused = false,
}: {
  incidents: BudgetIncidentWire[]
  resolveIncident: SpendData['resolveIncident']
  rules: BudgetRuleWire[] | null
  facets: SpendResponse['facets'] | undefined
  /** The kill switch — a resolved incident releases nothing while it is on. */
  paused?: boolean
}) {
  // The last resolution's verdict stays until dismissed: the incident it
  // answers is gone from the list, so nothing else would explain why work
  // is (or is not) running now.
  const [notice, setNotice] = useState<ReturnType<typeof resolvedNotice> | null>(null)
  const live = incidents.filter((incident) => incident.status !== 'resolved')
  if (live.length === 0 && !notice) return null

  return (
    <div className="flex min-w-0 flex-col gap-bakin-3">
      {notice ? (
        <Banner
          tone={notice.tone}
          announce="polite"
          title={notice.title}
          description={notice.description}
          data-testid="incident-resolved-notice"
          action={<Button type="button" variant="outline" size="sm" onClick={() => setNotice(null)}>Dismiss</Button>}
        />
      ) : null}
      {live.map((incident) => {
        const holds = otherHolds(incident, rules, facets, incidents)
        return (
          <IncidentBanner
            key={incident.id}
            incident={incident}
            resolveIncident={resolveIncident}
            stillOver={incidentStillOver(incident, rules, facets)}
            holds={holds}
            paused={paused}
            // Judged on the state the click saw: resolving THIS incident changes none of the others.
            onResolved={(action) => setNotice(resolvedNotice(action, holds, paused))}
          />
        )
      })}
    </div>
  )
}
