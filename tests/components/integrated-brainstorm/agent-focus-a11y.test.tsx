// @vitest-environment jsdom
import { describe, it, expect, mock } from 'bun:test'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-ib-a11y-${Date.now()}`)

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

const MOCK_AGENTS = [
  { id: 'pixel', name: 'Pixel', headshot: undefined },
  { id: 'basil', name: 'Basil', headshot: undefined },
]
mock.module('@bakin/team/hooks/use-agent-store', () => ({
  useAgentList: () => MOCK_AGENTS,
  useAgentIds: () => MOCK_AGENTS.map((a) => a.id),
  useAgent: (id: string) => MOCK_AGENTS.find((a) => a.id === id),
  useAgentColor: (id: string) => (id === 'basil' ? '#10b981' : '#5e6ad2'),
  useAgentStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      agentMap: Object.fromEntries(MOCK_AGENTS.map((a) => [a.id, a])),
      agents: MOCK_AGENTS,
      displaySettings: {
        pixel: { accentColor: '#5e6ad2' },
        basil: { accentColor: '#10b981' },
      },
    }),
}))

import { IntegratedBrainstorm } from '@/components/integrated-brainstorm'
import type { BrainstormMessage } from '@/components/integrated-brainstorm'
import { createFakeOnSend } from './fake-on-send'

function Harness(props: {
  fake: ReturnType<typeof createFakeOnSend>
  onAgentChange?: (id: string) => void
  agentId?: string
  defaultOpen?: boolean
  initialMessages?: BrainstormMessage[]
}) {
  const [messages, setMessages] = useState<BrainstormMessage[]>(props.initialMessages ?? [])
  return (
    <IntegratedBrainstorm
      messages={messages}
      onMessagesChange={setMessages}
      onSend={props.fake.onSend}
      agentId={props.agentId ?? 'pixel'}
      onAgentChange={props.onAgentChange}
      defaultOpen={props.defaultOpen}
    />
  )
}

describe('IntegratedBrainstorm — agent picker', () => {
  it('renders AgentSelect when onAgentChange is provided', () => {
    const fake = createFakeOnSend()
    render(<Harness fake={fake} onAgentChange={() => {}} />)
    // AgentSelect typically renders a combobox or button with agent name
    // We assert by checking there's an element referencing an agent name.
    expect(screen.getAllByText(/Pixel/).length).toBeGreaterThan(0)
  })

  it('does NOT render AgentSelect when onAgentChange is absent', () => {
    const fake = createFakeOnSend()
    const { container } = render(<Harness fake={fake} />)
    // No combobox / select in the input row.
    expect(container.querySelector('[role="combobox"]')).toBeNull()
  })
})

describe('IntegratedBrainstorm — focus', () => {
  it('focuses textarea when collapsed panel opens', async () => {
    const fake = createFakeOnSend()
    render(<Harness fake={fake} defaultOpen={false} />)
    const header = screen.getByRole('button', { name: /Brainstorm/ })
    act(() => {
      fireEvent.click(header)
    })
    await waitFor(() => {
      const ta = screen.getByLabelText(/Ask Pixel/) as HTMLTextAreaElement
      expect(document.activeElement).toBe(ta)
    })
  })

  it('does NOT auto-focus textarea on initial mount when defaultOpen=true', () => {
    const fake = createFakeOnSend()
    render(<Harness fake={fake} defaultOpen={true} />)
    // Initial focus stays on body — the page decides.
    expect(document.activeElement).not.toBe(screen.getByLabelText(/Ask Pixel/))
  })

  it('refocuses textarea after send resolves', async () => {
    const fake = createFakeOnSend()
    render(<Harness fake={fake} defaultOpen={true} />)
    const ta = screen.getByLabelText(/Ask Pixel/) as HTMLTextAreaElement
    ta.focus()
    act(() => {
      fireEvent.change(ta, { target: { value: 'hi' } })
      fireEvent.keyDown(ta, { key: 'Enter' })
    })
    await waitFor(() => expect(fake.isPending()).toBe(true))
    ta.blur()
    await act(async () => {
      fake.resolve('reply')
      // Let the state machine finally block flush.
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(document.activeElement).toBe(ta)
  }, 3000)

  it('refocuses textarea after send rejects', async () => {
    const fake = createFakeOnSend()
    render(<Harness fake={fake} defaultOpen={true} />)
    const ta = screen.getByLabelText(/Ask Pixel/) as HTMLTextAreaElement
    ta.focus()
    act(() => {
      fireEvent.change(ta, { target: { value: 'hi' } })
      fireEvent.keyDown(ta, { key: 'Enter' })
    })
    await waitFor(() => expect(fake.isPending()).toBe(true))
    ta.blur()
    await act(async () => {
      fake.reject(new Error('nope'))
      await new Promise((r) => setTimeout(r, 0))
    })
    expect(document.activeElement).toBe(ta)
  }, 3000)
})

describe('IntegratedBrainstorm — accessibility', () => {
  it('header has role=button, aria-expanded, aria-controls', () => {
    const fake = createFakeOnSend()
    render(<Harness fake={fake} />)
    const header = screen.getByRole('button', { name: /Brainstorm/ })
    expect(header.getAttribute('aria-expanded')).not.toBeNull()
    expect(header.getAttribute('aria-controls')).not.toBeNull()
    // aria-controls points at the body by id
    const id = header.getAttribute('aria-controls')!
    expect(document.getElementById(id)).not.toBeNull()
  })

  it('send button has aria-label="Send" (once visible)', () => {
    const fake = createFakeOnSend()
    render(<Harness fake={fake} />)
    // Hidden in the empty state — type to reveal it.
    expect(screen.queryByLabelText('Send')).toBeNull()
    const ta = screen.getByLabelText(/Ask Pixel/) as HTMLTextAreaElement
    act(() => {
      fireEvent.change(ta, { target: { value: 'hi' } })
    })
    const btn = screen.getByLabelText('Send')
    expect(btn.tagName).toBe('BUTTON')
  })

  it('textarea has aria-label matching placeholder', () => {
    const fake = createFakeOnSend()
    render(<Harness fake={fake} />)
    const ta = screen.getByLabelText(/Ask Pixel/) as HTMLTextAreaElement
    expect(ta.getAttribute('aria-label')).toMatch(/Ask Pixel/)
  })

  it('thinking indicator has aria-live=polite', async () => {
    const fake = createFakeOnSend()
    render(<Harness fake={fake} />)
    const ta = screen.getByLabelText(/Ask Pixel/) as HTMLTextAreaElement
    act(() => {
      fireEvent.change(ta, { target: { value: 'hi' } })
      fireEvent.keyDown(ta, { key: 'Enter' })
    })
    await waitFor(() => {
      const indicator = screen.getByTestId('thinking-indicator')
      expect(indicator.getAttribute('aria-live')).toBe('polite')
    })
  })

  it('error bubble has role=alert', async () => {
    const fake = createFakeOnSend()
    render(<Harness fake={fake} />)
    const ta = screen.getByLabelText(/Ask Pixel/) as HTMLTextAreaElement
    act(() => {
      fireEvent.change(ta, { target: { value: 'hi' } })
      fireEvent.keyDown(ta, { key: 'Enter' })
    })
    await waitFor(() => fake.isPending())
    act(() => {
      fake.reject(new Error('boom'))
    })
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toContain('boom')
    })
  })
})

describe('IntegratedBrainstorm — scroll', () => {
  it('scrolls history to bottom when messages are appended', async () => {
    const scrollSpy = mock()
    // JSDOM doesn't implement scrollIntoView; provide a polyfill spy.
    const origProto = (HTMLElement.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView
    ;(HTMLElement.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = scrollSpy as unknown as () => void
    try {
      const fake = createFakeOnSend()
      render(<Harness fake={fake} />)
      const ta = screen.getByLabelText(/Ask Pixel/) as HTMLTextAreaElement
      const before = scrollSpy.mock.calls.length
      act(() => {
        fireEvent.change(ta, { target: { value: 'hi' } })
        fireEvent.keyDown(ta, { key: 'Enter' })
      })
      await waitFor(() => fake.isPending())
      act(() => {
        fake.emitToken('hello')
      })
      await waitFor(() => {
        expect(scrollSpy.mock.calls.length).toBeGreaterThan(before)
      })
    } finally {
      if (origProto) {
        ;(HTMLElement.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView = origProto
      }
    }
  })
})

describe('IntegratedBrainstorm — edge cases', () => {
  it('per-message agentId attribution survives when session agentId changes mid-conversation', () => {
    const fake = createFakeOnSend()
    const messages: BrainstormMessage[] = [
      { id: 'a1', role: 'assistant', content: 'first', agentId: 'pixel' },
      { id: 'a2', role: 'assistant', content: 'second', agentId: 'basil' },
    ]
    const { container } = render(
      <Harness fake={fake} agentId="pixel" initialMessages={messages} />,
    )
    const bubbles = container.querySelectorAll('[data-testid="assistant-bubble"]')
    expect(bubbles.length).toBe(2)
    // First bubble → pixel color
    const first = bubbles[0].querySelector('[style*="border-left-color"]') as HTMLElement
    expect(first.style.borderLeftColor.toLowerCase()).toMatch(/5e6ad2|rgba?\(94/)
    // Second bubble → basil color
    const second = bubbles[1].querySelector('[style*="border-left-color"]') as HTMLElement
    expect(second.style.borderLeftColor.toLowerCase()).toMatch(/10b981|rgba?\(16/)
  })

  it('resolving with empty content and no accumulated tokens appends nothing', async () => {
    const fake = createFakeOnSend()
    render(<Harness fake={fake} />)
    const ta = screen.getByLabelText(/Ask Pixel/) as HTMLTextAreaElement
    act(() => {
      fireEvent.change(ta, { target: { value: 'hi' } })
      fireEvent.keyDown(ta, { key: 'Enter' })
    })
    await waitFor(() => fake.isPending())
    act(() => {
      fake.resolve('')
    })
    await waitFor(() => !fake.isPending())
    // Only the user's message remains
    const bubbles = screen.queryAllByTestId('assistant-bubble')
    expect(bubbles.length).toBe(0)
  })

  it('renders a long (10k char) assistant message without crashing', () => {
    const fake = createFakeOnSend()
    const longContent = 'a'.repeat(10000)
    const messages: BrainstormMessage[] = [{ id: 'a1', role: 'assistant', content: longContent }]
    render(<Harness fake={fake} initialMessages={messages} />)
    const bubble = screen.getByTestId('assistant-bubble')
    expect(bubble.textContent?.length).toBeGreaterThanOrEqual(10000)
  })
})
