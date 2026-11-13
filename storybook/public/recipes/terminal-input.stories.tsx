import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, fireEvent, waitFor } from 'storybook/test'
import { TerminalInputFixture } from '../../support/terminal-input-fixture'

const meta = {
  title: 'Recipes/TerminalInput',
  component: TerminalInputFixture,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    bakinCoverage: ['desktop', 'mobile-320', 'overflow', 'interaction', 'scroll-ownership'],
    docs: { description: { component: 'One row of square `icon-lg` Button keys (44px; six fit 320px) while the user is typing: Esc, Tab, the Control and Option modifiers, then More keys and Hide keyboard at the end; Hide keyboard stays enabled even while sending is disabled. A modifier is off, on for the next key, or locked; its spoken name says which, and a lock is also shown by shape. More keys opens a bounded, scrollable Panel in the same input accessory (the keyboard goes down) with labelled groups: keys, Control shortcuts with plain-language labels, and lock toggles; abc returns to the keyboard and keyboard users get focus moved into it. While it is open the sheet owns Escape wherever focus is: it closes the sheet and never reaches the editor, except inside an open dialog (it belongs to the dialog), inside a composition, or when another owner already claimed it. The next key delivered to the editor takes an armed modifier; committed text (IME, dictation) is sent as typed and ends a one-shot one, not a composition still in progress or cancelled. Use WorkspacePage viewport="visual" and WorkspacePageBody inputAccessory to keep the row above a software keyboard. Preserve editor focus on pointer activation with onMouseDown preventDefault; send once on click; keep normal keyboard and assistive activation. The consumer owns key encoding, availability and modifier reset on disconnection or session change; a plugin may restyle the keys as keycaps with scoped CSS on kit tokens. Show the row on coarse-pointer devices; hide it on fine-pointer desktops.' } },
  },
} satisfies Meta<typeof TerminalInputFixture>
export default meta
type Story = StoryObj<typeof meta>

/** Long enough for React to apply an update an event caused (a negative assertion needs it). */
const settle = () => new Promise(resolve => setTimeout(resolve, 50))

