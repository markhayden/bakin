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

import { PageShell, Section, Stack } from '@makinbakin/sdk/layout'
import { PluginLink, useUnsavedChangesGuard } from '@makinbakin/sdk/navigation'
import {
  ConfirmDialog,
  DangerZone,
  SaveBar,
} from '@makinbakin/sdk/patterns'
import { Badge, Button, Input, Label } from '@makinbakin/sdk/ui'

import './destructive-dirty.stories.css'

const meta = {
  title: 'Patterns/Destructive and dirty state',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'ConfirmDialog, SaveBar, DangerZone, and UnsavedChangesDialog make consequences, retry, and exit decisions consistent without taking ownership of domain mutations or routing. Consumers own open, dirty, busy, error, persistence, and navigation state; the canonical patterns own presentation, semantics, focus, and responsive action placement. SaveBar stays low-profile on desktop, stacks only when the viewport needs it, and keeps the draft context beside the unsaved state.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'overflow', 'interaction', 'busy', 'error-retry', 'typed-confirmation', 'focus-return', 'mobile-action-order', 'routing-boundary'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

function PatternStage({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string
  title: string
  description: string
  children: React.ReactNode
}) {
  return (
    <main className="bakin-destructive-story">
      <PageShell width="content">
        <Stack gap="section">
          <header className="bakin-destructive-story__intro">
            <p>{eyebrow}</p>
            <h1>{title}</h1>
            <p>{description}</p>
          </header>
          {children}
        </Stack>
      </PageShell>
    </main>
  )
}

function TypedConfirmationExample() {
  const [open, setOpen] = useState(true)
  const [outcome, setOutcome] = useState('Waiting for a decision')
  const triggerRef = useRef<HTMLButtonElement>(null)

  return (
    <PatternStage
      eyebrow="Confirmation / irreversible"
      title="Require intent before destructive work"
      description="Typed confirmation is reserved for actions whose consequences cannot be recovered through the normal product flow."
    >
      <Section spacing="compact" aria-labelledby="archive-workflow-heading">
        <Stack gap="dense">
          <h2 id="archive-workflow-heading">Launch publishing workflow</h2>
          <p className="bakin-destructive-story__muted">18 completed runs · 3 scheduled triggers · last used 12 minutes ago</p>
          <div><Button ref={triggerRef} variant="danger" onClick={() => setOpen(true)}>Delete archived workflow</Button></div>
          <p role="status">{outcome}</p>
        </Stack>
      </Section>
      <ConfirmDialog
        open={open}
        title="Delete archived workflow?"
        description="This permanently deletes the workflow definition and its preserved run history. Scheduled triggers will stop."
        confirmLabel="Delete workflow"
        busyLabel="Deleting workflow…"
        confirmValue="launch-publishing"
        finalFocus={triggerRef}
        onConfirm={() => {
          setOutcome('Workflow deletion confirmed')
          setOpen(false)
        }}
        onCancel={() => setOpen(false)}
      />
    </PatternStage>
  )
}

export const TypedConfirmation = {
  render: () => <TypedConfirmationExample />,
  play: async ({ userEvent }) => {
    const page = within(document.body)
    const dialog = await page.findByRole('dialog', { name: 'Delete archived workflow?' })
    const confirm = within(dialog).getByRole('button', { name: 'Delete workflow' })
    await expect(confirm).toBeDisabled()
    await userEvent.type(within(dialog).getByLabelText(/Type launch-publishing to confirm/), 'launch-publishing')
    await expect(confirm).toBeEnabled()
    await userEvent.click(confirm)
    await waitFor(() => expect(page.getByRole('status')).toHaveTextContent('Workflow deletion confirmed'))
  },
} satisfies Story

function FailedSaveExample() {
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
    <PatternStage
      eyebrow="Draft / retryable save"
      title="Keep unsaved work and recovery together"
      description="The page owns its staged value and persistence. SaveBar reflects that state in a compact sticky row without adding a second set of page actions."
    >
      <Section spacing="compact" aria-labelledby="workflow-details-heading">
        <Stack gap="item">
          <div>
            <h2 id="workflow-details-heading">Workflow details</h2>
            <Badge tone={dirty ? 'attention' : 'success'}>{dirty ? 'Draft changed' : 'Published'}</Badge>
          </div>
          <div className="bakin-destructive-story__field">
            <Label htmlFor="dirty-workflow-name">Workflow name</Label>
            <Input id="dirty-workflow-name" value={name} onChange={(event) => setName(event.currentTarget.value)} />
          </div>
          <p className="bakin-destructive-story__muted">The published workflow remains available while this local draft is retried.</p>
        </Stack>
      </Section>
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
    </PatternStage>
  )
}

