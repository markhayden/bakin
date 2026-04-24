// @vitest-environment jsdom
import { describe, it, expect, mock } from 'bun:test'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-ib-rt-${Date.now()}`)

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

function Harness(props: {
  fake: ReturnType<typeof createFakeOnSend>
  readOnly?: boolean
  readOnlyNotice?: React.ReactNode
  initialMessages?: BrainstormMessage[]
  transform?: (raw: string) => { text: string; extras?: React.ReactNode }
}) {
  const [messages, setMessages] = useState<BrainstormMessage[]>(props.initialMessages ?? [])
  return (
    <IntegratedBrainstorm
      messages={messages}
      onMessagesChange={setMessages}
      onSend={props.fake.onSend}
      agentId="pixel"
      readOnly={props.readOnly}
      readOnlyNotice={props.readOnlyNotice}
      transformAssistantMessage={props.transform}
    />
  )
}

describe('IntegratedBrainstorm — readOnly', () => {
  it('replaces input row with default "read-only" notice when readOnly=true', () => {
    const fake = createFakeOnSend()
    render(<Harness fake={fake} readOnly={true} />)
    expect(screen.queryByLabelText(/Ask Pixel/)).toBeNull()
    expect(screen.queryByLabelText('Send')).toBeNull()
    const notice = screen.getByTestId('readonly-notice')
    expect(notice.textContent).toMatch(/read-only/i)
  })

  it('renders the custom readOnlyNotice when provided', () => {
    const fake = createFakeOnSend()
    render(
      <Harness
        fake={fake}
        readOnly={true}
        readOnlyNotice={<span data-testid="custom-notice">Session completed</span>}
      />,
    )
    expect(screen.getByTestId('custom-notice').textContent).toBe('Session completed')
  })

  it('keeps history visible in readOnly mode', () => {
    const fake = createFakeOnSend()
    const messages: BrainstormMessage[] = [
      { id: 'u1', role: 'user', content: 'hey' },
      { id: 'a1', role: 'assistant', content: 'hi' },
    ]
    render(<Harness fake={fake} readOnly={true} initialMessages={messages} />)
    expect(screen.getByText('hey')).toBeDefined()
    expect(screen.getByTestId('assistant-bubble')).toBeDefined()
  })
})

describe('IntegratedBrainstorm — transformAssistantMessage', () => {
  it('when absent, renders raw content through markdown', () => {
    const fake = createFakeOnSend()
    const messages: BrainstormMessage[] = [{ id: 'a1', role: 'assistant', content: '**bold**' }]
    render(<Harness fake={fake} initialMessages={messages} />)
    expect(screen.getByTestId('assistant-bubble').querySelector('strong')).toBeTruthy()
  })

  it('when present, renders only the transformed text (strips raw parts)', () => {
    const fake = createFakeOnSend()
    const messages: BrainstormMessage[] = [
      {
        id: 'a1',
        role: 'assistant',
        content: 'clean\n```json\n[{"hidden": true}]\n```\n',
      },
    ]
    const transform = (raw: string) => ({
      text: raw.replace(/```json[\s\S]*?```/g, '').trim(),
    })
    render(<Harness fake={fake} initialMessages={messages} transform={transform} />)
    const bubble = screen.getByTestId('assistant-bubble')
    expect(bubble.textContent).toContain('clean')
    expect(bubble.textContent).not.toContain('hidden')
  })

  it('renders transform extras in the assistant bubble', () => {
    const fake = createFakeOnSend()
    const messages: BrainstormMessage[] = [
      { id: 'a1', role: 'assistant', content: 'seen' },
    ]
    const transform = (raw: string) => ({
      text: raw,
      extras: <span data-testid="extras-badge">2 proposed</span>,
    })
    render(<Harness fake={fake} initialMessages={messages} transform={transform} />)
    expect(screen.getByTestId('extras-badge').textContent).toBe('2 proposed')
  })

  it('applies to streaming content (called on every token)', async () => {
    const fake = createFakeOnSend()
    const transform = (raw: string) => ({
      text: raw.toUpperCase(),
    })
    render(<Harness fake={fake} transform={transform} />)
    const ta = screen.getByLabelText(/Ask Pixel/) as HTMLTextAreaElement
    act(() => {
      fireEvent.change(ta, { target: { value: 'hi' } })
      fireEvent.keyDown(ta, { key: 'Enter' })
    })
    await waitFor(() => fake.isPending())
    act(() => {
      fake.emitToken('hello')
    })
    await waitFor(() => {
      expect(screen.getByTestId('streaming-bubble').textContent).toContain('HELLO')
    })
  })
})

describe('IntegratedBrainstorm — onCustom passthrough', () => {
  it('forwards emitCustom calls to caller-provided handler', async () => {
    // To receive onCustom, caller must plug it into the send call — but the
    // current component API only exposes send internally. We verify the hook
    // plumbing: the fake passes the onCustom it receives from the component
    // through to its controller, so emitCustom is observable on the caller's
    // side once wired.
    const fake = createFakeOnSend()
    const received: Array<{ name: string; data: unknown }> = []
    // Wrap the fake to tap onCustom at the onSend callsite.
    const wrappedOnSend = mock(async (prompt, history, ctx) => {
      ctx.onCustom = (name, data) => received.push({ name, data })
      return fake.onSend(prompt, history, ctx)
    })
    const Harness2 = () => {
      const [messages, setMessages] = useState<BrainstormMessage[]>([])
      return (
        <IntegratedBrainstorm
          messages={messages}
          onMessagesChange={setMessages}
          onSend={wrappedOnSend}
          agentId="pixel"
        />
      )
    }
    render(<Harness2 />)
    const ta = screen.getByLabelText(/Ask Pixel/) as HTMLTextAreaElement
    act(() => {
      fireEvent.change(ta, { target: { value: 'go' } })
      fireEvent.keyDown(ta, { key: 'Enter' })
    })
    await waitFor(() => fake.isPending())
    act(() => {
      fake.emitCustom('proposal', { id: 'p1' })
      fake.emitCustom('proposal', { id: 'p2' })
    })
    expect(received.length).toBe(2)
    expect(received[0]).toEqual({ name: 'proposal', data: { id: 'p1' } })
    expect(received[1]).toEqual({ name: 'proposal', data: { id: 'p2' } })
  })
})
