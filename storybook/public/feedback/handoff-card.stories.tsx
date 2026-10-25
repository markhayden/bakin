import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, within } from 'storybook/test'

import { Stack } from '@makinbakin/sdk/layout'
import { HandoffCard } from '@makinbakin/sdk/patterns'

import { StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Components/Feedback/HandoffCard',
  component: HandoffCard,
  args: {
    title: 'Sign in to the model provider',
    description: 'Pi has no authenticated provider. Run Pi, sign in with /login, then come back — Health re-checks when this tab regains focus.',
    command: 'pi',
    cwd: '~/.bakin',
  },
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'HandoffCard is how Bakin hands a command to the operator when the fix is theirs to run — install a runtime, sign in to a provider, grant a scope. The command is shown exactly and is copyable; when the host can open a terminal with it prefilled, that action sits beside the copy. Bakin never runs it for you.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'interaction', 'focus-return'],
  },
} satisfies Meta<typeof HandoffCard>

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  argTypes: {
    title: { control: 'text' },
    description: { control: 'text' },
    command: { control: 'text' },
    cwd: { control: 'text' },
    terminalLabel: { control: 'text' },
    busy: { control: 'boolean' },
    error: { control: 'text' },
    onOpenTerminal: { control: false },
  },
  render: (args) => (
    <div style={{ width: 'min(90vw, 36rem)' }}>
      <HandoffCard {...args} />
    </div>
  ),
  play: async ({ canvas }) => {
    const card = canvas.getByRole('region', { name: 'Sign in to the model provider' })
    await expect(card).toBeVisible()
    await expect(within(card).getByText('pi')).toBeVisible()
    await expect(within(card).getByRole('button', { name: /copy/i })).toBeVisible()
    // Copy-only is the honest state without a terminal: no handoff button.
    await expect(within(card).queryByRole('button', { name: 'Open in Terminal' })).toBeNull()
  },
} satisfies Story

function WithTerminalExample() {
  const [busy, setBusy] = useState(false)
  const [opened, setOpened] = useState(0)
  return (
    <Stack gap="item">
      <HandoffCard
        title="Approve Bakin's device with operator.admin"
        description="OpenClaw needs the operator.admin scope for per-turn model overrides. Approve the paired device, then restart Bakin."
        command="openclaw devices approve bakin --scope operator.admin"
        busy={busy}
        onOpenTerminal={() => {
          setBusy(true)
          setTimeout(() => { setBusy(false); setOpened((n) => n + 1) }, 300)
        }}
      />
      <p data-testid="opened-count" className="m-0 text-sm">Terminal sessions opened: {opened}</p>
    </Stack>
  )
}

export const WithTerminal = {
  render: () => <WithTerminalExample />,
  play: async ({ canvas, userEvent }) => {
    const button = canvas.getByRole('button', { name: 'Open in Terminal' })
    await userEvent.click(button)
    await expect(canvas.getByRole('button', { name: 'Opening…' })).toBeDisabled()
    await expect(await canvas.findByText('Terminal sessions opened: 1')).toBeVisible()
  },
} satisfies Story

export const Failed = {
  render: () => (
    <StoryStage eyebrow="Feedback" title="A terminal that would not open" description="The copy block always works; the failure is said, not hidden.">
      <StorySection title="With error">
        <HandoffCard
          title="Install Pi"
          command="brew install pi"
          error="The Terminal plugin refused to start a session (service not installed). Copy the command instead."
          onOpenTerminal={() => {}}
        />
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('alert')).toHaveTextContent('refused to start a session')
  },
} satisfies Story
