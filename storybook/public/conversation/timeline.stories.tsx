import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect } from 'storybook/test'

import {
  Conversation,
  ConversationEmptyState,
  foldConversation,
  type ConversationTurn,
} from '@makinbakin/sdk/conversation'
import {
  Page,
  PageBody,
  PageHeader,
  PageTimeline,
} from '@makinbakin/sdk/patterns'

import './conversation.stories.css'

const meta = {
  title: 'Components/Conversation/Timeline and empty state',
  component: Conversation,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Conversation renders ordered turns and day boundaries. Document scroll is the product default. Use contained mode only for an explicitly bounded standalone surface; inside a Page, leave Conversation in document mode so PageTimeline remains the single named log scroller.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'long-labels', 'empty', 'keyboard', 'non-color', 'reduced-motion', 'scroll-ownership', 'dense-data'],
  },
} satisfies Meta<typeof Conversation>

export default meta
type Story = StoryObj<typeof meta>

const canonicalAgent = { id: 'release', name: 'Release agent' }

const canonicalTurns: ConversationTurn[] = [
  {
    kind: 'user',
    key: 'canonical-user',
    ts: '2026-01-15T11:58:00.000Z',
    content: 'Is the routing guide ready to publish?',
  },
  {
    kind: 'agent',
    key: 'canonical-agent',
    ts: '2026-01-15T11:59:00.000Z',
    status: 'complete',
    items: [{ type: 'text', format: 'plain', content: 'Yes. The route contract is preserved and every example is current.' }],
  },
]

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  args: { turns: canonicalTurns, agent: canonicalAgent },
  argTypes: {
    mode: { control: 'select', options: ['document', 'contained'] },
    // Transcript data, identity lookup, and renderers are consumer-owned.
    turns: { control: false },
    agent: { control: false },
    resolveAgent: { control: false },
    emptyState: { control: false },
  },
  render: (args) => <Conversation {...args} />,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('article', { name: 'Your message' })).toBeVisible()
    await expect(canvas.getByRole('article', { name: 'Release agent reply' })).toBeVisible()
    await expect(canvas.getByText('Yes. The route contract is preserved and every example is current.')).toBeVisible()
  },
} satisfies Story

const releaseAgent = { id: 'release', name: 'Release agent' }

const documentTurns: ConversationTurn[] = [
  {
    kind: 'user',
    key: 'document-user-1',
    ts: '2026-01-14T16:20:00.000Z',
    content: 'Check the route migration plan before we publish the builder guide.',
  },
  {
    kind: 'agent',
    key: 'document-agent-1',
    ts: '2026-01-14T16:21:00.000Z',
    agentId: 'release',
    status: 'complete',
    items: [
      {
        type: 'text',
        format: 'markdown',
        content: 'The plan keeps filters in the URL and preserves the existing route contract. I found one archived example that still needs an owner.',
      },
      {
        type: 'activity',
        calls: [{
          key: 'route-audit',
          callId: 'route-audit',
          toolName: 'route_audit',
          status: 'completed',
          summary: 'Compared 268 documented routes with the current catalog',
          durationMs: 1840,
        }],
      },
    ],
  },
  {
    kind: 'user',
    key: 'document-user-2',
    ts: '2026-01-15T11:58:00.000Z',
    content: 'Keep that exception visible and assign it before release.',
  },
  {
    kind: 'agent',
    key: 'document-agent-2',
    ts: '2026-01-15T11:59:00.000Z',
    agentId: 'release',
    status: 'streaming',
    statusLabel: 'updating the release checklist',
    items: [{
      type: 'text',
      format: 'markdown',
      content: 'Added the exception to the release evidence and kept the current route as the source of truth.',
    }],
  },
]

