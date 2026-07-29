import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { PageShell, Stack } from '@makinbakin/sdk/layout'
import {
  AssetPicker,
  ColorPicker,
  DEFAULT_MODEL_VALUE,
  ModelSelect,
  type AssetPickerCollection,
} from '@makinbakin/sdk/patterns'
import { Button } from '@makinbakin/sdk/ui'

import './asset-model-color-pickers.stories.css'

const meta = {
  title: 'Choices/Asset, model, and color pickers',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Controlled picker patterns accept presentation-ready options and states. Asset endpoints, upload requests, catalog loading, palette persistence, and owning mutations stay with the consumer.',
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

function StoryHeader({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return (
    <header className="bakin-picker-story__intro">
      <p>{eyebrow}</p>
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  )
}

function DialogLibraryExample() {
  const [open, setOpen] = useState(true)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState('Nothing selected')

  return (
    <main className="bakin-picker-story">
      <PageShell width="content">
        <Stack gap="section">
          <StoryHeader
            eyebrow="Assets / managed library"
            title="Choose managed assets by meaning, not raw IDs"
            description="The consumer supplies the library state and owns upload requests. The picker supplies the modal, search, thumbnails, exact states, and keyboard selection contract."
          />
          <section className="bakin-picker-story__surface" aria-labelledby="dialog-result-title">
            <h2 id="dialog-result-title">Selection result</h2>
            <p role="status">{selected}</p>
            <Button type="button" variant="outline" onClick={() => setOpen(true)}>Open asset library</Button>
          </section>
        </Stack>
      </PageShell>
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
    </main>
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
    <main className="bakin-picker-story">
      <PageShell width="wide">
        <Stack gap="section">
          <StoryHeader
            eyebrow="Assets / embedded composition"
            title="Reuse the same chooser inside attach and relink flows"
            description="Inline composition covers Bits quick-post and project workflows without giving the visual pattern outside-click, endpoint, or mutation ownership."
          />
          <div className="bakin-picker-story__state-grid">
            <div className="bakin-picker-story__surface">
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
            </div>
            <div className="bakin-picker-story__state-stack">
              <div className="bakin-picker-story__surface">
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
              </div>
              <div className="bakin-picker-story__surface">
                <AssetPicker
                  variant="inline"
                  title="Loading library"
                  collection={{ status: 'loading' }}
                  query=""
                  onQueryChange={() => {}}
                  onPick={() => {}}
                  searchLabel="Search loading assets"
                />
              </div>
            </div>
          </div>
        </Stack>
      </PageShell>
    </main>
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

const models = [
  { id: 'acme-fast', name: 'Acme Fast', provider: 'acme-cloud' },
  { id: 'acme-reasoning', name: 'Acme Reasoning With A Deliberately Long Catalog Name', provider: 'acme-cloud' },
  { id: 'local-small', name: 'Local Small', provider: 'local' },
  { id: 'retired', name: 'Retired preview', provider: 'legacy', disabled: true },
]

const colors = [
  { value: 'series-1', label: 'Ocean', color: 'var(--bakin-color-data-series-1)' },
  { value: 'series-2', label: 'Violet', color: 'var(--bakin-color-data-series-2)' },
  { value: 'series-3', label: 'Teal', color: 'var(--bakin-color-data-series-3)' },
  { value: 'series-4', label: 'Amber', color: 'var(--bakin-color-data-series-4)' },
  { value: 'series-5', label: 'Rose', color: 'var(--bakin-color-data-series-5)' },
  { value: 'series-6', label: 'Slate', color: 'var(--bakin-color-data-series-6)' },
]

function ModelAndColorExample() {
  const [model, setModel] = useState(DEFAULT_MODEL_VALUE)
  const [color, setColor] = useState('series-1')
  return (
    <main className="bakin-picker-story">
      <PageShell width="content">
        <Stack gap="section">
          <StoryHeader
            eyebrow="Models and identity"
            title="Keep catalog and palette choices explicit"
            description="Providers group model choices, unavailable entries stay disabled, and color uses keyboard-complete radio semantics with visible selection meaning."
          />
          <section className="bakin-picker-story__surface" aria-labelledby="model-color-heading">
            <h2 id="model-color-heading">Execution defaults</h2>
            <div className="bakin-picker-story__field">
              <label htmlFor="picker-model">Model</label>
              <ModelSelect
                id="picker-model"
                value={model}
                onValueChange={setModel}
                models={models}
                defaultLabel="Use workspace default"
              />
            </div>
            <div className="bakin-picker-story__field">
              <span>Agent color</span>
              <ColorPicker ariaLabel="Agent color" value={color} onValueChange={setColor} options={colors} />
            </div>
            <p role="status">Model: {model}. Color: {color}.</p>
          </section>
        </Stack>
      </PageShell>
    </main>
  )
}

export const ModelAndColorChoices = {
  render: () => <ModelAndColorExample />,
  play: async ({ canvas }) => {
    const model = canvas.getByRole('combobox', { name: 'Model' })
    model.focus()
    await userEvent.keyboard('{Enter}')
    const page = within(document.body)
    await waitFor(() => expect(page.getByRole('listbox')).toBeVisible())
    await expect(page.getByRole('option', { name: 'Retired preview' })).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(page.getByRole('option', { name: 'Local Small' }))
    const ocean = canvas.getByRole('radio', { name: 'Ocean' })
    ocean.focus()
    await userEvent.keyboard('{ArrowRight}')
    await expect(canvas.getByRole('radio', { name: 'Violet' })).toHaveAttribute('aria-checked', 'true')
    await expect(canvas.getByRole('status')).toHaveTextContent('Model: local-small. Color: series-2.')
  },
} satisfies Story

export const UnavailableModelCatalog = {
  render: () => (
    <main className="bakin-picker-story">
      <PageShell width="content">
        <Stack gap="section">
          <StoryHeader
            eyebrow="Models and identity"
            title="Keep the saved model readable when the catalog is unavailable"
            description="An empty controlled catalog disables the trigger instead of opening an empty popup."
          />
          <section className="bakin-picker-story__surface" aria-labelledby="unavailable-model-heading">
            <h2 id="unavailable-model-heading">Execution defaults</h2>
            <div className="bakin-picker-story__field">
              <label htmlFor="unavailable-picker-model">Model</label>
              <ModelSelect
                id="unavailable-picker-model"
                value="acme/saved-model"
                onValueChange={() => {}}
                models={[]}
              />
            </div>
          </section>
        </Stack>
      </PageShell>
    </main>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('combobox', { name: 'Model' })).toBeDisabled()
  },
} satisfies Story
