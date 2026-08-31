import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, userEvent } from 'storybook/test'

import { ColorPicker } from '@makinbakin/sdk/patterns'

import { StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Components/Forms/ColorPicker',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'ColorPicker is the controlled color-choice radio group. Consumers own the palette values; every swatch keeps an accessible name, the selected swatch carries a visible check glyph so selection never relies on color alone, and arrow-key navigation wraps across enabled options with Home/End support.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'keyboard', 'non-color'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

const colors = [
  { value: 'series-1', label: 'Ocean', color: 'var(--bakin-color-data-series-1)' },
  { value: 'series-2', label: 'Violet', color: 'var(--bakin-color-data-series-2)' },
  { value: 'series-3', label: 'Teal', color: 'var(--bakin-color-data-series-3)' },
  { value: 'series-4', label: 'Amber', color: 'var(--bakin-color-data-series-4)' },
  { value: 'series-5', label: 'Rose', color: 'var(--bakin-color-data-series-5)' },
  { value: 'series-6', label: 'Slate', color: 'var(--bakin-color-data-series-6)' },
]

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  render: () => (
    <ColorPicker ariaLabel="Agent color" value="series-1" onValueChange={() => {}} options={colors} />
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('radiogroup', { name: 'Agent color' })).toBeVisible()
    await expect(canvas.getByRole('radio', { name: 'Ocean' })).toHaveAttribute('aria-checked', 'true')
    await expect(canvas.getByRole('radio', { name: 'Violet' })).toHaveAttribute('aria-checked', 'false')
  },
} satisfies Story

function PaletteChoicesExample() {
  const [color, setColor] = useState('series-1')
  return (
    <StoryStage
      eyebrow="Models and identity"
      title="Keep palette choices explicit"
      description="Color uses keyboard-complete radio semantics with visible selection meaning; every swatch keeps a text name."
    >
      <StorySection title="Agent identity">
        <div style={{ display: 'grid', gap: 'var(--bakin-layout-space-2)', width: 'min(100%, 34rem)' }}>
          <span>Agent color</span>
          <ColorPicker ariaLabel="Agent color" value={color} onValueChange={setColor} options={colors} />
        </div>
        <p role="status">Color: {color}.</p>
      </StorySection>
    </StoryStage>
  )
}

export const PaletteChoices = {
  render: () => <PaletteChoicesExample />,
  play: async ({ canvas }) => {
    const ocean = canvas.getByRole('radio', { name: 'Ocean' })
    ocean.focus()
    await userEvent.keyboard('{ArrowRight}')
    await expect(canvas.getByRole('radio', { name: 'Violet' })).toHaveAttribute('aria-checked', 'true')
    await expect(canvas.getByRole('status')).toHaveTextContent('Color: series-2.')
  },
} satisfies Story
