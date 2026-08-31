import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect } from 'storybook/test'

import {
  Composer,
  type ComposerAttachmentItem,
} from '@makinbakin/sdk/conversation'
import {
  Page,
  PageBody,
  PageComposer,
  PageHeader,
} from '@makinbakin/sdk/patterns'

import './conversation.stories.css'

const meta = {
  title: 'Components/Conversation/Composer and attachments',
  component: Composer,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Composer is the canonical persistent conversation input. It keeps typing available during replies, handles Enter/Shift+Enter/IME/history consistently, and presents consumer-owned attachment capabilities honestly.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'long-labels', 'keyboard', 'non-color', 'reduced-motion', 'busy', 'disabled', 'error', 'dense-data', 'attachments'],
  },
} satisfies Meta<typeof Composer>

export default meta
type Story = StoryObj<typeof meta>

let canonicalSent = ''

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  args: {
    storageKey: 'storybook-canonical-composer',
    inputLabel: 'Message the agent',
    onSend: (content) => { canonicalSent = content },
  },
  argTypes: {
    busy: { control: 'boolean' },
    disabled: { control: 'boolean' },
    placeholder: { control: 'text' },
    inputLabel: { control: 'text' },
    maxLength: { control: 'number' },
    // Draft identity and the send/abort/attachment wiring are consumer-owned.
    storageKey: { control: false },
    onSend: { control: false },
    onAbort: { control: false },
    attachments: { control: false },
  },
  // Width frame: the centered (shrink-to-fit) canvas collapses the composer
  // to min-content; in the app it spans the conversation column.
  render: (args) => (
    <div style={{ inlineSize: '40rem', maxInlineSize: '100%' }}>
      <Composer {...args} />
    </div>
  ),
  play: async ({ canvas, userEvent }) => {
    const input = canvas.getByRole('textbox', { name: 'Message the agent' })
    await userEvent.clear(input)
    await userEvent.type(input, 'Check the release plan.')
    await userEvent.keyboard('{Enter}')
    await expect(canonicalSent).toBe('Check the release plan.')
    await expect(input).toHaveValue('')
  },
} satisfies Story

function ProductComposerExample() {
  const [sent, setSent] = useState('Nothing sent yet')

  return (
    <main className="bakin-conversation-story">
      <Page width="standard">
        <PageHeader
          eyebrow="Conversation / product default"
          title="Ask a focused follow-up"
          description="The composer sits outside the message log. Drafts and input history follow the thread key while uploads and sending stay with the consumer."
        />
        <PageBody gap="content">
          <section aria-labelledby="composer-default-heading" className="bakin-conversation-story__section">
            <header>
              <h2 id="composer-default-heading">Ready to compose</h2>
              <p>Enter sends, Shift+Enter adds a line, and the resize separator is keyboard operable.</p>
            </header>
            <div className="bakin-conversation-story__composer-frame">
              <PageComposer>
                <Composer
                  storageKey="storybook-product-composer"
                  inputLabel="Message the release agent"
                  placeholder="Message the release agent…"
                  maxLength={240}
                  onSend={(content) => setSent(content ? `Sent: ${content}` : 'Sent with attachments')}
                  attachments={{
                    enabled: true,
                    items: [],
                    acceptedTypes: ['image/*'],
                    onAdd: (files) => setSent(`Selected ${files.length} image${files.length === 1 ? '' : 's'}`),
                    onRemove: () => {},
                  }}
                />
              </PageComposer>
            </div>
            <p role="status" className="bakin-conversation-story__selection">{sent}</p>
          </section>
        </PageBody>
      </Page>
    </main>
  )
}

export const ProductComposer = {
  args: { storageKey: 'storybook-product-composer', onSend: () => {} },
  render: () => <ProductComposerExample />,
  play: async ({ canvas, userEvent }) => {
    const input = canvas.getByRole('textbox', { name: 'Message the release agent' })
    await userEvent.clear(input)
    await userEvent.type(input, 'Verify the public routing examples.')
    await userEvent.keyboard('{Shift>}{Enter}{/Shift}Keep the exception visible.')
    await expect(input).toHaveValue('Verify the public routing examples.\nKeep the exception visible.')
    await userEvent.keyboard('{Enter}')
    await expect(canvas.getByRole('status')).toHaveTextContent('Sent: Verify the public routing examples. Keep the exception visible.')
    await expect(input).toHaveValue('')
  },
} satisfies Story

