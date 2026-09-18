import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect, waitFor, within } from 'storybook/test'

import { PageShell, Stack } from '@makinbakin/sdk/layout'
import {
  PluginSettingsRenderer,
  type PluginSettingsFeedback,
  type PluginSettingsSchema,
} from '@makinbakin/sdk/patterns'

import './forms.stories.css'

const meta = {
  title: 'Components/Forms/Plugin settings renderer',
  component: PluginSettingsRenderer,
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'PluginSettingsRenderer turns the public settings schema into an accessible draft form. Builders retain persistence, busy state, save feedback, routing, and notifications.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'keyboard', 'validation', 'busy', 'disabled', 'error', 'long-content', 'dense-data', 'official-bits', 'deep-link'],
  },
} satisfies Meta<typeof PluginSettingsRenderer>

export default meta
type Story = StoryObj<typeof meta>

const canonicalSchema: PluginSettingsSchema = {
  fields: [
    {
      key: 'workspaceName',
      type: 'string',
      label: 'Workspace name',
      description: 'Shown to collaborators when they plan content.',
      required: true,
    },
    {
      key: 'requiresApproval',
      type: 'boolean',
      label: 'Require approval before publishing',
      default: true,
    },
  ],
}

export const CanonicalUsage = {
  args: {
    schema: canonicalSchema,
    values: { workspaceName: 'Creator operations', requiresApproval: true },
    onSubmit: () => {},
  },
  parameters: { layout: 'centered' },
  argTypes: {
    busy: { control: 'boolean' },
    disabled: { control: 'boolean' },
    saveLabel: { control: 'text' },
    ariaLabel: { control: 'text' },
    // Schema, values, and feedback are consumer-owned data; handlers are wiring.
    schema: { control: false },
    values: { control: false },
    feedback: { control: false },
    onSubmit: { control: false },
    onValidationError: { control: false },
  },
  // Width frame: the renderer's settings rows are container-typed, zeroing
  // intrinsic width — the centered (shrink-to-fit) canvas would collapse them.
  render: (args) => (
    <div style={{ inlineSize: '40rem', maxInlineSize: '100%' }}>
      <PluginSettingsRenderer {...args} />
    </div>
  ),
  play: async ({ canvas, userEvent }) => {
    const workspace = canvas.getByRole('textbox', { name: 'Workspace name' })
    await expect(workspace).toHaveValue('Creator operations')
    await expect(workspace.getBoundingClientRect().width).toBeGreaterThan(250)
    await expect(canvas.getByRole('button', { name: 'Save settings' })).toBeDisabled()
    await userEvent.type(workspace, ' team')
    await expect(canvas.getByRole('button', { name: 'Save settings' })).toBeEnabled()
  },
} satisfies Story

const messagingSchema: PluginSettingsSchema = {
  fields: [
    {
      key: 'workspaceName',
      type: 'string',
      label: 'Messaging workspace name',
      description: 'Shown to collaborators when they plan and approve content.',
      required: true,
    },
    {
      key: 'defaultLeadHours',
      type: 'number',
      label: 'Default preparation lead hours',
      description: 'Used when a content type does not supply a more specific lead time.',
      default: 24,
    },
    {
      key: 'requiresApproval',
      type: 'boolean',
      label: 'Require approval before publishing',
      description: 'New deliverables pause for a human decision before their publish step.',
      default: true,
    },
    {
      key: 'defaultAssetRequirement',
      type: 'select',
      label: 'Default asset requirement',
      options: [
        { value: 'none', label: 'No asset required' },
        { value: 'image', label: 'At least one image' },
        { value: 'approved', label: 'Approved library asset' },
      ],
      default: 'image',
    },
    {
      key: 'contentTypes',
      type: 'list',
      label: 'Content types',
      description: 'Official Messaging uses this full list shape; third-party schemas receive the same responsive composition.',
      addLabel: 'Add content type',
      minItems: 1,
      maxItems: 4,
      uniqueField: 'id',
      itemShape: {
        id: { key: 'id', type: 'string', label: 'ID', required: true },
        label: { key: 'label', type: 'string', label: 'Label', required: true },
        workflowId: { key: 'workflowId', type: 'string', label: 'Workflow ID' },
        defaultAgent: { key: 'defaultAgent', type: 'string', label: 'Default agent' },
        prepLeadHours: { key: 'prepLeadHours', type: 'number', label: 'Prep lead hours', default: 0 },
        requiresApproval: { key: 'requiresApproval', type: 'boolean', label: 'Requires approval' },
        assetRequirement: {
          key: 'assetRequirement',
          type: 'select',
          label: 'Asset requirement',
          options: [
            { value: 'none', label: 'None' },
            { value: 'image', label: 'Image' },
            { value: 'approved', label: 'Approved asset' },
          ],
          default: 'none',
        },
      },
    },
  ],
}

