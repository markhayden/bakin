/**
 * `bakin check <x>` and `bakin install <x>` (spec §8): every onboarding
 * component can be checked by name, every installable one installed, and
 * the hint for an unknown name lists exactly what is accepted.
 */
import { afterEach, describe, expect, test } from 'bun:test'

import { seedPi, storeAdapter } from '../fixtures'
import { runBakin, trackHomes, type OnboardingHome } from '../harness'
import { CHILD_TIMEOUT, onboard, TEST_TIMEOUT } from './kit'

const homes = trackHomes()
afterEach(() => homes.finish())

async function onboardedPi(): Promise<OnboardingHome> {
  const home = await homes.create()
  seedPi(home, { auth: true })
  storeAdapter(home, 'pi')
  await onboard(home)
  return home
}

const ALL = [
  'mkdir', 'settings', 'runtime', 'llm', 'search', 'search-models', 'media', 'openclaw-integration',
  'plugin-assets', 'agent-sync', 'models', 'budget', 'channels', 'recommended-plugins', 'recommended-agents', 'capabilities',
]
const CHECK_ONLY = ['llm', 'budget', 'channels']

describe('bakin check <component>', () => {
  test('every component can be checked by name and answers with its own result', async () => {
    const home = await onboardedPi()
    for (const name of ALL) {
      const run = await runBakin(home, ['check', name, '--json'], { timeoutMs: CHILD_TIMEOUT })
      const result = run.json as { name?: string; status?: string } | undefined
      expect({ name, answered: result?.name, known: !run.stderr.includes('Unknown') }).toEqual({ name, answered: name, known: true })
      expect(['ok', 'warn', 'missing', 'broken', 'error']).toContain(result?.status ?? '')
    }
  }, TEST_TIMEOUT)

  test('a component that does not apply to the runtime says so instead of being checked', async () => {
    const home = await onboardedPi()
    const run = await runBakin(home, ['check', 'openclaw-integration', '--json'], { timeoutMs: CHILD_TIMEOUT })
    expect(run.json).toMatchObject({ name: 'openclaw-integration', status: 'ok', message: expect.stringContaining('not applicable') })
    expect(run.exitCode).toBe(0)
  }, TEST_TIMEOUT)

  test('an unknown name is refused, and the hint lists every component plus all', async () => {
    const home = await onboardedPi()
    const run = await runBakin(home, ['check', 'bogus'], { timeoutMs: CHILD_TIMEOUT })
    expect(run.exitCode).not.toBe(0)
    const said = `${run.stdout}\n${run.stderr}`
    for (const name of [...ALL, 'all']) expect({ name, listed: said.includes(name) }).toEqual({ name, listed: true })
  }, TEST_TIMEOUT)
})

describe('--json output parses', () => {
  // Runtime logs go to stdout; under --json they must not, or nothing can read the result.
  test.each([
    [['check', 'runtime', '--json']],
    [['check', 'all', '--json']],
    [['install', 'runtime', '--yes', '--json']],
  ])('bakin %p prints one JSON value and nothing else', async (args) => {
    const home = await onboardedPi()
    const run = await runBakin(home, args, { timeoutMs: CHILD_TIMEOUT })
    expect(() => JSON.parse(run.stdout) as unknown).not.toThrow()
  }, TEST_TIMEOUT)
})

describe('bakin install <component>', () => {
  test('an unknown name is refused, and the hint lists exactly the components that have an install', async () => {
    const home = await onboardedPi()
    const run = await runBakin(home, ['install', 'bogus'], { timeoutMs: CHILD_TIMEOUT })
    expect(run.exitCode).not.toBe(0)
    const said = `${run.stdout}\n${run.stderr}`
    for (const name of ALL.filter((candidate) => !CHECK_ONLY.includes(candidate))) {
      expect({ name, listed: said.includes(name) }).toEqual({ name, listed: true })
    }
    // `capabilities` was installable all along; its own hint used to leave it out.
    expect(said).toContain('capabilities')
  }, TEST_TIMEOUT)

  test('a check-only component has nothing to install and is refused like any unknown target', async () => {
    const home = await onboardedPi()
    for (const name of CHECK_ONLY) {
      const run = await runBakin(home, ['install', name, '--yes', '--json'], { timeoutMs: CHILD_TIMEOUT })
      expect({ name, refused: run.exitCode !== 0 }).toEqual({ name, refused: true })
    }
  }, TEST_TIMEOUT)

  test('an installable component that is already in place installs as a no-op', async () => {
    const home = await onboardedPi()
    const run = await runBakin(home, ['install', 'runtime', '--yes', '--json'], { timeoutMs: CHILD_TIMEOUT })
    expect(run.json).toMatchObject({ component: 'runtime', status: 'noop' })
    expect(run.exitCode).toBe(0)
  }, TEST_TIMEOUT)
})
