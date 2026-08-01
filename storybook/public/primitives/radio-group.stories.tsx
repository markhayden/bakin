import type { Meta, StoryObj } from '@storybook/react-vite'
import { Radio, RadioGroup } from '@makinbakin/sdk/ui'
import { Stack } from '@makinbakin/sdk/layout'
import { expect } from 'storybook/test'

import { StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Primitives/RadioGroup',
  component: RadioGroup,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Use RadioGroup for one required choice among a few visible options. Every Radio keeps a visible text label (wrap it in a label element), the group carries an accessible name, and arrow keys move the selection. For yes/no use Checkbox; for many options use Select.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'keyboard', 'disabled'],
  },
} satisfies Meta<typeof RadioGroup>

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  render: () => (
    <RadioGroup aria-label="Delete scope" defaultValue="asset">
      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <Radio value="asset" />
        Delete the whole asset
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <Radio value="current" />
        Just delete the current version
      </label>
    </RadioGroup>
  ),
  play: async ({ canvas, userEvent }) => {
    const group = canvas.getByRole('radiogroup', { name: 'Delete scope' })
    await expect(group).toBeVisible()
    await expect(canvas.getByRole('radio', { name: 'Delete the whole asset' })).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(canvas.getByRole('radio', { name: 'Just delete the current version' }))
    await expect(canvas.getByRole('radio', { name: 'Just delete the current version' })).toHaveAttribute('aria-checked', 'true')
    await expect(canvas.getByRole('radio', { name: 'Delete the whole asset' })).toHaveAttribute('aria-checked', 'false')
  },
} satisfies Story

const optionRow = { display: 'flex', alignItems: 'center', gap: '0.5rem' } as const

export const States = {
  render: () => (
    <StoryStage
      eyebrow="Single choice"
      title="RadioGroup"
      description="Visible labels, one selected value per group, and a minimum 24px interactive target."
    >
      <StorySection title="Canonical states">
        <Stack gap="item" style={{ maxWidth: '40rem' }}>
          <RadioGroup aria-label="Dispatch policy" defaultValue="serialized">
            <label style={optionRow}>
              <Radio value="serialized" />
              Serialized — one turn at a time
            </label>
            <label style={optionRow}>
              <Radio value="isolated" />
              Isolated — parallel turns in separate workspaces
            </label>
            <label style={optionRow}>
              <Radio value="unsafe" disabled />
              Shared workspace (unavailable on this runtime)
            </label>
          </RadioGroup>
          <RadioGroup aria-label="Disabled group" defaultValue="a" disabled>
            <label style={optionRow}>
              <Radio value="a" />
              Disabled choice with a label long enough to wrap at 200% text zoom
            </label>
            <label style={optionRow}>
              <Radio value="b" />
              Another disabled choice
            </label>
          </RadioGroup>
        </Stack>
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('radio', { name: 'Serialized — one turn at a time' })).toHaveAttribute('aria-checked', 'true')
    await expect(canvas.getByRole('radio', { name: 'Shared workspace (unavailable on this runtime)' })).toHaveAttribute('data-disabled')
  },
} satisfies Story

export const Behavior = {
  parameters: { layout: 'centered' },
  render: () => (
    <RadioGroup aria-label="Export format" defaultValue="png">
      <label style={optionRow}>
        <Radio value="png" />
        PNG
      </label>
      <label style={optionRow}>
        <Radio value="webp" />
        WebP
      </label>
      <label style={optionRow}>
        <Radio value="svg" />
        SVG
      </label>
    </RadioGroup>
  ),
  play: async ({ canvas, userEvent }) => {
    const png = canvas.getByRole('radio', { name: 'PNG' })
    png.focus()
    await userEvent.keyboard('{ArrowDown}')
    await expect(canvas.getByRole('radio', { name: 'WebP' })).toHaveAttribute('aria-checked', 'true')
    await expect(canvas.getByRole('radio', { name: 'WebP' })).toHaveFocus()
    await userEvent.keyboard('{ArrowUp}')
    await expect(png).toHaveAttribute('aria-checked', 'true')
  },
} satisfies Story
