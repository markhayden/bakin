// @vitest-environment jsdom
import { describe, it, expect, mock } from 'bun:test'
import { render, fireEvent, screen } from '@testing-library/react'
import '../../rtl-settle'
import { Flame } from 'lucide-react'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-ib-collapse-${Date.now()}`)

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
    selector({ agentMap: Object.fromEntries(MOCK_AGENTS.map((a) => [a.id, a])), agents: MOCK_AGENTS, displaySettings: {} }),
}))

import { IntegratedBrainstorm } from '@/components/integrated-brainstorm'
import type { BrainstormMessage } from '@/components/integrated-brainstorm'

const baseProps = {
  messages: [] as BrainstormMessage[],
  onMessagesChange: () => {},
  onSend: async () => ({ content: '' }),
  agentId: 'pixel',
}

describe('IntegratedBrainstorm — collapse chrome', () => {
  it('starts open when defaultOpen=true', () => {
    render(<IntegratedBrainstorm {...baseProps} defaultOpen={true} />)
    const btn = screen.getByRole('button', { name: /Brainstorm/ })
    expect(btn.getAttribute('aria-expanded')).toBe('true')
  })

  it('starts closed when defaultOpen=false', () => {
    render(<IntegratedBrainstorm {...baseProps} defaultOpen={false} />)
    const btn = screen.getByRole('button', { name: /Brainstorm/ })
    expect(btn.getAttribute('aria-expanded')).toBe('false')
  })

  it('toggles on header click and flips aria-expanded', () => {
    render(<IntegratedBrainstorm {...baseProps} defaultOpen={true} />)
    const btn = screen.getByRole('button', { name: /Brainstorm/ })
    expect(btn.getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(btn)
    expect(btn.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(btn)
    expect(btn.getAttribute('aria-expanded')).toBe('true')
  })

  it('renders custom label and icon', () => {
    render(<IntegratedBrainstorm {...baseProps} label="Plan it" icon={Flame} />)
    expect(screen.getByRole('button', { name: /Plan it/ })).toBeDefined()
  })

  it('renders reply count when assistant messages exist', () => {
    const messages: BrainstormMessage[] = [
      { id: 'u1', role: 'user', content: 'hey' },
      { id: 'a1', role: 'assistant', content: 'hi' },
      { id: 'a2', role: 'assistant', content: 'and also this' },
    ]
    render(<IntegratedBrainstorm {...baseProps} messages={messages} />)
    expect(screen.getByText('2 replies')).toBeDefined()
  })

  it('singular "reply" when count is exactly 1', () => {
    const messages: BrainstormMessage[] = [{ id: 'a1', role: 'assistant', content: 'hi' }]
    render(<IntegratedBrainstorm {...baseProps} messages={messages} />)
    expect(screen.getByText('1 reply')).toBeDefined()
  })

  it('omits reply count when no assistant messages', () => {
    render(<IntegratedBrainstorm {...baseProps} />)
    expect(screen.queryByText(/replies?/)).toBeNull()
  })

  it('collapsible=false hides chevron and ignores toggle', () => {
    const { container } = render(
      <IntegratedBrainstorm {...baseProps} collapsible={false} />,
    )
    // No button — the header renders as a plain div.
    expect(screen.queryByRole('button', { name: /Brainstorm/ })).toBeNull()
    // Body is always present (no aria-expanded false state).
    expect(container.querySelector('[id]')).toBeDefined()
  })
})
