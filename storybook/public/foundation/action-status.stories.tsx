import type { Meta, StoryObj } from '@storybook/react-vite'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Progress,
  ProgressLabel,
  ProgressValue,
} from '@makinbakin/sdk/ui'

import './primitives.stories.css'

const meta = {
  title: 'Foundation/Action and status',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Canonical Product Character overview for the action and status primitive family.',
      },
    },
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const Overview = {
  render: () => (
    <main className="bakin-primitive-story">
      <header className="bakin-primitive-story__intro">
        <p className="bakin-primitive-story__eyebrow">Foundation</p>
        <h1>Actions and status</h1>
        <p>A single semantic vocabulary for decisions, compact state, inline feedback, and measurable work.</p>
      </header>

      <section className="bakin-primitive-story__section">
        <header><h2>Action hierarchy</h2><p>Keep the local primary decision obvious and let supporting actions recede.</p></header>
        <div className="bakin-primitive-story__cluster">
          <Button>Create task</Button>
          <Button variant="secondary">Export</Button>
          <Button variant="outline">Cancel</Button>
          <Button variant="ghost">Details</Button>
          <Button variant="danger">Delete</Button>
        </div>
      </section>

      <section className="bakin-primitive-story__section">
        <header><h2>Compact state</h2><p>Labels preserve meaning when color is unavailable.</p></header>
        <div className="bakin-primitive-story__cluster">
          <Badge tone="neutral">Draft</Badge>
          <Badge tone="success">Published</Badge>
          <Badge tone="attention">Needs review</Badge>
          <Badge tone="danger">Blocked</Badge>
          <Badge tone="accent">New signal</Badge>
        </div>
      </section>

      <section className="bakin-primitive-story__section">
        <header><h2>Inline feedback</h2></header>
        <div className="bakin-primitive-story__grid">
          <Alert tone="success"><AlertTitle>Saved</AlertTitle><AlertDescription>New dispatches use the updated policy.</AlertDescription></Alert>
          <Alert tone="danger"><AlertTitle>Connection failed</AlertTitle><AlertDescription>The configured runtime did not respond.</AlertDescription></Alert>
        </div>
      </section>

      <section className="bakin-primitive-story__section">
        <header><h2>Measurable work</h2></header>
        <div className="bakin-primitive-story__stack">
          <Progress value={64} size="md"><ProgressLabel>Plugin migration</ProgressLabel><ProgressValue /></Progress>
          <Progress value={null} tone="accent"><ProgressLabel>Connecting to runtime</ProgressLabel></Progress>
        </div>
      </section>
    </main>
  ),
} satisfies Story
