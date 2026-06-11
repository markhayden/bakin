/**
 * Store-extension tests for `useAgentStore` package-state plumbing.
 *
 * Covers:
 *   - load() fetches /api/plugins/team/ and /api/agent-packages?check=1 in parallel
 *   - merge: packageStates becomes a map keyed by agentId
 *   - failed /api/agent-packages?check=1 → packageStates: {}, agents still load
 *   - refreshPackageStates() re-fetches only the package endpoint
 *   - usePackageState(id) selector returns the right row (or undefined)
 *
 * No DOM, no React Testing Library — Zustand stores are usable from plain
 * code. We exercise the store's actions directly via getState().
 */
import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync } from 'fs'

const testDir = join(tmpdir(), `bakin-test-use-package-states-${Date.now()}-${Math.random().toString(36).slice(2)}`)

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))

import { useAgentStore } from '../../../plugins/team/hooks/use-agent-store'
import type { PackageStateRow } from '../../../plugins/team/types'

interface PkgResponse {
  ok: boolean
  agents?: PackageStateRow[]
  error?: string
}

afterAll(() => {
  try { rmSync(testDir, { recursive: true, force: true }) } catch {}
})

const ROSTER_OK = {
  agents: [
    { id: 'pixel', name: 'Pixel', emoji: '🎨', role: 'designer', headshot: '', status: 'online', model: 'claude-opus-4-7', heartbeat: null, heartbeatAge: null },
    { id: 'orca', name: 'Orca', emoji: '🐋', role: 'planner', headshot: '', status: 'offline', model: 'claude-sonnet-4-6', heartbeat: null, heartbeatAge: null },
  ],
  displaySettings: {},
  teams: [],
  mainAgentId: 'main',
}

const PKG_OK: PkgResponse = {
  ok: true,
  agents: [
    {
      agentId: 'pixel',
      state: 'managed',
      version: '0.1.0',
      packageId: 'examples/pixel@0.1.0',
      entry: { version: '0.1.0', source: 'github:examples/pixel', ref: 'v0.1.0', commitSha: 'abc1234', installedAt: '2026-04-25T00:00:00Z' },
    },
    { agentId: 'orca', state: 'unmanaged' },
  ],
}

function makeFetchSpy(opts: {
  rosterStatus?: number
  rosterBody?: unknown
  pkgStatus?: number
  pkgBody?: unknown
  pkgRejects?: boolean
  onCall?: (url: string, ts: number) => void
}) {
  return mock((url: RequestInfo | URL) => {
    const u = String(url)
    const ts = performance.now()
    opts.onCall?.(u, ts)
    if (u === '/api/plugins/team/') {
      return Promise.resolve({
        ok: (opts.rosterStatus ?? 200) < 400,
        json: () => Promise.resolve(opts.rosterBody ?? ROSTER_OK),
      } as Response)
    }
    if (u === '/api/agent-packages?check=1') {
      if (opts.pkgRejects) return Promise.reject(new Error('network down'))
      return Promise.resolve({
        ok: (opts.pkgStatus ?? 200) < 400,
        json: () => Promise.resolve(opts.pkgBody ?? PKG_OK),
      } as Response)
    }
    return Promise.reject(new Error(`unexpected fetch: ${u}`))
  })
}

beforeEach(() => {
  // Reset store between tests so cross-test state doesn't leak.
  useAgentStore.setState({
    agents: [], agentIds: [], agentMap: {}, agentsWithStatus: [],
    displaySettings: {}, teams: [], packageStates: {},
    mainAgentId: null, loaded: false,
  })
})

