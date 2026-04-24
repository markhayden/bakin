/**
 * Pure-function tests for the team-grid pyramid layout.
 *
 * Covers the T5 contract: the root of the pyramid is always `mainAgentId`
 * from the store, and each team's `reportsTo` is resolved to
 * `reportsTo ?? mainAgentId` at render time. We also check graceful
 * degradation when the roster is broken.
 */
import { describe, it, expect, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

// ─── Mandatory test-isolation mocks ────────────────────────────────────────
// Per CLAUDE.md: every test file must mock content-dir even if the code
// under test is pure. This is a backstop — buildGraph is pure and never
// touches the filesystem, but the check keeps that true.

const testDir = join(tmpdir(), `bakin-test-build-graph-${Date.now()}`)

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    agents: join(testDir, 'agents'),
    heartbeats: join(testDir, 'heartbeats'),
  }),
}))

mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({
    agents: join(testDir, 'agents'),
    heartbeats: join(testDir, 'heartbeats'),
  }),
}))

mock.module('../../../src/core/logger', () => ({
  createLogger: () => ({ info: mock(), warn: mock(), error: mock(), debug: mock() }),
}))

mock.module('../../../src/core/watcher', () => ({
  registerSyncHook: mock(),
  registerUnlinkHook: mock(),
}))

// ─── Imports under test ────────────────────────────────────────────────────

import { buildGraph } from '../../../plugins/team/lib/build-graph'
import type { AgentWithStatus, OrgTeam, AgentDisplaySettingsMap } from '../../../plugins/team/types'

// ─── Fixture helpers ───────────────────────────────────────────────────────

function agent(id: string, name: string = id): AgentWithStatus {
  return {
    id,
    name,
    emoji: '🤖',
    role: 'Agent',
    headshot: '',
    status: 'offline',
    model: 'claude-opus-4',
    heartbeat: null,
    heartbeatAge: null,
  }
}

function team(overrides: Partial<OrgTeam> & { id: string }): OrgTeam {
  return {
    id: overrides.id,
    label: overrides.label ?? overrides.id,
    // Cast through unknown to allow null for legacy / default-main semantics.
    reportsTo: (overrides.reportsTo ?? (null as unknown as string)),
    color: overrides.color,
    order: overrides.order,
  }
}

function getNodeIds(nodes: ReadonlyArray<{ id: string }>): string[] {
  return nodes.map((n) => n.id)
}