export const BarAndSheet = {
  play: async ({ canvas, canvasElement, userEvent }) => {
    const editor = canvas.getByRole('textbox', { name: 'Example input' })
    const status = canvas.getByRole('status')
    await userEvent.click(editor)
    await userEvent.click(canvas.getByRole('button', { name: 'Tab' }))
    await expect(editor).toHaveFocus()
    await expect(status).toHaveTextContent('Tab')
    // A one-shot modifier applies to the next key, then turns itself off.
    await userEvent.click(canvas.getByRole('button', { name: 'Control' }))
    await expect(canvas.getByRole('button', { name: 'Control, on for the next key' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(canvas.getByRole('button', { name: 'Esc' }))
    await expect(status).toHaveTextContent('Ctrl+Esc')
    await expect(canvas.getByRole('button', { name: 'Control' })).toHaveAttribute('aria-pressed', 'false')
    // The sheet replaces the keyboard in the same accessory.
    await userEvent.click(canvas.getByRole('button', { name: 'More keys' }))
    // The sheet mounts on a later frame than the click: wait for it, never read it synchronously.
    await expect(await canvas.findByRole('region', { name: 'More keys' })).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Ctrl+C Interrupt' }))
    await expect(status).toHaveTextContent('Ctrl+C')
    // A Control shortcut takes an armed Option too.
    await userEvent.click(canvas.getByRole('button', { name: 'Option' }))
    await userEvent.click(canvas.getByRole('button', { name: 'Ctrl+W Delete word' }))
    await expect(status).toHaveTextContent('Ctrl+Alt+W')
    await expect(canvas.getByRole('button', { name: 'Option' })).toHaveAttribute('aria-pressed', 'false')
    // A lock stays on across keys until it is turned off.
    await userEvent.click(canvas.getByRole('button', { name: 'Option lock' }))
    await expect(canvas.getByRole('button', { name: 'Option, locked' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(canvas.getByRole('button', { name: 'Home' }))
    await userEvent.click(canvas.getByRole('button', { name: 'End' }))
    await expect(status).toHaveTextContent('Alt+End')
    await userEvent.click(canvas.getByRole('button', { name: 'Option lock' }))
    await expect(canvas.getByRole('button', { name: 'Option' })).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(canvas.getByRole('button', { name: 'Back to keyboard' }))
    await expect(canvas.queryByRole('region', { name: 'More keys' })).toBeNull()
    await expect(editor).toHaveFocus()
    // The next key typed in the editor takes an armed modifier, a named key too.
    await userEvent.click(canvas.getByRole('button', { name: 'Control' }))
    await userEvent.keyboard('c')
    await expect(status).toHaveTextContent('Ctrl+c')
    await expect(canvas.getByRole('button', { name: 'Control' })).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(canvas.getByRole('button', { name: 'Control' }))
    await userEvent.keyboard('{ArrowLeft}')
    await expect(status).toHaveTextContent('Ctrl+Left')
    // A key inside a composition is not a key, and its interim input is not committed text:
    // the modifier stays until the composition commits.
    await userEvent.click(canvas.getByRole('button', { name: 'Option' }))
    fireEvent.keyDown(editor, { key: 'a', isComposing: true })
    fireEvent.input(editor, { isComposing: true })
    await settle()
    await expect(status).toHaveTextContent('Ctrl+Left')
    await expect(canvas.getByRole('button', { name: 'Option, on for the next key' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.compositionEnd(editor, { data: '' })
    await settle()
    await expect(canvas.getByRole('button', { name: 'Option, on for the next key' })).toBeVisible()
    fireEvent.compositionEnd(editor, { data: 'あ' })
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Option' })).toHaveAttribute('aria-pressed', 'false'))
    // Committed text outside a composition (dictation, autocorrect) ends a one-shot modifier too.
    await userEvent.click(canvas.getByRole('button', { name: 'Option' }))
    fireEvent.input(editor)
    await waitFor(() => expect(canvas.getByRole('button', { name: 'Option' })).toHaveAttribute('aria-pressed', 'false'))
    // Opened with a pointer, the sheet takes focus from the editor (on the next frame).
    await userEvent.click(canvas.getByRole('button', { name: 'More keys' }))
    await waitFor(() => expect(canvas.getByRole('region', { name: 'More keys' })).toHaveFocus())
    await expect(editor).not.toHaveFocus()
    // While it is open the sheet owns Escape, wherever focus is: it closes, and the editor never
    // sees it (with Control armed, an Escape reaching the editor would send Ctrl+Esc).
    await userEvent.click(canvas.getByRole('button', { name: 'Control' }))
    editor.focus()
    await userEvent.keyboard('{Escape}')
    await expect(canvas.queryByRole('region', { name: 'More keys' })).toBeNull()
    await expect(editor).toHaveFocus()
    await settle()
    await expect(status).not.toHaveTextContent('Esc')
    await userEvent.click(canvas.getByRole('button', { name: 'Control, on for the next key' }))
    // Left open: an Escape another owner already claimed, one inside a composition, one inside a dialog.
    await userEvent.click(canvas.getByRole('button', { name: 'More keys' }))
    const claimed = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    claimed.preventDefault()
    editor.dispatchEvent(claimed)
    fireEvent.keyDown(editor, { key: 'Escape', isComposing: true })
    const dialog = Object.assign(document.createElement('div'), { role: 'dialog' })
    dialog.setAttribute('role', 'dialog')
    const inDialog = document.createElement('button')
    dialog.append(inDialog)
    canvasElement.append(dialog)
    inDialog.focus()
    await userEvent.keyboard('{Escape}')
    dialog.remove()
    await settle()
    await expect(await canvas.findByRole('region', { name: 'More keys' })).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await expect(canvas.queryByRole('region', { name: 'More keys' })).toBeNull()
    // Hide keyboard works while sending is disabled.
    await userEvent.click(canvas.getByRole('button', { name: 'Disable keys' }))
    await expect(canvas.getByRole('button', { name: 'Tab' })).toBeDisabled()
    await userEvent.click(canvas.getByRole('button', { name: 'Hide keyboard' }))
    await expect(status).toHaveTextContent('Keyboard hidden')
    await userEvent.click(canvas.getByRole('button', { name: 'Enable keys' }))
    canvasElement.setAttribute('data-story-ready', 'true')
  },
} satisfies Story

/**
 * The same bar for visual capture: no interaction script (BarAndSheet's play is
 * the behavior coverage, run by the story and browser suites); the visual spec
 * drives what it needs itself, from the bar's first render.
 */
export const VisualCapture = {
  parameters: { docs: { disable: true } },
  play: async ({ canvas, canvasElement }) => {
    await expect(canvas.getByRole('group', { name: 'Terminal keys' })).toBeVisible()
    canvasElement.setAttribute('data-story-ready', 'true')
  },
} satisfies Story
