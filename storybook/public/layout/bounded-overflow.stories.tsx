import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'
import { BoundedOverflow } from '@makinbakin/sdk/layout'

import { StorySection, StoryStage } from '../../support'
import './bounded-overflow.stories.css'

// No `component:` on meta — BoundedOverflow's required label prop would force
// `args` onto render-only stories (same shape as the chart entries).
const meta = {
  title: 'Layout/BoundedOverflow',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'BoundedOverflow is the accessible boundary for intrinsically wide content — tables, timelines, canvases. It renders a labelled scroll region (`role="region"` with a required `label` or `labelledBy`) that is keyboard focusable (`tabIndex={0}`) with a visible focus ring, scrolls horizontally inside itself, and never lets the document grow a page-level horizontal scrollbar.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'overflow', 'keyboard'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const runs = [
  ['Index assets', 'Search', 'Running', '12 min', 'Mae'],
  ['Publish release', 'Deploy', 'Needs review', '28 min', 'Sam'],
  ['Reconcile agents', 'Operations', 'Blocked', '43 min', 'Iris'],
]

function OperationsTable() {
  return (
    <table className="bakin-bounded-overflow-story__table">
      <thead><tr><th>Operation</th><th>Area</th><th>Status</th><th>Age</th><th>Owner</th></tr></thead>
      <tbody>
        {runs.map((run) => <tr key={run[0]}>{run.map((value) => <td key={value}>{value}</td>)}</tr>)}
      </tbody>
    </table>
  )
}

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  // Width frame: the centered (shrink-to-fit) canvas would let the region
  // grow to its content, hiding the one thing this component does — the
  // frame is the bounded width the wide table scrolls inside.
  render: () => (
    <div style={{ inlineSize: '24rem', maxInlineSize: '100%' }}>
      <BoundedOverflow label="Active operation details">
        <table className="bakin-bounded-overflow-story__table">
          <thead><tr><th>Operation</th><th>Area</th><th>Status</th><th>Age</th><th>Owner</th></tr></thead>
          <tbody>
            <tr><td>Publish release</td><td>Deploy</td><td>Needs review</td><td>28 min</td><td>Sam</td></tr>
            <tr><td>Index assets</td><td>Search</td><td>Running</td><td>12 min</td><td>Mae</td></tr>
          </tbody>
        </table>
      </BoundedOverflow>
    </div>
  ),
  play: async ({ canvas }) => {
    const region = canvas.getByRole('region', { name: 'Active operation details' })
    await expect(region).toHaveAttribute('tabindex', '0')
    region.focus()
    await expect(region).toHaveFocus()
    await expect(canvas.getByRole('table')).toBeVisible()
    // The wide table scrolls inside the region; the page never overflows.
    await expect(region.scrollWidth).toBeGreaterThan(region.clientWidth)
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth)
  },
} satisfies Story

export const WideOperationsTable = {
  render: () => (
    <StoryStage
      eyebrow="Layout / bounded width"
      title="Wide content scrolls inside its boundary"
      description="The table keeps its intrinsic width; the labelled region owns the horizontal scroll so the page never overflows."
    >
      <StorySection
        title="Active operations"
        description="Focus the region and scroll horizontally with the keyboard; every column stays reachable."
      >
        <BoundedOverflow label="Active operation details">
          <OperationsTable />
        </BoundedOverflow>
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas }) => {
    const region = canvas.getByRole('region', { name: 'Active operation details' })
    region.focus()
    await expect(region).toHaveFocus()
    await expect(region.scrollWidth).toBeGreaterThan(region.clientWidth)
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth)
  },
} satisfies Story
