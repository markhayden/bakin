// @vitest-environment jsdom
/**
 * Neutral ScoreOverlay (D17): one badge per scoreBreakdown leg by its
 * neutral name — no engine key sniffing; distance legs render as similarity.
 */
import { describe, it, expect, mock, afterEach } from 'bun:test'
import { render, cleanup, screen } from '@testing-library/react'

const contentDirMock = () => ({
  getContentDir: () => '/tmp/bakin-test-score-overlay',
  getBakinPaths: () => ({}),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

import { ScoreOverlay } from '../../src/components/score-overlay'

afterEach(cleanup)

describe('ScoreOverlay', () => {
  it('renders the fused score and one badge per neutral leg', () => {
    render(<ScoreOverlay info={{ score: 0.0486, indexScores: { full_text: 0.7549, assets_text: -0.1733, assets_visual: -0.7040 } }} />)
    const overlay = screen.getByTestId('score-overlay')
    expect(overlay.textContent).toContain('RRF 0.0486')
    expect(overlay.textContent).toContain('FT 0.7549')          // positive leg passes through
    expect(overlay.textContent).toContain('TEXT 0.8267')        // 1 + (-0.1733) similarity
    expect(overlay.textContent).toContain('VISUAL 0.2960')      // 1 + (-0.7040)
  })

  it('renders arbitrary leg names without any hardcoded keys', () => {
    render(<ScoreOverlay info={{ score: 1, indexScores: { my_custom_leg: -0.5 } }} />)
    expect(screen.getByTestId('score-overlay').textContent).toContain('LEG 0.5000')
  })

  it('renders only the fused score when no breakdown is present', () => {
    render(<ScoreOverlay info={{ score: 0.5 }} />)
    const overlay = screen.getByTestId('score-overlay')
    expect(overlay.textContent).toBe('RRF 0.5000')
  })
})
