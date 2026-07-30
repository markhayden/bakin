import type { Meta, StoryObj } from '@storybook/react-vite'
import {
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@makinbakin/sdk/ui'
import { expect } from 'storybook/test'

import { StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Primitives/Card',
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
  render: () => (
    <Card aria-labelledby="canonical-card-title">
      <CardHeader>
        <CardTitle id="canonical-card-title">Resolve launch blockers</CardTitle>
        <CardDescription>4 linked assets · owned by Research Ops</CardDescription>
      </CardHeader>
      <CardContent>Two approvals are waiting and one runtime check needs attention.</CardContent>
    </Card>
  ),
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
