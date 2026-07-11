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
    const chart = screen.getByRole('img', { name: 'Stacked column chart' })
    fireEvent.mouseEnter(chart.children[0]!)
    // 'Jul 1' appears in both the x-label row and the tooltip header
    expect(screen.getAllByText('Jul 1').length).toBe(2)
    expect(screen.getByText('150')).toBeDefined() // total row
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
})

describe('Sparkline', () => {
  it('renders an accessible svg for ≥2 points and an em-dash below that', () => {
    const { container } = render(<Sparkline values={[1, 5, 3]} label="tokens over runs" />)
    expect(container.querySelector('svg[aria-label="tokens over runs"]')).toBeDefined()
    cleanup()
    render(<Sparkline values={[1]} label="tokens" />)
    expect(screen.getByText('—')).toBeDefined()
  })
})

describe('ChartExplainer', () => {
  it('renders as a note', () => {
    render(<ChartExplainer>High tokens with few completions can mean an agent is spinning.</ChartExplainer>)
    expect(screen.getByRole('note').textContent).toContain('spinning')
  })
})
