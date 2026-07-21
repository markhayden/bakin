import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'

import {
  BarChart,
  ChartExplainer,
  LineChart,
  StackedColumnChart,
  type ChartDatum,
  type ChartSeries,
} from '@makinbakin/sdk/charts'
import { Grid } from '@makinbakin/sdk/layout'

import { ChartStage } from './chart-story-stage'

const meta = {
  title: 'Charts/Line, bar, and stacked charts',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Dependency-free visual charts use the fixed data palette, preserve missing values, expose exact tables, and mirror pointer details through keyboard focus.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'long-labels', 'empty', 'overflow', 'multi-series', 'cvd', 'non-color', 'keyboard', 'missing-data'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

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

export const LineCharts = {
  render: () => (
    <ChartStage
      eyebrow="Data / change over time"
      title="A missing point is a gap, not a collapse to zero"
      description="Line shape, dash treatment, visible legend labels, focused marks, and exact values work together. No one cue carries the meaning alone."
    >
      <section aria-labelledby="line-chart-heading" className="bakin-chart-story__section">
        <div>
          <h2 id="line-chart-heading">Workflow outcomes by reporting window</h2>
          <p>Three series · one explicitly unreported retry value · full labels retained in the exact table.</p>
        </div>
        <LineChart
          data={outcomeData}
          series={outcomeSeries}
          label="Workflow outcomes"
          description="Completed, failed, and recovered workflow runs across six reporting windows."
        />
        <ChartExplainer>The recovered series stops at Window 2 and resumes at Window 4 because Window 3 was not reported.</ChartExplainer>
      </section>
      <section aria-labelledby="empty-line-heading" className="bakin-chart-story__section bakin-chart-story__section--quiet">
        <div>
          <h2 id="empty-line-heading">No observed history</h2>
          <p>An empty dataset stays a named state and retains its exact-data path.</p>
        </div>
        <LineChart data={[]} series={outcomeSeries} label="Unobserved workflow outcomes" />
      </section>
    </ChartStage>
  ),
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByRole('group', { name: 'Workflow outcomes' })).toBeVisible()
    await expect(canvas.getByRole('list', { name: 'Workflow outcomes legend' })).toHaveTextContent('Recovered after retry')
    await expect(canvas.queryByRole('img', { name: /Window 3 — Recovered/ })).not.toBeInTheDocument()
    const mark = canvas.getByRole('img', { name: 'Window 4 — Recovered after retry: 3' })
    await userEvent.click(mark)
    await expect(canvas.getByRole('tooltip')).toHaveTextContent('Window 4 — Recovered after retry: 3')
    mark.blur()
    canvas.getByRole('region', { name: 'Workflow outcomes plot' }).scrollLeft = 0
    await expect(canvas.getByRole('status')).toHaveTextContent('No reported data in this window.')
  },
} satisfies Story

export const BarCharts = {
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

const agentKeys = Array.from({ length: 10 }, (_, index) => `agent-${String(index + 1).padStart(2, '0')}`)
const agentData: ChartDatum[] = [
  { x: 'jul-15', xLabel: 'Jul 15', values: Object.fromEntries(agentKeys.map((key, index) => [key, 4 + (index % 4)])) },
  { x: 'jul-16', xLabel: 'Jul 16', values: Object.fromEntries(agentKeys.map((key, index) => [key, 3 + ((index + 2) % 5)])) },
  { x: 'jul-17', xLabel: 'Jul 17', values: {} },
  { x: 'jul-18', xLabel: 'Jul 18', values: Object.fromEntries(agentKeys.map((key, index) => [key, 5 + (index % 3)])) },
  { x: 'jul-19', xLabel: 'Jul 19', values: Object.fromEntries(agentKeys.map((key, index) => [key, 2 + ((index + 1) % 6)])) },
  { x: 'jul-20', xLabel: 'Jul 20 · still accumulating', values: Object.fromEntries(agentKeys.map((key, index) => [key, 1 + (index % 3)])) },
]

export const StackedColumns = {
  render: () => (
    <ChartStage
      eyebrow="Data / dense composition"
      title="Stable entities stay legible as the series count grows"
      description="Eight entity slots remain stable across windows. Later entities are aggregated into one visibly named Other group, and a missing bucket is never rendered as zero."
    >
      <section aria-labelledby="agent-volume-heading" className="bakin-chart-story__section">
        <div>
          <h2 id="agent-volume-heading">Agent activity volume</h2>
          <p>Ten entities · one missing day · one in-progress day · interactive legend.</p>
        </div>
        <StackedColumnChart
          data={agentData}
          seriesKeys={agentKeys}
          label="Agent activity by day"
          partialKeys={['jul-20']}
          height={220}
        />
        <ChartExplainer>Toggle a named series to inspect the remainder. The last visible series cannot be hidden.</ChartExplainer>
      </section>
      <section aria-labelledby="empty-stacked-heading" className="bakin-chart-story__section bakin-chart-story__section--quiet">
        <div>
          <h2 id="empty-stacked-heading">No agent activity observed</h2>
          <p>No placeholder columns, implied zeroes, or decorative chart marks are invented.</p>
        </div>
        <StackedColumnChart data={[]} seriesKeys={agentKeys.slice(0, 2)} label="Unobserved agent activity" />
      </section>
    </ChartStage>
  ),
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByRole('img', { name: 'Jul 17: Not reported' })).toHaveAttribute('data-missing', 'true')
    await expect(canvas.getByRole('img', { name: /Jul 20 · still accumulating \(in progress\)/ })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Other (2)' })).toBeVisible()
    const firstSeries = canvas.getByRole('button', { name: 'agent-01' })
    await userEvent.click(firstSeries)
    await expect(firstSeries).toHaveAttribute('aria-pressed', 'false')
    const missing = canvas.getByRole('img', { name: 'Jul 17: Not reported' })
    await userEvent.click(missing)
    await expect(canvas.getByRole('tooltip')).toHaveTextContent('Jul 17: Not reported')
    missing.blur()
    await userEvent.click(firstSeries)
    await expect(firstSeries).toHaveAttribute('aria-pressed', 'true')
    firstSeries.blur()
    canvas.getByRole('region', { name: 'Agent activity by day plot' }).scrollLeft = 0
    await expect(canvas.getByRole('status')).toHaveTextContent('No reported data in this window.')
  },
} satisfies Story
