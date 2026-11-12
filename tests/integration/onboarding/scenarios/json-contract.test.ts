/**
 * The `--json` contract (spec §1): one line per component, a final summary
 * line, typed skip reasons, and an exit code that follows from them.
 */
import { afterEach, describe, expect, test } from 'bun:test'

import { seedOpenClaw, seedPi, storeAdapter } from '../fixtures'
import { diffTrees, snapshotTree, startServer, trackHomes, type OnboardingHome } from '../harness'
import { componentOrder, describe as describeRun, onboard, outcomes, readMarker, summary, TEST_TIMEOUT } from './kit'

const homes = trackHomes()
afterEach(() => homes.finish())

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

describe('one line per component and a summary', () => {
  test('a step that does not apply to this runtime still gets a line, and does not affect the exit code', async () => {
    const home = await piHome()
    const run = await onboard(home)
    expect([...componentOrder(run)].sort(), describeRun(run)).toEqual([...ALL_COMPONENTS].sort())
    const integration = outcomes(run)['openclaw-integration']
    expect(integration?.status).toBe('skipped')
    expect(integration?.reason).toBe('not_applicable')
    // Lines come in component order, the summary after all of them.
    expect(run.jsonLines.findIndex((line) => 'summary' in line)).toBe(run.jsonLines.length - 1)
  }, TEST_TIMEOUT)

  test('the last line is a summary carrying the exit code, the marker and the runtime', async () => {
    const home = await piHome()
    const run = await onboard(home)
    const last = run.jsonLines.at(-1)
    expect(Object.keys(last ?? {}), describeRun(run)).toEqual(['summary'])
    expect(summary(run)).toMatchObject({
      exitCode: run.exitCode,
      markerWritten: readMarker(home) !== null,
      runtime: { adapter: 'pi', source: 'existing' },
    })
  }, TEST_TIMEOUT)
})

describe('skipped steps', () => {
  test('every skipped step says why in a typed reason', async () => {
    const home = await piHome()
    const run = await onboard(home)
    const skipped = Object.values(outcomes(run)).filter((line) => line.status === 'skipped')
    expect(skipped.length, describeRun(run)).toBeGreaterThan(0)
    const allowed = ['not_applicable', 'declined', 'requires', 'check_only', 'unavailable']
    for (const line of skipped) {
      expect({ component: line.component, typed: allowed.includes(String(line.reason)) }).toEqual({ component: line.component, typed: true })
    }
  }, TEST_TIMEOUT)
})

describe('a model plan with nothing to run', () => {
  test('is skipped as unavailable with a typed code; onboarding still completes', async () => {
    // Logged in, but the credential has no runnable model behind it.
    const home = await piHome()
    const run = await onboard(home)
    const models = outcomes(run).models
    expect(models?.status, describeRun(run)).toBe('skipped')
    expect(models?.reason).toBe('unavailable')
    expect(models?.code).toBe('no_runnable_model')
    expect(run.exitCode).toBe(2)
    expect(readMarker(home)).not.toBeNull()
  }, TEST_TIMEOUT)
})

describe('--yes --no-recommended', () => {
  // The first scenario that passes --yes: everything is approved except the
  // three extras that come from outside, so nothing is fetched.
  test('sets up Bakin itself, declines the three extras, and fetches nothing', async () => {
    const home = await piHome()
    const run = await onboard(home, ['--yes', '--no-recommended'])
    const lines = outcomes(run)
    for (const name of ['recommended-plugins', 'recommended-agents', 'capabilities']) {
      expect({ name, status: lines[name]?.status, reason: lines[name]?.reason }, describeRun(run)).toEqual({ name, status: 'skipped', reason: 'declined' })
    }
    expect(Object.values(lines).filter((line) => line.status === 'error')).toEqual([])
    expect(run.exitCode).toBe(2)
    expect(readMarker(home)).not.toBeNull()
    expect(home.deniedRequests()).toEqual([])
  }, TEST_TIMEOUT)

  test('a second run on the same home declines them again without looking', async () => {
    const home = await piHome()
    await onboard(home, ['--yes', '--no-recommended'])
    const replay = await onboard(home, ['--yes', '--no-recommended', '--force'])
    for (const name of ['recommended-plugins', 'recommended-agents', 'capabilities']) {
      expect(outcomes(replay)[name], describeRun(replay)).toMatchObject({ status: 'skipped', reason: 'declined' })
    }
    expect(home.deniedRequests()).toEqual([])
  }, TEST_TIMEOUT)

  test('on OpenClaw too', async () => {
    const home = await homes.create()
    const fixture = await seedOpenClaw(home)
    try {
      const run = await onboard(home, ['--yes', '--no-recommended'])
      expect(summary(run)?.runtime, describeRun(run)).toEqual({ adapter: 'openclaw', source: 'detected' })
      expect(Object.values(outcomes(run)).filter((line) => line.reason === 'declined').map((line) => line.component)).toEqual(['recommended-plugins', 'recommended-agents', 'capabilities'])
      expect(Object.values(outcomes(run)).filter((line) => line.status === 'error')).toEqual([])
      expect(home.deniedRequests()).toEqual([])
    } finally {
      await fixture.stop()
    }
  }, TEST_TIMEOUT)
})

