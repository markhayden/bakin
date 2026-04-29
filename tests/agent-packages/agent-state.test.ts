/**
 * Tests for agent-state detection (Phase E-2).
 *
 * The four states must be precisely distinguished — confusing 'unmanaged'
 * with 'absent' would let the installer destroy hand-built agents.
 */
import { describe, it, expect, beforeEach, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

const testDir = join(tmpdir(), `bakin-test-agent-state-${Date.now()}-${randomUUID()}`)

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))
mock.module('@bakin/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({}),
}))

type RuntimeRosterAgent = { id: string; name?: string }
type TestGlobal = typeof globalThis & {
  __bakinAppServices?: {
    runtime: {
      agents: {
        list: () => Promise<Array<{ id: string; name: string; status: 'active' }>>
      }
    }
  }
}

let runtimeAgents: RuntimeRosterAgent[] = []

import {
  getAgentState,
  listAllAgentStates,
} from '../../src/core/agent-packages/agent-state'
import type { Lockfile, PackageEntry } from '../../packages/core/src/agent-packages/lockfile'

beforeEach(() => {
  runtimeAgents = []
  ;(globalThis as TestGlobal).__bakinAppServices = {
    runtime: {
      agents: {
        list: async () => runtimeAgents.map((agent) => ({
          id: agent.id,
          name: agent.name ?? agent.id,
          status: 'active',
        })),
      },
    },
  }
})

const NOW = '2026-04-24T12:00:00Z'

function managedEntry(agentId = 'pixel'): PackageEntry {
  return {
    kind: 'agent',
    version: '0.1.0',
    source: 'github:madeinwyo/bakin-agent-pixel',
    ref: 'v0.1.0',
    commitSha: 'abc123',
    installedAt: NOW,
    state: 'managed',
    agentId,
  }
}

function adoptedEntry(agentId = 'pixel'): PackageEntry {
  return { ...managedEntry(agentId), state: 'adopted' }
}

function lockOf(packages: Record<string, PackageEntry>): Lockfile {
  return { version: 1, packages }
}

describe('getAgentState — four discriminating cases', () => {
  it('returns absent when agent is in neither runtime nor lockfile', async () => {
    const info = await getAgentState('ghost', lockOf({}))
    expect(info.state).toBe('absent')
    expect(info.entry).toBeUndefined()
    expect(info.packageId).toBeUndefined()
  })

  it('returns unmanaged when agent is in runtime but no lockfile entry', async () => {
    runtimeAgents = [{ id: 'pixel', name: 'Pixel' }]
    const info = await getAgentState('pixel', lockOf({}))
    expect(info.state).toBe('unmanaged')
    expect(info.entry).toBeUndefined()
  })

  it('returns adopted when runtime + lockfile state="adopted"', async () => {
    runtimeAgents = [{ id: 'pixel' }]
    const info = await getAgentState('pixel', lockOf({ pixel: adoptedEntry() }))
    expect(info.state).toBe('adopted')
    expect(info.packageId).toBe('pixel')
    expect(info.entry?.state).toBe('adopted')
  })

  it('returns managed when runtime + lockfile state="managed"', async () => {
    runtimeAgents = [{ id: 'pixel' }]
    const info = await getAgentState('pixel', lockOf({ pixel: managedEntry() }))
    expect(info.state).toBe('managed')
    expect(info.packageId).toBe('pixel')
  })
})

describe('getAgentState — orphan handling', () => {
  it('returns the lockfile-recorded state when agent is in lockfile but absent from runtime (drift)', async () => {
    // No agents in runtime, but lockfile has a managed pixel entry.
    // This is a drift state the doctor should flag — but the state lookup
    // must still report what the lockfile says, otherwise the installer
    // would refuse to act on the orphan.
    const info = await getAgentState('pixel', lockOf({ pixel: managedEntry() }))
    expect(info.state).toBe('managed')
    expect(info.packageId).toBe('pixel')
  })

  it('matches lockfile entries by agentId, not by package id', async () => {
    runtimeAgents = [{ id: 'rolo' }]
    // Package id "rolo-package" but agentId field is "rolo"
    const entry: PackageEntry = { ...managedEntry('rolo') }
    const info = await getAgentState('rolo', lockOf({ 'rolo-package': entry }))
    expect(info.state).toBe('managed')
    expect(info.packageId).toBe('rolo-package')
  })
})

describe('listAllAgentStates', () => {
  it('returns one info entry per runtime agent', async () => {
    runtimeAgents = [
      { id: 'main' },
      { id: 'pixel' },
      { id: 'rolo' },
    ]
    const all = await listAllAgentStates(lockOf({}))
    expect(all.map((a) => a.agentId).sort()).toEqual(['main', 'pixel', 'rolo'])
    expect(all.every((a) => a.state === 'unmanaged')).toBe(true)
  })

  it('cross-references lockfile entries — managed and adopted states populate', async () => {
    runtimeAgents = [{ id: 'pixel' }, { id: 'rolo' }, { id: 'roscoe' }]
    const lock = lockOf({
      pixel: managedEntry('pixel'),
      rolo: adoptedEntry('rolo'),
      // roscoe has no lockfile entry → unmanaged
    })

    const all = await listAllAgentStates(lock)
    const byId = new Map(all.map((a) => [a.agentId, a]))
    expect(byId.get('pixel')?.state).toBe('managed')
    expect(byId.get('rolo')?.state).toBe('adopted')
    expect(byId.get('roscoe')?.state).toBe('unmanaged')
  })

  it('surfaces lockfile-only orphans (lockfile entry without runtime counterpart)', async () => {
    runtimeAgents = [{ id: 'pixel' }]
    const lock = lockOf({
      pixel: managedEntry(),
      'ghost-pkg': managedEntry('ghost-agent'),
    })
    const all = await listAllAgentStates(lock)
    const byId = new Map(all.map((a) => [a.agentId, a]))
    expect(byId.has('pixel')).toBe(true)
    expect(byId.has('ghost-agent')).toBe(true)
    expect(byId.get('ghost-agent')?.packageId).toBe('ghost-pkg')
  })

  it('skips non-agent kinds', async () => {
    runtimeAgents = []
    const lock: Lockfile = {
      version: 1,
      packages: {
        'visual@0.3.1': {
          kind: 'skill-pack',
          version: '0.3.1',
          source: 'github:foo/bar',
          ref: 'v0.3.1',
          commitSha: 'def456',
          installedAt: NOW,
          refCount: 0,
          dependents: [],
        },
      },
    }
    await expect(listAllAgentStates(lock)).resolves.toEqual([])
  })
})
