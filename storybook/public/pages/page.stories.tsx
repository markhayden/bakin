import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'

import {
  Page,
  PageAside,
  PageBody,
  PageComposer,
  PageControls,
  PageHeader,
  PageTimeline,
} from '@makinbakin/sdk/patterns'
import { Badge, Button, SystemState } from '@makinbakin/sdk/ui'

const meta = {
  title: 'Pages/Page',
  component: Page,
  args: {
    children: null,
  },
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Page is the one document-page archetype: it consolidates the former List, Detail, Settings, Dashboard, Conversation, and Workflow page roots behind three props. width chooses the full plugin canvas (default) or the bounded standard content measure; scroll="contained" bounds the page to its owning pane so named child regions such as PageTimeline own scrolling instead of the document; density="compact" carries the tighter workspace padding for graph and board surfaces. PageBody is the single busy/feedback/replacement-state content slot — a supplied state replaces only the body while page identity and navigation stay mounted — and its layout="aside" is the one primary-column-plus-rail composition (a 1.6fr/0.8fr split with a 16rem rail floor at the @3xl container breakpoint). PageControls names filter/search regions as a section landmark or switches to the ARIA toolbar contract for command rows. WorkspacePage remains the only other archetype; consumers keep domain data, URL state, and the SDK routing contract.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'overflow', 'system-states', 'scroll-ownership'],
  },
} satisfies Meta<typeof Page>

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  args: {
    width: 'full',
    scroll: 'page',
    density: 'default',
  },
  argTypes: {
    children: { control: false },
  },
  // Page children are composition, so the story wrapper keeps them fixed while
  // width/scroll/density stay honest controls. Contained scroll only means
  // anything inside a bounded pane, so the wrapper supplies one on demand.
  render: ({ children: _children, ...args }) => (
    <div style={args.scroll === 'contained' ? { height: '30rem' } : undefined}>
      <Page {...args} data-testid="canonical-page">
        <PageHeader title="Active tasks" />
        <PageBody label="Active task results">
          <ul>
            <li>Launch approval</li>
            <li>Campaign artwork review</li>
          </ul>
        </PageBody>
      </Page>
    </div>
  ),
  play: async ({ canvas, args }) => {
    const page = canvas.getByTestId('canonical-page')
    await expect(page).toHaveAttribute('data-archetype', 'page')
    await expect(page).toHaveAttribute('data-width', args.width === 'standard' ? 'content' : 'full')
    await expect(page).toHaveAttribute('data-scroll', args.scroll ?? 'page')
    await expect(page).toHaveAttribute('data-density', args.density ?? 'default')
    await expect(canvas.getByRole('heading', { name: 'Active tasks' })).toBeVisible()
    const body = page.querySelector('[data-slot="page-body"]')
    await expect(body).toBeTruthy()
    await expect(canvas.getByRole('region', { name: 'Active task results' })).toBeVisible()
  },
} satisfies Story

export const StandardWidth = {
  render: () => (
    <Page width="standard" data-testid="standard-page">
      <PageHeader
        eyebrow="Settings / providers"
        title="Provider credentials"
        description="One focused configuration document on the bounded content measure."
      />
      <PageBody label="Provider credential form">
        <p>Focused records and single-form settings read best on the standard measure.</p>
      </PageBody>
    </Page>
  ),
  play: async ({ canvas }) => {
    const page = canvas.getByTestId('standard-page')
    await expect(page).toHaveAttribute('data-width', 'content')
    const content = page.querySelector<HTMLElement>('[data-slot="page-shell-content"]')
    await expect(content).toBeTruthy()
    await expect(content!.className).toContain('max-w-3xl')
    const pageRect = page.getBoundingClientRect()
    const contentRect = content!.getBoundingClientRect()
    await expect(contentRect.width).toBeLessThanOrEqual(pageRect.width)
  },
} satisfies Story

const transcript = Array.from({ length: 24 }, (_, index) => ({
  id: `message-${index + 1}`,
  author: index % 2 === 0 ? 'Margo' : 'You',
  text:
    index % 2 === 0
      ? 'Contained pages hand scrolling to their named child regions so the composer and header stay put.'
      : 'Understood — the timeline is the only vertical scroller on this page.',
}))

export const ContainedScroll = {
  render: () => (
    <div style={{ height: '30rem' }}>
      <Page scroll="contained" data-testid="contained-page">
        <PageHeader title="Conversation with Margo" />
        <PageBody gap="content" label="Conversation">
          {/* A genuinely scrolling log must be keyboard-reachable (axe
              scrollable-region-focusable); the consumer owns that decision. */}
          <PageTimeline label="Conversation with Margo" tabIndex={0} data-testid="contained-timeline">
            {transcript.map((message) => (
              <article key={message.id}>
                <strong>{message.author}</strong>
                <p>{message.text}</p>
              </article>
            ))}
          </PageTimeline>
          <PageComposer>
            <label>
              Message
              <textarea rows={2} style={{ display: 'block', width: '100%' }} />
            </label>
          </PageComposer>
        </PageBody>
      </Page>
    </div>
  ),
  play: async ({ canvas }) => {
    const page = canvas.getByTestId('contained-page')
    await expect(page).toHaveAttribute('data-scroll', 'contained')
    await expect(getComputedStyle(page).overflow).toBe('hidden')

    const timeline = canvas.getByTestId('contained-timeline')
    await expect(getComputedStyle(timeline).overflowY).toBe('auto')
    await expect(timeline.scrollHeight).toBeGreaterThan(timeline.clientHeight)

    // Page-level overflow stays clean: the page never exceeds its owning pane
    // and the document keeps no scrollbar of its own.
    const pane = page.parentElement!
    await expect(page.getBoundingClientRect().height).toBeLessThanOrEqual(
      pane.getBoundingClientRect().height + 1,
    )
    const scroller = document.scrollingElement!
    await expect(scroller.scrollHeight).toBeLessThanOrEqual(scroller.clientHeight)

    // The composer stays outside the timeline scroller.
    const composer = page.querySelector('[data-slot="page-composer"]')
    await expect(composer).toBeTruthy()
    await expect(composer!.contains(timeline)).toBe(false)
  },
} satisfies Story

