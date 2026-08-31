import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'

import { ChartExplainer, LineChart, type ChartDatum, type ChartSeries } from '@makinbakin/sdk/charts'

const meta = {
  title: 'Components/Charts/ChartExplainer',
  component: ChartExplainer,
  tags: ['public'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'ChartExplainer is the one-sentence plain-language note rendered beside a chart. Use it to state what the marks mean — why a gap exists, what folded into Other, which units a form may carry — in visible text, so the reading never depends on color, hover, or prior knowledge. It is an adjunct: it narrates a chart from `@makinbakin/sdk/charts`, it never replaces the chart’s own legend, exact-data table, or missing-value honesty.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'non-color'],
  },
} satisfies Meta<typeof ChartExplainer>

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
  args: { children: 'The failed series skips Jul 26 because that window was not reported.' },
  argTypes: { children: { control: 'text' } },
  render: (args) => (
    <div>
      <LineChart
        data={canonicalData}
        series={canonicalSeries}
        label="Task outcomes"
        description="Completed and failed tasks across four days."
      />
      <ChartExplainer {...args} />
    </div>
  ),
  play: async ({ canvas }) => {
    const note = canvas.getByRole('note')
    await expect(note).toBeVisible()
    await expect(note).toHaveTextContent('The failed series skips Jul 26 because that window was not reported.')
    await expect(canvas.queryByRole('img', { name: /Jul 26 — Failed/ })).not.toBeInTheDocument()
  },
} satisfies Story
