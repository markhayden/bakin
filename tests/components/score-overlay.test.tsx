// @vitest-environment jsdom
/**
 * Neutral ScoreOverlay (D17): one badge per scoreBreakdown leg by its
 * neutral name — no engine key sniffing; distance legs render as similarity.
 */
import { describe, it, expect, mock, afterEach } from 'bun:test'
import { render, screen } from '@testing-library/react'
import '../rtl-settle'

const contentDirMock = () => ({
  getContentDir: () => '/tmp/bakin-test-score-overlay',
  getBakinPaths: () => ({}),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

import { ScoreOverlay, computeMatchedFields } from '@makinbakin/sdk/patterns'


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

describe('computeMatchedFields', () => {
  it('lists fields whose text contains any query term, case-insensitive', () => {
    expect(computeMatchedFields('Rose bouquet', {
      title: 'A dozen roses',
      description: 'red flowers',
      tags: ['bouquet', 'floral'],
      count: 3,
    })).toEqual(['title', 'tags'])
  })

  it('returns empty for a pure semantic hit (no textual overlap)', () => {
    expect(computeMatchedFields('happiness', { title: 'a dozen roses' })).toEqual([])
  })

  it('ignores one-character terms and empty queries', () => {
    expect(computeMatchedFields('a', { title: 'a dozen roses' })).toEqual([])
    expect(computeMatchedFields('', { title: 'x' })).toEqual([])
  })
})

describe('ScoreOverlay matched-reason line', () => {
  afterEach(() => { document.body.innerHTML = '' })

  it('shows matched fields when provided', () => {
    render(<ScoreOverlay info={{ score: 0.5, matchedFields: ['title', 'caption'] }} />)
    expect(screen.getByTestId('score-overlay-matched').textContent).toBe('matched: title, caption')
  })

  it('labels a pure semantic hit honestly', () => {
    render(<ScoreOverlay info={{ score: 0.5, matchedFields: [] }} />)
    expect(screen.getByTestId('score-overlay-matched').textContent).toBe('semantic match')
  })

  it('renders no matched line when the surface did not compute one', () => {
    render(<ScoreOverlay info={{ score: 0.5 }} />)
    expect(screen.queryAllByTestId('score-overlay-matched').length).toBe(0)
  })
})
