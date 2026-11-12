/**
 * Runtime choice on first run (spec §2). Every scenario here pins a gap in
 * today's code and is flipped to a plain test by the task named in its
 * title; until then `expectedGap` requires the body to fail.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'fs'

import { seedOpenClaw, seedPi, storeAdapter, storedAdapter, type OpenClawFixture } from '../fixtures'
import { diffTrees, expectedGap, snapshotTree, trackHomes, type OnboardingHome, type TreeSnapshot } from '../harness'
import { describe as describeRun, onboard, outcomes, readMarker, summary, TEST_TIMEOUT } from './kit'

const homes = trackHomes()
const gateways: OpenClawFixture[] = []

afterEach(async () => {
  for (const gateway of gateways.splice(0)) await gateway.stop()
  await homes.finish()
})

const gap = (body: () => Promise<void>) => expectedGap(homes, async () => {
  try {
    await body()
  } finally {
    // The gateway stand-in lives in this process; stop it before the
    // harness removes the home it serves.
    for (const gateway of gateways.splice(0)) await gateway.stop()
  }
})

async function withOpenClaw(home: OnboardingHome, options: Parameters<typeof seedOpenClaw>[1] = {}): Promise<OpenClawFixture> {
  const fixture = await seedOpenClaw(home, options)
  gateways.push(fixture)
  return fixture
}

/** The three homes a run could write to, snapshotted separately. */
function snapshotHomes(home: OnboardingHome): Record<string, TreeSnapshot> {
  return { bakin: snapshotTree(home.bakinHome), pi: snapshotTree(home.piHome), openclaw: snapshotTree(home.openclawHome) }
}

function expectHomesUntouched(home: OnboardingHome, before: Record<string, TreeSnapshot>): void {
  const after = snapshotHomes(home)
  for (const name of Object.keys(before)) {
    expect({ home: name, diff: diffTrees(before[name]!, after[name]!) }).toEqual({ home: name, diff: { added: [], removed: [], changed: [] } })
  }
}

function expectRefusal(run: Awaited<ReturnType<typeof onboard>>, code: string): void {
  expect(run.exitCode, describeRun(run)).toBe(1)
  expect(summary(run)?.runtime?.refused).toBe(code)
  expect(summary(run)?.markerWritten).toBe(false)
  // A refusal prints the summary and nothing else.
  expect(outcomes(run)).toEqual({})
}

describe('a fresh home decides its runtime (pinned: flipped by task 3.7)', () => {
  test('nothing found: Pi by default, persisted, finishes with a credentials warning', gap(async () => {
    const home = await homes.create()
    const run = await onboard(home)
    expect(summary(run)?.runtime, describeRun(run)).toEqual({ adapter: 'pi', source: 'default' })
    expect(storedAdapter(home)).toBe('pi')
    const lines = outcomes(run)
    expect(lines.runtime?.status).toBe('ok')
    expect(lines.llm?.status).toBe('warn')
    expect(run.exitCode).toBe(2)
    expect(readMarker(home)).not.toBeNull()
  }), TEST_TIMEOUT)

  test('Pi found and logged in: detected and persisted', gap(async () => {
    const home = await homes.create()
    seedPi(home, { auth: true })
    const run = await onboard(home)
    expect(summary(run)?.runtime, describeRun(run)).toEqual({ adapter: 'pi', source: 'detected' })
    expect(storedAdapter(home)).toBe('pi')
    expect(outcomes(run).llm?.status).toBe('ok')
    expect(readMarker(home)).not.toBeNull()
  }), TEST_TIMEOUT)

  test('Pi found but logged out: detected, runtime ok, credentials warn', gap(async () => {
    const home = await homes.create()
    seedPi(home, { auth: false })
    const run = await onboard(home)
    expect(summary(run)?.runtime, describeRun(run)).toEqual({ adapter: 'pi', source: 'detected' })
    expect(outcomes(run).runtime?.status).toBe('ok')
    expect(outcomes(run).llm?.status).toBe('warn')
    expect(readMarker(home)).not.toBeNull()
  }), TEST_TIMEOUT)

  test('OpenClaw found with its gateway up: detected and persisted', gap(async () => {
    const home = await homes.create()
    await withOpenClaw(home)
    const run = await onboard(home)
    expect(summary(run)?.runtime, describeRun(run)).toEqual({ adapter: 'openclaw', source: 'detected' })
    expect(storedAdapter(home)).toBe('openclaw')
    expect(outcomes(run).runtime?.status).toBe('ok')
    expect(readMarker(home)).not.toBeNull()
  }), TEST_TIMEOUT)

  test('both found, non-interactive: refuses as ambiguous and writes nothing', gap(async () => {
    const home = await homes.create()
    seedPi(home, { auth: true })
    await withOpenClaw(home)
    const before = snapshotHomes(home)
    const run = await onboard(home)
    expectRefusal(run, 'ambiguous_runtime')
    expect(summary(run)?.runtime?.found).toEqual(['openclaw', 'pi'])
    expectHomesUntouched(home, before)
  }), TEST_TIMEOUT)

  test('both found, --runtime pi: the flag decides', gap(async () => {
    const home = await homes.create()
    seedPi(home, { auth: true })
    await withOpenClaw(home)
    const run = await onboard(home, ['--runtime', 'pi'])
    expect(summary(run)?.runtime, describeRun(run)).toEqual({ adapter: 'pi', source: 'flag' })
    expect(storedAdapter(home)).toBe('pi')
    expect(readMarker(home)).not.toBeNull()
  }), TEST_TIMEOUT)
})

