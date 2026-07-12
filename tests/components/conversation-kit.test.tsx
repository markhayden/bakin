// @vitest-environment jsdom
/**
 * Conversation kit primitives (T3.1) — AgentTurn (avatar ALWAYS present,
 * including the thinking state), UserMessage, Conversation (day separators,
 * hover timestamps), ThinkingIndicator, ConversationEmptyState, and the
 * basic activity rows (collapse/drawer interaction lands in T3.2).
 */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-conversation-kit-${Date.now()}`)
const contentDirMock = () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir, db: join(testDir, 'bakin.db') }),
})
mock.module('@/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

import { cleanup, fireEvent, render } from '@testing-library/react'
import '../rtl-settle'

import {
  AgentTurn,
  Conversation,
  ConversationEmptyState,
  ThinkingIndicator,
  UserMessage,
  type ConversationTurn,
} from '@makinbakin/sdk/components'

const agentTurn = (over: Partial<Extract<ConversationTurn, { kind: 'agent' }>> = {}): Extract<ConversationTurn, { kind: 'agent' }> => ({
  kind: 'agent',
  key: 'agent-0',
  ts: '2026-07-11T10:00:05.000Z',
  items: [],
  status: 'complete',
  ...over,
})

const userTurn = (over: Partial<Extract<ConversationTurn, { kind: 'user' }>> = {}): Extract<ConversationTurn, { kind: 'user' }> => ({
  kind: 'user',
  key: 'user-0',
  ts: '2026-07-11T10:00:00.000Z',
  content: 'hello there',
  ...over,
})

describe('AgentTurn', () => {
  it('always shows the avatar — including the streaming/thinking state with no items', () => {
    const { container } = render(<AgentTurn turn={agentTurn({ status: 'streaming', statusLabel: 'thinking' })} agentId="main" />)
    expect(container.querySelector('[data-conv-avatar]')).not.toBeNull()
    expect(container.textContent).toContain('thinking')
  })

  it('renders text items through markdown and activity items as tool rows, in order', () => {
    const { container } = render(
      <AgentTurn
        agentId="main"
        turn={agentTurn({
          items: [
            { type: 'activity', calls: [{ key: 'c1', callId: 'c1', toolName: 'web_search', status: 'completed', summary: 'site:reddit.com', durationMs: 1200 }] },
            { type: 'text', format: 'markdown', content: '**found** it' },
          ],
        })}
      />,
    )
    // collapsed header reads as human activity; expanding reveals the call
    expect(container.textContent).toContain('Searched the web')
    fireEvent.click(container.querySelector('button[data-conv-activity-header]')!)
    expect(container.textContent).toContain('web_search')
    expect(container.textContent).toContain('site:reddit.com')
    expect(container.querySelector('strong')?.textContent).toBe('found')
    // activity renders before text (source order preserved)
    const activity = container.querySelector('[data-conv-activity]')
    const text = container.querySelector('strong')
    expect(activity).not.toBeNull()
    expect(activity!.compareDocumentPosition(text!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('bare-JSON replies render as a highlighted code block, not prose', () => {
    const { container } = render(
      <AgentTurn
        agentId="enrich"
        turn={agentTurn({
          items: [
            { type: 'text', format: 'markdown', content: '{"error":"no_attached_image","message":"I can\'t see an attached image."}' },
          ],
        })}
      />,
    )
    const code = container.querySelector('pre code')
    expect(code).not.toBeNull()
    expect(code!.className).toContain('hljs')
    // pretty-printed, not the raw one-liner
    expect(code!.textContent).toContain('"error": "no_attached_image"')
  })

  it('error turns render the message, kind, and a Try again action', () => {
    const retried: string[] = []
    const { container, getByText } = render(
      <AgentTurn
        agentId="main"
        turn={agentTurn({
          status: 'error',
          items: [{ type: 'error', message: 'session died', errorKind: 'session_died' }],
        })}
        onRetry={() => retried.push('yes')}
      />,
    )
    expect(container.textContent).toContain('session died')
    expect(container.textContent).toContain('session_died')
    fireEvent.click(getByText('Try again'))
    expect(retried).toEqual(['yes'])
  })

  it('aborted turns render a stopped notice; no Try again without onRetry', () => {
    const { container } = render(
      <AgentTurn agentId="main" turn={agentTurn({ status: 'aborted', items: [{ type: 'text', format: 'markdown', content: 'partial' }] })} />,
    )
    expect(container.textContent).toContain('Stopped')
    expect(container.textContent).not.toContain('Try again')
  })

  it('copy action writes the concatenated text items to the clipboard', () => {
    const writes: string[] = []
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      value: { writeText: (t: string) => (writes.push(t), Promise.resolve()) },
      configurable: true,
    })
    const { container } = render(
      <AgentTurn
        agentId="main"
        turn={agentTurn({
          items: [
            { type: 'text', format: 'markdown', content: 'part one' },
            { type: 'activity', calls: [{ key: 'c', toolName: 'bash', status: 'completed' }] },
            { type: 'text', format: 'markdown', content: 'part two' },
          ],
        })}
      />,
    )
    const btn = container.querySelector('button[data-conv-copy]')
    expect(btn).not.toBeNull()
    fireEvent.click(btn!)
    expect(writes).toEqual(['part one\n\npart two'])
  })
})

describe('UserMessage', () => {
  it('renders content and attachment thumbnails', () => {
    const { container } = render(
      <UserMessage
        turn={userTurn({
          attachments: [{ name: 'shot.png', mimeType: 'image/png', url: '/api/plugins/chat/x/attachments/shot.png' }],
        })}
      />,
    )
    expect(container.textContent).toContain('hello there')
    const img = container.querySelector('img')
    expect(img?.getAttribute('src')).toBe('/api/plugins/chat/x/attachments/shot.png')
  })
})

describe('Conversation', () => {
  it('renders turns with a day separator between different days and hover timestamps', () => {
    const { container } = render(
      <Conversation
        agentId="main"
        turns={[
          userTurn({ key: 'u1', ts: '2026-07-10T09:00:00.000Z' }),
          agentTurn({ key: 'a1', ts: '2026-07-10T09:00:05.000Z', items: [{ type: 'text', format: 'markdown', content: 'yesterday reply' }] }),
          userTurn({ key: 'u2', ts: '2026-07-11T10:00:00.000Z', content: 'today question' }),
        ]}
      />,
    )
    const separators = container.querySelectorAll('[data-conv-day]')
    expect(separators.length).toBe(2)
    // hover timestamp carries the absolute time as title
    const stamped = container.querySelector('time')
    expect(stamped?.getAttribute('title')).toBeTruthy()
  })

  it('renders the empty state node when there are no turns', () => {
    const { container } = render(
      <Conversation agentId="main" turns={[]} emptyState={<ConversationEmptyState title="Chat with Main" description="Ask anything." />} />,
    )
    expect(container.textContent).toContain('Chat with Main')
    expect(container.textContent).toContain('Ask anything.')
  })
})

describe('ThinkingIndicator', () => {
  it('renders the status label with the avatar', () => {
    const { container } = render(<ThinkingIndicator agentId="main" label="brewing" />)
    expect(container.querySelector('[data-conv-avatar]')).not.toBeNull()
    expect(container.textContent).toContain('brewing')
    cleanup()
  })
})

describe('ConversationEmptyState', () => {
  it('fires the suggestion callback', () => {
    const picked: string[] = []
    const { getByText } = render(
      <ConversationEmptyState
        title="Chat with Main"
        suggestions={['Summarize my week', 'What needs attention?']}
        onSuggestion={(s) => picked.push(s)}
      />,
    )
    fireEvent.click(getByText('What needs attention?'))
    expect(picked).toEqual(['What needs attention?'])
    cleanup()
  })
})
