/**
 * Home on a real server (home-first-run plan, task 1.9): a throwaway home is
 * onboarded by the real CLI, the real server boots on it, and Home's state
 * route answers from the machine's actual state. No app module is imported
 * here; the app runs only in the child processes.
 */
import { afterEach, describe, expect, test } from 'bun:test'

import { seedPi, storeAdapter } from '../fixtures'
import { startServer, trackHomes, type HarnessServer, type OnboardingHome } from '../harness'
import { onboard, TEST_TIMEOUT } from './kit'

const homes = trackHomes()
const servers: HarnessServer[] = []
afterEach(async () => {
  for (const server of servers.splice(0)) await server.stop()
  await homes.finish()
})

const realFetch: typeof fetch = (Bun as unknown as { fetch?: typeof fetch }).fetch ?? fetch

async function served(options: { auth: boolean }): Promise<{ home: OnboardingHome; server: HarnessServer }> {
  const home = await homes.create()
  seedPi(home, { auth: options.auth })
  storeAdapter(home, 'pi')
  await onboard(home)
  const server = await startServer(home)
  servers.push(server)
  return { home, server }
}

interface StateBody {
  ok: boolean
  state: { name: string; agent?: { id: string; name: string } }
  starters: Array<{ id: string }>
}
const stateOf = async (server: HarnessServer): Promise<StateBody> => {
  const res = await realFetch(`${server.baseUrl}/api/plugins/home/state`)
  expect(res.status).toBe(200)
  return await res.json() as StateBody
}

describe('Home on a fresh Pi home', () => {
  test('the server serves the page, and the main agent has not been introduced', async () => {
    const { server } = await served({ auth: true })
    const page = await realFetch(`${server.baseUrl}/home`)
    expect(page.status).toBe(200)
    expect(page.headers.get('content-type') ?? '').toContain('text/html')

    const body = await stateOf(server)
    // Pi seeds its orchestrator as "Main" with no personality file.
    expect(body.state).toEqual({ name: 'meet-agent', agent: { id: 'main', name: 'Main' } })
    // Starters that need nothing are offered even on the barest home.
    expect(body.starters.map((starter) => starter.id)).toContain('brainstorm')
  }, TEST_TIMEOUT)

  test('the home plugin is listed with its page asset', async () => {
    const { server } = await served({ auth: true })
    const manifest = await realFetch(`${server.baseUrl}/api/plugins/manifest`).then((res) => res.json()) as { plugins: Array<{ id: string; status: string; clientEntry?: string }> }
    const home = manifest.plugins.find((plugin) => plugin.id === 'home')
    expect(home).toMatchObject({ id: 'home', status: 'active' })
    const asset = await realFetch(`${server.baseUrl}/api/plugins/home/assets/client.js`)
    expect(asset.status).toBe(200)
  }, TEST_TIMEOUT)
})
