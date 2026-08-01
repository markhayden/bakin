import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { MarkdownContent } from '@makinbakin/sdk/content'
import { Badge, Button, Drawer, DrawerSection, Input, Label, Textarea } from '@makinbakin/sdk/ui'
import { expect, waitFor, within } from 'storybook/test'

import '../foundation/primitives.stories.css'

const meta = {
  title: 'Overlays/Drawer',
  component: Drawer,
  args: { open: false, onOpenChange: () => undefined, children: null },
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: { description: { component: 'Drawer is the supported resizable product composition for long contextual detail and edit flows. It uses Sheet semantics, persists width by context, fills mobile viewports, provides keyboard resizing, aligns its title and content to one shared gutter, and owns the nested dirty-confirm path.' } },
    bakinCoverage: ['desktop', 'keyboard', 'resize', 'dirty-confirm'],
  },
} satisfies Meta<typeof Drawer>

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  render: function CanonicalDrawer() {
    const [open, setOpen] = useState(true)
    return (
      <Drawer open={open} onOpenChange={setOpen} title="Task detail" description="Task 842 · official workflows plugin">
        <DrawerSection title="Details">
          <p>Review the migration evidence before closing the task.</p>
        </DrawerSection>
      </Drawer>
    )
  },
  play: async () => {
    const page = within(document.body)
    const dialog = await page.findByRole('dialog', { name: 'Task detail' })
    await expect(dialog).toBeVisible()
    await expect(within(dialog).getByRole('region', { name: 'Details' })).toBeVisible()
  },
} satisfies Story

function DrawerContents() {
  return (
    <div className="bakin-primitive-story__overlay-body bakin-primitive-story__overlay-body--flush bakin-primitive-story__overlay-body--sections">
      <DrawerSection title="Status">
        <div className="bakin-primitive-story__cluster"><Badge tone="attention">Needs attention</Badge><Badge variant="outline">Workflow</Badge></div>
      </DrawerSection>
      <DrawerSection title="Details">
        <div className="bakin-primitive-story__field"><Label htmlFor="drawer-title">Task title</Label><Input id="drawer-title" defaultValue="Review plugin migration evidence" /></div>
        <div className="bakin-primitive-story__field"><Label htmlFor="drawer-context">Context</Label><Textarea id="drawer-context" defaultValue="Confirm the SDK-only imports, responsive behavior, and route-state contract before marking this task complete." /></div>
      </DrawerSection>
      <DrawerSection title="Content">
        <MarkdownContent content={'# Migration evidence\n\nUse rendered content without adding another outer section margin.'} />
      </DrawerSection>
    </div>
  )
}

export const Default = {
  render: function DefaultDrawer() {
    const [open, setOpen] = useState(true)
    return <main className="bakin-primitive-story__overlay-stage"><div className="bakin-primitive-story__overlay-workspace" aria-hidden="true"><div /><div /><div /></div><Drawer open={open} onOpenChange={setOpen} title="Task detail" description="Task 842 · official workflows plugin" storageKey="storybook-default"><DrawerContents /></Drawer></main>
  },
  play: async () => {
    const page = within(document.body)
    const title = await page.findByRole('heading', { name: 'Task detail' })
    const content = document.querySelector<HTMLElement>('[data-slot="drawer-content"]')
    const dialog = page.getByRole('dialog', { name: 'Task detail' })
    const drawer = within(dialog)
    await expect(content).toBeTruthy()
    await expect(Math.abs(title.getBoundingClientRect().left - content!.getBoundingClientRect().left)).toBeLessThan(1)
    await expect(drawer.getAllByRole('region')).toHaveLength(3)
    await expect(drawer.getByRole('heading', { name: 'Migration evidence' })).toBeVisible()
    const firstMarkdownBlock = dialog.querySelector<HTMLElement>('[data-markdown-content] > :first-child')
    await expect(firstMarkdownBlock).toBeTruthy()
    await expect(getComputedStyle(firstMarkdownBlock!).marginTop).toBe('0px')
  },
} satisfies Story

export const DirtyBehavior = {
  render: function DirtyDrawer() {
    const [open, setOpen] = useState(true)
    return <main className="bakin-primitive-story__overlay-stage"><Drawer open={open} onOpenChange={setOpen} title="Edit task" dirty storageKey="storybook-dirty" actions={<Button size="sm">Save</Button>}><DrawerContents /></Drawer></main>
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
