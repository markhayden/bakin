// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '../../rtl-settle'

import {
  BarChart,
  CHART_OTHER_COLOR,
  CHART_SERIES_COLORS,
  LineChart,
  RankedBarChart,
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

  it('places tooltips below points at the plot ceiling so bounded overflow cannot clip them', () => {
    render(
      <LineChart
        data={[
          { x: 'low', values: { completed: 0 } },
          { x: 'high', values: { completed: 10 } },
        ]}
        series={[series[0]!]}
        label="Ceiling-safe trend"
      />,
    )

    fireEvent.focus(screen.getByRole('img', { name: 'high — Completed: 10' }))

    expect(screen.getByRole('tooltip').getAttribute('data-placement')).toBe('below')
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

  it('draws straight segments by default and monotone cubics with smooth, leaving marks and table untouched', () => {
    const data: ChartDatum[] = [
      { x: 'one', values: { completed: 4 } },
      { x: 'two', values: { completed: 9 } },
      { x: 'three', values: { completed: 5 } },
      { x: 'four', values: { completed: 8 } },
    ]

    const linear = render(<LineChart data={data} series={[series[0]!]} label="Linear trend" />)
    const linearPath = linear.container.querySelector('path[data-series="completed"]')?.getAttribute('d') ?? ''
    expect(linearPath.startsWith('M ')).toBe(true)
    expect(linearPath).toContain('L ')
    expect(linearPath).not.toContain('C ')
    linear.unmount()

    const smooth = render(<LineChart data={data} series={[series[0]!]} label="Smooth trend" smooth />)
    const smoothPath = smooth.container.querySelector('path[data-series="completed"]')?.getAttribute('d') ?? ''
    expect(smoothPath.startsWith('M ')).toBe(true)
    expect(smoothPath).toContain('C ')
    expect(smoothPath).not.toContain('L ')
    // The curve passes exactly through every data mark: each mark's cx/cy
    // appears as an on-curve endpoint in the path.
    const marks = Array.from(smooth.container.querySelectorAll('circle[role="img"]'))
    expect(marks).toHaveLength(4)
    for (const mark of marks) {
      expect(smoothPath).toContain(`${mark.getAttribute('cx')} ${mark.getAttribute('cy')}`)
    }
    // Data-facing surfaces are unchanged by smoothing.
    expect(smooth.getByRole('table', { name: 'Smooth trend data', hidden: true })).toBeTruthy()
    smooth.unmount()
  })

  it('renders the exact-data table expanded by default and collapses it with compactData', () => {
    const data: ChartDatum[] = [
      { x: 'one', values: { completed: 4 } },
      { x: 'two', values: { completed: 6 } },
    ]
    const open = render(<LineChart data={data} series={[series[0]!]} label="Open trend" />)
    expect(open.container.querySelector('details[data-slot="chart-data-table"]')?.hasAttribute('open')).toBe(true)
    open.unmount()

    const compact = render(
      <LineChart data={data} series={[series[0]!]} label="Compact trend" compactData />,
    )
    expect(compact.container.querySelector('details[data-slot="chart-data-table"]')?.hasAttribute('open')).toBe(false)
  })

  it('attaches responsive measurement when asynchronous data replaces an empty state', () => {
    const OriginalResizeObserver = globalThis.ResizeObserver
    let observed = 0
    class TestResizeObserver {
      observe() {
        observed += 1
      }
      unobserve() {}
      disconnect() {}
    }
    Object.defineProperty(globalThis, 'ResizeObserver', {
      configurable: true,
      value: TestResizeObserver,
    })

    try {
      const { rerender } = render(
        <LineChart data={[]} series={series} label="Async trend" />,
      )
      expect(observed).toBe(0)

      rerender(
        <LineChart
          data={[
            { x: 'one', values: { completed: 1 } },
            { x: 'two', values: { completed: 2 } },
          ]}
          series={series}
          label="Async trend"
        />,
      )
      expect(observed).toBe(1)
    } finally {
      Object.defineProperty(globalThis, 'ResizeObserver', {
        configurable: true,
        value: OriginalResizeObserver,
      })
    }
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

  it('renders the exact-data table expanded by default, collapses it with compactData, and lets showDataTable win entirely', () => {
    const data: ChartDatum[] = [{ x: 'one', values: { completed: 4 } }]
    const open = render(<BarChart data={data} series={[series[0]!]} label="Open bars" />)
    expect(open.container.querySelector('details[data-slot="chart-data-table"]')?.hasAttribute('open')).toBe(true)
    open.unmount()

    const compact = render(<BarChart data={data} series={[series[0]!]} label="Compact bars" compactData />)
    expect(compact.container.querySelector('details[data-slot="chart-data-table"]')?.hasAttribute('open')).toBe(false)
    compact.unmount()

    const withoutTable = render(
      <BarChart data={data} series={[series[0]!]} label="Tableless bars" showDataTable={false} />,
    )
    expect(withoutTable.container.querySelector('[data-slot="chart-data-table"]')).toBeNull()
  })
})

describe('RankedBarChart', () => {
  it('ranks one non-negative unit and preserves missing values', () => {
    const { container } = render(
      <RankedBarChart
        data={[
          { x: 'zero', xLabel: 'Reported zero', values: { completed: 0 } },
          { x: 'small', xLabel: 'Long small label', values: { completed: 2 } },
          { x: 'large', xLabel: 'Long large label', values: { completed: 9 } },
          { x: 'missing', values: {}, missingLabels: { completed: 'Not priced' } },
        ]}
        series={series[0]!}
        label="Ranked completed work"
      />,
    )

    expect(Array.from(container.querySelectorAll('[data-slot="ranked-bar-row"]')).map((row) => row.getAttribute('data-row-key')))
      .toEqual(['large', 'small', 'zero', 'missing'])
    expect(screen.getByRole('img', { name: 'Long large label — Completed: 9' })).toBeDefined()
    expect(screen.getByRole('img', { name: 'Reported zero — Completed: 0' }).children).toHaveLength(0)
    expect(screen.getAllByText('Not priced')).toHaveLength(2)
  })

  it('renders a highlighted sub-segment over a muted total with both numbers in aria, legend, and table', () => {
    const { container } = render(
      <RankedBarChart
        data={[
          { x: 'tasks', xLabel: 'POST /api/tasks', values: { count: 120, failures: 30 } },
          { x: 'clean', xLabel: 'GET /api/search', values: { count: 60, failures: 0 } },
          { x: 'missing', xLabel: 'Unreported destination', values: {}, missingLabels: { count: 'Not recorded', failures: 'Not recorded' } },
        ]}
        series={{ key: 'count', label: 'Calls' }}
        secondary={{ key: 'failures', label: 'Failed', color: 'var(--bakin-color-signal-danger)' }}
        label="Calls by destination"
      />,
    )

    const bar = screen.getByRole('img', { name: 'POST /api/tasks — Calls: 120, Failed: 30' })
    const overlay = bar.querySelector<HTMLElement>('[data-series-secondary="failures"]')
    expect(overlay?.style.width).toBe('25%')
    expect(overlay?.style.backgroundColor).toBe('var(--bakin-color-signal-danger)')
    expect(screen.getByRole('img', { name: 'GET /api/search — Calls: 60, Failed: 0' })
      .querySelector('[data-series-secondary]')).toBeNull()
    expect(container.textContent).toContain('120 · 30 Failed')

    const legend = screen.getByRole('list', { name: 'Calls by destination legend' })
    expect(legend.textContent).toContain('Calls')
    expect(legend.textContent).toContain('Failed')

    const table = screen.getByRole('table', { name: 'Calls by destination data', hidden: true })
    expect(table.textContent).toContain('Failed')
    expect(table.textContent).toContain('30')
    expect(screen.getAllByText('Not recorded').length).toBeGreaterThanOrEqual(2)
  })

  it('keeps the render without a secondary series free of overlays and legend', () => {
    const { container } = render(
      <RankedBarChart
        data={[{ x: 'only', values: { completed: 4 } }]}
        series={series[0]!}
        label="Plain ranking"
      />,
    )

    expect(container.querySelector('[data-series-secondary]')).toBeNull()
    expect(screen.queryByRole('list', { name: 'Plain ranking legend' })).toBeNull()
    expect(container.querySelector<HTMLElement>('[data-series="completed"]')?.style.backgroundColor)
      .toBe(CHART_SERIES_COLORS[0])
  })

  it('scales fractional units against the reported maximum instead of an invented floor', () => {
    const { container } = render(
      <RankedBarChart
        data={[
          { x: 'large', values: { completed: 0.2 } },
          { x: 'small', values: { completed: 0.1 } },
        ]}
        series={series[0]!}
        label="Fractional ranking"
      />,
    )

    const bars = Array.from(container.querySelectorAll<HTMLElement>('[data-series="completed"]'))
    expect(bars.map((bar) => bar.style.width)).toEqual(['100%', '50%'])
  })

  it('renders the exact-data table expanded by default and collapses it with compactData', () => {
    const data: ChartDatum[] = [{ x: 'one', values: { completed: 4 } }]
    const open = render(<RankedBarChart data={data} series={series[0]!} label="Open ranking" />)
    expect(open.container.querySelector('details[data-slot="chart-data-table"]')?.hasAttribute('open')).toBe(true)
    open.unmount()

    const compact = render(
      <RankedBarChart data={data} series={series[0]!} label="Compact ranking" compactData />,
    )
    expect(compact.container.querySelector('details[data-slot="chart-data-table"]')?.hasAttribute('open')).toBe(false)
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

  it('renders the exact-data table expanded by default and collapses it with compactData', () => {
    const data: ChartDatum[] = [{ x: 'one', values: { completed: 3 } }]
    const open = render(<StackedColumnChart data={data} seriesKeys={['completed']} label="Open composition" />)
    expect(open.container.querySelector('details[data-slot="chart-data-table"]')?.hasAttribute('open')).toBe(true)
    open.unmount()

    const compact = render(
      <StackedColumnChart data={data} seriesKeys={['completed']} label="Compact composition" compactData />,
    )
    expect(compact.container.querySelector('details[data-slot="chart-data-table"]')?.hasAttribute('open')).toBe(false)
  })
})
