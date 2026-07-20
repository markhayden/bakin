import type { Meta, StoryObj } from '@storybook/react-vite'
import { BoundedOverflow, Grid, Inline, PageShell, Section, Stack } from '@makinbakin/sdk/layout'
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@makinbakin/sdk/ui'

import './layout.stories.css'

const meta = {
  title: 'Layout/Grid, section, and overflow',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Named responsive grid recipes, consistent section rhythm, and an accessible boundary for intrinsically wide content. Breakpoints remain an implementation detail of the available container.',
      },
    },
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const signals = [
  { label: 'Healthy', value: '18', status: 'Nominal', tone: 'success' as const },
  { label: 'Watching', value: '5', status: 'Monitor', tone: 'attention' as const },
  { label: 'Blocked', value: '2', status: 'Intervene', tone: 'danger' as const },
  { label: 'Unknown', value: '1', status: 'No report', tone: 'neutral' as const },
]

const runs = [
  ['Index assets', 'Search', 'Running', '12 min', 'Mae'],
  ['Publish release', 'Deploy', 'Needs review', '28 min', 'Sam'],
  ['Reconcile agents', 'Operations', 'Blocked', '43 min', 'Iris'],
]

export const ResponsiveComposition = {
  render: () => (
    <PageShell width="wide" className="bakin-layout-story bakin-layout-recipes-story">
      <Stack as="header" gap="dense" className="bakin-layout-story__heading">
        <p className="bakin-layout-story__eyebrow">Layout / responsive recipes</p>
        <h1>Structure changes with available space</h1>
        <p className="bakin-layout-story__lede">The component owns reflow. Builders choose the intent, not a breakpoint sequence.</p>
      </Stack>

      <Section aria-labelledby="signal-grid-title">
        <Inline align="baseline" justify="between">
          <h2 id="signal-grid-title">Runtime signals</h2>
          <Badge tone="success">Live</Badge>
        </Inline>
        <Grid as="ul" layout="quarters" gap="item" data-testid="responsive-grid" className="bakin-layout-recipes-story__signals">
          {signals.map((signal) => (
            <li key={signal.label}>
              <Card size="sm">
                <CardHeader>
                  <CardTitle>{signal.value}</CardTitle>
                  <CardDescription>{signal.label}</CardDescription>
                  <Badge tone={signal.tone}>{signal.status}</Badge>
                </CardHeader>
              </Card>
            </li>
          ))}
        </Grid>
      </Section>

      <Section divider="top" aria-labelledby="operations-title">
        <Inline align="baseline" justify="between">
          <h2 id="operations-title">Active operations</h2>
          <span className="bakin-layout-recipes-story__meta">Updated just now</span>
        </Inline>

        <Grid layout="main-aside" gap="section">
          <BoundedOverflow label="Active operation details">
            <table className="bakin-layout-recipes-story__table">
              <thead><tr><th>Operation</th><th>Area</th><th>Status</th><th>Age</th><th>Owner</th></tr></thead>
              <tbody>
                {runs.map((run) => <tr key={run[0]}>{run.map((value) => <td key={value}>{value}</td>)}</tr>)}
              </tbody>
            </table>
          </BoundedOverflow>

          <Card aria-labelledby="review-title">
            <CardHeader>
              <CardTitle id="review-title">Review queue</CardTitle>
              <CardDescription>Two decisions are waiting for an owner.</CardDescription>
            </CardHeader>
            <CardContent>
              <Stack gap="dense" className="bakin-layout-recipes-story__queue">
                <span>Publish release</span>
                <span>Approve runtime change</span>
              </Stack>
            </CardContent>
          </Card>
        </Grid>
      </Section>
    </PageShell>
  ),
} satisfies Story
