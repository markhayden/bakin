/**
 * `bakin onboard --check` performs no writes (spec §6). Snapshots cover
 * every home a run can resolve: the Bakin home, the Pi home, the OpenClaw
 * home and HOME, excluding logs/.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, rmSync } from 'fs'
import { join } from 'path'

import { seedOpenClaw, seedPi, storeAdapter, type OpenClawFixture } from '../fixtures'
import { diffTrees, runBakin, snapshotTree, trackHomes, type OnboardingHome, type TreeSnapshot } from '../harness'
import { CHILD_TIMEOUT, describe as describeRun, onboard, outcomes, readMarker, TEST_TIMEOUT } from './kit'

const homes = trackHomes()
const gateways: OpenClawFixture[] = []

afterEach(async () => {
  for (const gateway of gateways.splice(0)) await gateway.stop()
  await homes.finish()
})

const WATCHED = ['bakinHome', 'piHome', 'openclawHome', 'userHome'] as const

/** A check writes NOTHING, log lines included: `logs/` is part of the snapshot here. */
function snapshotAll(home: OnboardingHome): Record<string, TreeSnapshot> {
  return Object.fromEntries(WATCHED.map((key) => [key, snapshotTree(home[key], { includeLogs: true })]))
}

async function expectCheckWritesNothing(home: OnboardingHome): Promise<void> {
  const before = snapshotAll(home)
  const run = await onboard(home, ['--check'])
  expect(run.timedOut, describeRun(run)).toBe(false)
  expect(Object.keys(outcomes(run)).length).toBeGreaterThan(0)
  const after = snapshotAll(home)
  for (const key of WATCHED) {
    expect({ home: key, diff: diffTrees(before[key]!, after[key]!) }).toEqual({ home: key, diff: { added: [], removed: [], changed: [] } })
  }
}

async function piHome(): Promise<OnboardingHome> {
  const home = await homes.create()
  seedPi(home, { auth: true })
  storeAdapter(home, 'pi')
  return home
}

describe('--check writes nothing', () => {
  test('on a fresh home with nothing set up', async () => {
    // Nothing stored and nothing seeded: Pi is the default for this run,
    // and not even an empty login file is created for it.
    const home = await homes.create()
    await expectCheckWritesNothing(home)
  }, TEST_TIMEOUT)

  test('on a fresh Pi home', async () => {
    await expectCheckWritesNothing(await piHome())
  }, TEST_TIMEOUT)

  test('on a fresh OpenClaw home', async () => {
    const home = await homes.create()
    gateways.push(await seedOpenClaw(home))
    storeAdapter(home, 'openclaw')
    await expectCheckWritesNothing(home)
  }, TEST_TIMEOUT)

  test('on an onboarded home with its usage and ledger stores', async () => {
    const home = await piHome()
    await onboard(home)
    expect(readMarker(home)).not.toBeNull()
    expect(existsSync(join(home.bakinHome, 'usage.db'))).toBe(true)
    await expectCheckWritesNothing(home)
  }, TEST_TIMEOUT)

  test('on an onboarded home with no usage or ledger store', async () => {
    const home = await piHome()
    await onboard(home)
    for (const name of ['usage.db', 'usage.db-shm', 'usage.db-wal', 'bakin.db', 'bakin.db-shm', 'bakin.db-wal']) {
      rmSync(join(home.bakinHome, name), { force: true })
    }
    await expectCheckWritesNothing(home)
  }, TEST_TIMEOUT)

  test('on a home whose settings still hold a legacy search password', async () => {
    const home = await piHome()
    const settings = home.readSettings()
    const search = settings.search as { settings: Record<string, unknown> }
    // Normal composition moves this into the secret store and rewrites
    // settings.json; a check must leave both alone.
    home.writeSettings({ ...settings, search: { ...search, settings: { ...search.settings, auth: { username: 'legacy', password: 'not-a-real-password' } } } })
    await expectCheckWritesNothing(home)
  }, TEST_TIMEOUT)

  test('never writes, clears or replaces the marker', async () => {
    const fresh = await piHome()
    await onboard(fresh, ['--check'])
    expect(readMarker(fresh)).toBeNull()

    const onboarded = await piHome()
    await onboard(onboarded)
    const marker = readMarker(onboarded)
    await onboard(onboarded, ['--check'])
    expect(readMarker(onboarded)).toEqual(marker)
  }, TEST_TIMEOUT)
})

