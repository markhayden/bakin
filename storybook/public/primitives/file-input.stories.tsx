import type { Meta, StoryObj } from '@storybook/react-vite'
import { FileInput } from '@makinbakin/sdk/ui'
import { Stack } from '@makinbakin/sdk/layout'
import { useState } from 'react'
import { expect, fn } from 'storybook/test'

import { StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Primitives/FileInput',
  component: FileInput,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'FileInput is the kit file trigger: a Button wrapping the native file input with an accessible name, an accept filter, and a drag-enter affordance (dropping files on the trigger delivers them too). The consumer owns what happens to the files. Menu-driven flows omit `children` and open the dialog through the `open()` handle.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'keyboard', 'disabled'],
  },
  args: {
    onFiles: fn(),
  },
} satisfies Meta<typeof FileInput>

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  args: {
    label: 'Profile image',
    accept: 'image/png,image/jpeg,image/webp',
  },
  render: (args) => <FileInput {...args}>Choose image</FileInput>,
  play: async ({ canvas, userEvent, args }) => {
    await expect(canvas.getByRole('button', { name: 'Choose image' })).toBeVisible()
    const input = canvas.getByLabelText<HTMLInputElement>('Profile image')
    const file = new File(['png-bytes'], 'avatar.png', { type: 'image/png' })
    await userEvent.upload(input, file)
    await expect(args.onFiles).toHaveBeenCalledWith([file])
  },
} satisfies Story

function PickedFilesExample() {
  const [names, setNames] = useState<string[]>([])
  return (
    <StoryStage
      eyebrow="File intake"
      title="FileInput"
      description="One kit trigger for every upload surface — visible affordance, honest accept filter, consumer-owned handling."
    >
      <StorySection title="States">
        <Stack gap="item" style={{ maxWidth: '40rem' }}>
          <FileInput label="Upload assets" multiple onFiles={(files) => setNames(files.map((file) => file.name))}>
            Upload assets
          </FileInput>
          <FileInput label="Replace image" accept="image/*" variant="secondary" onFiles={() => {}}>
            Replace image
          </FileInput>
          <FileInput label="Disabled upload" disabled onFiles={() => {}}>
            Disabled upload with a label long enough to wrap at 200% text zoom
          </FileInput>
          <p role="status">{names.length > 0 ? `Picked: ${names.join(', ')}` : 'Nothing picked yet.'}</p>
        </Stack>
      </StorySection>
    </StoryStage>
  )
}

export const States = {
  args: { label: 'Upload assets' },
  render: () => <PickedFilesExample />,
  play: async ({ canvas, userEvent }) => {
    const input = canvas.getByLabelText<HTMLInputElement>('Upload assets')
    await userEvent.upload(input, [
      new File(['a'], 'first.txt', { type: 'text/plain' }),
      new File(['b'], 'second.txt', { type: 'text/plain' }),
    ])
    await expect(canvas.getByRole('status')).toHaveTextContent('Picked: first.txt, second.txt')
    await expect(canvas.getByRole('button', { name: /Disabled upload/ })).toBeDisabled()
  },
} satisfies Story
