// @vitest-environment jsdom
import { describe, expect, it } from 'bun:test'
import { fireEvent, render } from '@testing-library/react'

import {
  ScoreOverlay,
  SearchDegradedChip,
  SearchPartialChip,
  SearchUnavailable,
  computeMatchedFields,
} from '@makinbakin/sdk/patterns'
import '../../rtl-settle'

describe('focused search trust patterns', () => {
  it('renders an explicit unavailable state with recovery and consumer routing actions', () => {
    let retries = 0
    const { getByRole, getByText } = render(
      <SearchUnavailable
        retry={() => { retries += 1 }}
        healthAction={<a href="/health">Open health</a>}
      />,
    )

    expect(getByRole('alert').textContent).toContain('Search is unavailable')
    expect(getByText(/Browsing and filters still work/)).not.toBeNull()
    fireEvent.click(getByRole('button', { name: 'Retry' }))
    expect(retries).toBe(1)
    expect(getByRole('link', { name: 'Open health' }).getAttribute('href')).toBe('/health')
  })

  it('supports hosts without a health route', () => {
    const { getByRole, queryByRole } = render(<SearchUnavailable healthAction={null} />)

    expect(getByRole('alert').textContent).toContain('Search is unavailable')
    expect(queryByRole('link', { name: 'Open health' })).toBeNull()
    expect(queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('discloses basic fallback quality in visible copy', () => {
    const { getByRole } = render(<SearchDegradedChip fallbackLabel="title matching" />)
    expect(getByRole('status').textContent).toContain('showing title matching')
  })

  it('names every budget-limited source on the partial-results control', () => {
    const { getByRole } = render(
      <SearchPartialChip
        meta={{
          partial: true,
          tables: [
            { table: 'bakin_assets', hits: 3, took_ms: 220, budget: 'degraded' },
            { table: 'bakin_memory', hits: 0, took_ms: 480, budget: 'omitted' },
          ],
        }}
      />,
    )

    const disclosure = getByRole('button', { name: /Partial results/ })
    expect(disclosure.getAttribute('aria-label')).toContain('assets: keyword-only (220ms)')
    expect(disclosure.getAttribute('aria-label')).toContain('memory: no answer in time (480ms)')
  })

  it('does not render a partial indicator for complete responses', () => {
    const { container } = render(<SearchPartialChip meta={{ partial: false }} />)
    expect(container.innerHTML).toBe('')
  })
})

describe('focused search score evidence', () => {
  it('renders fused, per-leg, and textual-match evidence without color-only meaning', () => {
    const { getByRole } = render(
      <ScoreOverlay
        info={{
          score: 0.0486,
          indexScores: { full_text: 0.7549, assets_visual: -0.704 },
          matchedFields: ['title', 'caption'],
        }}
      />,
    )
    const evidence = getByRole('note', { name: 'Search relevance details' })
    expect(evidence.textContent).toContain('RRF 0.0486')
    expect(evidence.textContent).toContain('FT 0.7549')
    expect(evidence.textContent).toContain('VISUAL 0.2960')
    expect(evidence.textContent).toContain('matched: title, caption')
  })

  it('computes an honest client-side textual-match approximation', () => {
    expect(computeMatchedFields('Rose bouquet', {
      title: 'A dozen roses',
      tags: ['bouquet', 'floral'],
      count: 3,
    })).toEqual(['title', 'tags'])
    expect(computeMatchedFields('happiness', { title: 'a dozen roses' })).toEqual([])
  })
})
