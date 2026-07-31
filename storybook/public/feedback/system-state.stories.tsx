import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'

import { Grid } from '@makinbakin/sdk/layout'
import { Button, Skeleton, SystemState } from '@makinbakin/sdk/ui'

import { StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Feedback/SystemState',
  // No meta `component`: SystemState's discriminated-union props force
  // StoryObj to demand `args` on render-only stories.
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'SystemState is the one contract for asynchronous and data-driven surface states. Choose `kind` by cause — first-use emptiness, filtered no-results, loading, recoverable or terminal errors, and permission boundaries are different states with different next actions. Every state centers by default; `align` overrides it and `icon` places a meaningful glyph above the copy (empty kinds render no status dot). Inline scope is the compact row treatment for surfaces whose nearby content remains useful; section and page scopes replace only the region that is unavailable. No-results and recoverable errors require an action at the type boundary, and urgency is semantic, not inferred from color alone.',
      },
    },
    bakinCoverage: ['desktop', 'loading', 'empty', 'error', 'non-color'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  render: () => (
    <SystemState
      kind="no-results"
      title="No workflows match"
      description="Three workflows are hidden by the current owner and status filters."
      action={<Button variant="outline">Clear filters</Button>}
    />
  ),
  play: async ({ canvas }) => {
    const state = canvas.getByRole('status', { name: 'No workflows match' })
    await expect(state).toHaveAttribute('aria-live', 'polite')
    await expect(state).toHaveAttribute('data-kind', 'no-results')
    await expect(canvas.getByRole('button', { name: 'Clear filters' })).toBeVisible()
  },
} satisfies Story

function LoadingPreview() {
  return (
    <div style={{ display: 'grid', gap: 'var(--bakin-layout-space-2)', inlineSize: 'min(100%, 24rem)', marginInline: 'auto' }}>
      {[0, 1].map((row) => (
        <div
          key={row}
          style={{
            display: 'grid',
            gridTemplateColumns: 'var(--bakin-layout-size-row) minmax(0, 1fr)',
            gap: 'var(--bakin-layout-space-3)',
            alignItems: 'center',
          }}
        >
          <Skeleton shape="circle" />
          <div style={{ display: 'grid', gap: 'var(--bakin-layout-space-2)' }}>
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
    <StoryStage
      eyebrow="States / honest feedback"
      title="Every data surface tells the truth"
      description="Choose the state by cause, preserve useful context, and offer the next valid action. A filtered view is not the same thing as a product with no data."
      width="wide"
    >
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
    </StoryStage>
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
    <StoryStage
      eyebrow="States / honest feedback"
      title="Match the state to its owning region"
      description="Inline feedback stays close to the affected content. Full states replace only the region that is unavailable; they do not erase working page chrome or navigation."
    >
      <StorySection title="Inline state" description="Use this scope when nearby content remains useful.">
        <SystemState
          kind="loading"
          scope="inline"
          headingLevel={3}
          title="Refreshing task history"
          description="Existing rows remain available while the latest events load."
        />
      </StorySection>
      <StorySection title="Full region state" description="Reserve page scope for a region with no usable primary content.">
        <SystemState
          kind="error"
          scope="page"
          headingLevel={3}
          title="Workspace could not be loaded"
          description="Navigation is still available. Retry without reloading the application."
          action={<Button>Try again</Button>}
        />
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas }) => {
    const inline = canvas.getByText('Refreshing task history').closest('[data-slot="system-state"]')
    await expect(inline).toHaveAttribute('data-scope', 'inline')
    await expect(canvas.getByRole('alert', { name: 'Workspace could not be loaded' })).toHaveAttribute('data-scope', 'page')
  },
} satisfies Story

export const FullAndCompactEmptyStates = {
  render: () => (
    <StoryStage
      eyebrow="States / honest feedback"
      title="Match empty-state weight to the available space"
      description="Use the compact row inside a larger working surface. Use the full treatment only when the empty state replaces the section or page’s primary content."
    >
      <StorySection title="Compact empty state" description="Empty states carry no status dot — the copy is the message, centered inside the row.">
        <SystemState
          kind="initial-empty"
          scope="inline"
          headingLevel={3}
          title="No custom workflows yet"
          description="This section will update when a matching workflow is available."
        />
      </StorySection>
      <StorySection title="Full empty state" description="The centered treatment replaces the unavailable primary region.">
        <SystemState
          kind="initial-empty"
          scope="section"
          headingLevel={3}
          title="No workflows yet"
          description="Create the first workflow to coordinate repeatable, multi-step work."
          action={<Button>Create workflow</Button>}
        />
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas }) => {
    const compact = canvas.getByText('No custom workflows yet').closest('[data-slot="system-state"]')
    const full = canvas.getByText('No workflows yet').closest('[data-slot="system-state"]')
    await expect(compact).toHaveAttribute('data-presentation', 'compact')
    await expect(full).toHaveAttribute('data-presentation', 'full')
    await expect(compact?.querySelector('[data-slot="system-state-signal"]')).toBeNull()
    await expect(full?.querySelector('[data-slot="system-state-signal"]')).toBeNull()
  },
} satisfies Story

export const AlignmentAndIcon = {
  render: () => (
    <StoryStage
      eyebrow="States / honest feedback"
      title="Override alignment and glyph deliberately"
      description="Every state centers by default. Use `align` when the surrounding surface reads left-to-right, and `icon` to place a meaningful glyph above the copy — it replaces any status dot."
    >
      <StorySection title="Left-aligned empty state" description="Match a left-anchored surface such as a settings panel.">
        <SystemState
          kind="initial-empty"
          align="left"
          headingLevel={3}
          title="No lessons recorded"
          description="Lessons appear here after the first corrective sync."
        />
      </StorySection>
      <StorySection title="Custom icon" description="The sanctioned path for richer empty-state art. The glyph is decorative; the title carries the meaning.">
        <SystemState
          kind="initial-empty"
          headingLevel={3}
          icon={
            <svg viewBox="0 0 24 24" width="32" height="32" aria-hidden="true" style={{ color: 'var(--bakin-color-text-muted)' }}>
              <path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5v-9Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
              <path d="M4 7.5 12 12l8-4.5M12 12v9" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
            </svg>
          }
          title="No assets yet"
          description="Generated and imported files will appear here as versioned assets."
          action={<Button variant="outline">Import files</Button>}
        />
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas }) => {
    const left = canvas.getByText('No lessons recorded').closest('[data-slot="system-state"]')
    await expect(left).toHaveAttribute('data-align', 'left')
    const withIcon = canvas.getByText('No assets yet').closest('[data-slot="system-state"]')
    await expect(withIcon).toHaveAttribute('data-align', 'center')
    const icon = withIcon?.querySelector('[data-slot="system-state-icon"]')
    await expect(icon).not.toBeNull()
    await expect(icon).toHaveAttribute('aria-hidden', 'true')
  },
} satisfies Story
