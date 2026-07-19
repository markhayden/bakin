import type { Meta, StoryObj } from '@storybook/react-vite'
import {
  Alert,
  AlertAction,
  AlertDescription,
  AlertTitle,
  Button,
} from '@makinbakin/sdk/ui'
import { expect } from 'storybook/test'

import './primitives.stories.css'

function SignalIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M8 4.5v4M8 11.5h.01" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" />
    </svg>
  )
}

const meta = {
  title: 'Foundation/Alert',
  component: Alert,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Alert presents inline system feedback. Routine tones use polite `status` semantics; danger uses assertive `alert` semantics unless the message was already announced elsewhere.',
      },
    },
  },
} satisfies Meta<typeof Alert>

export default meta
type Story = StoryObj<typeof meta>

export const Tones = {
  render: () => (
    <main className="bakin-primitive-story">
      <header className="bakin-primitive-story__intro">
        <p className="bakin-primitive-story__eyebrow">Feedback primitive</p>
        <h1>Alert tones</h1>
        <p>Every notice combines a clear title, actionable copy, and a semantic role appropriate to its urgency.</p>
      </header>
      <section className="bakin-primitive-story__section">
        <div className="bakin-primitive-story__stack">
          <Alert tone="neutral"><SignalIcon /><AlertTitle>Runtime update available</AlertTitle><AlertDescription>Review the release notes before restarting active work.</AlertDescription></Alert>
          <Alert tone="success"><SignalIcon /><AlertTitle>Configuration saved</AlertTitle><AlertDescription>New dispatches will use the updated limits.</AlertDescription></Alert>
          <Alert tone="attention"><SignalIcon /><AlertTitle>Review required</AlertTitle><AlertDescription>Two workflow steps need an owner before the run can start.</AlertDescription></Alert>
          <Alert tone="danger"><SignalIcon /><AlertTitle>Connection failed</AlertTitle><AlertDescription>Bakin could not reach the configured runtime.</AlertDescription></Alert>
          <Alert tone="accent"><SignalIcon /><AlertTitle>New capability detected</AlertTitle><AlertDescription>The plugin now contributes a searchable asset provider.</AlertDescription></Alert>
        </div>
      </section>
    </main>
  ),
} satisfies Story

export const WithAction = {
  render: () => (
    <main className="bakin-primitive-story">
      <header className="bakin-primitive-story__intro">
        <p className="bakin-primitive-story__eyebrow">Recovery</p>
        <h1>Actionable feedback</h1>
        <p>Keep recovery local to the message when one short action can resolve the condition.</p>
      </header>
      <section className="bakin-primitive-story__section">
        <Alert tone="danger">
          <SignalIcon />
          <AlertTitle>Health checks could not finish</AlertTitle>
          <AlertDescription>The runtime stopped responding during the final check.</AlertDescription>
          <AlertAction><Button size="xs" variant="outline">Retry</Button></AlertAction>
        </Alert>
      </section>
    </main>
  ),
  play: async ({ canvas, userEvent }) => {
    const retry = canvas.getByRole('button', { name: 'Retry' })
    await userEvent.tab()
    await expect(retry).toHaveFocus()
  },
} satisfies Story

export const PreviouslyAnnouncedDanger = {
  render: () => (
    <main className="bakin-primitive-story">
      <header className="bakin-primitive-story__intro">
        <p className="bakin-primitive-story__eyebrow">Semantics</p>
        <h1>Avoid duplicate announcements</h1>
        <p>Override the role when an upstream live region has already announced the same failure.</p>
      </header>
      <section className="bakin-primitive-story__section">
        <Alert tone="danger" role="status">
          <AlertTitle>Import still needs attention</AlertTitle>
          <AlertDescription>Fix the two invalid rows and try the import again.</AlertDescription>
        </Alert>
      </section>
    </main>
  ),
} satisfies Story
