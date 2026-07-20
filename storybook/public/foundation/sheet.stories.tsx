import type { Meta, StoryObj } from '@storybook/react-vite'
import {
  Badge,
  Button,
  Input,
  Label,
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

import './primitives.stories.css'

const meta = {
  title: 'Foundation/Sheet',
  component: Sheet,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: { description: { component: 'Use Sheet for contextual inspection or editing that benefits from page-height space. Right is the product default; left is reserved for navigation context, while top and bottom are compact transient surfaces. Mobile side sheets use the full viewport width and height.' } },
  },
} satisfies Meta<typeof Sheet>

export default meta
type Story = StoryObj<typeof meta>

function WorkspaceBackdrop() {
  return <div className="bakin-primitive-story__overlay-workspace" aria-hidden="true"><div /><div /><div /></div>
}

function TaskPanel() {
  return (
    <>
      <SheetHeader><SheetTitle>Edit task</SheetTitle><SheetDescription>Task 842 · workflow handoff</SheetDescription></SheetHeader>
      <div className="bakin-primitive-story__overlay-body">
        <div className="bakin-primitive-story__cluster"><Badge tone="attention">Needs attention</Badge><Badge variant="outline">Research</Badge></div>
        <div className="bakin-primitive-story__field"><Label htmlFor="sheet-task-title">Title</Label><Input id="sheet-task-title" defaultValue="Review routing migration evidence" /></div>
        <div className="bakin-primitive-story__field"><Label htmlFor="sheet-task-notes">Operational context</Label><Textarea id="sheet-task-notes" defaultValue="Keep the existing URL contract and verify the release artifact before closing the task." /></div>
      </div>
      <SheetFooter><Button variant="outline">Cancel</Button><Button>Save task</Button></SheetFooter>
    </>
  )
}

export const RightPanel = {
  render: () => <main className="bakin-primitive-story__overlay-stage"><WorkspaceBackdrop /><Sheet defaultOpen><SheetContent><TaskPanel /></SheetContent></Sheet></main>,
} satisfies Story

export const BottomPanel = {
  render: () => (
    <main className="bakin-primitive-story__overlay-stage">
      <WorkspaceBackdrop />
      <Sheet defaultOpen><SheetContent side="bottom"><SheetHeader><SheetTitle>Dispatch summary</SheetTitle><SheetDescription>Three agents are ready; one requires approval.</SheetDescription></SheetHeader><SheetFooter><Button variant="outline">Review later</Button><Button>Open approvals</Button></SheetFooter></SheetContent></Sheet>
    </main>
  ),
} satisfies Story

export const Behavior = {
  render: () => (
    <main className="bakin-primitive-story">
      <Sheet><SheetTrigger render={<Button />}>Open edit panel</SheetTrigger><SheetContent><TaskPanel /></SheetContent></Sheet>
    </main>
  ),
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole('button', { name: 'Open edit panel' })
    await userEvent.click(trigger)
    const page = within(document.body)
    await waitFor(() => expect(page.getByRole('dialog', { name: 'Edit task' })).toBeVisible())
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(trigger).toHaveFocus())
  },
} satisfies Story
