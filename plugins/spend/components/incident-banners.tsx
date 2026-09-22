'use client'

import { useState } from 'react'
import { Banner, Button, Field, FieldError, Input } from '@makinbakin/sdk/ui'

import { formatRuleUnit, parseCapInput } from './spend-utils'
import type { BudgetIncidentWire } from '../types'
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
}: {
  incident: BudgetIncidentWire
  resolveIncident: SpendData['resolveIncident']
}) {
  const [raiseValue, setRaiseValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const isCap = incident.kind === 'cap'

  return (
    <div className="flex min-w-0 flex-col gap-bakin-2">
      <Banner
        tone={isCap ? 'danger' : 'attention'}
        announce={incident.status === 'open' ? 'assertive' : 'off'}
        title={isCap ? 'Budget cap reached' : 'Budget warning'}
        description={(
          <span>
            {incident.scopeId ? `${incident.scope} “${incident.scopeId}”` : 'Global'} · {incident.window} · {incident.lane} at{' '}
            {formatRuleUnit(incident.lane, incident.spentValue, incident.unit === 'usd_micros')} of{' '}
            {formatRuleUnit(incident.lane, incident.capValue, incident.unit === 'usd_micros')}.
          </span>
        )}
        action={(
          <>
            {isCap ? (
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
            ) : null}
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
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={async () => setError(await resolveIncident(incident.id, 'resume'))}
            >
              {incident.atCap === 'pause' && isCap ? 'Resume as-is' : 'Dismiss'}
            </Button>
          </>
        )}
      />
      {isCap || error ? (
        <Field name={`budget-incident-${incident.id}-cap`} invalid={Boolean(error)}>
          {isCap ? (
            <Input
              aria-label={`New cap for incident ${incident.id}`}
              className="w-36"
              placeholder={incident.lane === 'metered' ? 'New dollar cap' : 'New token cap'}
              value={raiseValue}
              onChange={(event) => setRaiseValue(event.currentTarget.value)}
            />
          ) : null}
          {error ? <FieldError match>{error}</FieldError> : null}
        </Field>
      ) : null}
    </div>
  )
}

export function IncidentBanners({
  incidents,
  resolveIncident,
}: {
  incidents: BudgetIncidentWire[]
  resolveIncident: SpendData['resolveIncident']
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
        />
      ))}
    </div>
  )
}
