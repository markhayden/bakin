// @vitest-environment jsdom
import { describe, expect, it } from 'bun:test'
import { fireEvent, render } from '@testing-library/react'

import {
  ActivityGroup,
  formatDuration,
  humanizeActivity,
  ToolCallRow,
  type ConversationToolCall,
} from '@makinbakin/sdk/conversation'
import '../../rtl-settle'

const call = (over: Partial<ConversationToolCall> = {}): ConversationToolCall => ({
  key: over.callId ?? 'call-1',
  callId: 'call-1',
  toolName: 'web_search',
  status: 'completed',
  summary: 'Found three matching documents',
  durationMs: 1200,
  ...over,
})

describe('focused conversation activity rendering', () => {
  it('uses stable activity language and compact durations', () => {
    expect(humanizeActivity([call()])).toBe('Searched the web')
    expect(humanizeActivity([call({ toolName: 'custom_lookup' })])).toBe('Used custom_lookup')
    expect(humanizeActivity([call(), call({ callId: 'call-2', toolName: 'bash' })])).toBe('Used 2 tools')
    expect(formatDuration(undefined)).toBe('')
    expect(formatDuration(850)).toBe('850ms')
    expect(formatDuration(1200)).toBe('1.2s')
    expect(formatDuration(62_000)).toBe('1m 2s')
  })

  it('names its disclosure, starts collapsed, and exposes group state in visible text', () => {
    const { container, getByRole } = render(
      <ActivityGroup calls={[call(), call({ callId: 'call-2', status: 'failed', durationMs: 800 })]} />,
    )

    const trigger = getByRole('button', { name: /searched the web/i })
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(trigger.textContent).toContain('2 calls')
    expect(trigger.textContent).toContain('1 failed')
    expect(container.querySelector('[data-conv-activity-calls]')).toBeNull()

    fireEvent.click(trigger)
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelectorAll('[data-conv-call]')).toHaveLength(2)
  })

  it('shows a textual status for each call and keeps rows non-interactive without a callback', () => {
    const { container, getByText } = render(
      <div>
        <ToolCallRow call={call({ status: 'running' })} />
        <ToolCallRow call={call({ callId: 'call-2', status: 'failed' })} />
        <ToolCallRow call={call({ callId: 'call-3', status: 'completed' })} />
      </div>,
    )

    expect(getByText('running')).not.toBeNull()
    expect(getByText('failed')).not.toBeNull()
    expect(getByText('completed')).not.toBeNull()
    expect(container.querySelectorAll('button[data-conv-call]')).toHaveLength(0)
  })

  it('keeps the full summary in the accessible row and opens the original call', () => {
    const original = call({ summary: '{"message":"Readable result"}' })
    const opened: ConversationToolCall[] = []
    const { getByRole } = render(
      <ToolCallRow
        call={original}
        formatSummary={() => 'Readable result'}
        onOpen={(selected) => opened.push(selected)}
      />,
    )

    const row = getByRole('button', { name: /web_search.*readable result/i })
    fireEvent.click(row)
    expect(opened).toEqual([original])
  })

  it('renders an honest empty group without inventing activity', () => {
    const { container } = render(<ActivityGroup calls={[]} />)
    expect(container.textContent).toContain('No tool activity')
    expect(container.querySelector('button')).toBeNull()
  })
})
