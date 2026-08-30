import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect } from 'storybook/test'

import {
  AgentTurn,
  ThinkingIndicator,
  UserMessage,
  type ConversationTurn,
} from '@makinbakin/sdk/conversation'
import { PageShell, Stack } from '@makinbakin/sdk/layout'

import './conversation.stories.css'

const meta = {
  title: 'Conversation/Turns and messages',
  component: AgentTurn,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'AgentTurn and UserMessage keep author identity, time, attachments, evidence, lifecycle, and actions consistent while consumers retain rich-text and domain behavior.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'long-labels', 'keyboard', 'non-color', 'reduced-motion', 'dense-data'],
  },
} satisfies Meta<typeof AgentTurn>

export default meta
type Story = StoryObj<typeof meta>

const canonicalAgent = { id: 'main', name: 'Main operations agent' }

const canonicalTurn: Extract<ConversationTurn, { kind: 'agent' }> = {
  kind: 'agent',
  key: 'canonical-agent',
  ts: '2026-07-20T12:01:00.000Z',
  status: 'complete',
  items: [{ type: 'text', format: 'plain', content: 'The routing examples are current and ready to publish.' }],
}

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  args: { turn: canonicalTurn, agent: canonicalAgent },
  render: () => (
    <>
      <UserMessage
        turn={{
          kind: 'user',
          key: 'canonical-user',
          ts: '2026-07-20T12:00:00.000Z',
          content: 'Are the routing examples ready to publish?',
        }}
      />
      <AgentTurn agent={canonicalAgent} turn={canonicalTurn} />
    </>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('article', { name: 'Your message' })).toBeVisible()
    await expect(canvas.getByRole('article', { name: 'Main operations agent reply' })).toBeVisible()
    await expect(canvas.getByText('The routing examples are current and ready to publish.')).toBeVisible()
  },
} satisfies Story

const mainAgent = { id: 'main', name: 'Main operations agent' }

const completeTurn: Extract<ConversationTurn, { kind: 'agent' }> = {
  kind: 'agent',
  key: 'agent-complete',
  ts: '2026-07-20T12:01:00.000Z',
  status: 'complete',
  items: [
    { type: 'text', format: 'markdown', content: 'The routing contract is current. Two archived examples still need owners before release.' },
    {
      type: 'activity',
      calls: [{
        key: 'search-routes',
        callId: 'search-routes',
        toolName: 'web_search',
        status: 'completed',
        summary: 'Compared the public route catalog with all current examples',
        durationMs: 1840,
      }],
    },
  ],
}

function TurnStates() {
  const [outcome, setOutcome] = useState('No action taken')

  return (
    <main className="bakin-conversation-story">
      <PageShell width="content">
        <Stack gap="section">
          <header className="bakin-conversation-story__intro">
            <p>Conversation / turns</p>
            <h1>Keep the speaker and state unmistakable</h1>
            <p>Identity, evidence, errors, and message actions retain stable places across complete and in-flight work.</p>
          </header>

          <section aria-labelledby="exchange-heading" className="bakin-conversation-story__section">
            <header>
              <h2 id="exchange-heading">A complete exchange</h2>
              <p>User attachments stay attached to the request; agent evidence stays inside the reply.</p>
            </header>
            <div className="bakin-conversation-story__transcript">
              <UserMessage
                turn={{
                  kind: 'user',
                  key: 'user-complete',
                  ts: '2026-07-20T12:00:00.000Z',
                  content: 'Check whether the routing examples are ready to publish, including the exceptionally long compatibility appendix.',
                  attachments: [
                    {
                      name: 'route-map.png',
                      mimeType: 'image/png',
                      url: 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="240" height="120" viewBox="0 0 240 120"%3E%3Crect width="240" height="120" fill="%23262125"/%3E%3Cpath d="M24 82h48l32-46 36 60 34-44h42" fill="none" stroke="%23ff2c8b" stroke-width="6"/%3E%3C/svg%3E',
                    },
                    { name: 'routing-compatibility-appendix.pdf', mimeType: 'application/pdf', url: '#routing-appendix' },
                  ],
                }}
              />
              <AgentTurn agent={mainAgent} turn={completeTurn} />
            </div>
          </section>

          <section aria-labelledby="lifecycle-heading" className="bakin-conversation-story__section">
            <header>
              <h2 id="lifecycle-heading">Lifecycle remains visible</h2>
              <p>Reduced motion removes animation, not the words that distinguish live, stopped, and failed work.</p>
            </header>
            <div className="bakin-conversation-story__transcript">
              <ThinkingIndicator agent={{ id: 'reviewer', name: 'Release reviewer' }} label="checking compatibility" />
              <AgentTurn
                agent={mainAgent}
                turn={{
                  kind: 'agent',
                  key: 'agent-aborted',
                  ts: '2026-07-20T12:02:00.000Z',
                  status: 'aborted',
                  items: [{ type: 'text', format: 'plain', content: 'Stopped before modifying any release files.' }],
                }}
              />
              <AgentTurn
                agent={mainAgent}
                turn={{
                  kind: 'agent',
                  key: 'agent-error',
                  ts: '2026-07-20T12:03:00.000Z',
                  status: 'error',
                  items: [{ type: 'error', message: 'The archived route catalog could not be reached.', errorKind: 'archive_unavailable' }],
                }}
                onRetry={() => setOutcome('Retry requested')}
              />
              <p role="status" aria-label="Selection outcome" className="bakin-conversation-story__selection">{outcome}</p>
            </div>
          </section>
        </Stack>
      </PageShell>
    </main>
  )
}

export const CompleteAndLifecycleStates = {
  args: { turn: completeTurn, agent: mainAgent },
  render: () => <TurnStates />,
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByRole('article', { name: 'Your message' })).toBeVisible()
    await expect(canvas.getAllByRole('article', { name: 'Main operations agent reply' })).toHaveLength(3)
    await expect(canvas.getByRole('link', { name: 'routing-compatibility-appendix.pdf' })).toBeVisible()
    await expect(canvas.getByText('checking compatibility…')).toBeVisible()
    await expect(canvas.getByText('Stopped')).toBeVisible()
    const retry = canvas.getByRole('button', { name: 'Try again' })
    retry.focus()
    await userEvent.keyboard('{Enter}')
    // Named on purpose: a replayed error row is a polite status region too,
    // so a bare role query would match both.
    await expect(canvas.getByRole('status', { name: 'Selection outcome' })).toHaveTextContent('Retry requested')
  },
} satisfies Story
