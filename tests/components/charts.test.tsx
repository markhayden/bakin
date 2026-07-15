// @vitest-environment jsdom
/**
 * SDK chart kit (#385) — palette assignment rules (fixed order, fold into
 * Other), stacked column rendering (legend rules, tooltip data, empty state),
 * and sparkline degeneration.
 */
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '../rtl-settle'

// Pure client-component test — isolation mocks are belt-and-braces.
const contentDirMock = () => ({
  getContentDir: () => '/tmp/bakin-test-charts-unused',
  getBakinPaths: () => ({ home: '/tmp/bakin-test-charts-unused' }),
})
mock.module('../../src/core/content-dir', contentDirMock)
mock.module('../../packages/core/src/content-dir', contentDirMock)

import { StackedColumnChart } from '../../src/components/charts/stacked-column-chart'
import { LineChart } from '../../src/components/charts/line-chart'
import { BarChart } from '../../src/components/charts/bar-chart'
import { Sparkline } from '../../src/components/charts/sparkline'
import { ChartExplainer } from '../../src/components/charts/chart-explainer'
import {
  assignSeriesColors,
  CHART_SERIES_COLORS,
  CHART_OTHER_COLOR,
} from '../../src/components/charts/palette'


describe('assignSeriesColors', () => {
  it('assigns slots in fixed order over the sorted entity set', () => {
    const map = assignSeriesColors(['scout', 'pixel', 'basil'])
    expect(map.get('basil')).toBe(CHART_SERIES_COLORS[0])
    expect(map.get('pixel')).toBe(CHART_SERIES_COLORS[1])
    expect(map.get('scout')).toBe(CHART_SERIES_COLORS[2])
  })

  it('a 9th entity gets the Other gray, never a new hue', () => {
    const keys = Array.from({ length: 10 }, (_, i) => `agent-${String(i).padStart(2, '0')}`)
    const map = assignSeriesColors(keys)
    expect(map.get('agent-08')).toBe(CHART_OTHER_COLOR)
    expect(map.get('agent-09')).toBe(CHART_OTHER_COLOR)
  })
})