describe('an invalid or conflicting choice is refused before any write (pinned: flipped by task 3.7)', () => {
  test('--runtime with an unsupported value', gap(async () => {
    const home = await homes.create()
    seedPi(home, { auth: true })
    const before = snapshotHomes(home)
    const run = await onboard(home, ['--runtime', 'bogus'])
    expectRefusal(run, 'invalid_runtime')
    expectHomesUntouched(home, before)
  }), TEST_TIMEOUT)

  test('BAKIN_RUNTIME_ADAPTER with an unsupported value', gap(async () => {
    const home = await homes.create()
    seedPi(home, { auth: true })
    const before = snapshotHomes(home)
    const run = await onboard(home, [], { env: { BAKIN_RUNTIME_ADAPTER: 'bogus' } })
    expectRefusal(run, 'invalid_runtime')
    expectHomesUntouched(home, before)
  }), TEST_TIMEOUT)

  test('a stored adapter and a different --runtime, on a fresh home', gap(async () => {
    const home = await homes.create()
    seedPi(home, { auth: true })
    storeAdapter(home, 'pi')
    const before = snapshotHomes(home)
    const run = await onboard(home, ['--runtime', 'openclaw'])
    expectRefusal(run, 'runtime_already_set')
    expectHomesUntouched(home, before)
    expect(storedAdapter(home)).toBe('pi')
  }), TEST_TIMEOUT)

  test('a stored adapter and a different --runtime, on an onboarded home', gap(async () => {
    const home = await homes.create()
    seedPi(home, { auth: true })
    storeAdapter(home, 'pi')
    await onboard(home)
    expect(readMarker(home)).not.toBeNull()
    const before = snapshotHomes(home)
    // The conflict is checked before the already-onboarded shortcut.
    const run = await onboard(home, ['--runtime', 'openclaw'])
    expectRefusal(run, 'runtime_already_set')
    expectHomesUntouched(home, before)
  }), TEST_TIMEOUT)

  test('two undecided runs at once with different --runtime: one wins, one is refused', gap(async () => {
    const home = await homes.create()
    seedPi(home, { auth: true })
    await withOpenClaw(home)
    const [asPi, asOpenClaw] = await Promise.all([
      onboard(home, ['--runtime', 'pi']),
      onboard(home, ['--runtime', 'openclaw']),
    ])
    const refused = [asPi, asOpenClaw].filter((run) => summary(run)?.runtime?.refused === 'runtime_already_set')
    const won = [asPi, asOpenClaw].filter((run) => summary(run)?.runtime?.source === 'flag')
    expect(refused.length, `${describeRun(asPi)}\n${describeRun(asOpenClaw)}`).toBe(1)
    expect(won.length).toBe(1)
    expect(storedAdapter(home)).toBe(won[0] === asPi ? 'pi' : 'openclaw')
  }), TEST_TIMEOUT)
})

describe('a settings file that says nothing (pinned: flipped by task 3.7)', () => {
  // These homes have no settings scaffold, so the product runs on its real
  // default endpoints; the harness denies those without calling it a breach.
  test.each([
    ['absent', null],
    ['an empty object', '{}'],
    ['zero bytes', ''],
  ])('settings %s: undecided, so the choice is made and persisted', (_label, content) => gap(async () => {
    const home = await homes.create({ bakinHome: content === null ? 'absent' : 'scaffold' })
    home.blackholeProductDefaults()
    if (content !== null) writeFileSync(home.settingsPath, content)
    seedPi(home, { auth: true })
    const run = await onboard(home)
    expect(summary(run)?.runtime, describeRun(run)).toEqual({ adapter: 'pi', source: 'detected' })
    expect(storedAdapter(home)).toBe('pi')
    expect(readMarker(home)).not.toBeNull()
  })(), TEST_TIMEOUT)
})

describe('a settings file that cannot be trusted', () => {
  // No usable settings, so the product runs on its default endpoints; the
  // harness denies those without calling it a breach.
  test.each([
    ['not JSON', '{ "runtime": '],
    ['an unsupported stored adapter', JSON.stringify({ runtime: { adapter: 'bogus' } })],
  ])('settings %s: stops with an error and leaves the file alone', async (_label, content) => {
    const home = await homes.create()
    home.blackholeProductDefaults()
    writeFileSync(home.settingsPath, content)
    seedPi(home, { auth: true })
    const piBefore = snapshotTree(home.piHome)
    const run = await onboard(home)
    expect(run.exitCode, describeRun(run)).toBe(1)
    expect(outcomes(run).settings?.status).toBe('error')
    expect(readFileSync(home.settingsPath, 'utf-8')).toBe(content)
    expect(readMarker(home)).toBeNull()
    // Nothing was decided or provisioned on top of a file nobody can trust.
    expect(diffTrees(piBefore, snapshotTree(home.piHome))).toEqual({ added: [], removed: [], changed: [] })
    expect(summary(run)?.markerWritten).toBe(false)
  }, TEST_TIMEOUT)
})
