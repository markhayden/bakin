import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { expect } from 'storybook/test'

import {
  Action,
  CandidateDirection,
  CandidateIntro,
  CandidateStyles,
  Grid,
  Inline,
  PageShell,
  Section,
  Stack,
  Status,
  SystemState,
  TextAreaField,
  type DirectionId,
} from './candidate-ui'
import { WorkflowCanvas, WORKFLOW_GRAPH_CSS, type WorkflowOrientation } from './workflow-graph'

const CONVERSATION_WORKFLOW_CSS = `
.bakin-composite-header { display: grid; gap: var(--candidate-item-gap); }
.bakin-composite-header__eyebrow { margin: var(--bakin-layout-space-0); color: var(--bakin-color-signal-accent); font-size: var(--candidate-meta-size); font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; }
.bakin-composite-header h2 { max-width: 23ch; margin: var(--bakin-layout-space-0); overflow-wrap: anywhere; font-size: var(--candidate-page-title-size); font-weight: 600; line-height: 1.04; letter-spacing: -0.035em; }
.bakin-composite-header p { max-width: 66ch; margin: var(--bakin-layout-space-0); color: var(--bakin-color-text-muted); line-height: 1.55; }
.bakin-conversation { display: grid; gap: var(--candidate-section-gap); min-width: 0; }
.bakin-conversation__stream { display: grid; gap: var(--candidate-item-gap); max-height: 32rem; overflow-y: auto; overscroll-behavior: contain; padding-right: var(--bakin-layout-space-2); }
.bakin-message { display: grid; gap: var(--candidate-item-gap); min-width: 0; padding: var(--candidate-section-gap) var(--bakin-layout-space-0); border-top: 1px solid var(--bakin-color-border-subtle); }
.bakin-message[data-kind='assistant'] { border-left: 2px solid var(--bakin-color-signal-accent); padding-left: var(--candidate-section-gap); }
.bakin-message__meta { display: flex; flex-wrap: wrap; justify-content: space-between; gap: var(--candidate-item-gap); color: var(--bakin-color-text-muted); font-size: var(--candidate-meta-size); }
.bakin-message__meta strong { color: var(--bakin-color-text-primary); }
.bakin-message p { margin: var(--bakin-layout-space-0); overflow-wrap: anywhere; line-height: 1.6; }
.bakin-message code, .bakin-tool-activity code, .bakin-inspector code { overflow-wrap: anywhere; color: var(--bakin-color-text-muted); font-family: var(--candidate-font-mono); font-size: var(--candidate-meta-size); }
.bakin-tool-activity { display: grid; gap: var(--candidate-item-gap); min-width: 0; border-block: 1px solid var(--bakin-color-border-subtle); padding-block: var(--candidate-item-gap); }
.bakin-tool-activity__details { display: grid; gap: var(--bakin-layout-space-2); padding-left: var(--candidate-section-gap); }
.bakin-tool-activity__details p { color: var(--bakin-color-text-muted); font-size: var(--candidate-meta-size); }
.bakin-composer { display: grid; gap: var(--candidate-item-gap); position: sticky; bottom: var(--bakin-layout-space-0); min-width: 0; padding-top: var(--candidate-section-gap); border-top: 1px solid var(--bakin-color-border-subtle); background: var(--bakin-color-surface-default); }
.bakin-streaming { position: relative; }
.bakin-streaming .bakin-system-state__signal { animation: bakin-stream-pulse 1.2s var(--bakin-motion-easing-standard) infinite; }
@keyframes bakin-stream-pulse { 0%, 100% { opacity: 0.42; } 50% { opacity: 1; } }
.bakin-mobile-switcher { display: grid; gap: var(--candidate-section-gap); }
.bakin-mobile-switcher__views { min-width: 0; }
.bakin-reduced-motion-note { display: grid; gap: var(--candidate-section-gap); padding: var(--candidate-page-gap); }
.bakin-reduced-motion-note h2 { margin: var(--bakin-layout-space-0); font-size: var(--candidate-page-title-size); line-height: 1.05; }
.bakin-reduced-motion-note p { margin: var(--bakin-layout-space-0); color: var(--bakin-color-text-muted); line-height: 1.55; }
@media (max-width: 24rem) {
  .bakin-conversation__stream { max-height: 24rem; }
  .bakin-composer .bakin-inline .bakin-action { flex: 1 1 auto; }
  .bakin-mobile-switcher__tabs .bakin-action { flex: 1 1 40%; }
}
@media (prefers-reduced-motion: reduce) {
  .bakin-streaming .bakin-system-state__signal { animation: none; opacity: 1; }
}
`.trim()

const SPECIMEN_CSS = `${CONVERSATION_WORKFLOW_CSS}\n${WORKFLOW_GRAPH_CSS}`

interface ConversationMessage {
  id: string
  kind: 'user' | 'assistant'
  author: string
  time: string
  body: string
}

