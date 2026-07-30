import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect } from 'storybook/test'

import { Grid, PageShell } from '@makinbakin/sdk/layout'
import {
  ConversationPage,
  ConversationPageBody,
  ConversationPageComposer,
  ConversationPageTimeline,
  InspectorPanel,
  InspectorPanelContent,
  InspectorPanelFooter,
  InspectorPanelHeader,
  PageHeader,
} from '@makinbakin/sdk/patterns'
import {
  Badge,
  Banner,
  Button,
  Input,
  Label,
  SystemState,
  Textarea,
} from '@makinbakin/sdk/ui'

import './conversation-inspector-pages.stories.css'

const meta = {
  title: 'Recipes/Conversation and inspector pages',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'ConversationPage defines document versus explicitly contained timeline scrolling. Routed first-party application conversations use the full host content width by default; narrower widths are reserved for deliberately reading-focused surfaces and require a concrete explanation. InspectorPanel defines contextual header/content/footer hierarchy beside a canvas or inside BakinDrawer. Domain rendering and behavior remain outside these recipes.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'overflow', 'interaction', 'system-states', 'scroll-ownership', 'url-state-guidance'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const initialMessages = [
  {
    id: 1,
    author: 'Mark',
    time: '10:42',
    body: 'Draft a launch update using the approved hero asset and current delivery status.',
  },
  {
    id: 2,
    author: 'Patch',
    time: '10:42',
    body: 'I found the approved asset and matched it to the video publishing workflow.',
    tool: 'tool:assets.search · completed in 184 ms',
  },
]

function ConversationExample() {
  const [messages, setMessages] = useState(initialMessages)
  const [value, setValue] = useState('')

  const send = () => {
    const body = value.trim()
    if (!body) return
    setMessages((current) => [
      ...current,
      { id: current.length + 1, author: 'Mark', time: '10:43', body },
    ])
    setValue('')
  }

  return (
    <ConversationPage
      mode="contained"
      width="full"
      className="bakin-conversation-inspector-story"
    >
      <PageHeader
        eyebrow="Chat / active thread"
        title="Conversation with Patch"
        description="Messages, tool activity, streaming feedback, and composition keep one readable hierarchy."
        meta={(
          <>
            <Badge tone="success">Connected</Badge>
            <code>thread:01JZ9T4P6KE7</code>
          </>
        )}
        actions={<Button variant="outline">Thread details</Button>}
      />
      <ConversationPageBody
        mode="contained"
        className="bakin-conversation-inspector-story__conversation"
        feedback={(
          <Banner
            tone="info"
            headingLevel={2}
            title="Live context"
            description="Patch is using provider/openai/gpt-5.2 with 41% of the context window."
          />
        )}
      >
        <ConversationPageTimeline label="Conversation with Patch">
          {messages.map((message) => (
            <article
              key={message.id}
              className="bakin-conversation-inspector-story__message"
              data-author={message.author === 'Patch' ? 'assistant' : 'user'}
              aria-label={`${message.author} message at ${message.time}`}
            >
              <header>
                <strong>{message.author}</strong>
                <time>{message.time}</time>
              </header>
              <p>{message.body}</p>
              {message.tool ? (
                <div className="bakin-conversation-inspector-story__tool">
                  <Badge tone="accent" variant="outline">{message.tool}</Badge>
                  <code>selected=asset:campaign/spring-hero-final-v18.webp</code>
                </div>
              ) : null}
            </article>
          ))}
          <div className="bakin-conversation-inspector-story__streaming" role="status">
            <span aria-hidden="true" />
            <p>
              <strong>Patch is responding</strong>
              <br />
              Reconciling workflow status with the selected asset.
            </p>
          </div>
        </ConversationPageTimeline>
        <ConversationPageComposer>
          <div className="bakin-conversation-inspector-story__composer-field">
            <Label htmlFor="conversation-message">Message Patch</Label>
            <Textarea
              id="conversation-message"
              value={value}
              onChange={(event) => setValue(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  send()
                }
              }}
              placeholder="Ask a follow-up"
            />
          </div>
          <div className="bakin-conversation-inspector-story__composer-actions">
            <span>Enter to send · Shift+Enter is owned by the focused composer</span>
            <Button disabled={!value.trim()} onClick={send}>Send message</Button>
          </div>
        </ConversationPageComposer>
      </ConversationPageBody>
    </ConversationPage>
  )
}

