// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '../../rtl-settle'

import {
  assignSeriesColors,
  ChartDataTable,
  ChartExplainer,
  CHART_MAX_SERIES,
  CHART_OTHER_COLOR,
  CHART_SERIES_COLORS,
  Sparkline,
} from '@makinbakin/sdk/charts'

afterEach(cleanup)

describe('chart palette', () => {
  it('uses stable namespaced tokens and folds overflow into a labelled Other slot', () => {
    expect(CHART_SERIES_COLORS).toHaveLength(8)
    expect(CHART_MAX_SERIES).toBe(8)
    expect(CHART_SERIES_COLORS[0]).toBe('var(--bakin-color-data-series-1)')
    expect(CHART_OTHER_COLOR).toBe('var(--bakin-color-data-other)')

    const fullSet = ['zinc', 'alpha', 'alpha', 'mango']
    const first = assignSeriesColors(fullSet)
    const second = assignSeriesColors([...fullSet].reverse())
    expect([...first]).toEqual([...second])
    expect(first.get('alpha')).toBe(CHART_SERIES_COLORS[0])

    const overflow = assignSeriesColors(Array.from({ length: 10 }, (_, index) => `agent-${index}`))
    expect(overflow.get('agent-8')).toBe(CHART_OTHER_COLOR)
    expect(overflow.get('agent-9')).toBe(CHART_OTHER_COLOR)
  })
})

