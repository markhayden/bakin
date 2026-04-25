// @vitest-environment jsdom

/**
 * AgentCardNode badge wiring contract.
 *
 * The team grid renders a compact PackageStateBadge on agent cards only when
 * the package state is "attention-worthy" — unmanaged, drifted, or
 * update-available. Healthy states (managed, adopted) and missing data
 * leave the card unchanged.
 *
 * This test primes the Zustand store with a single agent and varies its
 * package state, asserting the badge presence/absence per the rule. We
 * render AgentCardNode directly (not the full ReactFlow grid) — the badge
 * logic lives entirely inside the node component.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync } from 'fs'

const testDir = join(tmpdir(), `bakin-test-agent-card-badge-${Date.now()}-${Math.random().toString(36).slice(2)}`)

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

// ReactFlow's <Handle> requires being inside a ReactFlowProvider when used
// from a component. We replace it with a stub so the node renders standalone.
mock.module('@xyflow/react', () => ({
  Handle: () => null,
  Position: { Top: 'top', Bottom: 'bottom' },
}))

import { useAgentStore } from '../../../plugins/team/hooks/use-agent-store'
import { AgentCardNode } from '../../../plugins/team/components/team-grid'
import type { AgentWithStatus, PackageStateRow } from '../../../plugins/team/types'

const AGENT: AgentWithStatus = {
  id: 'pixel',
  name: 'Pixel',
  emoji: '🎨',
  role: 'designer',
  headshot: 'data:image/png;base64,iVBORw0KGgo=', // 1x1 placeholder to silence empty-src warnings
  status: 'online',
  model: 'claude-opus-4-7',
  heartbeat: null,
  heartbeatAge: null,
}

function primeState(packageStates: Record<string, PackageStateRow> = {}) {
  useAgentStore.setState({
    agents: [], agentIds: [], agentMap: {}, agentsWithStatus: [],
    displaySettings: {}, teams: [], packageStates,
    mainAgentId: null, loaded: true,
  })
}

afterAll(() => {
  try { rmSync(testDir, { recursive: true, force: true }) } catch {}
})

afterEach(() => {
  cleanup()
})

describe('AgentCardNode — package state badge wiring', () => {
  beforeEach(() => primeState())

  function renderCard() {
    // NodeProps minimal stub — AgentCardNode only reads `data.agent`.
    // Cast to `any` (not `never`) so JSX spread is allowed; the runtime
    // surface AgentCardNode actually reads is just `data.agent`.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const props: any = { data: { agent: AGENT }, id: AGENT.id, type: 'agentCard' }
    return render(<AgentCardNode {...props} />)
  }

  it('shows the agent name', () => {
    renderCard()
    expect(screen.getByText('Pixel')).toBeDefined()
  })

  it('renders no package badge when state is undefined', () => {
    renderCard()
    expect(screen.queryByLabelText(/Package state:/)).toBeNull()
  })

  it('renders no badge for healthy state: managed', () => {
    primeState({ pixel: { agentId: 'pixel', state: 'managed' } })
    renderCard()
    expect(screen.queryByLabelText(/Package state:/)).toBeNull()
  })

  it('renders no badge for healthy state: adopted', () => {
    primeState({ pixel: { agentId: 'pixel', state: 'adopted' } })
    renderCard()
    expect(screen.queryByLabelText(/Package state:/)).toBeNull()
  })

  it('renders no badge for state: absent', () => {
    primeState({ pixel: { agentId: 'pixel', state: 'absent' } })
    renderCard()
    expect(screen.queryByLabelText(/Package state:/)).toBeNull()
  })

  it('renders attention badge for state: unmanaged', () => {
    primeState({ pixel: { agentId: 'pixel', state: 'unmanaged' } })
    renderCard()
    const badge = screen.getByLabelText(/Package state: unmanaged/)
    expect(badge).toBeDefined()
    expect(badge.getAttribute('data-state')).toBe('unmanaged')
  })

  it('renders attention badge for state: drifted', () => {
    primeState({ pixel: { agentId: 'pixel', state: 'drifted' } })
    renderCard()
    expect(screen.getByLabelText(/Package state: drifted/)).toBeDefined()
  })

  it('renders attention badge for state: update-available', () => {
    primeState({ pixel: { agentId: 'pixel', state: 'update-available' } })
    renderCard()
    expect(screen.getByLabelText(/Package state: update available/)).toBeDefined()
  })

  it('compact badge has no visible text label (compact mode dropped the label)', () => {
    primeState({ pixel: { agentId: 'pixel', state: 'unmanaged' } })
    renderCard()
    const badge = screen.getByLabelText(/Package state: unmanaged/)
    // The compact pill has no text content; the label is in aria-label only
    expect(badge.textContent).toBe('')
  })
})