describe('useAgentStore — package state plumbing', () => {
  it('fires both fetches in parallel during load()', async () => {
    const calls: string[] = []
    const roster = deferred<Response>()
    const packages = deferred<Response>()
    global.fetch = mock((url: RequestInfo | URL) => {
      const u = String(url)
      calls.push(u)
      if (u === '/api/plugins/team/') return roster.promise
      if (u === '/api/agent-packages?check=1') return packages.promise
      return Promise.reject(new Error(`unexpected fetch: ${u}`))
    }) as unknown as typeof global.fetch

    const loadPromise = useAgentStore.getState().load()
    await Promise.resolve()

    expect(calls.sort()).toEqual(
      ['/api/agent-packages?check=1', '/api/plugins/team/'],
    )

    roster.resolve(response(ROSTER_OK))
    packages.resolve(response(PKG_OK))
    await loadPromise
  })

  it('merges package state into a map keyed by agentId', async () => {
    global.fetch = makeFetchSpy({}) as unknown as typeof global.fetch

    await useAgentStore.getState().load()

    const { packageStates } = useAgentStore.getState()
    expect(packageStates['pixel']).toMatchObject({
      agentId: 'pixel',
      state: 'managed',
      version: '0.1.0',
      packageId: 'examples/pixel@0.1.0',
    })
    expect(packageStates['pixel']?.version).toBe('0.1.0')
    expect(packageStates['pixel']?.entry?.version).toBe('0.1.0')
    expect(packageStates['orca']).toMatchObject({ agentId: 'orca', state: 'unmanaged' })
    expect(packageStates['nonexistent']).toBeUndefined()
  })

  it('survives a failed /api/agent-packages?check=1 — agents still load, packageStates empty', async () => {
    global.fetch = makeFetchSpy({ pkgRejects: true }) as unknown as typeof global.fetch

    await useAgentStore.getState().load()

    const state = useAgentStore.getState()
    expect(state.loaded).toBe(true)
    expect(state.agents).toHaveLength(2)
    expect(state.packageStates).toEqual({})
  })

  it('survives a non-ok /api/agent-packages?check=1 response (500) — packageStates empty', async () => {
    global.fetch = makeFetchSpy({ pkgStatus: 500, pkgBody: { ok: false, error: 'boom' } }) as unknown as typeof global.fetch

    await useAgentStore.getState().load()

    expect(useAgentStore.getState().agents).toHaveLength(2)
    expect(useAgentStore.getState().packageStates).toEqual({})
  })

  it('survives a malformed /api/agent-packages?check=1 payload — packageStates empty', async () => {
    global.fetch = makeFetchSpy({ pkgBody: { ok: true, agents: 'not-an-array' } }) as unknown as typeof global.fetch

    await useAgentStore.getState().load()

    expect(useAgentStore.getState().packageStates).toEqual({})
  })

  it('refreshPackageStates() re-fetches only the package endpoint', async () => {
    const calls: string[] = []
    global.fetch = makeFetchSpy({ onCall: (url) => calls.push(url) }) as unknown as typeof global.fetch

    await useAgentStore.getState().load()
    calls.length = 0

    await useAgentStore.getState().refreshPackageStates()

    expect(calls).toEqual(['/api/agent-packages?check=1'])
  })

  it('refreshPackageStates() picks up a new state value', async () => {
    let pkgVariant: PkgResponse = PKG_OK
    global.fetch = mock((url: RequestInfo | URL) => {
      const u = String(url)
      if (u === '/api/plugins/team/') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(ROSTER_OK) } as Response)
      }
      if (u === '/api/agent-packages?check=1') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(pkgVariant) } as Response)
      }
      return Promise.reject(new Error('unexpected'))
    }) as unknown as typeof global.fetch

    await useAgentStore.getState().load()
    expect(useAgentStore.getState().packageStates['orca']?.state).toBe('unmanaged')

    pkgVariant = {
      ok: true,
      agents: [
        { agentId: 'pixel', state: 'managed', version: '0.1.0', packageId: 'examples/pixel@0.1.0', entry: PKG_OK.agents?.[0].entry },
        { agentId: 'orca', state: 'managed', version: '0.2.0', packageId: 'examples/orca@0.2.0', entry: { version: '0.2.0', source: 'github:examples/orca', ref: 'main', commitSha: 'def5678', installedAt: '2026-04-25T00:00:00Z' } },
      ],
    }
    await useAgentStore.getState().refreshPackageStates()

    expect(useAgentStore.getState().packageStates['orca']?.state).toBe('managed')
    expect(useAgentStore.getState().packageStates['orca']?.version).toBe('0.2.0')
  })

  it('roster fetch failure short-circuits before package merge', async () => {
    global.fetch = makeFetchSpy({ rosterStatus: 500 }) as unknown as typeof global.fetch

    await useAgentStore.getState().load()

    const state = useAgentStore.getState()
    expect(state.loaded).toBe(true)
    expect(state.agents).toHaveLength(0)
    // packageStates stays at its previous value ({}) since we never call set on it
    expect(state.packageStates).toEqual({})
  })
})

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function response(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    json: () => Promise.resolve(body),
  } as Response
}
