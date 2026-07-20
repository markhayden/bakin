import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'

import {
  assignSeriesColors,
  ChartDataTable,
  ChartExplainer,
  CHART_OTHER_COLOR,
  CHART_SERIES_COLORS,
  Sparkline,
  type ChartDatum,
} from '@makinbakin/sdk/charts'
import { Grid, PageShell, Stack } from '@makinbakin/sdk/layout'

import './chart-foundation.stories.css'

const meta = {
  title: 'Charts/Exact data and compact trends',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'The opt-in chart foundation keeps exact values, honest missing states, fixed palette assignment, and keyboard-equivalent point detail available independently of color.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'long-labels', 'empty', 'overflow', 'multi-series', 'non-color', 'keyboard', 'dense-data'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

function ChartStage({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <main className="bakin-chart-story">
      <PageShell width="wide">
        <Stack gap="section">
          <header className="bakin-chart-story__intro">
            <p>{eyebrow}</p>
            <h1>{title}</h1>
            <p>{description}</p>
          </header>
          {children}
        </Stack>
      </PageShell>
    </main>
  )
}

const outcomeSeries = [
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

export const ExactDataTable = {
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

const entities = ['archive', 'basil', 'caper', 'dill', 'ember', 'fig', 'ginger', 'hazel', 'indigo', 'juniper']
const assigned = assignSeriesColors(entities)

export const StablePalette = {
  render: () => (
    <ChartStage
      eyebrow="Data / categorical palette"
      title="Color follows the entity, not the filter"
      description="The fixed sequence is color-vision-deficiency checked. Visible names and slot copy preserve meaning without color."
    >
      <section aria-labelledby="palette-slots-heading" className="bakin-chart-story__section">
        <div>
          <h2 id="palette-slots-heading">Fixed series slots</h2>
          <p>Use the full entity set once. The ninth and later entities fold into a visibly labelled Other group.</p>
        </div>
        <ol className="bakin-chart-story__palette">
          {CHART_SERIES_COLORS.map((color, index) => (
            <li key={color}>
              <span aria-hidden="true" style={{ backgroundColor: color }} />
              <strong>Slot {index + 1}</strong>
              <code>{color.replace('var(', '').replace(')', '')}</code>
            </li>
          ))}
          <li>
            <span aria-hidden="true" style={{ backgroundColor: CHART_OTHER_COLOR }} />
            <strong>Other</strong>
            <code>{CHART_OTHER_COLOR.replace('var(', '').replace(')', '')}</code>
          </li>
        </ol>
      </section>
      <section aria-labelledby="stable-entities-heading" className="bakin-chart-story__section bakin-chart-story__section--quiet">
        <div>
          <h2 id="stable-entities-heading">Entity assignment</h2>
          <p>Alphabetical assignment stays stable when a filtered view shows only basil, ember, and hazel.</p>
        </div>
        <ul className="bakin-chart-story__entities">
          {['basil', 'ember', 'hazel', 'indigo', 'juniper'].map((entity) => (
            <li key={entity}>
              <span aria-hidden="true" style={{ backgroundColor: assigned.get(entity) }} />
              <span>{entity}</span>
              <small>{assigned.get(entity) === CHART_OTHER_COLOR ? 'Other group' : `Series slot ${CHART_SERIES_COLORS.indexOf(assigned.get(entity) as typeof CHART_SERIES_COLORS[number]) + 1}`}</small>
            </li>
          ))}
        </ul>
      </section>
    </ChartStage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByText('Slot 1')).toBeVisible()
    await expect(canvas.getAllByText('Other group')).toHaveLength(2)
    await expect(canvas.getByText('basil')).toBeVisible()
    await expect(canvas.getByText('Series slot 2')).toBeVisible()
  },
} satisfies Story

function Trend({
  label,
  value,
  change,
  values,
}: {
  label: string
  value: string
  change: string
  values: readonly (number | null)[]
}) {
  return (
    <article className="bakin-chart-story__trend">
      <div>
        <h2>{label}</h2>
        <strong>{value}</strong>
        <p>{change}</p>
      </div>
      <Sparkline
        label={`${label} across the last six reporting windows`}
        labels={['Window 1', 'Window 2', 'Window 3', 'Window 4', 'Window 5', 'Window 6']}
        values={values}
      />
    </article>
  )
}

export const CompactTrends = {
  render: () => (
    <ChartStage
      eyebrow="Data / compact trend"
      title="Shape supports the number; it does not replace it"
      description="Current value and direction stay visible. Every reported point is keyboard focusable and every missing window leaves a gap."
    >
      <Grid layout="split" gap="item" aria-label="Operational trend examples">
        <Trend label="Completed tasks" value="42" change="Up 8 from the prior window" values={[18, 24, 21, 31, 34, 42]} />
        <Trend label="Median queue time" value="4m 12s" change="Down 38 seconds from the prior window" values={[410, 380, null, 330, 290, 252]} />
        <Trend label="Retry rate for scheduled workflows with delayed third-party acknowledgements" value="2.4%" change="No material change" values={[2.3, 2.5, 2.4, 2.4, 2.3, 2.4]} />
        <Trend label="First observed dispatch" value="1 run" change="Not enough data for a trend" values={[1]} />
      </Grid>
      <ChartExplainer>Read the visible value and direction first; focus a point for its exact reporting-window value.</ChartExplainer>
    </ChartStage>
  ),
  play: async ({ canvas }) => {
    const point = canvas.getByRole('img', { name: 'Window 2: 24' })
    point.focus()
    await expect(point).toHaveFocus()
    await expect(canvas.getByRole('tooltip')).toHaveTextContent('Window 2: 24')
    await expect(canvas.getAllByText('Not enough data for a trend')[0]).toBeVisible()
    const medianChart = canvas.getByRole('group', { name: 'Median queue time across the last six reporting windows' })
    await expect(medianChart.querySelectorAll('[role="img"]')).toHaveLength(5)
  },
} satisfies Story
