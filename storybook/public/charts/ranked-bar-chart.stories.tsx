import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'

import { ChartExplainer, RankedBarChart, type ChartDatum } from '@makinbakin/sdk/charts'

import { ChartStage } from './chart-story-stage'

const meta = {
  title: 'Charts/RankedBarChart',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'RankedBarChart ranks one series of like-unit values without forcing long entity names onto an axis: each row keeps its full name, a visible exact value, and a keyboard-focusable bar. A missing value stays missing — visibly labelled, never a zero-length bar — and the exact-data table renders expanded below the ranking by default so the evidence stays visible; `compactData` collapses it behind its disclosure for space-tight contexts. Use separate ranked views for unlike units such as dollars and subscription tokens.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'long-labels', 'non-color', 'keyboard', 'missing-data', 'multi-series'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const canonicalData: ChartDatum[] = [
  { x: 'writer', xLabel: 'writer-agent', values: { runs: 48 } },
  { x: 'reviewer', xLabel: 'reviewer-agent', values: { runs: 31 } },
  { x: 'publisher', xLabel: 'publisher-agent', values: {}, missingLabels: { runs: 'Not reported' } },
]

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  render: () => (
    <RankedBarChart
      data={canonicalData}
      series={{ key: 'runs', label: 'Completed runs' }}
      label="Completed runs by agent"
    />
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('group', { name: 'Completed runs by agent' })).toBeVisible()
    const bar = canvas.getByRole('img', { name: 'writer-agent — Completed runs: 48' })
    bar.focus()
    await expect(bar).toHaveFocus()
    bar.blur()
    await expect(canvas.queryByRole('img', { name: /publisher-agent/ })).not.toBeInTheDocument()
    await expect(canvas.getAllByText('Not reported')).toHaveLength(2)
    const table = canvas.getByRole('table', { name: 'Completed runs by agent data' })
    await expect(table).toBeVisible()
    await expect(table).toHaveTextContent('reviewer-agent')
  },
} satisfies Story

const spendRankingData: ChartDatum[] = [
  { x: 'sonnet', xLabel: 'anthropic/claude-sonnet-4-20250514', values: { cost: 5_840_000 } },
  { x: 'gpt', xLabel: 'openai/gpt-5.5-codex', values: { cost: 3_120_000 } },
  { x: 'haiku', xLabel: 'anthropic/claude-haiku-4-5', values: { cost: 740_000 } },
  {
    x: 'unpriced',
    xLabel: 'provider/model-with-a-deliberately-long-unpriced-name',
    values: {},
    missingLabels: { cost: 'Cost unavailable' },
  },
]

export const RankedComparison = {
  render: () => (
    <ChartStage
      eyebrow="Data / ranked comparison"
      title="Rank long labels without forcing them onto an axis"
      description="A ranked bar keeps one unit, full entity names, visible exact values, and an exact-data disclosure together. Missing cost stays missing instead of becoming a zero-length bar."
    >
      <section aria-labelledby="ranked-bar-heading" className="bakin-chart-story__section">
        <div>
          <h2 id="ranked-bar-heading">Estimated model spend</h2>
          <p>One dollar series · descending rank · one explicitly unpriced model.</p>
        </div>
        <RankedBarChart
          data={spendRankingData}
          series={{ key: 'cost', label: 'Estimated cost' }}
          label="Estimated model spend ranking"
          formatValue={(value) => `$${(value / 1_000_000).toFixed(2)}`}
        />
        <ChartExplainer>Use separate ranked views for unlike units such as dollars and subscription tokens.</ChartExplainer>
      </section>
    </ChartStage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('group', { name: 'Estimated model spend ranking' })).toBeVisible()
    await expect(canvas.getByRole('img', { name: 'anthropic/claude-sonnet-4-20250514 — Estimated cost: $5.84' })).toBeVisible()
    await expect(canvas.getAllByText('Cost unavailable')).toHaveLength(2)
    await expect(canvas.getByRole('table', { name: 'Estimated model spend ranking data', hidden: true })).toHaveTextContent('openai/gpt-5.5-codex')
  },
} satisfies Story

const destinationData: ChartDatum[] = [
  { x: 'tasks-route', xLabel: 'POST /api/tasks', values: { count: 132, failed: 6 } },
  { x: 'assets-tool', xLabel: 'bakin exec assets save', values: { count: 87, failed: 0 } },
  { x: 'search-route', xLabel: 'GET /api/search', values: { count: 54, failed: 12 } },
]

export const HighlightedSubSegment = {
  render: () => (
    <ChartStage
      eyebrow="Data / highlighted sub-segment"
      title="A total bar can carry its highlighted portion"
      description="The optional secondary series renders as a full-opacity inset segment over a muted total — the failure-overlay pattern. The legend, each bar's accessible label, and the exact table carry both numbers."
    >
      <section aria-labelledby="sub-segment-heading" className="bakin-chart-story__section">
        <div>
          <h2 id="sub-segment-heading">Calls by destination</h2>
          <p>One unit for both numbers · the failed portion insets at the end of each muted total.</p>
        </div>
        <RankedBarChart
          data={destinationData}
          series={{ key: 'count', label: 'Calls' }}
          secondary={{ key: 'failed', label: 'Failed', color: 'var(--bakin-color-signal-danger)' }}
          label="Calls by destination"
        />
        <ChartExplainer>The sub-segment must share the primary unit; unlike units still take separate ranked views.</ChartExplainer>
      </section>
    </ChartStage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('img', { name: 'POST /api/tasks — Calls: 132, Failed: 6' })).toBeVisible()
    await expect(canvas.getByRole('img', { name: 'bakin exec assets save — Calls: 87, Failed: 0' })).toBeVisible()
    const legend = canvas.getByRole('list', { name: 'Calls by destination legend' })
    await expect(legend).toHaveTextContent('Calls')
    await expect(legend).toHaveTextContent('Failed')
    const table = canvas.getByRole('table', { name: 'Calls by destination data', hidden: true })
    await expect(table).toHaveTextContent('132')
    await expect(table).toHaveTextContent('12')
    await expect(table).toHaveTextContent('Failed')
  },
} satisfies Story