export const SaveFailureAndRetry = {
  render: () => <FailedSaveExample />,
  play: async ({ canvas, userEvent }) => {
    await expect(canvas.getByRole('alert')).toHaveTextContent('could not be saved')
    await userEvent.click(canvas.getByRole('button', { name: 'Retry save' }))
    await expect(canvas.getByRole('region', { name: 'Saving changes' })).toHaveAttribute('aria-busy', 'true')
    await waitFor(() => expect(canvas.getByRole('status', { name: 'Changes saved' })).toBeVisible())
  },
} satisfies Story

export const SaveFailure = {
  render: () => (
    <PatternStage
      eyebrow="Draft / recovery"
      title="Keep a failed draft actionable"
      description="Durable error copy stays beside the staged work and the same primary action becomes an explicit retry."
    >
      <div className="bakin-destructive-story__workspace" aria-hidden="true"><div /><div /><div /></div>
      <SaveBar
        dirty
        error="The workflow could not be saved. The last published definition is still active."
        onSave={() => {}}
        onDiscard={() => {}}
      >
        4 workflow steps changed
      </SaveBar>
    </PatternStage>
  ),
} satisfies Story

function DangerZoneExample() {
  const [outcome, setOutcome] = useState('No destructive action requested')

  return (
    <PatternStage
      eyebrow="Settings / irreversible"
      title="Separate dangerous work from routine settings"
      description="DangerZone belongs after ordinary settings and names the consequence before it offers the action."
    >
      <DangerZone
        headingLevel={2}
        description="Delete the Acme publishing workspace, disconnect 4 agents, and stop 3 scheduled workflows. This cannot be undone."
        confirmLabel="Delete workspace"
        confirmValue="acme-publishing"
        onConfirm={() => setOutcome('Workspace deletion confirmed')}
      />
      <p role="status">{outcome}</p>
    </PatternStage>
  )
}

export const ConsequenceFirstDangerZone = {
  render: () => <DangerZoneExample />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Delete workspace' }))
    const page = within(document.body)
    const dialog = await page.findByRole('dialog', { name: 'Delete workspace?' })
    await userEvent.type(within(dialog).getByLabelText(/Type acme-publishing to confirm/), 'acme-publishing')
    await expect(within(dialog).getByRole('button', { name: 'Delete workspace' })).toBeEnabled()
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
    <PatternStage
      eyebrow="Navigation / unsaved draft"
      title="Keep exit decisions explicit"
      description="The router-aware guard decides when this presentation opens; the dialog only renders save, discard, and stay choices."
    >
      <Section spacing="compact" aria-labelledby="draft-settings-heading">
        <Stack gap="dense">
          <h2 id="draft-settings-heading">Publishing settings</h2>
          <p className="bakin-destructive-story__muted">A changed provider key has not been saved.</p>
          <div className="bakin-destructive-story__actions">
            <Button ref={triggerRef} variant="outline" onClick={guard.requestExit}>Leave settings</Button>
            <PluginLink to="/workflows">Open workflows</PluginLink>
          </div>
          <p role="status">{outcome}</p>
        </Stack>
      </Section>
      {guard.dialog}
    </PatternStage>
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
  render: () => <RoutedExitDecisionExample />,
  play: async ({ userEvent }) => {
    const page = within(document.body)
    await userEvent.click(await page.findByRole('button', { name: 'Leave settings' }))
    const dialog = await page.findByRole('dialog', { name: 'Unsaved changes' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(page.getByRole('status')).toHaveTextContent('Draft has unsaved changes'))
  },
} satisfies Story
