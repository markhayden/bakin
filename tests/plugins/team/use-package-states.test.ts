/**
 * Store-extension tests for `useAgentStore` package-state plumbing.
 *
 * Covers:
 *   - load() fetches /api/plugins/team/ and /api/agent-packages in parallel
 *   - merge: packageStates becomes a map keyed by agentId
 *   - failed /api/agent-packages → packageStates: {}, agents still load
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
      packageId: 'examples/pixel@0.1.0',
      entry: { source: 'github:examples/pixel', ref: 'v0.1.0', commitSha: 'abc1234', installedAt: '2026-04-25T00:00:00Z' },
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
    if (u === '/api/agent-packages') {
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
    const calls: Array<{ url: string; ts: number }> = []
    global.fetch = makeFetchSpy({
      onCall: (url, ts) => calls.push({ url, ts }),
    }) as unknown as typeof global.fetch

    await useAgentStore.getState().load()

    expect(calls.map((c) => c.url).sort()).toEqual(
      ['/api/agent-packages', '/api/plugins/team/'],
    )
    // Parallel == both calls landed before either resolved. Timestamps will
    // be within microseconds of each other; we assert <5ms which is generous.
    const span = Math.abs(calls[0].ts - calls[1].ts)
    expect(span).toBeLessThan(5)
  })

  it('merges package state into a map keyed by agentId', async () => {
    global.fetch = makeFetchSpy({}) as unknown as typeof global.fetch

    await useAgentStore.getState().load()

    const { packageStates } = useAgentStore.getState()
    expect(packageStates['pixel']).toMatchObject({
      agentId: 'pixel',
      state: 'managed',
      packageId: 'examples/pixel@0.1.0',
    })
    expect(packageStates['orca']).toMatchObject({ agentId: 'orca', state: 'unmanaged' })
    expect(packageStates['nonexistent']).toBeUndefined()
  })

  it('survives a failed /api/agent-packages — agents still load, packageStates empty', async () => {
    global.fetch = makeFetchSpy({ pkgRejects: true }) as unknown as typeof global.fetch

    await useAgentStore.getState().load()

    const state = useAgentStore.getState()
    expect(state.loaded).toBe(true)
    expect(state.agents).toHaveLength(2)
    expect(state.packageStates).toEqual({})
  })

  it('survives a non-ok /api/agent-packages response (500) — packageStates empty', async () => {
    global.fetch = makeFetchSpy({ pkgStatus: 500, pkgBody: { ok: false, error: 'boom' } }) as unknown as typeof global.fetch

    await useAgentStore.getState().load()

    expect(useAgentStore.getState().agents).toHaveLength(2)
    expect(useAgentStore.getState().packageStates).toEqual({})
  })

  it('survives a malformed /api/agent-packages payload — packageStates empty', async () => {
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

    expect(calls).toEqual(['/api/agent-packages'])
  })

  it('refreshPackageStates() picks up a new state value', async () => {
    let pkgVariant: PkgResponse = PKG_OK
    global.fetch = mock((url: RequestInfo | URL) => {
      const u = String(url)
      if (u === '/api/plugins/team/') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(ROSTER_OK) } as Response)
      }
      if (u === '/api/agent-packages') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(pkgVariant) } as Response)
      }
      return Promise.reject(new Error('unexpected'))
    }) as unknown as typeof global.fetch

    await useAgentStore.getState().load()
    expect(useAgentStore.getState().packageStates['orca']?.state).toBe('unmanaged')

    pkgVariant = {
      ok: true,
      agents: [
        { agentId: 'pixel', state: 'managed', packageId: 'examples/pixel@0.1.0', entry: PKG_OK.agents?.[0].entry },
        { agentId: 'orca', state: 'adopted', packageId: 'examples/orca@0.1.0' },
      ],
    }
    await useAgentStore.getState().refreshPackageStates()

    expect(useAgentStore.getState().packageStates['orca']?.state).toBe('adopted')
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
