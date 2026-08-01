import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'

import { ChartExplainer, Sparkline } from '@makinbakin/sdk/charts'
import { Grid } from '@makinbakin/sdk/layout'

import { ChartStage } from './chart-story-stage'

const meta = {
  title: 'Charts/Sparkline',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Sparkline is the compact trend that supports a visible current value and direction — shape supports the number, it never replaces it. Every reported point is keyboard focusable and mirrors pointer detail through an exact reporting-window tooltip, a null or non-finite window leaves a gap instead of collapsing to zero, the exact values stay reachable in a visually hidden data table, and fewer than two reported points render an honest not-enough-data state rather than implying a trend.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'long-labels', 'non-color', 'keyboard', 'dense-data', 'missing-data'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  render: () => (
    <Sparkline
      label="Completed tasks across the last six reporting windows"
      labels={['Window 1', 'Window 2', 'Window 3', 'Window 4', 'Window 5', 'Window 6']}
      values={[18, 24, null, 31, 34, 42]}
    />
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('group', { name: 'Completed tasks across the last six reporting windows' })).toBeVisible()
    await expect(canvas.queryByRole('img', { name: /Window 3/ })).not.toBeInTheDocument()
    const point = canvas.getByRole('img', { name: 'Window 2: 24' })
    point.focus()
    await expect(point).toHaveFocus()
    await expect(canvas.getByRole('tooltip')).toHaveTextContent('Window 2: 24')
    point.blur()
    await expect(canvas.getByRole('table', { name: 'Completed tasks across the last six reporting windows data', hidden: true })).toHaveTextContent('Not reported')
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

export const AreaFill = {
  render: () => (
    <ChartStage
      eyebrow="Data / compact trend"
      title="An area fill emphasizes magnitude without changing the contract"
      description="The soft fill rides under the same line: gaps stay gaps, every reported point stays keyboard focusable, and the exact table is unchanged."
    >
      <article className="bakin-chart-story__trend">
        <div>
          <h2>Assets generated</h2>
          <strong>42</strong>
          <p>Up 8 from the prior window</p>
        </div>
        <Sparkline
          area
          label="Assets generated across the last six reporting windows"
          labels={['Window 1', 'Window 2', 'Window 3', 'Window 4', 'Window 5', 'Window 6']}
          values={[18, 24, null, 31, 34, 42]}
        />
      </article>
      <ChartExplainer>Use the fill when accumulated magnitude is the message; the default line remains the neutral choice.</ChartExplainer>
    </ChartStage>
  ),
  play: async ({ canvas }) => {
    const chart = canvas.getByRole('group', { name: 'Assets generated across the last six reporting windows' })
    await expect(chart.querySelectorAll('path[data-series-fill="value"]')).toHaveLength(2)
    await expect(canvas.queryByRole('img', { name: /Window 3/ })).not.toBeInTheDocument()
    const point = canvas.getByRole('img', { name: 'Window 5: 34' })
    point.focus()
    await expect(point).toHaveFocus()
    await expect(canvas.getByRole('tooltip')).toHaveTextContent('Window 5: 34')
    point.blur()
  },
} satisfies Story
