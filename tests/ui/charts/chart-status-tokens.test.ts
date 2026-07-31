import { describe, expect, it } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { CHART_TONE_COLORS } from '@makinbakin/sdk/charts'

/**
 * FROZEN status chart-fill steps.
 *
 * These exact hex values passed the dataviz palette validator on Bakin's dark
 * chart surfaces (#151313 surface-default and #0f0e0e canvas-default):
 *
 *   node <dataviz-skill>/scripts/validate_palette.js \
 *     "#16b05c,#b1353b,#9c7907" --mode dark --surface "#151313" --pairs all
 *
 *   → all-pairs CVD ΔE 8.2 (target ≥ 8), normal-vision floor 17.4 (≥ 15),
 *     lightness band, chroma floor, and ≥ 3:1 contrast all PASS on both
 *     surfaces. The attention step is deliberately ΔE 8.6 from the
 *     categorical amber slot (#c98500) so a status wedge never impersonates
 *     a series; neutral (#aeaaaa) clears ΔE ≥ 10 CVD against every status
 *     step and 8:1 contrast.
 *
 * Changing ANY of these values without re-running the validator silently
 * un-validates every outcome chart. If this test fails, re-run the validator
 * against the new values (and the amber-vs-categorical separation check)
 * before updating the expectations.
 */
const FROZEN_STATUS_HEX = {
  success: '#16b05c',
  danger: '#b1353b',
  attention: '#9c7907',
  neutral: '#aeaaaa',
} as const

describe('status chart-fill token freeze', () => {
  const css = readFileSync(
    join(import.meta.dir, '../../../packages/ui/src/styles/tokens.generated.css'),
    'utf8',
  )

  it.each(Object.entries(FROZEN_STATUS_HEX))(
    'pins --bakin-color-data-status-%s to its validated hex',
    (tone, hex) => {
      expect(css).toContain(`--bakin-color-data-status-${tone}: ${hex};`)
    },
  )

  it('keeps the chart kit tone map pointing at the frozen tokens', () => {
    expect(CHART_TONE_COLORS).toEqual({
      success: 'var(--bakin-color-data-status-success)',
      danger: 'var(--bakin-color-data-status-danger)',
      attention: 'var(--bakin-color-data-status-attention)',
      neutral: 'var(--bakin-color-data-status-neutral)',
    })
  })
})
