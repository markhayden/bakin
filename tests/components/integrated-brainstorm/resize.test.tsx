// @vitest-environment jsdom
import { describe, it, expect, mock, beforeEach } from 'bun:test'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-ib-resize-${Date.now()}`)

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
  defaultHeight?: number
  minHeight?: number
  maxHeight?: number
  storageKey?: string
  initialMessages?: BrainstormMessage[]
}) {
  const [messages, setMessages] = useState<BrainstormMessage[]>(props.initialMessages ?? [])
  return (
    <IntegratedBrainstorm
      messages={messages}
      onMessagesChange={setMessages}
      onSend={props.fake.onSend}
      agentId="pixel"
      defaultHeight={props.defaultHeight}
      minHeight={props.minHeight}
      maxHeight={props.maxHeight}
      storageKey={props.storageKey}
    />
  )
}

beforeEach(() => {
  try {
    window.localStorage.clear()
  } catch {}
})

describe('IntegratedBrainstorm — default sizing', () => {
  it('opens at the readable default height before any message is sent', () => {
    const fake = createFakeOnSend()
    render(<Harness fake={fake} />)
    const panel = screen.getByTestId('integrated-brainstorm') as HTMLDivElement
    expect(panel.style.height).toBe('480px')
  })

  it('honors an explicit defaultHeight without changing min drag height', () => {
    const fake = createFakeOnSend()
    render(<Harness fake={fake} defaultHeight={500} minHeight={260} />)
    const panel = screen.getByTestId('integrated-brainstorm') as HTMLDivElement
    expect(panel.style.height).toBe('500px')
    const handle = screen.getByTestId('resize-handle')
    act(() => {
      fireEvent.mouseDown(handle, { clientY: 100 })
      fireEvent.mouseMove(document, { clientY: 5000 })
      fireEvent.mouseUp(document)
    })
    expect(panel.style.height).toBe('260px')
  })

  it('does not resize the panel on first send', async () => {
    const fake = createFakeOnSend()
    render(<Harness fake={fake} defaultHeight={480} />)
    const panel = screen.getByTestId('integrated-brainstorm') as HTMLDivElement
    const ta = screen.getByLabelText(/Ask Pixel/) as HTMLTextAreaElement
    act(() => {
      fireEvent.change(ta, { target: { value: 'hi' } })
      fireEvent.keyDown(ta, { key: 'Enter' })
    })
    await waitFor(() => expect(fake.isPending()).toBe(true))
    expect(panel.style.height).toBe('480px')
  })

  it('preserves a manual resize across subsequent sends', async () => {
    const fake = createFakeOnSend()
    render(<Harness fake={fake} defaultHeight={480} minHeight={260} />)
    const panel = screen.getByTestId('integrated-brainstorm') as HTMLDivElement
    const ta = screen.getByLabelText(/Ask Pixel/) as HTMLTextAreaElement
    const handle = screen.getByTestId('resize-handle')
    act(() => {
      fireEvent.mouseDown(handle, { clientY: 500 })
      fireEvent.mouseMove(document, { clientY: 700 })
      fireEvent.mouseUp(document)
    })
    const shrunk = panel.style.height
    expect(shrunk).toBe('280px')
    act(() => {
      fireEvent.change(ta, { target: { value: 'one' } })
      fireEvent.keyDown(ta, { key: 'Enter' })
    })
    await waitFor(() => expect(fake.isPending()).toBe(true))
    expect(panel.style.height).toBe(shrunk)
  })

  it('keeps default height when seeded with existing messages', async () => {
    const fake = createFakeOnSend()
    const seed: BrainstormMessage[] = [
      { id: 's1', role: 'user', content: 'seed' },
      { id: 's2', role: 'assistant', content: 'reply' },
    ]
    render(
      <Harness
        fake={fake}
        initialMessages={seed}
        defaultHeight={480}
        minHeight={260}
      />,
    )
    const panel = screen.getByTestId('integrated-brainstorm') as HTMLDivElement
    expect(panel.style.height).toBe('480px')
    const ta = screen.getByLabelText(/Ask Pixel/) as HTMLTextAreaElement
    act(() => {
      fireEvent.change(ta, { target: { value: 'new send' } })
      fireEvent.keyDown(ta, { key: 'Enter' })
    })
    await waitFor(() => expect(fake.isPending()).toBe(true))
    expect(panel.style.height).toBe('480px')
  })
})

describe('IntegratedBrainstorm — drag resize', () => {
  it('mouse drag updates panel height', () => {
    const fake = createFakeOnSend()
    render(<Harness fake={fake} defaultHeight={480} minHeight={260} maxHeight={720} />)
    const panel = screen.getByTestId('integrated-brainstorm') as HTMLDivElement
    expect(panel.style.height).toBe('480px')
    const handle = screen.getByTestId('resize-handle')
    act(() => {
      fireEvent.mouseDown(handle, { clientY: 500 })
      fireEvent.mouseMove(document, { clientY: 300 })
      fireEvent.mouseUp(document)
    })
    // Drag upward by 200px grew panel by 200 → 680
    expect(panel.style.height).toBe('680px')
  })

  it('clamps to minHeight on downward over-drag', () => {
    const fake = createFakeOnSend()
    render(<Harness fake={fake} defaultHeight={480} minHeight={260} maxHeight={720} />)
    const panel = screen.getByTestId('integrated-brainstorm') as HTMLDivElement
    const handle = screen.getByTestId('resize-handle')
    act(() => {
      fireEvent.mouseDown(handle, { clientY: 100 })
      fireEvent.mouseMove(document, { clientY: 5000 })
      fireEvent.mouseUp(document)
    })
    expect(panel.style.height).toBe('260px')
  })

  it('clamps to maxHeight on upward over-drag', () => {
    const fake = createFakeOnSend()
    render(<Harness fake={fake} defaultHeight={480} minHeight={260} maxHeight={720} />)
    const panel = screen.getByTestId('integrated-brainstorm') as HTMLDivElement
    const handle = screen.getByTestId('resize-handle')
    act(() => {
      fireEvent.mouseDown(handle, { clientY: 1000 })
      fireEvent.mouseMove(document, { clientY: -5000 })
      fireEvent.mouseUp(document)
    })
    expect(panel.style.height).toBe('720px')
  })

  it('handle has correct ARIA', () => {
    const fake = createFakeOnSend()
    render(<Harness fake={fake} />)
    const handle = screen.getByTestId('resize-handle')
    expect(handle.getAttribute('role')).toBe('separator')
    expect(handle.getAttribute('aria-orientation')).toBe('horizontal')
    expect(handle.getAttribute('aria-label')).toBe('Resize brainstorm panel')
  })

  it('touch drag updates panel height', () => {
    const fake = createFakeOnSend()
    render(<Harness fake={fake} defaultHeight={480} minHeight={260} maxHeight={720} />)
    const panel = screen.getByTestId('integrated-brainstorm') as HTMLDivElement
    const handle = screen.getByTestId('resize-handle')
    act(() => {
      fireEvent.touchStart(handle, { touches: [{ clientY: 500 }] })
      fireEvent.touchMove(document, { touches: [{ clientY: 300 }] })
      fireEvent.touchEnd(document)
    })
    expect(panel.style.height).toBe('680px')
  })
})

describe('IntegratedBrainstorm — height persistence', () => {
  it('persists drag-applied height to localStorage under the storageKey', () => {
    const fake = createFakeOnSend()
    render(<Harness fake={fake} storageKey="resize-test-a" defaultHeight={480} minHeight={260} maxHeight={720} />)
    const handle = screen.getByTestId('resize-handle')
    act(() => {
      fireEvent.mouseDown(handle, { clientY: 500 })
      fireEvent.mouseMove(document, { clientY: 200 })
      fireEvent.mouseUp(document)
    })
    const stored = window.localStorage.getItem('bakin-vresize:resize-test-a')
    expect(stored).toBe('720')
  })

  it('reads persisted height on mount', () => {
    window.localStorage.setItem('bakin-vresize:resize-test-b', '555')
    const fake = createFakeOnSend()
    render(<Harness fake={fake} storageKey="resize-test-b" />)
    const panel = screen.getByTestId('integrated-brainstorm') as HTMLDivElement
    expect(panel.style.height).toBe('555px')
  })

  it('uses persisted height and does not resize on submit', async () => {
    window.localStorage.setItem('bakin-vresize:resize-test-c', '555')
    const fake = createFakeOnSend()
    render(
      <Harness fake={fake} storageKey="resize-test-c" defaultHeight={480} minHeight={260} />,
    )
    const panel = screen.getByTestId('integrated-brainstorm') as HTMLDivElement
    expect(panel.style.height).toBe('555px')
    const ta = screen.getByLabelText(/Ask Pixel/) as HTMLTextAreaElement
    act(() => {
      fireEvent.change(ta, { target: { value: 'hi' } })
      fireEvent.keyDown(ta, { key: 'Enter' })
    })
    await waitFor(() => expect(fake.isPending()).toBe(true))
    // Height unchanged — user's persisted preference wins.
    expect(panel.style.height).toBe('555px')
  })

  it('storageKey undefined → no localStorage write', () => {
    const setSpy = mock((..._args: unknown[]) => {})
    const orig = window.localStorage.setItem
    window.localStorage.setItem = setSpy as typeof window.localStorage.setItem
    try {
      const fake = createFakeOnSend()
      render(<Harness fake={fake} />)
      const handle = screen.getByTestId('resize-handle')
      act(() => {
        fireEvent.mouseDown(handle, { clientY: 500 })
        fireEvent.mouseMove(document, { clientY: 200 })
        fireEvent.mouseUp(document)
      })
      expect(setSpy.mock.calls.some((c) => String(c[0]).startsWith('bakin-vresize:'))).toBe(false)
    } finally {
      window.localStorage.setItem = orig
    }
  })
})
