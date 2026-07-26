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

// Keep the test focused on host-owned persistence and mode state.
mock.module('@makinbakin/sdk/content', () => ({
  MarkdownEditor: ({
    label,
    content,
    mode,
    onChange,
  }: {
    label: string
    content: string
    mode: 'edit' | 'preview'
    onChange: (content: string) => void
  }) => mode === 'edit'
    ? <textarea aria-label={label} value={content} onChange={(event) => onChange(event.target.value)} />
    : <div role="region" aria-label={`${label} preview`} data-testid="markdown">{content}</div>,
}))

import { MarkdownEditTab } from '../../../plugins/team/components/markdown-edit-tab'

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

  it('keeps the edit action beside the filename and the description below them', () => {
    render(<MarkdownEditTab agentId="pixel" filename="SOUL.md" initialContent="# Pixel persona" />)

    const header = screen.getByRole('heading', { level: 2, name: 'SOUL.md' })
      .closest('[data-slot="markdown-file-header"]')
    const titleRow = screen.getByRole('heading', { level: 2, name: 'SOUL.md' })
      .closest('[data-slot="markdown-file-title-row"]')
    const description = screen.getByText('Rendered from the current workspace file.')
    const edit = screen.getByLabelText('Edit markdown')

    expect(header).not.toBeNull()
    expect(titleRow).not.toBeNull()
    expect(titleRow?.contains(edit)).toBe(true)
    expect(header?.contains(description)).toBe(true)
    expect(titleRow?.contains(description)).toBe(false)
    expect(description.getAttribute('data-slot')).toBe('markdown-file-description')
  })

  it('shows the empty-state message when initialContent is null', () => {
    render(<MarkdownEditTab agentId="pixel" filename="SOUL.md" initialContent={null} />)
    expect(screen.getByText(/does not exist/)).toBeDefined()
    expect(screen.queryByLabelText('Edit markdown')).toBeNull()
  })

  it('switches to edit mode and reveals draft actions after a change', () => {
    render(<MarkdownEditTab agentId="pixel" filename="SOUL.md" initialContent="hello" />)
    fireEvent.click(screen.getByLabelText('Edit markdown'))
    expect(screen.queryByLabelText('Edit markdown')).toBeNull()
    const textarea = screen.getByRole('textbox') as HTMLTextAreaElement
    expect(textarea.value).toBe('hello')
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
    fireEvent.change(textarea, { target: { value: 'hello world' } })
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDefined()
    expect(screen.getByRole('button', { name: 'Cancel edit' })).toBeDefined()
  })

  it('keeps save actions hidden until the user types something different', () => {
    render(<MarkdownEditTab agentId="pixel" filename="SOUL.md" initialContent="hello" />)
    fireEvent.click(screen.getByLabelText('Edit markdown'))
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'hello world' } })
    expect((screen.getByRole('button', { name: 'Save changes' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('POSTs the new content to /api/plugins/team/:agentId/files/:filename', async () => {
    render(<MarkdownEditTab agentId="pixel" filename="SOUL.md" initialContent="hello" />)
    fireEvent.click(screen.getByLabelText('Edit markdown'))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'updated body' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

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
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull())
    expect(screen.getByTestId('markdown').textContent).toBe('updated body')
    expect(screen.getByLabelText('Edit markdown')).toBeDefined()
  })

  it('Cancel exits edit mode and discards local changes', () => {
    render(<MarkdownEditTab agentId="pixel" filename="SOUL.md" initialContent="hello" />)
    fireEvent.click(screen.getByLabelText('Edit markdown'))
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'never persisted' } })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel edit' }))

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
    // Wait briefly so any spurious fetch would have fired.
    await new Promise((r) => setTimeout(r, 30))
    expect(fetchCalls.length).toBe(0)
  })
})
