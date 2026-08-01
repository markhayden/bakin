import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { expect } from 'storybook/test'

import {
  Action,
  CandidateDirection,
  CandidateIntro,
  CandidateStyles,
  CheckboxField,
  FormActions,
  Grid,
  Inline,
  Overlay,
  PageShell,
  Section,
  SelectField,
  Stack,
  SystemState,
  TextAreaField,
  TextField,
  type DirectionId,
} from './candidate-ui'

const DETAIL_FORM_CSS = `
.bakin-detail-header { display: grid; gap: var(--candidate-item-gap); }
.bakin-detail-header__eyebrow { margin: var(--bakin-layout-space-0); color: var(--bakin-color-signal-accent); font-size: var(--candidate-meta-size); font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; }
.bakin-detail-header h2 { max-width: 24ch; margin: var(--bakin-layout-space-0); overflow-wrap: anywhere; font-size: var(--candidate-page-title-size); font-weight: 600; line-height: 1.04; letter-spacing: -0.035em; }
.bakin-detail-header__description { max-width: 64ch; margin: var(--bakin-layout-space-0); color: var(--bakin-color-text-muted); line-height: 1.55; }
.bakin-detail-identity { display: flex; flex-wrap: wrap; gap: var(--candidate-item-gap); color: var(--bakin-color-text-muted); font-family: var(--candidate-font-mono); font-size: var(--candidate-meta-size); }
.bakin-detail-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--candidate-section-gap); }
.bakin-detail-summary { display: grid; gap: var(--candidate-item-gap); margin: var(--bakin-layout-space-0); }
.bakin-detail-summary div { display: grid; grid-template-columns: minmax(7rem, 0.55fr) minmax(0, 1fr); gap: var(--candidate-item-gap); padding-block: var(--candidate-item-gap); border-top: 1px solid var(--bakin-color-border-subtle); }
.bakin-detail-summary dt { color: var(--bakin-color-text-muted); font-size: var(--candidate-meta-size); }
.bakin-detail-summary dd { min-width: 0; margin: var(--bakin-layout-space-0); overflow-wrap: anywhere; font-family: var(--candidate-font-mono); font-size: var(--candidate-meta-size); }
.bakin-detail-danger { padding-top: var(--candidate-section-gap); border-top: 2px solid var(--bakin-color-signal-danger); }
.bakin-detail-danger p { max-width: 64ch; margin: var(--bakin-layout-space-0) var(--bakin-layout-space-0) var(--candidate-item-gap); color: var(--bakin-color-text-muted); line-height: 1.55; }
.bakin-detail-save-status { margin: var(--bakin-layout-space-0); color: var(--bakin-color-text-muted); font-size: var(--candidate-meta-size); }
.bakin-detail-field-state-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--candidate-section-gap); }
.bakin-detail-state-stack { display: grid; gap: var(--candidate-section-gap); }
.bakin-detail-overlay-launcher { display: grid; gap: var(--candidate-section-gap); padding: var(--candidate-page-gap); }
.bakin-detail-overlay-launcher h2 { margin: var(--bakin-layout-space-0); font-size: var(--candidate-page-title-size); line-height: 1.05; }
.bakin-detail-overlay-launcher p { margin: var(--bakin-layout-space-0); color: var(--bakin-color-text-muted); line-height: 1.55; }
@media (max-width: 42rem) {
  .bakin-detail-form-grid, .bakin-detail-field-state-grid { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 24rem) {
  .bakin-detail-summary div { grid-template-columns: minmax(0, 1fr); }
  .bakin-detail-header .bakin-inline { align-items: stretch; }
}
`.trim()