const containedTurns: ConversationTurn[] = Array.from({ length: 8 }, (_, index) => (
  index % 2 === 0
    ? {
        kind: 'user' as const,
        key: `contained-user-${index}`,
        ts: `2026-01-15T11:${String(10 + index).padStart(2, '0')}:00.000Z`,
        content: index === 0
          ? 'Summarize the compatibility constraints for this embedded review.'
          : `Follow-up ${index / 2}: keep the existing route behavior explicit.`,
      }
    : {
        kind: 'agent' as const,
        key: `contained-agent-${index}`,
        ts: `2026-01-15T11:${String(10 + index).padStart(2, '0')}:00.000Z`,
        agentId: 'release',
        status: 'complete' as const,
        items: [{
          type: 'text' as const,
          format: 'markdown' as const,
          content: 'This bounded transcript owns one local scroller. The surrounding page and its routing state remain untouched.',
        }],
      }
))

function DocumentTimelineExample() {
  return (
    <main className="bakin-conversation-story">
      <Page width="standard">
        <PageHeader
          eyebrow="Conversation / product default"
          title="Review the release plan"
          description="The host document owns vertical scrolling. The named timeline supplies log semantics without introducing a second scroll region."
        />
        <PageBody gap="content">
          <PageTimeline label="Release plan review">
            <Conversation
              turns={documentTurns}
              agent={releaseAgent}
              resolveAgent={(agentId) => agentId === releaseAgent.id ? releaseAgent : undefined}
            />
          </PageTimeline>
        </PageBody>
      </Page>
    </main>
  )
}

export const DocumentTimeline = {
  args: { turns: documentTurns },
  render: () => <DocumentTimelineExample />,
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('log', { name: 'Release plan review' })).toBeVisible()
    await expect(canvas.getAllByRole('article', { name: 'Your message' })).toHaveLength(2)
    await expect(canvas.getAllByRole('article', { name: 'Release agent reply' })).toHaveLength(2)
    await expect(canvas.getByText('updating the release checklist…')).toBeVisible()
  },
} satisfies Story

function ContainedAndEmptyExample() {
  const [selection, setSelection] = useState('No starter selected')

  return (
    <main className="bakin-conversation-story">
      <Page>
        <PageHeader
          eyebrow="Conversation / explicit alternatives"
          title="Bounded history and a useful starting point"
          description="Contained scrolling is deliberate and local. Empty prompts become controls only when the consumer provides an action."
        />
        <div className="bakin-conversation-story__examples">
          <section aria-labelledby="contained-heading" className="bakin-conversation-story__section">
            <header>
              <h2 id="contained-heading">Contained transcript</h2>
              <p>Use this mode for a panel with a real height boundary, never as a nested page scroller.</p>
            </header>
            <div className="bakin-conversation-story__contained">
              <Conversation turns={containedTurns} mode="contained" agent={releaseAgent} />
            </div>
          </section>

          <section aria-labelledby="empty-heading" className="bakin-conversation-story__section">
            <header>
              <h2 id="empty-heading">No messages yet</h2>
              <p>Give builders a clear first move without implying that any work already happened.</p>
            </header>
            <div className="bakin-conversation-story__empty">
              <Conversation
                turns={[]}
                emptyState={(
                  <ConversationEmptyState
                    title="Start a release review"
                    description="Ask about readiness, blocked routes, or remaining migration evidence."
                    suggestions={['Check blocked routes', 'Summarize release evidence']}
                    onSuggestion={setSelection}
                  />
                )}
              />
            </div>
            <p role="status" className="bakin-conversation-story__selection">{selection}</p>
          </section>
        </div>
      </Page>
    </main>
  )
}

export const ContainedAndEmptyStates = {
  args: { turns: containedTurns, mode: 'contained' },
  render: () => <ContainedAndEmptyExample />,
  play: async ({ canvas, userEvent }) => {
    const target = canvas.getByText('Follow-up 2: keep the existing route behavior explicit.')
      .closest('[data-conv-user]')?.parentElement
    const scroller = target?.closest('[data-conv-scroller]')
    await expect(scroller).toHaveClass(/overflow-y-auto/)
    await userEvent.click(canvas.getByRole('button', { name: 'Check blocked routes' }))
    await expect(canvas.getByRole('status')).toHaveTextContent('Check blocked routes')
    if (scroller instanceof HTMLElement && target instanceof HTMLElement) {
      scroller.scrollTop = 0
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }))
    }
    await expect(await canvas.findByRole('button', { name: 'Jump to latest' })).toBeVisible()
  },
} satisfies Story

