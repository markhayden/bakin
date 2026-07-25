import { afterEach, describe, expect, it } from 'bun:test'
import { getAgentBurnWindowScope } from '../../src/core/agent-burn'

const ORIGINAL_TZ = process.env.TZ

afterEach(() => {
  // Restore by ASSIGNMENT first: assigning process.env.TZ is what resets the
  // engine's cached timezone. A bare `delete` leaves the cache on this test's
  // Denver TZ, and later files in the same serial worker then render local
  // times in Denver (broke activity-tab in the rc.21 release build, which
  // runs the suite serially — parallel runs dodge it by worker partitioning).
  process.env.TZ = ORIGINAL_TZ ?? 'UTC'
  if (ORIGINAL_TZ === undefined) delete process.env.TZ
})

describe('getAgentBurnWindowScope', () => {
  it('preserves an exact 24-hour window across spring DST before day-aligning it', () => {
    process.env.TZ = 'America/Denver'

    const scope = getAgentBurnWindowScope(
      Date.parse('2026-03-09T00:30:00-06:00'),
      24,
    )

    expect(scope).toEqual({
      since: '2026-03-07',
      throughDay: '2026-03-09',
      scopeLabel: '2026-03-07 through 2026-03-09',
    })
  })
})
