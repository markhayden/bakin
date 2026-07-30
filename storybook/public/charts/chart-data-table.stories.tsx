import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'

import { ChartDataTable, ChartExplainer, type ChartDatum, type ChartSeries } from '@makinbakin/sdk/charts'

import { ChartStage } from './chart-story-stage'

const meta = {
  title: 'Charts/ChartDataTable',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'ChartDataTable is the exact-data disclosure behind every chart summary: a chart never hides its evidence. The disclosure names the dataset, the table keeps absent values distinct from zero with per-cell missing labels (an unknown is not a zero), horizontal overflow is owned locally by a keyboard-focusable region, long labels stay intact, and an empty dataset is named honestly instead of inventing rows. Visual charts embed it automatically; use it directly when a summary needs its exact values disclosed or visually hidden but reachable.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'long-labels', 'empty', 'overflow', 'multi-series', 'non-color', 'keyboard', 'missing-data'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const canonicalSeries: ChartSeries[] = [
  { key: 'completed', label: 'Completed' },
  { key: 'failed', label: 'Failed' },
]

const canonicalData: ChartDatum[] = [
  { x: 'jul-24', xLabel: 'Jul 24', values: { completed: 18, failed: 2 } },
  { x: 'jul-25', xLabel: 'Jul 25', values: { completed: 24, failed: 1 } },
  { x: 'jul-26', xLabel: 'Jul 26', values: { completed: 21 }, missingLabels: { failed: 'Still processing' } },
]

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  render: () => (
    <ChartDataTable
      caption="Task outcomes exact data"
      data={canonicalData}
      series={canonicalSeries}
    />
  ),
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
