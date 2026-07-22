import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Badge, BakinDrawer, BakinDrawerSection, Button, Input, Label, Textarea } from '@makinbakin/sdk/ui'
import { expect, waitFor, within } from 'storybook/test'

import './primitives.stories.css'

const meta = {
  title: 'Foundation/BakinDrawer',
  component: BakinDrawer,
  args: { open: false, onOpenChange: () => undefined, children: null },
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: { description: { component: 'BakinDrawer is the supported resizable product composition for long contextual detail and edit flows. It uses Sheet semantics, persists width by context, fills mobile viewports, provides keyboard resizing, aligns its title and content to one shared gutter, and owns the nested dirty-confirm path.' } },
  },
} satisfies Meta<typeof BakinDrawer>

export default meta
type Story = StoryObj<typeof meta>

function DrawerContents() {
  return (
    <div className="bakin-primitive-story__overlay-body bakin-primitive-story__overlay-body--flush">
      <BakinDrawerSection title="Status">
        <div className="bakin-primitive-story__cluster"><Badge tone="attention">Needs attention</Badge><Badge variant="outline">Workflow</Badge></div>
      </BakinDrawerSection>
      <BakinDrawerSection title="Details">
        <div className="bakin-primitive-story__field"><Label htmlFor="drawer-title">Task title</Label><Input id="drawer-title" defaultValue="Review plugin migration evidence" /></div>
        <div className="bakin-primitive-story__field"><Label htmlFor="drawer-context">Context</Label><Textarea id="drawer-context" defaultValue="Confirm the SDK-only imports, responsive behavior, and route-state contract before marking this task complete." /></div>
      </BakinDrawerSection>
    </div>
  )
}

export const Default = {
  render: function DefaultDrawer() {
    const [open, setOpen] = useState(true)
    return <main className="bakin-primitive-story__overlay-stage"><div className="bakin-primitive-story__overlay-workspace" aria-hidden="true"><div /><div /><div /></div><BakinDrawer open={open} onOpenChange={setOpen} title="Task detail" description="Task 842 · official workflows plugin" storageKey="storybook-default"><DrawerContents /></BakinDrawer></main>
  },
  play: async () => {
    const page = within(document.body)
    const title = await page.findByRole('heading', { name: 'Task detail' })
    const content = document.querySelector<HTMLElement>('[data-slot="bakin-drawer-content"]')
    await expect(content).toBeTruthy()
    await expect(Math.abs(title.getBoundingClientRect().left - content!.getBoundingClientRect().left)).toBeLessThan(1)
  },
} satisfies Story

export const DirtyBehavior = {
  render: function DirtyDrawer() {
    const [open, setOpen] = useState(true)
    return <main className="bakin-primitive-story__overlay-stage"><BakinDrawer open={open} onOpenChange={setOpen} title="Edit task" dirty storageKey="storybook-dirty" actions={<Button size="sm">Save</Button>}><DrawerContents /></BakinDrawer></main>
  },
  play: async ({ userEvent }) => {
    const page = within(document.body)
    await waitFor(() => expect(page.getByRole('dialog', { name: 'Edit task' })).toBeVisible())
    await waitFor(() => expect(page.getByRole('separator', { name: 'Resize panel' })).toBeVisible())
    const resizer = page.getByRole('separator', { name: 'Resize panel' })
    const initialWidth = Number(resizer.getAttribute('aria-valuenow'))
    resizer.focus()
    await userEvent.keyboard('{ArrowLeft}')
    await expect(resizer).toHaveAttribute('aria-valuenow', String(Math.min(initialWidth + 16, 960)))
    await userEvent.click(page.getByRole('button', { name: 'Close panel' }))
    await waitFor(() => expect(page.getByRole('dialog', { name: 'Unsaved changes' })).toBeVisible())
    await userEvent.click(page.getByRole('button', { name: 'Keep editing' }))
    await expect(page.getByRole('dialog', { name: 'Edit task' })).toBeVisible()
  },
} satisfies Story
