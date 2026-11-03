import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, userEvent, within } from 'storybook/test'

import { Panel } from '@makinbakin/sdk/layout'
import { CopyButton } from '@makinbakin/sdk/patterns'

import { StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Components/Primitives/CopyButton',
  component: CopyButton,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'CopyButton is the one copy affordance — CLI commands, ids, paths, message text, tool payloads. The confirmation is carried by the swapped icon AND by the accessible name, which becomes `<label> complete`; it is never a `title` tooltip, which would leave the result unannounced to keyboard and screen-reader users and invisible on touch. Success only appears when the clipboard write actually happened: Bakin is served over plain HTTP on the tailnet where `navigator.clipboard` is undefined, so the button falls back to a legacy copy path and reports honestly rather than flashing a check for a copy that never occurred. Give `label` an object-specific name ("Copy command", "Copy agent id") so a page with several copy actions stays distinguishable in a screen-reader element list. `size="touch"` is the 44px target for a coarse pointer where copying is the point of the surface (a tap-to-copy prompt, an offer to copy); the default 24px action sits beside inline text.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'keyboard', 'interaction'],
  },
} satisfies Meta<typeof CopyButton>

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  args: {
    text: 'bakin agents sync --check copywriter',
    label: 'Copy command',
  },
  argTypes: {
    text: { control: 'text' },
    label: { control: 'text' },
    size: { control: 'inline-radio', options: ['default', 'touch'] },
    className: { control: false },
  },
  render: (args) => (
    <Panel variant="code" padding="compact" className="flex min-w-0 items-center gap-bakin-2">
      <code className="min-w-0 flex-1 break-all text-bakin-text-primary">{args.text}</code>
      <CopyButton {...args} />
    </Panel>
  ),
  // Deliberately does NOT click: the success state reverts after 1.5s, so a
  // clicking play would race the visual capture and pin a baseline that
  // depends on a timer. The copy interaction is covered by CopyConfirmation.
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByRole('button', { name: 'Copy command' })).toBeVisible()
  },
} satisfies Story

export const CopyConfirmation = {
  args: { text: 'agent_01H9X2', label: 'Copy agent id' },
  render: (args) => (
    <StoryStage
      eyebrow="Primitives / Copy"
      title="Confirm in the accessible name, not a tooltip"
      description="After a successful write the icon swaps and the button announces itself as complete."
    >
      <StorySection title="After copying" description="The acknowledgement is short and non-blocking.">
        <div className="flex min-w-0 items-center gap-bakin-2">
          <code className="min-w-0 flex-1 break-all font-bakin-typography-family-mono">{args.text}</code>
          <CopyButton {...args} />
        </div>
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await userEvent.click(canvas.getByRole('button', { name: 'Copy agent id' }))
    // The name carries the result; a title tooltip would announce nothing.
    await expect(await canvas.findByRole('button', { name: 'Copy agent id complete' })).toBeVisible()
  },
} satisfies Story

export const NamingMultipleActions = {
  args: { text: 'agent_01H9X2', label: 'Copy agent id' },
  render: (args) => (
    <StoryStage
      eyebrow="Primitives / Copy"
      title="Name each action for what it copies"
      description="Several copy buttons on one page stay distinguishable when each carries the object in its label."
    >
      <StorySection title="Distinct labels" description="Never ship a page of identical “Copy” actions.">
        <div className="grid gap-bakin-2">
          <div className="flex min-w-0 items-center gap-bakin-2">
            <code className="min-w-0 flex-1 break-all font-bakin-typography-family-mono">{args.text}</code>
            <CopyButton {...args} />
          </div>
          <div className="flex min-w-0 items-center gap-bakin-2">
            <code className="min-w-0 flex-1 break-all font-bakin-typography-family-mono">
              /Users/example/.bakin/agents/main
            </code>
            <CopyButton text="/Users/example/.bakin/agents/main" label="Copy workspace path" />
          </div>
        </div>
      </StorySection>
    </StoryStage>
  ),
} satisfies Story

export const TouchSize = {
  args: { text: 'git status --short', label: 'Copy selection', size: 'touch' },
  render: (args) => (
    <StoryStage
      eyebrow="Primitives / Copy"
      title="A 44px target where copying is the point"
      description="A tap-to-copy prompt on a phone: the copy is its own tap (a fresh user gesture), so the target meets the touch minimum."
    >
      <StorySection title="Tap to copy" description="The same acknowledgement as the compact action: the icon and the accessible name.">
        <div className="flex min-w-0 items-center gap-bakin-2">
          <code className="min-w-0 flex-1 break-all font-bakin-typography-family-mono">{args.text}</code>
          <CopyButton {...args} />
        </div>
      </StorySection>
    </StoryStage>
  ),
  // Does not click (the success state reverts on a timer; CopyConfirmation covers it).
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const button = canvas.getByRole('button', { name: 'Copy selection' })
    const box = button.getBoundingClientRect()
    await expect(box.width).toBeGreaterThanOrEqual(44)
    await expect(box.height).toBeGreaterThanOrEqual(44)
    // The icon grows with the target (16px), still decorative.
    const icon = button.querySelector('svg')!.getBoundingClientRect()
    await expect(icon.width).toBe(16)
    await expect(icon.height).toBe(16)
  },
} satisfies Story
