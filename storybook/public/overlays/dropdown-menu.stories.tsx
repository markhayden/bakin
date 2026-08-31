import type { Meta, StoryObj } from '@storybook/react-vite'
import {
  Button,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@makinbakin/sdk/ui'
import { Trash2 } from 'lucide-react'
import { expect, waitFor, within } from 'storybook/test'

import { StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Components/Overlays/DropdownMenu',
  component: DropdownMenu,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Use DropdownMenu for a compact action set. Items retain a 32-pixel minimum target, unsized icons normalize to 16 pixels, destructive labels stay concise (for example, “Delete”), shortcuts stay out of the accessible name, danger is semantic, and submenus preserve directional keyboard behavior and viewport collision.',
      },
    },
    bakinCoverage: ['desktop', 'keyboard', 'non-color'],
  },
} satisfies Meta<typeof DropdownMenu>

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  args: { defaultOpen: false },
  argTypes: {
    defaultOpen: { control: 'boolean' },
    disabled: { control: 'boolean' },
    modal: { control: 'boolean' },
    // Trigger and items are composition; the action set is not a control.
    children: { control: false },
  },
  render: (args) => (
    <DropdownMenu {...args}>
      <DropdownMenuTrigger render={<Button variant="outline" />}>Task actions</DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem>Open details</DropdownMenuItem>
        <DropdownMenuItem>Duplicate</DropdownMenuItem>
        <DropdownMenuItem variant="danger">Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole('button', { name: 'Task actions' })
    await userEvent.click(trigger)
    const page = within(document.body)
    await waitFor(() => expect(page.getByRole('menu', { name: 'Task actions' })).toBeVisible())
    await expect(page.getByRole('menuitem', { name: 'Delete' })).toBeVisible()
    await userEvent.keyboard('{ArrowDown}')
    await waitFor(() => expect(page.getByRole('menuitem', { name: 'Open details' })).toHaveFocus())
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(page.queryByRole('menu', { name: 'Task actions' })).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
  },
} satisfies Story

function TaskMenu({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return <DropdownMenu defaultOpen={defaultOpen}><DropdownMenuTrigger render={<Button variant="outline" />}>Task actions</DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuGroup><DropdownMenuLabel>Task</DropdownMenuLabel><DropdownMenuItem>Open details<DropdownMenuShortcut>↵</DropdownMenuShortcut></DropdownMenuItem><DropdownMenuItem>Duplicate<DropdownMenuShortcut>⌘D</DropdownMenuShortcut></DropdownMenuItem></DropdownMenuGroup><DropdownMenuSeparator /><DropdownMenuCheckboxItem defaultChecked>Watch updates</DropdownMenuCheckboxItem><DropdownMenuSub><DropdownMenuSubTrigger>Move to</DropdownMenuSubTrigger><DropdownMenuSubContent><DropdownMenuItem>Needs attention</DropdownMenuItem><DropdownMenuItem>Running</DropdownMenuItem><DropdownMenuItem>Blocked</DropdownMenuItem></DropdownMenuSubContent></DropdownMenuSub><DropdownMenuSeparator /><DropdownMenuItem variant="danger"><Trash2 /> Delete</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
}

export const Actions = {
  render: () => (
    <StoryStage
      eyebrow="Action set"
      title="Dropdown menu"
      description="A compact action set with groups, shortcuts, a checkbox item, a submenu, and a semantic danger action."
    >
      <StorySection title="Task actions" description="Shortcuts stay out of the accessible name; danger reads from label and semantics, never color alone.">
        <TaskMenu defaultOpen />
      </StorySection>
    </StoryStage>
  ),
} satisfies Story

export const Behavior = {
  parameters: { layout: 'centered' },
  render: () => <TaskMenu />,
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole('button', { name: 'Task actions' })
    await userEvent.click(trigger)
    const page = within(document.body)
    await waitFor(() => expect(page.getByRole('menu', { name: 'Task actions' })).toBeVisible())
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{ArrowDown}{ArrowRight}')
    await waitFor(() => expect(page.getByRole('menuitem', { name: 'Needs attention' })).toBeVisible())
    await userEvent.keyboard('{Escape}{Escape}')
    await waitFor(() => expect(trigger).toHaveFocus())
  },
} satisfies Story