const initialValues = {
  workspaceName: 'Creator operations',
  defaultLeadHours: 24,
  requiresApproval: true,
  defaultAssetRequirement: 'image',
  contentTypes: [{
    id: 'campaign-post',
    label: 'Campaign post with an intentionally complete builder-facing label',
    workflowId: 'publish-campaign-post',
    defaultAgent: 'main',
    prepLeadHours: 18,
    requiresApproval: true,
    assetRequirement: 'approved',
  }],
}

function MessagingSettingsExample() {
  const [values, setValues] = useState<Record<string, unknown>>(initialValues)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<PluginSettingsFeedback | null>(null)

  function save(nextValues: Record<string, unknown>) {
    setBusy(true)
    setFeedback(null)
    window.setTimeout(() => {
      setValues(nextValues)
      setBusy(false)
      setFeedback({
        tone: 'success',
        title: 'Messaging settings saved',
        description: 'New plans use the updated content-type defaults.',
      })
    }, 120)
  }

  return (
    <PageShell width="content" className="bakin-form-story bakin-form-story--workflow">
      <Stack gap="section">
        <header className="bakin-form-story__intro">
          <p className="bakin-form-story__eyebrow">Official Bits / schema rendering</p>
          <h1>Let plugin settings feel native without hiding their rules</h1>
          <p>Schema fields get the same labels, validation, spacing, responsive action order, and durable feedback as core settings. The host still owns loading, saving, and routes.</p>
        </header>
        <PluginSettingsRenderer
          schema={messagingSchema}
          values={values}
          busy={busy}
          feedback={feedback}
          onSubmit={save}
          onValidationError={() => setFeedback({
            tone: 'error',
            title: 'Settings were not saved',
            description: 'Correct the attached field error, then try again.',
          })}
        />
      </Stack>
    </PageShell>
  )
}

export const MessagingSchemaWorkflow = {
  args: { schema: messagingSchema, values: initialValues, onSubmit: () => {} },
  render: () => <MessagingSettingsExample />,
  play: async ({ canvas, userEvent }) => {
    const workspace = canvas.getByRole('textbox', { name: 'Messaging workspace name' })
    await userEvent.clear(workspace)
    await userEvent.click(canvas.getByRole('button', { name: 'Save settings' }))
    await expect(canvas.getByText('Messaging workspace name is required')).toBeVisible()

    await userEvent.type(workspace, 'Publishing operations')
    await userEvent.click(canvas.getByRole('button', { name: 'Add content type' }))
    const rows = canvas.getAllByRole('group', { name: /Content types row/ })
    const newRow = within(rows[1]!)
    await userEvent.type(newRow.getByRole('textbox', { name: 'ID' }), 'release-note')
    await userEvent.type(newRow.getByRole('textbox', { name: 'Label' }), 'Release note')
    await userEvent.click(canvas.getByRole('button', { name: 'Save settings' }))
    await expect(canvas.getByRole('button', { name: 'Saving settings' })).toBeDisabled()
    await waitFor(() => expect(canvas.getByRole('status')).toHaveTextContent('Messaging settings saved'))
  },
} satisfies Story

