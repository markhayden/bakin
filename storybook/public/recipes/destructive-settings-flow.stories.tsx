import type { Meta, StoryObj } from '@storybook/react-vite'
import { useRef, useState } from 'react'
import { expect, waitFor, within } from 'storybook/test'

import { Stack } from '@makinbakin/sdk/layout'
import { DangerZone, SaveBar, UnsavedChangesDialog } from '@makinbakin/sdk/patterns'
import { Button, Input, Label } from '@makinbakin/sdk/ui'

import { StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Recipes/Destructive settings flow',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'End-to-end assembly of the destructive and dirty-state kit on one settings page: the page owns a staged draft that SaveBar mirrors, an exit attempt while dirty raises UnsavedChangesDialog with focus return, a settled save clears the bar, and the irreversible action sits last in a DangerZone whose embedded ConfirmDialog gates on exact typed confirmation. Composes ConfirmDialog, DangerZone, SaveBar, and UnsavedChangesDialog from `@makinbakin/sdk/patterns` exactly as product settings pages do — the consumer owns open, dirty, busy, and persistence state; the patterns own presentation, semantics, and focus.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'interaction', 'busy', 'typed-confirmation', 'focus-return'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

function DestructiveSettingsFlowExample() {
  const [savedName, setSavedName] = useState('Acme publishing')
  const [name, setName] = useState('Acme publishing')
  const [saving, setSaving] = useState(false)
  const [exitRequested, setExitRequested] = useState(false)
  const [outcome, setOutcome] = useState('Workspace active')
  const leaveRef = useRef<HTMLButtonElement>(null)
  const dirty = name !== savedName

  const save = () => {
    setSaving(true)
    setTimeout(() => {
      setSavedName(name)
      setSaving(false)
    }, 150)
  }

  return (
    <StoryStage
      eyebrow="Recipe"
      title="Destructive settings flow"
      description="One settings page assembles the whole kit: a staged draft with SaveBar, an explicit exit decision while dirty, and a consequence-first danger zone gated by typed confirmation."
    >
      <StorySection
        title="Workspace details"
        description="The page owns the staged value; SaveBar mirrors it and never becomes a second set of page actions."
      >
        <Stack gap="dense">
          <div style={{ display: 'grid', gap: 'var(--bakin-layout-space-2)', inlineSize: 'min(100%, 32rem)' }}>
            <Label htmlFor="recipe-workspace-name">Workspace name</Label>
            <Input id="recipe-workspace-name" value={name} onChange={(event) => setName(event.currentTarget.value)} />
          </div>
          <div>
            <Button
              ref={leaveRef}
              variant="outline"
              onClick={() => (dirty ? setExitRequested(true) : setOutcome('Left settings'))}
            >
              Leave settings
            </Button>
          </div>
          <p role="status">{outcome}</p>
        </Stack>
      </StorySection>
      <StorySection
        title="Irreversible actions"
        description="Destructive work sits after routine settings and names its consequence before offering the action."
      >
        <DangerZone
          description="Delete the Acme publishing workspace, disconnect 4 agents, and stop 3 scheduled workflows. This cannot be undone."
          confirmLabel="Delete workspace"
          confirmValue="acme-publishing"
          onConfirm={() => setOutcome('Workspace deletion confirmed')}
        />
      </StorySection>
      <SaveBar
        dirty={dirty}
        saving={saving}
        onSave={save}
        onDiscard={() => setName(savedName)}
      >
        <span>Workspace name</span>
      </SaveBar>
      <UnsavedChangesDialog
        open={exitRequested}
        finalFocus={leaveRef}
        onSave={() => {
          save()
          setExitRequested(false)
          setOutcome('Draft saved before leaving')
        }}
        onDiscard={() => {
          setName(savedName)
          setExitRequested(false)
          setOutcome('Draft discarded before leaving')
        }}
        onCancel={() => setExitRequested(false)}
      />
    </StoryStage>
  )
}

export const SettingsFlow = {
  render: () => <DestructiveSettingsFlowExample />,
  play: async ({ canvas, userEvent }) => {
    const page = within(document.body)

    // Editing the draft makes the page dirty and raises SaveBar.
    const input = canvas.getByLabelText('Workspace name')
    await userEvent.type(input, ' EU')
    const saveBar = await canvas.findByRole('region', { name: 'Unsaved changes' })
    await expect(saveBar).toHaveAttribute('data-savebar-state', 'dirty')

    // Leaving while dirty demands an explicit decision; cancel returns focus.
    const leave = canvas.getByRole('button', { name: 'Leave settings' })
    await userEvent.click(leave)
    const exitDialog = await page.findByRole('dialog', { name: 'Unsaved changes' })
    await userEvent.click(within(exitDialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(exitDialog).not.toBeVisible())
    await waitFor(() => expect(leave).toHaveFocus())

    // Saving settles the draft and clears the unsaved state.
    await userEvent.click(canvas.getByRole('button', { name: 'Save changes' }))
    await expect(canvas.getByRole('region', { name: 'Saving changes' })).toHaveAttribute('aria-busy', 'true')
    await waitFor(() => expect(canvas.getByRole('status', { name: 'Changes saved' })).toBeVisible())

    // The destructive path still demands exact typed confirmation.
    await userEvent.click(canvas.getByRole('button', { name: 'Delete workspace' }))
    const confirmDialog = await page.findByRole('dialog', { name: 'Delete workspace?' })
    const confirm = within(confirmDialog).getByTestId('danger-zone-confirm')
    await expect(confirm).toBeDisabled()
    await userEvent.type(within(confirmDialog).getByLabelText(/Type acme-publishing to confirm/), 'acme-publishing')
    await expect(confirm).toBeEnabled()
    await userEvent.click(confirm)
    await waitFor(() => expect(canvas.getByText('Workspace deletion confirmed')).toBeVisible())
  },
} satisfies Story
