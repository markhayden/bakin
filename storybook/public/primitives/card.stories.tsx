import type { Meta, StoryObj } from '@storybook/react-vite'
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardMedia,
  CardTitle,
} from '@makinbakin/sdk/ui'
import { expect, fn, userEvent } from 'storybook/test'

import { StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Components/Primitives/Card',
  component: Card,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: { description: { component: 'Card is for a coherent, bounded object such as a task, agent, workflow, or grouped record. Do not wrap page sections in cards or nest bordered cards; use headings, spacing, sections, and separators for page hierarchy.' } },
    bakinCoverage: ['desktop', 'mobile-320', 'long-labels', 'overflow'],
  },
} satisfies Meta<typeof Card>

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  args: {
    'aria-labelledby': 'canonical-card-title',
    // The bounded object's content is composition; controls cover the card frame.
    children: (
      <>
        <CardHeader>
          <CardTitle id="canonical-card-title">Resolve launch blockers</CardTitle>
          <CardDescription>4 linked assets · owned by Research Ops</CardDescription>
        </CardHeader>
        <CardContent>Two approvals are waiting and one runtime check needs attention.</CardContent>
      </>
    ),
  },
  argTypes: {
    size: { control: 'select', options: ['sm', 'md'] },
    tone: { control: 'select', options: ['neutral', 'success', 'attention', 'danger', 'accent'] },
    selected: { control: 'boolean' },
    children: { control: false },
  },
  play: async ({ canvas }) => {
    const title = canvas.getByText('Resolve launch blockers')
    const card = title.closest('[data-slot="card"]')
    // The bounded object is labelled by its own title, and the title sits in the header slot.
    await expect(card).toHaveAttribute('aria-labelledby', 'canonical-card-title')
    await expect(title.closest('[data-slot="card-header"]')).not.toBeNull()
    await expect(canvas.getByText('Two approvals are waiting and one runtime check needs attention.')).toBeVisible()
  },
} satisfies Story

export const BoundedObject = {
  render: () => (
    <StoryStage
      eyebrow="Bounded object"
      title="Card"
      description="The boundary belongs to the object—not to every region on the page."
    >
      <StorySection title="Persistent task">
        <Card aria-labelledby="card-title">
          <CardHeader>
            <CardTitle id="card-title">Resolve launch blockers</CardTitle>
            <CardDescription>4 linked assets · owned by Research Ops</CardDescription>
            <CardAction><Button variant="ghost" size="sm">Open</Button></CardAction>
          </CardHeader>
          <CardContent>Two approvals are waiting and one runtime check needs attention.</CardContent>
          <CardFooter><span>Due tomorrow at 4:00 PM</span></CardFooter>
        </Card>
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas }) => {
    const card = canvas.getByText('Resolve launch blockers').closest('[data-slot="card"]')
    await expect(card).toHaveAttribute('aria-labelledby', 'card-title')
    // The header action remains a real, focusable control inside the object.
    await expect(canvas.getByRole('button', { name: 'Open' })).toBeEnabled()
  },
} satisfies Story

export const ContentStress = {
  render: () => (
    <StoryStage
      eyebrow="Content stress"
      title="Long and technical content"
      description="Bounded objects wrap long names and identifiers without creating page-level overflow."
    >
      <StorySection title="Narrow object">
        <div style={{ width: 'min(100%, 24rem)', minWidth: 0 }}>
          <Card size="sm" aria-labelledby="long-card-title">
            <CardHeader>
              <CardTitle id="long-card-title">Production publishing approval for the extraordinarily-long-cross-functional-campaign-name-that-cannot-be-shortened</CardTitle>
              <CardDescription>workflow_01JZ7A7RCM8S9P2B8H4VR4MVGQ · This description intentionally spans several lines to prove that unfamiliar content remains readable.</CardDescription>
            </CardHeader>
            <CardContent>No nested card is needed: content groups rely on prose, headings, and spacing.</CardContent>
          </Card>
        </div>
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas }) => {
    // Long unbroken identifiers wrap inside the object instead of widening the page.
    await expect(canvas.getByText(/extraordinarily-long-cross-functional-campaign-name/)).toBeVisible()
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth)
  },
} satisfies Story

const openCard = fn()
const openNested = fn()

