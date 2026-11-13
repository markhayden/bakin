/**
 * `bakin uninstall search` (#1049) through the real CLI. What it removes is
 * covered where the service layer can be stood in for
 * (tests/core/onboarding/antfly.test.ts); here are the refusals a person
 * meets at the command line, and proof that a refusal touches nothing.
 */
import { afterEach, describe, expect, test } from 'bun:test'

import { seedPi, storeAdapter } from '../fixtures'
import { diffTrees, runBakin, snapshotTree, startServer, trackHomes, type HarnessServer, type OnboardingHome } from '../harness'
import { CHILD_TIMEOUT, onboard, TEST_TIMEOUT } from './kit'

const homes = trackHomes()
const servers: HarnessServer[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop()
  await homes.finish()
})

async function onboardedPi(): Promise<OnboardingHome> {
  const home = await homes.create()
  seedPi(home, { auth: true })
  storeAdapter(home, 'pi')
  await onboard(home)
  return home
}

describe('bakin uninstall search', () => {
  test('an externally managed endpoint is refused, with every flag, and nothing changes', async () => {
    const home = await onboardedPi()
    const before = snapshotTree(home.root)
    const run = await runBakin(home, ['uninstall', 'search', '--data', '--engine', '--yes'], { timeoutMs: CHILD_TIMEOUT })
    expect(run.exitCode).toBe(1)
    expect(`${run.stdout}${run.stderr}`).toContain('externally managed')
    const diff = diffTrees(before, snapshotTree(home.root))
    // The operation's own bookkeeping (audit trail, lock dir) is the only trace.
    const touched = [...diff.added, ...diff.changed, ...diff.removed].filter((entry) => !/^bakin\/(audit\.jsonl|locks(\/|$))/.test(entry))
    expect(touched).toEqual([])
  }, TEST_TIMEOUT)

  test('with this home\'s server running it refuses and says to stop Bakin first', async () => {
    const home = await onboardedPi()
    servers.push(await startServer(home))
    const run = await runBakin(home, ['uninstall', 'search', '--yes'], { timeoutMs: CHILD_TIMEOUT })
    expect(run.exitCode).toBe(1)
    expect(run.stderr).toContain('Stop it first (`bakin stop`)')
  }, TEST_TIMEOUT)

  test('anything but `search`, or a flag it does not know, is a usage error', async () => {
    const home = await onboardedPi()
    for (const args of [['uninstall'], ['uninstall', 'media'], ['uninstall', 'search', '--everything']]) {
      const run = await runBakin(home, args, { timeoutMs: CHILD_TIMEOUT })
      expect({ args, exitCode: run.exitCode }).toEqual({ args, exitCode: 1 })
      expect(`${run.stdout}${run.stderr}`).toContain('bakin uninstall search [--data] [--engine] [--yes]')
    }
  }, TEST_TIMEOUT)
})
