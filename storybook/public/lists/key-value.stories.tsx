import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'

import { KeyValue } from '@makinbakin/sdk/patterns'

import { StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Components/Lists/KeyValue',
  component: KeyValue,
  // Canonical fixture args at meta level: the render-based layouts story
  // inherits the required items.
  args: {
    items: [
      { label: 'Model', value: 'claude-sonnet-4' },
      { label: 'Tokens', value: '12.3k in / 4.1k out', numeric: true },
      { label: 'Cost', value: '$0.42', numeric: true },
      { label: 'Route', value: null },
    ],
  },
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'KeyValue is the one contract for object metadata — the label/value pairs that describe a record rather than compare records (a table does that). Three layouts cover every surface: `inline` wraps pairs onto as few lines as fit, for a compact meta strip inside a feed entry or under a heading; `rows` stacks one pair per row with the value pushed right and an optional rule between rows, for a readable field list in a panel or drawer; `columns` aligns labels in a left column beside their values on wide containers and collapses to stacked pairs when narrow. Per-item flags carry the value\'s nature rather than its styling: `mono` for identifiers and paths, `numeric` for digits that must line up when stacked, `breakValue` for long unbroken strings. A `null` or `undefined` value renders an em dash — metadata is read comparatively, so a missing field must stay visible rather than collapsing the list and silently changing what the reader is comparing.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'long-labels', 'dense-data'],
  },
} satisfies Meta<typeof KeyValue>

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  argTypes: {
    layout: { control: 'select', options: ['inline', 'rows', 'columns'] },
    // Pair data is the fixture, not a knob.
    items: { control: false },
  },
  // The list fills its container, so the centered canvas needs a definite
  // inline size or it collapses to its content width.
  render: (args) => (
    <div style={{ inlineSize: '22rem', maxInlineSize: '100%' }}>
      <KeyValue {...args} />
    </div>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByText('claude-sonnet-4')).toBeVisible()
    // A field with no value keeps its row rather than disappearing.
    await expect(canvas.getByText('Route')).toBeVisible()
    await expect(canvas.getByText('—')).toBeVisible()
  },
} satisfies Story

export const LayoutsAndValueKinds = {
  render: () => (
    <StoryStage
      eyebrow="Lists / Key-value"
      title="One pair contract, three densities"
      description="The layout follows the surface: a strip inside a feed entry, a field list in a panel, an aligned pair grid in a detail view."
    >
      <StorySection title="Inline" description="Compact meta strip — wraps onto as few lines as fit.">
        <KeyValue
          layout="inline"
          items={[
            { label: 'Attempt', value: '3' },
            { label: 'Duration', value: '4m 12s', numeric: true },
            { label: 'Model', value: 'claude-sonnet-4' },
          ]}
        />
      </StorySection>

      <StorySection title="Rows" description="Field list with the value pushed right; numbers align for comparison.">
        <KeyValue
          items={[
            { label: 'main-instructions', value: '257 B', numeric: true, mono: true },
            { label: 'task-header', value: '22 B', numeric: true, mono: true },
            { label: 'lessons', value: '1.4 KiB', numeric: true, mono: true },
          ]}
        />
      </StorySection>

      <StorySection title="Columns" description="Aligned label column on wide containers; stacks when narrow.">
        <KeyValue
          layout="columns"
          items={[
            { label: 'Raw name', value: 'bakin_exec_assets_save', mono: true, breakValue: true },
            { label: 'Kind', value: 'MCP tool' },
            { label: 'Workspace', value: '/Users/example/.bakin/agents/main', mono: true, breakValue: true },
          ]}
        />
      </StorySection>
    </StoryStage>
  ),
} satisfies Story
