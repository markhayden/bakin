// @vitest-environment jsdom
import { describe, it, expect, mock } from 'bun:test'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import '../../rtl-settle'
import { useState } from 'react'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-ib-kb-${Date.now()}`)

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

const sleep = (ms = 0) => new Promise((r) => setTimeout(r, ms))

describe('IntegratedBrainstorm — keyboard', () => {
  it('Enter sends', async () => {
    const fake = createFakeOnSend()
    render(<Harness fake={fake} />)
    const ta = screen.getByLabelText(/Ask Pixel/) as HTMLTextAreaElement
    act(() => {
      type(ta, 'x')
      fireEvent.keyDown(ta, { key: 'Enter' })
    })
    await waitFor(() => expect(fake.calls.length).toBe(1))
  })

  it('Shift+Enter does NOT send', async () => {
    const fake = createFakeOnSend()
    render(<Harness fake={fake} />)
    const ta = screen.getByLabelText(/Ask Pixel/) as HTMLTextAreaElement
    act(() => {
      type(ta, 'x')
      fireEvent.keyDown(ta, { key: 'Enter', shiftKey: true })
    })
    await sleep(10)
    expect(fake.calls.length).toBe(0)
  })

  it('Cmd+Enter sends', async () => {
    const fake = createFakeOnSend()
    render(<Harness fake={fake} />)
    const ta = screen.getByLabelText(/Ask Pixel/) as HTMLTextAreaElement
    act(() => {
      type(ta, 'x')
      fireEvent.keyDown(ta, { key: 'Enter', metaKey: true })
    })
    await waitFor(() => expect(fake.calls.length).toBe(1))
  })

  it('Ctrl+Enter sends', async () => {
    const fake = createFakeOnSend()
    render(<Harness fake={fake} />)
    const ta = screen.getByLabelText(/Ask Pixel/) as HTMLTextAreaElement
    act(() => {
      type(ta, 'x')
      fireEvent.keyDown(ta, { key: 'Enter', ctrlKey: true })
    })
    await waitFor(() => expect(fake.calls.length).toBe(1))
  })

  it('IME composition suppresses Enter-send', async () => {
    const fake = createFakeOnSend()
    render(<Harness fake={fake} />)
    const ta = screen.getByLabelText(/Ask Pixel/) as HTMLTextAreaElement
    act(() => {
      type(ta, 'こ')
      fireEvent.compositionStart(ta)
      fireEvent.keyDown(ta, { key: 'Enter' })
    })
    await sleep(10)
    expect(fake.calls.length).toBe(0)
    // End composition, then Enter should send.
    act(() => {
      fireEvent.compositionEnd(ta)
      fireEvent.keyDown(ta, { key: 'Enter' })
    })
    await waitFor(() => expect(fake.calls.length).toBe(1))
  })
})

describe('IntegratedBrainstorm — abort via Esc', () => {
  it('Esc while sending calls AbortController.abort()', async () => {
    const fake = createFakeOnSend()
    render(<Harness fake={fake} />)
    const ta = screen.getByLabelText(/Ask Pixel/) as HTMLTextAreaElement
    act(() => {
      type(ta, 'hi')
      fireEvent.keyDown(ta, { key: 'Enter' })
    })
    await waitFor(() => fake.isPending())
    const signal = fake.getSignal()!
    expect(signal.aborted).toBe(false)
    act(() => {
      fireEvent.keyDown(ta, { key: 'Escape' })
    })
    await waitFor(() => expect(signal.aborted).toBe(true))
  })

  it('Esc while idle is a no-op (no error, no onSend call)', async () => {
    const fake = createFakeOnSend()
    render(<Harness fake={fake} />)
    const ta = screen.getByLabelText(/Ask Pixel/) as HTMLTextAreaElement
    act(() => {
      fireEvent.keyDown(ta, { key: 'Escape' })
    })
    await sleep(10)
    expect(fake.calls.length).toBe(0)
  })

  it('Esc after tokens received preserves partial as final assistant message', async () => {
    const fake = createFakeOnSend()
    render(<Harness fake={fake} />)
    const ta = screen.getByLabelText(/Ask Pixel/) as HTMLTextAreaElement
    act(() => {
      type(ta, 'hi')
      fireEvent.keyDown(ta, { key: 'Enter' })
    })
    await waitFor(() => fake.isPending())
    act(() => {
      fake.emitToken('partial data')
    })
    await waitFor(() => expect(screen.getByTestId('streaming-bubble')).toBeDefined())
    act(() => {
      fireEvent.keyDown(ta, { key: 'Escape' })
    })
    await waitFor(() => {
      expect(screen.queryByTestId('streaming-bubble')).toBeNull()
      const bubbles = screen.getAllByTestId('assistant-bubble')
      expect(bubbles[0].textContent).toContain('partial data')
    })
  })

  it('Esc before any tokens: no assistant bubble appended', async () => {
    const fake = createFakeOnSend()
    render(<Harness fake={fake} />)
    const ta = screen.getByLabelText(/Ask Pixel/) as HTMLTextAreaElement
    act(() => {
      type(ta, 'hi')
      fireEvent.keyDown(ta, { key: 'Enter' })
    })
    await waitFor(() => fake.isPending())
    act(() => {
      fireEvent.keyDown(ta, { key: 'Escape' })
    })
    await waitFor(() => {
      expect(screen.queryByTestId('thinking-indicator')).toBeNull()
      expect(screen.queryByTestId('assistant-bubble')).toBeNull()
    })
  })

  it('shows an aborted notice after Esc stops a stream', async () => {
    const fake = createFakeOnSend()
    render(<Harness fake={fake} />)
    const ta = screen.getByLabelText(/Ask Pixel/) as HTMLTextAreaElement
    act(() => {
      type(ta, 'hi')
      fireEvent.keyDown(ta, { key: 'Enter' })
    })
    await waitFor(() => fake.isPending())
    act(() => {
      fake.emitToken('partial')
    })
    act(() => {
      fireEvent.keyDown(ta, { key: 'Escape' })
    })
    await waitFor(() => {
      const notice = screen.getByTestId('aborted-notice')
      expect(notice).toBeDefined()
      expect(notice.getAttribute('role')).toBe('status')
      expect(notice.textContent).toMatch(/stopped/i)
    })
  })

  it('aborted notice clears when the next send begins', async () => {
    const fake = createFakeOnSend()
    render(<Harness fake={fake} />)
    const ta = screen.getByLabelText(/Ask Pixel/) as HTMLTextAreaElement
    act(() => {
      type(ta, 'first')
      fireEvent.keyDown(ta, { key: 'Enter' })
    })
    await waitFor(() => fake.isPending())
    act(() => {
      fireEvent.keyDown(ta, { key: 'Escape' })
    })
    await waitFor(() => expect(screen.getByTestId('aborted-notice')).toBeDefined())
    act(() => {
      type(ta, 'second')
      fireEvent.keyDown(ta, { key: 'Enter' })
    })
    await waitFor(() => {
      expect(screen.queryByTestId('aborted-notice')).toBeNull()
    })
  })

  it('rapid send/abort/send cycle — state machine returns to idle', async () => {
    const fake = createFakeOnSend()
    render(<Harness fake={fake} />)
    const ta = screen.getByLabelText(/Ask Pixel/) as HTMLTextAreaElement
    // First send + abort
    act(() => {
      type(ta, 'one')
      fireEvent.keyDown(ta, { key: 'Enter' })
    })
    await waitFor(() => fake.isPending())
    act(() => {
      fireEvent.keyDown(ta, { key: 'Escape' })
    })
    await waitFor(() => expect(fake.isPending()).toBe(false))
    // Second send completes normally
    act(() => {
      type(ta, 'two')
      fireEvent.keyDown(ta, { key: 'Enter' })
    })
    await waitFor(() => expect(fake.calls.length).toBe(2))
    act(() => {
      fake.resolve('done')
    })
    await waitFor(() => {
      expect(screen.getByTestId('assistant-bubble').textContent).toContain('done')
    })
  })
})
