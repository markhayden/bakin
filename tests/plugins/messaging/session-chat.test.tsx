// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { tmpdir } from 'os'
import { join } from 'path'

const testDir = join(tmpdir(), `bakin-test-session-chat-${Date.now()}`)

mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../../src/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))

// Mock UI components
mock.module('@/components/ui/button', () => ({
  Button: ({ children, disabled, ...props }: { children: React.ReactNode; disabled?: boolean; [k: string]: unknown }) => (
    <button disabled={disabled} {...props}>{children}</button>
  ),
}))

mock.module('@/components/ui/textarea', () => ({
  Textarea: (props: Record<string, unknown>) => <textarea data-testid="chat-input" {...props} />,
}))

mock.module('@/components/ui/badge', () => ({
  Badge: ({ children, ...props }: { children: React.ReactNode; [k: string]: unknown }) => (
    <span data-testid="badge" {...props}>{children}</span>
  ),
}))

mock.module('@/components/agent-avatar', () => ({
  AgentAvatar: ({ agentId }: { agentId: string }) => <span data-testid={`avatar-${agentId}`} />,
}))

const MOCK_AGENTS = [
  { id: 'basil', name: 'Basil', emoji: '🥗', role: '', headshot: '' },
  { id: 'scout', name: 'Scout', emoji: '🏕️', role: '', headshot: '' },
  { id: 'nemo', name: 'Nemo', emoji: '🏊', role: '', headshot: '' },
  { id: 'zen', name: 'Zen', emoji: '🧘', role: '', headshot: '' },
]
mock.module('@bakin/team/hooks/use-agent-store', () => ({
  useAgentList: () => MOCK_AGENTS,
  useAgentIds: () => MOCK_AGENTS.map(a => a.id),
  useAgent: (id: string) => MOCK_AGENTS.find(a => a.id === id),
  useAgentColor: () => '#a1a1aa',
  useAgentStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ agents: MOCK_AGENTS, agentIds: MOCK_AGENTS.map(a => a.id) }),
}))

import { SessionChat } from '../../../plugins/messaging/components/session-chat'
import type { SessionMessage, ProposedItem } from '../../../plugins/messaging/types'

afterEach(() => cleanup())

describe('SessionChat', () => {
  it('renders empty state with agent name', () => {
    render(<SessionChat sessionId="s1" agentId="basil" />)
    expect(screen.getByText('Plan with Basil')).toBeDefined()
    expect(screen.getByTestId('avatar-basil')).toBeDefined()
  })

  it('renders initial messages', () => {
    const messages: SessionMessage[] = [
      { id: 'm1', role: 'user', content: 'Plan next week', timestamp: '2026-04-07T00:00:00Z' },
      { id: 'm2', role: 'assistant', content: 'Here are some ideas!', timestamp: '2026-04-07T00:01:00Z' },
    ]

    render(<SessionChat sessionId="s1" agentId="scout" initialMessages={messages} />)
    expect(screen.getByText('Plan next week')).toBeDefined()
    expect(screen.getByText('Here are some ideas!')).toBeDefined()
  })

  it('shows read-only badge for completed sessions', () => {
    render(<SessionChat sessionId="s1" agentId="basil" isCompleted={true} />)
    expect(screen.getByText('Session completed — read-only')).toBeDefined()
    // Input should not be present
    expect(screen.queryByTestId('chat-input')).toBeNull()
  })

  it('shows input area for active sessions', () => {
    render(<SessionChat sessionId="s1" agentId="zen" />)
    const input = screen.getByLabelText(/Ask Zen/)
    expect(input).toBeDefined()
  })

  it('hides send button when no text entered (embedded-in-textarea pattern)', () => {
    render(<SessionChat sessionId="s1" agentId="nemo" />)
    expect(screen.queryByLabelText('Send')).toBeNull()
  })
})
