import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'

import { AreaChart, ChartExplainer, type ChartDatum, type ChartSeries } from '@makinbakin/sdk/charts'

import { ChartStage } from './chart-story-stage'

const meta = {
  title: 'Charts/AreaChart',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'AreaChart is the dependency-free trend chart for cumulative magnitude over time: reach for it when how much has accumulated is the message, for LineChart when only the trajectory matters, and for StackedColumnChart when discrete buckets should be compared side by side. The solid 2px series line carries identity while the reduced-opacity fill carries magnitude, colors follow the fixed CVD-checked palette order, and stacked bands are separated by a surface-color stroke so adjacent fills never touch. A missing value in a single-series area breaks the fill into a gap — never a collapse to zero. A stacked column cannot honestly render a gap mid-stack, so the missing series is omitted from that column’s band boundaries and the omission is surfaced through the exact-data table’s per-cell missing labels — the deliberate trade-off of stacking. Every mark mirrors pointer detail through keyboard focus and a tooltip, the exact-data table stays reachable behind the chart, and an empty dataset is a named state, not invented marks.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'long-labels', 'empty', 'overflow', 'multi-series', 'cvd', 'non-color', 'keyboard', 'missing-data'],
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
  { x: 'jul-26', xLabel: 'Jul 26', values: { completed: 21 }, missingLabels: { failed: 'Not reported' } },
  { x: 'jul-27', xLabel: 'Jul 27', values: { completed: 31, failed: 3 } },
]

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  render: () => (
    <AreaChart
      data={canonicalData}
      series={canonicalSeries}
      label="Task volume"
      description="Completed and failed task volume across four days."
    />
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('group', { name: 'Task volume' })).toBeVisible()
    await expect(canvas.getByRole('list', { name: 'Task volume legend' })).toHaveTextContent('Failed')
    await expect(canvas.queryByRole('img', { name: /Jul 26 — Failed/ })).not.toBeInTheDocument()
    const mark = canvas.getByRole('img', { name: 'Jul 27 — Failed: 3' })
    mark.focus()
    await expect(mark).toHaveFocus()
    await expect(canvas.getByRole('tooltip')).toHaveTextContent('Jul 27 — Failed: 3')
    mark.blur()
    await expect(canvas.getByRole('table', { name: 'Task volume data', hidden: true })).toHaveTextContent('Not reported')
  },
} satisfies Story

const tokenSeries: ChartSeries[] = [
  { key: 'input', label: 'Input tokens' },
  { key: 'output', label: 'Output tokens' },
  { key: 'cache', label: 'Cache reads' },
]

const tokenData: ChartDatum[] = [
  { x: 'window-1', xLabel: 'Window 1', values: { input: 420, output: 180, cache: 90 } },
  { x: 'window-2', xLabel: 'Window 2', values: { input: 510, output: 240, cache: 120 } },
  { x: 'window-3', xLabel: 'Window 3', values: { input: 470, output: 210 }, missingLabels: { cache: 'Not reported' } },
  { x: 'window-4', xLabel: 'Window 4', values: { input: 560, output: 260, cache: 150 } },
  { x: 'window-5', xLabel: 'Window 5', values: { input: 640, output: 300, cache: 170 } },
  { x: 'window-6', xLabel: 'Current window with a deliberately long exact label', values: { input: 720, output: 340, cache: 210 } },
]

const gapData: ChartDatum[] = [
  { x: 'window-1', xLabel: 'Window 1', values: { input: 420 } },
  { x: 'window-2', xLabel: 'Window 2', values: { input: 510 } },
  { x: 'window-3', xLabel: 'Window 3', values: {}, missingLabels: { input: 'Not reported' } },
  { x: 'window-4', xLabel: 'Window 4', values: { input: 560 } },
  { x: 'window-5', xLabel: 'Window 5', values: { input: 640 } },
]

export const StackedAndMissingData = {
  render: () => (
    <ChartStage
      eyebrow="Data / cumulative magnitude over time"
      title="The line carries identity; the fill carries magnitude"
      description="Stacked bands separate with a surface stroke and never let adjacent fills touch. A single-series gap breaks the fill; a stacked column omits the unreported band and keeps the omission visible in the exact table."
    >
      <section aria-labelledby="stacked-area-heading" className="bakin-chart-story__section">
        <div>
          <h2 id="stacked-area-heading">Token consumption by kind per reporting window</h2>
          <p>Three stacked series · one explicitly unreported cache value · full labels retained in the exact table.</p>
        </div>
        <AreaChart
          data={tokenData}
          series={tokenSeries}
          label="Token consumption"
          description="Input, output, and cache-read token totals stacked across six reporting windows."
          stacked
        />
        <ChartExplainer>Window 3 stacks without a cache band because cache reads were not reported — the exact table names the omission instead of the stack inventing a gap.</ChartExplainer>
      </section>
      <section aria-labelledby="gap-area-heading" className="bakin-chart-story__section">
        <div>
          <h2 id="gap-area-heading">A missing single-series value breaks the fill</h2>
          <p>The gap mirrors LineChart exactly — never a collapse to zero.</p>
        </div>
        <AreaChart
          data={gapData}
          series={[tokenSeries[0]!]}
          label="Input token trend"
          description="Input tokens across five reporting windows with one unreported window."
        />
      </section>
      <section aria-labelledby="empty-area-heading" className="bakin-chart-story__section bakin-chart-story__section--quiet">
        <div>
          <h2 id="empty-area-heading">No observed history</h2>
          <p>An empty dataset stays a named state and retains its exact-data path.</p>
        </div>
        <AreaChart data={[]} series={tokenSeries} label="Unobserved token consumption" />
      </section>
    </ChartStage>
  ),
  play: async ({ canvas, userEvent }) => {
    const stackedChart = canvas.getByRole('group', { name: 'Token consumption' })
    await expect(stackedChart).toBeVisible()
    await expect(stackedChart.querySelectorAll('path[data-series-fill]')).toHaveLength(3)
    await expect(canvas.queryByRole('img', { name: /Window 3 — Cache reads/ })).not.toBeInTheDocument()
    const mark = canvas.getByRole('img', { name: 'Window 4 — Cache reads: 150' })
    await userEvent.click(mark)
    await expect(canvas.getByRole('tooltip')).toHaveTextContent('Window 4 — Cache reads: 150')
    mark.blur()
    await expect(canvas.getByRole('table', { name: 'Token consumption data', hidden: true })).toHaveTextContent('Not reported')

    const gapChart = canvas.getByRole('group', { name: 'Input token trend' })
    await expect(gapChart.querySelectorAll('path[data-series-fill="input"]')).toHaveLength(2)
    await expect(within(gapChart).queryByRole('img', { name: /Window 3 — Input tokens/ })).not.toBeInTheDocument()

    await expect(canvas.getByRole('status')).toHaveTextContent('No reported data in this window.')
  },
} satisfies Story
