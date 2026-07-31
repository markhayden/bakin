import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect } from 'storybook/test'

import { Grid, Inline } from '@makinbakin/sdk/layout'
import {
  Page,
  PageBody,
  PageControls,
  PageHeader,
  type PageCanvasOrientation,
} from '@makinbakin/sdk/patterns'
import { Badge, Banner, Button, SystemState } from '@makinbakin/sdk/ui'

import { WorkflowStoryWorkspace } from '../patterns/workflow-story-graph'
import './workflow-pages.stories.css'

const meta = {
  title: 'Recipes/Workflow and action pages',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Workflow scenes compose the one Page archetype at density="compact": PageControls as="toolbar" names graph commands, PageCanvas bounds the graph-library-independent canvas, an InspectorPanel rides the main-aside Grid recipe, and page-level decisions stay in a named actions group outside the canvas interaction model. Vertical is the product default; horizontal is an explicit topology option. The examples use real React Flow while data, graph behavior, persistence, drawers, and routing stay consumer-owned.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'overflow', 'interaction', 'system-states', 'bounded-2d', 'keyboard-non-drag', 'vertical-flow', 'horizontal-flow', 'url-state-guidance'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

function WorkflowExample({
  initialOrientation,
  review = false,
}: {
  initialOrientation: PageCanvasOrientation
  review?: boolean
}) {
  const [orientation, setOrientation] = useState(initialOrientation)
  const [outcome, setOutcome] = useState<'saved' | 'approved' | 'rejected' | null>(null)

  const feedback = outcome ? (
    <Banner
      tone={outcome === 'rejected' ? 'attention' : 'success'}
      headingLevel={2}
      title={outcome === 'saved'
        ? 'Workflow saved'
        : outcome === 'approved'
          ? 'Publishing review approved'
          : 'Publishing review returned'}
      description="The graph remains visible because this outcome does not invalidate its current data."
    />
  ) : undefined

  return (
    <Page density="compact" className="bakin-workflow-story">
      <PageHeader
        eyebrow={review ? 'Workflow / required action' : 'Workflow / graph editor'}
        title={review ? 'Review launch publishing workflow' : 'Launch publishing workflow'}
        description="Keep graph navigation, contextual inspection, and page-level decisions in distinct interaction regions."
        meta={(
          <>
            <Badge tone={review ? 'attention' : 'success'}>{review ? 'Review required' : 'Draft ready'}</Badge>
            <code>workflow:video-social-post</code>
          </>
        )}
        actions={<Button variant="outline">Workflow details</Button>}
      />

      <PageControls
        as="toolbar"
        label="Workflow canvas tools"
        actions={(
          <Inline gap="dense">
            <Button size="sm" variant="ghost">Auto arrange</Button>
            <Button size="sm" variant="ghost">Fit view</Button>
          </Inline>
        )}
      >
        <Inline gap="dense" aria-label="Workflow orientation">
          <Button
            size="sm"
            variant={orientation === 'vertical' ? 'secondary' : 'outline'}
            aria-pressed={orientation === 'vertical'}
            onClick={() => setOrientation('vertical')}
          >
            Vertical
          </Button>
          <Button
            size="sm"
            variant={orientation === 'horizontal' ? 'secondary' : 'outline'}
            aria-pressed={orientation === 'horizontal'}
            onClick={() => setOrientation('horizontal')}
          >
            Horizontal
          </Button>
        </Inline>
      </PageControls>

      <PageBody gap="content" feedback={feedback}>
        <Grid layout="main-aside" gap="item" align="stretch">
          <WorkflowStoryWorkspace orientation={orientation} />
        </Grid>

        <div
          role="group"
          aria-label={review ? 'Publishing review actions' : 'Workflow changes'}
          className="bakin-workflow-story__actions"
        >
          {review ? (
            <>
              <Button variant="outline" onClick={() => setOutcome('rejected')}>Return for changes</Button>
              <Button onClick={() => setOutcome('approved')}>Approve publishing</Button>
            </>
          ) : (
            <>
              <Button variant="ghost">Discard changes</Button>
              <Button onClick={() => setOutcome('saved')}>Save workflow</Button>
            </>
          )}
        </div>
      </PageBody>
    </Page>
  )
}

export const VerticalWorkflow = {
  render: () => <WorkflowExample initialOrientation="vertical" />,
  play: async ({ canvas, userEvent }) => {
    const node = await canvas.findByRole('button', { name: /Assemble social video, transform node/ })
    await userEvent.click(node)
    await userEvent.keyboard('{ArrowDown}')
    await expect(canvas.getByRole('status')).toHaveTextContent(/selected at y 285/)
    await userEvent.click(canvas.getByRole('button', { name: 'Save workflow' }))
    await expect(canvas.getByText('Workflow saved')).toBeVisible()
  },
} satisfies Story

export const HorizontalWorkflow = {
  render: () => <WorkflowExample initialOrientation="horizontal" />,
  play: async ({ canvas, userEvent }) => {
    const node = await canvas.findByRole('button', { name: /Assemble social video, transform node/ })
    await userEvent.click(node)
    await userEvent.keyboard('{ArrowRight}')
    await expect(canvas.getByRole('status')).toHaveTextContent(/selected at x 505/)
  },
} satisfies Story

export const ReviewAction = {
  render: () => <WorkflowExample initialOrientation="vertical" review />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Approve publishing' }))
    await expect(canvas.getByText('Publishing review approved')).toBeVisible()
  },
} satisfies Story

export const WorkflowUnavailable = {
  render: () => (
    <Page density="compact" className="bakin-workflow-story">
      <PageHeader
        eyebrow="Workflow / archived"
        title="Legacy publishing workflow"
        description="Workflow identity and safe navigation remain when the graph cannot be rendered."
        actions={(
          <>
            <Button variant="outline">Back to workflows</Button>
            <Button variant="danger">Delete preserved workflow</Button>
          </>
        )}
      />
      <PageBody
        gap="content"
        state={(
          <SystemState
            kind="error"
            recovery="unavailable"
            title="Workflow graph is unavailable"
            description="The plugin that contributes one or more required node types is not active."
          />
        )}
      />
    </Page>
  ),
} satisfies Story
