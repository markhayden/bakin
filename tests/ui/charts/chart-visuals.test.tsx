// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '../../rtl-settle'

import {
  BarChart,
  CHART_OTHER_COLOR,
  CHART_SERIES_COLORS,
  LineChart,
  StackedColumnChart,
  type ChartDatum,
  type ChartSeries,
} from '@makinbakin/sdk/charts'

afterEach(cleanup)

const series: ChartSeries[] = [
  { key: 'completed', label: 'Completed' },
  { key: 'failed', label: 'Failed' },
]

describe('LineChart', () => {
  it('leaves missing values as visual gaps and exact-table missing cells', () => {
    const data: ChartDatum[] = [
      { x: 'one', values: { completed: 4 } },
      { x: 'two', values: { completed: 6 } },
      { x: 'three', values: {}, missingLabels: { completed: 'Still processing' } },
      { x: 'four', values: { completed: 8 } },
      { x: 'five', values: { completed: 9 } },
    ]
    const { container } = render(
      <LineChart data={data} series={[series[0]!]} label="Completed work" />,
    )

    expect(container.querySelectorAll('path[data-series="completed"]')).toHaveLength(2)
    expect(screen.getAllByRole('img')).toHaveLength(4)
    expect(screen.queryByRole('img', { name: /three/i })).toBeNull()
    expect(screen.getByRole('cell', { name: 'Still processing', hidden: true }).getAttribute('data-missing')).toBe('true')
  })

  it('mirrors pointer detail on focus and distinguishes series without color alone', () => {
    const { container } = render(
      <LineChart
        data={[
          { x: 'one', values: { completed: 4, failed: 2 } },
          { x: 'two', values: { completed: 7, failed: 1 } },
        ]}
        series={series}
        label="Run outcomes"
      />,
    )
    const failed = screen.getByRole('img', { name: 'two — Failed: 1' })
    fireEvent.focus(failed)
    expect(screen.getByRole('tooltip').textContent).toContain('two — Failed: 1')
    expect(container.querySelector('path[data-series="failed"]')?.hasAttribute('stroke-dasharray')).toBe(true)
    expect(screen.getByRole('list', { name: 'Run outcomes legend' }).textContent).toContain('Completed')
    expect(screen.getByRole('list', { name: 'Run outcomes legend' }).textContent).toContain('Failed')
  })

  it('anchors boundary labels inside the plot', () => {
    const { container } = render(
      <LineChart
        data={[
          { x: 'first', values: { completed: 4 } },
          { x: 'last', xLabel: 'A deliberately long final label', values: { completed: 7 } },
        ]}
        series={[series[0]!]}
        label="Run outcomes"
      />,
    )
    const labels = Array.from(container.querySelectorAll('text'))
    expect(labels.find((node) => node.textContent === 'first')?.getAttribute('text-anchor')).toBe('start')
    expect(labels.find((node) => node.textContent?.endsWith('…'))?.getAttribute('text-anchor')).toBe('end')
  })
})

describe('BarChart', () => {
  it('does not render an invented bar for missing data and preserves a reported zero exactly', () => {
    const { container } = render(
      <BarChart
        data={[
          { x: 'missing', values: {}, missingLabels: { completed: 'Not collected' } },
          { x: 'zero', values: { completed: 0 } },
          { x: 'reported', values: { completed: 5 } },
        ]}
        series={[series[0]!]}
        label="Completed work"
      />,
    )

    expect(container.querySelectorAll('rect[data-series="completed"]')).toHaveLength(1)
    expect(screen.queryByRole('img', { name: /missing/i })).toBeNull()
    const table = screen.getByRole('table', { name: 'Completed work data', hidden: true })
    expect(table.textContent).toContain('Not collected')
    expect(table.textContent).toContain('0')
  })

  it('supports an explicit stacked comparison with focus-equivalent exact values', () => {
    render(
      <BarChart
        data={[
          { x: 'one', values: { completed: 4, failed: 2 } },
          { x: 'two', values: { completed: 7, failed: 1 } },
        ]}
        series={series}
        label="Stacked outcomes"
        stacked
      />,
    )
    const failed = screen.getByRole('img', { name: 'two — Failed: 1' })
    fireEvent.focus(failed)
    expect(screen.getByRole('tooltip').textContent).toContain('two — Failed: 1')
    expect(screen.getByRole('table', { name: 'Stacked outcomes data', hidden: true }).textContent).toContain('7')
  })
})

describe('StackedColumnChart', () => {
  it('uses all eight stable series slots before folding later entities into Other', () => {
    const keys = Array.from({ length: 10 }, (_, index) => `agent-${String(index).padStart(2, '0')}`)
    render(
      <StackedColumnChart
        data={[{ x: 'today', values: Object.fromEntries(keys.map((key, index) => [key, index + 1])) }]}
        seriesKeys={keys}
      />,
    )

    expect(screen.getByRole('button', { name: 'agent-00' }).querySelector<HTMLElement>('[data-slot="chart-legend-swatch"]')?.style.backgroundColor)
      .toBe(CHART_SERIES_COLORS[0])
    expect(screen.getByRole('button', { name: 'agent-07' }).querySelector<HTMLElement>('[data-slot="chart-legend-swatch"]')?.style.backgroundColor)
      .toBe(CHART_SERIES_COLORS[7])
    expect(screen.getByRole('button', { name: 'Other (2)' }).querySelector<HTMLElement>('[data-slot="chart-legend-swatch"]')?.style.backgroundColor)
      .toBe(CHART_OTHER_COLOR)
  })

  it('names a wholly missing bucket by default and keeps the exact table honest', () => {
    render(
      <StackedColumnChart
        data={[
          { x: 'one', values: { completed: 3 } },
          { x: 'two', values: {}, missingLabels: { completed: 'Awaiting report' } },
        ]}
        seriesKeys={['completed']}
        label="Reported work"
      />,
    )

    const missing = screen.getByRole('img', { name: 'two: Not reported' })
    expect(missing.getAttribute('data-missing')).toBe('true')
    fireEvent.focus(missing)
    expect(screen.getByRole('tooltip').textContent).toContain('Not reported')
    expect(screen.getByRole('table', { name: 'Reported work data', hidden: true }).textContent).toContain('Awaiting report')
  })
})
