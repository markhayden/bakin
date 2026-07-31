import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'

import { ChartExplainer, PieChart, type PieChartDatum } from '@makinbakin/sdk/charts'

import { ChartStage } from './chart-story-stage'

const canonicalData: PieChartDatum[] = [
  { key: 'writer', label: 'Writer', value: 24 },
  { key: 'reviewer', label: 'Reviewer', value: 12 },
  { key: 'publisher', label: 'Publisher', value: 8 },
]

const meta = {
  title: 'Charts/PieChart',
  component: PieChart,
  tags: ['public'],
  args: {
    data: canonicalData,
    label: 'Runs by agent',
    description: 'How the last 44 runs split across three agents.',
  },
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'PieChart shows one part-to-whole relationship with at most five slices. Entity colors come from the fixed color-vision-deficiency-checked palette in stable slot order — never by rank — and a sixth or later slice folds into one visibly named Other group while the exact-data table keeps every original row. Adjacent slices are separated by surface-colored gaps, larger slices carry a direct outside label, and an always-visible legend lists every slice with its chip, exact value, and share, so identity never rests on color alone. A zero value is omitted from the ring but retained in the table, a negative value renders a named error state instead of a broken ring, and an empty dataset is a named state. The exact-data table renders expanded by default so the evidence stays visible; `compactData` collapses it behind its disclosure for space-tight contexts. When entities need ranking or exceed five, use RankedBarChart; when composition changes across windows, use StackedColumnChart; for change over time, use LineChart.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'long-labels', 'empty', 'cvd', 'non-color', 'keyboard'],
  },
} satisfies Meta<typeof PieChart>

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  args: {
    donut: false,
    compactData: false,
    showDataTable: true,
    dataTableExpandable: true,
  },
  play: async ({ canvas, args }) => {
    await expect(canvas.getByRole('group', { name: 'Runs by agent' })).toBeVisible()
    await expect(canvas.getByRole('list', { name: 'Runs by agent legend' })).toHaveTextContent('Reviewer')
    const slice = canvas.getByRole('img', { name: 'Writer: 24 (55%)' })
    slice.focus()
    await expect(slice).toHaveFocus()
    await expect(canvas.getByRole('tooltip')).toHaveTextContent('Writer: 24 (55%)')
    slice.blur()
    const table = canvas.getByRole('table', { name: 'Runs by agent data', hidden: true })
    if (args.compactData) await expect(table).not.toBeVisible()
    else await expect(table).toBeVisible()
    await expect(table).toHaveTextContent('Publisher')
  },
} satisfies Story

const pluginRuns: PieChartDatum[] = [
  { key: 'assets', label: 'Assets', value: 340 },
  { key: 'chat', label: 'Chat', value: 220 },
  { key: 'health', label: 'Health', value: 180 },
  { key: 'workflows', label: 'Workflow orchestration with a deliberately long label', value: 120 },
  { key: 'brands', label: 'Brands', value: 40 },
  { key: 'memory', label: 'Memory', value: 30 },
  { key: 'schedule', label: 'Schedule', value: 20 },
  { key: 'explore', label: 'Explore', value: 0 },
]

export const DonutFoldAndEmpty = {
  render: () => (
    <ChartStage
      eyebrow="Data / part-to-whole"
      title="Five slices is the ceiling for part-to-whole"
      description="The smallest entities fold into one visibly named Other slice, a zero value never invents a sliver, and the exact-data table keeps every original row. Colors follow the entity through the fixed palette order, never its rank."
    >
      <section aria-labelledby="plugin-share-heading" className="bakin-chart-story__section">
        <div>
          <h2 id="plugin-share-heading">Run share by plugin</h2>
          <p>Eight entities · three folded into Other · one zero value kept to the table · donut variant.</p>
        </div>
        <PieChart
          data={pluginRuns}
          label="Runs by plugin"
          description="How 950 runs split across plugins; the three smallest are folded into Other."
          donut
        />
        <ChartExplainer>Slices below a readable share drop their direct label and rely on the legend and the exact table. The fold is visual only — every original row stays in the table.</ChartExplainer>
      </section>
      <section aria-labelledby="empty-pie-heading" className="bakin-chart-story__section bakin-chart-story__section--quiet">
        <div>
          <h2 id="empty-pie-heading">No observed runs</h2>
          <p>An empty dataset stays a named state and retains its exact-data path.</p>
        </div>
        <PieChart data={[]} label="Unobserved runs" />
      </section>
    </ChartStage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('group', { name: 'Runs by plugin' })).toBeVisible()
    const other = canvas.getByRole('img', { name: 'Other (3): 90 (9%)' })
    await expect(other).toHaveAttribute('data-other', 'true')
    await expect(canvas.queryByRole('img', { name: /Explore/ })).not.toBeInTheDocument()
    const legend = canvas.getByRole('list', { name: 'Runs by plugin legend' })
    await expect(legend).toHaveTextContent('Other (3)')
    await expect(legend).not.toHaveTextContent('Explore')
    await expect(canvas.getByRole('table', { name: 'Runs by plugin data', hidden: true })).toHaveTextContent('Explore')
    await expect(canvas.getByRole('status')).toHaveTextContent('No reported data in this window.')
  },
} satisfies Story

