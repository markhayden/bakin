'use client'

/**
 * The Models page (spec §3.4): one page, no tabs. A Simple/Advanced mode
 * switch in the header (a VIEW over the same selections — never
 * destructive), the two-lane Simple view, the three Advanced sections, and
 * the read-only model catalog behind a disclosure at the foot. `?ref=`
 * deep-links a selection: the owning view highlights it and, when it lives
 * in a layer Simple cannot show, the VIEW flips to Advanced without writing.
 */
import { useRuntimeStatus } from '@makinbakin/sdk/hooks'
import { useUnsavedChangesGuard } from '@makinbakin/sdk/navigation'
import { Page, PageBody, PageHeader, SaveBar, SegmentedControl } from '@makinbakin/sdk/patterns'
import { Badge, Banner, Button, SystemState } from '@makinbakin/sdk/ui'

import type { UiMode } from '../lib/mode'
import { AdvancedMode } from './advanced-mode'
import { CatalogPanel } from './catalog-panel'
import { SimpleMode } from './simple-mode'
import { useCatalog } from './use-catalog'
import { useSelections, type SelectionsData } from './use-selections'

const MODE_OPTIONS = [
  { value: 'simple', label: 'Simple' },
  { value: 'advanced', label: 'Advanced' },
] as const satisfies ReadonlyArray<{ value: UiMode; label: string }>

function PendingSummary({ sel }: { sel: SelectionsData }) {
  const count = sel.pendingRefs.size
  if (count === 0) return null
  const failed = [...sel.pendingRefs.values()].filter((p) => p.state !== 'unsettled').length
  return (
    <Badge tone={failed > 0 ? 'danger' : 'attention'} variant="soft" size="xs" data-testid="pending-writes">
      {failed > 0
        ? `${failed} write${failed === 1 ? '' : 's'} not confirmed`
        : `${count} write${count === 1 ? '' : 's'} pending runtime confirmation`}
    </Badge>
  )
}

export function ModelsPage() {
  const sel = useSelections()
  const catalog = useCatalog()
  const runtimeStatus = useRuntimeStatus()
  const defaultModel = sel.selections?.states.find((s) => s.ref === 'policy:defaultModel')?.model ?? null
  const evidence = sel.selections?.evidence

  // One draft, one bar, one write (S10): every lane/row edit stages an op;
  // the bar saves the whole draft, keeps failed refs for Retry, and the
  // navigation guard covers routes, anchors, and browser unload.
  const guard = useUnsavedChangesGuard({
    hasUnsavedChanges: sel.dirty,
    saving: sel.saving,
    onSaveAndExit: sel.save,
    onDiscardAndExit: sel.discard,
    error: sel.saveError,
    description: 'Your model changes are not saved yet. Save them before leaving, discard them, or stay here.',
  })
  const pendingFromSave = sel.lastSave?.pending ?? []

  const shellState = sel.loading ? (
    <SystemState kind="loading" title="Loading model configuration" description="Reading every persisted model selection and the recommended plan." />
  ) : sel.error ? (
    <SystemState
      kind="error"
      title="Model configuration could not be loaded"
      description={sel.error}
      action={<Button type="button" variant="outline" size="sm" onClick={() => void sel.reload()}>Retry</Button>}
    />
  ) : undefined

  return (
    <Page>
      <PageHeader
        title="Models"
        description="Choose the model your agents work with and the lighter one that handles background chores. Advanced opens every per-agent and per-job control."
        controls={(
          <SegmentedControl
            ariaLabel="Models view"
            idPrefix="models-mode"
            options={MODE_OPTIONS}
            value={sel.view}
            onValueChange={sel.setView}
          />
        )}
        controlsLabel="Models view"
        meta={<PendingSummary sel={sel} />}
      />

      {runtimeStatus.pending && (
        <Banner
          tone="attention"
          title={runtimeStatus.advice.title ?? 'Runtime config changed'}
          description={runtimeStatus.lastError
            ? `${runtimeStatus.advice.body ?? ''} The last restart failed: ${runtimeStatus.lastError}`.trim()
            : runtimeStatus.advice.body}
          action={runtimeStatus.advice.action ? (
            <Button
              onClick={runtimeStatus.restart}
              disabled={runtimeStatus.restarting}
              variant="outline"
              size="sm"
            >
              {runtimeStatus.restarting ? 'Restarting...' : runtimeStatus.advice.action.label}
            </Button>
          ) : undefined}
        />
      )}

      {evidence && (evidence.credentials !== 'ok' || evidence.rejections !== 'ok') ? (
        <Banner
          tone="info"
          title="Some availability facts could not be verified"
          description={evidence.credentials === 'failed'
            ? 'The runtime did not report which providers have credentials, so models are listed as unverified rather than disabled. Fix the runtime and reload to see exact verdicts.'
            : 'Credential evidence is partial: models whose provider could not be checked stay selectable and are marked unverified.'}
        />
      ) : null}

      {sel.view === 'simple' ? (
        <PageBody
          id="models-mode-panel-simple"
          role="tabpanel"
          labelledBy="models-mode-tab-simple"
          state={shellState}
        >
          <SimpleMode sel={sel} modelOptions={catalog.modelSelectOptions} onAdvanced={() => sel.setView('advanced')} />
        </PageBody>
      ) : (
        <PageBody
          id="models-mode-panel-advanced"
          role="tabpanel"
          labelledBy="models-mode-tab-advanced"
          state={shellState}
        >
          <AdvancedMode sel={sel} modelOptions={catalog.modelSelectOptions} />
        </PageBody>
      )}

      <CatalogPanel catalog={catalog} defaultModel={defaultModel} />

      {sel.dirty || sel.saveError || pendingFromSave.length > 0 ? (
        <SaveBar
          dirty={sel.dirty}
          saving={sel.saving}
          error={sel.saveError ?? undefined}
          onSave={() => void sel.save()}
          onDiscard={sel.discard}
        >
          <span data-testid="draft-summary">
            {sel.stagedCount > 0 ? `${sel.stagedCount} change${sel.stagedCount === 1 ? '' : 's'} staged` : null}
            {pendingFromSave.length > 0 ? `${sel.stagedCount > 0 ? ' · ' : ''}${pendingFromSave.length} write${pendingFromSave.length === 1 ? '' : 's'} pending runtime confirmation` : null}
          </span>
        </SaveBar>
      ) : null}
      {guard.dialog}
    </Page>
  )
}