export const Conversation = {
  render: () => <ConversationExample />,
  play: async ({ canvas, userEvent }) => {
    const composer = canvas.getByRole('textbox', { name: 'Message Patch' })
    await userEvent.type(composer, 'Keep the review gate.')
    await userEvent.keyboard('{Enter}')
    await expect(canvas.getByRole('log')).toHaveTextContent('Keep the review gate.')
  },
} satisfies Story

export const ConversationUnavailable = {
  render: () => (
    <ConversationPage className="bakin-conversation-inspector-story">
      <PageHeader
        eyebrow="Chat / archived thread"
        title="Conversation with Patch"
        description="Thread identity remains visible when access changes."
      />
      <ConversationPageBody
        state={(
          <SystemState
            kind="permission-denied"
            title="Conversation history is restricted"
            description="Your workspace role can see this thread's identity but cannot read its messages."
            action={<Button variant="outline">Request access</Button>}
          />
        )}
      />
    </ConversationPage>
  ),
} satisfies Story

function InspectorExample() {
  const [label, setLabel] = useState('Assemble social video')
  const [applied, setApplied] = useState(false)

  return (
    <PageShell width="wide" className="bakin-conversation-inspector-story">
      <PageHeader
        eyebrow="Workflow / contextual inspection"
        title="Launch publishing workflow"
        description="Selection and inspection stay distinct from the canvas interaction model."
      />
      <Grid layout="main-aside" gap="section" align="start">
        <section
          className="bakin-conversation-inspector-story__canvas"
          aria-labelledby="workflow-canvas-heading"
        >
          <h2 id="workflow-canvas-heading">Workflow canvas</h2>
          <p>
            The real workflow recipe retains React Flow, keyboard movement, and explicit
            vertical or horizontal orientation.
          </p>
          <Button aria-pressed="true">Assemble social video</Button>
        </section>
        <InspectorPanel label="Assemble social video node inspector">
          <InspectorPanelHeader
            eyebrow="Transform node"
            title="Assemble social video"
            description="Selected at y 165"
            actions={(
              <Button size="sm" variant="ghost" aria-label="Close node inspector">
                Close
              </Button>
            )}
          />
          <InspectorPanelContent
            feedback={applied ? (
              <Banner tone="success" headingLevel={3} title="Node updated" />
            ) : undefined}
          >
            <div className="bakin-conversation-inspector-story__field">
              <Label htmlFor="node-label">Display name</Label>
              <Input
                id="node-label"
                value={label}
                onChange={(event) => {
                  setLabel(event.currentTarget.value)
                  setApplied(false)
                }}
              />
            </div>
            <dl className="bakin-conversation-inspector-story__facts">
              <div><dt>Step ID</dt><dd><code>assemble-video</code></dd></div>
              <div><dt>Input</dt><dd>Approved campaign asset</dd></div>
              <div><dt>Output</dt><dd>Reviewable social cut</dd></div>
            </dl>
          </InspectorPanelContent>
          <InspectorPanelFooter>
            <Button variant="outline">Delete node</Button>
            <Button onClick={() => setApplied(true)}>Apply changes</Button>
          </InspectorPanelFooter>
        </InspectorPanel>
      </Grid>
    </PageShell>
  )
}

export const Inspector = {
  render: () => <InspectorExample />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Apply changes' }))
    await expect(canvas.getByText('Node updated')).toBeVisible()
  },
} satisfies Story

export const InspectorUnavailable = {
  render: () => (
    <PageShell width="content" className="bakin-conversation-inspector-story">
      <PageHeader eyebrow="Workflow / inspection" title="Unknown workflow node" />
      <InspectorPanel label="Unknown node inspector">
        <InspectorPanelHeader
          title="Unsupported node"
          actions={<Button size="sm" variant="ghost">Close</Button>}
        />
        <InspectorPanelContent
          state={(
            <SystemState
              kind="error"
              recovery="unavailable"
              title="This node cannot be inspected"
              description="Its contributing plugin is not active. The preserved step can still be removed."
            />
          )}
        />
        <InspectorPanelFooter>
          <Button variant="danger">Delete preserved step</Button>
        </InspectorPanelFooter>
      </InspectorPanel>
    </PageShell>
  ),
} satisfies Story
