import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'

import {
  assignSeriesColors,
  ChartExplainer,
  CHART_OTHER_COLOR,
  CHART_SERIES_COLORS,
  StackedColumnChart,
  type ChartDatum,
} from '@makinbakin/sdk/charts'

import { ChartStage } from './chart-story-stage'

const meta = {
  title: 'Components/Charts/StackedColumnChart',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'StackedColumnChart shows dense composition across windows for a stable set of entities. Colors come from the fixed color-vision-deficiency-checked palette and follow the entity, not the filter: the first eight entity slots stay stable, later entities fold into one visibly named Other group, and visible names plus slot copy preserve meaning without color. A missing window renders as Not reported — never zero — an in-progress window is labelled, the interactive legend never hides the last visible series, keyboard focus mirrors pointer tooltips per column, and the exact-data table renders expanded by default so the evidence stays visible — `compactData` collapses it behind its disclosure for space-tight contexts. An empty dataset is a named state without invented marks.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'long-labels', 'empty', 'overflow', 'multi-series', 'cvd', 'non-color', 'keyboard', 'interaction', 'missing-data'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const canonicalKeys = ['writer', 'reviewer', 'publisher']

const canonicalData: ChartDatum[] = [
  { x: 'jul-24', xLabel: 'Jul 24', values: { writer: 4, reviewer: 2, publisher: 1 } },
  { x: 'jul-25', xLabel: 'Jul 25', values: { writer: 6, reviewer: 3, publisher: 2 } },
  { x: 'jul-26', xLabel: 'Jul 26', values: {} },
  { x: 'jul-27', xLabel: 'Jul 27', values: { writer: 5, reviewer: 4, publisher: 2 } },
]

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  render: () => (
    <StackedColumnChart
      data={canonicalData}
      seriesKeys={canonicalKeys}
      label="Agent runs by day"
      height={160}
    />
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('group', { name: 'Agent runs by day' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'writer' })).toHaveAttribute('aria-pressed', 'true')
    const missing = canvas.getByRole('img', { name: 'Jul 26: Not reported' })
    await expect(missing).toHaveAttribute('data-missing', 'true')
    const column = canvas.getByRole('img', { name: 'Jul 25: publisher 2, reviewer 3, writer 6, total 11' })
    column.focus()
    await expect(column).toHaveFocus()
    await expect(canvas.getByRole('tooltip')).toHaveTextContent('Total 11')
    column.blur()
    const table = canvas.getByRole('table', { name: 'Agent runs by day data' })
    await expect(table).toBeVisible()
    await expect(table).toHaveTextContent('Not reported')
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

export const DenseComposition = {
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
