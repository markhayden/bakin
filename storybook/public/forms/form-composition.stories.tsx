import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect } from 'storybook/test'

import { Grid, PageShell, Section, Stack } from '@makinbakin/sdk/layout'
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Checkbox,
  Field,
  FieldControl,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  Fieldset,
  FieldsetDescription,
  FieldsetLegend,
  Form,
  FormActions,
  Input,
  SubmitButton,
  Switch,
  Textarea,
} from '@makinbakin/sdk/ui'

import './forms.stories.css'

const meta = {
  title: 'Forms/Field and form composition',
  tags: ['public'],
  parameters: {
    layout: 'fullscreen',
    docs: {
      description: {
        component: 'Field mechanically connects labels, descriptions, validation, and controls. Fieldset groups related choices. FormActions and SubmitButton provide responsive ordering and one busy-state source of truth. Form libraries may manage data, but they do not own this presentation contract.',
      },
    },
    bakinCoverage: ['desktop', 'mobile-320', 'keyboard', 'validation', 'busy', 'disabled', 'error'],
  },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const CanonicalUsage = {
  parameters: { layout: 'centered' },
  // Width frame: Form's container-type zeroes its intrinsic width, so the
  // centered (shrink-to-fit) canvas would collapse it to min-content. In the
  // app forms sit in block flow where width is inherited.
  render: () => (
    <div style={{ inlineSize: '40rem', maxInlineSize: '100%' }}>
      <Form aria-label="Workspace settings">
        <Field name="workspaceName">
          <FieldLabel requirement="required">Workspace name</FieldLabel>
          <FieldDescription>Shown in page chrome and plugin-contributed sections.</FieldDescription>
          <Input required defaultValue="Acme creator operations" />
        </Field>
        <FormActions>
          <Button type="button" variant="outline">Cancel</Button>
          <SubmitButton>Save settings</SubmitButton>
        </FormActions>
      </Form>
    </div>
  ),
  play: async ({ canvas }) => {
    const input = canvas.getByRole('textbox', { name: 'Workspace name' })
    await expect(input).toBeVisible()
    await expect(input).toBeRequired()
    await expect(input.getBoundingClientRect().width).toBeGreaterThan(300)
    await expect(canvas.getByRole('button', { name: 'Save settings' })).toBeEnabled()
  },
} satisfies Story

function FormStoryHeader({ title, description }: { title: string; description: string }) {
  return (
    <header className="bakin-form-story__intro">
      <p className="bakin-form-story__eyebrow">Forms / canonical composition</p>
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  )
}

export const Overview = {
  render: () => (
    <PageShell width="content" className="bakin-form-story">
      <FormStoryHeader
        title="One form language for every builder"
        description="Fields carry their accessible relationships and Product Character rhythm with them, whether they ship in core, an official Bits plugin, or a third-party extension."
      />

      <Form aria-label="Workspace settings specimen">
        <Section spacing="compact" aria-labelledby="identity-fields-title">
          <Stack gap="dense">
            <h2 id="identity-fields-title">Identity fields</h2>
            <p className="bakin-form-story__section-description">The common states do not require custom spacing, label rows, or validation markup.</p>
          </Stack>
          <Grid layout="split" gap="section">
            <Field name="workspaceName">
              <FieldLabel requirement="required">Workspace name</FieldLabel>
              <FieldDescription>Shown in page chrome and plugin-contributed sections.</FieldDescription>
              <Input required defaultValue="Acme creator operations" />
            </Field>
            <Field name="workspaceId">
              <FieldLabel>Workspace identifier</FieldLabel>
              <FieldDescription>Generated at creation and stable in routes.</FieldDescription>
              <Input readOnly defaultValue="brand:acme-creator-operations" />
            </Field>
            <Field name="summary">
              <FieldLabel requirement="optional">Operational summary</FieldLabel>
              <FieldDescription>Markdown is supported. Keep the summary under 240 characters.</FieldDescription>
              <FieldControl render={<Textarea rows={4} defaultValue="Campaign delivery and creator operations" />} />
            </Field>
            <Field invalid name="domain">
              <FieldLabel requirement="required">Public asset domain</FieldLabel>
              <FieldDescription>Use a hostname without spaces.</FieldDescription>
              <Input required defaultValue="acme labs.example" />
              <FieldError match>Enter a valid hostname without spaces.</FieldError>
            </Field>
            <Field disabled name="billingKey">
              <FieldLabel>External billing key</FieldLabel>
              <FieldDescription>Unavailable until provider billing is connected.</FieldDescription>
              <Input defaultValue="Not connected" />
            </Field>
          </Grid>
        </Section>

        <Section spacing="compact" divider="top" aria-labelledby="contribution-fields-title">
          <Fieldset>
            <FieldsetLegend id="contribution-fields-title">Contribution settings</FieldsetLegend>
            <FieldsetDescription>Independent choices use horizontal fields without rebuilding label and description alignment.</FieldsetDescription>
            <FieldGroup>
              <Field orientation="horizontal" name="officialSections">
                <Checkbox defaultChecked />
                <FieldLabel>Allow official plugins to contribute detail sections</FieldLabel>
                <FieldDescription>Core and Bits use the same ownership, containment, and token contract.</FieldDescription>
              </Field>
              <Field orientation="horizontal" name="approvalRequired">
                <Switch defaultChecked />
                <FieldLabel>Require approval before publishing assets</FieldLabel>
                <FieldDescription>The setting takes effect only after this form is saved.</FieldDescription>
              </Field>
            </FieldGroup>
          </Fieldset>
        </Section>

        <FormActions>
          <Button type="button" variant="outline">Cancel</Button>
          <SubmitButton>Save settings</SubmitButton>
        </FormActions>
      </Form>

      <Section spacing="compact" divider="top" aria-labelledby="submission-states-title">
        <Stack gap="dense">
          <h2 id="submission-states-title">Submission feedback</h2>
          <p className="bakin-form-story__section-description">Page-level feedback stays near the form while field-specific errors remain attached to their controls.</p>
        </Stack>
        <Grid layout="split" gap="item">
          <Alert tone="danger"><AlertTitle>Settings were not saved</AlertTitle><AlertDescription>Review the highlighted field, then try again.</AlertDescription></Alert>
          <Alert tone="success"><AlertTitle>Workspace settings saved</AlertTitle><AlertDescription>Plugin contributions now use the updated defaults.</AlertDescription></Alert>
        </Grid>
        <Form busy aria-label="Busy submission example">
          <FormActions><SubmitButton busyLabel="Saving settings">Save settings</SubmitButton></FormActions>
        </Form>
      </Section>
    </PageShell>
  ),
} satisfies Story

function AsyncValidationExample() {
  return (
    <PageShell width="content" className="bakin-form-story bakin-form-story--workflow">
      <FormStoryHeader title="Async field validation" description="Blur the slug field to run the same domain validation contract with or without a form-state library." />
      <Form validationMode="onBlur" aria-label="Async validation example">
        <Field
          name="slug"
          validate={async (value) => {
            await new Promise((resolve) => setTimeout(resolve, 80))
            return String(value).startsWith('plugin-') ? null : 'Use a plugin- prefix.'
          }}
        >
          <FieldLabel requirement="required">Plugin slug</FieldLabel>
          <FieldDescription>Stable identifier used in plugin-owned routes and storage.</FieldDescription>
          <Input required defaultValue="workflow-tools" />
          <FieldError />
        </Field>
        <FormActions><SubmitButton>Continue</SubmitButton></FormActions>
      </Form>
    </PageShell>
  )
}

export const AsyncValidation = {
  render: () => <AsyncValidationExample />,
  play: async ({ canvas, userEvent }) => {
    const slug = canvas.getByRole('textbox', { name: 'Plugin slug' })
    await userEvent.click(slug)
    await userEvent.tab()
    await expect(canvas.findByText('Use a plugin- prefix.')).resolves.toBeVisible()
    await userEvent.clear(slug)
    await userEvent.type(slug, 'plugin-workflow-tools')
    await userEvent.tab()
    await expect(canvas.queryByText('Use a plugin- prefix.')).not.toBeInTheDocument()
  },
} satisfies Story

type WorkflowValues = { workspaceName: string; slug: string }
type Feedback = 'error' | 'success' | null

function SubmissionWorkflowExample() {
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [feedback, setFeedback] = useState<Feedback>(null)

  async function submit(values: WorkflowValues) {
    setBusy(true)
    setErrors({})
    setFeedback(null)
    await new Promise((resolve) => setTimeout(resolve, 120))
    if (values.slug === 'plugin-existing') {
      setErrors({ slug: 'This plugin slug is already registered.' })
      setFeedback('error')
    } else {
      setFeedback('success')
    }
    setBusy(false)
  }

  return (
    <PageShell width="content" className="bakin-form-story bakin-form-story--workflow">
      <FormStoryHeader title="Submission workflow" description="Server errors return to the exact field; success is announced without replacing the page; one busy flag prevents duplicate saves." />
      <Form<WorkflowValues>
        aria-label="Plugin registration"
        busy={busy}
        errors={errors}
        onFormSubmit={submit}
      >
        <Field name="workspaceName">
          <FieldLabel requirement="required">Workspace name</FieldLabel>
          <FieldDescription>Owner displayed beside the plugin contribution.</FieldDescription>
          <Input required defaultValue="Bakin official extensions" />
        </Field>
        <Field name="slug">
          <FieldLabel requirement="required">Plugin slug</FieldLabel>
          <FieldDescription>Must be unique across installed plugins.</FieldDescription>
          <Input
            required
            defaultValue="plugin-existing"
            onChange={() => {
              setErrors({})
              setFeedback(null)
            }}
          />
          <FieldError />
        </Field>

        {feedback === 'error' ? (
          <Alert tone="danger"><AlertTitle>Plugin was not registered</AlertTitle><AlertDescription>Correct the slug and submit again.</AlertDescription></Alert>
        ) : null}
        {feedback === 'success' ? (
          <Alert tone="success"><AlertTitle>Plugin registered</AlertTitle><AlertDescription>The contribution is ready for its conformance review.</AlertDescription></Alert>
        ) : null}

        <FormActions>
          <Button type="button" variant="outline" disabled={busy}>Cancel</Button>
          <SubmitButton busyLabel="Registering plugin">Register plugin</SubmitButton>
        </FormActions>
      </Form>
    </PageShell>
  )
}

export const SubmissionWorkflow = {
  render: () => <SubmissionWorkflowExample />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Register plugin' }))
    await expect(canvas.findByRole('button', { name: 'Registering plugin' })).resolves.toBeDisabled()
    await expect(canvas.findByText('Plugin was not registered')).resolves.toBeVisible()
    await expect(canvas.getByRole('textbox', { name: 'Plugin slug' })).toHaveAttribute('aria-invalid', 'true')

    const slug = canvas.getByRole('textbox', { name: 'Plugin slug' })
    await userEvent.clear(slug)
    await userEvent.type(slug, 'plugin-routing-tools')
    await userEvent.click(canvas.getByRole('button', { name: 'Register plugin' }))
    await expect(canvas.findByRole('status')).resolves.toHaveTextContent('Plugin registered')
  },
} satisfies Story
