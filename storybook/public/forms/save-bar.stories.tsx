import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, waitFor } from 'storybook/test'

import { Stack } from '@makinbakin/sdk/layout'
import { SaveBar } from '@makinbakin/sdk/patterns'
import { Badge, Input, Label } from '@makinbakin/sdk/ui'

import { OverlayBackdrop, StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Forms/SaveBar',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'SaveBar is the sticky save/discard boundary for a consumer-owned staged draft. The page owns dirty, saving, error, and persistence state; the bar reflects it in a compact row without adding a second set of page actions. It stays low-profile on desktop, stacks the actions only when the viewport needs it, keeps the draft context beside the unsaved state, turns the primary action into an explicit retry after a failure, and announces a transient saved confirmation once a save settles clean.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'overflow', 'interaction', 'busy', 'error-retry', 'mobile-action-order'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  render: () => (
    <div style={{ width: 'min(90vw, 44rem)' }}>
      <SaveBar dirty onSave={() => {}} onDiscard={() => {}}>
        <span>1 field changed</span>
      </SaveBar>
    </div>
  ),
  play: async ({ canvas }) => {
    const bar = canvas.getByRole('region', { name: 'Unsaved changes' })
    await expect(bar).toHaveAttribute('data-savebar-state', 'dirty')
    const actions = canvas.getByRole('group', { name: 'Draft actions' })
    await expect(actions).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Save changes' })).toBeEnabled()
    await expect(canvas.getByRole('button', { name: 'Discard' })).toBeEnabled()
  },
} satisfies Story

function RetryableSaveExample() {
  const [savedName, setSavedName] = useState('Launch approval')
  const [name, setName] = useState('Launch approval — final review')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | undefined>('The workflow could not be saved. The last published definition is still active.')
  const dirty = name !== savedName

  const save = () => {
    setError(undefined)
    setSaving(true)
    setTimeout(() => {
      setSavedName(name)
      setSaving(false)
    }, 150)
  }

  return (
    <StoryStage
      eyebrow="Draft / retryable save"
      title="Keep unsaved work and recovery together"
      description="The page owns its staged value and persistence. SaveBar reflects that state in a compact sticky row without adding a second set of page actions."
    >
      <StorySection title="Workflow details">
        <Stack gap="item">
          <div><Badge tone={dirty ? 'attention' : 'success'}>{dirty ? 'Draft changed' : 'Published'}</Badge></div>
          <div style={{ display: 'grid', gap: 'var(--bakin-layout-space-2)', inlineSize: 'min(100%, 32rem)' }}>
            <Label htmlFor="dirty-workflow-name">Workflow name</Label>
            <Input id="dirty-workflow-name" value={name} onChange={(event) => setName(event.currentTarget.value)} />
          </div>
          <p style={{ margin: 0, maxInlineSize: '64ch', color: 'var(--bakin-color-text-muted)', lineHeight: 1.6 }}>
            The published workflow remains available while this local draft is retried.
          </p>
        </Stack>
      </StorySection>
      <SaveBar
        dirty={dirty}
        saving={saving}
        error={error}
        onSave={save}
        onDiscard={() => {
          setName(savedName)
          setError(undefined)
        }}
      >
        <span>1 field changed</span>
      </SaveBar>
    </StoryStage>
  )
}

export const SaveFailureAndRetry = {
  render: () => <RetryableSaveExample />,
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByRole('alert')).toHaveTextContent('could not be saved')
    await userEvent.click(canvas.getByRole('button', { name: 'Retry save' }))
    await expect(canvas.getByRole('region', { name: 'Saving changes' })).toHaveAttribute('aria-busy', 'true')
    await waitFor(() => expect(canvas.getByRole('status', { name: 'Changes saved' })).toBeVisible())
  },
} satisfies Story

export const SaveFailure = {
  render: () => (
    <StoryStage
      eyebrow="Draft / recovery"
      title="Keep a failed draft actionable"
      description="Durable error copy stays beside the staged work and the same primary action becomes an explicit retry."
    >
      <OverlayBackdrop />
      <SaveBar
        dirty
        error="The workflow could not be saved. The last published definition is still active."
        onSave={() => {}}
        onDiscard={() => {}}
      >
        4 workflow steps changed
      </SaveBar>
    </StoryStage>
  ),
  play: async ({ canvas }) => {
    const bar = canvas.getByRole('region', { name: 'Unsaved changes' })
    await expect(bar).toHaveAttribute('data-savebar-state', 'error')
    await expect(canvas.getByRole('alert')).toHaveTextContent('last published definition is still active')
    await expect(canvas.getByRole('button', { name: 'Retry save' })).toBeEnabled()
  },
} satisfies Story
