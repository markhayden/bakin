import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect } from 'storybook/test'

import {
  ActivityGroup,
  type ConversationToolCall,
} from '@makinbakin/sdk/conversation'
import { PageShell, Stack } from '@makinbakin/sdk/layout'

import './conversation.stories.css'

const meta = {
  title: 'Components/Conversation/Tool activity',
  component: ActivityGroup,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'ActivityGroup keeps tool use subordinate to the conversation while preserving exact call status, duration, full summaries, and an optional consumer-owned detail action.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'long-labels', 'empty', 'keyboard', 'non-color', 'reduced-motion', 'dense-data'],
  },
} satisfies Meta<typeof ActivityGroup>

export default meta
type Story = StoryObj<typeof meta>

const canonicalCalls: ConversationToolCall[] = [
  {
    key: 'canonical-search',
    callId: 'canonical-search',
    toolName: 'web_search',
    status: 'completed',
    summary: 'Found the current routing contract documentation',
    durationMs: 1240,
  },
]

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  args: { calls: canonicalCalls, defaultExpanded: false },
  argTypes: {
    defaultExpanded: { control: 'boolean' },
    // Call rows are the transcript's data; the detail action is consumer-owned.
    calls: { control: false },
    onOpenCall: { control: false },
  },
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole('button', { name: /Searched the web/ })
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(trigger)
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    await expect(canvas.getByText('Found the current routing contract documentation')).toBeVisible()
  },
} satisfies Story

const settledCalls: ConversationToolCall[] = [
  {
    key: 'search-1',
    callId: 'search-1',
    toolName: 'web_search',
    status: 'completed',
    summary: 'Found seven release notes that mention the routing contract',
    durationMs: 1240,
  },
  {
    key: 'search-2',
    callId: 'search-2',
    toolName: 'web_search',
    status: 'failed',
    summary: 'The archived documentation mirror did not respond before the request deadline',
    durationMs: 8200,
  },
  {
    key: 'search-3',
    callId: 'search-3',
    toolName: 'web_search',
    status: 'completed',
    summary: 'Verified the canonical route examples against the current public documentation',
    durationMs: 1730,
  },
]

function ActivityStates() {
  const [opened, setOpened] = useState('No call selected')

  return (
    <main className="bakin-conversation-story">
      <PageShell width="content">
        <Stack gap="section">
          <header className="bakin-conversation-story__intro">
            <p>Conversation / tool evidence</p>
            <h1>Keep activity compact without hiding what happened</h1>
            <p>One disclosure summarizes the work. Exact call rows retain visible status language and can open consumer-owned detail.</p>
          </header>

          <section aria-labelledby="mixed-activity-heading" className="bakin-conversation-story__section">
            <header>
              <h2 id="mixed-activity-heading">Settled calls with one failure</h2>
              <p>Failures remain visible in both the group summary and the exact row.</p>
            </header>
            <ActivityGroup calls={settledCalls} defaultExpanded onOpenCall={(call) => setOpened(`Opened ${call.toolName}: ${call.callId}`)} />
            <p role="status" className="bakin-conversation-story__selection">{opened}</p>
          </section>

          <section aria-labelledby="running-activity-heading" className="bakin-conversation-story__section">
            <header>
              <h2 id="running-activity-heading">Live activity</h2>
              <p>Reduced-motion users retain the visible “Running” label when animation is disabled.</p>
            </header>
            <ActivityGroup
              calls={[{
                key: 'read-1',
                callId: 'read-1',
                toolName: 'read_file',
                status: 'running',
                summary: 'Reading an exceptionally long nested path without forcing the conversation wider than its available container',
              }]}
              defaultExpanded
            />
          </section>

          <section aria-labelledby="empty-activity-heading" className="bakin-conversation-story__section bakin-conversation-story__section--quiet">
            <header>
              <h2 id="empty-activity-heading">No reported activity</h2>
              <p>An empty group says what is missing instead of inventing a successful call.</p>
            </header>
            <ActivityGroup calls={[]} />
          </section>
        </Stack>
      </PageShell>
    </main>
  )
}

export const StatesAndDisclosure = {
  args: { calls: [] },
  render: () => <ActivityStates />,
  play: async ({ canvas, userEvent }) => {
    const trigger = canvas.getByRole('button', { name: /Searched the web.*3 calls.*1 failed/i })
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    trigger.focus()
    await userEvent.keyboard('{Enter}')
    await expect(trigger).toHaveAttribute('aria-expanded', 'false')
    await userEvent.keyboard('{Enter}')
    await expect(trigger).toHaveAttribute('aria-expanded', 'true')
    const call = canvas.getByRole('button', { name: /web_search.*Found seven release notes.*completed/i })
    await userEvent.click(call)
    await expect(canvas.getByRole('status')).toHaveTextContent('Opened web_search: search-1')
    await expect(canvas.getByText('failed', { exact: true })).toBeVisible()
    await expect(canvas.getByText('No tool activity')).toBeVisible()
  },
} satisfies Story
