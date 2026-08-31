import type { Meta, StoryObj } from '@storybook/react-vite'
import {
  Badge,
  Button,
  Field,
  FieldControl,
  FieldLabel,
  Input,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  Textarea,
} from '@makinbakin/sdk/ui'
import { expect, waitFor, within } from 'storybook/test'

import { OverlayBackdrop, StoryCluster } from '../../support'

const meta = {
  title: 'Components/Overlays/Sheet',
  component: Sheet,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: { description: { component: 'Use Sheet for contextual inspection or editing that benefits from page-height space. Right is the product default; left is reserved for navigation context, while top and bottom are compact transient surfaces. Mobile side sheets use the full viewport width and height.' } },
    bakinCoverage: ['desktop', 'keyboard', 'focus-return', 'side-variants'],
  },
} satisfies Meta<typeof Sheet>

export default meta
type Story = StoryObj<typeof meta>

const sheetBodyStyle = {
  display: 'grid',
  gap: 'var(--bakin-layout-gap-item)',
  padding: '0 var(--bakin-layout-space-6) var(--bakin-layout-space-6)',
  overflowY: 'auto',
} as const

function TaskPanel() {
  return (
    <>
      <SheetHeader><SheetTitle>Edit task</SheetTitle><SheetDescription>Task 842 · workflow handoff</SheetDescription></SheetHeader>
      <div style={sheetBodyStyle}>
        <StoryCluster><Badge tone="attention">Needs attention</Badge><Badge variant="outline">Research</Badge></StoryCluster>
        <Field name="taskTitle"><FieldLabel>Title</FieldLabel><Input defaultValue="Review routing migration evidence" /></Field>
        <Field name="taskNotes"><FieldLabel>Operational context</FieldLabel><FieldControl render={<Textarea defaultValue="Keep the existing URL contract and verify the release artifact before closing the task." />} /></Field>
      </div>
      <SheetFooter><Button variant="outline">Cancel</Button><Button>Save task</Button></SheetFooter>
    </>
  )
}

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  render: () => (
    <Sheet>
      <SheetTrigger render={<Button variant="outline" />}>Open task panel</SheetTrigger>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Edit task</SheetTitle>
          <SheetDescription>Task 842 · workflow handoff</SheetDescription>
        </SheetHeader>
        <SheetFooter>
          <Button variant="outline">Cancel</Button>
          <Button>Save task</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Open task panel' }))
    const page = within(document.body)
    const panel = await waitFor(() => page.getByRole('dialog', { name: 'Edit task' }))
    await waitFor(() => {
      expect(panel).not.toHaveAttribute('data-starting-style')
      expect(panel).toBeVisible()
    })
    await expect(panel).toHaveAttribute('data-side', 'right')
  },
} satisfies Story

export const RightPanel = {
  render: () => (
    <main className="bakin-story-stage">
      <OverlayBackdrop />
      <Sheet defaultOpen><SheetContent><TaskPanel /></SheetContent></Sheet>
    </main>
  ),
  play: async () => {
    // findBy: the portaled sheet mounts a tick after render in the iframe.
    const panel = await within(document.body).findByRole('dialog', { name: 'Edit task' })
    await waitFor(() => {
      expect(panel).not.toHaveAttribute('data-starting-style')
      expect(panel).toBeVisible()
    })
    await expect(panel).toHaveAttribute('data-side', 'right')
  },
} satisfies Story

export const BottomPanel = {
  render: () => (
    <main className="bakin-story-stage">
      <OverlayBackdrop />
      <Sheet defaultOpen>
        <SheetContent side="bottom">
          <SheetHeader><SheetTitle>Dispatch summary</SheetTitle><SheetDescription>Three agents are ready; one requires approval.</SheetDescription></SheetHeader>
          <SheetFooter><Button variant="outline">Review later</Button><Button>Open approvals</Button></SheetFooter>
        </SheetContent>
      </Sheet>
    </main>
  ),
  play: async () => {
    const panel = await within(document.body).findByRole('dialog', { name: 'Dispatch summary' })
    await waitFor(() => {
      expect(panel).not.toHaveAttribute('data-starting-style')
      expect(panel).toBeVisible()
    })
    await expect(panel).toHaveAttribute('data-side', 'bottom')
  },
} satisfies Story

export const Behavior = {
  parameters: { layout: 'centered' },
  render: () => (
    <Sheet><SheetTrigger render={<Button />}>Open edit panel</SheetTrigger><SheetContent><TaskPanel /></SheetContent></Sheet>
  ),
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole('button', { name: 'Open edit panel' })
    await userEvent.click(trigger)
    const page = within(document.body)
    await waitFor(() => expect(page.getByRole('dialog', { name: 'Edit task' })).toBeVisible())
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(page.queryByRole('dialog', { name: 'Edit task' })).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
  },
} satisfies Story
