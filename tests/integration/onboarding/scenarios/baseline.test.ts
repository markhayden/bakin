/**
 * Baseline onboarding scenarios: behaviour that already holds, pinned so
 * the hardening work cannot regress it. Each runs the real CLI against a
 * throwaway home (see ../harness.ts).
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

import { seedOpenClaw, seedPi, storeAdapter, storedAdapter, type OpenClawFixture } from '../fixtures'
import { diffTrees, isUnchanged, snapshotTree, trackHomes, type OnboardingHome } from '../harness'
import { describe as describeRun, markerPath, onboard, outcomes, readMarker, statuses, TEST_TIMEOUT } from './kit'

const homes = trackHomes()
const gateways: OpenClawFixture[] = []

afterEach(async () => {
  for (const gateway of gateways.splice(0)) await gateway.stop()
  await homes.finish()
})

async function piHome(options: { auth?: boolean } = {}): Promise<OnboardingHome> {
  const home = await homes.create()
  seedPi(home, { auth: options.auth ?? true })
  storeAdapter(home, 'pi')
  return home
}

async function openClawHome(options: Parameters<typeof seedOpenClaw>[1] = {}): Promise<{ home: OnboardingHome; fixture: OpenClawFixture }> {
  const home = await homes.create()
  const fixture = await seedOpenClaw(home, options)
  gateways.push(fixture)
  storeAdapter(home, 'openclaw')
  return { home, fixture }
}

describe('a stored runtime runs to a marker', () => {
  test('Pi, logged in', async () => {
    const home = await piHome()
    const run = await onboard(home)
    const lines = outcomes(run)
    expect(lines.runtime?.status, describeRun(run)).toBe('ok')
    expect(lines.runtime?.message).toContain('pi')
    expect(lines.llm?.status).toBe('ok')
    expect(lines.mkdir?.status).toBe('ok')
    expect(Object.values(lines).filter((line) => line.status === 'error')).toEqual([])
    // Warnings (unapproved installs) are allowed; errors are not.
    expect(run.exitCode).toBe(2)
    const marker = readMarker(home)
    expect(marker?.components.runtime).toBe('ok')
    expect(storedAdapter(home)).toBe('pi')
  }, TEST_TIMEOUT)

  test('OpenClaw, gateway up', async () => {
    const { home, fixture } = await openClawHome()
    const run = await onboard(home)
    const lines = outcomes(run)
    expect(lines.runtime?.status, describeRun(run)).toBe('ok')
    expect(lines.runtime?.message).toContain('openclaw')
    expect(lines['openclaw-integration']?.status).toBe('ok')
    expect(lines.llm?.status).toBe('ok')
    expect(Object.values(lines).filter((line) => line.status === 'error')).toEqual([])
    expect(run.exitCode).toBe(2)
    expect(readMarker(home)?.components.runtime).toBe('ok')
    expect(storedAdapter(home)).toBe('openclaw')
    // The fixture was really used: the gateway was asked for its health and
    // the CLI stand-in answered the adapter's two read-only commands.
    expect(fixture.gatewayRequests()).toContain('/health')
    expect(fixture.cliCalls()).toContain('models auth list --json')
  }, TEST_TIMEOUT)
})

describe('an onboarded home', () => {
  test('a rerun reports already_onboarded and changes nothing', async () => {
    const home = await piHome()
    await onboard(home)
    const completedAt = readMarker(home)?.completedAt
    const before = snapshotTree(home.bakinHome)

    const rerun = await onboard(home)
    expect(rerun.exitCode, describeRun(rerun)).toBe(0)
    expect(rerun.jsonLines).toEqual([{ status: 'already_onboarded', completedAt }])
    expect(diffTrees(before, snapshotTree(home.bakinHome))).toEqual({ added: [], removed: [], changed: [] })
  }, TEST_TIMEOUT)

  test('--force replays the whole flow and lands in the same place', async () => {
    const home = await piHome()
    const first = await onboard(home)
    const firstMarker = readMarker(home)

    const replay = await onboard(home, ['--force'])
    expect(replay.exitCode, describeRun(replay)).toBe(first.exitCode)
    expect(statuses(replay)).toEqual(statuses(first))
    const replayMarker = readMarker(home)
    expect(replayMarker?.components).toEqual(firstMarker?.components ?? {})
    expect(Date.parse(replayMarker?.completedAt ?? '')).toBeGreaterThanOrEqual(Date.parse(firstMarker?.completedAt ?? ''))
  }, TEST_TIMEOUT)
})

describe('a marker that proves nothing', () => {
  test.each([
    ['an old-version marker', (marker: { version: number }) => JSON.stringify({ ...marker, version: marker.version - 1 })],
    ['a corrupt marker', () => '{ this is not json'],
    ['a marker with the wrong shape', () => JSON.stringify({ version: 'six', done: true })],
  ])('%s is treated as not onboarded and the rerun completes', async (_label, damage) => {
    const home = await piHome()
    await onboard(home)
    const good = readMarker(home)
    expect(good).not.toBeNull()
    writeFileSync(markerPath(home), damage(good!))

    const rerun = await onboard(home)
    expect(rerun.jsonLines.some((line) => line.status === 'already_onboarded'), describeRun(rerun)).toBe(false)
    expect(outcomes(rerun).runtime?.status).toBe('ok')
    const repaired = readMarker(home)
    expect(repaired?.version).toBe(good!.version)
    expect(repaired?.components.runtime).toBe('ok')
  }, TEST_TIMEOUT)
})

describe('a broken runtime stops onboarding', () => {
  test('a roster with duplicate ids is an error and is never rewritten', async () => {
    const { home } = await openClawHome({ roster: 'duplicate' })
    const configPath = join(home.openclawHome, 'openclaw.json')
    const before = readFileSync(configPath)

    const run = await onboard(home)
    const lines = outcomes(run)
    expect(lines.runtime?.status, describeRun(run)).toBe('error')
    expect(lines.runtime?.message).toContain("duplicate agent id 'main'")
    expect(run.exitCode).toBe(1)
    expect(readMarker(home)).toBeNull()
    expect(readFileSync(configPath).equals(before)).toBe(true)
  }, TEST_TIMEOUT)

  test.each([
    ['with credentials', true],
    ['without credentials', false],
  ])('OpenClaw with its gateway down is a runtime error, %s', async (_label, auth) => {
    const { home } = await openClawHome({ gateway: 'down', auth })
    const run = await onboard(home)
    const lines = outcomes(run)
    expect(lines.runtime?.status, describeRun(run)).toBe('error')
    // A dead gateway is a runtime problem, never a credentials warning.
    expect(lines.llm?.status).not.toBe('warn')
    expect(run.exitCode).toBe(1)
    expect(readMarker(home)).toBeNull()
  }, TEST_TIMEOUT)

  test('an OpenClaw roster that is still empty after provisioning is an error', async () => {
    const { home } = await openClawHome({ roster: 'empty' })
    const run = await onboard(home)
    const lines = outcomes(run)
    expect(lines.runtime?.status, describeRun(run)).toBe('error')
    expect(lines.runtime?.message).toContain('no agents')
    expect(run.exitCode).toBe(1)
    expect(readMarker(home)).toBeNull()
  }, TEST_TIMEOUT)
})

describe('environment overrides', () => {
  test('BAKIN_RUNTIME_ADAPTER is used for the run and never persisted', async () => {
    // Nothing stored: the default adapter would be OpenClaw, which this
    // home cannot reach. The override selects Pi for this process only.
    const home = await homes.create()
    seedPi(home, { auth: true })
    const run = await onboard(home, [], { env: { BAKIN_RUNTIME_ADAPTER: 'pi' } })
    const lines = outcomes(run)
    expect(lines.runtime?.status, describeRun(run)).toBe('ok')
    expect(lines.runtime?.message).toContain('pi')
    expect(readMarker(home)).not.toBeNull()
    expect(storedAdapter(home)).toBeUndefined()
  }, TEST_TIMEOUT)

  test('BAKIN_RUNTIME_ADAPTER overrides a stored adapter without rewriting it', async () => {
    const home = await homes.create()
    seedPi(home, { auth: true })
    storeAdapter(home, 'openclaw')
    const run = await onboard(home, [], { env: { BAKIN_RUNTIME_ADAPTER: 'pi' } })
    expect(outcomes(run).runtime?.message, describeRun(run)).toContain('pi')
    expect(storedAdapter(home)).toBe('openclaw')
  }, TEST_TIMEOUT)

  test('BAKIN_URL set: onboarding refuses before touching the home', async () => {
    const home = await piHome()
    const before = snapshotTree(home.root)
    const run = await onboard(home, [], { env: { BAKIN_URL: 'http://127.0.0.1:1' } })
    expect(run.exitCode, describeRun(run)).toBe(1)
    expect(run.stderr).toContain('BAKIN_URL')
    expect(run.jsonLines).toEqual([])
    expect(isUnchanged(diffTrees(before, snapshotTree(home.root)))).toBe(true)
  }, TEST_TIMEOUT)
})
