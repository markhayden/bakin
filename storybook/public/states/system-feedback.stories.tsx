import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect } from 'storybook/test'

import { Grid, PageShell, Section, Stack } from '@makinbakin/sdk/layout'
import {
  Banner,
  Button,
  Skeleton,
  SystemState,
  Toast,
  ToastRegion,
} from '@makinbakin/sdk/ui'

import './system-feedback.stories.css'

const meta = {
  title: 'States/System state and feedback',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'SystemState distinguishes first-use emptiness, filtered no-results, loading, recoverable or terminal errors, and permission boundaries. Page scope fills a useful replacement region; inline and section scopes stay content-sized. Banner carries persistent context. Toast presents transient shell-owned feedback. Urgency is semantic, not inferred from color alone.',
      },
    },
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

function StoryHeader({ title, description }: { title: string; description: string }) {
  return (
    <header className="bakin-state-story__intro">
      <p className="bakin-state-story__eyebrow">States / honest feedback</p>
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  )
}

function LoadingPreview() {
  return (
    <div className="bakin-state-story__preview">
      {[0, 1].map((row) => (
        <div className="bakin-state-story__preview-row" key={row}>
          <Skeleton shape="circle" />
          <div className="bakin-state-story__preview-copy">
            <Skeleton shape="text" />
            <Skeleton shape="text" />
          </div>
        </div>
      ))}
    </div>
  )
}

export const StateMatrix = {
  render: () => (
    <PageShell width="wide" className="bakin-state-story">
      <StoryHeader
        title="Every data surface tells the truth"
        description="Choose the state by cause, preserve useful context, and offer the next valid action. A filtered view is not the same thing as a product with no data."
      />
      <Grid layout="split" gap="section">
        <SystemState
          kind="initial-empty"
          title="No workflows yet"
          description="Create the first workflow or install one from an official plugin."
          action={<Button>Create workflow</Button>}
        />
        <SystemState
          kind="no-results"
          title="No workflows match"
          description="Three workflows are hidden by the current owner and status filters."
          action={<Button variant="outline">Clear filters</Button>}
        />
        <SystemState
          kind="loading"
          title="Loading workflows"
          description="The list structure remains predictable while current data arrives."
          preview={<LoadingPreview />}
        />
        <SystemState
          kind="error"
          title="Workflows could not be refreshed"
          description="The last usable snapshot remains available. Retry the request or inspect runtime health."
          action={<Button variant="outline">Try again</Button>}
        />
        <SystemState
          kind="permission-denied"
          title="Workflow details are restricted"
          description="Your workspace role can see status but cannot inspect execution inputs."
          action={<Button variant="outline">Request access</Button>}
        />
        <SystemState
          kind="error"
          recovery="unavailable"
          title="Run history expired"
          description="This run is outside the workspace retention window and cannot be recovered."
        />
      </Grid>
    </PageShell>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('status', { name: 'No workflows match' })).toHaveAttribute('aria-live', 'polite')
    await expect(canvas.getByRole('status', { name: 'Loading workflows' })).toHaveAttribute('aria-busy', 'true')
    await expect(canvas.getByRole('alert', { name: 'Workflows could not be refreshed' })).toHaveAttribute('data-recovery', 'available')
    await expect(canvas.getByText('Workflow details are restricted').closest('[data-slot="system-state"]')).not.toHaveAttribute('role')
  },
} satisfies Story

export const ScopeAndRecovery = {
  render: () => (
    <PageShell width="content" className="bakin-state-story">
      <StoryHeader
        title="Match the state to its owning region"
        description="Inline feedback stays close to the affected content. Full states replace only the region that is unavailable; they do not erase working page chrome or navigation."
      />
      <Section spacing="compact" aria-labelledby="inline-state-heading">
        <div className="bakin-state-story__section-heading">
          <h2 id="inline-state-heading">Inline state</h2>
          <p>Use this scope when nearby content remains useful.</p>
        </div>
        <SystemState
          kind="loading"
          scope="inline"
          headingLevel={3}
          title="Refreshing task history"
          description="Existing rows remain available while the latest events load."
        />
      </Section>
      <Section spacing="compact" divider="top" aria-labelledby="page-state-heading">
        <div className="bakin-state-story__section-heading">
          <h2 id="page-state-heading">Full region state</h2>
          <p>Reserve page scope for a region with no usable primary content.</p>
        </div>
        <SystemState
          kind="error"
          scope="page"
          headingLevel={3}
          title="Workspace could not be loaded"
          description="Navigation is still available. Retry without reloading the application."
          action={<Button>Try again</Button>}
        />
      </Section>
    </PageShell>
  ),
} satisfies Story

function FeedbackExample() {
  const [showToast, setShowToast] = useState(true)

  return (
    <PageShell width="wide" className="bakin-state-story">
      <StoryHeader
        title="Persistent context and transient outcomes"
        description="Banners stay with the affected surface. Toasts confirm completed background actions without becoming the only place to find important state or recovery."
      />
      <Grid layout="split" gap="section" className="bakin-state-story__feedback-grid">
        <Stack gap="item" className="bakin-state-story__feedback-column">
          <h2>Banners</h2>
          <Banner tone="info" title="Scheduled maintenance" description="New runs remain available during the provider update." />
          <Banner tone="success" title="Runtime reconnected" description="Queued workflows will resume automatically." announce="polite" />
          <Banner tone="attention" title="Dispatch is paused" description="Queued work remains visible until an operator resumes dispatch." action={<Button variant="outline">Resume</Button>} />
          <Banner tone="danger" title="Connection needs attention" description="Reconnect before starting more work." action={<Button variant="outline">Open runtime</Button>} />
        </Stack>
        <Stack gap="item" className="bakin-state-story__feedback-column">
          <h2>Shell-owned toasts</h2>
          <ToastRegion label="Example notifications">
            <Toast tone="success" title="Task created" description="Draft launch brief is ready for review." />
            <Toast tone="info" title="Agent replied" description="Patch added routing evidence to the task." action={<Button variant="link" size="xs">Open reply</Button>} />
            {showToast ? (
              <Toast tone="error" description="The workflow could not be started." onDismiss={() => setShowToast(false)} />
            ) : null}
          </ToastRegion>
        </Stack>
      </Grid>
    </PageShell>
  )
}

export const Feedback = {
  render: () => <FeedbackExample />,
} satisfies Story

export const FeedbackBehavior = {
  render: () => <FeedbackExample />,
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByRole('status', { name: 'Runtime reconnected' })).toHaveAttribute('aria-live', 'polite')
    await expect(canvas.getByRole('alert', { name: 'Action failed' })).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Dismiss notification' }))
    await expect(canvas.queryByRole('alert', { name: 'Action failed' })).not.toBeInTheDocument()
  },
} satisfies Story
