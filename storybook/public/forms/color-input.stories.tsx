import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, fireEvent } from 'storybook/test'

import { ColorInput } from '@makinbakin/sdk/patterns'
import { Input } from '@makinbakin/sdk/ui'

import { StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Components/Forms/ColorInput',
  component: ColorInput,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'ColorInput is the freeform color choice: a kit-styled swatch over the platform color dialog, emitting normalized `#rrggbb` values. Use it when any color is valid and the consumer owns the value — typically paired with a hex text field showing the same value. For a fixed palette of named options use ColorPicker instead. The popup is the platform color dialog today; a kit-owned picker may replace it later without any consumer contract change — value in, normalized hex out is the whole interface.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'keyboard', 'disabled', 'validation'],
  },
} satisfies Meta<typeof ColorInput>

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  args: { ariaLabel: 'Primary brand color', value: '#ff5a00', onValueChange: () => {} },
  argTypes: {
    value: { control: 'color' },
    disabled: { control: 'boolean' },
    ariaLabel: { control: 'text' },
    // The consumer owns the value; the handler is wiring, not a control.
    onValueChange: { control: false },
  },
  play: async ({ canvas }) => {
    const input = canvas.getByLabelText<HTMLInputElement>('Primary brand color')
    await expect(input).toBeVisible()
    await expect(input).toHaveValue('#ff5a00')
  },
} satisfies Story

function PairedHexExample({ initialValue }: { initialValue: string }) {
  const [hex, setHex] = useState(initialValue)
  const invalid = !/^#[0-9a-f]{6}$/i.test(hex.trim())
  return (
    <StoryStage
      eyebrow="Brand palette"
      title="Swatch and hex are one value"
      description="Editing either view updates both. The text field keeps freeform typing (and honest invalid state); the swatch opens the platform dialog."
    >
      <StorySection title="Paired hex field">
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--bakin-layout-space-2)' }}>
          <ColorInput ariaLabel="Primary color swatch" value={hex} onValueChange={setHex} />
          <Input
            aria-label="Primary color hex"
            aria-invalid={invalid || undefined}
            value={hex}
            onChange={(event) => setHex(event.target.value)}
            style={{ maxWidth: '9rem' }}
          />
        </div>
        <p role="status">Value: {hex}</p>
      </StorySection>
      <StorySection title="Disabled">
        <ColorInput ariaLabel="Locked color" value="#16a34a" onValueChange={() => {}} disabled />
      </StorySection>
    </StoryStage>
  )
}

export const PairedHexField = {
  args: { value: '#1d4ed8', onValueChange: () => {} },
  render: (args) => <PairedHexExample initialValue={args.value} />,
  play: async ({ canvas }) => {
    const swatch = canvas.getByLabelText<HTMLInputElement>('Primary color swatch')
    await expect(swatch).toHaveValue('#1d4ed8')
    // The platform dialog can't open in tests; fire the change it would emit.
    fireEvent.change(swatch, { target: { value: '#a21caf' } })
    await expect(canvas.getByRole('status')).toHaveTextContent('Value: #a21caf')
    await expect(canvas.getByLabelText('Primary color hex')).toHaveValue('#a21caf')
    await expect(canvas.getByLabelText('Locked color')).toBeDisabled()
  },
} satisfies Story
