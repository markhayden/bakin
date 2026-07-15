import { afterEach, describe, expect, it } from 'bun:test'
import { getAgentBurnWindowScope } from '../../src/core/agent-burn'

const ORIGINAL_TZ = process.env.TZ

afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ
  else process.env.TZ = ORIGINAL_TZ
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
