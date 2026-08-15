// @vitest-environment jsdom

/**
 * ActiveContextTab — read-only render of the agent's most recent
 * session JSONL parsed into a message stream.
 *
 * Covers: loading, error, empty, populated, role badges per message,
 * truncation banner, bounded turn records, JSON content in the kit CodeBlock,
 * and plain or text-block content rendered via MarkdownContent.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { act, render, screen, waitFor } from '@testing-library/react'
import '../../rtl-settle'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync } from 'fs'

const testDir = join(tmpdir(), `bakin-test-active-context-${Date.now()}-${Math.random().toString(36).slice(2)}`)

mock.module('@/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({}) }))
mock.module('../../../src/core/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({}) }))
mock.module('../../../packages/core/src/content-dir', () => ({ getContentDir: () => testDir, getBakinPaths: () => ({}) }))
mock.module('@bakin/adapter-openclaw/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))
mock.module('../../../packages/adapter-openclaw/src/home', () => ({
  getOpenClawHome: () => join(testDir, 'openclaw'),
  getOpenClawPath: (...parts: string[]) => join(testDir, 'openclaw', ...parts),
  resetOpenClawHome: () => {},
}))

mock.module('@makinbakin/sdk/content', () => ({
  MarkdownContent: ({ content }: { content: string }) => <div data-testid="markdown">{content}</div>,
}))

import { ActiveContextTab } from '../../../plugins/team/components/active-context-tab'

interface TranscriptBody {
  ok: boolean
  transcript: {
    sessionId: string
    sessionStarted: string | null
    messages: Array<{ role: string; content: string; model?: string; ts?: string; toolName?: string }>
    truncated: boolean
    totalMessages: number
  } | null
  error?: string
}

function setupFetch(body: TranscriptBody) {
  global.fetch = mock(() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(body) } as Response),
  ) as unknown as typeof global.fetch
}

afterAll(() => {
  try { rmSync(testDir, { recursive: true, force: true }) } catch {}
})

describe('ActiveContextTab', () => {
  it('renders the loading state before the fetch resolves', async () => {
    let resolveFetch: (value: Response) => void
    global.fetch = mock(
      () => new Promise<Response>((res) => { resolveFetch = res }),
    ) as unknown as typeof global.fetch

    await act(async () => {
      render(<ActiveContextTab agentId="pixel" />)
    })
    expect(screen.getByText(/Loading session context/)).toBeDefined()
    // Resolve INSIDE act so the resulting re-render lands in this test rather
    // than during the settle hook — the loading assertion above already ran.
    await act(async () => {
      resolveFetch!({ ok: true, json: () => Promise.resolve({ ok: true, transcript: null }) } as Response)
    })
    await waitFor(() => expect(screen.getByText(/No session context yet/)).toBeDefined())
  })

  it('renders the empty state when transcript is null', async () => {
    setupFetch({ ok: true, transcript: null })
    await act(async () => {
      render(<ActiveContextTab agentId="pixel" />)
    })
    await waitFor(() => expect(screen.getByText(/No session context yet/)).toBeDefined())
  })

  it('renders the empty state when transcript has zero messages', async () => {
    setupFetch({
      ok: true,
      transcript: { sessionId: 'sess-x', sessionStarted: null, messages: [], truncated: false, totalMessages: 0 },
    })
    await act(async () => {
      render(<ActiveContextTab agentId="pixel" />)
    })
    await waitFor(() => expect(screen.getByText(/No session context yet/)).toBeDefined())
  })

  it('renders one row per message with the right role badge', async () => {
    setupFetch({
      ok: true,
      transcript: {
        sessionId: 'sess-1',
        sessionStarted: '2026-04-25T10:00:00Z',
        messages: [
          { role: 'system', content: 'You are Pixel.' },
          { role: 'user', content: 'Hello.' },
          { role: 'assistant', content: 'Hi back.', model: 'claude-opus-4-7' },
          { role: 'tool', content: '{"ok":true}', toolName: 'bakin_exec_log' },
        ],
        truncated: false,
        totalMessages: 4,
      },
    })
    await act(async () => {
      render(<ActiveContextTab agentId="pixel" />)
    })
    await waitFor(() => expect(screen.getByText('system')).toBeDefined())
    expect(screen.getByText('user')).toBeDefined()
    expect(screen.getByText('assistant')).toBeDefined()
    expect(screen.getByText('tool')).toBeDefined()
    expect(screen.getByText('bakin_exec_log')).toBeDefined()
    expect(screen.getByText('claude-opus-4-7')).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Current session' })).toBeDefined()
    expect(screen.getByText('4 turns')).toBeDefined()
    expect(screen.getByRole('article', { name: 'Turn 1: system' })).toBeDefined()
    expect(screen.getByRole('article', { name: 'Turn 4: tool' })).toBeDefined()
  })

  it('shows the truncation banner when transcript.truncated is true', async () => {
    setupFetch({
      ok: true,
      transcript: {
        sessionId: 'sess-big',
        sessionStarted: null,
        messages: [{ role: 'user', content: 'last' }],
        truncated: true,
        totalMessages: 500,
      },
    })
    await act(async () => {
      render(<ActiveContextTab agentId="pixel" />)
    })
    await waitFor(() => expect(screen.getByText(/Showing latest 1 of 500 messages/)).toBeDefined())
  })

  it('renders text content via MarkdownContent', async () => {
    setupFetch({
      ok: true,
      transcript: {
        sessionId: 'sess-md',
        sessionStarted: null,
        messages: [{ role: 'user', content: '# Heading' }],
        truncated: false,
        totalMessages: 1,
      },
    })
    await act(async () => {
      render(<ActiveContextTab agentId="pixel" />)
    })
    await waitFor(() => expect(screen.getByTestId('markdown')).toBeDefined())
    expect(screen.getByTestId('markdown').textContent).toBe('# Heading')
  })

  it('renders text-block arrays as readable content with expandable structured detail', async () => {
    setupFetch({
      ok: true,
      transcript: {
        sessionId: 'sess-blocks',
        sessionStarted: null,
        messages: [{
          role: 'assistant',
          content: JSON.stringify([{ type: 'text', text: 'Drafted the outline.' }], null, 2),
          model: 'gpt-5.5',
        }],
        truncated: false,
        totalMessages: 1,
      },
    })
    render(<ActiveContextTab agentId="pixel" />)
    await waitFor(() => expect(screen.getByTestId('markdown')).toBeDefined())
    expect(screen.getByTestId('markdown').textContent).toBe('Drafted the outline.')
    expect(screen.getByText('Structured message')).toBeDefined()
    // Syntax highlighting splits JSON into per-token spans, so no single
    // element holds a key/value pair — assert on the code block's own text.
    const structured = document.querySelector('[data-slot="code-block"]')
    expect(structured).not.toBeNull()
    expect(structured!.textContent).toContain('"type": "text"')
  })

  it('renders tool/JSON content in the kit code block, not markdown', async () => {
    setupFetch({
      ok: true,
      transcript: {
        sessionId: 'sess-tool',
        sessionStarted: null,
        messages: [{ role: 'tool', content: '{\n  "ok": true\n}', toolName: 't' }],
        truncated: false,
        totalMessages: 1,
      },
    })
    await act(async () => {
      render(<ActiveContextTab agentId="pixel" />)
    })
    await waitFor(() => {
      const block = document.querySelector('[data-slot="code-block"]')
      expect(block).not.toBeNull()
      expect(block!.textContent).toContain('"ok": true')
    })
    // Markdown stub should not have been used for tool content
    expect(screen.queryByTestId('markdown')).toBeNull()
  })

  it('renders an error state when the API returns ok:false', async () => {
    setupFetch({ ok: false, transcript: null, error: 'denied' })
    await act(async () => {
      render(<ActiveContextTab agentId="pixel" />)
    })
    await waitFor(() => expect(screen.getByText('denied')).toBeDefined())
  })
})
