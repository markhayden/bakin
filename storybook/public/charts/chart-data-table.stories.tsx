import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'

import { ChartDataTable, ChartExplainer, type ChartDatum, type ChartSeries } from '@makinbakin/sdk/charts'

import { ChartStage } from './chart-story-stage'

const canonicalSeries: ChartSeries[] = [
  { key: 'completed', label: 'Completed' },
  { key: 'failed', label: 'Failed' },
]

const canonicalData: ChartDatum[] = [
  { x: 'jul-24', xLabel: 'Jul 24', values: { completed: 18, failed: 2 } },
  { x: 'jul-25', xLabel: 'Jul 25', values: { completed: 24, failed: 1 } },
  { x: 'jul-26', xLabel: 'Jul 26', values: { completed: 21 }, missingLabels: { failed: 'Still processing' } },
]

const meta = {
  title: 'Components/Charts/ChartDataTable',
  component: ChartDataTable,
  tags: ['public'],
  // Canonical fixture args at meta level keep required props satisfied for the
  // render-based showcase stories below.
  args: {
    caption: 'Task outcomes exact data',
    data: canonicalData,
    series: canonicalSeries,
  },
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'ChartDataTable is the exact-data disclosure behind every chart summary: a chart never hides its evidence. The disclosure names the dataset, the table keeps absent values distinct from zero with per-cell missing labels (an unknown is not a zero), horizontal overflow is owned locally by a keyboard-focusable region, long labels stay intact, and an empty dataset is named honestly instead of inventing rows. Visual charts embed it automatically; use it directly when a summary needs its exact values disclosed or visually hidden but reachable.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'long-labels', 'empty', 'overflow', 'multi-series', 'non-color', 'keyboard', 'missing-data'],
  },
} satisfies Meta<typeof ChartDataTable>

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  argTypes: {
    defaultOpen: { control: 'boolean' },
    expandable: { control: 'boolean' },
    visuallyHidden: { control: 'boolean' },
    caption: { control: 'text' },
    // Fixture data; renderTable is the documented escape hatch, not a control.
    data: { control: false },
    series: { control: false },
    formatValue: { control: false },
    missingValue: { control: false },
    renderTable: { control: false },
    className: { control: false },
  },
  play: async ({ canvas, userEvent }) => {
    const disclosure = canvas.getByText('View Task outcomes exact data')
    await expect(disclosure).toBeVisible()
    await userEvent.click(disclosure)
    await expect(canvas.getByRole('table', { name: 'Task outcomes exact data' })).toBeVisible()
    const missingCell = canvas.getByText('Still processing')
    await expect(missingCell).toBeVisible()
    await expect(missingCell).toHaveAttribute('data-missing', 'true')
    await expect(canvas.getByRole('region', { name: 'Task outcomes exact data table' })).toHaveAttribute('tabindex', '0')
  },
} satisfies Story

const outcomeSeries: ChartSeries[] = [
  { key: 'completed', label: 'Completed' },
  { key: 'failed', label: 'Failed' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'waiting', label: 'Waiting for approval' },
  { key: 'recovered', label: 'Recovered after retry' },
]

const outcomeData: ChartDatum[] = [
  { x: '2026-07-17', xLabel: 'Jul 17', values: { completed: 42, failed: 3, cancelled: 1, waiting: 4, recovered: 2 } },
  { x: '2026-07-18', xLabel: 'Jul 18', values: { completed: 51, failed: 2, cancelled: 0, waiting: 6, recovered: 3 } },
  { x: '2026-07-19', xLabel: 'Jul 19', values: { completed: 47, failed: 4, cancelled: 2, waiting: 5, recovered: 4 } },
  {
    x: '2026-07-20',
    xLabel: 'Jul 20 · current reporting window with a deliberately long label',
    values: { completed: 29, failed: 1, cancelled: 0, recovered: 2 },
    missingLabels: { waiting: 'Still processing' },
  },
]

