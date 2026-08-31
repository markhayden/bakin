import type { Meta, StoryObj } from '@storybook/react-vite'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { useRef, useState } from 'react'
import { expect, waitFor, within } from 'storybook/test'

import { Stack } from '@makinbakin/sdk/layout'
import { PluginLink, useUnsavedChangesGuard } from '@makinbakin/sdk/navigation'
import { UnsavedChangesDialog } from '@makinbakin/sdk/patterns'
import { Button } from '@makinbakin/sdk/ui'

import { StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Components/Forms/UnsavedChangesDialog',
  component: UnsavedChangesDialog,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'UnsavedChangesDialog renders the three-way exit decision — save and exit, discard, or stay — for a dirty draft. It owns presentation, semantics, focus, and responsive action placement only. The router-aware `useUnsavedChangesGuard` from `@makinbakin/sdk/navigation` decides when the dialog opens and owns navigation continuation; consumers driving it directly own the open, busy, error, and persistence state.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'interaction', 'focus-return', 'mobile-action-order', 'routing-boundary'],
  },
} satisfies Meta<typeof UnsavedChangesDialog>

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  args: {
    open: true,
    onSave: () => {},
    onDiscard: () => {},
    onCancel: () => {},
  },
  argTypes: {
    open: { control: 'boolean' },
    busy: { control: 'boolean' },
    saveDisabled: { control: 'boolean' },
    canSaveInPlace: { control: 'boolean' },
    error: { control: 'text' },
    finalFocus: { control: false },
  },
  play: async () => {
    const page = within(document.body)
    const dialog = await page.findByRole('dialog', { name: 'Unsaved changes' })
    await expect(within(dialog).getByRole('button', { name: 'Save and exit' })).toBeEnabled()
    await expect(within(dialog).getByRole('button', { name: 'Discard changes' })).toBeEnabled()
    await expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeEnabled()
  },
} satisfies Story

function ExitDecisionExample() {
  const [dirty, setDirty] = useState(true)
  const [outcome, setOutcome] = useState('Draft has unsaved changes')
  const triggerRef = useRef<HTMLButtonElement>(null)

  const guard = useUnsavedChangesGuard({
    hasUnsavedChanges: dirty,
    saving: false,
    onCancel: () => setOutcome('Explicit exit approved'),
    onSaveAndExit: async () => {
      setDirty(false)
      setOutcome('Draft saved; navigation may continue')
      return true
    },
    onDiscardAndExit: () => {
      setDirty(false)
      setOutcome('Draft discarded; navigation may continue')
    },
    finalFocus: triggerRef,
  })

  return (
    <StoryStage
      eyebrow="Navigation / unsaved draft"
      title="Keep exit decisions explicit"
      description="The router-aware guard decides when this presentation opens; the dialog only renders save, discard, and stay choices."
    >
      <StorySection title="Publishing settings">
        <Stack gap="dense">
          <p style={{ margin: 0, maxInlineSize: '64ch', color: 'var(--bakin-color-text-muted)', lineHeight: 1.6 }}>
            A changed provider key has not been saved.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--bakin-layout-space-3)' }}>
            <Button ref={triggerRef} variant="outline" onClick={guard.requestExit}>Leave settings</Button>
            <PluginLink
              to="/workflows"
              style={{ color: 'var(--bakin-color-signal-accent)', fontWeight: 'var(--bakin-typography-weight-medium)', textUnderlineOffset: '.2em' }}
            >
              Open workflows
            </PluginLink>
          </div>
          <p role="status">{outcome}</p>
        </Stack>
      </StorySection>
      {guard.dialog}
    </StoryStage>
  )
}

const exitDecisionRootRoute = createRootRoute({ component: Outlet })
const exitDecisionRoute = createRoute({
  getParentRoute: () => exitDecisionRootRoute,
  path: '/',
  component: ExitDecisionExample,
})
const exitDecisionRouteTree = exitDecisionRootRoute.addChildren([exitDecisionRoute])

function RoutedExitDecisionExample() {
  const [router] = useState(() => createRouter({
    routeTree: exitDecisionRouteTree,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  }))
  return <RouterProvider router={router} />
}

export const UnsavedExitDecision = {
  // Type-satisfying only: the routed example owns its props.
  args: { open: false, onSave: () => {}, onDiscard: () => {}, onCancel: () => {} },
  render: () => <RoutedExitDecisionExample />,
  play: async ({ userEvent }) => {
    const page = within(document.body)
    const trigger = await page.findByRole('button', { name: 'Leave settings' })
    await userEvent.click(trigger)
    const dialog = await page.findByRole('dialog', { name: 'Unsaved changes' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(page.getByRole('status')).toHaveTextContent('Draft has unsaved changes'))
    await waitFor(() => expect(trigger).toHaveFocus())
  },
} satisfies Story
