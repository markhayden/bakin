import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'

import { ChartExplainer, LineChart, type ChartDatum, type ChartSeries } from '@makinbakin/sdk/charts'

import { ChartStage } from './chart-story-stage'

const meta = {
  title: 'Charts/LineChart',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'LineChart is the dependency-free multi-series trend chart for change over time. Series take the fixed CVD-checked data palette with dash treatment and visible legend labels, so no cue rests on color alone. A missing value is preserved as a gap — never collapsed to zero — every mark mirrors pointer detail through keyboard focus and a tooltip, the exact-data table renders expanded below the chart by default so the evidence stays visible — `compactData` collapses it behind its disclosure for space-tight contexts — and an empty dataset is a named state, not invented marks.',
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
    <LineChart
      data={canonicalData}
      series={canonicalSeries}
      label="Task outcomes"
      description="Completed and failed tasks across four days."
    />
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('group', { name: 'Task outcomes' })).toBeVisible()
    await expect(canvas.getByRole('list', { name: 'Task outcomes legend' })).toHaveTextContent('Failed')
    await expect(canvas.queryByRole('img', { name: /Jul 26 — Failed/ })).not.toBeInTheDocument()
    const mark = canvas.getByRole('img', { name: 'Jul 27 — Failed: 3' })
    mark.focus()
    await expect(mark).toHaveFocus()
    await expect(canvas.getByRole('tooltip')).toHaveTextContent('Jul 27 — Failed: 3')
    mark.blur()
    const table = canvas.getByRole('table', { name: 'Task outcomes data' })
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

export const MissingDataAndEmpty = {
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
    const ceilingMark = canvas.getByRole('img', { name: 'Current window with a deliberately long exact label — Completed: 42' })
    await userEvent.click(ceilingMark)
    await expect(canvas.getByRole('tooltip')).toHaveAttribute('data-placement', 'below')
    ceilingMark.blur()
    canvas.getByRole('region', { name: 'Workflow outcomes plot' }).scrollLeft = 0
    await expect(canvas.getByRole('status')).toHaveTextContent('No reported data in this window.')
  },
} satisfies Story
