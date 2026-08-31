import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Field,
  FieldLabel,
  Input,
} from '@makinbakin/sdk/ui'
import { expect, waitFor, within } from 'storybook/test'

import { OverlayBackdrop } from '../../support'

const meta = {
  title: 'Components/Overlays/Dialog',
  component: Dialog,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: { description: { component: 'Use Dialog for a short, blocking decision or bounded task. Supply a title, describe the consequence, keep actions concise, and set `busy` while an in-flight action must not be dismissed.' } },
    bakinCoverage: ['desktop', 'keyboard', 'focus-return', 'busy'],
  },
} satisfies Meta<typeof Dialog>

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  args: { defaultOpen: false, busy: false },
  argTypes: {
    defaultOpen: { control: 'boolean' },
    busy: { control: 'boolean' },
    modal: { control: 'select', options: [true, false, 'trap-focus'] },
    // Trigger and content are composition; the dialog body is not a control.
    children: { control: false },
  },
  render: (args) => (
    <Dialog {...args}>
      <DialogTrigger render={<Button variant="outline" />}>Delete connection</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete runtime connection?</DialogTitle>
          <DialogDescription>Agents using this connection will stop dispatching until another runtime is assigned.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Keep connection</DialogClose>
          <Button variant="danger">Delete connection</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Delete connection' }))
    const page = within(document.body)
    const dialog = await waitFor(() => page.getByRole('dialog', { name: 'Delete runtime connection?' }))
    await waitFor(() => {
      expect(dialog).not.toHaveAttribute('data-starting-style')
      expect(dialog).toBeVisible()
    })
    await expect(within(dialog).getByRole('button', { name: 'Keep connection' })).toBeVisible()
  },
} satisfies Story

export const Decision = {
  render: () => (
    <main className="bakin-story-stage">
      <OverlayBackdrop />
      <Dialog defaultOpen>
        <DialogContent>
          <DialogHeader><DialogTitle>Delete runtime connection?</DialogTitle><DialogDescription>Agents using this connection will stop dispatching until another runtime is assigned.</DialogDescription></DialogHeader>
          <Alert tone="attention"><AlertDescription>This affects 4 agents and 2 scheduled workflows.</AlertDescription></Alert>
          <DialogFooter><DialogClose render={<Button variant="outline" />}>Keep connection</DialogClose><Button variant="danger">Delete connection</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  ),
} satisfies Story

export const NestedBehavior = {
  parameters: { layout: 'centered' },
  render: () => (
    <Dialog>
      <DialogTrigger render={<Button />}>Open workflow settings</DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Workflow settings</DialogTitle><DialogDescription>Update the display name or open the destructive reset decision.</DialogDescription></DialogHeader>
        <Field name="workflowName"><FieldLabel>Workflow name</FieldLabel><Input defaultValue="Publish weekly review" /></Field>
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

/**
 * Salvaged from the retired `Foundation/Modal and side overlays` scene: a
 * dialog driven by external `open`/`onOpenChange` state (no `DialogTrigger`),
 * asserting focus still returns to the launching control on close.
 */
export const ControlledFocusReturn = {
  parameters: { layout: 'centered' },
  render: function ControlledDialog() {
    const [open, setOpen] = useState(false)
    return (
      <>
        <Button variant="outline" onClick={() => setOpen(true)}>Open decision dialog</Button>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Publish workflow?</DialogTitle><DialogDescription>Publishing makes this version available to every assigned agent.</DialogDescription></DialogHeader>
            <DialogFooter><DialogClose render={<Button variant="outline" />}>Cancel</DialogClose><Button>Publish workflow</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    )
  },
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole('button', { name: 'Open decision dialog' })
    await userEvent.click(trigger)
    const page = within(document.body)
    await waitFor(() => expect(page.getByRole('dialog', { name: 'Publish workflow?' })).toBeVisible())
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(page.queryByRole('dialog', { name: 'Publish workflow?' })).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
  },
} satisfies Story

export const Busy = {
  render: () => (
    <main className="bakin-story-stage">
      <OverlayBackdrop />
      <Dialog defaultOpen busy>
        <DialogContent>
          <DialogHeader><DialogTitle>Publishing workflow</DialogTitle><DialogDescription>The dialog remains labelled and visible while dismissal is blocked.</DialogDescription></DialogHeader>
          <Alert tone="neutral"><AlertDescription>Validating 12 workflow steps…</AlertDescription></Alert>
          <DialogFooter><DialogClose render={<Button variant="outline" />}>Cancel</DialogClose><Button disabled>Publishing…</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  ),
} satisfies Story
