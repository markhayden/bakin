import { describe, expect, it } from 'bun:test'
import { canonicalHealthObservationSchema } from '../../../plugins/health/lib/route-schemas'

const observedAt = '2026-07-13T20:00:00.000Z'
const observationBase = {
  id: 'health.search:engine.availability',
  key: 'engine.availability',
  summary: 'Search engine is unavailable.',
  checkId: 'health.search',
  checkName: 'Search',
  owner: { kind: 'plugin' as const, id: 'health', label: 'Health' },
  group: { key: 'search', label: 'Search' },
  checkedAt: observedAt,
  observedAt,
  staleAt: '2026-07-13T20:01:00.000Z',
  snapshot: 'current' as const,
  incidentId: 'health:search:unavailable',
}

const incidentBase = {
  key: 'search.unavailable',
  title: 'Search is unavailable',
  impact: 'Search-backed discovery is unavailable.',
  resolution: { key: 'restart-search', type: 'rerun' as const, label: 'Rerun Search checks' },
}

describe('canonical Health HTTP observation schema', () => {
  it('rejects an Error observation with a non-actionable incident', () => {
    const result = canonicalHealthObservationSchema.safeParse({
      ...observationBase,
      status: 'error',
      incident: { ...incidentBase, disposition: 'watch' },
    })

    expect(result.success).toBe(false)
  })

  it('rejects an Unknown observation with an actionable incident', () => {
    const result = canonicalHealthObservationSchema.safeParse({
      ...observationBase,
      status: 'unknown',
      incident: { ...incidentBase, disposition: 'action_required' },
    })

    expect(result.success).toBe(false)
  })
})
