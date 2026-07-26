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
    expect(screen.getByText('Durable').closest('[data-status-badge]')?.className).toContain('cyan')
    expect(document.querySelector('[data-agent-avatar][data-agent-id="pixel"]')).not.toBeNull()
    expect(screen.getByText('Pixel')).toBeDefined()

    expect(screen.getByRole('heading', { name: 'Source' })).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Content' })).toBeDefined()
    expect(screen.getByRole('heading', { name: 'Index metadata' })).toBeDefined()
    expect(screen.getByText('/workspace/pixel/AGENTS.md')).toBeDefined()
    expect(screen.getByText(/approved prompt/)).toBeDefined()
    expect(document.querySelectorAll('[data-slot="bakin-drawer-section"]')).toHaveLength(3)

    const factRows = document.querySelectorAll(
      '[data-memory-record-details] [data-memory-record-detail]',
    )
    expect(factRows).toHaveLength(3)
    for (const row of factRows) {
      expect(row.className).toContain('border-t')
      expect(row.className).toContain('py-bakin-3')
    }
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
    expect(dialog.querySelector('[data-md-code] code.language-json')).not.toBeNull()
    expect(dialog.querySelector('[data-md-code] .hljs-attr')).not.toBeNull()
    expect(dialog.querySelector('[data-md-code] .hljs-number')).not.toBeNull()
  })
})
