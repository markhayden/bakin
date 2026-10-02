import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'
import { TerminalInputFixture } from '../../support/terminal-input-fixture'

const meta = {
  title: 'Recipes/TerminalInput',
  component: TerminalInputFixture,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    bakinCoverage: ['desktop', 'mobile-320', 'overflow', 'interaction', 'scroll-ownership'],
    docs: { description: { component: 'Compose large Button targets in centered, wrapping Inline groups, with persistent compact keys and an optional bounded Panel above. Use WorkspacePage viewport="visual" and WorkspacePageBody inputAccessory to reserve their space above a software keyboard. Preserve editor focus on pointer activation with onMouseDown preventDefault; send once on click. Keep normal keyboard and assistive activation. The consumer owns availability, semantic key mapping and one-shot modifier reset on input, blur, disconnection or session change. Show the strip on narrow or coarse-pointer devices; hide it on wide pointer-only desktops.' } },
  },
} satisfies Meta<typeof TerminalInputFixture>
export default meta
type Story = StoryObj<typeof meta>

export const CompactAndExpanded = {
  play: async ({ canvas, canvasElement, userEvent }) => {
    const editor = canvas.getByRole('textbox', { name: 'Example input' })
    await userEvent.click(editor)
    await userEvent.click(canvas.getByRole('button', { name: 'Tab' }))
    await expect(editor).toHaveFocus()
    await expect(canvas.getByRole('status')).toHaveTextContent('Tab')
    await userEvent.click(canvas.getByRole('button', { name: 'Ctrl' }))
    await expect(canvas.getByRole('button', { name: 'Ctrl' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(canvas.getByRole('button', { name: 'More' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Ctrl+C' }))
    await expect(canvas.getByRole('status')).toHaveTextContent('Ctrl+C')
    await expect(canvas.getByRole('button', { name: 'Ctrl' })).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(canvas.getByRole('button', { name: 'More' }))
    canvasElement.setAttribute('data-story-ready', 'true')
  },
} satisfies Story
