// @vitest-environment jsdom

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'bun:test'

import '../../rtl-settle'
import type { SearchResult } from '../../../src/hooks/use-search'
import { MemoryDetailDrawer } from '../../../plugins/memory/components/memory-detail-drawer'

const durableResult: SearchResult = {
  id: 'durable:321bfb6ddc36f4a6',
  table: 'bakin_memory',
  score: 2,
  fields: {
    tier: 'durable',
    agent: 'pixel',
    title: 'Image Generation vs Editing',
    content: 'Use the approved prompt and save the final image through Assets.',
    source_backend: 'runtime',
    source_path: '/workspace/pixel/AGENTS.md',
    created_at: Date.parse('2026-07-20T12:00:00.000Z'),
    updated_at: Date.parse('2026-07-24T12:00:00.000Z'),
    meta: JSON.stringify({ file: 'AGENTS.md', chunkIndex: 2 }),
  },
}

afterEach(cleanup)

describe('MemoryDetailDrawer', () => {
  it('uses the canonical drawer hierarchy, semantic tier color, and roster identity', () => {
    render(
      <MemoryDetailDrawer
        result={durableResult}
        agents={[{ id: 'pixel', name: 'Pixel', imageSrc: '/agents/pixel.png' }]}
        open
        onOpenChange={() => undefined}
      />,
    )

    const dialog = screen.getByRole('dialog', { name: 'Image Generation vs Editing' })
    expect(dialog).toBeDefined()
    expect(screen.getByRole('heading', { level: 2, name: 'Image Generation vs Editing' })).toBeDefined()
    // Tier pill is a neutral StatusBadge; the label alone carries tier identity (refit T6.5).
    expect(screen.getByText('Durable').closest('[data-status-badge]')?.getAttribute('data-tone')).toBe('neutral')
    expect(document.querySelector('[data-agent-avatar][data-agent-id="pixel"]')).not.toBeNull()
    expect(screen.getByText('Pixel')).toBeDefined()

    expect(screen.getByRole('heading', { name: 'Source' })).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Content' })).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Index metadata' })).toBeDefined()
    expect(screen.getByText('/workspace/pixel/AGENTS.md')).toBeDefined()
    expect(screen.getByText(/approved prompt/)).toBeDefined()
    expect(document.querySelectorAll('[data-slot="drawer-section"]')).toHaveLength(3)

    // Record facts are the kit KeyValue contract (columns layout), not a
    // per-surface <dl> grid: label column beside its value, stacking narrow.
    const facts = document.querySelector('[data-memory-record-details]')
    expect(facts?.getAttribute('data-slot')).toBe('key-value')
    expect(facts?.getAttribute('data-layout')).toBe('columns')
    expect(facts?.querySelectorAll('dt')).toHaveLength(3)
    expect(facts?.querySelectorAll('dd')).toHaveLength(3)
  })

  it('always exposes technical identifiers in the Index metadata section', () => {
    render(
      <MemoryDetailDrawer
        result={durableResult}
        open
        onOpenChange={() => undefined}
      />,
    )

    const dialog = screen.getByRole('dialog', { name: 'Image Generation vs Editing' })
    const drawer = within(dialog)
    expect(drawer.queryByRole('button', { name: 'Technical details' })).toBeNull()
    expect(drawer.getByText('durable:321bfb6ddc36f4a6')).toBeDefined()
    expect(drawer.getByText(/chunkIndex/)).toBeDefined()
    expect(drawer.getByText('2.000')).toBeDefined()
    // Raw metadata rides the kit CodeBlock — one code surface, tokenized by
    // the component rather than a fabricated markdown fence.
    const code = dialog.querySelector('[data-slot="code-block"][data-language="json"]')
    expect(code).not.toBeNull()
    expect(code?.querySelector('.text-bakin-syntax-key')).not.toBeNull()
    expect(code?.querySelector('.text-bakin-syntax-number')).not.toBeNull()
    // The identifiers a reader actually copies carry a copy action.
    expect(drawer.getByRole('button', { name: 'Copy row ID' })).toBeDefined()
    expect(drawer.getByRole('button', { name: 'Copy Raw metadata' })).toBeDefined()
  })
})