export const InteractiveCard = {
  parameters: {
    docs: {
      description: {
        story:
          'Whole-card activation: `interactive` emits one absolutely-positioned overlay control with an accessible name and a real focus ring. Content stays visible above the overlay and lets clicks fall through to it, while nested controls keep their own behavior — never re-implement this with onClick guards or per-child stopPropagation.',
      },
    },
  },
  render: () => (
    <StoryStage
      eyebrow="Interactive"
      title="Whole-card activation"
      description="One overlay control carries the card's action; nested controls stay independent."
    >
      <StorySection title="Clickable object">
        <div style={{ width: 'min(100%, 24rem)', minWidth: 0 }}>
          <Card interactive={{ label: 'Open Spring launch', onActivate: openCard }}>
            <CardHeader>
              <CardTitle>Spring launch</CardTitle>
              <CardDescription>Campaign workspace · 4 linked assets</CardDescription>
              {/* reveal="hover": invisible on pointer devices until the card
                  is hovered or the action focused — the Card mirror of
                  ListRowActions reveal. Touch always shows it. */}
              <CardAction reveal="hover">
                <Button variant="ghost" size="sm" onClick={openNested}>
                  Pin
                </Button>
              </CardAction>
            </CardHeader>
            <CardContent>Two approvals are waiting and one runtime check needs attention.</CardContent>
          </Card>
        </div>
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas }) => {
    openCard.mockClear()
    openNested.mockClear()
    // The whole-card action is one real, focusable control with an accessible name.
    const overlay = canvas.getByRole('button', { name: 'Open Spring launch' })
    await userEvent.click(overlay)
    await expect(openCard).toHaveBeenCalledTimes(1)
    // Nested controls keep their own behavior and never trigger the card action.
    const pin = canvas.getByRole('button', { name: 'Pin' })
    await userEvent.click(pin)
    await expect(openNested).toHaveBeenCalledTimes(1)
    await expect(openCard).toHaveBeenCalledTimes(1)
    // The hover-reveal action stays keyboard-discoverable: focus reveals it.
    const action = pin.closest('[data-slot=card-action]')
    await expect(action?.getAttribute('data-reveal')).toBe('hover')
    await expect(action?.className).toContain('md:focus-within:opacity-100')
    // Keyboard path: the overlay is reachable and activates on Enter.
    overlay.focus()
    await userEvent.keyboard('{Enter}')
    await expect(openCard).toHaveBeenCalledTimes(2)
  },
} satisfies Story

export const MediaCover = {
  parameters: {
    docs: {
      description: {
        story:
          'CardMedia as the first child runs edge to edge — the Card root only pads vertically and drops the padding facing a leading or trailing media region, so covers never need pt-0 overrides.',
      },
    },
  },
  render: () => (
    <StoryStage
      eyebrow="Media"
      title="Full-bleed cover"
      description="A cover region owns the card's leading edge; identity and meta follow in the padded slots."
    >
      <StorySection title="Cover-led object">
        <div style={{ width: 'min(100%, 22rem)', minWidth: 0 }}>
          <Card aria-labelledby="media-card-title">
            <CardMedia>
              <div
                aria-hidden="true"
                style={{
                  height: '6.5rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'color-mix(in srgb, currentColor 10%, transparent)',
                  fontSize: '1.5rem',
                  fontWeight: 600,
                }}
              >
                D
              </div>
            </CardMedia>
            <CardHeader>
              <CardTitle id="media-card-title">Daybreak Studio</CardTitle>
              <CardDescription>Draft brand · 13% complete</CardDescription>
            </CardHeader>
            <CardContent>An early draft for a bright, pragmatic creative studio.</CardContent>
          </Card>
        </div>
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas }) => {
    const card = canvas.getByText('Daybreak Studio').closest('[data-slot="card"]') as HTMLElement
    const media = card.querySelector('[data-slot="card-media"]') as HTMLElement
    await expect(media).not.toBeNull()
    // Leading media removes the card's top padding, so the cover is truly full-bleed.
    await expect(getComputedStyle(card).paddingTop).toBe('0px')
    // Edge to edge inside the card's border box.
    await expect(media.getBoundingClientRect().width).toBeCloseTo(card.clientWidth, 0)
  },
} satisfies Story

