/**
 * What onboarding says when Pi is installed but nobody has logged in
 * (spec §3, D11): the runtime is fine, the credentials are missing, and
 * every instruction is about Pi.
 */
import { afterEach, describe, expect, test } from 'bun:test'

import { seedOpenClaw, seedPi, storeAdapter } from '../fixtures'
import { trackHomes, type OnboardingHome } from '../harness'
import { describe as describeRun, onboard, outcomes, readMarker, TEST_TIMEOUT } from './kit'

const homes = trackHomes()
afterEach(() => homes.finish())

async function loggedOutPi(): Promise<OnboardingHome> {
  const home = await homes.create()
  seedPi(home, { auth: false })
  storeAdapter(home, 'pi')
  return home
}

/** Component names are stable identifiers, not wording. */
function wording(run: Awaited<ReturnType<typeof onboard>>): string {
  return Object.values(outcomes(run))
    .map((line) => `${line.message} ${typeof line.remediation === 'string' ? line.remediation : ''}`)
    .join('\n')
}

describe('Pi installed, not logged in', () => {
  test('the runtime is ok, credentials warn, and onboarding completes', async () => {
    const home = await loggedOutPi()
    const run = await onboard(home)
    const lines = outcomes(run)
    expect(lines.runtime?.status, describeRun(run)).toBe('ok')
    expect(lines.llm?.status).toBe('warn')
    expect(run.exitCode).toBe(2)
    expect(readMarker(home)).not.toBeNull()
    // The login is the only thing between this home and a working setup:
    // nothing that needs the runtime was held back by it.
    expect(Object.values(lines).filter((line) => line.reason === 'requires')).toEqual([])
  }, TEST_TIMEOUT)

  test('the instructions are for Pi and never mention OpenClaw', async () => {
    const home = await loggedOutPi()
    const run = await onboard(home)
    const text = wording(run)
    expect(text, describeRun(run)).not.toMatch(/openclaw/i)
    expect(outcomes(run).llm?.remediation).toMatch(/\bpi\b/i)
    expect(outcomes(run).llm?.remediation).toContain('/login')
  }, TEST_TIMEOUT)

  test('the same holds under --check', async () => {
    const home = await loggedOutPi()
    await onboard(home)
    const run = await onboard(home, ['--check'])
    expect(wording(run), describeRun(run)).not.toMatch(/openclaw/i)
    expect(outcomes(run).llm?.remediation).toContain('/login')
  }, TEST_TIMEOUT)
})

describe('OpenClaw reachable, no provider logged in', () => {
  test('the instructions are for OpenClaw and never mention Pi', async () => {
    const home = await homes.create()
    const fixture = await seedOpenClaw(home, { auth: false })
    storeAdapter(home, 'openclaw')
    try {
      const run = await onboard(home)
      const lines = outcomes(run)
      expect(lines.runtime?.status, describeRun(run)).toBe('ok')
      expect(lines.llm?.status).toBe('warn')
      expect(lines.llm?.remediation).toContain('OpenClaw')
      expect(lines.llm?.remediation).not.toMatch(/\bpi\b|\/login/i)
      // No login, both runtimes: onboarding still completes with a warning.
      expect(run.exitCode).toBe(2)
      expect(readMarker(home)).not.toBeNull()
    } finally {
      await fixture.stop()
    }
  }, TEST_TIMEOUT)
})
