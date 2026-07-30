import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, waitFor, within } from 'storybook/test'

import {
  ConversationPanel,
  ToolCallDrawer,
  type ConversationMessage,
  type ConversationToolCall,
} from '@makinbakin/sdk/conversation'
import { PageShell, Stack } from '@makinbakin/sdk/layout'
import { Button } from '@makinbakin/sdk/ui'

import './conversation.stories.css'

const meta = {
  title: 'Conversation/Panel and tool detail',
  component: ConversationPanel,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'ConversationPanel is the bounded single-session composition for embedded reviews. Consumers own transport, persistence, identity lookup, routing, and mutations; the panel owns consistent contained history, composer placement, resizing, read-only disclosure, and exact tool-detail presentation.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'long-labels', 'keyboard', 'non-color', 'reduced-motion', 'busy', 'readonly', 'drawer', 'dense-data', 'scroll-ownership'],
  },
} satisfies Meta<typeof ConversationPanel>

export default meta
type Story = StoryObj<typeof meta>

const releaseAgent = { id: 'release', name: 'Release operations agent' }

const toolCall: ConversationToolCall = {
  key: 'route-audit',
  callId: 'route-audit',
  toolName: 'route_audit',
  status: 'completed',
  summary: 'Compared the published builder routes with the current routing contract',
  inputPreview: '{"scope":"public examples","includeArchived":true}',
  outputPreview: '{"checked":268,"exceptions":["archived-routing-appendix"]}',
  durationMs: 1840,
  metadata: { truncated: true, captureLimit: 4096, source: 'release-runtime' },
}

const panelMessages: ConversationMessage[] = [
  {
    kind: 'user',
    ts: '2026-01-15T11:54:00.000Z',
    content: 'Check the public routing examples and keep any exception visible.',
  },
  {
    kind: 'assistant',
    ts: '2026-01-15T11:55:00.000Z',
    turnId: 'release-review',
    agentId: 'release',
    content: 'The current route contract is preserved. One archived appendix still needs an explicit owner.',
  },
  {
    kind: 'tool',
    ts: '2026-01-15T11:55:02.000Z',
    turnId: 'release-review',
    agentId: 'release',
    callId: toolCall.callId,
    toolName: toolCall.toolName,
    status: toolCall.status,
    summary: toolCall.summary,
    inputPreview: toolCall.inputPreview,
    outputPreview: toolCall.outputPreview,
    durationMs: toolCall.durationMs,
    metadata: toolCall.metadata,
  },
]

function ProductPanelExample() {
  const [outcome, setOutcome] = useState('No action taken')

  return (
    <main className="bakin-conversation-story">
      <PageShell width="content">
        <Stack gap="section">
          <header className="bakin-conversation-story__intro">
            <p>Conversation / bounded product surface</p>
            <h1>Coordinate an embedded release review</h1>
            <p>The panel owns one deliberate history boundary. Identity controls and every mutation remain consumer supplied.</p>
          </header>

          <section aria-labelledby="product-panel-heading" className="bakin-conversation-story__section">
            <header>
              <h2 id="product-panel-heading">Release evidence</h2>
              <p>Use a panel where the surrounding product surface provides a real height boundary.</p>
            </header>
            <div className="bakin-conversation-story__panel-frame">
              <ConversationPanel
                messages={panelMessages}
                agent={releaseAgent}
                agentControl={(
                  <Button type="button" variant="ghost" size="xs" onClick={() => setOutcome('Agent control opened')}>
                    Change agent
                  </Button>
                )}
                onSend={(content) => setOutcome(`Sent: ${content}`)}
                storageKey="storybook-product-panel"
                title="Release review"
                inputLabel="Message the release operations agent"
                placeholder="Ask about release readiness…"
              />
            </div>
            <p role="status" className="bakin-conversation-story__selection">{outcome}</p>
          </section>
        </Stack>
      </PageShell>
    </main>
  )
}

export const ProductPanel = {
  args: { messages: panelMessages, onSend: () => {}, storageKey: 'storybook-product-panel' },
  render: () => <ProductPanelExample />,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('region', { name: 'Release review' })).toBeVisible()
    await expect(canvas.getByRole('article', { name: 'Release operations agent reply' })).toBeVisible()
    await expect(canvas.getByRole('textbox', { name: 'Message the release operations agent' })).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Change agent' })).toBeVisible()
  },
} satisfies Story

