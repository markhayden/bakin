/**
 * Onboarding through a running server: the CLI finds its home's server via
 * server.lock and runs every install there as an operation. The result
 * must match an in-process run of the same home.
 */
import { afterEach, describe, expect, test } from 'bun:test'

import { seedPi, storeAdapter } from '../fixtures'
import { startServer, trackHomes, type HarnessServer, type OnboardingHome } from '../harness'
import { describe as describeRun, onboard, readMarker, statuses, TEST_TIMEOUT } from './kit'

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

const realFetch: typeof fetch = (Bun as unknown as { fetch?: typeof fetch }).fetch ?? fetch

describe('server running vs not', () => {
  test('the same home reaches the same outcomes through both modes', async () => {
    const inProcessHome = await piHome()
    const inProcess = await onboard(inProcessHome)

    const serverHome = await piHome()
    const server = await startServer(serverHome)
    servers.push(server)
    const viaServer = await onboard(serverHome)

    const local = statuses(inProcess)
    const remote = statuses(viaServer)
    expect(Object.keys(remote), describeRun(viaServer)).toEqual(Object.keys(local))
    // Every step, with no exceptions: plugin assets and agent sync used to
    // differ (a booted server had repaired them; the in-process run only
    // warned), and onboarding now repairs them itself in both modes.
    expect(remote).toEqual(local)
    expect(readMarker(inProcessHome)?.components.runtime).toBe('ok')
    expect(readMarker(serverHome)?.components.runtime).toBe('ok')

    // The installs really ran on the server: it holds onboarding operations
    // that the CLI started.
    const listed = await realFetch(`${server.baseUrl}/api/operations`).then((res) => res.json()) as { operations: Array<{ kind: string; origin: string; status: string }> }
    const onboarding = listed.operations.filter((operation) => operation.kind.startsWith('onboarding:'))
    expect(onboarding.length).toBeGreaterThan(0)
    expect(onboarding.every((operation) => operation.origin === 'cli')).toBe(true)
    expect(onboarding.filter((operation) => operation.status === 'failed')).toEqual([])
  }, TEST_TIMEOUT)
})
