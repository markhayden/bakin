import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, waitFor, within } from 'storybook/test'

import { Stack } from '@makinbakin/sdk/layout'
import { DangerZone } from '@makinbakin/sdk/patterns'
import { Badge } from '@makinbakin/sdk/ui'

import { StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Components/Feedback/DangerZone',
  component: DangerZone,
  // Canonical fixture args at meta level: the render-based story inherits the
  // required props (description/confirmLabel/confirmValue/onConfirm).
  args: {
    description: 'Delete the Acme publishing workspace, disconnect 4 agents, and stop 3 scheduled workflows. This cannot be undone.',
    confirmLabel: 'Delete workspace',
    confirmValue: 'acme-publishing',
    onConfirm: () => {},
  },
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'DangerZone is the consequence-first destructive section for settings surfaces. It names what will be destroyed before it offers the action, keeps the same header, description, content inset, and compact action rhythm as ordinary settings cards while retaining a danger theme, and gates the action behind an exact typed confirmation. The consumer owns the mutation plus busy and error state; the zone owns presentation, the embedded ConfirmDialog, and focus return to its trigger.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'interaction', 'typed-confirmation', 'focus-return'],
  },
} satisfies Meta<typeof DangerZone>

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  argTypes: {
    title: { control: 'text' },
    description: { control: 'text' },
    confirmLabel: { control: 'text' },
    confirmValue: { control: 'text' },
    headingLevel: { control: 'select', options: [2, 3, 4] },
    busy: { control: 'boolean' },
    error: { control: 'text' },
    // The mutation is consumer-owned.
    onConfirm: { control: false },
  },
  render: (args) => (
    <div style={{ width: 'min(90vw, 36rem)' }}>
      <DangerZone {...args} />
    </div>
  ),
  play: async ({ canvas, userEvent }) => {
    const zone = canvas.getByRole('region', { name: 'Danger zone' })
    await expect(zone).toBeVisible()
    await userEvent.click(canvas.getByRole('button', { name: 'Delete workspace' }))
    const page = within(document.body)
    const dialog = await page.findByRole('dialog', { name: 'Delete workspace?' })
    const confirm = within(dialog).getByTestId('danger-zone-confirm')
    await expect(confirm).toBeDisabled()
    await userEvent.type(within(dialog).getByLabelText(/Type acme-publishing to confirm/), 'acme-publishing')
    await expect(confirm).toBeEnabled()
  },
} satisfies Story

function ConsequenceFirstExample() {
  const [outcome, setOutcome] = useState('No destructive action requested')

  return (
    <StoryStage
      eyebrow="Settings / irreversible"
      title="Separate dangerous work from routine settings"
      description="DangerZone belongs after ordinary settings and names the consequence before it offers the action."
    >
      <StorySection
        title="Workspace"
        description="Routine settings keep their ordinary rhythm; the destructive section arrives last."
      >
        <Stack gap="dense">
          <div><Badge tone="success">Published</Badge></div>
          <p style={{ margin: 0, maxInlineSize: '64ch', color: 'var(--bakin-color-text-muted)', lineHeight: 1.6 }}>
            The Acme publishing workspace dispatches 4 agents across 3 scheduled workflows.
          </p>
        </Stack>
      </StorySection>
      <DangerZone
        headingLevel={2}
        description="Delete the Acme publishing workspace, disconnect 4 agents, and stop 3 scheduled workflows. This cannot be undone."
        confirmLabel="Delete workspace"
        confirmValue="acme-publishing"
        onConfirm={() => setOutcome('Workspace deletion confirmed')}
      />
      <p role="status">{outcome}</p>
    </StoryStage>
  )
}

export const ConsequenceFirstPlacement = {
  render: () => <ConsequenceFirstExample />,
  play: async ({ canvas, userEvent }) => {
    const zone = canvas.getByRole('region', { name: 'Danger zone' })
    await expect(zone.querySelector('[data-slot="card-header"]')).toBeTruthy()
    await expect(zone.querySelector('[data-slot="card-content"]')).toBeTruthy()
    const trigger = canvas.getByRole('button', { name: 'Delete workspace' })
    await expect(trigger).toHaveAttribute('data-size', 'sm')
    await userEvent.click(trigger)
    const page = within(document.body)
    const dialog = await page.findByRole('dialog', { name: 'Delete workspace?' })
    await userEvent.type(within(dialog).getByLabelText(/Type acme-publishing to confirm/), 'acme-publishing')
    await expect(within(dialog).getByRole('button', { name: 'Delete workspace' })).toBeEnabled()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(dialog).not.toBeVisible())
    await waitFor(() => expect(trigger).toHaveFocus())
  },
} satisfies Story
