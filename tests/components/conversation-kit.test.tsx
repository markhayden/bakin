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

describe('AgentTurn billed-first cost explainer (#737)', () => {
  it('a tool turn shows the two-line bill story: billed · cached% · ~requests · $ · model, then in/out', () => {
    const { container } = render(
      <AgentTurn
        agentId="main"
        turn={agentTurn({
          items: [
            {
              type: 'activity',
              calls: [
                { key: 'c1', callId: 'c1', toolName: 'exec', status: 'completed' },
                { key: 'c2', callId: 'c2', toolName: 'exec', status: 'completed' },
              ],
            },
            { type: 'text', format: 'markdown', content: 'done' },
          ],
        })}
        usage={{
          totalTokens: 133_839,
          cacheReadTokens: 103_936,
          inputTokens: 29_187,
          outputTokens: 716,
          costUsd: 0.04,
          model: 'openai-codex/gpt-5.5',
          lane: 'metered',
        }}
      />,
    )
    const footer = container.querySelector('[data-conv-usage]')!
    expect(footer.textContent).toContain('133.8k billed')
    expect(footer.textContent).toContain('78% cached')
    expect(footer.textContent).toContain('~3 requests') // 2 tool calls + 1
    expect(footer.textContent).toContain('$0.04')
    expect(footer.textContent).toContain('gpt-5.5')
    expect(footer.textContent).toContain('29.2k in / 716 out')
    cleanup()
  })

  it('a no-tool turn collapses to ONE billed line (no ~requests, no in/out line)', () => {
    const { container } = render(
      <AgentTurn
        agentId="main"
        turn={agentTurn({ items: [{ type: 'text', format: 'markdown', content: 'simple reply' }] })}
        usage={{ totalTokens: 45_476, cacheReadTokens: 43_520, inputTokens: 1_778, outputTokens: 178, costUsd: 0.004, model: 'openai-codex/gpt-5.5', lane: 'metered' }}
      />,
    )
    const footer = container.querySelector('[data-conv-usage]')!
    expect(footer.textContent).toContain('45.5k billed')
    expect(footer.textContent).toContain('96% cached')
    expect(footer.textContent).toContain('<$0.01')
    expect(footer.textContent).not.toContain('requests')
    expect(footer.textContent).not.toContain(' in')
    cleanup()
  })

  it('in+out fallback bills without a fabricated cached share; a lone-out legacy row keeps the old line', () => {
    const fallback = render(
      <AgentTurn
        agentId="main"
        turn={agentTurn()}
        usage={{ inputTokens: 14_200, outputTokens: 890, costUsd: 0.03, model: 'sonnet-5', lane: 'metered' }}
      />,
    )
    const footer = fallback.container.querySelector('[data-conv-usage]')!
    expect(footer.textContent).toContain('15.1k billed')
    expect(footer.textContent).not.toContain('cached')
    cleanup()

    // No billed total computable (output only) → the legacy parts line.
    const legacy = render(
      <AgentTurn agentId="main" turn={agentTurn()} usage={{ outputTokens: 890, model: 'sonnet-5' }} />,
    )
    const legacyFooter = legacy.container.querySelector('[data-conv-usage]')!
    expect(legacyFooter.textContent).toContain('890 out')
    expect(legacyFooter.textContent).not.toContain('billed')
    cleanup()
  })
})