export const DocumentDividerPanel = {
  args: {
    messages: panelMessages,
    onSend: () => {},
    storageKey: 'storybook-document-divider',
    chrome: 'top-divider',
    showHeader: false,
  },
  render: (args) => (
    <main className="bakin-conversation-story">
      <PageShell width="content">
        <Stack gap="section">
          <header className="bakin-conversation-story__intro">
            <p>Conversation / document continuation</p>
            <h1>Continue a project conversation without another box</h1>
            <p>The surrounding document owns the surface. A single top divider separates its embedded conversation without adding side or bottom borders.</p>
          </header>
          <ConversationPanel {...args} />
        </Stack>
      </PageShell>
    </main>
  ),
  play: async ({ canvas }) => {
    const panel = canvas.getByRole('region', { name: 'Conversation' })
    await expect(panel).toHaveAttribute('data-chrome', 'top-divider')
    await expect(panel).toHaveClass('border-t')
    await expect(panel).not.toHaveClass('rounded-bakin-overlay')
  },
} satisfies Story

function ReadOnlyExample() {
  return (
    <main className="bakin-conversation-story">
      <PageShell width="wide">
        <Stack gap="section">
          <header className="bakin-conversation-story__intro">
            <p>Conversation / immutable history</p>
            <h1>Say why a conversation cannot change</h1>
            <p>Read-only mode replaces the entire composer with visible state copy; a missing custom explanation still has an honest default.</p>
          </header>
          <div className="bakin-conversation-story__panel-grid">
            <section aria-labelledby="readonly-default-heading" className="bakin-conversation-story__section">
              <header>
                <h2 id="readonly-default-heading">Default explanation</h2>
                <p>Safe when the host has no more specific lifecycle language.</p>
              </header>
              <ConversationPanel
                messages={panelMessages}
                agent={releaseAgent}
                onSend={() => {}}
                storageKey="storybook-readonly-default"
                title="Completed review"
                readOnly
              />
            </section>
            <section aria-labelledby="readonly-custom-heading" className="bakin-conversation-story__section">
              <header>
                <h2 id="readonly-custom-heading">Domain explanation</h2>
                <p>Prefer specific copy when archival or permission state is known.</p>
              </header>
              <ConversationPanel
                messages={panelMessages}
                agent={releaseAgent}
                onSend={() => {}}
                storageKey="storybook-readonly-custom"
                title="Archived review"
                readOnly
                readOnlyNotice="Archived after release; messages and evidence are preserved as recorded."
              />
            </section>
          </div>
        </Stack>
      </PageShell>
    </main>
  )
}

export const ReadOnlyStates = {
  args: { messages: panelMessages, onSend: () => {}, storageKey: 'storybook-readonly' },
  render: () => <ReadOnlyExample />,
  play: async ({ canvas }) => {
    await expect(canvas.getByText('This conversation is read-only.')).toBeVisible()
    await expect(canvas.getByText(/Archived after release/)).toBeVisible()
    await expect(canvas.queryByRole('textbox')).not.toBeInTheDocument()
  },
} satisfies Story

function ExactToolDetailExample() {
  const [open, setOpen] = useState(true)

  return (
    <main className="bakin-conversation-story">
      <PageShell width="content">
        <Stack gap="section">
          <header className="bakin-conversation-story__intro">
            <p>Conversation / exact evidence</p>
            <h1>Inspect captured tool evidence</h1>
            <p>The drawer preserves copyable payloads, exact status and duration, and a visible warning when storage captured only a preview.</p>
          </header>
          <Button type="button" variant="secondary" onClick={() => setOpen(true)}>Open route audit detail</Button>
          <p className="bakin-conversation-story__selection">The underlying review remains in context while exact evidence opens as a modal side surface.</p>
          <ToolCallDrawer call={toolCall} open={open} onOpenChange={setOpen} storageKey="storybook-route-audit" />
        </Stack>
      </PageShell>
    </main>
  )
}

export const ExactToolDetail = {
  args: { messages: panelMessages, onSend: () => {}, storageKey: 'storybook-tool-detail' },
  render: () => <ExactToolDetailExample />,
  play: async () => {
    const page = within(document.body)
    await waitFor(() => expect(page.getByRole('dialog', { name: 'route_audit' })).toBeVisible())
    await expect(page.getByText(/Captured output was truncated/)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Copy output' })).toBeVisible()
  },
} satisfies Story
