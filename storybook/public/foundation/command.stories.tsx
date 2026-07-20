import type { Meta, StoryObj } from '@storybook/react-vite'
import { useRef, useState } from 'react'
import { Button, Command, CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator, CommandShortcut } from '@makinbakin/sdk/ui'
import { expect, waitFor, within } from 'storybook/test'

import './primitives.stories.css'

const meta = {
  title: 'Foundation/Command',
  component: Command,
  tags: ['public'],
  parameters: { layout: 'fullscreen', docs: { description: { component: 'Use Command for a filterable action or entity set. Name the root with `label`, keep group headings meaningful, provide stable item values when visible copy can change, and use CommandDialog for a global palette rather than nesting Command in an unrelated modal.' } } },
} satisfies Meta<typeof Command>

export default meta
type Story = StoryObj<typeof meta>

function TaskCommands() {
  return <Command label="Find a task action"><CommandInput placeholder="Find an action…" autoFocus /><CommandList label="Task actions"><CommandEmpty>No matching actions.</CommandEmpty><CommandGroup heading="Navigate"><CommandItem value="open-task">Open task<CommandShortcut>↵</CommandShortcut></CommandItem><CommandItem value="view-agent">View assigned agent<CommandShortcut>⌘A</CommandShortcut></CommandItem></CommandGroup><CommandSeparator /><CommandGroup heading="Change state"><CommandItem value="mark-running">Mark running</CommandItem><CommandItem value="mark-blocked">Mark blocked</CommandItem></CommandGroup></CommandList></Command>
}

export const Search = {
  render: () => <main className="bakin-primitive-story__command-stage"><div className="bakin-primitive-story__command-surface"><TaskCommands /></div></main>,
} satisfies Story

export const DialogBehavior = {
  render: function CommandDialogStory() {
    const [open, setOpen] = useState(false)
    const triggerRef = useRef<HTMLButtonElement>(null)
    return <main className="bakin-primitive-story"><Button ref={triggerRef} onClick={() => setOpen(true)}>Open command palette</Button><CommandDialog open={open} onOpenChange={setOpen} title="Task command palette" description="Find an action for the current task." contentProps={{ finalFocus: triggerRef }}><TaskCommands /></CommandDialog></main>
  },
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole('button', { name: 'Open command palette' })
    await userEvent.click(trigger)
    const page = within(document.body)
    const input = await page.findByRole('combobox', { name: 'Find a task action' })
    await userEvent.type(input, 'blocked')
    await waitFor(() => expect(page.getByRole('option', { name: 'Mark blocked' })).toBeVisible())
    await userEvent.keyboard('{ArrowDown}{Enter}')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(trigger).toHaveFocus())
  },
} satisfies Story
