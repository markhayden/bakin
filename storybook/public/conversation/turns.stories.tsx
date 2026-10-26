import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, within } from 'storybook/test'

import {
  AgentTurn,
  ThinkingIndicator,
  UserMessage,
  foldConversation,
  formatQuestionAnswer,
  type ConversationMessage,
  type ConversationTurn,
} from '@makinbakin/sdk/conversation'
import type { BakinQuestion } from '@makinbakin/sdk/types'
import { PageShell, Stack } from '@makinbakin/sdk/layout'

import './conversation.stories.css'

const meta = {
  title: 'Components/Conversation/Turns and messages',
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
  argTypes: {
    // Transcript data drives the turn — there is nothing to flip; renderers
    // and handlers are consumer-owned composition.
    turn: { control: false },
    agent: { control: false },
    onRetry: { control: false },
    onOpenCall: { control: false },
    onAnswerQuestion: { control: false },
  },
  render: (args) => (
    <>
      <UserMessage
        turn={{
          kind: 'user',
          key: 'canonical-user',
          ts: '2026-07-20T12:00:00.000Z',
          content: 'Are the routing examples ready to publish?',
        }}
      />
      <AgentTurn {...args} />
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

const askedQuestion: BakinQuestion = {
  v: 1,
  id: 'q_story0000000001',
  question: 'Which inbox are we cleaning?',
  options: [
    { label: 'Just my personal Gmail', description: 'Fastest win; work mail has retention rules to check first.' },
    { label: 'Personal and work', description: 'Bigger payoff, two sets of rules.' },
    { label: 'A shared team inbox' },
  ],
  recommended: 0,
  allowOther: true,
}

const questionRow = (id: string, turnId: string): ConversationMessage => ({
  kind: 'tool',
  ts: '2026-07-20T12:00:05.000Z',
  turnId,
  callId: `call-${id}`,
  toolName: 'bakin_exec_ask_user',
  status: 'completed',
  metadata: { bakinQuestion: { ...askedQuestion, id } },
})

function agentTurnsOf(rows: ConversationMessage[], live?: ConversationMessage): Extract<ConversationTurn, { kind: 'agent' }>[] {
  const liveChunks = live && live.kind === 'tool'
    ? [{ type: 'tool' as const, data: { phase: 'result' as const, callId: live.callId, toolName: live.toolName, status: 'completed', metadata: live.metadata } }]
    : undefined
  return foldConversation(rows, liveChunks ? { liveChunks } : undefined)
    .filter((turn): turn is Extract<ConversationTurn, { kind: 'agent' }> => turn.kind === 'agent')
}

function QuestionCardStates() {
  const [sent, setSent] = useState('Nothing sent yet')
  const open = agentTurnsOf([questionRow('q_story0000000002', 'open')])[0]!
  const answered = agentTurnsOf([
    questionRow('q_story0000000003', 'answered'),
    { kind: 'user', ts: '2026-07-20T12:00:09.000Z', content: formatQuestionAnswer(askedQuestion, { kind: 'option', index: 0 }) },
  ])[0]!
  const skipped = agentTurnsOf([
    questionRow('q_story0000000004', 'skipped'),
    { kind: 'user', ts: '2026-07-20T12:00:09.000Z', content: 'Let us talk about the budget first.' },
  ])[0]!
  const streaming = agentTurnsOf([], questionRow('q_story0000000005', 'live'))[0]!

  return (
    <main className="bakin-conversation-story">
      <PageShell width="content">
        <Stack gap="section">
          <header className="bakin-conversation-story__intro">
            <p>Conversation / questions</p>
            <h1>One question, an honest recommendation</h1>
            <p>An agent asks through bakin_exec_ask_user; the card labels its recommendation without choosing for you, and the answer is an ordinary readable message.</p>
          </header>

          <section aria-labelledby="question-open-heading" className="bakin-conversation-story__section">
            <header>
              <h2 id="question-open-heading">Open and answerable</h2>
              <p>Nothing is preselected. Something else and Not sure are always available; the note is optional.</p>
            </header>
            <div className="bakin-conversation-story__transcript">
              <AgentTurn agent={mainAgent} turn={open} onAnswerQuestion={setSent} />
              <p role="status" aria-label="Sent answer" className="bakin-conversation-story__selection">{sent}</p>
            </div>
          </section>

          <section aria-labelledby="question-settled-heading" className="bakin-conversation-story__section">
            <header>
              <h2 id="question-settled-heading">Settled and in-flight</h2>
              <p>The transcript decides the state: an answer collapses the card, any other reply marks it skipped, and a still-streaming turn holds input.</p>
            </header>
            <div className="bakin-conversation-story__transcript">
              <AgentTurn agent={mainAgent} turn={answered} />
              <AgentTurn agent={mainAgent} turn={skipped} />
              <AgentTurn agent={mainAgent} turn={streaming} onAnswerQuestion={setSent} />
            </div>
          </section>

          <section aria-labelledby="question-narrow-heading" className="bakin-conversation-story__section">
            <header>
              <h2 id="question-narrow-heading">Narrow docked panel</h2>
              <p>At dock widths the note and Answer stack instead of squeezing the options.</p>
            </header>
            <div style={{ inlineSize: '320px' }}>
              <AgentTurn agent={mainAgent} turn={agentTurnsOf([questionRow('q_story0000000006', 'narrow')])[0]!} />
            </div>
          </section>
        </Stack>
      </PageShell>
    </main>
  )
}

export const QuestionCards = {
  args: { turn: canonicalTurn, agent: canonicalAgent },
  render: () => <QuestionCardStates />,
  play: async ({ canvas, userEvent }) => {
    const group = canvas.getAllByRole('radiogroup', { name: askedQuestion.question })[0]!
    for (const radio of within(group).getAllByRole('radio')) await expect(radio).toHaveAttribute('aria-checked', 'false')
    await expect(canvas.getAllByText('Recommended').length).toBeGreaterThan(0)
    await userEvent.click(within(group).getByRole('radio', { name: /Personal and work/ }))
    const form = group.closest('form')!
    await userEvent.type(within(form).getByRole('textbox', { name: 'Add a note (optional)' }), 'last year only')
    await userEvent.click(within(form).getByRole('button', { name: 'Answer' }))
    await expect(canvas.getByRole('status', { name: 'Sent answer' }))
      .toHaveTextContent('**Which inbox are we cleaning?** → Personal and work last year only')
    await expect(canvas.getByText('Skipped')).toBeVisible()
  },
} satisfies Story
