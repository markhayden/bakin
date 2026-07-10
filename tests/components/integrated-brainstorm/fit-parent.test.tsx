// @vitest-environment jsdom
import { describe, it, expect, mock } from 'bun:test'
import { act, fireEvent, render, screen } from '@testing-library/react'
import '../../rtl-settle'
import { useState } from 'react'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-ib-fit-${Date.now()}`)

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
  fitParent?: boolean
  showHeader?: boolean
}) {
  const [messages, setMessages] = useState<BrainstormMessage[]>([])
  return (
    <IntegratedBrainstorm
      messages={messages}
      onMessagesChange={setMessages}
      onSend={props.fake.onSend}
      agentId="pixel"
      fitParent={props.fitParent}
      showHeader={props.showHeader}
    />
  )
}

describe('IntegratedBrainstorm — fitParent', () => {
  it('default mode has readable inline height style and a drag handle', () => {
    const fake = createFakeOnSend()
    render(<Harness fake={fake} />)
    const panel = screen.getByTestId('integrated-brainstorm') as HTMLDivElement
    expect(panel.style.height).toBe('480px')
    expect(screen.getByTestId('resize-handle')).toBeDefined()
    expect(panel.className).toContain('shrink-0')
    expect(panel.className).not.toMatch(/\bh-full\b/)
  })

  it('fitParent=true removes inline height, drops drag handle, sets flex-1 h-full', () => {
    const fake = createFakeOnSend()
    render(<Harness fake={fake} fitParent />)
    const panel = screen.getByTestId('integrated-brainstorm') as HTMLDivElement
    expect(panel.style.height).toBe('')
    expect(screen.queryByTestId('resize-handle')).toBeNull()
    expect(panel.className).toContain('h-full')
    expect(panel.className).toContain('min-h-0')
    expect(panel.className).not.toMatch(/\bshrink-0\b/)
  })

  it('fitParent=true keeps parent-owned height on first send', async () => {
    const fake = createFakeOnSend()
    render(<Harness fake={fake} fitParent />)
    const panel = screen.getByTestId('integrated-brainstorm') as HTMLDivElement
    expect(panel.style.height).toBe('')
    const ta = screen.getByLabelText(/Ask Pixel/) as HTMLTextAreaElement
    act(() => {
      fireEvent.change(ta, { target: { value: 'hi' } })
      fireEvent.keyDown(ta, { key: 'Enter' })
    })
    await new Promise((r) => setTimeout(r, 20))
    expect(panel.style.height).toBe('')
  })
})

describe('IntegratedBrainstorm — showHeader', () => {
  it('default renders the header button', () => {
    const fake = createFakeOnSend()
    render(<Harness fake={fake} />)
    expect(screen.getByRole('button', { name: /Brainstorm/ })).toBeDefined()
  })

  it('showHeader=false hides the header + label + reply count entirely', () => {
    const fake = createFakeOnSend()
    render(<Harness fake={fake} showHeader={false} />)
    expect(screen.queryByRole('button', { name: /Brainstorm/ })).toBeNull()
    expect(screen.queryByText('Brainstorm')).toBeNull()
  })

  it('showHeader=false still renders input row', () => {
    const fake = createFakeOnSend()
    render(<Harness fake={fake} showHeader={false} />)
    expect(screen.getByLabelText(/Ask Pixel/)).toBeDefined()
    // Send button is hidden until the user types — that's the embedded-button behavior.
    expect(screen.queryByLabelText('Send')).toBeNull()
  })
})
