// @vitest-environment jsdom
import { describe, it, expect, mock } from 'bun:test'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-ib-stream-${Date.now()}`)

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
    selector({
      agentMap: Object.fromEntries(MOCK_AGENTS.map((a) => [a.id, a])),
      agents: MOCK_AGENTS,
      displaySettings: {},
    }),
}))

import { IntegratedBrainstorm } from '@/components/integrated-brainstorm'
import type { BrainstormMessage } from '@/components/integrated-brainstorm'
import { createFakeOnSend } from './fake-on-send'

function Harness({ fake }: { fake: ReturnType<typeof createFakeOnSend> }) {
  const [messages, setMessages] = useState<BrainstormMessage[]>([])
  return (
    <IntegratedBrainstorm
      messages={messages}
      onMessagesChange={setMessages}
      onSend={fake.onSend}
      agentId="pixel"
    />
  )
}

function type(el: HTMLTextAreaElement, value: string) {
  fireEvent.change(el, { target: { value } })
}
function pressEnter(el: HTMLTextAreaElement) {
  fireEvent.keyDown(el, { key: 'Enter' })
}

async function sleep(ms = 0) {
  await new Promise((r) => setTimeout(r, ms))
}

describe('IntegratedBrainstorm — send state machine & streaming', () => {
  it('calls onSend with trimmed prompt + current history on Enter', async () => {
    const fake = createFakeOnSend()
    render(<Harness fake={fake} />)
    const textarea = screen.getByLabelText(/Ask Pixel/) as HTMLTextAreaElement
    act(() => {
      type(textarea, '  hello world  ')
      pressEnter(textarea)
    })
    await waitFor(() => expect(fake.calls.length).toBe(1))
    expect(fake.calls[0].prompt).toBe('hello world')
    expect(fake.calls[0].historyLength).toBe(0)
  })

  it('optimistically appends user message + clears input immediately', async () => {
    const fake = createFakeOnSend()
    render(<Harness fake={fake} />)
    const textarea = screen.getByLabelText(/Ask Pixel/) as HTMLTextAreaElement
    act(() => {
      type(textarea, 'first question')
      pressEnter(textarea)
    })
    expect(textarea.value).toBe('')
    await waitFor(() => {
      expect(screen.getByText('first question')).toBeDefined()
    })
  })

  it('shows thinking indicator after send, hides it once tokens arrive', async () => {
    const fake = createFakeOnSend()
    render(<Harness fake={fake} />)
    const textarea = screen.getByLabelText(/Ask Pixel/) as HTMLTextAreaElement
    act(() => {
      type(textarea, 'hi')
      pressEnter(textarea)
    })
    await waitFor(() => {
      expect(screen.getByTestId('thinking-indicator')).toBeDefined()
    })
    act(() => {
      fake.emitToken('hel')
    })
    await waitFor(() => {
      expect(screen.queryByTestId('thinking-indicator')).toBeNull()
      expect(screen.getByTestId('streaming-bubble')).toBeDefined()
    })
  })

  it('accumulates streaming tokens in the same bubble', async () => {
    const fake = createFakeOnSend()
    render(<Harness fake={fake} />)
    const textarea = screen.getByLabelText(/Ask Pixel/) as HTMLTextAreaElement
    act(() => {
      type(textarea, 'hi')
      pressEnter(textarea)
    })
    await waitFor(() => fake.isPending())
    act(() => {
      fake.emitToken('hel')
    })
    act(() => {
      fake.emitToken('lo')
    })
    await waitFor(() => {
      expect(screen.getByTestId('streaming-bubble').textContent).toContain('hello')
    })
  })

  it('replaces streaming bubble with final assistant message on resolve', async () => {
    const fake = createFakeOnSend()
    render(<Harness fake={fake} />)
    const textarea = screen.getByLabelText(/Ask Pixel/) as HTMLTextAreaElement
    act(() => {
      type(textarea, 'hi')
      pressEnter(textarea)
    })
    await waitFor(() => fake.isPending())
    act(() => {
      fake.emitToken('partial')
    })
    act(() => {
      fake.resolve('final reply')
    })
    await waitFor(() => {
      expect(screen.queryByTestId('streaming-bubble')).toBeNull()
      expect(screen.queryByTestId('thinking-indicator')).toBeNull()
      expect(screen.getByTestId('assistant-bubble')).toBeDefined()
      expect(screen.getByTestId('assistant-bubble').textContent).toContain('final reply')
    })
  })

  it('falls back to accumulated content when resolve content is empty', async () => {
    const fake = createFakeOnSend()
    render(<Harness fake={fake} />)
    const textarea = screen.getByLabelText(/Ask Pixel/) as HTMLTextAreaElement
    act(() => {
      type(textarea, 'hi')
      pressEnter(textarea)
    })
    await waitFor(() => fake.isPending())
    act(() => {
      fake.emitToken('token content')
    })
    act(() => {
      fake.resolve('')
    })
    await waitFor(() => {
      expect(screen.getByTestId('assistant-bubble').textContent).toContain('token content')
    })
  })

  it('blocks concurrent sends — second Enter while in-flight is ignored', async () => {
    const fake = createFakeOnSend()
    render(<Harness fake={fake} />)
    const textarea = screen.getByLabelText(/Ask Pixel/) as HTMLTextAreaElement
    act(() => {
      type(textarea, 'one')
      pressEnter(textarea)
    })
    await waitFor(() => fake.isPending())
    act(() => {
      type(textarea, 'two')
      pressEnter(textarea)
    })
    await sleep(10)
    expect(fake.calls.length).toBe(1)
  })

  it('appends error bubble when onSend rejects; returns to idle', async () => {
    const fake = createFakeOnSend()
    render(<Harness fake={fake} />)
    const textarea = screen.getByLabelText(/Ask Pixel/) as HTMLTextAreaElement
    act(() => {
      type(textarea, 'boom')
      pressEnter(textarea)
    })
    await waitFor(() => fake.isPending())
    act(() => {
      fake.reject(new Error('runtime down'))
    })
    await waitFor(() => {
      const err = screen.getByRole('alert')
      expect(err).toBeDefined()
      expect(err.textContent).toContain('runtime down')
    })
    // Input is focusable again — a follow-up send is permitted.
    act(() => {
      type(textarea, 'retry')
      pressEnter(textarea)
    })
    await waitFor(() => expect(fake.calls.length).toBe(2))
  })

  it('does not call onSend for empty / whitespace-only input', async () => {
    const fake = createFakeOnSend()
    render(<Harness fake={fake} />)
    const textarea = screen.getByLabelText(/Ask Pixel/) as HTMLTextAreaElement
    act(() => {
      type(textarea, '   ')
      pressEnter(textarea)
    })
    await sleep(10)
    expect(fake.calls.length).toBe(0)
  })

  it('send button is hidden when empty; visible and enabled when typing; visible and disabled while busy', async () => {
    const fake = createFakeOnSend()
    render(<Harness fake={fake} />)
    expect(screen.queryByLabelText('Send')).toBeNull()
    const textarea = screen.getByLabelText(/Ask Pixel/) as HTMLTextAreaElement
    act(() => {
      type(textarea, 'ready')
    })
    const sendBtn = screen.getByLabelText('Send') as HTMLButtonElement
    expect(sendBtn.disabled).toBe(false)
    act(() => {
      pressEnter(textarea)
    })
    await waitFor(() => fake.isPending())
    // Button stays visible during a send so the spinner gives live feedback.
    const duringSend = screen.getByLabelText('Send') as HTMLButtonElement
    expect(duringSend.disabled).toBe(true)
  })

  it('clicking send button submits', async () => {
    const fake = createFakeOnSend()
    render(<Harness fake={fake} />)
    const textarea = screen.getByLabelText(/Ask Pixel/) as HTMLTextAreaElement
    act(() => {
      type(textarea, 'clicked')
    })
    const sendBtn = screen.getByLabelText('Send') as HTMLButtonElement
    act(() => {
      fireEvent.click(sendBtn)
    })
    await waitFor(() => expect(fake.calls.length).toBe(1))
    expect(fake.calls[0].prompt).toBe('clicked')
  })
})

describe('IntegratedBrainstorm — thinking verb selection', () => {
  it('renders one of the curated culinary verbs', async () => {
    const fake = createFakeOnSend()
    render(<Harness fake={fake} />)
    const textarea = screen.getByLabelText(/Ask Pixel/) as HTMLTextAreaElement
    act(() => {
      type(textarea, 'hi')
      pressEnter(textarea)
    })
    await waitFor(() => {
      const indicator = screen.getByTestId('thinking-indicator')
      expect(indicator.textContent).toMatch(
        /sizzling|crackling|brewing|steeping|curing|thawing|smoking|flipping|rendering|marinating|scrambling|poaching|preheating|microwaving|baking|wafting|simmering|searing|whisking|roasting|crisping|churning|seasoning|scorching|folding|charring|toasting/,
      )
    })
  })

  it('all 27 verbs are reachable (seeded Math.random)', async () => {
    const verbs = (await import('@/components/integrated-brainstorm/thinking-indicator')).THINKING_VERBS
    expect(verbs.length).toBe(27)
    const seen = new Set<string>()
    for (let i = 0; i < verbs.length; i++) {
      const idx = i
      const orig = Math.random
      Math.random = () => idx / verbs.length
      try {
        const fake = createFakeOnSend()
        const { unmount } = render(<Harness fake={fake} />)
        const textarea = screen.getByLabelText(/Ask Pixel/) as HTMLTextAreaElement
        act(() => {
          type(textarea, 'hi')
          pressEnter(textarea)
        })
        await waitFor(() => {
          const t = screen.getByTestId('thinking-indicator').textContent!
          const match = t.match(
            /sizzling|crackling|brewing|steeping|curing|thawing|smoking|flipping|rendering|marinating|scrambling|poaching|preheating|microwaving|baking|wafting|simmering|searing|whisking|roasting|crisping|churning|seasoning|scorching|folding|charring|toasting/,
          )
          if (match) seen.add(match[0])
        })
        act(() => {
          fake.reject(new Error('cleanup'))
        })
        await waitFor(() => !fake.isPending())
        unmount()
      } finally {
        Math.random = orig
      }
    }
    expect(seen.size).toBe(verbs.length)
  })
})
