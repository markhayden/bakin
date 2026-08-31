import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, waitFor, within } from 'storybook/test'

import { Stack } from '@makinbakin/sdk/layout'
import {
  Button,
  Drawer,
  DrawerSection,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@makinbakin/sdk/ui'

import { StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Recipes/Form in a drawer',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'The canonical edit-in-overlay assembly: a row action opens a Drawer whose body is a small labeled form, the consumer owns open state and the staged draft, and the Drawer mirrors that state through its own contract — `dirty` arms the built-in unsaved-changes guard on every dismissal path, `busy` locks dismissal while the save is in flight, and the save action rides the header `actions` slot. Saving settles the draft, closes the drawer, and the row reflects the new value; cancelling the guard returns to the form untouched. Composes Drawer, DrawerSection, and form primitives from `@makinbakin/sdk/ui` exactly as product edit flows do — no SaveBar, because the drawer owns the dirty/busy presentation for overlay edits.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'interaction', 'dirty-confirm', 'busy', 'focus'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

interface AgentRow {
  name: string
  role: string
}

function FormInDrawerExample() {
  const [saved, setSaved] = useState<AgentRow>({ name: 'Maya', role: 'copywriter' })
  const [draft, setDraft] = useState<AgentRow>(saved)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [outcome, setOutcome] = useState('Roster up to date')
  const dirty = open && (draft.name !== saved.name || draft.role !== saved.role)

  const save = () => {
    setSaving(true)
    setTimeout(() => {
      setSaved(draft)
      setSaving(false)
      setOpen(false)
      setOutcome('Agent profile saved')
    }, 150)
  }

  return (
    <StoryStage
      eyebrow="Recipe"
      title="Form in a drawer"
      description="A row action opens a drawer-hosted form. The consumer owns the draft; the drawer mirrors dirty and busy, guards unsaved exits, and carries the save action in its header."
    >
      <StorySection
        title="Team roster"
        description="The row is the source of truth; the drawer edits a staged copy of it."
      >
        <Stack gap="dense">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--bakin-layout-space-3)' }}>
            <span>
              {saved.name} · {saved.role}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setDraft(saved)
                setOpen(true)
              }}
            >
              Edit agent
            </Button>
          </div>
          <p role="status">{outcome}</p>
        </Stack>
      </StorySection>
      <Drawer
        open={open}
        onOpenChange={setOpen}
        title="Edit agent"
        description={`${saved.name} · team roster`}
        dirty={dirty}
        busy={saving}
        storageKey="recipe-form-in-drawer"
        actions={
          <Button size="sm" busy={saving} disabled={!dirty || saving} onClick={save}>
            Save changes
          </Button>
        }
      >
        <DrawerSection title="Profile">
          <div style={{ display: 'grid', gap: 'var(--bakin-layout-space-2)' }}>
            <Label htmlFor="recipe-agent-name">Display name</Label>
            <Input
              id="recipe-agent-name"
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })}
            />
            <Label htmlFor="recipe-agent-role">Role</Label>
            <Select
              items={{ copywriter: 'Copywriter', researcher: 'Researcher', reviewer: 'Reviewer' }}
              value={draft.role}
              onValueChange={(role) => setDraft({ ...draft, role: String(role) })}
            >
              <SelectTrigger id="recipe-agent-role" style={{ width: '100%' }}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="copywriter">Copywriter</SelectItem>
                <SelectItem value="researcher">Researcher</SelectItem>
                <SelectItem value="reviewer">Reviewer</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </DrawerSection>
      </Drawer>
    </StoryStage>
  )
}

export const EditFlow = {
  render: () => <FormInDrawerExample />,
  play: async ({ canvas, userEvent }) => {
    const page = within(document.body)

    // The row action opens the drawer-hosted form.
    await userEvent.click(canvas.getByRole('button', { name: 'Edit agent' }))
    const drawer = await page.findByRole('dialog', { name: 'Edit agent' })
    await expect(within(drawer).getByRole('region', { name: 'Profile' })).toBeVisible()

    // Editing stages a draft; closing while dirty demands an explicit decision.
    const name = within(drawer).getByLabelText('Display name')
    await userEvent.clear(name)
    await userEvent.type(name, 'Maya Q')
    await userEvent.click(within(drawer).getByRole('button', { name: 'Close panel' }))
    const guard = await page.findByRole('dialog', { name: 'Unsaved changes' })
    await userEvent.click(within(guard).getByRole('button', { name: 'Keep editing' }))
    await waitFor(() => expect(guard).not.toBeVisible())
    await expect(within(page.getByRole('dialog', { name: 'Edit agent' })).getByLabelText('Display name')).toHaveValue('Maya Q')

    // Saving settles the draft, closes the drawer, and the row reflects it.
    await userEvent.click(page.getByRole('button', { name: 'Save changes' }))
    await waitFor(() => expect(page.queryByRole('dialog', { name: 'Edit agent' })).toBeNull())
    await waitFor(() => expect(canvas.getByText('Maya Q · copywriter')).toBeVisible())
    await expect(canvas.getByRole('status')).toHaveTextContent('Agent profile saved')
  },
} satisfies Story
