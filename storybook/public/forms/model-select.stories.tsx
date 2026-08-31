import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, userEvent, waitFor, within } from 'storybook/test'

import { DEFAULT_MODEL_VALUE, ModelSelect } from '@makinbakin/sdk/patterns'

import { StorySection, StoryStage } from '../../support'

const meta = {
  title: 'Components/Forms/ModelSelect',
  component: ModelSelect,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'ModelSelect is the controlled provider-grouped model choice. The consumer owns the catalog and persistence; the select groups models by provider, keeps unavailable entries disabled, surfaces the workspace default through `defaultLabel`, keeps a saved value readable even when it is missing from the catalog, and disables the trigger when the controlled catalog is empty instead of opening an empty popup.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'keyboard', 'disabled', 'empty', 'long-content'],
  },
} satisfies Meta<typeof ModelSelect>

export default meta
type Story = StoryObj<typeof meta>

const models = [
  { id: 'acme-fast', name: 'Acme Fast', provider: 'acme-cloud' },
  { id: 'acme-reasoning', name: 'Acme Reasoning With A Deliberately Long Catalog Name', provider: 'acme-cloud' },
  { id: 'local-small', name: 'Local Small', provider: 'local' },
  { id: 'retired', name: 'Retired preview', provider: 'legacy', disabled: true },
]

const fieldStyle = {
  display: 'grid',
  gap: 'var(--bakin-layout-space-2)',
  width: 'min(100%, 34rem)',
} as const

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  args: {
    id: 'canonical-model',
    value: DEFAULT_MODEL_VALUE,
    onValueChange: () => {},
    // The provider-grouped catalog is consumer-owned fixture data.
    models,
    defaultLabel: 'Use workspace default',
  },
  argTypes: {
    disabled: { control: 'boolean' },
    defaultLabel: { control: 'text' },
    placeholder: { control: 'text' },
    value: { control: false },
    models: { control: false },
    // Paired with the visible label element in render.
    id: { control: false },
  },
  render: (args) => (
    <div style={{ width: 'min(80vw, 20rem)' }}>
      <label htmlFor="canonical-model">Model</label>
      <ModelSelect {...args} />
    </div>
  ),
  play: async ({ canvas }) => {
    const trigger = canvas.getByRole('combobox', { name: 'Model' })
    await expect(trigger).toHaveTextContent('Use workspace default')
    trigger.focus()
    await userEvent.keyboard('{Enter}')
    const page = within(document.body)
    await waitFor(() => expect(page.getByRole('listbox')).toBeVisible())
    await expect(page.getByRole('option', { name: 'Acme Fast' })).toBeVisible()
    await userEvent.click(page.getByRole('option', { name: 'Acme Fast' }))
    await waitFor(() => expect(page.queryByRole('listbox')).not.toBeInTheDocument())
  },
} satisfies Story

function GroupedCatalogExample() {
  const [model, setModel] = useState(DEFAULT_MODEL_VALUE)
  return (
    <StoryStage
      eyebrow="Models / provider catalog"
      title="Keep catalog choices explicit"
      description="Providers group model choices, unavailable entries stay disabled, and the workspace default remains a first-class option."
    >
      <StorySection title="Execution defaults">
        <div style={fieldStyle}>
          <label htmlFor="picker-model">Model</label>
          <ModelSelect
            id="picker-model"
            value={model}
            onValueChange={setModel}
            models={models}
            defaultLabel="Use workspace default"
          />
        </div>
        <p role="status">Model: {model}.</p>
      </StorySection>
    </StoryStage>
  )
}

export const GroupedCatalog = {
  // Type-satisfying only: the stateful example owns its props.
  args: { value: DEFAULT_MODEL_VALUE, onValueChange: () => {}, models },
  render: () => <GroupedCatalogExample />,
  play: async ({ canvas }) => {
    const model = canvas.getByRole('combobox', { name: 'Model' })
    model.focus()
    await userEvent.keyboard('{Enter}')
    const page = within(document.body)
    await waitFor(() => expect(page.getByRole('listbox')).toBeVisible())
    await expect(page.getByRole('option', { name: 'Retired preview' })).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(page.getByRole('option', { name: 'Local Small' }))
    await expect(canvas.getByRole('status')).toHaveTextContent('Model: local-small.')
  },
} satisfies Story

export const UnavailableModelCatalog = {
  args: { id: 'unavailable-picker-model', value: 'acme/saved-model', onValueChange: () => {}, models: [] },
  render: (args) => (
    <StoryStage
      eyebrow="Models / provider catalog"
      title="Keep the saved model readable when the catalog is unavailable"
      description="An empty controlled catalog disables the trigger instead of opening an empty popup."
    >
      <StorySection title="Execution defaults">
        <div style={fieldStyle}>
          <label htmlFor="unavailable-picker-model">Model</label>
          <ModelSelect {...args} />
        </div>
      </StorySection>
    </StoryStage>
  ),
  play: async ({ canvas }) => {
    const trigger = canvas.getByRole('combobox', { name: 'Model' })
    await expect(trigger).toBeDisabled()
    await expect(trigger).toHaveTextContent('acme/saved-model')
  },
} satisfies Story