const initialMessages: ConversationMessage[] = [
  { id: 'm1', kind: 'user', author: 'Mark', time: '10:42', body: 'Draft a launch update for the spring campaign using the approved hero asset and latest delivery status.' },
  { id: 'm2', kind: 'assistant', author: 'Patch', time: '10:42', body: 'I found asset:campaign/spring-hero-final-v18.webp and matched it to workflow://video-social-post/assemble-video.' },
]

function Message({ message, children }: { message: ConversationMessage; children?: ReactNode }) {
  return (
    <article className="bakin-message" data-kind={message.kind} aria-label={`${message.author} message at ${message.time}`}>
      <header className="bakin-message__meta"><strong>{message.author}</strong><span>{message.time}</span></header>
      <p>{message.body}</p>
      {children}
    </article>
  )
}

function ToolActivity() {
  const [open, setOpen] = useState(true)
  return (
    <div className="bakin-tool-activity">
      <Inline align="between"><Status tone="accent">tool:assets.search · completed in 184 ms</Status><Action aria-expanded={open} onClick={() => setOpen((value) => !value)}>{open ? 'Hide tool details' : 'Show tool details'}</Action></Inline>
      {open && <Stack gap="item" className="bakin-tool-activity__details"><code>query="spring hero approved" · results=3 · selected=asset:campaign/spring-hero-final-v18.webp</code><p>The tool result stays visually subordinate to the assistant response and remains keyboard-toggleable.</p></Stack>}
    </div>
  )
}

function Composer({ onSend }: { onSend: (message: string) => void }) {
  const [value, setValue] = useState('')
  const sendCurrent = () => {
    const message = value.trim()
    if (!message) return
    onSend(message)
    setValue('')
  }
  return (
    <div className="bakin-composer">
      <TextAreaField
        label="Message Patch"
        description="Enter sends when the composer is focused; Shift+Enter adds a line."
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            sendCurrent()
          }
        }}
        optional
      />
      <Inline align="between"><span className="bakin-workflow-status">provider/openai/gpt-5.2 · 41% context</span><Action tone="primary" disabled={!value.trim()} onClick={sendCurrent}>Send message</Action></Inline>
    </div>
  )
}

function ConversationStream() {
  const [messages, setMessages] = useState(initialMessages)
  const send = (body: string) => setMessages((current) => [...current, { id: `m${current.length + 1}`, kind: 'user', author: 'Mark', time: '10:43', body }])
  return (
    <div className="bakin-conversation">
      <div className="bakin-conversation__stream" role="log" aria-label="Conversation with Patch" aria-live="polite">
        {messages.map((message, index) => <Message key={message.id} message={message}>{index === 1 && <ToolActivity />}</Message>)}
        <SystemState kind="loading" title="Streaming response" description="Patch is reconciling workflow status with the selected asset. Existing content remains readable." />
      </div>
      <Composer onSend={send} />
    </div>
  )
}

function CompositeDirection({ direction }: { direction: DirectionId }) {
  return (
    <CandidateDirection direction={direction}>
      <PageShell>
        <header className="bakin-composite-header"><p className="bakin-composite-header__eyebrow">Conversation / workflow action</p><h2>Turn campaign intent into a reviewable publishing workflow</h2><p>Conversation and workflow keep separate interaction models while sharing hierarchy, controls, system states, and technical typography.</p></header>
        <Grid columns={1}>
          <Section title="Conversation" description="Streamed messages, tool activity, and the composer remain readable at operational density."><ConversationStream /></Section>
          <Section title="Workflow" description="Selection, inspection, and movement are fully operable without a pointer drag."><WorkflowCanvas /></Section>
        </Grid>
      </PageShell>
    </CandidateDirection>
  )
}

function MobileSwitcher({ direction }: { direction: DirectionId }) {
  const [mobileView, setMobileView] = useState<'Conversation' | 'Workflow'>('Conversation')
  return (
    <CandidateDirection direction={direction}>
      <PageShell className="bakin-mobile-switcher">
        <Inline className="bakin-mobile-switcher__tabs" aria-label="Mobile operation view">
          {(['Conversation', 'Workflow'] as const).map((view) => <Action key={view} aria-pressed={mobileView === view} onClick={() => setMobileView(view)}>{view}</Action>)}
        </Inline>
        <div className="bakin-mobile-switcher__views">{mobileView === 'Conversation' ? <ConversationStream /> : <WorkflowCanvas />}</div>
      </PageShell>
    </CandidateDirection>
  )
}

function MotionPanel({ direction }: { direction: DirectionId }) {
  return (
    <CandidateDirection direction={direction}>
      <div className="bakin-reduced-motion-note"><h2>Functional live feedback</h2><p>The pulse communicates ongoing streaming. Under reduced motion it becomes a stable green signal with the same text explanation.</p><div className="bakin-streaming"><SystemState kind="loading" title="Streaming response" description="Waiting for tool:assets.search and provider/openai/gpt-5.2." /></div><Inline><Action>Inspect motion guidance</Action></Inline></div>
    </CandidateDirection>
  )
}

