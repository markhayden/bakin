// @vitest-environment jsdom
import { describe, expect, it } from 'bun:test'
import { act, fireEvent, render } from '@testing-library/react'

import {
  AgentTurn,
  ThinkingIndicator,
  UserMessage,
  type ConversationTurn,
} from '@makinbakin/sdk/conversation'
import '../../rtl-settle'

const agentTurn = (
  over: Partial<Extract<ConversationTurn, { kind: 'agent' }>> = {},
): Extract<ConversationTurn, { kind: 'agent' }> => ({
  kind: 'agent',
  key: 'agent-1',
  ts: '2026-07-20T12:00:00.000Z',
  items: [],
  status: 'complete',
  ...over,
})

const userTurn = (
  over: Partial<Extract<ConversationTurn, { kind: 'user' }>> = {},
): Extract<ConversationTurn, { kind: 'user' }> => ({
  kind: 'user',
  key: 'user-1',
  ts: '2026-07-20T11:59:00.000Z',
  content: 'Please check the release.',
  ...over,
})

describe('focused conversation turn rendering', () => {
  it('keeps agent identity visible while streaming without content', () => {
    const { container, getByText } = render(
      <AgentTurn
        agent={{ id: 'main', name: 'Main' }}
        turn={agentTurn({ status: 'streaming', statusLabel: 'checking routes' })}
      />,
    )

    expect(container.querySelector('[data-conv-avatar]')).not.toBeNull()
    expect(getByText('Main')).not.toBeNull()
    expect(getByText('checking routes…')).not.toBeNull()
    expect(container.querySelector('[aria-live="polite"]')).not.toBeNull()
  })

  it('renders ordered text, activity, and error evidence through public hooks', () => {
    const rendered: string[] = []
    const { container } = render(
      <AgentTurn
        agent={{ name: 'Release agent' }}
        turn={agentTurn({
          status: 'error',
          items: [
            { type: 'text', format: 'markdown', content: 'Found **two** issues.' },
            { type: 'activity', calls: [{ key: 'call-1', toolName: 'web_search', status: 'completed' }] },
            { type: 'error', message: 'Archive unavailable', errorKind: 'upstream_timeout' },
          ],
        })}
        renderText={(content, format) => {
          rendered.push(`${format}:${content}`)
          return <strong>{content}</strong>
        }}
      />,
    )

    expect(rendered).toEqual(['markdown:Found **two** issues.'])
    expect(container.textContent).toContain('Searched the web')
    expect(container.textContent).toContain('Archive unavailable')
    expect(container.textContent).toContain('upstream_timeout')
  })

  it('keeps retry and copy actions native and consumer owned', async () => {
    const retries: string[] = []
    const writes: string[] = []
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText: (value: string) => (writes.push(value), Promise.resolve()) },
      configurable: true,
    })
    const { getByRole } = render(
      <AgentTurn
        agent={{ name: 'Main' }}
        turn={agentTurn({
          status: 'error',
          items: [
            { type: 'text', format: 'plain', content: 'Partial result' },
            { type: 'text', format: 'markdown', content: 'Try again later.' },
          ],
        })}
        onRetry={() => retries.push('retry')}
      />,
    )

    await act(async () => {
      fireEvent.click(getByRole('button', { name: 'Copy reply' }))
      await Promise.resolve()
    })
    fireEvent.click(getByRole('button', { name: 'Try again' }))
    expect(writes).toEqual(['Partial result\n\nTry again later.'])
    expect(retries).toEqual(['retry'])
  })

  it('renders user image and file attachments without treating every file as an image', () => {
    const { container, getByRole } = render(
      <UserMessage
        turn={userTurn({
          attachments: [
            { name: 'release.png', mimeType: 'image/png', url: '/release.png' },
            { name: 'notes.pdf', mimeType: 'application/pdf', url: '/notes.pdf' },
          ],
        })}
      />,
    )

    expect(container.querySelector('img')?.getAttribute('alt')).toBe('release.png')
    expect(getByRole('link', { name: 'notes.pdf' }).getAttribute('href')).toBe('/notes.pdf')
    expect(getByRole('button', { name: 'Copy message' })).not.toBeNull()
    expect(container.querySelector('time')?.getAttribute('title')).toBeTruthy()
  })

  it('supports a standalone thinking indicator with consumer-owned avatar rendering', () => {
    const { container } = render(
      <ThinkingIndicator
        agent={{ id: 'custom', name: 'Custom agent' }}
        label="reviewing"
        renderAvatar={(agent) => <span data-custom-avatar="">{agent.name}</span>}
      />,
    )

    expect(container.querySelector('[data-custom-avatar]')?.textContent).toBe('Custom agent')
    expect(container.textContent).toContain('reviewing…')
  })
})
