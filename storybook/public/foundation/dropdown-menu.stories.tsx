import type { Meta, StoryObj } from '@storybook/react-vite'
import { Button, DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from '@makinbakin/sdk/ui'
import { Trash2 } from 'lucide-react'
import { expect, waitFor, within } from 'storybook/test'

import './primitives.stories.css'

const meta = {
  title: 'Foundation/DropdownMenu',
  component: DropdownMenu,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Use DropdownMenu for a compact action set. Items retain a 32-pixel minimum target, unsized icons normalize to 16 pixels, destructive labels stay concise (for example, “Delete”), shortcuts stay out of the accessible name, danger is semantic, and submenus preserve directional keyboard behavior and viewport collision.',
      },
    },
  },
} satisfies Meta<typeof DropdownMenu>

export default meta
type Story = StoryObj<typeof meta>

function TaskMenu({ defaultOpen = false }: { defaultOpen?: boolean }) {
  return <DropdownMenu defaultOpen={defaultOpen}><DropdownMenuTrigger render={<Button variant="outline" />}>Task actions</DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuGroup><DropdownMenuLabel>Task</DropdownMenuLabel><DropdownMenuItem>Open details<DropdownMenuShortcut>↵</DropdownMenuShortcut></DropdownMenuItem><DropdownMenuItem>Duplicate<DropdownMenuShortcut>⌘D</DropdownMenuShortcut></DropdownMenuItem></DropdownMenuGroup><DropdownMenuSeparator /><DropdownMenuCheckboxItem defaultChecked>Watch updates</DropdownMenuCheckboxItem><DropdownMenuSub><DropdownMenuSubTrigger>Move to</DropdownMenuSubTrigger><DropdownMenuSubContent><DropdownMenuItem>Needs attention</DropdownMenuItem><DropdownMenuItem>Running</DropdownMenuItem><DropdownMenuItem>Blocked</DropdownMenuItem></DropdownMenuSubContent></DropdownMenuSub><DropdownMenuSeparator /><DropdownMenuItem variant="danger"><Trash2 /> Delete</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
}

export const Actions = {
  render: () => <main className="bakin-primitive-story__anchor-stage bakin-primitive-story__anchor-stage--end"><TaskMenu defaultOpen /></main>,
} satisfies Story

export const Behavior = {
  render: () => <main className="bakin-primitive-story"><TaskMenu /></main>,
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