export const BusyAndUnavailable = {
  args: { schema: messagingSchema, values: initialValues, onSubmit: () => {} },
  render: () => (
    <PageShell width="content" className="bakin-form-story bakin-form-story--workflow">
      <Stack gap="section">
        <header className="bakin-form-story__intro">
          <p className="bakin-form-story__eyebrow">Persistence states</p>
          <h1>Keep host-owned availability explicit</h1>
          <p>The renderer does not infer network state. Consumers supply busy or disabled truth and durable save feedback.</p>
        </header>
        <PluginSettingsRenderer
          ariaLabel="Busy Messaging settings"
          schema={{ fields: messagingSchema.fields.slice(0, 4) }}
          values={initialValues}
          onSubmit={() => {}}
          busy
          feedback={{ tone: 'error', title: 'Settings could not be saved', description: 'The Messaging service did not respond. Your current page remains available.' }}
        />
      </Stack>
    </PageShell>
  ),
  play: async ({ canvas }) => {
    await expect(canvas.getByRole('form', { name: 'Busy Messaging settings' })).toHaveAttribute('aria-busy', 'true')
    await expect(canvas.getByRole('button', { name: 'Saving settings' })).toBeDisabled()
    await expect(canvas.getByRole('alert')).toHaveTextContent('Settings could not be saved')
  },
} satisfies Story

const accessRoster = [
  { id: 'main', name: 'Roscoe', color: '#22c55e' },
  { id: 'patch', name: 'Patch', color: '#6366f1' },
  { id: 'scout', name: 'Scout', color: '#f59e0b' },
]

const accessSchema: PluginSettingsSchema = {
  fields: [{
    key: 'enabledAgents',
    type: 'agent-toggles',
    label: 'Enable terminal access',
    description: 'Enabled agents can open and operate terminal sessions.',
    default: ['main'],
  }],
}

function AgentTogglesExample() {
  const [values, setValues] = useState<Record<string, unknown>>({ enabledAgents: ['main'] })
  return (
    <PageShell width="content" className="bakin-form-story bakin-form-story--workflow">
      <Stack gap="section">
        <header className="bakin-form-story__intro">
          <p className="bakin-form-story__eyebrow">Per-agent enablement</p>
          <h1>Gate a feature per agent with a roster grid</h1>
          <p>The consumer supplies the roster; each agent renders as an avatar and a toggle. The stored value is the array of enabled agent ids.</p>
        </header>
        <PluginSettingsRenderer schema={accessSchema} values={values} agents={accessRoster} onSubmit={setValues} />
      </Stack>
    </PageShell>
  )
}

export const AgentTogglesGrid = {
  args: { schema: accessSchema, values: { enabledAgents: ['main'] }, agents: accessRoster, onSubmit: () => {} },
  render: () => <AgentTogglesExample />,
  play: async ({ canvas, userEvent }) => {
    // Roster renders one switch per agent; the default enables main only.
    await expect(canvas.getByRole('switch', { name: 'Enable Roscoe' })).toBeChecked()
    const patch = canvas.getByRole('switch', { name: 'Enable Patch' })
    await expect(patch).not.toBeChecked()
    await userEvent.click(patch)
    await expect(patch).toBeChecked()
    await userEvent.click(canvas.getByRole('button', { name: 'Save settings' }))
  },
} satisfies Story

export const HighlightedField = {
  args: {
    schema: messagingSchema,
    values: initialValues,
    onSubmit: () => {},
    highlightKey: 'requiresApproval',
  },
  parameters: {
    docs: {
      description: {
        story: 'A settings deep link (`/settings?tab=<category>&field=<key>`) names one field. The renderer marks it `data-highlighted`, scrolls it into view once, and never steals focus — the host page owns the URL and passes the key through.',
      },
    },
  },
  render: (args) => (
    <PageShell width="content" className="bakin-form-story bakin-form-story--workflow">
      <Stack gap="section">
        <header className="bakin-form-story__intro">
          <p className="bakin-form-story__eyebrow">Deep link target</p>
          <h1>Land the reader on the setting the link named</h1>
          <p>Health incidents and other producers link straight to a field. The tint marks the target; the form stays fully editable.</p>
        </header>
        <PluginSettingsRenderer {...args} />
      </Stack>
    </PageShell>
  ),
  play: async ({ canvas }) => {
    const target = canvas.getByRole('switch', { name: 'Require approval before publishing' })
    const field = target.closest('[data-highlighted="true"]')
    await expect(field).not.toBeNull()
    await expect(canvas.getAllByRole('switch').filter((el) => el.closest('[data-highlighted]'))).toHaveLength(1)
    await expect(target).not.toHaveFocus()
  },
} satisfies Story
