'use client'

import { useState } from 'react'
import { Banner, Button, Field, FieldError, Input } from '@makinbakin/sdk/ui'

import { budgetRuleSpend, formatRuleUnit, parseCapInput } from './spend-utils'
import type { BudgetIncidentWire, BudgetRuleWire, SpendResponse } from '../types'
import type { SpendData } from './use-spend-data'

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
}: {
  incident: BudgetIncidentWire
  resolveIncident: SpendData['resolveIncident']
  /** Current spend is still at/over this cap — resuming would just re-breach (S12), so only a raise is offered. */
  stillOver: boolean
}) {
  const [raiseValue, setRaiseValue] = useState('')
  const [error, setError] = useState<string | null>(null)

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
                setError(await resolveIncident(incident.id, 'raise', cap))
              }}
            >
              Raise and resume
            </Button>
            {incident.status === 'open' ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={async () => setError(await resolveIncident(incident.id, 'ack'))}
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
                onClick={async () => setError(await resolveIncident(incident.id, 'resume'))}
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
}: {
  incidents: BudgetIncidentWire[]
  resolveIncident: SpendData['resolveIncident']
  rules: BudgetRuleWire[] | null
  facets: SpendResponse['facets'] | undefined
}) {
  const live = incidents.filter((incident) => incident.status !== 'resolved')
  if (live.length === 0) return null

  return (
    <div className="flex min-w-0 flex-col gap-bakin-3">
      {live.map((incident) => (
        <IncidentBanner
          key={incident.id}
          incident={incident}
          resolveIncident={resolveIncident}
          stillOver={incidentStillOver(incident, rules, facets)}
        />
      ))}
    </div>
  )
}
