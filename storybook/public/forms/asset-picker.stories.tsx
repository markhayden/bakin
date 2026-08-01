import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { AssetPicker, type AssetPickerCollection } from '@makinbakin/sdk/patterns'
import { Button } from '@makinbakin/sdk/ui'

import { StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Forms/AssetPicker',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'AssetPicker is the controlled asset chooser with dialog and inline compositions. The consumer supplies the collection state (`loading`, `error`, `ready`), the query, and owns endpoints, uploads, and mutations; the picker supplies search, thumbnails, exact empty/error/loading states, and the keyboard selection contract.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'keyboard', 'loading', 'error', 'empty', 'disabled', 'long-content', 'reduced-motion'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const portrait = 'data:image/svg+xml,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20viewBox=%220%200%2064%2064%22%3E%3Crect%20width=%2264%22%20height=%2264%22%20fill=%22%23172554%22/%3E%3Cpath%20d=%22M8%2048l14-15%209%208%208-10%2017%2017%22%20fill=%22none%22%20stroke=%22%2393c5fd%22%20stroke-width=%225%22/%3E%3Ccircle%20cx=%2244%22%20cy=%2220%22%20r=%226%22%20fill=%22%23fbbf24%22/%3E%3C/svg%3E'

const readyAssets: AssetPickerCollection = {
  status: 'ready',
  assets: [
    { id: 'hero-1', label: 'Campaign hero', description: 'Approved wide image', type: 'image', thumbnailSrc: portrait },
    { id: 'logo-1', label: 'Primary logo', description: 'Transparent brand mark', type: 'image' },
    { id: 'brief-1', label: 'Launch brief', description: 'Campaign source document', type: 'document' },
    { id: 'long-1', label: 'Quarterly launch campaign photography contact sheet with a deliberately long title', type: 'image' },
    { id: 'locked-1', label: 'Archived asset', description: 'Unavailable for new work', disabled: true },
  ],
}

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  render: () => (
    <AssetPicker
      variant="inline"
      view="list"
      collection={readyAssets}
      query=""
      onQueryChange={() => {}}
      onPick={() => {}}
    />
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('searchbox', { name: 'Search assets' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Select Campaign hero' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Select Archived asset' })).toBeDisabled()
  },
} satisfies Story

function DialogLibraryExample() {
  const [open, setOpen] = useState(true)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState('Nothing selected')

  return (
    <StoryStage
      eyebrow="Assets / managed library"
      title="Choose managed assets by meaning, not raw IDs"
      description="The consumer supplies the library state and owns upload requests. The picker supplies the modal, search, thumbnails, exact states, and keyboard selection contract."
    >
      <StorySection title="Selection result">
        <p role="status">{selected}</p>
        <Button type="button" variant="outline" onClick={() => setOpen(true)}>Open asset library</Button>
      </StorySection>
      <AssetPicker
        open={open}
        onOpenChange={setOpen}
        collection={readyAssets}
        query={query}
        onQueryChange={setQuery}
        onPick={(assetId) => {
          setSelected(`Selected asset: ${assetId}`)
          setOpen(false)
        }}
        title="Choose campaign artwork"
        description="Search the approved library or start a consumer-owned upload."
        toolbarAction={<Button type="button" size="sm" variant="secondary">Upload new</Button>}
      />
    </StoryStage>
  )
}

export const DialogLibrary = {
  render: () => <DialogLibraryExample />,
  play: async ({ canvasElement }) => {
    const page = within(document.body)
    const search = await page.findByRole('searchbox', { name: 'Search assets' })
    await userEvent.type(search, 'logo')
    await expect(page.getByRole('button', { name: 'Select Primary logo' })).toBeVisible()
    await userEvent.click(page.getByRole('button', { name: 'Select Primary logo' }))
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('status')).toHaveTextContent('Selected asset: logo-1')
    await waitFor(() => expect(page.queryByRole('dialog')).not.toBeInTheDocument())
  },
} satisfies Story

function InlineStatesExample() {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState('No attachment selected')
  const [retryState, setRetryState] = useState<AssetPickerCollection>({
    status: 'error',
    message: 'The shared asset library did not respond.',
  })

  return (
    <StoryStage
      eyebrow="Assets / embedded composition"
      title="Reuse the same chooser inside attach and relink flows"
      description="Inline composition covers Bits quick-post and project workflows without giving the visual pattern outside-click, endpoint, or mutation ownership."
      width="wide"
    >
      <AssetPicker
        variant="inline"
        view="list"
        title="Attach an existing asset"
        description="Already-attached assets can be removed before this list is supplied."
        collection={readyAssets}
        query={query}
        onQueryChange={setQuery}
        onPick={(assetId) => setSelected(`Attachment candidate: ${assetId}`)}
        searchLabel="Search attachable assets"
      />
      <p role="status">{selected}</p>
      <AssetPicker
        variant="inline"
        view="list"
        title="Relink unavailable asset"
        description="Errors stay recoverable and name the failed dependency."
        collection={retryState}
        query=""
        onQueryChange={() => {}}
        onPick={() => {}}
        onRetry={() => setRetryState({ status: 'ready', assets: [] })}
        searchLabel="Search replacement assets"
      />
      <AssetPicker
        variant="inline"
        title="Loading library"
        collection={{ status: 'loading' }}
        query=""
        onQueryChange={() => {}}
        onPick={() => {}}
        searchLabel="Search loading assets"
      />
    </StoryStage>
  )
}

export const InlineAttachRelinkAndStates = {
  render: () => <InlineStatesExample />,
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Select Launch brief' }))
    await expect(canvas.getByRole('status', { name: '' })).toHaveTextContent('Attachment candidate: brief-1')
    await expect(canvas.getByRole('alert')).toHaveTextContent('The shared asset library did not respond.')
    await userEvent.click(canvas.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(canvas.getByText('No assets yet')).toBeVisible())
    await expect(canvas.getByText('Loading assets')).toBeVisible()
  },
} satisfies Story
