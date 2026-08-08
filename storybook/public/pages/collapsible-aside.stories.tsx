import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'

import {
  ListRow,
  ListRowGroup,
  ListRows,
  PageAside,
  useCollapsedAside,
} from '@makinbakin/sdk/patterns'
import { Button } from '@makinbakin/sdk/ui'

const meta = {
  title: 'Pages/Collapsible aside',
  component: PageAside,
  tags: ['public'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'PageAside with `collapsible` is the one collapsible-rail treatment: a full-height edge column (session lists, app navigation) that collapses to the kit strip. `strip` mode replaces content with the kit expand affordance; `content` mode keeps children mounted at the collapsed width for icon-mode navs. Pair with `useCollapsedAside` for persisted state — never hand-roll a strip or rail widths.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'keyboard', 'non-color', 'reduced-motion', 'collapsed', 'landmark'],
  },
} satisfies Meta<typeof PageAside>

export default meta
type Story = StoryObj<typeof meta>

const rows = (
  <div className="min-h-0 flex-1 overflow-y-auto p-bakin-2">
    <ListRowGroup label="Today">
      <ListRows variant="plain" size="sm">
        {['Release readiness', 'Brand refresh', 'Weekly digest'].map((title) => (
          <ListRow key={title} interactive={{ label: `Open ${title}`, onActivate: () => {} }}>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-bakin-typography-size-body">{title}</span>
              <span className="block truncate text-bakin-typography-size-meta text-bakin-text-muted">main · 2h ago</span>
            </span>
          </ListRow>
        ))}
      </ListRows>
    </ListRowGroup>
  </div>
)

export const CanonicalUsage = {
  args: { label: 'Session list' },
  render: () => (
    <PageAside
      label="Session list"
      width="session"
      style={{ blockSize: '20rem' }}
      collapsible={{ collapsed: false, onCollapsedChange: () => {} }}
    >
      {rows}
    </PageAside>
  ),
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByRole('complementary', { name: 'Session list' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Open Release readiness' })).toBeVisible()
    const aside = canvasElement.querySelector('[data-slot=page-aside]')
    await expect(aside?.getAttribute('data-rail')).toBe('')
    await expect(aside?.hasAttribute('data-collapsed')).toBe(false)
  },
} satisfies Story

/** Interactive round-trip on the kit strip, state via the persisted hook. */
function CollapsibleSessionRail() {
  const [collapsed, setCollapsed] = useCollapsedAside('storybook-collapsible-aside')
  return (
    <div className="flex" style={{ blockSize: '20rem', inlineSize: '24rem' }}>
      <PageAside
        label="Session list"
        width="session"
        collapsible={{ collapsed, onCollapsedChange: setCollapsed, expandLabel: 'Expand session list' }}
      >
        <div className="flex items-center justify-end p-bakin-2">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Collapse session list"
            aria-expanded
            onClick={() => setCollapsed(true)}
            className="text-bakin-text-muted"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-bakin-4 fill-none stroke-current stroke-2">
              <rect x="3" y="4" width="18" height="16" rx="2" />
              <path d="M9 4v16" strokeLinecap="round" />
              <path d="m17 9-3 3 3 3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Button>
        </div>
        {rows}
      </PageAside>
      <div className="flex-1 p-bakin-4 text-bakin-typography-size-meta text-bakin-text-muted">Content reflows with the rail.</div>
    </div>
  )
}

export const CollapseRoundtrip = {
  args: { label: 'Session list' },
  render: () => <CollapsibleSessionRail />,
  play: async ({ canvas, canvasElement, userEvent }) => {
    // Collapse from the consumer-placed toggle…
    await userEvent.click(canvas.getByRole('button', { name: 'Collapse session list' }))
    const aside = canvasElement.querySelector('[data-slot=page-aside]')
    await expect(aside?.hasAttribute('data-collapsed')).toBe(true)
    // …the kit strip takes over with the one expand affordance…
    const expand = canvas.getByRole('button', { name: 'Expand session list' })
    await expect(expand).toHaveAttribute('aria-expanded', 'false')
    // …and expanding restores the content.
    await userEvent.click(expand)
    await expect(canvas.getByRole('button', { name: 'Open Release readiness' })).toBeVisible()
  },
} satisfies Story

export const ContentModeNav = {
  args: { label: 'App sidebar' },
  render: () => (
    <PageAside
      label="App sidebar"
      width="nav"
      style={{ blockSize: '20rem' }}
      collapsible={{ collapsed: true, onCollapsedChange: () => {}, collapsedMode: 'content' }}
    >
      {/* Icon-mode content stays mounted at the collapsed width — the
          consumer owns its collapsed rendering (app navigation). */}
      <div className="flex flex-col items-center gap-bakin-1 py-bakin-2">
        {['Dashboard', 'Tasks', 'Chat'].map((label) => (
          <Button key={label} type="button" variant="ghost" size="icon-sm" aria-label={label} className="text-bakin-text-muted">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-bakin-4 fill-none stroke-current stroke-2">
              <rect x="4" y="4" width="16" height="16" rx="3" />
            </svg>
          </Button>
        ))}
      </div>
    </PageAside>
  ),
  play: async ({ canvas, canvasElement }) => {
    const aside = canvasElement.querySelector('[data-slot=page-aside]')
    await expect(aside?.hasAttribute('data-collapsed')).toBe(true)
    // Content mode: children render at the collapsed width — no kit strip.
    await expect(canvasElement.querySelector('[data-slot=page-aside-strip]')).toBeNull()
    await expect(canvas.getByRole('button', { name: 'Tasks' })).toBeVisible()
  },
} satisfies Story
