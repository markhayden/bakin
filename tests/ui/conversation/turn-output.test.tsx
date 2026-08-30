// @vitest-environment jsdom
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, render, screen } from '@testing-library/react'
import '../../rtl-settle'

import {
  TurnOutputView,
  TurnToolChip,
  foldTurnChunks,
  type ConversationChunk,
} from '@makinbakin/sdk/conversation'

afterEach(cleanup)

const text = (content: string, format?: 'markdown' | 'plain' | 'code'): ConversationChunk => ({
  type: 'text',
  content,
  ...(format ? { format } : {}),
})

describe('focused turn output', () => {
  it('uses the shared fold semantics for text, tools, status, errors, and completion', () => {
    const folded = foldTurnChunks([
      text('Hello '),
      text('world'),
      { type: 'tool', data: { phase: 'call', callId: 'read-1', toolName: 'read_file', summary: 'Read the route' } },
      { type: 'tool', data: { phase: 'result', callId: 'read-1', toolName: 'read_file', status: 'completed' } },
      { type: 'status', content: 'checking output' },
      { type: 'error', content: 'Output unavailable', data: { kind: 'transport' } },
      { type: 'done' },
    ])

    expect(folded.segments).toEqual([{ format: 'markdown', text: 'Hello world' }])
    expect(folded.tools).toEqual([{ key: 'read-1', toolName: 'read_file', summary: 'Read the route', status: 'completed' }])
    expect(folded.status).toBe('checking output')
    expect(folded.error).toEqual({ message: 'Output unavailable', kind: 'transport' })
    expect(folded.done).toBe(true)
  })

  it('defaults to safe wrapped text and bounded code while allowing consumer-owned rich text', () => {
    const renderText = mock((content: string, format: string) => (
      <strong data-format={format}>{content}</strong>
    ))
    const { container, rerender } = render(
      <TurnOutputView chunks={[text('**not parsed by default**'), text('const value = 1', 'code')]} />,
    )
    expect(container.querySelector('strong')).toBeNull()
    expect(container.querySelector('pre')?.textContent).toContain('const value = 1')
    expect(container.querySelector('pre')?.classList.contains('overflow-x-auto')).toBe(true)
    expect(container.querySelector('pre')?.getAttribute('tabindex')).toBe('0')
    expect(container.querySelector('pre')?.getAttribute('role')).toBe('group')
    expect(container.querySelector('pre')?.getAttribute('aria-label')).toBe('Code output')

    rerender(<TurnOutputView chunks={[text('Rich answer')]} renderText={renderText} />)
    expect(screen.getByText('Rich answer').tagName).toBe('STRONG')
    expect(renderText).toHaveBeenCalledWith('Rich answer', 'markdown')
  })

  it('renders exact live, failed, and framed states without relying on animation for meaning', () => {
    const { rerender } = render(
      <TurnOutputView chunks={[{ type: 'status', content: 'reading files' }]} live />,
    )
    expect(screen.getByRole('status').textContent).toContain('reading files…')

    rerender(
      <TurnOutputView
        chunks={[text('Result'), { type: 'error', content: 'Turn failed', data: { kind: 'session_died' } }]}
        textFrame={(node) => <section aria-label="Framed output">{node}</section>}
      />,
    )
    expect(screen.getByRole('region', { name: 'Framed output' }).textContent).toContain('Result')
    expect(screen.getByRole('alert').textContent).toContain('Turn failedsession_died')
  })

  it('reuses the exact tool row contract', () => {
    render(<TurnToolChip toolName="bash" summary="Run tests" status="failed" />)
    expect(screen.getByText('bash')).not.toBeNull()
    expect(screen.getByText('failed')).not.toBeNull()
  })
})