export const RowMedia = {
  parameters: {
    docs: {
      description: {
        story:
          'orientation="row" places media and content side by side for reference-media objects (style guide §10: horizontal card, stable square thumbnail). The content column owns its vertical rhythm.',
      },
    },
  },
  render: () => (
    <StoryStage
      eyebrow="Orientation"
      title="Row media object"
      description="A stable square thumbnail leads; the content column pads itself."
    >
      <StorySection title="Reference media">
        <div style={{ width: 'min(100%, 28rem)', minWidth: 0 }}>
          <Card orientation="row" aria-labelledby="row-card-title">
            <CardMedia>
              <div
                aria-hidden="true"
                style={{
                  width: '5.5rem',
                  height: '100%',
                  minHeight: '5.5rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  background: 'color-mix(in srgb, currentColor 10%, transparent)',
                }}
              >
                IMG
              </div>
            </CardMedia>
            <CardContent className="flex min-w-0 flex-1 flex-col justify-center gap-bakin-1 py-bakin-3">
              <span id="row-card-title" className="font-bakin-typography-weight-semibold">
                Gourmet seasoned popcorn
              </span>
              <span className="text-bakin-text-muted">images · 3 versions</span>
            </CardContent>
          </Card>
        </div>
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas }) => {
    const card = canvas.getByText('Gourmet seasoned popcorn').closest('[data-slot="card"]') as HTMLElement
    await expect(card).toHaveAttribute('data-orientation', 'row')
    await expect(getComputedStyle(card).flexDirection).toBe('row')
    // The media pane stretches to the card's full inner height.
    const media = card.querySelector('[data-slot="card-media"]') as HTMLElement
    await expect(media.getBoundingClientRect().height).toBeCloseTo(card.clientHeight, 0)
  },
} satisfies Story

export const SelectedAndTone = {
  parameters: {
    docs: {
      description: {
        story:
          'selected is the one canonical selection treatment (never hand-roll rings); tone paints a status rail along the start edge for incident cards, run timelines, and toned choice rows.',
      },
    },
  },
  render: () => (
    <StoryStage
      eyebrow="State"
      title="Selected and toned objects"
      description="Selection and status are Card contracts, not consumer class strings."
    >
      <StorySection title="Selected">
        <Card selected aria-labelledby="selected-card-title">
          <CardHeader>
            <CardTitle id="selected-card-title">hero-shot-v3.png</CardTitle>
            <CardDescription>Selected for export</CardDescription>
          </CardHeader>
        </Card>
      </StorySection>
      <StorySection title="Tone rail">
        <Card tone="danger" aria-labelledby="toned-card-title">
          <CardHeader>
            <CardTitle id="toned-card-title">Dispatch failed</CardTitle>
            <CardDescription>Session died before the first token; recovery ladder engaged.</CardDescription>
          </CardHeader>
        </Card>
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas }) => {
    const selected = canvas.getByText('hero-shot-v3.png').closest('[data-slot="card"]') as HTMLElement
    await expect(selected).toHaveAttribute('data-selected')
    const toned = canvas.getByText('Dispatch failed').closest('[data-slot="card"]') as HTMLElement
    await expect(toned).toHaveAttribute('data-tone', 'danger')
    // The rail is painted by the card itself, not by consumer classes —
    // and it must actually paint (a missing token renders transparent).
    const rail = getComputedStyle(toned, '::before')
    await expect(rail.position).toBe('absolute')
    await expect(rail.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
  },
} satisfies Story

export const MetaFooter = {
  parameters: {
    docs: {
      description: {
        story:
          'CardFooter variant="meta" is the light bottom-docked stats strip (counts, timestamps, identity chips) — a divider and muted meta text without the default footer\'s filled band.',
      },
    },
  },
  render: () => (
    <StoryStage
      eyebrow="Footer"
      title="Meta footer"
      description="Bottom-docked meta without the filled footer band."
    >
      <StorySection title="Grid card with stats">
        <div style={{ width: 'min(100%, 24rem)', minWidth: 0 }}>
          <Card aria-labelledby="meta-card-title" className="h-full">
            <CardHeader>
              <CardTitle id="meta-card-title">Copy approval</CardTitle>
              <CardDescription>Draft copy and pause for owner approval before publishing.</CardDescription>
            </CardHeader>
            <CardFooter variant="meta">
              <span>2 steps · custom</span>
              <Badge tone="neutral" variant="solid" size="xs">
                approval-copy
              </Badge>
            </CardFooter>
          </Card>
        </div>
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas }) => {
    const footer = canvas.getByText('2 steps · custom').closest('[data-slot="card-footer"]') as HTMLElement
    await expect(footer).toHaveAttribute('data-variant', 'meta')
    // Meta footers keep the divider but drop the default filled band.
    await expect(getComputedStyle(footer).backgroundColor).toBe('rgba(0, 0, 0, 0)')
  },
} satisfies Story
