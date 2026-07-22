// @vitest-environment jsdom

import { afterEach, describe, expect, it, mock } from 'bun:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '../rtl-settle'

// Pure client component, but pin the resolvers per the repo-wide
// test-isolation rules so nothing transitive can reach ~/.bakin.
const isolationDir = join(tmpdir(), `bakin-test-plugin-header-${Date.now()}`)
mock.module('../../src/core/content-dir', () => ({
  getContentDir: () => isolationDir,
}))
mock.module('../../packages/core/src/content-dir', () => ({
  getContentDir: () => isolationDir,
}))

let warmState: 'cold' | 'warming' | 'warm' = 'warm'

mock.module('@/hooks/use-search-warm', () => ({
  useSearchWarm: mock(() => warmState),
}))

import { PluginHeader } from '../../src/components/plugin-header'

afterEach(() => {
  warmState = 'warm'
  mock.clearAllMocks()
})

describe('PluginHeader search + warm indicator', () => {
  it('debounces keystrokes into onChange', async () => {
    const onChange = mock()
    render(
      <PluginHeader
        title="Assets"
        search={{ value: '', onChange, placeholder: 'Search assets...', debounce: 10 }}
      />,
    )

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'diagram' } })

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('diagram'))
  })

  it('keeps the accessible search name independent from its visual hint', () => {
    render(
      <PluginHeader
        title="Assets"
        search={{
          value: '',
          onChange: () => {},
          label: 'Search indexed assets',
          placeholder: 'Filter by title or type…',
        }}
      />,
    )

    expect(screen.getByRole('searchbox', { name: 'Search indexed assets' })).toBeDefined()
  })

  it('NEVER blocks input while warming — the indicator is display-only', async () => {
    // Regression guard: an earlier iteration held keystrokes until the warm
    // signal flipped, which froze every search bar (including client-side
    // filters) whenever boot warm-up or background indexing ran long. The
    // warming state must only change the icon/tooltip.
    warmState = 'warming'
    const onChange = mock()
    render(
      <PluginHeader
        title="Assets"
        search={{ value: '', onChange, placeholder: 'Search assets...', debounce: 10 }}
      />,
    )

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'diagram' } })

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('diagram'))
  })

  it('keeps heading, search, and actions in one stable row when its container has room', () => {
    render(
      <PluginHeader
        title="A deliberately long operational page title"
        subtitle="Fresh evidence from every required source"
        count={12}
        meta={<span>Checked 2 minutes ago</span>}
        search={{ value: '', onChange: () => {}, placeholder: 'Search records...' }}
        actions={<button type="button">Run checks</button>}
      />,
    )

    const root = screen.getByTestId('plugin-header')
    const layout = screen.getByTestId('plugin-header-layout')
    const heading = screen.getByTestId('plugin-header-heading')
    const controls = screen.getByTestId('plugin-header-controls')
    const search = screen.getByTestId('plugin-header-search')

    expect(root.className).toContain('@container/plugin-header')
    expect(layout.className).toContain('@3xl/plugin-header:grid-cols')
    expect(heading.className).toContain('min-w-0')
    expect(heading.className).toContain('flex-col')
    expect(controls.className).toContain('@3xl/plugin-header:flex-nowrap')
    expect(search.className).toContain('max-w-full')
    expect(search.className).toContain('@3xl/plugin-header:w-[22rem]')
    expect(search.className).toContain('@3xl/plugin-header:shrink-0')
    expect(search.querySelector('[data-slot="search-input-control"]')?.className).toContain('motion-reduce:transition-none')
    expect(search.className).not.toContain('focus-within:basis-[32rem]')
    expect(screen.getByText('Fresh evidence from every required source').className).not.toContain('truncate')
    expect(screen.getByRole('button', { name: 'Run checks' })).toBeDefined()
  })

  it('keeps supporting copy on its own row beneath the page title', () => {
    render(
      <PluginHeader
        title="Health"
        subtitle="Act on current issues, compare agents, review activity, and inspect system evidence."
        count={4}
        meta={<span>Checked just now</span>}
        actions={<button type="button">Run checks</button>}
      />,
    )

    const heading = screen.getByTestId('plugin-header-heading')
    const titleRow = screen.getByTestId('plugin-header-title-row')
    const subtitle = screen.getByText(/Act on current issues/)

    expect(heading.className).toContain('flex-col')
    expect(titleRow.className).toContain('flex-wrap')
    expect(titleRow.compareDocumentPosition(subtitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(subtitle.className).toContain('w-full')
    expect(titleRow.textContent).toContain('Health')
    expect(titleRow.textContent).toContain('4')
    expect(titleRow.textContent).not.toContain('Act on current issues')
  })

  it('places additive breadcrumbs above the title without truncating them', () => {
    render(
      <PluginHeader
        title="Search indexes"
        breadcrumbs={(
          <nav aria-label="Breadcrumb">
            <a href="/health">Health</a>
            <span aria-hidden="true"> / </span>
            <span>System</span>
          </nav>
        )}
      />,
    )

    const breadcrumbs = screen.getByTestId('plugin-header-breadcrumbs')
    const title = screen.getByRole('heading', { level: 1, name: 'Search indexes' })
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeDefined()
    expect(breadcrumbs.className).toContain('break-words')
    expect(breadcrumbs.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
