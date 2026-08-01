// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'bun:test'
import { cleanup, render } from '@testing-library/react'
import '../../rtl-settle'

import {
  AreaChart,
  BarChart,
  ChartDataTable,
  LineChart,
  PieChart,
  RankedBarChart,
  StackedColumnChart,
} from '@makinbakin/sdk/charts'

afterEach(() => cleanup())

const data = [
  { x: 'mon', xLabel: 'Mon', values: { done: 4 } },
  { x: 'tue', xLabel: 'Tue', values: { done: 6 } },
]
const series = [{ key: 'done', label: 'Done' }]

const chartCases = [
  ['BarChart', (props: Record<string, unknown>) => <BarChart label="Runs" data={data} series={series} {...props} />],
  ['LineChart', (props: Record<string, unknown>) => <LineChart label="Runs" data={data} series={series} {...props} />],
  ['AreaChart', (props: Record<string, unknown>) => <AreaChart label="Runs" data={data} series={series} {...props} />],
  ['StackedColumnChart', (props: Record<string, unknown>) => <StackedColumnChart label="Runs" data={data} series={series} {...props} />],
  ['RankedBarChart', (props: Record<string, unknown>) => <RankedBarChart label="Runs" data={data} series={series[0]} {...props} />],
  ['PieChart', (props: Record<string, unknown>) => <PieChart label="Share" data={[{ key: 'a', label: 'A', value: 3 }]} {...props} />],
] as const

describe('uniform chart table props', () => {
  for (const [name, make] of chartCases) {
    it(`${name}: table present by default, removable, and statically renderable`, () => {
      const { container, rerender } = render(make({}))
      expect(container.querySelector('[data-slot="chart-data-table"]')).not.toBeNull()
      expect(container.querySelector('details[data-slot="chart-data-table"]')).not.toBeNull()

      rerender(make({ showDataTable: false }))
      expect(container.querySelector('[data-slot="chart-data-table"]')).toBeNull()

      rerender(make({ dataTableExpandable: false }))
      const staticTable = container.querySelector('[data-slot="chart-data-table"]')
      expect(staticTable).not.toBeNull()
      expect(staticTable?.getAttribute('data-expandable')).toBe('false')
      expect(staticTable?.tagName).not.toBe('DETAILS')
      expect(staticTable?.querySelector('summary')).toBeNull()
      expect(staticTable?.querySelector('table')).not.toBeNull()
    })
  }

  it('ChartDataTable: expandable=false is always-visible with no disclosure; defaultOpen ignored', () => {
    const { container } = render(
      <ChartDataTable data={data} series={series} caption="Runs data" expandable={false} defaultOpen={false} />,
    )
    const region = container.querySelector('[data-slot="chart-data-table"]')
    expect(region?.getAttribute('data-expandable')).toBe('false')
    expect(region?.querySelector('summary')).toBeNull()
    expect(region?.querySelector('table')).not.toBeNull()
  })
})