export const CompactDensity = {
  render: () => (
    <Page density="compact" data-testid="compact-page">
      <PageHeader title="Workflow editor" meta={<Badge size="xs">3 steps</Badge>} />
      <PageControls as="toolbar" label="Graph tools">
        <Button size="sm" variant="outline">Zoom to fit</Button>
        <Button size="sm" variant="outline">Auto-layout</Button>
      </PageControls>
      <PageBody gap="content" label="Workflow canvas region">
        <p>Compact density carries the tighter workspace padding for graph and board surfaces.</p>
      </PageBody>
    </Page>
  ),
  play: async ({ canvas }) => {
    const page = canvas.getByTestId('compact-page')
    await expect(page).toHaveAttribute('data-density', 'compact')
    await expect(page).toHaveAttribute('data-padding', 'compact')
    await expect(page).toHaveAttribute('data-gap', 'content')
    await expect(canvas.getByRole('toolbar', { name: 'Graph tools' })).toBeVisible()
  },
} satisfies Story

export const AsideLayout = {
  render: () => (
    <Page data-testid="aside-page">
      <PageHeader title="Launch approval" description="Coordinates the final publishing decision." />
      <PageBody layout="aside" label="Workflow detail">
        <section aria-label="Workflow definition">
          <h2>Definition</h2>
          <p>The primary column keeps the document flow while the rail carries supporting context.</p>
        </section>
        <PageAside label="Workflow context">
          <h2>Context</h2>
          <p>Owner, schedule, and recent runs.</p>
        </PageAside>
      </PageBody>
    </Page>
  ),
  play: async ({ canvas }) => {
    const page = canvas.getByTestId('aside-page')
    const body = page.querySelector('[data-slot="page-body"]')
    await expect(body).toHaveAttribute('data-layout', 'aside')
    const grid = page.querySelector('[data-slot="page-body-grid"]')
    await expect(grid).toHaveAttribute('data-layout', 'main-aside')
    await expect(grid!.querySelector('[data-slot="grid"]')).toHaveAttribute('data-layout', 'main-aside')
    await expect(canvas.getByRole('complementary', { name: 'Workflow context' })).toBeVisible()
  },
} satisfies Story

export const BodyBusyRefresh = {
  render: () => (
    <Page data-testid="busy-page">
      <PageHeader title="Active tasks" />
      <PageBody
        busy
        label="Active task results"
        feedback={<Badge tone="attention">Refreshing snapshot</Badge>}
      >
        <ul>
          <li>Launch approval</li>
        </ul>
      </PageBody>
    </Page>
  ),
  play: async ({ canvas }) => {
    const body = canvas.getByRole('region', { name: 'Active task results' })
    await expect(body).toHaveAttribute('aria-busy', 'true')
    await expect(body).toHaveAttribute('data-content-state', 'ready')
    await expect(body.querySelector('[data-slot="page-body-feedback"]')?.textContent).toContain(
      'Refreshing snapshot',
    )
    await expect(canvas.getByText('Launch approval')).toBeVisible()
  },
} satisfies Story

export const BodyReplacedState = {
  render: () => (
    <Page data-testid="state-page">
      <PageHeader title="Active tasks" />
      <PageBody
        label="Active task results"
        state={<SystemState kind="no-results" action={<Button>Clear filters</Button>} />}
      >
        <p>Stale result that must not render</p>
      </PageBody>
    </Page>
  ),
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByRole('heading', { name: 'Active tasks' })).toBeVisible()
    const body = canvas.getByRole('region', { name: 'Active task results' })
    await expect(body).toHaveAttribute('data-content-state', 'replaced')
    await expect(body.querySelector('[data-slot="page-body-state"]')).toBeTruthy()
    await expect(canvas.queryByText('Stale result that must not render')).toBeNull()
    await expect(canvasElement.querySelector('[data-slot="system-state"]')).toBeTruthy()
  },
} satisfies Story

export const ControlModes = {
  render: () => (
    <Page data-testid="controls-page">
      <PageHeader title="Tasks" />
      <PageControls label="Task filters" actions={<Button variant="ghost">Clear filters</Button>}>
        <Button variant="outline">Needs attention</Button>
        <Button variant="outline">Running</Button>
      </PageControls>
      <PageControls as="toolbar" label="Board tools" divider={false}>
        <Button size="sm" variant="outline">Group by agent</Button>
        <Button size="sm" variant="outline">Collapse done</Button>
      </PageControls>
      <PageBody label="Task results">
        <p>Section controls name a filter region; toolbar controls take the ARIA toolbar contract.</p>
      </PageBody>
    </Page>
  ),
  play: async ({ canvas }) => {
    const section = canvas.getByRole('region', { name: 'Task filters' })
    await expect(section.tagName).toBe('SECTION')
    await expect(section).toHaveAttribute('data-divider', 'false')
    await expect(section.querySelector('[data-slot="page-controls-actions"]')?.textContent).toBe(
      'Clear filters',
    )

    const toolbar = canvas.getByRole('toolbar', { name: 'Board tools' })
    await expect(toolbar.tagName).toBe('DIV')
    await expect(toolbar).toHaveAttribute('data-as', 'toolbar')
    await expect(toolbar).toHaveAttribute('data-divider', 'false')
  },
} satisfies Story