describe('the setup checklist', () => {
  interface Item { id: string; state: string; detail: string; command?: string; href?: string }
  const checklist = (run: Awaited<ReturnType<typeof onboard>>) => summary(run)?.checklist as { items: Item[]; notes: Array<{ id: string; command?: string }> } | undefined

  test('a finished run reports what is left: a logged-in Pi home still has channels to turn on', async () => {
    const home = await piHome()
    const run = await onboard(home)
    const list = checklist(run)
    expect(list, describeRun(run)).toBeDefined()
    expect(list!.items.find((item) => item.id === 'login')?.state).toBe('done')
    expect(list!.items.find((item) => item.id === 'channels')).toMatchObject({ state: 'todo', href: '/settings?tab=channels' })
    // Nothing on this machine to set up for an external search endpoint.
    expect(list!.items.find((item) => item.id === 'search')).toBeUndefined()
    // Nothing can run on the fake credential, so there is no plan to choose yet.
    expect(list!.items.find((item) => item.id === 'model-plan')).toBeUndefined()
    expect(list!.notes.map((note) => note.id)).toEqual(['start', 'explore'])
  }, TEST_TIMEOUT)

  test('with no login the first thing left is logging in, in the runtime\'s own steps', async () => {
    const home = await homes.create()
    seedPi(home, { auth: false })
    const run = await onboard(home)
    const first = checklist(run)?.items[0]
    expect(first, describeRun(run)).toMatchObject({ id: 'login', state: 'todo' })
    expect(first?.detail).toContain('/login')
    expect(first?.detail).not.toMatch(/openclaw/i)
  }, TEST_TIMEOUT)

  test('--check reports the same list and still writes nothing', async () => {
    const home = await piHome()
    const real = await onboard(home)
    const before = snapshotTree(home.root)
    const checked = await onboard(home, ['--check'])
    expect(checklist(checked)?.items, describeRun(checked)).toEqual(checklist(real)!.items)
    const diff = diffTrees(before, snapshotTree(home.root))
    // Only the harness's own record directory may differ.
    expect({ ...diff, added: diff.added.filter((path) => !path.startsWith('harness-record')), changed: diff.changed.filter((path) => !path.startsWith('harness-record')) }).toEqual({ added: [], removed: [], changed: [] })
  }, TEST_TIMEOUT)

  test('a blocked run has no checklist: its blocker is the next step', async () => {
    const home = await homes.create()
    const fixture = await seedOpenClaw(home, { gateway: 'down' })
    try {
      const run = await onboard(home)
      expect(run.exitCode, describeRun(run)).toBe(1)
      expect(checklist(run)).toBeUndefined()
    } finally {
      await fixture.stop()
    }
  }, TEST_TIMEOUT)

  test('once the server runs for the home, starting it is no longer suggested', async () => {
    const home = await piHome()
    const server = await startServer(home)
    try {
      const run = await onboard(home)
      expect(checklist(run)?.notes.map((note) => note.id), describeRun(run)).toEqual(['explore'])
    } finally {
      await server.stop()
    }
  }, TEST_TIMEOUT)
})