describe('StackedColumnChart', () => {
  const data: import('../../src/components/charts/stacked-column-chart').StackedColumnDatum[] = [
    { x: '2026-07-01', xLabel: 'Jul 1', values: { pixel: 100, scout: 50 } },
    { x: '2026-07-02', xLabel: 'Jul 2', values: { pixel: 700 } },
  ]

  it('renders a legend for ≥2 series and toggles a series off on click', () => {
    render(<StackedColumnChart data={data} />)
    const pixelButton = screen.getByRole('button', { name: /pixel/ })
    expect(pixelButton).toBeDefined()
    expect(pixelButton.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(pixelButton)
    expect(pixelButton.getAttribute('aria-pressed')).toBe('false')
  })

  it('renders no legend for a single series', () => {
    render(<StackedColumnChart data={[{ x: 'd1', values: { pixel: 10 } }]} />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('shows the per-series breakdown tooltip on hover', () => {
    render(<StackedColumnChart data={data} />)
    const chart = screen.getByRole('group', { name: 'Stacked column chart' })
    fireEvent.mouseEnter(chart.children[0]!)
    expect(screen.getByRole('tooltip').textContent).toContain('Jul 1')
    expect(screen.getByRole('tooltip').textContent).toContain('150')
  })

  it('folds series beyond the palette into Other', () => {
    const wide = [{
      x: 'd1',
      values: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`a${i}`, 10 + i])),
    }]
    render(<StackedColumnChart data={wide} />)
    expect(screen.getByText('Other (3)')).toBeDefined()
  })

  it('honest empty state', () => {
    render(<StackedColumnChart data={[]} emptyLabel="No usage recorded yet." />)
    expect(screen.getByText('No usage recorded yet.')).toBeDefined()
  })

  it('mirrors each column tooltip on keyboard focus and exposes the exact table', () => {
    render(<StackedColumnChart data={data} />)
    const firstColumn = screen.getByRole('img', { name: 'Jul 1: pixel 100, scout 50, total 150' })

    fireEvent.focus(firstColumn)
    expect(screen.getByRole('tooltip').textContent).toContain('Jul 1')
    expect(screen.getByRole('tooltip').textContent).toContain('150')

    const table = screen.getByRole('table', { name: 'Stacked column chart data', hidden: true })
    expect(table.textContent).toContain('pixel')
    expect(table.textContent).toContain('100')
    expect(table.textContent).toContain('scout')
    expect(table.textContent).toContain('50')
  })

  it('accepts a semantic label and marks an in-progress bucket without relying on color', () => {
    render(
      <StackedColumnChart
        data={data}
        label="Usage over time"
        dataLabel="Usage over time data"
        partialKeys={['2026-07-02']}
      />,
    )

    expect(screen.getByRole('group', { name: 'Usage over time' })).toBeDefined()
    expect(screen.getByRole('img', { name: /Jul 2 \(in progress\)/ })).toBeDefined()
    expect(screen.getByRole('table', { name: 'Usage over time data', hidden: true })).toBeDefined()
    expect(screen.getByText('View Usage over time data')).toBeDefined()
  })
})

const series = [
  { key: 'completed', label: 'Completed' },
  { key: 'failed', label: 'Failed' },
]

const timeSeries = [
  { x: '2026-07-01', xLabel: 'Jul 1', values: { completed: 4, failed: 1 } },
  { x: '2026-07-02', xLabel: 'Jul 2', values: { completed: 7, failed: 2 } },
]

describe('LineChart', () => {
  it('renders semantic-token lines and an exact table disclosure', () => {
    const { container } = render(
      <LineChart data={timeSeries} series={series} label="Agent throughput" />,
    )

    expect(screen.getByRole('group', { name: 'Agent throughput' })).toBeDefined()
    expect(container.querySelector('[data-series="completed"]')?.getAttribute('stroke')).toBe('var(--chart-1)')
    const table = screen.getByRole('table', { name: 'Agent throughput data', hidden: true })
    expect(table.textContent).toContain('Jul 1')
    expect(table.textContent).toContain('4')
    expect(table.textContent).toContain('1')
    expect(screen.getByText('View Agent throughput data')).toBeDefined()
  })

  it('shows identical mark detail on hover and focus', () => {
    render(<LineChart data={timeSeries} series={series} label="Agent throughput" />)
    const mark = screen.getByRole('img', { name: 'Jul 1 — Completed: 4' })

    fireEvent.mouseEnter(mark)
    const hovered = screen.getByRole('tooltip').textContent
    fireEvent.mouseLeave(mark)
    fireEvent.focus(mark)
    expect(screen.getByRole('tooltip').textContent).toBe(hovered)
  })

  it('renders an honest empty state', () => {
    render(<LineChart data={[]} series={series} label="Agent throughput" emptyLabel="No agent history yet." />)
    expect(screen.getByRole('status').textContent).toBe('No agent history yet.')
    expect(screen.queryByRole('group', { name: 'Agent throughput' })).toBeNull()
  })
})

describe('BarChart', () => {
  it('renders grouped semantic-token bars with an exact table disclosure', () => {
    const { container } = render(
      <BarChart data={timeSeries} series={series} label="Run outcomes" />,
    )

    expect(screen.getByRole('group', { name: 'Run outcomes' })).toBeDefined()
    expect(container.querySelector('[data-series="completed"]')?.getAttribute('fill')).toBe('var(--chart-1)')
    const table = screen.getByRole('table', { name: 'Run outcomes data', hidden: true })
    expect(table.textContent).toContain('Jul 2')
    expect(table.textContent).toContain('7')
    expect(table.textContent).toContain('2')
  })

  it('shows identical bar detail on hover and focus', () => {
    render(<BarChart data={timeSeries} series={series} label="Run outcomes" />)
    const mark = screen.getByRole('img', { name: 'Jul 2 — Failed: 2' })

    fireEvent.mouseEnter(mark)
    const hovered = screen.getByRole('tooltip').textContent
    fireEvent.mouseLeave(mark)
    fireEvent.focus(mark)
    expect(screen.getByRole('tooltip').textContent).toBe(hovered)
  })

  it('lets a consumer replace the built-in exact table without duplicating it', () => {
    render(<BarChart data={timeSeries} series={series} label="Run outcomes" showDataTable={false} />)

    expect(screen.getByRole('group', { name: 'Run outcomes' })).toBeDefined()
    expect(screen.queryByRole('table', { name: 'Run outcomes data', hidden: true })).toBeNull()
  })
})

describe('Sparkline', () => {
  it('renders focusable points, a semantic stroke, and an exact hidden table', () => {
    const { container } = render(
      <Sparkline
        values={[1, 5, 3]}
        labels={['Run 1', 'Run 2', 'Run 3']}
        label="Tokens over runs"
        formatValue={(value) => `${value} tokens`}
      />,
    )
    expect(container.querySelector('svg[aria-label="Tokens over runs"]')).toBeDefined()
    expect(container.querySelector('polyline')?.getAttribute('stroke')).toBe('var(--chart-1)')
    const mark = screen.getByRole('img', { name: 'Run 2: 5 tokens' })
    fireEvent.focus(mark)
    expect(screen.getByRole('tooltip').textContent).toBe('Run 2: 5 tokens')
    const table = screen.getByRole('table', { name: 'Tokens over runs data', hidden: true })
    expect(table.textContent).toContain('Run 3')
    expect(table.textContent).toContain('3 tokens')
  })

  it('renders an em-dash below two points without hiding the exact value', () => {
    cleanup()
    render(<Sparkline values={[1]} labels={['Latest']} label="Tokens" />)
    expect(screen.getByText('—')).toBeDefined()
    expect(screen.getByRole('table', { name: 'Tokens data', hidden: true }).textContent).toContain('1')
  })
})

describe('ChartExplainer', () => {
  it('renders as a note', () => {
    render(<ChartExplainer>High tokens with few completions can mean an agent is spinning.</ChartExplainer>)
    expect(screen.getByRole('note').textContent).toContain('spinning')
  })
})
