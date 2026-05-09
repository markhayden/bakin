// @vitest-environment jsdom
import { describe, it, expect, mock } from 'bun:test'
import { render, screen } from '@testing-library/react'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-ib-messages-${Date.now()}`)

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
  { id: 'chef', name: 'Chef', headshot: undefined },
]
const DISPLAY: Record<string, { accentColor: string }> = {
  pixel: { accentColor: '#5e6ad2' },
  chef: { accentColor: '#10b981' },
}
mock.module('@bakin/team/hooks/use-agent-store', () => ({
  useAgentList: () => MOCK_AGENTS,
  useAgentIds: () => MOCK_AGENTS.map((a) => a.id),
  useAgent: (id: string) => MOCK_AGENTS.find((a) => a.id === id),
  useAgentColor: (id: string) => DISPLAY[id]?.accentColor ?? '#a1a1aa',
  useAgentStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      agentMap: Object.fromEntries(MOCK_AGENTS.map((a) => [a.id, a])),
      agents: MOCK_AGENTS,
      displaySettings: DISPLAY,
    }),
}))

import { IntegratedBrainstorm } from '@/components/integrated-brainstorm'
import type { BrainstormMessage } from '@/components/integrated-brainstorm'

const baseProps = {
  onMessagesChange: () => {},
  onSend: async () => ({ content: '' }),
  agentId: 'pixel',
}

describe('IntegratedBrainstorm — message list rendering', () => {
  it('renders user messages right-aligned in a bubble', () => {
    const messages: BrainstormMessage[] = [{ id: 'u1', role: 'user', content: 'hello there' }]
    const { container } = render(<IntegratedBrainstorm {...baseProps} messages={messages} />)
    const userBubble = container.querySelector('[data-testid="user-bubble"]')
    expect(userBubble).toBeTruthy()
    expect(userBubble!.textContent).toBe('hello there')
    expect((userBubble as HTMLElement).className).toContain('justify-end')
  })

  it('does NOT markdown-render user messages', () => {
    const messages: BrainstormMessage[] = [{ id: 'u1', role: 'user', content: '**bold**' }]
    const { container } = render(<IntegratedBrainstorm {...baseProps} messages={messages} />)
    const userBubble = container.querySelector('[data-testid="user-bubble"]')
    expect(userBubble!.textContent).toBe('**bold**')
    expect(userBubble!.querySelector('strong')).toBeNull()
  })

  it('renders assistant messages with avatar and markdown body', () => {
    const messages: BrainstormMessage[] = [
      { id: 'a1', role: 'assistant', content: 'a **bold** reply' },
    ]
    const { container } = render(<IntegratedBrainstorm {...baseProps} messages={messages} />)
    const bubble = container.querySelector('[data-testid="assistant-bubble"]')
    expect(bubble).toBeTruthy()
    // Markdown component renders bold
    expect(bubble!.querySelector('strong')).toBeTruthy()
  })

  it('tints the assistant left border with the agent color (#5e6ad2 with alpha)', () => {
    const messages: BrainstormMessage[] = [{ id: 'a1', role: 'assistant', content: 'hi' }]
    const { container } = render(<IntegratedBrainstorm {...baseProps} messages={messages} />)
    const bubble = container.querySelector('[data-testid="assistant-bubble"] > div[style*="border-left-color"]') as HTMLElement
    expect(bubble).toBeTruthy()
    // borderLeftColor: '#5e6ad280' — the trailing '80' is the alpha channel
    expect(bubble.style.borderLeftColor.toLowerCase()).toMatch(/5e6ad2|rgba?\(94,\s*106,\s*210/)
  })

  it('groups consecutive assistant bubbles (-mt-2 on second, placeholder instead of avatar)', () => {
    const messages: BrainstormMessage[] = [
      { id: 'a1', role: 'assistant', content: 'first' },
      { id: 'a2', role: 'assistant', content: 'second' },
    ]
    const { container } = render(<IntegratedBrainstorm {...baseProps} messages={messages} />)
    const bubbles = container.querySelectorAll('[data-testid="assistant-bubble"]')
    expect(bubbles.length).toBe(2)
    expect(bubbles[0].getAttribute('data-consecutive')).toBe('false')
    expect(bubbles[1].getAttribute('data-consecutive')).toBe('true')
    expect((bubbles[1] as HTMLElement).className).toContain('-mt-2')
    // Second bubble has placeholder div instead of AgentAvatar.
    expect(bubbles[1].querySelector('[aria-hidden="true"]')).toBeTruthy()
  })

  it('resets the group when a user message sits between two assistant messages', () => {
    const messages: BrainstormMessage[] = [
      { id: 'a1', role: 'assistant', content: 'first' },
      { id: 'u1', role: 'user', content: 'mid' },
      { id: 'a2', role: 'assistant', content: 'second' },
    ]
    const { container } = render(<IntegratedBrainstorm {...baseProps} messages={messages} />)
    const bubbles = container.querySelectorAll('[data-testid="assistant-bubble"]')
    expect(bubbles.length).toBe(2)
    expect(bubbles[0].getAttribute('data-consecutive')).toBe('false')
    expect(bubbles[1].getAttribute('data-consecutive')).toBe('false')
  })

  it('honors per-message agentId attribution', () => {
    const messages: BrainstormMessage[] = [
      { id: 'a1', role: 'assistant', content: 'hi', agentId: 'chef' },
    ]
    const { container } = render(<IntegratedBrainstorm {...baseProps} messages={messages} agentId="pixel" />)
    const bubble = container.querySelector('[data-testid="assistant-bubble"] > div[style*="border-left-color"]') as HTMLElement
    expect(bubble).toBeTruthy()
    // Chef's color, not pixel's
    expect(bubble.style.borderLeftColor.toLowerCase()).toMatch(/10b981|rgba?\(16,\s*185,\s*129/)
  })

  it('renders tool activity in the assistant-style bubble frame', () => {
    const messages: BrainstormMessage[] = [
      { id: 'u1', role: 'user', content: 'check this' },
      {
        id: 'act1',
        role: 'activity',
        kind: 'tool_call',
        content: 'exec: set -e',
        data: {
          phase: 'call',
          callId: 'call-1',
          toolName: 'exec',
          status: 'running',
          inputPreview: '{"command":"set -e"}',
        },
      },
      { id: 'a1', role: 'assistant', content: 'done' },
    ]
    const { container } = render(<IntegratedBrainstorm {...baseProps} messages={messages} />)
    const activity = container.querySelector('[data-testid="activity-bubble"]')
    expect(activity).toBeTruthy()
    expect(activity!.textContent).toContain('Tool')
    expect(activity!.textContent).toContain('exec')
    expect(activity!.textContent).toContain('running')
    expect(activity!.textContent).toContain('exec: set -e')
    expect(activity!.querySelector('div[style*="border-left-color"]')).toBeTruthy()
    expect(activity!.querySelector('details')?.open).toBe(false)
  })

  it('prefers runtime tool summaries for visible activity text', () => {
    const messages: BrainstormMessage[] = [
      {
        id: 'act1',
        role: 'activity',
        kind: 'tool_call',
        content: "exec: mcporter call --help | sed -n '1,120p'",
        data: {
          phase: 'call',
          callId: 'call-1',
          toolName: 'exec',
          status: 'running',
          summary: 'Checking Bakin tool call syntax',
          inputPreview: '{"command":"mcporter call --help | sed -n \'1,120p\'"}',
        },
      },
    ]
    const { container } = render(<IntegratedBrainstorm {...baseProps} messages={messages} />)
    const activity = container.querySelector('[data-testid="activity-bubble"]')
    const summary = container.querySelector('[data-testid="tool-activity-summary"]')
    expect(activity).toBeTruthy()
    expect(summary?.textContent).toBe('Checking Bakin tool call syntax')
    expect(summary?.textContent).not.toContain('mcporter call --help')
    expect(activity!.textContent).toContain('Input')
  })

  it('groups matching tool call and result activity into one completed row', () => {
    const messages: BrainstormMessage[] = [
      {
        id: 'act-call',
        role: 'activity',
        kind: 'tool_call',
        content: 'exec: gh issue list',
        data: {
          phase: 'call',
          callId: 'call-1',
          toolName: 'exec',
          status: 'running',
          inputPreview: '{"command":"gh issue list"}',
        },
      },
      {
        id: 'act-result',
        role: 'activity',
        kind: 'tool_call',
        content: 'exec completed',
        data: {
          phase: 'result',
          callId: 'call-1',
          toolName: 'exec',
          status: 'completed',
          durationMs: 6605,
          exitCode: 0,
          outputPreview: '[{"type":"text","text":"Found #190"}]',
        },
      },
    ]
    const { container } = render(<IntegratedBrainstorm {...baseProps} messages={messages} />)
    const activities = container.querySelectorAll('[data-testid="activity-bubble"]')
    expect(activities.length).toBe(1)
    expect(activities[0].textContent).toContain('Tool')
    expect(activities[0].textContent).toContain('exec')
    expect(activities[0].textContent).toContain('completed')
    expect(activities[0].textContent).toContain('6.6s')
    expect(activities[0].textContent).toContain('exec: gh issue list')
    expect(activities[0].textContent).toContain('Details')
  })

  it('formats expanded activity details into readable sections', () => {
    const messages: BrainstormMessage[] = [
      {
        id: 'act1',
        role: 'activity',
        kind: 'tool_call',
        content: 'read: plan.md',
        data: {
          phase: 'result',
          callId: 'call-1',
          toolName: 'read',
          status: 'failed',
          exitCode: 1,
          inputPreview: '{"path":"plan.md"}',
          outputPreview: 'No such file',
        },
      },
    ]
    const { container } = render(<IntegratedBrainstorm {...baseProps} messages={messages} />)
    const activity = container.querySelector('[data-testid="activity-bubble"]')!
    expect(activity.textContent).toContain('failed')
    expect(activity.textContent).toContain('Details')
    expect(activity.textContent).toContain('Input')
    expect(activity.textContent).toContain('{"path":"plan.md"}')
    expect(activity.textContent).toContain('Output')
    expect(activity.textContent).toContain('No such file')
    expect(activity.textContent).toContain('Metadata')
    expect(activity.textContent).toContain('exitCode')
  })

  it('hides the message list when collapsed', () => {
    const messages: BrainstormMessage[] = [{ id: 'u1', role: 'user', content: 'hey' }]
    const { container } = render(
      <IntegratedBrainstorm {...baseProps} messages={messages} defaultOpen={false} />,
    )
    expect(container.querySelector('[data-testid="brainstorm-message-list"]')).toBeNull()
  })
})
