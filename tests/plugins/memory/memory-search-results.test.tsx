// @vitest-environment jsdom

/**
 * Tests for plugins/memory/components/memory-search-results.tsx.
 *
 * The component renders rows from the `bakin_memory` unified table. Each
 * row must show the tier badge (the whole point of cross-tier search) and
 * enough identity — agent, title, snippet — to be useful at a glance.
 * Selection is optional: a page without an onSelect handler still renders,
 * but the callback fires with the full SearchResult when provided.
 */
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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

mock.module('@/components/ui/badge', () => ({
  Badge: ({ children, ...props }: Record<string, unknown>) => (
    <span data-testid="badge" {...props}>{children as React.ReactNode}</span>
  ),
}))
mock.module('@/components/ui/card', () => ({
  Card: ({ children, onClick, ...props }: Record<string, unknown>) => (
    <div data-testid="card" onClick={onClick as () => void} {...props}>{children as React.ReactNode}</div>
  ),
}))
import { MemorySearchResults } from '../../../plugins/memory/components/memory-search-results'
import type { SearchResult } from '../../../src/hooks/use-search'

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
      updated_at: rest.fields?.updated_at ?? '2026-04-17T10:00:00.000Z',
      ...(rest.fields ?? {}),
    },
  }
}

afterEach(() => cleanup())

describe('MemorySearchResults', () => {
  it('renders nothing special when query is empty', () => {
    const { container } = render(
      <MemorySearchResults results={[]} loading={false} error={null} query="" />,
    )
    expect(container.textContent).not.toMatch(/no results/i)
    expect(container.querySelectorAll('[data-testid="card"]').length).toBe(0)
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

  it('renders one card per result with title, tier badge, and agent', () => {
    render(
      <MemorySearchResults
        results={[
          row({ id: 'session:a', tier: 'session', agent: 'explorer', title: 'Session A' }),
          row({ id: 'daily_note:b', tier: 'daily_note', agent: 'chef', title: 'Daily B' }),
          row({ id: 'audit:c', tier: 'audit', agent: 'explorer', title: 'Audit C' }),
        ]}
        loading={false}
        error={null}
        query="q"
      />,
    )
    expect(screen.getAllByTestId('card').length).toBe(3)
    expect(screen.getByText('Session A')).toBeDefined()
    expect(screen.getByText('Daily B')).toBeDefined()
    expect(screen.getByText('Audit C')).toBeDefined()
    // Tier labels — the component formats daily_note → "Daily Note".
    expect(screen.getAllByText(/session/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/daily note/i)).toBeDefined()
    expect(screen.getAllByText(/audit/i).length).toBeGreaterThan(0)
    // Agents surface somewhere in the output.
    expect(screen.getAllByText(/explorer/i).length).toBeGreaterThan(0)
    expect(screen.getByText(/chef/)).toBeDefined()
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
    expect(screen.getByText(/unique-snippet-phrase/)).toBeDefined()
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
    fireEvent.click(screen.getByText('Clickable'))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onSelect).toHaveBeenCalledWith(target)
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
    expect(screen.getAllByTestId('card').length).toBe(1)
    expect(screen.getByText(/durable/i)).toBeDefined()
  })
})