describe('ChartDataTable', () => {
  const series = [
    { key: 'completed', label: 'Completed' },
    { key: 'failed', label: 'Failed' },
  ]

  it('discloses exact values inside a labelled local overflow boundary', () => {
    render(
      <ChartDataTable
        caption="Run outcomes data"
        data={[
          { x: '2026-07-19', xLabel: 'Jul 19', values: { completed: 12, failed: 2 } },
          { x: '2026-07-20', xLabel: 'Jul 20', values: { completed: 9 }, missingLabels: { failed: 'Still processing' } },
        ]}
        series={series}
      />,
    )

    const disclosure = screen.getByText('View Run outcomes data')
    expect(disclosure.closest('details')?.hasAttribute('open')).toBe(false)
    fireEvent.click(disclosure)
    expect(disclosure.closest('details')?.hasAttribute('open')).toBe(true)

    const table = screen.getByRole('table', { name: 'Run outcomes data' })
    expect(table.textContent).toContain('12')
    expect(table.textContent).toContain('Still processing')
    expect(screen.getByRole('region', { name: 'Run outcomes data table' }).contains(table)).toBe(true)
  })

  it('never turns absent data into a numeric zero and names an empty dataset', () => {
    const { rerender } = render(
      <ChartDataTable
        caption="Usage"
        data={[{ x: 'today', values: {} }]}
        series={[{ key: 'tokens', label: 'Tokens' }]}
        defaultOpen
      />,
    )
    expect(screen.getByRole('cell').textContent).toBe('Not reported')

    rerender(
      <ChartDataTable
        caption="Usage"
        data={[]}
        series={[{ key: 'tokens', label: 'Tokens' }]}
        emptyLabel="No usage recorded yet."
        defaultOpen
      />,
    )
    expect(screen.getByRole('cell').textContent).toBe('No usage recorded yet.')
  })

  it('lets renderTable replace the table region while the disclosure chrome and reachability stay kit-owned', () => {
    const { container } = render(
      <ChartDataTable
        caption="Interval outcomes data"
        data={[
          { x: 'a', xLabel: 'First', values: { completed: 1 } },
          { x: 'b', xLabel: 'Second', values: { completed: 2 } },
        ]}
        series={[{ key: 'completed', label: 'Completed' }]}
        defaultOpen
        renderTable={({ caption, data, series: tableSeries }) => (
          <table data-testid="custom-region">
            <caption className="sr-only">{caption}</caption>
            <tbody>
              {[...data].reverse().map((datum) => (
                <tr key={datum.x}>
                  <th scope="row">{datum.xLabel}</th>
                  {tableSeries.map((item) => <td key={item.key}>{datum.values[item.key]}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      />,
    )

    expect(screen.getByText('View Interval outcomes data')).toBeTruthy()
    const table = screen.getByRole('table', { name: 'Interval outcomes data' })
    expect(table.getAttribute('data-testid')).toBe('custom-region')
    expect(container.querySelector('[data-slot="chart-exact-table"]')).toBeNull()
    expect(screen.getAllByRole('rowheader')[0]?.textContent).toBe('Second')
    const region = screen.getByRole('region', { name: 'Interval outcomes data table' })
    expect(region.getAttribute('tabindex')).toBe('0')
    expect(region.contains(table)).toBe(true)
  })

  it('applies renderTable to the visually hidden variant too', () => {
    render(
      <ChartDataTable
        caption="Compact custom data"
        data={[{ x: 'latest', values: { value: 4 } }]}
        series={[{ key: 'value', label: 'Value' }]}
        visuallyHidden
        renderTable={({ caption }) => (
          <table data-testid="hidden-custom-region">
            <caption>{caption}</caption>
            <tbody><tr><td>4</td></tr></tbody>
          </table>
        )}
      />,
    )

    expect(screen.getByRole('table', { name: 'Compact custom data', hidden: true }).getAttribute('data-testid'))
      .toBe('hidden-custom-region')
    expect(screen.queryByText('View Compact custom data')).toBeNull()
  })

  it('can preserve an exact table for compact visuals without adding a disclosure', () => {
    render(
      <ChartDataTable
        caption="Compact trend data"
        data={[{ x: 'latest', values: { value: 4 } }]}
        series={[{ key: 'value', label: 'Value' }]}
        visuallyHidden
      />,
    )
    expect(screen.getByRole('table', { name: 'Compact trend data', hidden: true })).toBeTruthy()
    expect(screen.queryByText('View Compact trend data')).toBeNull()
  })
})

describe('Sparkline', () => {
  it('uses the semantic first series, exposes every finite point, and mirrors focus in a tooltip', () => {
    const { container } = render(
      <Sparkline
        values={[4, 7, 5]}
        labels={['Run 1', 'Run 2', 'Run 3']}
        label="Completed tasks over three runs"
        formatValue={(value) => `${value} tasks`}
      />,
    )

    expect(container.querySelector('polyline')?.getAttribute('stroke')).toBe(CHART_SERIES_COLORS[0])
    const point = screen.getByRole('img', { name: 'Run 2: 7 tasks' })
    fireEvent.focus(point)
    expect(screen.getByRole('tooltip').textContent).toBe('Run 2: 7 tasks')
    expect(screen.getByRole('table', { name: 'Completed tasks over three runs data', hidden: true }).textContent)
      .toContain('Run 3')
  })

  it('keeps gaps explicit instead of drawing a false continuous segment', () => {
    const { container } = render(
      <Sparkline
        values={[4, null, 9, 12]}
        labels={['Run 1', 'Run 2', 'Run 3', 'Run 4']}
        label="Tasks with an unreported run"
      />,
    )

    expect(container.querySelectorAll('polyline')).toHaveLength(1)
    expect(screen.getByRole('table', { name: 'Tasks with an unreported run data', hidden: true }).textContent)
      .toContain('Not reported')
    expect(screen.queryByRole('img', { name: /Run 2:/ })).toBeNull()
  })

  it('centers a flat trend instead of implying a low value', () => {
    const { container } = render(<Sparkline values={[4, 4, 4]} label="Flat completion trend" height={30} />)
    expect(container.querySelector('polyline')?.getAttribute('points')).toBe('3.0,15.0 60.0,15.0 117.0,15.0')
  })

  it('renders a named no-trend state while retaining sparse exact data', () => {
    render(<Sparkline values={[3]} labels={['Latest']} label="Latest task count" />)
    expect(screen.getByText('Not enough data for a trend')).toBeTruthy()
    expect(screen.getByRole('table', { name: 'Latest task count data', hidden: true }).textContent).toContain('3')
  })

  it('stays fill-free by default and only marks the area variant when requested', () => {
    const { container } = render(<Sparkline values={[4, 7, 5]} label="Default trend" />)
    expect(container.querySelector('path')).toBeNull()
    expect(container.querySelector('[data-slot="sparkline"]')?.hasAttribute('data-area')).toBe(false)
  })

  it('draws a soft same-color fill per reported segment so area gaps mirror line gaps', () => {
    const { container } = render(
      <Sparkline
        area
        values={[4, null, 9, 12]}
        labels={['Run 1', 'Run 2', 'Run 3', 'Run 4']}
        label="Filled trend with an unreported run"
      />,
    )

    expect(container.querySelector('[data-slot="sparkline"]')?.getAttribute('data-area')).toBe('true')
    // Only the [Run 3, Run 4] segment can trend; the lone leading point gets no fill.
    const fills = container.querySelectorAll('path[data-series-fill="value"]')
    expect(fills).toHaveLength(1)
    expect(fills[0]!.getAttribute('fill')).toBe(CHART_SERIES_COLORS[0])
    expect(fills[0]!.getAttribute('fill-opacity')).toBe('0.2')
    expect(fills[0]!.getAttribute('d')?.trim().endsWith('Z')).toBe(true)
    expect(container.querySelectorAll('polyline')).toHaveLength(1)
    expect(screen.queryByRole('img', { name: /Run 2:/ })).toBeNull()
  })
})

describe('ChartExplainer', () => {
  it('renders guidance as a semantic note', () => {
    render(<ChartExplainer>Compare the shape with the exact values before taking action.</ChartExplainer>)
    expect(screen.getByRole('note').textContent).toContain('exact values')
  })
})
