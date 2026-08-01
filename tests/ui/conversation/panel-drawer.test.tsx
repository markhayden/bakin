// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'bun:test'
import { fireEvent, render } from '@testing-library/react'

import {
  ConversationPanel,
  ToolCallDrawer,
  type ConversationMessage,
  type ConversationToolCall,
} from '@makinbakin/sdk/conversation'
import '../../rtl-settle'

const messages: ConversationMessage[] = [
  { kind: 'user', ts: '2026-07-20T12:00:00.000Z', content: 'Inspect the release.' },
  {
    kind: 'assistant',
    ts: '2026-07-20T12:00:02.000Z',
    turnId: 'turn-1',
    agentId: 'release',
    content: 'The release is ready.',
  },
]

const toolCall: ConversationToolCall = {
  key: 'call-1',
  callId: 'call-1',
  toolName: 'web_search',
  status: 'completed',
  summary: 'Checked release references',
  inputPreview: '{"query":"release readiness"}',
  outputPreview: '{"matches":3}',
  durationMs: 1250,
  metadata: { truncated: true, source: 'runtime' },
}

beforeEach(() => {
  localStorage.clear()
})

describe('focused tool call drawer', () => {
  it('renders exact, copyable details and an honest truncation warning', () => {
    const changes: boolean[] = []
    const { baseElement, getByRole } = render(
      <ToolCallDrawer call={toolCall} open onOpenChange={(open) => changes.push(open)} />,
    )

    const text = baseElement.textContent ?? ''
    expect(getByRole('dialog')).not.toBeNull()
    expect(text).toContain('web_search')
    expect(text).toContain('completed')
    expect(text).toContain('1.3s')
    expect(text).toContain('call-1')
    expect(text).toContain('release readiness')
    expect(text).toContain('"matches": 3')
    expect(text).toContain('Captured output was truncated')
    expect(getByRole('button', { name: 'Copy input' })).not.toBeNull()

    fireEvent.click(getByRole('button', { name: 'Close panel' }))
    expect(changes).toContain(false)
  })
})

describe('focused conversation panel', () => {
  it('supports a top-divider workspace treatment without an outer frame', () => {
    const { container } = render(
      <ConversationPanel
        messages={messages}
        onSend={() => {}}
        storageKey="top-divider"
        chrome="top-divider"
        showHeader={false}
      />,
    )

    const panel = container.querySelector('[data-conv-panel]')
    expect(panel?.getAttribute('data-chrome')).toBe('top-divider')
    expect(panel?.className).toContain('border-t')
    expect(panel?.className).not.toContain('rounded-bakin-overlay')
    expect(panel?.className).not.toContain(' border ')
  })

  it('fills an explicit host and can omit duplicate chrome', () => {
    const { container } = render(
      <ConversationPanel
        messages={messages}
        agent={{ id: 'release', name: 'Release agent' }}
        onSend={() => {}}
        storageKey="embedded"
        fitParent
        showHeader={false}
      />,
    )

    expect(container.querySelector('[data-conv-panel-header]')).toBeNull()
    expect(container.querySelector('[data-conv-panel]')?.className).toContain('h-full')
    expect(container.querySelector('[data-conv-timeline]')?.getAttribute('data-mode')).toBe('contained')
    expect(container.querySelector('textarea')).not.toBeNull()
  })

  it('can preserve page scroll by opting out of composer autofocus', () => {
    const { container, unmount } = render(
      <ConversationPanel
        messages={messages}
        onSend={() => {}}
        storageKey="embedded-no-focus"
        autoFocus={false}
      />,
    )

    const textarea = container.querySelector('textarea')
    expect(textarea).not.toBeNull()
    expect(document.activeElement).not.toBe(textarea)
    unmount()
  })

  it('owns presentation-ready identity and accepts a consumer-owned agent control', () => {
    const { container, getByRole, getByText } = render(
      <ConversationPanel
        messages={messages}
        agent={{ id: 'release', name: 'Release agent' }}
        agentControl={<button type="button">Choose agent</button>}
        onSend={() => {}}
        storageKey="identity"
        title="Release review"
      />,
    )

    expect(container.querySelector('[data-conv-panel-header]')?.textContent).toContain('Release review')
    expect(getByRole('article', { name: 'Release agent reply' })).not.toBeNull()
    expect(getByText('Choose agent')).not.toBeNull()
  })

  it('always explains read-only state and never renders an inert composer', () => {
    const defaultNotice = render(
      <ConversationPanel messages={messages} onSend={() => {}} storageKey="readonly-default" readOnly />,
    )
    expect(defaultNotice.container.querySelector('textarea')).toBeNull()
    expect(defaultNotice.container.querySelector('[data-conv-readonly]')?.textContent).toContain(
      'This conversation is read-only.',
    )

    defaultNotice.unmount()
    const customNotice = render(
      <ConversationPanel
        messages={messages}
        onSend={() => {}}
        storageKey="readonly-custom"
        readOnly
        readOnlyNotice="Archived session"
      />,
    )
    expect(customNotice.container.querySelector('[data-conv-readonly]')?.textContent).toContain('Archived session')
  })

  it('folds structural live chunks and opens exact tool detail from the timeline', () => {
    const { baseElement, container } = render(
      <ConversationPanel
        messages={[]}
        liveChunks={[
          { type: 'text', content: 'Checking.' },
          { type: 'tool', data: { ...toolCall, phase: 'result' } },
        ]}
        streaming
        agent={{ id: 'release', name: 'Release agent' }}
        onSend={() => {}}
        storageKey="live"
      />,
    )

    expect(container.textContent).toContain('Checking.')
    fireEvent.click(container.querySelector('button[data-conv-activity-header]')!)
    fireEvent.click(container.querySelector('button[data-conv-call]')!)
    expect(baseElement.querySelector('[role="dialog"]')?.textContent).toContain('web_search')
  })

  it('persists keyboard panel resizing under the canonical preference key', () => {
    const { getByRole } = render(
      <ConversationPanel
        messages={[]}
        onSend={() => {}}
        storageKey="resizable"
        defaultHeight={420}
        minHeight={240}
        maxHeight={800}
      />,
    )
    const handle = getByRole('separator', { name: 'Resize conversation panel' })
    expect(handle.getAttribute('aria-valuenow')).toBe('420')
    fireEvent.keyDown(handle, { key: 'ArrowUp' })
    expect(handle.getAttribute('aria-valuenow')).toBe('436')
    expect(localStorage.getItem('bakin-vresize:conv-panel:resizable')).toBe('436')
  })
})
