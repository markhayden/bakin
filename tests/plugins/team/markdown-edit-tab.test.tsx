// @vitest-environment jsdom

/**
 * Wiring contract for MarkdownEditTab — the Assets-style view/edit
 * pattern reused by Soul / Rules / Tools tabs in agent-detail.
 *
 * Covers: default view-mode renders MarkdownContent, pencil → edit
 * mode, save POSTs to the right endpoint, Cancel reverts, Cmd+S
 * triggers save when dirty (and not when clean), missing file
 * shows the "does not exist" empty state.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '../../rtl-settle'
import { join } from 'path'
import { tmpdir } from 'os'
import { rmSync } from 'fs'

const testDir = join(tmpdir(), `bakin-test-markdown-edit-${Date.now()}-${Math.random().toString(36).slice(2)}`)

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

// MarkdownContent renders raw text in tests so we can assert on content.
mock.module('@makinbakin/sdk/components', () => ({
  MarkdownContent: ({ content }: { content: string }) => <div data-testid="markdown">{content}</div>,
}))

import { MarkdownEditTab } from '../../../plugins/team/components/markdown-edit-tab'
import { settleFor } from '../../helpers/wait'

const fetchCalls: Array<{ url: string; init?: RequestInit }> = []

function setupFetch(opts: { ok?: boolean } = {}) {
  fetchCalls.length = 0
  global.fetch = mock((url: RequestInfo | URL, init?: RequestInit) => {
    fetchCalls.push({ url: String(url), init })
    return Promise.resolve({ ok: opts.ok ?? true, json: () => Promise.resolve({ ok: true }) } as Response)
  }) as unknown as typeof global.fetch
}

afterAll(() => {
  try { rmSync(testDir, { recursive: true, force: true }) } catch {}
})

beforeEach(() => {
  setupFetch()
})

describe('MarkdownEditTab', () => {
  it('renders the markdown view by default with the pencil button visible', () => {
    render(<MarkdownEditTab agentId="pixel" filename="SOUL.md" initialContent="# Pixel persona" />)
    expect(screen.getByTestId('markdown').textContent).toBe('# Pixel persona')
    expect(screen.getByLabelText('Edit markdown')).toBeDefined()
    expect(screen.queryByLabelText('Save changes')).toBeNull()
  })

  it('shows the empty-state message when initialContent is null', () => {
    render(<MarkdownEditTab agentId="pixel" filename="SOUL.md" initialContent={null} />)
    expect(screen.getByText(/does not exist/)).toBeDefined()
    expect(screen.queryByLabelText('Edit markdown')).toBeNull()
  })

  it('switches to edit mode and shows save+cancel when pencil is clicked', () => {
    render(<MarkdownEditTab agentId="pixel" filename="SOUL.md" initialContent="hello" />)
    fireEvent.click(screen.getByLabelText('Edit markdown'))
    expect(screen.getByLabelText('Save changes')).toBeDefined()
    expect(screen.getByLabelText('Cancel edit')).toBeDefined()
    expect(screen.queryByLabelText('Edit markdown')).toBeNull()
    // Textarea is the edit surface
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(textarea.value).toBe('hello')
  })

  it('save button stays disabled until the user types something different', () => {
    render(<MarkdownEditTab agentId="pixel" filename="SOUL.md" initialContent="hello" />)
    fireEvent.click(screen.getByLabelText('Edit markdown'))
    const save = screen.getByLabelText('Save changes') as HTMLButtonElement
    expect(save.disabled).toBe(true)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hello world' } })
    expect((screen.getByLabelText('Save changes') as HTMLButtonElement).disabled).toBe(false)
  })

  it('POSTs the new content to /api/plugins/team/:agentId/files/:filename', async () => {
    render(<MarkdownEditTab agentId="pixel" filename="SOUL.md" initialContent="hello" />)
    fireEvent.click(screen.getByLabelText('Edit markdown'))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'updated body' } })
    fireEvent.click(screen.getByLabelText('Save changes'))

    await waitFor(() => expect(fetchCalls.length).toBe(1))
    const call = fetchCalls[0]
    expect(call.url).toBe('/api/plugins/team/pixel/files/SOUL.md')
    expect(call.init?.method).toBe('PUT')
    expect(JSON.parse(call.init?.body as string)).toEqual({ content: 'updated body' })
  })

  it('exits edit mode and shows the new content after a successful save', async () => {
    render(<MarkdownEditTab agentId="pixel" filename="SOUL.md" initialContent="hello" />)
    fireEvent.click(screen.getByLabelText('Edit markdown'))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'updated body' } })
    fireEvent.click(screen.getByLabelText('Save changes'))

    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull())
    expect(screen.getByTestId('markdown').textContent).toBe('updated body')
    expect(screen.getByLabelText('Edit markdown')).toBeDefined()
  })

  it('Cancel exits edit mode and discards local changes', () => {
    render(<MarkdownEditTab agentId="pixel" filename="SOUL.md" initialContent="hello" />)
    fireEvent.click(screen.getByLabelText('Edit markdown'))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'never persisted' } })
    fireEvent.click(screen.getByLabelText('Cancel edit'))

    expect(screen.queryByRole('textbox')).toBeNull()
    expect(screen.getByTestId('markdown').textContent).toBe('hello')
    expect(fetchCalls.length).toBe(0)
  })

  it('Cmd+S triggers save when dirty', async () => {
    render(<MarkdownEditTab agentId="pixel" filename="SOUL.md" initialContent="hello" />)
    fireEvent.click(screen.getByLabelText('Edit markdown'))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'changed' } })
    fireEvent.keyDown(window, { key: 's', metaKey: true })
    await waitFor(() => expect(fetchCalls.length).toBe(1))
  })

  it('Cmd+S is a no-op when nothing has changed', async () => {
    render(<MarkdownEditTab agentId="pixel" filename="SOUL.md" initialContent="hello" />)
    fireEvent.click(screen.getByLabelText('Edit markdown'))
    fireEvent.keyDown(window, { key: 's', metaKey: true })
    await settleFor(30, 'cmd-S outside edit mode must NOT save — a fetch never firing is the assertion')
    expect(fetchCalls.length).toBe(0)
  })
})
