import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'

import {
  PageHeader,
  WorkspacePage,
  WorkspacePageBody,
  WorkspacePageCompactHeader,
  WorkspacePageHeader,
} from '@makinbakin/sdk/patterns'
import { Badge, Button, DropdownMenuItem } from '@makinbakin/sdk/ui'

import './workspace-page.stories.css'

const meta = {
  title: 'Pages/WorkspacePage',
  component: WorkspacePage,
  args: {
    children: null,
  },
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'WorkspacePage is the full-bleed application-workspace archetype. WorkspacePageHeader preserves the canonical responsive page insets around identity, controls, and actions. WorkspacePageBody then owns the complete remaining width and height without an outer frame or inherited page padding. Immersive mode lets the full mobile identity scroll away while WorkspacePageCompactHeader keeps navigation, one-line context, the sole mobile primary action, and overflow available above the remaining-height canvas; the full header action row returns at desktop widths. On mobile, the host places Live Activity in the main navigation; the workspace body preserves only the device safe area. Use it for persistent interaction surfaces such as conversations, graph editors, and canvases—not ordinary list, detail, settings, or dashboard pages.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'overflow', 'interaction', 'scroll-ownership'],
  },
} satisfies Meta<typeof WorkspacePage>

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  render: () => (
    <WorkspacePage data-testid="canonical-workspace-page">
      <WorkspacePageHeader>
        <PageHeader title="Conversation workspace" />
      </WorkspacePageHeader>
      <WorkspacePageBody>
        <section aria-label="Workspace canvas">Workspace canvas</section>
      </WorkspacePageBody>
    </WorkspacePage>
  ),
  play: async ({ canvas }) => {
    const page = canvas.getByTestId('canonical-workspace-page')
    await expect(page).toHaveAttribute('data-archetype', 'workspace')
    await expect(page.querySelector('[data-slot="workspace-page-header"]')).toBeTruthy()
    await expect(page.querySelector('[data-slot="workspace-page-body"]')).toBeTruthy()
    await expect(canvas.getByRole('heading', { name: 'Conversation workspace' })).toBeVisible()
    await expect(canvas.getByRole('region', { name: 'Workspace canvas' })).toBeVisible()
  },
} satisfies Story

const conversations = [
  ['Launch plan decisions', 'Margo', '1h'],
  ['Campaign image direction', 'Pixel', '4h'],
  ['Competitor research synthesis', 'Jessica', '8h'],
]

export const FullBleedWorkspace = {
  render: () => (
    <WorkspacePage className="bakin-workspace-story" data-testid="workspace-page">
      <WorkspacePageHeader>
        <PageHeader
          title="Conversation workspace"
          description="The header keeps the normal page rhythm while the persistent workspace below reaches every available edge."
          meta={<Badge size="xs" variant="outline">3 shown</Badge>}
          actions={<Button>Start a chat</Button>}
        />
      </WorkspacePageHeader>
      <WorkspacePageBody className="bakin-workspace-story__body">
        <aside className="bakin-workspace-story__rail" aria-label="Conversation list">
          <strong>Recent</strong>
          {conversations.map(([title, agent, time]) => (
            <button type="button" key={title}>
              <span>
                <strong>{title}</strong>
                <small>{agent}</small>
              </span>
              <small>{time}</small>
            </button>
          ))}
        </aside>
        <section className="bakin-workspace-story__canvas" aria-labelledby="workspace-canvas-title">
          <div>
            <Badge tone="success">Connected</Badge>
            <h2 id="workspace-canvas-title">Launch plan decisions</h2>
            <p>
              The rail and canvas own their internal spacing and scrolling. The page does
              not add another frame or gutter around this work area.
            </p>
          </div>
        </section>
      </WorkspacePageBody>
    </WorkspacePage>
  ),
  play: async ({ canvas }) => {
    const page = canvas.getByTestId('workspace-page')
    const header = page.querySelector<HTMLElement>('[data-slot="workspace-page-header"]')
    const headerContent = page.querySelector<HTMLElement>('[data-slot="workspace-page-header"] [data-slot="page-header"]')
    const body = page.querySelector<HTMLElement>('[data-slot="workspace-page-body"]')

    await expect(header).toBeTruthy()
    await expect(headerContent).toBeTruthy()
    await expect(body).toBeTruthy()
    const pageRect = page.getBoundingClientRect()
    const headerContentRect = headerContent!.getBoundingClientRect()
    const bodyRect = body!.getBoundingClientRect()
    await expect(headerContentRect.left).toBeGreaterThan(pageRect.left)
    await expect(bodyRect.left).toBe(pageRect.left)
    await expect(bodyRect.right).toBe(pageRect.right)
    await expect(body!.className).toContain('env(safe-area-inset-bottom)')
  },
} satisfies Story

export const ImmersiveCanvas = {
  render: () => (
    <WorkspacePage
      mode="immersive"
      className="bakin-workspace-story"
      data-testid="immersive-workspace"
    >
      <WorkspacePageHeader>
        <PageHeader
          navigation={<Button size="sm" variant="ghost">← Workflows</Button>}
          eyebrow="Workflows / detail"
          title="Image generation"
          description="Build a provider-neutral prompt packet, gather approval, and save the generated result as a managed asset."
          meta={<Badge size="xs">3 steps</Badge>}
          actions={<Button>Edit</Button>}
          overflowActions={<DropdownMenuItem>Delete</DropdownMenuItem>}
        />
      </WorkspacePageHeader>
      <WorkspacePageCompactHeader
        navigation={<Button aria-label="Back to workflows" size="icon-sm" variant="ghost">←</Button>}
        title="Image generation"
        action={<Button size="sm">Edit</Button>}
        overflowActions={<DropdownMenuItem>Delete</DropdownMenuItem>}
      />
      <WorkspacePageBody className="bakin-workspace-story__immersive-body">
        <div className="bakin-workspace-story__flow-node">
          <Badge tone="primary">Start</Badge>
          <strong>Prepare the prompt packet</strong>
          <span>The canvas owns the remaining viewport after the compact row.</span>
        </div>
      </WorkspacePageBody>
    </WorkspacePage>
  ),
  play: async ({ canvas }) => {
    const page = canvas.getByTestId('immersive-workspace')
    const compact = page.querySelector<HTMLElement>(
      '[data-slot="workspace-page-compact-header"]',
    )
    const header = page.querySelector<HTMLElement>(
      '[data-slot="workspace-page-header"]',
    )
    const body = page.querySelector<HTMLElement>('[data-slot="workspace-page-body"]')

    await expect(page.dataset.mode).toBe('immersive')
    await expect(compact).toBeTruthy()
    await expect(header).toBeTruthy()
    await expect(
      header!.compareDocumentPosition(compact!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    await expect(compact!.className).toContain('sticky')
    await expect(header!.className).toContain(
      '[&_[data-slot=page-header-trailing]]:hidden',
    )
    await expect(header!.className).toContain(
      '@md/page-shell:[&_[data-slot=page-header-trailing]]:flex',
    )
    await expect(body!.className).toContain(
      'h-[calc(100%-var(--bakin-workspace-compact-header-height))]',
    )
  },
} satisfies Story