function CompositeStudy({ text200 = false }: { text200?: boolean }) {
  return (
    <main className="bakin-candidate-study">
      <CandidateStyles css={SPECIMEN_CSS} />
      {text200 && <style>{'html { font-size: 200%; }'}</style>}
      <CandidateIntro title={text200 ? 'Conversation and workflow at 200% text' : 'Conversation and workflow directions'}>Product Character is the approved direction for streaming, tools, composition, inspection, live status, and workflow canvases. Operational Neutral remains comparison evidence.</CandidateIntro>
      <div className="bakin-candidate-study__directions"><CompositeDirection direction="operational-neutral" /><CompositeDirection direction="product-character" /></div>
    </main>
  )
}

function WorkflowStudy({ orientation, text200 = false }: { orientation: WorkflowOrientation; text200?: boolean }) {
  const orientationLabel = orientation === 'vertical' ? 'Vertical' : 'Horizontal'
  const title = text200 ? `${orientationLabel} workflow at 200% text` : `${orientationLabel} keyboard and non-drag workflow`
  return <main className="bakin-candidate-study"><CandidateStyles css={SPECIMEN_CSS} />{text200 && <style>{'html { font-size: 200%; }'}</style>}<CandidateIntro title={title}>{orientationLabel} layout uses the same topology, selection, inspector, arrow-key movement, and named non-drag actions.</CandidateIntro><div className="bakin-candidate-study__directions"><CandidateDirection direction="operational-neutral"><PageShell><WorkflowCanvas orientation={orientation} /></PageShell></CandidateDirection><CandidateDirection direction="product-character"><PageShell><WorkflowCanvas orientation={orientation} /></PageShell></CandidateDirection></div></main>
}

function MotionStudy() {
  return <main className="bakin-candidate-study"><CandidateStyles css={SPECIMEN_CSS} /><CandidateIntro title="Reduced-motion behavior">The live state remains explicit while nonessential repetition is removed by user preference.</CandidateIntro><div className="bakin-candidate-study__directions"><MotionPanel direction="operational-neutral" /><MotionPanel direction="product-character" /></div></main>
}

function MobileStudy() {
  return <main className="bakin-candidate-study"><CandidateStyles css={SPECIMEN_CSS} /><CandidateIntro title="Dense mobile operation">Conversation and workflow are explicit switchable modes at 320px, keeping the composer, canvas, inspector, and move actions usable.</CandidateIntro><div className="bakin-candidate-study__directions"><MobileSwitcher direction="operational-neutral" /><MobileSwitcher direction="product-character" /></div></main>
}

const meta = {
  title: 'Direction studies/Conversation and workflow',
  tags: ['internal'],
  parameters: { layout: 'fullscreen', bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'streaming', 'tool-activity', 'bounded-2d', 'keyboard-non-drag', 'vertical-flow', 'horizontal-flow', 'reduced-motion', 'drawer'] },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const SideBySide = {
  render: () => <CompositeStudy />,
  play: async ({ canvas, userEvent }) => {
    const composer = canvas.getAllByRole('textbox', { name: 'Message Patch' })[0]
    await userEvent.type(composer, 'Keep the review gate and prepare the final cut.')
    await userEvent.keyboard('{Enter}')
    await expect(canvas.getAllByRole('log')[0]).toHaveTextContent('Keep the review gate and prepare the final cut.')
  },
} satisfies Story

export const VerticalWorkflow = {
  render: () => <WorkflowStudy orientation="vertical" />,
  play: async ({ canvas, userEvent }) => {
    const node = canvas.getAllByRole('button', { name: /Assemble social video/ })[0]
    await userEvent.click(node)
    await userEvent.keyboard('{ArrowDown}')
    await expect(canvas.getAllByRole('status')[0]).toHaveTextContent('y 165')
  },
} satisfies Story

export const HorizontalWorkflow = {
  render: () => <WorkflowStudy orientation="horizontal" />,
  play: async ({ canvas, userEvent }) => {
    const node = canvas.getAllByRole('button', { name: /Assemble social video/ })[0]
    await userEvent.click(node)
    await userEvent.keyboard('{ArrowRight}')
    await expect(canvas.getAllByRole('status')[0]).toHaveTextContent('x 275')
  },
} satisfies Story

export const VerticalAt200Percent = { render: () => <WorkflowStudy orientation="vertical" text200 /> } satisfies Story

export const HorizontalAt200Percent = { render: () => <WorkflowStudy orientation="horizontal" text200 /> } satisfies Story

export const ReducedMotion = { render: () => <MotionStudy /> } satisfies Story

export const MobileOperation = {
  render: () => <MobileStudy />,
  play: async ({ canvas, userEvent }) => {
    const workflow = canvas.getAllByRole('button', { name: 'Workflow' })[0]
    await userEvent.click(workflow)
    await expect(workflow).toHaveAttribute('aria-pressed', 'true')
    await expect(canvas.getByRole('region', { name: 'Scrollable two-dimensional workflow canvas' })).toBeVisible()
  },
} satisfies Story

export const TextAt200Percent = { render: () => <CompositeStudy text200 /> } satisfies Story
