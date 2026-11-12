/**
 * Recovery scenarios: onboarding that fails, is interrupted or collides
 * with another run leaves a home the next run can finish.
 */
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

import { seedPi, storeAdapter } from '../fixtures'
import { startServer, trackHomes, type HarnessServer, type OnboardingHome } from '../harness'
import { describe as describeRun, onboard, outcomes, readMarker, TEST_TIMEOUT } from './kit'

const homes = trackHomes()
const servers: HarnessServer[] = []

afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop()
  await homes.finish()
})

async function piHome(): Promise<OnboardingHome> {
  const home = await homes.create()
  seedPi(home, { auth: true })
  storeAdapter(home, 'pi')
  return home
}

/** A run that ended because it was interrupted, by either route out. */
function wasInterrupted(run: { exitCode: number | null; signal: NodeJS.Signals | null }): boolean {
  return run.exitCode === 130 || run.signal === 'SIGINT'
}

describe('a component install fails', () => {
  test('that step is an error, what needs it is skipped and says so, and a rerun completes', async () => {
    const home = await piHome()
    // A file where the directory tree must go: `mkdir` cannot succeed.
    writeFileSync(join(home.bakinHome, 'assets'), 'in the way')

    const failed = await onboard(home)
    const lines = outcomes(failed)
    expect(lines.mkdir?.status, describeRun(failed)).toBe('error')
    expect(failed.exitCode).toBe(1)
    expect(readMarker(home)).toBeNull()
    // Everything needs the home, directly or through a step that does:
    // each is skipped and names the step it was waiting for.
    expect(lines.settings).toMatchObject({ status: 'skipped', reason: 'requires', requires: 'mkdir' })
    expect(lines.runtime).toMatchObject({ status: 'skipped', reason: 'requires', requires: 'settings' })
    expect(lines.llm).toMatchObject({ status: 'skipped', reason: 'requires', requires: 'runtime' })
    expect(Object.values(lines).filter((line) => line.status === 'error').map((line) => line.component)).toEqual(['mkdir'])

    rmSync(join(home.bakinHome, 'assets'))
    const rerun = await onboard(home)
    expect(outcomes(rerun).mkdir?.status, describeRun(rerun)).toBe('ok')
    expect(rerun.exitCode).toBe(2)
    expect(readMarker(home)?.components.mkdir).toBe('ok')
  }, TEST_TIMEOUT)
})

describe('an interrupted run', () => {
  test('in-process: no marker is written and a rerun completes', async () => {
    const home = await piHome()
    const interrupted = await onboard(home, [], {
      signalWhen: { signal: 'SIGINT', when: ({ stdout }) => stdout.includes('"component":"mkdir"') },
    })
    expect(wasInterrupted(interrupted), describeRun(interrupted)).toBe(true)
    expect(readMarker(home)).toBeNull()
    expect(existsSync(join(home.bakinHome, 'install.lock'))).toBe(false)

    const rerun = await onboard(home)
    expect(rerun.exitCode, describeRun(rerun)).toBe(2)
    expect(readMarker(home)?.components.runtime).toBe('ok')
  }, TEST_TIMEOUT)

  test('against a running server: no marker is written and a rerun completes', async () => {
    const home = await piHome()
    const server = await startServer(home)
    servers.push(server)
    const interrupted = await onboard(home, [], {
      signalWhen: { signal: 'SIGINT', when: ({ stdout }) => stdout.includes('"component":"mkdir"') },
    })
    expect(wasInterrupted(interrupted), describeRun(interrupted)).toBe(true)
    expect(readMarker(home)).toBeNull()

    const rerun = await onboard(home)
    expect(rerun.timedOut, describeRun(rerun)).toBe(false)
    expect(Object.values(outcomes(rerun)).filter((line) => line.status === 'error')).toEqual([])
    expect(readMarker(home)?.components.runtime).toBe('ok')
  }, TEST_TIMEOUT)
})

describe('another run in the way', () => {
  test('a stale install.lock from a dead process does not block onboarding', async () => {
    const home = await piHome()
    mkdirSync(home.bakinHome, { recursive: true })
    writeFileSync(join(home.bakinHome, 'install.lock'), JSON.stringify({ pid: 999_999, startedAt: new Date(0).toISOString(), holder: 'a process that died' }))

    const run = await onboard(home)
    expect(run.timedOut, describeRun(run)).toBe(false)
    expect(Object.values(outcomes(run)).filter((line) => line.status === 'error')).toEqual([])
    expect(readMarker(home)?.components.runtime).toBe('ok')
  }, TEST_TIMEOUT)

  test('two runs at once both finish and leave one valid marker', async () => {
    const home = await piHome()
    const [first, second] = await Promise.all([onboard(home), onboard(home)])
    for (const run of [first, second]) {
      expect(run.timedOut, describeRun(run)).toBe(false)
      expect(Object.values(outcomes(run)).filter((line) => line.status === 'error')).toEqual([])
      // Each run either does the work (exit 2: warnings for what was not
      // approved) or starts after the other already finished and says so
      // (exit 0). Which one happens is a race; both are correct.
      const sawItDone = run.jsonLines.some((line) => line.status === 'already_onboarded')
      expect({ exitCode: run.exitCode, sawItDone }).toEqual(sawItDone ? { exitCode: 0, sawItDone: true } : { exitCode: 2, sawItDone: false })
    }
    // At least one of them did the work.
    expect([first, second].some((run) => run.exitCode === 2)).toBe(true)
    // readMarker throws on a torn write.
    expect(readMarker(home)?.components.runtime).toBe('ok')
    // And the home is consistent: a third run has nothing left to do.
    const third = await onboard(home)
    expect(third.jsonLines.map((line) => line.status)).toEqual(['already_onboarded'])
  }, TEST_TIMEOUT)
})
