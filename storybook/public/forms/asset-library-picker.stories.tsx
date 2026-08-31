import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { AssetLibraryPicker, type AssetLibraryAsset } from '@makinbakin/sdk/patterns'
import { Button } from '@makinbakin/sdk/ui'

import { StorySection, StoryStage } from '../../support'

const library: AssetLibraryAsset[] = [
  { assetId: 'asset-hero', description: 'Campaign hero image', type: 'images', hasThumb: false },
  { assetId: 'asset-logo', description: 'Primary logo', type: 'images', hasThumb: false },
  { assetId: 'asset-brief', description: 'Launch brief', type: 'documents', hasThumb: false },
]

const meta = {
  title: 'Components/Forms/AssetLibraryPicker',
  component: AssetLibraryPicker,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'AssetLibraryPicker is the library-connected asset chooser: the presentation-only AssetPicker composed with the assets plugin\'s listing and upload wiring (thumbnail grid, search, upload-new, drag-drop) — never a raw id select. By default it talks to the assets plugin endpoints; `loadAssets` / `uploadAsset` override the source for tests and non-default libraries. Library failures degrade honestly: the error state still offers upload-new.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'keyboard', 'loading', 'error', 'empty', 'busy'],
  },
} satisfies Meta<typeof AssetLibraryPicker>

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  args: {
    open: true,
    onOpenChange: () => {},
    onPick: () => {},
    // Fixture loader; the default wiring targets the assets plugin endpoints.
    loadAssets: async () => library,
  },
  argTypes: {
    open: { control: 'boolean' },
    title: { control: 'text' },
    description: { control: 'text' },
    loadAssets: { control: false },
    uploadAsset: { control: false },
    filter: { control: false },
  },
  play: async () => {
    const page = within(document.body)
    await page.findByRole('dialog', { name: 'Choose an asset' })
    await page.findByRole('button', { name: 'Select Campaign hero image' })
    await expect(page.getByRole('button', { name: 'Upload new' })).toBeVisible()
    await expect(page.getByRole('searchbox', { name: 'Search assets' })).toBeVisible()
  },
} satisfies Story

function PickFlowExample() {
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState('Nothing picked yet.')
  return (
    <StoryStage
      eyebrow="Assets / managed library"
      title="Pick from the connected library"
      description="The picker owns the listing and upload wiring; the consumer receives one assetId and the dialog closes itself."
    >
      <StorySection title="Selection result">
        <p role="status">{picked}</p>
        <Button type="button" variant="outline" onClick={() => setOpen(true)}>Choose an asset</Button>
      </StorySection>
      <AssetLibraryPicker
        open={open}
        onOpenChange={setOpen}
        onPick={(assetId) => setPicked(`Picked: ${assetId}`)}
        loadAssets={async () => library}
      />
    </StoryStage>
  )
}

export const PickFlow = {
  // Type-satisfying only: the stateful example owns its props.
  args: { open: false, onOpenChange: () => {}, onPick: () => {} },
  render: () => <PickFlowExample />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const page = within(document.body)
    await userEvent.click(canvas.getByRole('button', { name: 'Choose an asset' }))
    const hero = await page.findByRole('button', { name: 'Select Campaign hero image' })
    await userEvent.click(hero)
    await expect(canvas.getByRole('status')).toHaveTextContent('Picked: asset-hero')
    await waitFor(() => expect(page.queryByRole('dialog')).not.toBeInTheDocument())
  },
} satisfies Story

function LibraryStatesExample() {
  const [openUnreachable, setOpenUnreachable] = useState(false)
  const [openEmpty, setOpenEmpty] = useState(false)
  return (
    <StoryStage
      eyebrow="Assets / managed library"
      title="Honest library states"
      description="An unreachable library is an explicit error state that still offers upload-new; an empty library explains itself."
    >
      <StorySection title="Open a degraded library">
        <Button type="button" variant="outline" onClick={() => setOpenUnreachable(true)}>Library unreachable</Button>
        <Button type="button" variant="outline" onClick={() => setOpenEmpty(true)}>Empty library</Button>
      </StorySection>
      <AssetLibraryPicker
        open={openUnreachable}
        onOpenChange={setOpenUnreachable}
        onPick={() => {}}
        title="Choose an asset (unreachable)"
        loadAssets={async () => {
          throw new Error('library unreachable')
        }}
      />
      <AssetLibraryPicker
        open={openEmpty}
        onOpenChange={setOpenEmpty}
        onPick={() => {}}
        title="Choose an asset (empty)"
        loadAssets={async () => []}
      />
    </StoryStage>
  )
}

export const LibraryStates = {
  // Type-satisfying only: the stateful example owns its props.
  args: { open: false, onOpenChange: () => {}, onPick: () => {} },
  render: () => <LibraryStatesExample />,
  play: async ({ canvas }) => {
    const page = within(document.body)
    await userEvent.click(canvas.getByRole('button', { name: 'Library unreachable' }))
    await page.findByText("Couldn't load your assets")
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Upload new' })).toBeVisible()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(page.queryByRole('dialog')).not.toBeInTheDocument())
    await userEvent.click(canvas.getByRole('button', { name: 'Empty library' }))
    await page.findByText('No assets yet')
  },
} satisfies Story