export const ExactDataDisclosure = {
  render: () => (
    <ChartStage
      eyebrow="Data / exact values"
      title="A chart summary never hides the evidence"
      description="The disclosure names the dataset, keeps absent values distinct from zero, and owns horizontal overflow locally."
    >
      <section aria-labelledby="run-outcomes-heading" className="bakin-chart-story__section">
        <div>
          <h2 id="run-outcomes-heading">Run outcomes</h2>
          <p>Four daily buckets · five reported series</p>
        </div>
        <ChartDataTable
          caption="Run outcomes exact data"
          data={outcomeData}
          series={outcomeSeries}
          defaultOpen
        />
        <ChartExplainer>“Still processing” is unknown for this window; it is not a zero.</ChartExplainer>
      </section>
      <section aria-labelledby="empty-chart-data-heading" className="bakin-chart-story__section bakin-chart-story__section--quiet">
        <div>
          <h2 id="empty-chart-data-heading">No observed runs</h2>
          <p>The same table contract names an empty dataset without inventing marks or values.</p>
        </div>
        <ChartDataTable
          caption="Unobserved run data"
          data={[]}
          series={[{ key: 'completed', label: 'Completed' }]}
          emptyLabel="No completed runs have been observed yet."
          defaultOpen
        />
      </section>
    </ChartStage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('table', { name: 'Run outcomes exact data' })).toBeVisible()
    await expect(canvas.getByText('Still processing')).toBeVisible()
    await expect(canvas.getByRole('region', { name: 'Run outcomes exact data table' })).toHaveAttribute('tabindex', '0')
    await expect(canvas.getByText('No completed runs have been observed yet.')).toBeVisible()
  },
} satisfies Story

const intervalSeries: ChartSeries[] = [
  { key: 'other', label: 'Other outcomes' },
  { key: 'failed', label: 'Failed' },
]

const intervalData: ChartDatum[] = [
  { x: '2026-07-29T14:00:00Z', xLabel: '2:00 PM', values: { other: 41, failed: 2 } },
  { x: '2026-07-29T15:00:00Z', xLabel: '3:00 PM', values: { other: 36, failed: 0 } },
  { x: '2026-07-29T16:00:00Z', xLabel: '4:00 PM', values: { other: 52, failed: 5 } },
]

export const CustomTableRegion = {
  render: () => (
    <ChartStage
      eyebrow="Data / escape hatch"
      title="Customize the table region, keep the disclosure contract"
      description="renderTable replaces the exact table's markup — derived ordering, semantic time cells — while the kit keeps the disclosure chrome, the caption naming, and the keyboard-reachable overflow region."
    >
      <section aria-labelledby="custom-table-region-heading" className="bakin-chart-story__section">
        <div>
          <h2 id="custom-table-region-heading">Interval outcomes</h2>
          <p>Latest interval first with semantic time headers — a shape the default label-plus-series grid cannot express.</p>
        </div>
        <ChartDataTable
          caption="Interval outcomes exact data"
          data={intervalData}
          series={intervalSeries}
          defaultOpen
          renderTable={({ caption, data, series, formatValue }) => (
            <table className="min-w-full border-collapse text-left" data-testid="custom-table-region">
              <caption className="sr-only">{caption}</caption>
              <thead>
                <tr>
                  <th scope="col">Interval</th>
                  {series.map((item) => (
                    <th key={item.key} scope="col" style={{ textAlign: 'right' }}>{item.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...data].reverse().map((datum) => (
                  <tr key={datum.x}>
                    <th scope="row">
                      <time dateTime={datum.x}>{datum.xLabel ?? datum.x}</time>
                    </th>
                    {series.map((item) => (
                      <td key={item.key} style={{ textAlign: 'right' }}>
                        {formatValue(datum.values[item.key] ?? 0)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        />
        <ChartExplainer>The consumer owns the rows; the kit still owns how the table is disclosed, named, and reached.</ChartExplainer>
      </section>
    </ChartStage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('View Interval outcomes exact data')).toBeVisible()
    const table = canvas.getByRole('table', { name: 'Interval outcomes exact data' })
    await expect(table).toBeVisible()
    await expect(table).toHaveAttribute('data-testid', 'custom-table-region')
    const rowHeaders = canvas.getAllByRole('rowheader')
    await expect(rowHeaders[0]).toHaveTextContent('4:00 PM')
    await expect(canvas.getByRole('region', { name: 'Interval outcomes exact data table' })).toHaveAttribute('tabindex', '0')
  },
} satisfies Story
