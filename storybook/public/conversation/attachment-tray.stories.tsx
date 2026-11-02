import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fn } from 'storybook/test'

import {
  ComposerAttachmentTray,
  type ComposerAttachmentItem,
} from '@makinbakin/sdk/conversation'
import { CopyButton } from '@makinbakin/sdk/patterns'

import './conversation.stories.css'

const meta = {
  title: 'Components/Conversation/Attachment tray',
  component: ComposerAttachmentTray,
  tags: ['public'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component: 'ComposerAttachmentTray shows a draft\'s attachments exactly as Composer does above its input: an uploading tile, a failed tile with its message, or a thumbnail, each with a remove button. Use it in any composer that is not a Composer (a terminal\'s compose sheet); upload, removal and sending stay the consumer\'s. `itemAction` adds one control under a thumbnail, such as copying the path the image was saved at.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'long-labels', 'keyboard', 'non-color', 'disabled', 'error', 'busy', 'attachments'],
  },
} satisfies Meta<typeof ComposerAttachmentTray>

export default meta
type Story = StoryObj<typeof meta>

// A stand-in screenshot (the consumer's local preview URL).
const PREVIEW = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" fill="#7c8fa6"/><rect x="12" y="16" width="56" height="34" rx="4" fill="#dfe6ee"/></svg>')

function Tray({ initial, withAction, disabled }: { initial: ComposerAttachmentItem[]; withAction?: boolean; disabled?: boolean }) {
  const [items, setItems] = useState(initial)
  return (
    <ComposerAttachmentTray
      items={items}
      disabled={disabled}
      onRemove={(id) => setItems((current) => current.filter((item) => item.id !== id))}
      itemAction={withAction ? (item) => item.status === 'ready' || item.status === undefined ? <CopyButton text={`/uploads/${item.name}`} label={`Copy the path of ${item.name}`} /> : null : undefined}
    />
  )
}

export const CanonicalUsage = {
  args: {
    items: [{ id: 'shot', name: 'screenshot.png', previewUrl: PREVIEW, status: 'ready' }],
    onRemove: fn(),
  },
  argTypes: {
    disabled: { control: 'boolean' },
    items: { control: 'object' },
    // Removal (and any item action) is consumer-owned.
    onRemove: { control: false },
    itemAction: { control: false },
  },
  play: async ({ args, canvas, userEvent }) => {
    await expect(canvas.getByRole('img', { name: 'screenshot.png' })).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Remove screenshot.png' }))
    await expect(args.onRemove).toHaveBeenCalledWith('shot')
  },
} satisfies Story

export const StatesAndItemAction = {
  args: { items: [], onRemove: () => {} },
  render: () => (
    <Tray withAction initial={[
      { id: 'up', name: 'uploading-a-long-file-name-from-the-phone-camera-roll.heic.png', status: 'uploading' },
      { id: 'bad', name: 'too-large.png', status: 'error', errorMessage: 'Images are at most 10 MB' },
      { id: 'ok', name: 'layout.png', previewUrl: PREVIEW, status: 'ready' },
      { id: 'noPreview', name: 'diagram.webp', status: 'ready' },
    ]} />
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('status', { name: /^Uploading uploading-a-long-file-name/ })).toBeVisible()
    await expect(canvas.getByRole('alert')).toHaveTextContent('Images are at most 10 MB')
    // The item action shows only where the consumer offers it (here: ready images).
    await expect(canvas.getByRole('button', { name: 'Copy the path of layout.png' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Copy the path of diagram.webp' })).toBeVisible()
    await expect(canvas.queryByRole('button', { name: 'Copy the path of too-large.png' })).toBeNull()
  },
} satisfies Story

export const Disabled = {
  args: { items: [], onRemove: () => {} },
  render: () => <Tray disabled initial={[{ id: 'ok', name: 'layout.png', previewUrl: PREVIEW, status: 'ready' }]} />,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('button', { name: 'Remove layout.png' })).toBeDisabled()
  },
} satisfies Story
