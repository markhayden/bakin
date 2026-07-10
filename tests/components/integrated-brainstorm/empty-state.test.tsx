// @vitest-environment jsdom
import { describe, it, expect, mock } from 'bun:test'
import { render, screen } from '@testing-library/react'
import '../../rtl-settle'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-ib-empty-${Date.now()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'pixel',
  tryGetMainAgentId: () => 'pixel',
  getMainAgentName: () => 'Pixel',
}))

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))

const MOCK_AGENTS = [{ id: 'pixel', name: 'Pixel', headshot: undefined }]
mock.module('@bakin/team/hooks/use-agent-store', () => ({
  useAgentList: () => MOCK_AGENTS,
  useAgentIds: () => MOCK_AGENTS.map((a) => a.id),
  useAgent: (id: string) => MOCK_AGENTS.find((a) => a.id === id),
  useAgentColor: () => '#5e6ad2',
  useAgentStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ agentMap: Object.fromEntries(MOCK_AGENTS.map((a) => [a.id, a])), agents: MOCK_AGENTS, displaySettings: {} }),
}))

import { IntegratedBrainstorm } from '@/components/integrated-brainstorm'
import type { BrainstormMessage } from '@/components/integrated-brainstorm'

const baseProps = {
  messages: [] as BrainstormMessage[],
  onMessagesChange: () => {},
  onSend: async () => ({ content: '' }),
  agentId: 'pixel',
}

describe('IntegratedBrainstorm — empty state', () => {
  it('renders default empty state with agent name', () => {
    render(<IntegratedBrainstorm {...baseProps} />)
    expect(screen.getByText(/Brainstorm with Pixel/)).toBeDefined()
  })

  it('renders the agent avatar in the default empty state', () => {
    const { container } = render(<IntegratedBrainstorm {...baseProps} />)
    // Avatar renders an initial letter in the fallback span when no headshot.
    const initial = container.querySelector('span.font-medium')
    expect(initial).toBeDefined()
  })

  it('falls back to agentId when the agent is not in the store', () => {
    render(<IntegratedBrainstorm {...baseProps} agentId="unknown" />)
    expect(screen.getByText(/Brainstorm with unknown/)).toBeDefined()
  })

  it('uses custom emptyState prop when provided', () => {
    render(
      <IntegratedBrainstorm
        {...baseProps}
        emptyState={<div data-testid="custom-empty">custom here</div>}
      />,
    )
    expect(screen.getByTestId('custom-empty')).toBeDefined()
    expect(screen.queryByText(/Brainstorm with/)).toBeNull()
  })

  it('hides empty state once messages exist', () => {
    const messages: BrainstormMessage[] = [{ id: 'u1', role: 'user', content: 'hey' }]
    render(<IntegratedBrainstorm {...baseProps} messages={messages} />)
    expect(screen.queryByText(/Brainstorm with Pixel/)).toBeNull()
  })

  it('hides empty state when collapsed', () => {
    render(<IntegratedBrainstorm {...baseProps} defaultOpen={false} />)
    expect(screen.queryByText(/Brainstorm with Pixel/)).toBeNull()
  })
})