function DetailForm({ direction }: { direction: DirectionId }) {
  const [dirty, setDirty] = useState(false)
  const [saved, setSaved] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  return (
    <CandidateDirection direction={direction}>
      <PageShell>
        <header className="bakin-detail-header">
          <p className="bakin-detail-header__eyebrow">Brand / workspace detail</p>
          <h2>Acme Labs creator operations</h2>
          <p className="bakin-detail-header__description">Define the identity and operating defaults shared by campaigns, project work, and official plugin contributions.</p>
          <div className="bakin-detail-identity"><span>brand:acme-labs-creator-operations</span><span>project:spring-launch-2026</span></div>
        </header>

        <FormActions aria-label="Workspace save actions">
          <p className="bakin-detail-save-status" role="status">{dirty ? 'Unsaved changes' : saved ? 'Changes saved' : 'No pending changes'}</p>
          <Action disabled={!dirty} onClick={() => { setDirty(false); setSaved(false) }}>Discard</Action>
          <Action tone="primary" disabled={!dirty} aria-label="Save Acme Labs brand" onClick={() => { setDirty(false); setSaved(true) }}>Save changes</Action>
        </FormActions>

        <Section title="Identity" description="Required names, stable identifiers, and optional product context use one field contract.">
          <div className="bakin-detail-form-grid">
            <TextField label="Workspace name" description="Shown in navigation and plugin-owned page chrome." defaultValue="Acme Labs creator operations" required onChange={() => setDirty(true)} />
            <TextField label="Workspace identifier" description="Stable route and API identifier; read-only after creation." defaultValue="brand:acme-labs-creator-operations" readOnly />
            <TextAreaField label="Description" description="A short summary used in selection and handoff surfaces." defaultValue="Marketing operations and campaign delivery" optional onChange={() => setDirty(true)} />
            <SelectField label="Default project" description="New campaign tasks inherit this project unless a workflow overrides it." defaultValue="spring" required onChange={() => setDirty(true)}>
              <option value="spring">Spring launch 2026</option><option value="evergreen">Evergreen creator program</option>
            </SelectField>
          </div>
        </Section>

        <Section title="Ownership and contribution" description="Official plugin behavior is explicit without exposing implementation-only switches.">
          <Grid columns={2}>
            <SelectField label="Owning team" description="The team accountable for review and destructive changes." defaultValue="marketing" onChange={() => setDirty(true)}>
              <option value="marketing">Marketing operations</option><option value="studio">Creative studio</option>
            </SelectField>
            <TextField label="External billing key" description="Unavailable until provider billing is connected." placeholder="Connect billing to configure" disabled />
          </Grid>
          <Stack gap="item">
            <CheckboxField label="Allow official plugins to contribute detail sections" description="Core and Bits contributions still pass the same ownership, token, and containment contracts." defaultChecked onChange={() => setDirty(true)} />
            <CheckboxField label="Require approval before publishing campaign assets" description="Review remains explicit for generated media and externally visible copy." onChange={() => setDirty(true)} />
          </Stack>
        </Section>

        <Section title="Current relationships" description="Detail data is content-first and separated by rhythm rather than nested cards.">
          <dl className="bakin-detail-summary">
            <div><dt>Primary project</dt><dd>project:spring-launch-2026</dd></div>
            <div><dt>Owning team</dt><dd>team:marketing-operations</dd></div>
            <div><dt>Last published asset</dt><dd>asset:campaign/spring-hero-final-v18.webp</dd></div>
          </dl>
        </Section>

        <Section className="bakin-detail-danger" title="Delete brand workspace" description="Destructive actions stay separated, explain impact, and require confirmation.">
          <p>Deleting this workspace removes its brand settings and disconnects 12 contributed sections. Tasks, assets, and projects remain available.</p>
          <Action tone="danger" onClick={() => setDeleteOpen(true)}>Delete workspace</Action>
        </Section>
      </PageShell>
      <Overlay open={deleteOpen} title="Delete brand workspace" description="This cannot be undone. Existing tasks and assets remain, but brand configuration and plugin contributions are removed." onClose={() => setDeleteOpen(false)} footer={<><Action onClick={() => setDeleteOpen(false)}>Cancel</Action><Action tone="danger">Confirm deletion</Action></>}>
        <TextField label="Type the workspace identifier to confirm" description="Enter brand:acme-labs-creator-operations exactly." placeholder="brand:acme-labs-creator-operations" required />
      </Overlay>
    </CandidateDirection>
  )
}

function FieldStateGallery({ direction }: { direction: DirectionId }) {
  return (
    <CandidateDirection direction={direction}>
      <PageShell>
        <Section title="Field and submission states" description="The same composition covers required, optional, read-only, disabled, validation, loading, and submitting states.">
          <div className="bakin-detail-field-state-grid">
            <TextField label="Required workspace name" description="Required fields name the constraint before validation." placeholder="Workspace name" required />
            <TextAreaField label="Optional internal note" description="Optional content is stated explicitly." placeholder="Only workspace members can see this" optional />
            <TextField label="Read-only identifier" description="Generated at creation and readOnly thereafter." defaultValue="brand:acme-labs" readOnly />
            <TextField label="Disabled billing key" description="Disabled while provider setup is incomplete." defaultValue="Not connected" disabled />
            <TextField label="Domain" description="Used for public asset links." defaultValue="acme labs.example" error="Enter a valid hostname without spaces." required />
            <SelectField label="Validation policy" description="Applies to plugin-contributed fields too." defaultValue="strict"><option value="strict">Strict validation</option><option value="guided">Guided validation</option></SelectField>
          </div>
        </Section>
        <div className="bakin-detail-state-stack">
          <SystemState kind="loading" title="Loading workspace settings" description="Controls retain their labels and layout while values are loading." />
          <SystemState kind="loading" title="Submitting changes" description="The submitting state disables duplicate actions and keeps the form context visible." action={<Action disabled>Saving…</Action>} />
          <SystemState kind="error" title="Validation blocked save" description="Review the Domain field. Focus moves to the first invalid control after submission." action={<Action>Review validation</Action>} />
          <SystemState kind="success" title="Workspace settings saved" description="Success feedback is announced without replacing the detail page." />
        </div>
      </PageShell>
    </CandidateDirection>
  )
}

