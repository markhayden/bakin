import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'

import { BarChart, ChartExplainer, type ChartDatum, type ChartSeries } from '@makinbakin/sdk/charts'
import { Grid } from '@makinbakin/sdk/layout'

import { ChartStage } from './chart-story-stage'

const canonicalSeries: ChartSeries[] = [
  { key: 'completed', label: 'Completed' },
  { key: 'failed', label: 'Failed' },
]

const canonicalData: ChartDatum[] = [
  { x: 'jul-24', xLabel: 'Jul 24', values: { completed: 18, failed: 2 } },
  { x: 'jul-25', xLabel: 'Jul 25', values: { completed: 24, failed: 1 } },
  { x: 'jul-26', xLabel: 'Jul 26', values: { completed: 21 }, missingLabels: { failed: 'Not reported' } },
  { x: 'jul-27', xLabel: 'Jul 27', values: { completed: 31, failed: 3 } },
]

const meta = {
  title: 'Charts/BarChart',
  component: BarChart,
  tags: ['public'],
  args: {
    data: canonicalData,
    series: canonicalSeries,
    label: 'Task outcomes',
    description: 'Completed and failed tasks across four days.',
  },
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'BarChart is the dependency-free comparison chart for non-negative quantities across discrete windows. Grouped bars compare series within each window; `stacked` emphasizes window totals while focus preserves each segment value. Both forms share the fixed data palette in the same series order, visible legend labels, keyboard-focusable marks that mirror pointer tooltips, an intentionally absent value that stays missing instead of becoming zero, and an exact-data table that renders expanded by default so the evidence stays visible. Every table-bearing chart shares the same three knobs: `showDataTable` removes the table (only when an equivalent exact table renders beside the chart), `compactData` collapses it behind its disclosure for space-tight contexts, and `dataTableExpandable={false}` renders it statically with no disclosure chrome. Use a line chart when signed values or change around zero matters.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'long-labels', 'overflow', 'multi-series', 'non-color', 'keyboard', 'missing-data'],
  },
} satisfies Meta<typeof BarChart>

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  args: {
    stacked: false,
    compactData: false,
    showDataTable: true,
    dataTableExpandable: true,
  },
  play: async ({ canvas, args }) => {
    await expect(canvas.getByRole('group', { name: 'Task outcomes' })).toBeVisible()
    await expect(canvas.getByRole('list', { name: 'Task outcomes legend' })).toHaveTextContent('Failed')
    await expect(canvas.queryByRole('img', { name: /Jul 26 — Failed/ })).not.toBeInTheDocument()
    const mark = canvas.getByRole('img', { name: 'Jul 27 — Failed: 3' })
    mark.focus()
    await expect(mark).toHaveFocus()
    await expect(canvas.getByRole('tooltip')).toHaveTextContent('Jul 27 — Failed: 3')
    mark.blur()
    const table = canvas.getByRole('table', { name: 'Task outcomes data', hidden: true })
    if (args.compactData) await expect(table).not.toBeVisible()
    else await expect(table).toBeVisible()
    await expect(table).toHaveTextContent('Not reported')
  },
} satisfies Story

export const CompactData = {
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        story: 'The space-saving opt-in: `compactData` collapses the exact-data table behind its "View {caption}" disclosure. The evidence is never removed — it stays one activation away. Reserve this for genuinely space-tight contexts; the default keeps the table expanded.',
      },
    },
  },
  render: () => (
    <BarChart
      data={canonicalData}
      series={canonicalSeries}
      label="Task outcomes"
      description="Completed and failed tasks across four days."
      compactData
    />
  ),
  play: async ({ canvas, userEvent }) => {
    const table = canvas.getByRole('table', { name: 'Task outcomes data', hidden: true })
    await expect(table).not.toBeVisible()
    await userEvent.click(canvas.getByText('View Task outcomes data'))
    await expect(table).toBeVisible()
    await expect(table).toHaveTextContent('Not reported')
  },
} satisfies Story

const outcomeSeries: ChartSeries[] = [
  { key: 'completed', label: 'Completed' },
  { key: 'failed', label: 'Failed' },
  { key: 'retried', label: 'Recovered after retry' },
]

const outcomeData: ChartDatum[] = [
  { x: 'window-1', xLabel: 'Window 1', values: { completed: 22, failed: 4, retried: 2 } },
  { x: 'window-2', xLabel: 'Window 2', values: { completed: 28, failed: 3, retried: 4 } },
  { x: 'window-3', xLabel: 'Window 3', values: { completed: 31, failed: 5 }, missingLabels: { retried: 'Not reported' } },
  { x: 'window-4', xLabel: 'Window 4', values: { completed: 27, failed: 2, retried: 3 } },
  { x: 'window-5', xLabel: 'Window 5', values: { completed: 39, failed: 4, retried: 6 } },
  { x: 'window-6', xLabel: 'Current window with a deliberately long exact label', values: { completed: 42, failed: 1, retried: 5 } },
]

export const GroupedAndStacked = {
  render: () => (
    <ChartStage
      eyebrow="Data / discrete comparison"
      title="Choose grouped bars for peers and stacked bars for totals"
      description="Both forms use the same series order, exact-data disclosure, keyboard marks, and visible legend language."
    >
      <Grid layout="split" gap="section" className="bakin-chart-story__chart-grid">
        <section aria-labelledby="grouped-bar-heading" className="bakin-chart-story__section">
          <div>
            <h2 id="grouped-bar-heading">Compare outcomes</h2>
            <p>Grouped bars make series differences within each window easiest to scan.</p>
          </div>
          <BarChart data={outcomeData} series={outcomeSeries} label="Grouped workflow outcomes" />
        </section>
        <section aria-labelledby="stacked-bar-heading" className="bakin-chart-story__section bakin-chart-story__section--quiet">
          <div>
            <h2 id="stacked-bar-heading">Compare total volume</h2>
            <p>Stacked bars emphasize each window total while focus preserves each segment value.</p>
          </div>
          <BarChart data={outcomeData} series={outcomeSeries} label="Stacked workflow outcomes" stacked />
        </section>
      </Grid>
      <ChartExplainer>Use bars only for non-negative quantities. Use a line chart when signed values or change around zero matters.</ChartExplainer>
    </ChartStage>
  ),
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByRole('group', { name: 'Grouped workflow outcomes' })).toBeVisible()
    await expect(canvas.getByRole('group', { name: 'Stacked workflow outcomes' })).toBeVisible()
    const mark = canvas.getAllByRole('img', { name: 'Window 2 — Failed: 3' })[0]!
    await userEvent.click(mark)
    await expect(canvas.getAllByRole('tooltip')[0]).toHaveTextContent('Window 2 — Failed: 3')
    mark.blur()
    canvas.getByRole('region', { name: 'Grouped workflow outcomes plot' }).scrollLeft = 0
    await expect(canvas.getAllByText('Not reported', { selector: '[data-missing="true"]' })).toHaveLength(2)
  },
} satisfies Story
