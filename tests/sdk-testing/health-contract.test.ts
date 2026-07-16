/**
 * Compile-time and runtime pins for the canonical public Health contract.
 *
 * The `@ts-expect-error` cases are enforced by `bun run typecheck`; the
 * runtime assertions keep the helper and SDK testing surfaces honest.
 */
import { afterEach, describe, expect, it } from 'bun:test'
import type {
  ActionIncidentInput,
  HealthCheckRegistrationInput,
  HealthObservationInput,
  HealthRepairActionDefinition,
  WatchIncidentInput,
} from '@makinbakin/sdk/types'
import {
  healthError,
  healthHealthy,
  healthNotApplicable,
  healthObserved,
  healthUnknown,
  healthWarning,
} from '@makinbakin/sdk/utils'
import { createTestContext, type PluginTestContext } from '@makinbakin/sdk/testing'

const watchIncident: WatchIncidentInput = {
  key: 'readiness',
  title: 'Search is degraded',
  impact: 'Results may be incomplete.',
  disposition: 'watch',
  resources: [{ kind: 'service', id: 'search', label: 'Search' }],
  resolution: {
    key: 'review-search',
    type: 'navigate',
    label: 'Review Search',
    href: '/health?tab=system&section=search',
  },
}

const actionIncident: ActionIncidentInput = {
  key: 'availability',
  title: 'Search is unavailable',
  impact: 'Search requests cannot complete.',
  disposition: 'action_required',
  resolution: {
    key: 'restart-search',
    type: 'repair',
    label: 'Review restart',
    actionId: 'restart-search',
  },
}

describe('canonical Health helper constructors', () => {
  it('builds a non-empty observed run without hiding semantic fields', () => {
    const run = healthObserved([
      healthHealthy({ key: 'ping', summary: 'Search answered.' }),
      healthWarning({
        key: 'canary.partial',
        summary: 'Some sources missed the query budget.',
        incident: watchIncident,
        evidence: { omittedTables: ['memory'] },
      }),
      healthError({
        key: 'canary.dark',
        summary: 'The production-path canary failed.',
        incident: actionIncident,
      }),
      healthUnknown({
        key: 'journal.unverified',
        summary: 'Journal state could not be verified.',
        incident: watchIncident,
      }),
    ])

    expect(run.outcome).toBe('observed')
    expect(run.observations.map((observation) => observation.status)).toEqual([
      'healthy',
      'warning',
      'error',
      'unknown',
    ])
    expect(run.observations[1].incident?.resolution.key).toBe('review-search')
  })

  it('builds an explicit not-applicable result', () => {
    expect(healthNotApplicable('Search is disabled by configuration.')).toEqual({
      outcome: 'not_applicable',
      reason: 'Search is disabled by configuration.',
    })
  })
})

describe('@makinbakin/sdk/testing Health capture', () => {
  let harness: PluginTestContext | undefined

  afterEach(() => harness?.dispose())

  it('captures checks and repair actions separately with owner-local ids', () => {
    harness = createTestContext('search-tools')

    const check: HealthCheckRegistrationInput = {
      id: 'readiness',
      name: 'Search readiness',
      description: 'Checks the production Search path.',
      group: { key: 'search', label: 'Search' },
      run: async () => healthObserved([
        healthHealthy({ key: 'available', summary: 'Search is ready.' }),
      ]),
    }
    const action: HealthRepairActionDefinition = {
      id: 'restart-search',
      name: 'Restart Search',
      plan: async () => [],
      apply: async () => [],
    }

    expect(harness.ctx.registerHealthCheck(check)).toBe('search-tools.readiness')
    expect(harness.ctx.registerHealthRepairAction(action)).toBe('search-tools.restart-search')
    expect(harness.healthChecks).toEqual([check])
    expect(harness.healthRepairActions).toEqual([action])
  })
})

// Compile-time invalid-state pins. This function is never called.
function assertInvalidStatesStayUnrepresentable(): void {
  // @ts-expect-error — a healthy observation cannot carry an incident
  const healthyWithIncident: HealthObservationInput = {
    key: 'bad.healthy',
    status: 'healthy',
    summary: 'Invalid',
    incident: watchIncident,
  }

  // @ts-expect-error — an error requires an action-required incident
  const errorWithoutAction: HealthObservationInput = {
    key: 'bad.error',
    status: 'error',
    summary: 'Invalid',
    incident: watchIncident,
  }

  // @ts-expect-error — Unknown is verification state and requires watch
  const unknownAsAction: HealthObservationInput = {
    key: 'bad.unknown',
    status: 'unknown',
    summary: 'Invalid',
    incident: actionIncident,
  }

  // @ts-expect-error — observed runs must contain at least one observation
  healthObserved([])

  void healthyWithIncident
  void errorWithoutAction
  void unknownAsAction
}

void assertInvalidStatesStayUnrepresentable
