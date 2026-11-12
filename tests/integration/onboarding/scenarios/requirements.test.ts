/**
 * Declared requirements (spec §4): a step that cannot run skips only the
 * steps that need it.
 */
import { afterEach, describe, expect, test } from 'bun:test'

import { seedOpenClaw, storeAdapter, type OpenClawFixture } from '../fixtures'
import { trackHomes } from '../harness'
import { describe as describeRun, onboard, outcomes, readMarker, TEST_TIMEOUT } from './kit'

const homes = trackHomes()
const gateways: OpenClawFixture[] = []

afterEach(async () => {
  for (const gateway of gateways.splice(0)) await gateway.stop()
  await homes.finish()
})

/** Steps that need nothing from the runtime. */
const INDEPENDENT = ['search', 'search-models', 'media', 'budget']
/** Steps that cannot run without one. */
const NEED_RUNTIME = [
  'llm', 'openclaw-integration', 'plugin-assets', 'agent-sync', 'models', 'channels',
  'recommended-plugins', 'recommended-agents', 'capabilities',
]

describe('runtime unreachable', () => {
  test('independent steps still run; only the steps that need the runtime are skipped, and they say so', async () => {
    const home = await homes.create()
    gateways.push(await seedOpenClaw(home, { gateway: 'down' }))
    storeAdapter(home, 'openclaw')

    const run = await onboard(home)
    const lines = outcomes(run)
    expect(lines.runtime?.status, describeRun(run)).toBe('error')
    for (const name of INDEPENDENT) {
      expect({ name, ran: lines[name]?.reason !== 'requires' && lines[name]?.status !== 'skipped' }).toEqual({ name, ran: true })
    }
    for (const name of NEED_RUNTIME) {
      expect({ name, status: lines[name]?.status, reason: lines[name]?.reason, requires: lines[name]?.requires })
        .toEqual({ name, status: 'skipped', reason: 'requires', requires: 'runtime' })
    }
    expect(run.exitCode).toBe(1)
    expect(readMarker(home)).toBeNull()
  }, TEST_TIMEOUT)
})