const mixedOutcomes: PieChartDatum[] = [
  { key: 'succeeded', label: 'succeeded', value: 41 },
  { key: 'failed', label: 'failed', value: 5 },
  { key: 'hiccups', label: 'hiccups', value: 2 },
]

export const StatusTonedOutcomes = {
  render: () => (
    <ChartStage
      eyebrow="Data / outcome status"
      title="Outcome charts wear status colors, not categorical slots"
      description="When slices mean good or bad — succeeded, failed, warning — the ring opts into the fixed status steps with tones: green means good, red means bad, amber means attention. The steps are re-stepped in lightness so adjacent green and red stay separable under color-vision deficiency, and the gaps, direct labels, legend, and exact table keep identity off color alone."
    >
      <section aria-labelledby="mixed-outcomes-heading" className="bakin-chart-story__section">
        <div>
          <h2 id="mixed-outcomes-heading">How calls ended</h2>
          <p>Mostly good hour · a red failed wedge and a small amber hiccup wedge stand out of the green ring.</p>
        </div>
        <PieChart
          data={mixedOutcomes}
          tones={{ succeeded: 'success', failed: 'danger', hiccups: 'attention' }}
          label="How calls ended"
          description="41 of 48 calls succeeded; 5 failed and 2 hiccuped."
          donut
        />
        <ChartExplainer>A series that means good or bad wears status steps; a series that is merely “series 4” stays categorical. The two vocabularies never mix in one ring.</ChartExplainer>
      </section>
      <section aria-labelledby="healthy-hour-heading" className="bakin-chart-story__section bakin-chart-story__section--quiet">
        <div>
          <h2 id="healthy-hour-heading">A healthy hour</h2>
          <p>All succeeded · the whole ring is one green band with its exact count.</p>
        </div>
        <PieChart
          data={[
            { key: 'succeeded', label: 'succeeded', value: 62 },
            { key: 'failed', label: 'failed', value: 0 },
          ]}
          tones={{ succeeded: 'success', failed: 'danger' }}
          label="A healthy hour"
          donut
        />
      </section>
    </ChartStage>
  ),
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByRole('group', { name: 'How calls ended' })).toBeVisible()
    const fill = (key: string) =>
      canvasElement.querySelector(`[role="group"][aria-label="How calls ended"] [data-slice="${key}"]`)?.getAttribute('fill')
    await expect(fill('succeeded')).toBe('var(--bakin-color-data-status-success)')
    await expect(fill('failed')).toBe('var(--bakin-color-data-status-danger)')
    await expect(fill('hiccups')).toBe('var(--bakin-color-data-status-attention)')
    await expect(canvas.getByRole('img', { name: 'succeeded: 41 (85%)' }))
      .toHaveAttribute('stroke-width', '2')
    const legend = canvas.getByRole('list', { name: 'How calls ended legend' })
    await expect(legend).toHaveTextContent('failed')
    await expect(legend).toHaveTextContent('5 (10%)')
    // The healthy hour renders as one full green ring; the zero stays in the table.
    const healthyRing = canvasElement.querySelector('[role="group"][aria-label="A healthy hour"] circle[data-slice="succeeded"]')
    await expect(healthyRing?.getAttribute('stroke')).toBe('var(--bakin-color-data-status-success)')
    await expect(canvas.getByRole('table', { name: 'A healthy hour data', hidden: true })).toHaveTextContent('failed')
  },
} satisfies Story