const planProject = { kind: 'projects:project', id: 'spring-launch', title: 'Spring launch plan', action: 'created' as const }
const chatTurns = foldConversation([
  { kind: 'user', ts: '2026-01-14T16:20:00.000Z', content: 'Plan the spring launch with me.' },
  { kind: 'tool', ts: '2026-01-14T16:20:04.000Z', turnId: 'turn-1', toolName: 'bakin_exec_projects_create', status: 'completed', summary: 'Spring launch plan', metadata: { bakinEntities: [planProject] } },
  { kind: 'assistant', ts: '2026-01-14T16:20:06.000Z', turnId: 'turn-1', content: 'I set up a project for it. We can shape the brief there.' },
  { kind: 'handoff', ts: '2026-01-14T16:20:07.000Z', handoffId: 'chat-1:turn-1', direction: 'out', peers: [{ entity: 'projects:project', id: 'spring-launch', title: 'Spring launch plan' }] },
])
const projectTurns = foldConversation([
  { kind: 'handoff', ts: '2026-01-14T16:20:07.000Z', handoffId: 'chat-1:turn-1:spring-launch', direction: 'in', peers: [{ entity: 'chat:chat', id: 'chat-1', title: 'Spring launch planning' }], carried: 2 },
  { kind: 'user', ts: '2026-01-14T16:20:00.000Z', content: 'Plan the spring launch with me.' },
  { kind: 'assistant', ts: '2026-01-14T16:20:06.000Z', turnId: 'turn-1', content: 'I set up a project for it. We can shape the brief there.' },
  { kind: 'user', ts: '2026-01-14T16:24:00.000Z', content: 'Start with who it is for.' },
])

function HandOffExample() {
  // In the app, the host resolves each kind to its label, icon and link for
  // every conversation surface, so the card and the divider's title are
  // links. Standing alone, as here, they render as plain content.
  return (
      <main className="bakin-conversation-story bakin-conversation-story--document">
        <Page width="standard">
          <PageHeader
            eyebrow="Conversation / hand-off"
            title="A chat that became a project"
            description="When a reply creates something that owns a conversation, the chat's history is carried there. Each end keeps a marker linking to the other."
          />
          <PageBody gap="content">
            <section aria-labelledby="handoff-source" className="bakin-conversation-story__section">
              <header>
                <h2 id="handoff-source">In the chat</h2>
                <p>The reply's card, then where the conversation continued.</p>
              </header>
              <PageTimeline label="The original chat">
                <Conversation turns={chatTurns} agent={releaseAgent} />
              </PageTimeline>
            </section>
            <section aria-labelledby="handoff-target" className="bakin-conversation-story__section">
              <header>
                <h2 id="handoff-target">In the project</h2>
                <p>The carried history sits under a divider; new messages follow it.</p>
              </header>
              <PageTimeline label="The project conversation">
                <Conversation turns={projectTurns} agent={releaseAgent} />
              </PageTimeline>
            </section>
          </PageBody>
        </Page>
      </main>
  )
}

export const HandOff = {
  args: { turns: chatTurns },
  render: () => <HandOffExample />,
  play: async ({ canvas }) => {
    // Source: the reply's card, then a "continued here" card for the target.
    await expect(canvas.getByRole('list', { name: 'Created and updated' })).toHaveTextContent('Project · Created')
    const continued = canvas.getByRole('list', { name: 'Continued in' })
    await expect(continued).toHaveTextContent('Spring launch plan')
    await expect(continued).toHaveTextContent('Project · Continued here')
    // Target: a divider naming the chat the history came from.
    await expect(canvas.getByRole('note')).toHaveTextContent('Carried over from the chat Spring launch planning')
    // The carried turns render as ordinary turns, followed by the new message.
    await expect(canvas.getByText('Start with who it is for.')).toBeVisible()
  },
} satisfies Story