describe('--check on a machine with no Bakin home', () => {
  // Found on a real machine: the file log lives in the home, so the first
  // log line of a check created ~/.bakin/logs/server.log.
  test.each([
    [['onboard', '--check', '--json']],
    [['check', 'all', '--json']],
    [['check', 'runtime', '--json']],
  ])('bakin %p does not create the home, not even for a log file', async (args) => {
    const home = await homes.create({ bakinHome: 'absent' })
    home.blackholeProductDefaults()
    seedPi(home, { auth: true })
    expect(existsSync(home.bakinHome)).toBe(false)
    const run = await runBakin(home, args, { timeoutMs: CHILD_TIMEOUT })
    expect(run.timedOut, describeRun(run)).toBe(false)
    expect(existsSync(home.bakinHome)).toBe(false)
  }, TEST_TIMEOUT)

  test('teeth: a real run on the same machine does create the home', async () => {
    const home = await homes.create({ bakinHome: 'absent' })
    home.blackholeProductDefaults()
    seedPi(home, { auth: true })
    await onboard(home)
    expect(existsSync(home.bakinHome)).toBe(true)
  }, TEST_TIMEOUT)
})

describe('--check still tells the truth', () => {
  // Read-only is not the same as blind: the checks must reach the same
  // verdicts a real run does, from what is already on disk.
  test('an onboarded Pi home checks without errors and sees its runtime and login', async () => {
    const home = await piHome()
    await onboard(home)
    const run = await onboard(home, ['--check'])
    const lines = outcomes(run)
    expect(Object.values(lines).filter((line) => line.status === 'error'), describeRun(run)).toEqual([])
    expect(lines.runtime?.status).toBe('ok')
    expect(lines.llm?.status).toBe('ok')
    expect(lines.mkdir?.status).toBe('ok')
  }, TEST_TIMEOUT)

  test('OpenClaw tool access: not provisioned reads as work to do, provisioned reads as ok, and the secret is never created by a check', async () => {
    const home = await homes.create()
    gateways.push(await seedOpenClaw(home))
    storeAdapter(home, 'openclaw')

    const fresh = await onboard(home, ['--check'])
    expect(outcomes(fresh)['openclaw-integration'], describeRun(fresh)).toMatchObject({ status: 'skipped', reason: 'check_only' })
    expect(existsSync(join(home.bakinHome, 'mcp-secret'))).toBe(false)

    await onboard(home)
    expect(existsSync(join(home.bakinHome, 'mcp-secret'))).toBe(true)
    const provisioned = await onboard(home, ['--check'])
    expect(outcomes(provisioned)['openclaw-integration']?.status, describeRun(provisioned)).toBe('ok')
  }, TEST_TIMEOUT)

  test('a fresh Pi home: the runtime is reported as not provisioned yet, never as an error, and nothing is seeded', async () => {
    const home = await piHome()
    const run = await onboard(home, ['--check'])
    expect(outcomes(run).runtime, describeRun(run)).toMatchObject({ status: 'skipped', reason: 'check_only' })
    expect(Object.values(outcomes(run)).filter((line) => line.status === 'error')).toEqual([])
    expect(existsSync(join(home.piHome, 'agent', 'bakin-agents.json'))).toBe(false)
  }, TEST_TIMEOUT)
})

describe('--check --force', () => {
  test('is a usage error: nothing is checked and nothing is cleared', async () => {
    const home = await piHome()
    await onboard(home)
    const marker = readMarker(home)
    const run = await onboard(home, ['--check', '--force'])
    expect(run.exitCode, describeRun(run)).toBe(1)
    expect(outcomes(run)).toEqual({})
    expect(run.stderr).toContain('--check')
    expect(run.stderr).toContain('--force')
    expect(readMarker(home)).toEqual(marker)
  }, TEST_TIMEOUT)
})
