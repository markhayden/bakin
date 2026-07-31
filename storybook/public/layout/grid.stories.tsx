import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'
import { Grid, Inline } from '@makinbakin/sdk/layout'
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@makinbakin/sdk/ui'

import { StorySection, StoryStage } from '../../support'
import './grid.stories.css'

const meta = {
  title: 'Layout/Grid',
  component: Grid,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Grid provides named responsive recipes — `single`, `split`, `thirds`, `quarters`, `cards`, `auto-fill`, `main-aside` — that reflow with the available container, never a viewport breakpoint sequence. Builders choose the layout intent; the component owns when columns divide. `cards` (auto-fit) stretches items into the available width, while `auto-fill` keeps empty tracks so sparse card grids hold a fixed 250px minimum card width. Gaps map to the finite semantic scale and `as` renders semantic list elements.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'dense-data'],
  },
} satisfies Meta<typeof Grid>

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  render: () => (
    <Grid layout="split" gap="item">
      <Card>
        <CardHeader>
          <CardTitle>Daybreak Studio</CardTitle>
          <CardDescription>A content-dense bounded object stays full width on mobile.</CardDescription>
        </CardHeader>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Northstar Trails</CardTitle>
          <CardDescription>The pair appears side by side only when the container can support it.</CardDescription>
        </CardHeader>
      </Card>
    </Grid>
  ),
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByText('Daybreak Studio')).toBeVisible()
    const grid = canvasElement.querySelector('[data-slot="grid"]')
    await expect(grid).toHaveAttribute('data-layout', 'split')
    await expect(grid!.parentElement).toHaveAttribute('data-slot', 'grid-container')
  },
} satisfies Story

const signals = [
  { label: 'Healthy', value: '18', status: 'Nominal', tone: 'success' as const },
  { label: 'Watching', value: '5', status: 'Monitor', tone: 'attention' as const },
  { label: 'Blocked', value: '2', status: 'Intervene', tone: 'danger' as const },
  { label: 'Unknown', value: '1', status: 'No report', tone: 'neutral' as const },
]

export const ResponsiveRecipes = {
  render: () => (
    <StoryStage
      eyebrow="Layout / responsive recipes"
      title="Structure changes with available space"
      description="The component owns reflow. Builders choose the intent, not a breakpoint sequence."
      width="wide"
    >
      <StorySection title="Runtime signals" description="The quarters recipe steps from one column to four as the container grows.">
        <Grid as="ul" layout="quarters" gap="item" data-testid="responsive-grid" className="bakin-grid-story__signals">
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
      </StorySection>

      <StorySection
        title="Comfortable two-up objects"
        description="Split grids stay single-column on narrow canvases, then divide when both objects retain a useful reading width."
      >
        <Grid layout="split" gap="item" data-testid="comfortable-split">
          <Card>
            <CardHeader>
              <CardTitle>Daybreak Studio</CardTitle>
              <CardDescription>A content-dense bounded object stays full width on mobile.</CardDescription>
            </CardHeader>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Northstar Trails</CardTitle>
              <CardDescription>The pair appears side by side only when the container can support it.</CardDescription>
            </CardHeader>
          </Card>
        </Grid>
      </StorySection>

      <StorySection
        title="Active operations"
        description="The main-aside recipe pairs a primary object with supporting context until the container narrows."
      >
        <Grid layout="main-aside" gap="section" data-testid="main-aside">
          <Card aria-labelledby="operations-summary-title">
            <CardHeader>
              <CardTitle id="operations-summary-title">Operations summary</CardTitle>
              <CardDescription>Three operations are active; one is blocked and needs an owner.</CardDescription>
            </CardHeader>
            <CardContent>
              <Inline gap="item">
                <Badge tone="success">Running 1</Badge>
                <Badge tone="attention">Needs review 1</Badge>
                <Badge tone="danger">Blocked 1</Badge>
              </Inline>
            </CardContent>
          </Card>

          <Card aria-labelledby="review-title">
            <CardHeader>
              <CardTitle id="review-title">Review queue</CardTitle>
              <CardDescription>Two decisions are waiting for an owner.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="bakin-grid-story__queue">
                <li>Publish release</li>
                <li>Approve runtime change</li>
              </ul>
            </CardContent>
          </Card>
        </Grid>
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByTestId('responsive-grid')).toHaveAttribute('data-layout', 'quarters')
    await expect(canvas.getByTestId('comfortable-split')).toHaveAttribute('data-layout', 'split')
    await expect(canvas.getByTestId('main-aside')).toHaveAttribute('data-layout', 'main-aside')
    await expect(canvas.getByTestId('responsive-grid').closest('[data-slot="grid-container"]')).toBeTruthy()
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth)
  },
} satisfies Story

const assets = [
  'Launch hero',
  'Brand palette sheet',
  'Q3 recap deck',
  'Onboarding walkthrough',
  'Voice sample pack',
  'Social banner set',
]

export const AutoFill = {
  render: () => (
    <StoryStage
      eyebrow="Layout / auto-fill"
      title="Card grids keep their card width"
      description="auto-fill reserves empty tracks, so a sparse grid holds its minimum card width instead of stretching a few items across the container."
      width="wide"
    >
      <StorySection
        title="Asset cards"
        description="Cards flow into as many tracks as the container fits at the default 250px minimum."
      >
        <Grid as="ul" layout="auto-fill" gap="item" data-testid="auto-fill-grid" className="bakin-grid-story__cards">
          {assets.map((name) => (
            <li key={name}>
              <Card size="sm">
                <CardHeader>
                  <CardTitle>{name}</CardTitle>
                  <CardDescription>Versioned asset</CardDescription>
                </CardHeader>
              </Card>
            </li>
          ))}
        </Grid>
      </StorySection>

      <StorySection
        title="Sparse content"
        description="Two cards: empty tracks hold the layout, so the cards keep their width instead of stretching."
      >
        <Grid as="ul" layout="auto-fill" gap="item" data-testid="auto-fill-sparse" className="bakin-grid-story__cards">
          {assets.slice(0, 2).map((name) => (
            <li key={name}>
              <Card size="sm">
                <CardHeader>
                  <CardTitle>{name}</CardTitle>
                  <CardDescription>Versioned asset</CardDescription>
                </CardHeader>
              </Card>
            </li>
          ))}
        </Grid>
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas }) => {
    const grid = canvas.getByTestId('auto-fill-grid')
    await expect(grid).toHaveAttribute('data-layout', 'auto-fill')
    await expect(getComputedStyle(grid).gridTemplateColumns.split(' ').length).toBeGreaterThan(1)

    const sparse = canvas.getByTestId('auto-fill-sparse')
    // auto-fill keeps empty tracks: more resolved tracks than the two items.
    await expect(getComputedStyle(sparse).gridTemplateColumns.split(' ').length).toBeGreaterThan(2)
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth)
  },
} satisfies Story
