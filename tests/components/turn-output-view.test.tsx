// @vitest-environment jsdom
/**
 * TurnOutputView — the single turn-chunk renderer. Pins each chunk kind's
 * rendering (markdown vs mono text, tool-chip folding, the live thinking
 * status, typed error rows) and the foldTurnChunks semantics the chat and
 * step-output surfaces rely on.
 */
import { afterEach, describe, expect, it, mock } from 'bun:test'
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
import type { RuntimeChatChunk } from '@makinbakin/sdk/types'

import { TurnOutputView, foldTurnChunks } from '@makinbakin/sdk/components'

afterEach(cleanup)

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
  it('renders markdown text through the markdown renderer', () => {
    const { container } = render(<TurnOutputView chunks={[text('**bold** move')]} />)
    expect(container.querySelector('strong')?.textContent).toBe('bold')
    expect(container.textContent).toContain('bold move')
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
