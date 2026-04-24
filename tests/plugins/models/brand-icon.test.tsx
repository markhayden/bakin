// @vitest-environment jsdom
/**
 * Unit tests for BrandIcon — SVG render for known slugs, first-letter
 * chip fallback for unknown / missing slugs, color application.
 */
import { describe, it, expect, afterEach, mock } from 'bun:test'
import { cleanup, render } from '@testing-library/react'
import { join } from 'path'
import { tmpdir } from 'os'

const testDir = join(tmpdir(), `bakin-test-brand-icon-${Date.now()}`)

mock.module('@/core/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../../packages/core/src/content-dir', () => ({
  getContentDir: () => testDir,
  getBakinPaths: () => ({ root: testDir }),
}))
mock.module('../../../plugins/tasks/lib/flow-store', () => ({
  readTaskboard: () => ({ columns: { todo: [], 'in-progress': [], done: [] } }),
  getAllTasks: () => ({ columns: { todo: [], 'in-progress': [], done: [] } }),
  getTask: () => null,
}))

import { BrandIcon } from '../../../plugins/models/components/brand-icon'

afterEach(() => cleanup())

describe('BrandIcon', () => {
  it('renders an SVG for a known slug', () => {
    const { container } = render(<BrandIcon slug="anthropic" />)
    const svg = container.querySelector('svg')
    expect(svg).not.toBeNull()
    expect(svg!.getAttribute('aria-label')).toBe('anthropic')
    expect(container.querySelector('path')).not.toBeNull()
  })

  it('renders a first-letter chip for an unknown slug', () => {
    const { container } = render(<BrandIcon slug="mistral" fallbackText="Mistral" fallbackColor="#ff0000" />)
    expect(container.querySelector('svg')).toBeNull()
    const chip = container.querySelector('span')
    expect(chip).not.toBeNull()
    expect(chip!.textContent).toBe('M')
  })

  it('falls back to ? when no text or slug is provided', () => {
    const { container } = render(<BrandIcon />)
    const chip = container.querySelector('span')
    expect(chip).not.toBeNull()
    expect(chip!.textContent).toBe('?')
  })

  it('applies the fallbackColor as background on the chip', () => {
    const { container } = render(<BrandIcon slug="unknown-brand" fallbackColor="#123456" fallbackText="X" />)
    const chip = container.querySelector('span')!
    // JSDOM normalizes hex to rgb. #123456 = rgb(18, 52, 86)
    expect(chip.getAttribute('style')).toMatch(/rgb\(\s*18,\s*52,\s*86\s*\)/)
  })

  it('uses slug as fallback text when fallbackText is absent', () => {
    const { container } = render(<BrandIcon slug="quasar" />)
    const chip = container.querySelector('span')!
    expect(chip.textContent).toBe('Q')
  })
})