const attachmentItems: ComposerAttachmentItem[] = [
  {
    id: 'ready',
    name: 'routing-map.png',
    status: 'ready',
    previewUrl: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120"%3E%3Crect width="120" height="120" rx="12" fill="%23262225"/%3E%3Cpath d="M16 82h24l18-44 18 48 12-30h16" fill="none" stroke="%23ff2c8b" stroke-width="6"/%3E%3C/svg%3E',
  },
  { id: 'uploading', name: 'release-evidence.png', status: 'uploading' },
  { id: 'failed', name: 'archived-route.png', status: 'error', errorMessage: 'Upload failed' },
]

function LifecycleExample() {
  const [outcome, setOutcome] = useState('No action taken')
  const [items, setItems] = useState(attachmentItems)

  return (
    <main className="bakin-conversation-story">
      <Page>
        <PageHeader
          eyebrow="Conversation / explicit states"
          title="Keep attachment and reply state unambiguous"
          description="Progress, failure, capability limits, and stop behavior remain understandable without depending on color or motion."
        />
        <PageBody gap="content">
          <div className="bakin-conversation-story__composer-grid">
            <section aria-labelledby="composer-busy-heading" className="bakin-conversation-story__section">
              <header>
                <h2 id="composer-busy-heading">Reply active with staged images</h2>
                <p>Typing stays live, but pending uploads and the active reply hold the next send.</p>
              </header>
              <div className="bakin-conversation-story__composer-frame">
                <Composer
                  storageKey="storybook-busy-composer"
                  inputLabel="Queue a follow-up"
                  placeholder="Queue a follow-up while the agent replies…"
                  busy
                  autoFocus={false}
                  onAbort={() => setOutcome('Stop requested')}
                  onSend={() => {}}
                  attachments={{
                    enabled: true,
                    items,
                    acceptedTypes: ['image/*'],
                    onAdd: (files) => setOutcome(`Selected ${files.length} image${files.length === 1 ? '' : 's'}`),
                    onRemove: (id) => setItems((current) => current.filter((item) => item.id !== id)),
                  }}
                />
              </div>
            </section>

            <section aria-labelledby="composer-unavailable-heading" className="bakin-conversation-story__section">
              <header>
                <h2 id="composer-unavailable-heading">Image input unavailable</h2>
                <p>The affordance stays discoverable but disabled, with the actual capability reason attached.</p>
              </header>
              <div className="bakin-conversation-story__composer-frame">
                <Composer
                  storageKey="storybook-unavailable-composer"
                  inputLabel="Message a text-only agent"
                  placeholder="Message the text-only agent…"
                  autoFocus={false}
                  onSend={() => {}}
                  attachments={{
                    enabled: false,
                    disabledReason: 'This agent model cannot inspect images.',
                    items: [],
                    onAdd: () => {},
                    onRemove: () => {},
                  }}
                />
              </div>
            </section>
          </div>
          <p role="status" className="bakin-conversation-story__selection">{outcome}</p>
        </PageBody>
      </Page>
    </main>
  )
}

export const AttachmentAndAvailabilityStates = {
  args: { storageKey: 'storybook-busy-composer', onSend: () => {} },
  render: () => <LifecycleExample />,
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByRole('status', { name: 'Uploading release-evidence.png' })).toBeVisible()
    await expect(canvas.getByRole('alert')).toHaveTextContent('Upload failed')
    const unavailable = canvas.getAllByRole('button', { name: 'Add images' })[1]
    await expect(unavailable).toBeDisabled()
    await expect(unavailable).toHaveAttribute('title', 'This agent model cannot inspect images.')
    await userEvent.click(canvas.getByRole('button', { name: 'Stop the reply' }))
    await expect(canvas.getByText('Stop requested')).toBeVisible()
  },
} satisfies Story
