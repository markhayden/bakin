// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

// Mock UI components
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, disabled, ...props }: { children: React.ReactNode; disabled?: boolean; [k: string]: unknown }) => (
    <button disabled={disabled} {...props}>{children}</button>
  ),
}))

vi.mock('@/components/ui/textarea', () => ({
  Textarea: (props: Record<string, unknown>) => <textarea data-testid="chat-input" {...props} />,
}))

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children, ...props }: { children: React.ReactNode; [k: string]: unknown }) => (
    <span data-testid="badge" {...props}>{children}</span>
  ),
}))

vi.mock('@/components/agent-avatar', () => ({
  AgentAvatar: ({ agentId }: { agentId: string }) => <span data-testid={`avatar-${agentId}`} />,
}))

vi.mock('lucide-react', () => ({
  Send: () => <span data-testid="send-icon" />,
  Loader2: () => <span data-testid="loader-icon" />,
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
    const input = screen.getByTestId('chat-input')
    expect(input).toBeDefined()
    expect(input.getAttribute('placeholder')).toContain('Zen')
  })

  it('disables input when no text entered', () => {
    render(<SessionChat sessionId="s1" agentId="nemo" />)
    const buttons = screen.getAllByRole('button')
    const sendButton = buttons.find(b => b.querySelector('[data-testid="send-icon"]'))
    expect(sendButton?.hasAttribute('disabled')).toBe(true)
  })
})
