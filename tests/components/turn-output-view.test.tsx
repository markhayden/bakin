// @vitest-environment jsdom
/**
 * TurnOutputView — the single turn-chunk renderer. Pins each chunk kind's
 * rendering (markdown vs mono text, tool-chip folding, the live thinking
 * status, typed error rows) and the foldTurnChunks semantics the chat and
 * step-output surfaces rely on.
 */
import { describe, expect, it, mock } from 'bun:test'
import { join } from 'path'
import { tmpdir } from 'os'

// Pure client rendering — the content-dir mocks are belt-and-braces per the
// isolation rules (the components barrel transitively reaches app modules).
const testDir = join(tmpdir(), `bakin-test-turn-output-view-${Date.now()}`)
mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))

import { cleanup, render } from '@testing-library/react'
import '../rtl-settle'
import type { RuntimeChatChunk } from '@makinbakin/sdk/types'

import { TurnOutputView, foldTurnChunks } from '@makinbakin/sdk/conversation'

const text = (content: string, format?: 'markdown' | 'plain' | 'code'): RuntimeChatChunk =>
  ({ type: 'text', content, ...(format ? { format } : {}) })

describe('foldTurnChunks', () => {
  it('merges consecutive same-format text and splits on format change', () => {
    const folded = foldTurnChunks([text('Hello '), text('world'), text('raw', 'plain'), text(' bytes', 'plain')])
    expect(folded.segments).toEqual([
      { format: 'markdown', text: 'Hello world' },
      { format: 'plain', text: 'raw bytes' },
    ])
  })

  it('folds tool call/result pairs by callId and keeps the call summary on summary-less results', () => {
    const folded = foldTurnChunks([
      { type: 'tool', data: { phase: 'call', callId: 'c1', toolName: 'bash', summary: 'ls -la' } },
      { type: 'tool', data: { phase: 'result', callId: 'c1', toolName: 'bash', status: 'completed' } },
    ])
    expect(folded.tools).toEqual([{ key: 'c1', toolName: 'bash', summary: 'ls -la', status: 'completed' }])
  })

  it('pairs a callId-less result with the last RUNNING chip for the same tool (no stuck spinner)', () => {
    // OpenClaw can omit callId (toolCallId ?? undefined) — the result must
    // close the running chip, not open an unmatched duplicate.
    const folded = foldTurnChunks([
      { type: 'tool', data: { phase: 'call', toolName: 'bash', summary: 'ls' } },
      { type: 'tool', data: { phase: 'result', toolName: 'bash', status: 'completed' } },
    ])
    expect(folded.tools).toHaveLength(1)
    expect(folded.tools[0]).toMatchObject({ toolName: 'bash', summary: 'ls', status: 'completed' })
  })

  it('callId-less pairing closes the MOST RECENT running chip and leaves earlier ones alone', () => {
    const folded = foldTurnChunks([
      { type: 'tool', data: { phase: 'call', toolName: 'bash', summary: 'first' } },
      { type: 'tool', data: { phase: 'call', toolName: 'bash', summary: 'second' } },
      { type: 'tool', data: { phase: 'result', toolName: 'bash', status: 'completed' } },
    ])
    expect(folded.tools).toHaveLength(2)
    expect(folded.tools[0]).toMatchObject({ summary: 'first', status: 'running' })
    expect(folded.tools[1]).toMatchObject({ summary: 'second', status: 'completed' })
  })

  it('a callId-less result with no matching running chip renders as a settled chip (no crash)', () => {
    const folded = foldTurnChunks([
      { type: 'tool', data: { phase: 'result', toolName: 'web_fetch', status: 'failed', summary: 'timeout' } },
    ])
    expect(folded.tools).toEqual([
      expect.objectContaining({ toolName: 'web_fetch', status: 'failed', summary: 'timeout' }),
    ])
  })

  it('latest status wins; done and error mark terminal state with typed kind', () => {
    const folded = foldTurnChunks([
      { type: 'status', content: 'thinking' },
      { type: 'status', content: 'reading files' },
      { type: 'error', content: 'boom', data: { kind: 'transport' } },
      { type: 'done' },
    ])
    expect(folded.status).toBe('reading files')
    expect(folded.error).toEqual({ message: 'boom', kind: 'transport' })
    expect(folded.done).toBe(true)
  })
})

describe('TurnOutputView rendering', () => {
  it('renders markdown through a consumer-owned renderText; default keeps the text visible', () => {
    const rich = render(
      <TurnOutputView chunks={[text('**bold** move')]} renderText={(content) => <strong>{content}</strong>} />,
    )
    expect(rich.container.querySelector('strong')?.textContent).toBe('**bold** move')
    cleanup()

    // Rich rendering is consumer-owned; the kit default never drops content.
    const { container } = render(<TurnOutputView chunks={[text('**bold** move')]} />)
    expect(container.textContent).toContain('**bold** move')
  })

  it('renders plain/code text as a mono block, not markdown', () => {
    const { container } = render(<TurnOutputView chunks={[text('# not a heading', 'plain')]} />)
    const pre = container.querySelector('pre')
    expect(pre?.textContent).toBe('# not a heading')
    expect(container.querySelector('h1')).toBeNull()
  })

  it('renders a running tool chip that settles to completed, and marks failures', () => {
    const running = render(
      <TurnOutputView chunks={[{ type: 'tool', data: { phase: 'call', callId: 'c1', toolName: 'bash' } }]} />,
    )
    expect(running.container.querySelector('.animate-spin')).not.toBeNull()
    expect(running.container.textContent).toContain('bash')
    cleanup()

    const failed = render(
      <TurnOutputView
        chunks={[{ type: 'tool', data: { phase: 'result', callId: 'c1', toolName: 'bash', status: 'failed' } }]}
      />,
    )
    expect(failed.container.querySelector('.animate-spin')).toBeNull()
    expect(failed.container.textContent).toContain('failed')
  })

  it('shows the thinking status while live with no text, and drops it once text arrives', () => {
    const thinking = render(<TurnOutputView chunks={[{ type: 'status', content: 'thinking' }]} live />)
    expect(thinking.container.textContent).toContain('thinking…')
    cleanup()

    const noStatus = render(<TurnOutputView chunks={[]} live />)
    expect(noStatus.container.textContent).toContain('thinking…')
    cleanup()

    const withText = render(
      <TurnOutputView chunks={[{ type: 'status', content: 'thinking' }, text('answer')]} live />,
    )
    expect(withText.container.textContent).not.toContain('thinking…')
    expect(withText.container.textContent).toContain('answer')
    cleanup()

    const notLive = render(<TurnOutputView chunks={[{ type: 'status', content: 'thinking' }]} />)
    expect(notLive.container.textContent).not.toContain('thinking…')
  })

  it('renders an error row carrying the typed kind', () => {
    const { container } = render(
      <TurnOutputView chunks={[{ type: 'error', content: 'turn failed hard', data: { kind: 'session_died' } }]} />,
    )
    expect(container.textContent).toContain('turn failed hard')
    expect(container.textContent).toContain('session_died')
  })

  it('done chunks render nothing and never throw; textFrame wraps only the text block', () => {
    const { container } = render(
      <TurnOutputView
        chunks={[text('framed'), { type: 'done' }]}
        textFrame={(t) => <div data-testid="frame">{t}</div>}
      />,
    )
    expect(container.querySelector('[data-testid="frame"]')?.textContent).toContain('framed')
  })
})
