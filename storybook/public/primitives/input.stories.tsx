import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect } from 'storybook/test'

import { Grid } from '@makinbakin/sdk/layout'
import { Field, FieldDescription, FieldError, FieldLabel, Input } from '@makinbakin/sdk/ui'

import { StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Primitives/Input',
  component: Input,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: { description: { component: 'Input is the low-level native input contract, including text-like fields and file selection. Preserve type, inputMode, autoComplete, required, readOnly, disabled, accept, multiple, and aria-invalid attributes. Prefer the SDK field pattern for routine form composition; a raw native input is reserved for documented domain-interface exceptions.' } },
    bakinCoverage: ['desktop', 'mobile-320', 'keyboard', 'disabled', 'error', 'long-labels'],
  },
} satisfies Meta<typeof Input>

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  args: {
    disabled: false,
    readOnly: false,
    'aria-invalid': false,
  },
  argTypes: {
    disabled: { control: 'boolean' },
    readOnly: { control: 'boolean' },
    'aria-invalid': { control: 'boolean' },
  },
  // aria-invalid only lands in the DOM when true so the default render stays
  // byte-identical to a plain valid field.
  render: ({ 'aria-invalid': invalid, ...args }) => (
    <Field name="workflowName">
      <FieldLabel>Workflow name</FieldLabel>
      <Input placeholder="Nightly digest" {...args} aria-invalid={invalid || undefined} />
    </Field>
  ),
  play: async ({ canvas, userEvent, args }) => {
    const input = canvas.getByRole('textbox', { name: 'Workflow name' })
    if (args.disabled) {
      await expect(input).toBeDisabled()
      return
    }
    if (args.readOnly) {
      await expect(input).toHaveAttribute('readonly')
      return
    }
    await userEvent.type(input, 'Publish weekly digest')
    await expect(input).toHaveValue('Publish weekly digest')
  },
} satisfies Story

export const StatesAndMobileModes = {
  render: () => (
    <StoryStage
      eyebrow="Single-line entry"
      title="Input"
      description="State is semantic first and visual second; mobile modes ask for the appropriate virtual keyboard."
    >
      <StorySection title="States">
        <Grid layout="split" gap="section">
          <Field name="default">
            <FieldLabel>Default</FieldLabel>
            <Input placeholder="Workflow name" />
          </Field>
          <Field name="ownerEmail">
            <FieldLabel>Required email</FieldLabel>
            <Input type="email" inputMode="email" autoComplete="email" required defaultValue="owner@example.com" />
          </Field>
          <Field name="oneTimeCode">
            <FieldLabel>Numeric mobile mode</FieldLabel>
            <Input type="text" inputMode="numeric" autoComplete="one-time-code" defaultValue="482901" />
          </Field>
          <Field name="identifier">
            <FieldLabel>Read-only identifier</FieldLabel>
            <Input readOnly value="plugin://research/collector/production" />
          </Field>
          <Field disabled name="managedSource">
            <FieldLabel>Disabled source</FieldLabel>
            <Input disabled value="Managed by core" />
          </Field>
          <Field invalid name="webhookUrl">
            <FieldLabel>Invalid URL</FieldLabel>
            <Input type="url" inputMode="url" value="internal-host" readOnly />
            <FieldError match>Enter a complete HTTPS URL.</FieldError>
          </Field>
          <Field name="imageFile">
            <FieldLabel>Image file</FieldLabel>
            <FieldDescription>Use a canonical Button to activate a visually hidden file Input when the picker needs a custom trigger.</FieldDescription>
            <Input type="file" accept="image/jpeg,image/png,image/webp" />
          </Field>
        </Grid>
      </StorySection>
      <StorySection
        title="Long value pressure"
        description="The control stays inside a narrow container while the native text viewport scrolls."
      >
        <div style={{ maxWidth: '24rem' }}>
          <Field name="artifactReference">
            <FieldLabel>Artifact reference</FieldLabel>
            <Input readOnly value="artifact://production/catalog/extraordinarily-long-generated-identifier-01JZ7A7RCM8S9P2B8H4VR4MVGQ" />
          </Field>
        </div>
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas, userEvent }) => {
    const defaultInput = canvas.getByRole('textbox', { name: 'Default' })
    await userEvent.type(defaultInput, 'Nightly digest')
    await expect(defaultInput).toHaveValue('Nightly digest')
    await expect(canvas.getByLabelText('Disabled source')).toBeDisabled()
    const invalid = canvas.getByRole('textbox', { name: 'Invalid URL' })
    await expect(invalid).toHaveAttribute('aria-invalid', 'true')
    await expect(invalid).toHaveAccessibleDescription('Enter a complete HTTPS URL.')
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(document.documentElement.clientWidth)
    // Settle focus so visual capture never races a caret or focus ring.
    ;(document.activeElement as HTMLElement | null)?.blur?.()
  },
} satisfies Story
