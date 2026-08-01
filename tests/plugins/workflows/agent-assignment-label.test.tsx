// @vitest-environment jsdom
/**
 * AgentAssignmentLabel (#611): canvas-node assignment chip must render team
 * targets distinctly — a `team:<id>` token shows the team, never a broken
 * agent lookup; `$assigned` and concrete-agent rendering are unchanged.
 */
import { describe, expect, it, mock } from 'bun:test'
import { render, screen } from '@testing-library/react'
import '../../rtl-settle'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-agent-assignment-label-${Date.now()}`)
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
mock.module('../../../src/core/task-store', () => ({}))
mock.module('@/core/task-store', () => ({}))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

const agents = new Map([[
  'chef', { id: 'chef', name: 'Chef' },
]])
mock.module('@makinbakin/sdk/hooks', () => ({
  useAgent: (id: string) => (id ? agents.get(id) : undefined),
}))
mock.module('../../../plugins/workflows/components/workflow-agent-identity', () => ({
  WorkflowAgentAvatar: ({ agentId }: { agentId: string }) => <span data-testid="avatar">{agentId}</span>,
}))

import { AgentAssignmentLabel } from '../../../plugins/workflows/components/nodes/agent-assignment-label'

describe('AgentAssignmentLabel', () => {
  it('renders a team token as a distinct team chip', () => {
    render(<AgentAssignmentLabel agent="team:builders" />)
    expect(screen.getByText('Team · builders')).toBeDefined()
    expect(screen.queryByTestId('avatar')).toBeNull()
  })

  it('renders $assigned as before', () => {
    render(<AgentAssignmentLabel agent="$assigned" />)
    expect(screen.getByText('Assigned agent')).toBeDefined()
  })

  it('renders a concrete agent with its avatar and name', () => {
    render(<AgentAssignmentLabel agent="chef" />)
    expect(screen.getByText('Chef')).toBeDefined()
    expect(screen.getByTestId('avatar')).toBeDefined()
  })

  it('renders the empty state when no agent is set', () => {
    render(<AgentAssignmentLabel />)
    expect(screen.getByText('No agent selected')).toBeDefined()
  })
})
