import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'

import { ChartExplainer, CompositionBar } from '@makinbakin/sdk/charts'

import { ChartStage } from './chart-story-stage'

const meta = {
  title: 'Components/Charts/CompositionBar',
  component: CompositionBar,
  tags: ['public'],
  args: {
    label: 'Task outcomes',
    data: [
      { key: 'succeeded', label: 'Succeeded', value: 18 },
      { key: 'failed', label: 'Failed', value: 4 },
      { key: 'canceled', label: 'Canceled', value: 2 },
    ],
  },
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'CompositionBar is the single-strip part-to-whole summary: one horizontal 100%-stacked bar showing how one whole divides — token mixes, outcome shares, category splits. Segments keep the fixed categorical palette order (never cycled), zero-value segments are omitted from the strip but stay in the accessible summary and the legend, and the strip carries a complete accessible name with exact values. At the default size each segment is keyboard-focusable with the shared tooltip and the list legend below carries exact values; there is no separate exact-data table because the legend IS the exact data at this scale. The inline size fits inside a metric row as a single labelled image — per-segment targets would be too small, so the accessible summary carries everything and the legend is forced off. Part-to-whole only: use StackedColumnChart to compare composition across buckets and RankedBarChart to rank absolute values.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'empty', 'non-color', 'keyboard'],
  },
} satisfies Meta<typeof CompositionBar>

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  args: {
    size: 'default',
    legend: true,
  },
  render: (args) => (
    <div style={{ width: 360 }}>
      <CompositionBar {...args} />
    </div>
  ),
  play: async ({ canvas, args }) => {
    await expect(
      canvas.getByRole('img', { name: 'Task outcomes: Succeeded 18 (75%), Failed 4 (17%), Canceled 2 (8%)' }),
    ).toBeVisible()
    // The legend is the exact data at default size; inline strips (and an
    // explicit legend opt-out) speak entirely through the accessible summary.
    const legendExpected = args.size !== 'inline' && args.legend !== false
    const legend = canvas.queryByRole('list', { name: 'Task outcomes legend' })
    if (legendExpected) {
      await expect(legend).toBeVisible()
      await expect(legend).toHaveTextContent('Succeeded')
      await expect(legend).toHaveTextContent('18')
      await expect(legend).toHaveTextContent('Canceled')
    } else {
      await expect(legend).not.toBeInTheDocument()
    }
  },
} satisfies Story

const tokenFormat = (value: number) => `${Math.round(value / 1000)}k tokens`

export const CompositionStrips = {
  render: () => (
    <ChartStage
      eyebrow="Data / part-to-whole"
      title="One strip for how a whole divides"
      description="A default strip carries a legend with exact values; the inline strip fits a metric row and speaks entirely through its accessible summary. Zero segments leave the strip but never leave the record."
    >
      <section aria-labelledby="composition-default-heading" className="bakin-chart-story__section">
        <div>
          <h2 id="composition-default-heading">Session token mix</h2>
          <p>Default size · keyboard-focusable segments with the shared tooltip · legend carries the exact values.</p>
        </div>
        <CompositionBar
          label="Session token mix"
          formatValue={tokenFormat}
          data={[
            { key: 'input', label: 'Input', value: 412_000 },
            { key: 'output', label: 'Output', value: 96_000 },
            { key: 'cacheRead', label: 'Cache read', value: 1_400_000 },
            { key: 'cacheWrite', label: 'Cache write', value: 220_000 },
          ]}
        />
        <ChartExplainer>The legend is the exact data at this scale; a composition strip never needs a separate table.</ChartExplainer>
      </section>
      <section aria-labelledby="composition-zero-heading" className="bakin-chart-story__section">
        <div>
          <h2 id="composition-zero-heading">Run outcomes this hour</h2>
          <p>A reported zero is omitted from the strip but stays in the accessible summary and the legend.</p>
        </div>
        <CompositionBar
          label="Run outcomes this hour"
          data={[
            { key: 'succeeded', label: 'Succeeded', value: 12 },
            { key: 'failed', label: 'Failed', value: 0 },
            { key: 'canceled', label: 'Canceled', value: 3 },
          ]}
        />
      </section>
      <section aria-labelledby="composition-inline-heading" className="bakin-chart-story__section bakin-chart-story__section--quiet">
        <div>
          <h2 id="composition-inline-heading">Inline in a metric row</h2>
          <p>The inline size stays a single labelled image between a metric&rsquo;s headline and its caption.</p>
        </div>
        <div style={{ maxWidth: 220 }}>
          <p style={{ margin: 0, fontWeight: 600 }}>950k tokens</p>
          <div style={{ margin: '6px 0' }}>
            <CompositionBar
              size="inline"
              label="writer-agent usage attribution"
              formatValue={tokenFormat}
              data={[
                { key: 'tracked', label: 'Tracked work', value: 620_000 },
                { key: 'interactive', label: 'Interactive sessions', value: 240_000 },
                { key: 'unexplained', label: 'Unexplained', value: 90_000 },
              ]}
            />
          </div>
          <p style={{ margin: 0, fontSize: 12 }}>Usage &amp; cost</p>
        </div>
        <div style={{ maxWidth: 220 }}>
          <CompositionBar
            size="inline"
            label="Latest-session token mix"
            data={[]}
            emptyLabel="No latest-session traffic reported."
          />
        </div>
      </section>
    </ChartStage>
  ),
  play: async ({ canvas, canvasElement }) => {
    const segment = canvas.getByRole('img', { name: 'Cache read 1400k tokens (66%)' })
    segment.focus()
    await expect(segment).toHaveFocus()
    await expect(canvas.getByRole('tooltip')).toHaveTextContent('Cache read 1400k tokens (66%)')
    segment.blur()

    await expect(
      canvas.getByRole('img', { name: 'Run outcomes this hour: Succeeded 12 (80%), Failed 0 (0%), Canceled 3 (20%)' }),
    ).toBeVisible()
    await expect(canvasElement.querySelector('[data-segment-key="failed"]')).toBeNull()
    await expect(canvas.getByRole('list', { name: 'Run outcomes this hour legend' })).toHaveTextContent('Failed')

    await expect(
      canvas.getByRole('img', {
        name: 'writer-agent usage attribution: Tracked work 620k tokens (65%), Interactive sessions 240k tokens (25%), Unexplained 90k tokens (9%)',
      }),
    ).toBeVisible()
    await expect(canvas.queryByRole('list', { name: 'writer-agent usage attribution legend' })).not.toBeInTheDocument()

    await expect(
      canvas.getByRole('img', { name: 'Latest-session token mix: No latest-session traffic reported.' }),
    ).toBeVisible()
  },
} satisfies Story