function OverlayLauncher({ direction }: { direction: DirectionId }) {
  const [open, setOpen] = useState(false)
  return (
    <CandidateDirection direction={direction}>
      <div className="bakin-detail-overlay-launcher">
        <h2>Destructive overlay workflow</h2>
        <p>Open the modal to inspect focus entry, Escape dismissal, narrow reflow, impact copy, and action ordering.</p>
        <Inline><Action tone="danger" onClick={() => setOpen(true)}>Delete workspace</Action></Inline>
      </div>
      <Overlay open={open} title="Delete brand workspace" description="This removes brand configuration and disconnects 12 contributed sections." onClose={() => setOpen(false)} footer={<><Action onClick={() => setOpen(false)}>Cancel</Action><Action tone="danger">Confirm deletion</Action></>}>
        <TextField label="Confirmation identifier" description="Type brand:acme-labs-creator-operations to continue." placeholder="brand:acme-labs-creator-operations" required />
      </Overlay>
    </CandidateDirection>
  )
}

function DetailStudy({ text200 = false }: { text200?: boolean }) {
  return (
    <main className="bakin-candidate-study">
      <CandidateStyles css={DETAIL_FORM_CSS} />
      {text200 && <style>{'html { font-size: 200%; }'}</style>}
      <CandidateIntro title={text200 ? 'Detail and form at 200% text' : 'Detail and form directions'}>Product Character is the approved form and detail direction. Operational Neutral remains comparison evidence, not an alternate product theme.</CandidateIntro>
      <div className="bakin-candidate-study__directions"><DetailForm direction="operational-neutral" /><DetailForm direction="product-character" /></div>
    </main>
  )
}

function FieldStatesStudy() {
  return (
    <main className="bakin-candidate-study">
      <CandidateStyles css={DETAIL_FORM_CSS} />
      <CandidateIntro title="Form contract states">Labels, descriptions, validation, read-only, disabled, loading, submitting, and success remain visually and semantically consistent.</CandidateIntro>
      <div className="bakin-candidate-study__directions"><FieldStateGallery direction="operational-neutral" /><FieldStateGallery direction="product-character" /></div>
    </main>
  )
}

function OverlayStudy() {
  return (
    <main className="bakin-candidate-study">
      <CandidateStyles css={DETAIL_FORM_CSS} />
      <CandidateIntro title="Overlay and destructive workflow">Open either direction to compare modal shape, elevation, focus, content hierarchy, and safe action ordering.</CandidateIntro>
      <div className="bakin-candidate-study__directions"><OverlayLauncher direction="operational-neutral" /><OverlayLauncher direction="product-character" /></div>
    </main>
  )
}

const meta = {
  title: 'Internal/Direction studies/Detail and form',
  tags: ['internal'],
  parameters: { layout: 'fullscreen', bakinCoverage: ['desktop', 'mobile-320', 'text-200', 'focus-order', 'validation', 'overlay', 'destructive'] },
} satisfies Meta

export default meta
type Story = StoryObj<typeof meta>

export const SideBySide = {
  render: () => <DetailStudy />,
  play: async ({ canvas, userEvent }) => {
    const name = canvas.getAllByRole('textbox', { name: 'Workspace name' })[0]
    await userEvent.clear(name)
    await userEvent.type(name, 'Acme Labs studio operations')
    await expect(canvas.getAllByRole('status')[0]).toHaveTextContent('Unsaved changes')
    await expect(canvas.getAllByRole('button', { name: 'Save Acme Labs brand' })[0]).toBeEnabled()
  },
} satisfies Story

export const FieldStates = { render: () => <FieldStatesStudy /> } satisfies Story

export const OverlayWorkflow = {
  render: () => <OverlayStudy />,
  play: async ({ canvas, userEvent }) => {
    await userEvent.click(canvas.getAllByRole('button', { name: 'Delete workspace' })[0])
    const dialog = canvas.getByRole('dialog', { name: 'Delete brand workspace' })
    await expect(dialog).toBeVisible()
    await expect(canvas.getByRole('button', { name: 'Close dialog' })).toHaveFocus()
    await userEvent.keyboard('{Escape}')
    await expect(dialog).not.toBeInTheDocument()
  },
} satisfies Story

export const TextAt200Percent = { render: () => <DetailStudy text200 /> } satisfies Story
