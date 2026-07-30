// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '../../rtl-settle'

import {
  AreaChart,
  CHART_SERIES_COLORS,
  type ChartDatum,
  type ChartSeries,
} from '@makinbakin/sdk/charts'

afterEach(cleanup)

const series: ChartSeries[] = [
  { key: 'completed', label: 'Completed' },
  { key: 'failed', label: 'Failed' },
]

// Default geometry: height 200 → plot spans y 12..172 (160px) in a 640px viewBox.
const TOP = 12
const PLOT_HEIGHT = 160

describe('AreaChart', () => {
  it('breaks the single-series fill at a missing value instead of collapsing to zero', () => {
    const data: ChartDatum[] = [
      { x: 'one', values: { completed: 4 } },
      { x: 'two', values: { completed: 6 } },
      { x: 'three', values: {}, missingLabels: { completed: 'Still processing' } },
      { x: 'four', values: { completed: 8 } },
      { x: 'five', values: { completed: 9 } },
    ]
    const { container } = render(
      <AreaChart data={data} series={[series[0]!]} label="Completed work" />,
    )

    const fills = container.querySelectorAll('path[data-series-fill="completed"]')
    expect(fills).toHaveLength(2)
    for (const fill of fills) {
      expect(fill.getAttribute('d')?.trim().endsWith('Z')).toBe(true)
      expect(fill.getAttribute('stroke')).toBe('none')
    }
    expect(container.querySelectorAll('path[data-series="completed"]')).toHaveLength(2)
    expect(screen.getAllByRole('img')).toHaveLength(4)
    expect(screen.queryByRole('img', { name: /three/i })).toBeNull()
    expect(screen.getByRole('cell', { name: 'Still processing', hidden: true }).getAttribute('data-missing')).toBe('true')
  })

  it('stacks cumulative bands and positions marks on their series upper boundary', () => {
    const data: ChartDatum[] = [
      { x: 'one', values: { completed: 2, failed: 3 } },
      { x: 'two', values: { completed: 4, failed: 1 } },
    ]
    const { container } = render(
      <AreaChart data={data} series={series} label="Stacked outcomes" stacked />,
    )

    // Column totals are both 5, so the stacked domain max is 5.
    const cy = (name: string) => Number(screen.getByRole('img', { name }).getAttribute('cy'))
    expect(cy('one — Completed: 2')).toBeCloseTo(TOP + (1 - 2 / 5) * PLOT_HEIGHT, 6)
    expect(cy('one — Failed: 3')).toBeCloseTo(TOP, 6)
    expect(cy('two — Completed: 4')).toBeCloseTo(TOP + (1 - 4 / 5) * PLOT_HEIGHT, 6)
    expect(cy('two — Failed: 1')).toBeCloseTo(TOP, 6)
    // The failed band sits above the completed band it stacks on.
    expect(cy('one — Failed: 3')).toBeLessThan(cy('one — Completed: 2'))

    // One continuous band per series, separated by a 2px surface stroke.
    const fills = container.querySelectorAll('path[data-series-fill]')
    expect(fills).toHaveLength(2)
    for (const fill of fills) {
      expect(fill.getAttribute('stroke')).toBe('var(--bakin-color-surface-default)')
      expect(fill.getAttribute('stroke-width')).toBe('2')
    }

    // Tooltip mirrors the series' own value, not the cumulative boundary.
    fireEvent.focus(screen.getByRole('img', { name: 'two — Failed: 1' }))
    expect(screen.getByRole('tooltip').textContent).toContain('two — Failed: 1')
    expect(screen.getByRole('list', { name: 'Stacked outcomes legend' }).textContent).toContain('Failed')
  })

  it('omits a missing series from a stacked column but keeps the band boundaries and names the omission', () => {
    const data: ChartDatum[] = [
      { x: 'one', values: { completed: 3, failed: 2 } },
      { x: 'two', values: { completed: 4 }, missingLabels: { failed: 'Awaiting report' } },
      { x: 'three', values: { completed: 5, failed: 1 } },
    ]
    const { container } = render(
      <AreaChart data={data} series={series} label="Reported work" stacked />,
    )

    // Band boundaries stay continuous: one fill and one identity line per series.
    expect(container.querySelectorAll('path[data-series-fill]')).toHaveLength(2)
    expect(container.querySelectorAll('path[data-series="failed"]')).toHaveLength(1)
    // No mark for the omitted series at the missing column; neighbors keep theirs.
    expect(screen.queryByRole('img', { name: /two — Failed/ })).toBeNull()
    expect(screen.getByRole('img', { name: 'one — Failed: 2' })).toBeDefined()
    expect(screen.getByRole('img', { name: 'three — Failed: 1' })).toBeDefined()
    // At the missing column the failed band collapses onto the completed boundary.
    const completedTwo = Number(screen.getByRole('img', { name: 'two — Completed: 4' }).getAttribute('cy'))
    const failedLine = container.querySelector('path[data-series="failed"]')!.getAttribute('d')!
    const middleY = Number(failedLine.split('L')[1]!.trim().split(' ')[1])
    expect(middleY).toBeCloseTo(completedTwo, 6)
    // The omission is surfaced through the exact table's missing-label affordance.
    expect(screen.getByRole('cell', { name: 'Awaiting report', hidden: true }).getAttribute('data-missing')).toBe('true')
  })

  it('assigns fixed palette slots by sorted key instead of cycling declaration order', () => {
    const { container } = render(
      <AreaChart
        data={[
          { x: 'one', values: { zeta: 1, alpha: 2 } },
          { x: 'two', values: { zeta: 2, alpha: 3 } },
        ]}
        series={[
          { key: 'zeta', label: 'Zeta' },
          { key: 'alpha', label: 'Alpha' },
        ]}
        label="Palette assignment"
      />,
    )

    expect(container.querySelector('path[data-series="alpha"]')?.getAttribute('stroke')).toBe(CHART_SERIES_COLORS[0])
    expect(container.querySelector('path[data-series="zeta"]')?.getAttribute('stroke')).toBe(CHART_SERIES_COLORS[1])
    expect(container.querySelector('path[data-series-fill="alpha"]')?.getAttribute('fill')).toBe(CHART_SERIES_COLORS[0])
  })

  it('renders a named empty state that retains the exact-data path', () => {
    render(<AreaChart data={[]} series={series} label="Unobserved work" />)
    expect(screen.getByRole('status').textContent).toBe('No reported data in this window.')
    expect(screen.getByRole('table', { name: 'Unobserved work data', hidden: true })).toBeTruthy()
  })
})
