import type { Meta, StoryObj } from '@storybook/react-vite'
import { useRef, useState } from 'react'
import { expect, waitFor, within } from 'storybook/test'

import { Stack } from '@makinbakin/sdk/layout'
import { ConfirmDialog } from '@makinbakin/sdk/patterns'
import { Button } from '@makinbakin/sdk/ui'

import { StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Components/Feedback/ConfirmDialog',
  component: ConfirmDialog,
  // Canonical fixture args at meta level: render-based stories inherit the
  // required props (open/title/onConfirm/onCancel).
  args: {
    open: true,
    title: 'Delete archived workflow?',
    description: 'This permanently deletes the workflow definition and its preserved run history. Scheduled triggers will stop.',
    confirmLabel: 'Delete workflow',
    confirmValue: 'launch-publishing',
    onConfirm: () => {},
    onCancel: () => {},
  },
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'ConfirmDialog is a controlled confirmation for consequential work. The consumer owns `open`, busy, and error state plus the mutation itself; the dialog owns presentation, semantics, and focus. Reserve `confirmValue` typed confirmation for actions whose consequences cannot be recovered through the normal product flow, and pass the external trigger as `finalFocus` so a cancelled decision returns focus where it started.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'interaction', 'typed-confirmation', 'focus-return', 'busy', 'error-retry'],
  },
} satisfies Meta<typeof ConfirmDialog>

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  argTypes: {
    open: { control: 'boolean' },
    title: { control: 'text' },
    description: { control: 'text' },
    confirmLabel: { control: 'text' },
    busyLabel: { control: 'text' },
    cancelLabel: { control: 'text' },
    confirmTone: { control: 'select', options: ['danger', 'primary'] },
    cancelVariant: { control: 'select', options: ['outline', 'ghost'] },
    confirmValue: { control: 'text' },
    busy: { control: 'boolean' },
    error: { control: 'text' },
    // The consumer owns the mutation, dismissal, and focus return.
    onConfirm: { control: false },
    onCancel: { control: false },
    finalFocus: { control: false },
    children: { control: false },
  },
  play: async ({ userEvent }) => {
    const page = within(document.body)
    const dialog = await page.findByRole('dialog', { name: 'Delete archived workflow?' })
    const confirm = within(dialog).getByRole('button', { name: 'Delete workflow' })
    await expect(confirm).toBeDisabled()
    await userEvent.type(within(dialog).getByLabelText(/Type launch-publishing to confirm/), 'launch-publishing')
    await expect(confirm).toBeEnabled()
  },
} satisfies Story

function TypedConfirmationExample({ initialOpen = true }: { initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen)
  const [outcome, setOutcome] = useState('Waiting for a decision')
  const triggerRef = useRef<HTMLButtonElement>(null)

  return (
    <StoryStage
      eyebrow="Confirmation / irreversible"
      title="Require intent before destructive work"
      description="Typed confirmation is reserved for actions whose consequences cannot be recovered through the normal product flow."
    >
      <StorySection
        title="Launch publishing workflow"
        description="18 completed runs · 3 scheduled triggers · last used 12 minutes ago"
      >
        <Stack gap="dense">
          <div>
            <Button ref={triggerRef} variant="danger" onClick={() => setOpen(true)}>Delete archived workflow</Button>
          </div>
          <p role="status">{outcome}</p>
        </Stack>
      </StorySection>
      <ConfirmDialog
        open={open}
        title="Delete archived workflow?"
        description="This permanently deletes the workflow definition and its preserved run history. Scheduled triggers will stop."
        confirmLabel="Delete workflow"
        busyLabel="Deleting workflow…"
        confirmValue="launch-publishing"
        finalFocus={triggerRef}
        onConfirm={() => {
          setOutcome('Workflow deletion confirmed')
          setOpen(false)
        }}
        onCancel={() => setOpen(false)}
      />
    </StoryStage>
  )
}

export const TypedConfirmation = {
  render: () => <TypedConfirmationExample />,
  play: async ({ userEvent }) => {
    const page = within(document.body)
    const dialog = await page.findByRole('dialog', { name: 'Delete archived workflow?' })
    const confirm = within(dialog).getByRole('button', { name: 'Delete workflow' })
    await expect(confirm).toBeDisabled()
    await userEvent.type(within(dialog).getByLabelText(/Type launch-publishing to confirm/), 'launch-publishing')
    await expect(confirm).toBeEnabled()
    await userEvent.click(confirm)
    await waitFor(() => expect(page.getByRole('status')).toHaveTextContent('Workflow deletion confirmed'))
  },
} satisfies Story

export const FocusReturn = {
  render: () => <TypedConfirmationExample initialOpen={false} />,
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole('button', { name: 'Delete archived workflow' })
    await userEvent.click(trigger)
    const page = within(document.body)
    const dialog = await page.findByRole('dialog', { name: 'Delete archived workflow?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(dialog).not.toBeVisible())
    await waitFor(() => expect(trigger).toHaveFocus())
  },
} satisfies Story

export const Busy = {
  render: () => (
    <StoryStage
      eyebrow="In flight"
      title="Hold the decision while work runs"
      description="While `busy`, both actions disable, the confirm label switches to the busy copy, and dismissal is blocked until the mutation settles."
    >
      <ConfirmDialog
        open
        busy
        title="Delete archived workflow?"
        description="This permanently deletes the workflow definition and its preserved run history."
        confirmLabel="Delete workflow"
        busyLabel="Deleting workflow…"
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    </StoryStage>
  ),
  play: async () => {
    const page = within(document.body)
    const dialog = await page.findByRole('dialog', { name: 'Delete archived workflow?' })
    await expect(within(dialog).getByRole('button', { name: 'Deleting workflow…' })).toBeDisabled()
    await expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled()
  },
} satisfies Story

export const FailedConfirmation = {
  render: () => (
    <StoryStage
      eyebrow="Recovery"
      title="Keep a failed confirmation actionable"
      description="Durable error copy stays inside the dialog and the same confirm action remains available as an explicit retry."
    >
      <ConfirmDialog
        open
        title="Delete archived workflow?"
        description="This permanently deletes the workflow definition and its preserved run history."
        confirmLabel="Delete workflow"
        error="The workflow could not be deleted. The runtime rejected the request."
        onConfirm={() => {}}
        onCancel={() => {}}
      />
    </StoryStage>
  ),
  play: async () => {
    const page = within(document.body)
    const dialog = await page.findByRole('dialog', { name: 'Delete archived workflow?' })
    await expect(within(dialog).getByRole('alert')).toHaveTextContent('could not be deleted')
    await expect(within(dialog).getByRole('button', { name: 'Delete workflow' })).toBeEnabled()
  },
} satisfies Story
