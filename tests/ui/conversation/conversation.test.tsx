// @vitest-environment jsdom
import { describe, expect, it } from 'bun:test'
import { fireEvent, render } from '@testing-library/react'

import {
  Conversation,
  ConversationEmptyState,
  type ConversationTurn,
} from '@makinbakin/sdk/conversation'
import '../../rtl-settle'

const turns: ConversationTurn[] = [
  {
    kind: 'user',
    key: 'user-1',
    ts: '2026-07-19T12:00:00.000Z',
    content: 'What changed?',
  },
  {
    kind: 'agent',
    key: 'agent-1',
    ts: '2026-07-19T12:01:00.000Z',
    agentId: 'release',
    status: 'complete',
    items: [{ type: 'text', format: 'markdown', content: 'The route contract changed.' }],
  },
  {
    kind: 'user',
    key: 'user-2',
    ts: '2026-07-20T12:00:00.000Z',
    content: 'Anything else?',
  },
]

describe('focused conversation timeline', () => {
  it('uses document scroll by default and resolves visible agent identity', () => {
    const { container, getByRole } = render(
      <Conversation
        turns={turns}
        resolveAgent={(agentId) => agentId === 'release' ? { id: agentId, name: 'Release agent' } : undefined}
      />,
    )

    expect(container.querySelector('[data-conv-timeline]')?.getAttribute('data-mode')).toBe('document')
    expect(container.querySelector('[data-conv-scroller]')?.className).not.toContain('overflow-y-auto')
    expect(getByRole('article', { name: 'Release agent reply' })).not.toBeNull()
    expect(container.querySelectorAll('[data-conv-day]')).toHaveLength(2)
    expect(
      container.querySelector('[data-conv-day] [aria-hidden="true"]')?.className,
    ).toContain('bg-bakin-border-subtle/60')
    const groups = container.querySelectorAll('[data-conv-turn-group]')
    expect(groups[1]?.className).not.toContain('pt-bakin-4')
    expect(groups[2]?.className).toContain('pt-bakin-4')
  })

  it('makes contained mode the only internally scrolling timeline', () => {
    const { container } = render(
      <Conversation turns={turns} mode="contained" agent={{ id: 'release', name: 'Release agent' }} />,
    )
    expect(container.querySelector('[data-conv-scroller]')?.className).toContain('overflow-y-auto')
  })

  it('does not reuse the fallback avatar for a differently identified turn', () => {
    const agentTurn: ConversationTurn = {
      kind: 'agent',
      key: 'agent-reviewer',
      ts: '2026-07-20T12:01:00.000Z',
      agentId: 'reviewer',
      status: 'complete',
      items: [{ type: 'text', format: 'plain', content: 'Reviewed.' }],
    }
    const { container, getByRole } = render(
      <Conversation
        turns={[agentTurn]}
        agent={{ id: 'primary', name: 'Primary agent', avatarUrl: '/primary.png' }}
      />,
    )

    expect(getByRole('article', { name: 'reviewer reply' })).not.toBeNull()
    expect(container.querySelector('img')).toBeNull()
  })

  it('renders an honest empty state in place of the timeline', () => {
    const picked: string[] = []
    const { getByRole, getByText } = render(
      <Conversation
        turns={[]}
        emptyState={(
          <ConversationEmptyState
            title="Start a release review"
            description="Ask about readiness."
            suggestions={['Check blocked routes']}
            onSuggestion={(suggestion) => picked.push(suggestion)}
          />
        )}
      />,
    )

    expect(getByText('Ask about readiness.')).not.toBeNull()
    fireEvent.click(getByRole('button', { name: 'Check blocked routes' }))
    expect(picked).toEqual(['Check blocked routes'])
  })

  it('does not render inert suggestion buttons without a handler', () => {
    const { queryByRole } = render(
      <ConversationEmptyState title="No messages" suggestions={['Inert suggestion']} />,
    )
    expect(queryByRole('button', { name: 'Inert suggestion' })).toBeNull()
  })
})