describe('AgentTurn usage footer (#733, billed-first since #737)', () => {
  it('metered lane shows billed total + $ + model tail; sub-cent costs floor at <$0.01', () => {
    const { container } = render(
      <AgentTurn
        agentId="main"
        turn={agentTurn({ items: [{ type: 'text', format: 'markdown', content: 'done' }] })}
        usage={{ inputTokens: 14_200, outputTokens: 890, costUsd: 0.03, model: 'anthropic/claude-sonnet-5', lane: 'metered' }}
      />,
    )
    const footer = container.querySelector('[data-conv-usage]')
    expect(footer).not.toBeNull()
    expect(footer!.textContent).toContain('15.1k billed') // in+out fallback
    expect(footer!.textContent).toContain('$0.03')
    expect(footer!.textContent).toContain('claude-sonnet-5')
    cleanup()

    const subCent = render(
      <AgentTurn agentId="main" turn={agentTurn()} usage={{ inputTokens: 100, outputTokens: 5, costUsd: 0.0004, lane: 'metered' }} />,
    )
    expect(subCent.container.querySelector('[data-conv-usage]')!.textContent).toContain('<$0.01')
    cleanup()
  })

  it('subscription lane shows tokens only — never dollars; empty usage renders no footer', () => {
    const { container } = render(
      <AgentTurn
        agentId="main"
        turn={agentTurn()}
        usage={{ inputTokens: 22_100, outputTokens: 1_200, model: 'pi/pi-local', lane: 'subscription' }}
      />,
    )
    const footer = container.querySelector('[data-conv-usage]')!
    expect(footer.textContent).toContain('23.3k billed')
    expect(footer.textContent).not.toContain('$')
    cleanup()

    const empty = render(<AgentTurn agentId="main" turn={agentTurn()} usage={{}} />)
    expect(empty.container.querySelector('[data-conv-usage]')).toBeNull()
    cleanup()

    const none = render(<AgentTurn agentId="main" turn={agentTurn()} />)
    expect(none.container.querySelector('[data-conv-usage]')).toBeNull()
    cleanup()
  })

  it('a streaming turn never shows a RECORDED usage footer — usage exists only at settle', () => {
    const { container } = render(
      <AgentTurn
        agentId="main"
        turn={agentTurn({ status: 'streaming', items: [{ type: 'text', format: 'markdown', content: 'typing…' }] })}
        usage={{ inputTokens: 1_000, outputTokens: 50, costUsd: 0.01, lane: 'metered' }}
      />,
    )
    expect(container.querySelector('[data-conv-usage]')).toBeNull()
    cleanup()
  })

  it('a streaming turn shows the ~-labeled live output estimate; settled turns ignore it', () => {
    const live = render(
      <AgentTurn
        agentId="main"
        turn={agentTurn({ status: 'streaming', items: [{ type: 'text', format: 'markdown', content: 'typing…' }] })}
        liveOutEstimate={320}
      />,
    )
    const el = live.container.querySelector('[data-conv-usage-live]')
    expect(el).not.toBeNull()
    expect(el!.textContent).toContain('~320 out…')
    cleanup()

    const settled = render(
      <AgentTurn agentId="main" turn={agentTurn()} usage={{ inputTokens: 100, outputTokens: 10 }} liveOutEstimate={320} />,
    )
    expect(settled.container.querySelector('[data-conv-usage-live]')).toBeNull()
    expect(settled.container.querySelector('[data-conv-usage]')).not.toBeNull()
    cleanup()
  })

  it('Conversation hands liveOutEstimate only to the streaming turn', () => {
    const { container } = render(
      <Conversation
        agentId="main"
        turns={[
          agentTurn({ key: 'done-turn', turnId: 'done-turn', items: [{ type: 'text', format: 'markdown', content: 'settled' }] }),
          agentTurn({ key: 'live-turn', status: 'streaming', items: [{ type: 'text', format: 'markdown', content: 'going…' }] }),
        ]}
        liveOutEstimate={128}
      />,
    )
    const liveEls = container.querySelectorAll('[data-conv-usage-live]')
    expect(liveEls.length).toBe(1)
    expect(liveEls[0].textContent).toContain('~128 out…')
  })

  it('Conversation plumbs turnUsage to agent turns by turnId', () => {
    const { container } = render(
      <Conversation
        agentId="main"
        turns={[
          userTurn(),
          agentTurn({ key: 'turn-a', turnId: 'turn-a', items: [{ type: 'text', format: 'markdown', content: 'reply' }] }),
        ]}
        turnUsage={{ 'turn-a': { inputTokens: 5_000, outputTokens: 300, costUsd: 0.02, lane: 'metered' } }}
      />,
    )
    expect(container.querySelector('[data-conv-usage]')!.textContent).toContain('5.3k billed')
  })
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

  it('bare-JSON replies render human-first with the raw JSON one disclosure away', () => {
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
    const card = container.querySelector('[data-conv-json]')
    expect(card).not.toBeNull()
    // humanized labels, not raw braces, are the primary view
    expect(card!.textContent).toContain('The agent reported a problem')
    expect(card!.textContent).toContain('Message:')
    expect(card!.textContent).toContain("I can't see an attached image.")
    // the raw pretty-printed JSON lives behind a disclosure, highlighted
    const details = card!.querySelector('details')
    expect(details).not.toBeNull()
    expect(details!.textContent).toContain('Raw JSON')
    expect(details!.querySelector('pre code')?.className ?? '').toContain('hljs')
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
