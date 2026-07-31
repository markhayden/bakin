import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, waitFor } from 'storybook/test'

import { Toast, ToastAction, ToastRegion } from '@makinbakin/sdk/ui'

import { StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Feedback/Toast',
  // No meta `component`: Toast's required `description` prop forces StoryObj
  // to demand `args` on render-only stories.
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Toast presents transient, shell-owned feedback about a completed background action inside a labelled ToastRegion; only the shell mounts the region and owns placement. Error tones announce assertively as alerts, info and success announce politely, and every tone pairs its signal with visible language. In-toast actions use ToastAction — a small button that inherits the owning toast\'s tone, keeping text in primary ink. A toast is never the only place important state or recovery lives — persistent consequences belong in Banner or SystemState.',
      },
    },
    bakinCoverage: ['desktop', 'interaction', 'error', 'non-color'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  render: () => (
    <ToastRegion label="Notifications">
      <Toast tone="success" title="Task created" description="Draft launch brief is ready for review." />
    </ToastRegion>
  ),
  play: async ({ canvas }) => {
    const toast = canvas.getByRole('status', { name: 'Task created' })
    // The mount animation starts at opacity 0 — wait for it to settle.
    await waitFor(() => expect(toast).toBeVisible())
    await expect(toast).toHaveAttribute('aria-live', 'polite')
    await expect(toast).toHaveAttribute('data-tone', 'success')
    // Shrink-to-fit parents (the centered stage, any flex row) must not
    // collapse the copy column: the toast has to render at the region's
    // real width, not its dot + close button.
    await expect(toast.getBoundingClientRect().width).toBeGreaterThan(300)
  },
} satisfies Story

export const TonesAndActions = {
  render: () => (
    <StoryStage
      eyebrow="Feedback / transient outcomes"
      title="Confirm outcomes without hiding state"
      description="Toasts confirm completed background actions without becoming the only place to find important state or recovery."
    >
      <StorySection title="Shell-owned toasts" description="Info and success announce politely; errors are assertive alerts. In-toast actions use ToastAction — a small button in the owning toast's tone, never an accent link.">
        <ToastRegion label="Example notifications">
          <Toast tone="success" title="Task created" description="Draft launch brief is ready for review." />
          <Toast
            tone="info"
            title="Agent replied"
            description="Patch added routing evidence to the task."
            action={<ToastAction>Open reply</ToastAction>}
          />
          <Toast tone="error" description="The workflow could not be started." />
        </ToastRegion>
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('region', { name: 'Example notifications' })).toBeVisible()
    await expect(canvas.getByRole('status', { name: 'Agent replied' })).toHaveAttribute('data-tone', 'info')
    await expect(canvas.getByRole('alert', { name: 'Action failed' })).toHaveAttribute('aria-live', 'assertive')
    const action = canvas.getByRole('button', { name: 'Open reply' })
    await expect(action).toHaveAttribute('data-slot', 'toast-action')
    await expect(action).toHaveAttribute('data-tone', 'info')
  },
} satisfies Story

function DismissibleToastFixture() {
  const [showToast, setShowToast] = useState(true)

  return (
    <ToastRegion label="Example notifications">
      {showToast ? (
        <Toast tone="error" description="The workflow could not be started." onDismiss={() => setShowToast(false)} />
      ) : null}
    </ToastRegion>
  )
}

export const DismissBehavior = {
  parameters: { layout: 'centered' },
  render: () => <DismissibleToastFixture />,
  play: async ({ canvas, userEvent }) => {
    await waitFor(() => expect(canvas.getByRole('alert', { name: 'Action failed' })).toBeVisible())
    await userEvent.click(canvas.getByRole('button', { name: 'Dismiss notification' }))
    await expect(canvas.queryByRole('alert', { name: 'Action failed' })).not.toBeInTheDocument()
  },
} satisfies Story
