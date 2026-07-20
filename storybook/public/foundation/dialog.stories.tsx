import type { Meta, StoryObj } from '@storybook/react-vite'
import {
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Input,
  Label,
} from '@makinbakin/sdk/ui'
import { expect, waitFor, within } from 'storybook/test'

import './primitives.stories.css'

const meta = {
  title: 'Foundation/Dialog',
  component: Dialog,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: { description: { component: 'Use Dialog for a short, blocking decision or bounded task. Supply a title, describe the consequence, keep actions concise, and set `busy` while an in-flight action must not be dismissed.' } },
  },
} satisfies Meta<typeof Dialog>

export default meta
type Story = StoryObj<typeof meta>

function WorkspaceBackdrop() {
  return <div className="bakin-primitive-story__overlay-workspace" aria-hidden="true"><div /><div /><div /></div>
}

export const Decision = {
  render: () => (
    <main className="bakin-primitive-story__overlay-stage">
      <WorkspaceBackdrop />
      <Dialog defaultOpen>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete runtime connection?</DialogTitle><DialogDescription>Agents using this connection will stop dispatching until another runtime is assigned.</DialogDescription></DialogHeader>
          <div className="bakin-primitive-story__overlay-callout">This affects 4 agents and 2 scheduled workflows.</div>
          <DialogFooter><DialogClose render={<Button variant="outline" />}>Keep connection</DialogClose><Button variant="danger">Delete connection</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  ),
} satisfies Story

export const NestedBehavior = {
  render: () => (
    <main className="bakin-primitive-story">
      <Dialog>
        <DialogTrigger render={<Button />}>Open workflow settings</DialogTrigger>
        <DialogContent>
          <DialogHeader><DialogTitle>Workflow settings</DialogTitle><DialogDescription>Update the display name or open the destructive reset decision.</DialogDescription></DialogHeader>
          <div className="bakin-primitive-story__field"><Label htmlFor="dialog-workflow-name">Workflow name</Label><Input id="dialog-workflow-name" defaultValue="Publish weekly review" /></div>
          <Dialog>
            <DialogTrigger render={<Button variant="danger" />}>Reset workflow</DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Reset this workflow?</DialogTitle><DialogDescription>Every unsaved step change will be removed.</DialogDescription></DialogHeader>
              <DialogFooter><DialogClose render={<Button variant="outline" />}>Keep editing</DialogClose><Button variant="danger">Reset workflow</Button></DialogFooter>
            </DialogContent>
          </Dialog>
          <DialogFooter><DialogClose render={<Button variant="outline" />}>Cancel</DialogClose><Button>Save settings</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  ),
  play: async ({ canvas, canvasElement, userEvent }) => {
    if (new URLSearchParams(window.location.search).get('bakin-browser-fixture') === '1') {
      canvasElement.dataset.storyReady = 'true'
      return
    }
    const outerTrigger = canvas.getByRole('button', { name: 'Open workflow settings' })
    await userEvent.click(outerTrigger)
    const page = within(document.body)
    await waitFor(() => expect(page.getByRole('dialog', { name: 'Workflow settings' })).toBeVisible())
    const nestedTrigger = page.getByRole('button', { name: 'Reset workflow' })
    await userEvent.click(nestedTrigger)
    await waitFor(() => expect(page.getByRole('dialog', { name: 'Reset this workflow?' })).toBeVisible())
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(nestedTrigger).toHaveFocus())
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(outerTrigger).toHaveFocus())
    canvasElement.dataset.storyReady = 'true'
  },
} satisfies Story

export const Busy = {
  render: () => (
    <main className="bakin-primitive-story__overlay-stage">
      <WorkspaceBackdrop />
      <Dialog defaultOpen busy>
        <DialogContent>
          <DialogHeader><DialogTitle>Publishing workflow</DialogTitle><DialogDescription>The dialog remains labelled and visible while dismissal is blocked.</DialogDescription></DialogHeader>
          <div role="status" className="bakin-primitive-story__overlay-callout">Validating 12 workflow steps…</div>
          <DialogFooter><DialogClose render={<Button variant="outline" />}>Cancel</DialogClose><Button disabled>Publishing…</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  ),
} satisfies Story
