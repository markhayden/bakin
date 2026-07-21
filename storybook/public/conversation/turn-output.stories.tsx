import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'

import {
  TurnOutputView,
  type ConversationChunk,
} from '@makinbakin/sdk/conversation'
import { MarkdownContent } from '@makinbakin/sdk/content'
import { PageShell, Stack } from '@makinbakin/sdk/layout'

import './conversation.stories.css'

const meta = {
  title: 'Conversation/Single-turn output',
  component: TurnOutputView,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'TurnOutputView is the compact single-turn composition for task and workflow embeds. It shares conversation folding and tool rows while rich text remains an opt-in consumer concern.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'keyboard', 'non-color', 'reduced-motion', 'streaming', 'error', 'long-content', 'overflow', 'dense-data'],
  },
} satisfies Meta<typeof TurnOutputView>

export default meta
type Story = StoryObj<typeof meta>

const completedChunks: ConversationChunk[] = [
  { type: 'status', content: 'checking the routing contract' },
  { type: 'tool', data: { phase: 'call', callId: 'read-routes', toolName: 'read_file', summary: 'Read the canonical route plan and compatibility appendix' } },
  { type: 'tool', data: { phase: 'result', callId: 'read-routes', toolName: 'read_file', status: 'completed' } },
  { type: 'tool', data: { phase: 'result', callId: 'archive', toolName: 'web_fetch', status: 'failed', summary: 'The archived documentation mirror timed out' } },
  { type: 'text', format: 'markdown', content: 'The **recent routing work remains authoritative**. Keep filters in the existing URL contract and migrate only the presentation shell.' },
  { type: 'text', format: 'code', content: 'plugin/routes/compatibility/a-deliberately-long-path-that-must-scroll-inside-the-output-rather-than-widen-the-page.ts' },
  { type: 'done' },
]

function SingleTurnStates() {
  return (
    <main className="bakin-conversation-story">
      <PageShell width="content">
        <Stack gap="section">
          <header className="bakin-conversation-story__intro">
            <p>Tasks and workflows / one turn</p>
            <h1>Show output evidence without rebuilding conversation UI</h1>
            <p>Task drawers and workflow steps can share normalized folding, exact tool state, bounded code, live status, and typed failures.</p>
          </header>

          <section aria-labelledby="completed-output-heading" className="bakin-conversation-story__section">
            <header>
              <h2 id="completed-output-heading">Completed output with opt-in Markdown</h2>
              <p>The consumer deliberately composes the heavy content entrypoint; the conversation entrypoint stays isolated.</p>
            </header>
            <div className="bakin-conversation-story__transcript">
              <TurnOutputView
                chunks={completedChunks}
                renderText={(content, format) => format === 'markdown'
                  ? <MarkdownContent content={content} />
                  : (
                    <pre
                      role="region"
                      tabIndex={0}
                      aria-label="Code output"
                      className="max-w-full overflow-x-auto rounded-bakin-surface border border-bakin-border-subtle bg-bakin-surface-default p-bakin-3 font-bakin-typography-family-mono text-[length:var(--bakin-typography-size-meta)] leading-relaxed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-bakin-focus-ring"
                    >
                      {content}
                    </pre>
                  )}
              />
            </div>
          </section>

          <section aria-labelledby="lifecycle-output-heading" className="bakin-conversation-story__section">
            <header>
              <h2 id="lifecycle-output-heading">Live and terminal states</h2>
              <p>Reduced motion removes the spinner animation, not the status language.</p>
            </header>
            <div className="bakin-conversation-story__examples">
              <div className="bakin-conversation-story__transcript">
                <TurnOutputView chunks={[{ type: 'status', content: 'waiting for the publishing agent' }]} live />
              </div>
              <div className="bakin-conversation-story__transcript">
                <TurnOutputView chunks={[{ type: 'error', content: 'The workflow session ended before output arrived.', data: { kind: 'session_died' } }]} />
              </div>
            </div>
          </section>
        </Stack>
      </PageShell>
    </main>
  )
}

export const EmbeddedOutputStates = {
  args: { chunks: completedChunks },
  render: () => <SingleTurnStates />,
  play: async ({ canvas }) => {
    await expect(canvas.getByText('recent routing work remains authoritative')).toBeVisible()
    await expect(canvas.getByText('failed')).toBeVisible()
    await expect(canvas.getByRole('status')).toHaveTextContent('waiting for the publishing agent…')
    await expect(canvas.getByRole('alert')).toHaveTextContent('session_died')
  },
} satisfies Story
