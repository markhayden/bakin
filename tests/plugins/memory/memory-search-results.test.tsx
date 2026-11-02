// @vitest-environment jsdom

/**
 * Tests for plugins/memory/components/memory-search-results.tsx.
 *
 * The component renders rows from the `bakin_memory` unified table. Each
 * row must show the tier status label (the whole point of cross-tier search) and
 * enough identity — agent, title, snippet — to be useful at a glance.
 * Selection is optional: a page without an onSelect handler still renders,
 * but the callback fires with the full SearchResult when provided.
 */
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { useEffect, type ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import '../../rtl-settle'

// Defensive isolation per CLAUDE.md — this component never reads from disk,
// but keeping these in place guarantees no accidental regression can ever
// write into ~/.bakin/ or ~/.openclaw/ from this test file.
mock.module('@bakin/core/main-agent', () => ({
  getMainAgentId: () => 'main',
  tryGetMainAgentId: () => 'main',
  getMainAgentName: () => 'Main',
}))

mock.module('../../../src/core/content-dir', () => {
  const { join: j } = require('path') as typeof import('path')
  const { tmpdir: t } = require('os') as typeof import('os')
  const base = j(t(), `bakin-test-memory-search-results-mock`)
  return {
    getContentDir: () => base,
    getBakinPaths: () => ({ root: base, plugins: j(base, 'plugin-settings') }),
  }
})
mock.module('../../../packages/core/src/content-dir', () => {
  const { join: j } = require('path') as typeof import('path')
  const { tmpdir: t } = require('os') as typeof import('os')
  const base = j(t(), `bakin-test-memory-search-results-mock`)
  return {
    getContentDir: () => base,
    getBakinPaths: () => ({ root: base, plugins: j(base, 'plugin-settings') }),
  }
})

import { MEMORY_COLUMN_WIDTHS, MemorySearchResults } from '../../../plugins/memory/components/memory-search-results'
import type { SearchResult } from '../../../packages/sdk/src/hooks/use-search'
import { useDebug } from '../../../packages/sdk/src/hooks/use-debug'

function row(overrides: Partial<SearchResult> & { tier?: string; agent?: string; title?: string }): SearchResult {
  const { tier = 'session', agent = 'explorer', title = 'A result', ...rest } = overrides
  return {
    id: rest.id ?? `${tier}:${Math.random().toString(36).slice(2, 8)}`,
    table: 'bakin_memory',
    score: rest.score ?? 0.8,
    fields: {
      tier,
      agent,
      title,
      snippet: rest.fields?.snippet ?? 'Short snippet of content.',
      // Epoch ms — matches lib/types.ts `updatedAt: z.number()`. A string here
      // masked a dead column and a no-op sort.
      updated_at: rest.fields?.updated_at ?? Date.parse('2026-04-17T10:00:00.000Z'),
      ...(rest.fields ?? {}),
    },
  }
}

afterEach(() => cleanup())

// Assert wide cells here; the dedicated narrow test exercises the second render.
const cells = () => within(screen.getByRole('table', { name: 'Memory results' }))

describe('MemorySearchResults', () => {
  it('uses separated narrow rows with labelled metadata and the same record activation', () => {
    const target = row({ id: 'session:mobile', title: 'Mobile record' })
    const onSelect = mock()
    render(<MemorySearchResults results={[target]} loading={false} error={null} query="" onSelect={onSelect} />)
    const list = screen.getByRole('list', { name: 'Memory results' })
    expect(list.getAttribute('data-variant')).toBe('separated')
    expect(list.textContent).toContain('Updated')
    expect(list.textContent).toContain('Agent')
    fireEvent.click(within(list).getByRole('button', { name: 'Open Mobile record' }))
    expect(onSelect).toHaveBeenCalledWith(target)
  })
  it('renders nothing special when query is empty', () => {
    const { container } = render(
      <MemorySearchResults results={[]} loading={false} error={null} query="" />,
    )
    expect(container.textContent).not.toMatch(/no results/i)
    expect(container.querySelectorAll('[data-memory-result]').length).toBe(0)
    expect(container.querySelector('[data-scope="section"]')).not.toBeNull()
  })

  it('shows loading skeletons while fetching', () => {
    const { container } = render(<MemorySearchResults results={[]} loading={true} error={null} query="q" />)
    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0)
  })

  it('shows an error banner when error is set', () => {
    render(<MemorySearchResults results={[]} loading={false} error="boom" query="q" />)
    expect(screen.getByText(/boom/)).toBeDefined()
  })

  it('shows an empty-state message when a non-empty query returns no results', () => {
    render(<MemorySearchResults results={[]} loading={false} error={null} query="needle" />)
    // EmptyState renders both a title ("No results") and a description
    // ("No results for "needle"") — either one satisfies the contract.
    expect(screen.getAllByText(/no results/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/needle/)).toBeDefined()
  })

  it('renders one low-chrome row per result with title, tier status, and agent', () => {
    render(
      <MemorySearchResults
        results={[
          row({ id: 'session:a', tier: 'session', agent: 'explorer', title: 'Session A' }),
          row({ id: 'daily_note:b', tier: 'daily_note', agent: 'chef', title: 'Daily B' }),
          row({ id: 'audit:c', tier: 'audit', agent: 'explorer', title: 'Audit C' }),
        ]}
        agents={[
          { id: 'explorer', name: 'Explorer', imageSrc: '/agents/explorer.png' },
          { id: 'chef', name: 'Chef' },
        ]}
        loading={false}
        error={null}
        query="q"
      />,
    )
    expect(screen.getByRole('table').querySelectorAll('[data-memory-result]').length).toBe(3)
    expect(screen.getByRole('table').querySelectorAll('[data-status-badge]').length).toBe(3)
    expect(cells().getByText('Session A')).toBeDefined()
    expect(cells().getByText('Daily B')).toBeDefined()
    expect(cells().getByText('Audit C')).toBeDefined()
    // Tier labels — the component formats daily_note → "Daily Note".
    expect(screen.getAllByText(/session/i).length).toBeGreaterThan(0)
    expect(cells().getByText(/daily note/i)).toBeDefined()
    expect(screen.getAllByText(/audit/i).length).toBeGreaterThan(0)
    // Agents surface somewhere in the output.
    expect(screen.getAllByText('Explorer').length).toBeGreaterThan(0)
    expect(cells().getByText('Chef')).toBeDefined()
    expect(screen.getByRole('table').querySelectorAll('[data-agent-avatar]').length).toBe(3)
    expect(screen.getByRole('table').querySelectorAll('[data-agent-id="explorer"]').length).toBe(2)

    // Tier identity rides the badge TEXT on a neutral StatusBadge — the raw
    // per-tier color families were retired in the storybook refit (T6.5).
    expect(cells().getByText('Session').closest('[data-status-badge]')?.getAttribute('data-tone')).toBe('neutral')
    expect(cells().getByText('Daily Note').closest('[data-status-badge]')?.getAttribute('data-tone')).toBe('neutral')
    expect(cells().getByText('Audit').closest('[data-status-badge]')?.getAttribute('data-tone')).toBe('neutral')
  })

  it('uses the shared small-card row treatment to separate adjacent results', () => {
    render(
      <MemorySearchResults
        results={[
          row({ id: 'session:a', title: 'First bounded row' }),
          row({ id: 'session:b', title: 'Second bounded row' }),
        ]}
        loading={false}
        error={null}
        query=""
      />,
    )

    const rows = document.querySelectorAll('[data-memory-result]')
    expect(rows).toHaveLength(2)
    // Results are comparable records, so they ride the kit DataTable now —
    // the small-Card chrome they used to sit in is intentionally gone.
    for (const result of rows) {
      expect(result.closest('[data-slot="table-row"]')).not.toBeNull()
    }
  })

  it('renders the snippet for each result', () => {
    render(
      <MemorySearchResults
        results={[
          row({
            id: 'session:x',
            fields: { tier: 'session', agent: 'explorer', title: 'X', snippet: 'unique-snippet-phrase' },
          }),
        ]}
        loading={false}
        error={null}
        query="q"
      />,
    )
    expect(cells().getByText(/unique-snippet-phrase/)).toBeDefined()
  })

  it('turns markdown-heavy source content into a quiet one-line summary', () => {
    render(
      <MemorySearchResults
        results={[
          row({
            id: 'durable:markdown',
            fields: {
              tier: 'durable',
              agent: 'pixel',
              title: 'Image generation',
              snippet: '## Image Generation\n\n**Always** use the approved prompt. `internal-only`',
            },
          }),
        ]}
        loading={false}
        error={null}
        query=""
      />,
    )

    expect(cells().getByText('Always use the approved prompt. internal-only')).toBeDefined()
    expect(document.querySelector('[data-memory-summary]')?.className).toContain('line-clamp-1')
  })

  it('fires onSelect with the full SearchResult when a row is clicked', () => {
    const onSelect = mock()
    const target = row({ id: 'session:a', title: 'Clickable' })
    render(
      <MemorySearchResults
        results={[target]}
        loading={false}
        error={null}
        query="q"
        onSelect={onSelect}
      />,
    )
    // DataTable puts the activation affordance on the row itself.
    const resultRow = cells().getByLabelText(/open clickable/i)
    fireEvent.click(resultRow)
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith(target)
  })

  it('uses native non-interactive rows when selection is unavailable', () => {
    render(
      <MemorySearchResults
        results={[row({ id: 'session:a', title: 'Read only' })]}
        loading={false}
        error={null}
        query="q"
      />,
    )
    expect(screen.queryByRole('button', { name: /open read only/i })).toBeNull()
    expect(document.querySelector('[data-memory-result]')?.tagName).toBe('TR')
  })

  // #1040 — under automatic table layout the snippet's long single line
  // out-weighed every title, so Title collapsed to a few characters and broke
  // mid-word while Snippet took the row. The layout is declared instead:
  // fixed table layout, a width share for Title, content widths for the
  // metadata, Snippet as the one flexible column. The real-browser geometry
  // lives in memory-table-layout.browser.test.ts; this pins the contract.
  describe('column widths (#1040)', () => {
    const longTitle = 'exec:bakin_exec_assets_save:launch-hero-v3-final-approved-render-2026-01-15'
    const renderRows = () => render(
      <MemorySearchResults
        results={[
          row({ id: 'session:dotted', title: 'assets.asset.saved' }),
          row({ id: 'session:exec', title: longTitle, fields: {
            tier: 'session', agent: 'explorer', title: longTitle,
            snippet: 'A snippet long enough to claim the whole row under automatic table layout. '.repeat(4),
          } }),
        ]}
        loading={false}
        error={null}
        query=""
      />,
    )

    it('declares a fixed table layout so content can never redistribute the columns', () => {
      renderRows()
      expect(screen.getByRole('table', { name: 'Memory results' }).className).toContain('table-fixed')
    })

    it('gives Title a width share and the metadata columns their own widths; Snippet is the only flexible column', () => {
      renderRows()
      const header = (name: string) => cells().getByRole('columnheader', { name: new RegExp(`^${name}`) })
      expect(header('Title').className).toContain(MEMORY_COLUMN_WIDTHS.title)
      expect(header('Tier').className).toContain(MEMORY_COLUMN_WIDTHS.tier)
      expect(header('Agent').className).toContain(MEMORY_COLUMN_WIDTHS.agent)
      expect(header('Updated').className).toContain(MEMORY_COLUMN_WIDTHS.updated)
      expect(header('Snippet').className).not.toMatch(/\bw-/)
      // A percentage share, not a pixel width: Title scales with the table.
      expect(MEMORY_COLUMN_WIDTHS.title).toMatch(/^w-\[\d+%\]$/)
    })

    it('clamps Title to two lines, breaks inside a word only as a last resort, and keeps the full title reachable', () => {
      renderRows()
      // Both renders mount (the list is container-query hidden); measure the table's.
      const titles = Array.from(screen.getByRole('table', { name: 'Memory results' }).querySelectorAll<HTMLElement>('[data-memory-title]'))
      expect(titles.map((node) => node.textContent)).toEqual(['assets.asset.saved', longTitle])
      for (const node of titles) {
        expect(node.className).toContain('line-clamp-2')
        // overflow-wrap: anywhere let the browser shrink Title to one
        // character per line; break-word only splits a word wider than the column.
        expect(node.className).not.toContain('anywhere')
        expect(node.closest('td')?.className).toContain('wrap-break-word')
        expect(node.closest('td')?.className).not.toContain('wrap-anywhere')
        expect(node.getAttribute('title')).toBe(node.textContent)
      }
      const snippet = screen.getByRole('table', { name: 'Memory results' }).querySelector<HTMLElement>('[data-memory-summary]')
      expect(snippet?.className).toContain('line-clamp-1')
      expect(snippet?.className).not.toContain('anywhere')
    })

    it('beside the debug Score column, Title cedes a little share and the table hands off to the list one step earlier', () => {
      // Global debug + an active query is the only way the Score column appears.
      function DebugOn({ children }: { children: ReactNode }) {
        const [debug, toggleDebug] = useDebug()
        useEffect(() => { if (!debug) toggleDebug() }, [debug, toggleDebug])
        return debug ? children : null
      }
      render(
        <DebugOn>
          <MemorySearchResults results={[row({ id: 'session:a', title: 'Scored' })]} loading={false} error={null} query="scored" />
        </DebugOn>,
      )
      const header = (name: string) => cells().getByRole('columnheader', { name: new RegExp(`^${name}`) })
      expect(header('Score').className).toContain(MEMORY_COLUMN_WIDTHS.score)
      expect(header('Title').className).toContain(MEMORY_COLUMN_WIDTHS.titleBesideScore)
      expect(header('Title').className).not.toContain(MEMORY_COLUMN_WIDTHS.title)
      const tableMode = screen.getByRole('table', { name: 'Memory results' }).closest('[data-slot="data-table-table"]')
      expect(tableMode?.className).toContain('@3xl/data-table:block')
      expect(tableMode?.className).not.toContain('@2xl/data-table:block')
    })

    it('keeps the date on one line', () => {
      renderRows()
      const updated = cells().getAllByText('Apr 17, 2026')[0]?.closest('td')
      expect(updated?.className).toContain('whitespace-nowrap')
    })
  })

  it('falls back gracefully when fields are missing', () => {
    render(
      <MemorySearchResults
        results={[
          {
            id: 'missing:1',
            table: 'bakin_memory',
            score: 0.5,
            fields: { tier: 'durable' }, // no agent/title/snippet
          },
        ]}
        loading={false}
        error={null}
        query="q"
      />,
    )
    // Should still render without throwing; tier badge still there.
    expect(document.querySelectorAll('[data-memory-result]').length).toBe(1)
    expect(cells().getByText(/durable/i)).toBeDefined()
  })
})
