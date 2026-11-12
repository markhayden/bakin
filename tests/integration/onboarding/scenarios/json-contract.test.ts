/**
 * The `--json` contract (spec §1): one line per component, a final summary
 * line, typed skip reasons, and an exit code that follows from them.
 */
import { afterEach, describe, expect, test } from 'bun:test'

import { seedPi, storeAdapter } from '../fixtures'
import { expectedGap, trackHomes, type OnboardingHome } from '../harness'
import { componentOrder, describe as describeRun, onboard, outcomes, readMarker, summary, TEST_TIMEOUT } from './kit'

const homes = trackHomes()
afterEach(() => homes.finish())
const gap = (body: () => Promise<void>) => expectedGap(homes, body)

/** Every onboarding component. The CLI must print one line for each. */
const ALL_COMPONENTS = [
  'mkdir', 'settings', 'runtime', 'search', 'search-models', 'media', 'openclaw-integration',
  'plugin-assets', 'agent-sync', 'llm', 'models', 'budget', 'channels',
  'recommended-plugins', 'recommended-agents', 'capabilities',
]

async function piHome(): Promise<OnboardingHome> {
  const home = await homes.create()
  seedPi(home, { auth: true })
  storeAdapter(home, 'pi')
  return home
}

describe('without --yes, nothing recommended is approved', () => {
  // The premise every scenario before `--no-recommended` relies on: `--json`
  // alone is non-interactive and approves no recommended install, so no
  // scenario reaches for the network.
  test('the three recommended steps are skipped and nothing is installed', async () => {
    const home = await piHome()
    const run = await onboard(home)
    const lines = outcomes(run)
    for (const name of ['recommended-plugins', 'recommended-agents', 'capabilities']) {
      expect({ name, status: lines[name]?.status }, describeRun(run)).toEqual({ name, status: 'skipped' })
    }
    expect(home.deniedRequests()).toEqual([])
  }, TEST_TIMEOUT)
})

describe('one line per component and a summary (pinned: flipped by task 2.4)', () => {
  test('a step that does not apply to this runtime still gets a line, and does not affect the exit code', gap(async () => {
    const home = await piHome()
    const run = await onboard(home)
    expect([...componentOrder(run)].sort(), describeRun(run)).toEqual([...ALL_COMPONENTS].sort())
    const integration = outcomes(run)['openclaw-integration']
    expect(integration?.status).toBe('skipped')
    expect(integration?.reason).toBe('not_applicable')
  }), TEST_TIMEOUT)

  test('the last line is a summary carrying the exit code, the marker and the runtime', gap(async () => {
    const home = await piHome()
    const run = await onboard(home)
    const last = run.jsonLines.at(-1)
    expect(Object.keys(last ?? {}), describeRun(run)).toEqual(['summary'])
    expect(summary(run)).toMatchObject({
      exitCode: run.exitCode,
      markerWritten: readMarker(home) !== null,
      runtime: { adapter: 'pi', source: 'existing' },
    })
  }), TEST_TIMEOUT)

  test('every skipped step says why in a typed reason', gap(async () => {
    const home = await piHome()
    const run = await onboard(home)
    const skipped = Object.values(outcomes(run)).filter((line) => line.status === 'skipped')
    expect(skipped.length, describeRun(run)).toBeGreaterThan(0)
    const allowed = ['not_applicable', 'declined', 'requires', 'check_only', 'unavailable']
    for (const line of skipped) {
      expect({ component: line.component, typed: allowed.includes(String(line.reason)) }).toEqual({ component: line.component, typed: true })
    }
  }), TEST_TIMEOUT)
})

describe('a model plan with nothing to run (pinned: flipped by task 2.1)', () => {
  test('is skipped as unavailable with a typed code; onboarding still completes', gap(async () => {
    // Logged in, but the credential has no runnable model behind it.
    const home = await piHome()
    const run = await onboard(home)
    const models = outcomes(run).models
    expect(models?.status, describeRun(run)).toBe('skipped')
    expect(models?.reason).toBe('unavailable')
    expect(models?.code).toBe('no_runnable_model')
    expect(run.exitCode).toBe(2)
    expect(readMarker(home)).not.toBeNull()
  }), TEST_TIMEOUT)
})