function countAgentCards(nodes: ReadonlyArray<{ type?: string; id: string }>, agentId: string): number {
  return nodes.filter((n) => n.type === 'agentCard' && n.id === agentId).length
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('buildGraph — founder row', () => {
  it('always renders the founder node', () => {
    const { nodes } = buildGraph({
      agents: [],
      teams: [],
      displaySettings: {},
      mainAgentId: null,
    })
    expect(nodes.find((n) => n.id === 'mark')).toBeDefined()
  })
})

describe('buildGraph — fresh install (no teams, main + subagents)', () => {
  it('roots the pyramid at main and puts all subagents under a synthetic section', () => {
    const agents = [agent('main', 'Crab'), agent('a'), agent('b'), agent('c')]
    const { nodes, edges } = buildGraph({
      agents,
      teams: [],
      displaySettings: {},
      mainAgentId: 'main',
    })

    // Row 1: main card exists, exactly once
    expect(countAgentCards(nodes, 'main')).toBe(1)

    // Row 2: synthetic "All agents" section
    const section = nodes.find((n) => n.id === 'section-all')
    expect(section).toBeDefined()

    // Main wires to the synthetic section
    expect(edges.find((e) => e.source === 'main' && e.target === 'section-all')).toBeDefined()

    // Subagents wired from the section
    for (const id of ['a', 'b', 'c']) {
      expect(countAgentCards(nodes, id)).toBe(1)
      expect(edges.find((e) => e.source === 'section-all' && e.target === id)).toBeDefined()
    }

    // No unassigned bucket in the default flat config
    expect(nodes.find((n) => n.id === 'section-unassigned')).toBeUndefined()
  })
})

describe('buildGraph — reportsTo fallback resolution', () => {
  const agents = [agent('main'), agent('a'), agent('b')]
  const displaySettings: AgentDisplaySettingsMap = {
    a: { teamId: 'creators' },
    b: { teamId: 'creators' },
  }

  it('renders a team with null reportsTo under main', () => {
    const { nodes, edges } = buildGraph({
      agents,
      teams: [team({ id: 'creators', label: 'Creators', reportsTo: null as unknown as string })],
      displaySettings,
      mainAgentId: 'main',
    })

    expect(nodes.find((n) => n.id === 'section-creators')).toBeDefined()
    expect(edges.find((e) => e.source === 'main' && e.target === 'section-creators')).toBeDefined()
  })

  it('renders a team with reportsTo="main" under main (same bucket as null)', () => {
    const { edges } = buildGraph({
      agents,
      teams: [team({ id: 'creators', reportsTo: 'main' })],
      displaySettings,
      mainAgentId: 'main',
    })
    expect(edges.find((e) => e.source === 'main' && e.target === 'section-creators')).toBeDefined()
  })

  it('falls back to main when reportsTo points at an unknown agent', () => {
    const { edges } = buildGraph({
      agents,
      teams: [team({ id: 'ghost', reportsTo: 'phantom' })],
      displaySettings: { a: { teamId: 'ghost' } },
      mainAgentId: 'main',
    })
    // Should still render under main, not crash
    expect(edges.find((e) => e.source === 'main' && e.target === 'section-ghost')).toBeDefined()
  })
})

describe('buildGraph — non-main team leader (sub-org)', () => {
  it('renders chef as a row 2 leader when a team reports to chef', () => {
    const agents = [agent('main'), agent('chef'), agent('a')]
    const displaySettings: AgentDisplaySettingsMap = {
      a: { teamId: 'crew' },
    }
    const teams = [team({ id: 'crew', reportsTo: 'chef' })]

    const { nodes, edges } = buildGraph({
      agents,
      teams,
      displaySettings,
      mainAgentId: 'main',
    })

    // Chef appears as an agent card (row 2 leader)
    expect(countAgentCards(nodes, 'chef')).toBe(1)
    // Chef connects back up to main
    expect(edges.find((e) => e.source === 'main' && e.target === 'chef')).toBeDefined()
    // Crew section is attached to chef
    expect(edges.find((e) => e.source === 'chef' && e.target === 'section-crew')).toBeDefined()
    // Member a wired from crew section
    expect(edges.find((e) => e.source === 'section-crew' && e.target === 'a')).toBeDefined()
  })
})

describe('buildGraph — missing main agent', () => {
  it('renders founder only when mainAgentId is null', () => {
    const { nodes } = buildGraph({
      agents: [agent('a'), agent('b')],
      teams: [],
      displaySettings: {},
      mainAgentId: null,
    })
    expect(nodes.find((n) => n.id === 'mark')).toBeDefined()
    // No main card — there is no main agent
    expect(countAgentCards(nodes, 'a')).toBe(0)
    expect(countAgentCards(nodes, 'b')).toBe(0)
  })

  it('renders founder only when mainAgentId refers to an agent not in the roster', () => {
    const { nodes } = buildGraph({
      agents: [agent('a')],
      teams: [],
      displaySettings: {},
      mainAgentId: 'ghost',
    })
    expect(nodes.find((n) => n.id === 'mark')).toBeDefined()
    expect(countAgentCards(nodes, 'ghost')).toBe(0)
    expect(countAgentCards(nodes, 'a')).toBe(0)
  })
})

describe('buildGraph — no duplicate main card', () => {
  it('places main exactly once when roster is [main] only', () => {
    const { nodes } = buildGraph({
      agents: [agent('main')],
      teams: [],
      displaySettings: {},
      mainAgentId: 'main',
    })
    expect(countAgentCards(nodes, 'main')).toBe(1)

    // No synthetic section, no unassigned bucket
    expect(nodes.find((n) => n.id === 'section-all')).toBeUndefined()
    expect(nodes.find((n) => n.id === 'section-unassigned')).toBeUndefined()
  })
})

describe('buildGraph — unassigned bucket', () => {
  it('puts agents not in any team into the unassigned bucket (when teams exist)', () => {
    const agents = [agent('main'), agent('a'), agent('b')]
    const teams = [team({ id: 't1', reportsTo: null as unknown as string })]
    const displaySettings: AgentDisplaySettingsMap = {
      a: { teamId: 't1' },
    }

    const { nodes, edges } = buildGraph({
      agents,
      teams,
      displaySettings,
      mainAgentId: 'main',
    })

    // t1 renders under main
    expect(edges.find((e) => e.source === 'main' && e.target === 'section-t1')).toBeDefined()
    // a is in the team
    expect(edges.find((e) => e.source === 'section-t1' && e.target === 'a')).toBeDefined()
    // b is unassigned
    expect(nodes.find((n) => n.id === 'section-unassigned')).toBeDefined()
    expect(edges.find((e) => e.source === 'section-unassigned' && e.target === 'b')).toBeDefined()
    // main is NOT in unassigned
    expect(edges.find((e) => e.source === 'section-unassigned' && e.target === 'main')).toBeUndefined()
  })

  it('does not duplicate main into unassigned when teams exist and main is the root', () => {
    const agents = [agent('main'), agent('a')]
    const teams = [team({ id: 't1', reportsTo: null as unknown as string })]
    const displaySettings: AgentDisplaySettingsMap = { a: { teamId: 't1' } }

    const { nodes } = buildGraph({
      agents,
      teams,
      displaySettings,
      mainAgentId: 'main',
    })
    expect(countAgentCards(nodes, 'main')).toBe(1)
  })
})

describe('buildGraph — determinism', () => {
  it('produces identical output for identical input', () => {
    const input = {
      agents: [agent('main'), agent('a'), agent('b')],
      teams: [team({ id: 't1', reportsTo: null as unknown as string, order: 0 })],
      displaySettings: { a: { teamId: 't1' }, b: { teamId: 't1' } } as AgentDisplaySettingsMap,
      mainAgentId: 'main' as string | null,
    }
    const a = buildGraph(input)
    const b = buildGraph(input)
    expect(getNodeIds(a.nodes)).toEqual(getNodeIds(b.nodes))
    expect(a.edges.map((e) => e.id)).toEqual(b.edges.map((e) => e.id))
  })
})
