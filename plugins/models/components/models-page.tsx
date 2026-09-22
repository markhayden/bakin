'use client'

/**
 * The Models page (spec §3.4): one page, no tabs. A Simple/Advanced mode
 * switch in the header (a VIEW over the same selections — never
 * destructive), the two-lane Simple view, the three Advanced sections, and
 * the read-only model catalog behind a disclosure at the foot. `?ref=`
 * deep-links a selection: the owning view highlights it and, when it lives
 * in a layer Simple cannot show, the VIEW flips to Advanced without writing.
 */
import { useQueryState, useUnsavedChangesGuard } from '@makinbakin/sdk/navigation'
import { KeyValue, Page, PageBody, PageHeader, SaveBar, SearchInput, SegmentedControl, type KeyValueItem } from '@makinbakin/sdk/patterns'
import { Badge, Banner, Button, SystemState, Tabs, TabsList, TabsTrigger, Text } from '@makinbakin/sdk/ui'

import type { UiMode } from '../lib/mode'
import { AgentsTab } from './agents-tab'
import { AliasesTab } from './aliases-tab'
import { CatalogPanel } from './catalog-panel'
import { RoutingTab } from './routing-tab'
import { useModelsData } from './use-models-data'
import { useSelections, type SelectionsData } from './use-selections'

const MODE_OPTIONS = [
  { value: 'simple', label: 'Simple' },
  { value: 'advanced', label: 'Advanced' },
] as const satisfies ReadonlyArray<{ value: UiMode; label: string }>

/** Advanced sections, mounted behind the shell until the sectioned rewrite replaces them. */
const ADVANCED_TABS = [
  { id: 'agents', label: 'Agent Config' },
  { id: 'aliases', label: 'Aliases' },
  { id: 'routing', label: 'Routing' },
] as const

function PendingSummary({ sel }: { sel: SelectionsData }) {
  const count = sel.pendingRefs.size
  if (count === 0) return null
  const failed = [...sel.pendingRefs.values()].filter((p) => p.state !== 'unsettled').length
  return (
    <Badge tone={failed > 0 ? 'danger' : 'attention'} variant="outline" size="xs" data-testid="pending-writes">
      {failed > 0
        ? `${failed} write${failed === 1 ? '' : 's'} not confirmed`
        : `${count} write${count === 1 ? '' : 's'} pending runtime confirmation`}
    </Badge>
  )
}

/** Read-only two-lane summary — the Simple view's shell until its lanes land. */
function SimpleSummary({ sel, onAdvanced }: { sel: SelectionsData; onAdvanced: () => void }) {
  const plan = sel.plan
  if (!plan) return null
  const chores = plan.current.chores.mixed
    ? `Mixed (${plan.current.chores.models.length} models)`
    : plan.current.chores.model ?? 'Inherits the agent model'
  const items: KeyValueItem[] = [
    { label: 'Agent model', value: plan.current.agent ?? 'Not set', mono: true },
    { label: 'Background chores', value: chores, mono: !plan.current.chores.mixed },
  ]
  return (
    <>
      <KeyValue aria-label="Model plan" layout="rows" items={items} />
      {sel.customizations.length > 0 ? (
        <Text size="meta" tone="muted" data-testid="customizations-line">
          {sel.customizations.length} customization{sel.customizations.length === 1 ? '' : 's'} active ({sel.customizations.map((c) => c.detail).join('; ')}).{' '}
          <Button type="button" variant="link" size="xs" onClick={onAdvanced}>View in Advanced</Button>
        </Text>
      ) : null}
    </>
  )
}

export function ModelsPage() {
  const sel = useSelections()
  // The Advanced sections still read through the previous data layer.
  const m = useModelsData()
  const [tab, setTab] = useQueryState('tab', 'agents')
  const [aliasQuery, setAliasQuery] = useQueryState('aliasQuery', '')
  const [aliasPage, setAliasPage] = useQueryState('aliasPage', '1')
  const [aliasShowAll, setAliasShowAll] = useQueryState('aliasAll', 'false')
  const { runtimeStatus } = m
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

      {m.error ? (
        <Banner
          tone="danger"
          announce="assertive"
          title="Part of the model configuration could not be loaded"
          description={m.error}
          action={<Button variant="outline" size="sm" onClick={m.fetchConfig}>Retry</Button>}
        />
      ) : null}

      {sel.view === 'simple' ? (
        <PageBody
          id="models-mode-panel-simple"
          role="tabpanel"
          labelledBy="models-mode-tab-simple"
          state={shellState}
        >
          <SimpleSummary sel={sel} onAdvanced={() => sel.setView('advanced')} />
        </PageBody>
      ) : (
        <PageBody
          id="models-mode-panel-advanced"
          role="tabpanel"
          labelledBy="models-mode-tab-advanced"
          state={shellState}
          feedback={tab === 'routing' && m.pendingRouting ? (
            <Banner
              tone="attention"
              announce="polite"
              headingLevel={2}
              title="Unsaved routing changes"
              description="Save these routes before leaving, or discard them to return to the current runtime configuration."
              action={(
                <>
                  <Button type="button" variant="outline" size="sm" disabled={m.saving === 'routing'} onClick={() => m.setPendingRouting(null)}>
                    Discard changes
                  </Button>
                  <Button type="button" size="sm" disabled={m.saving === 'routing'} onClick={() => void m.saveRouting()}>
                    {m.saving === 'routing' ? 'Saving…' : 'Save routing'}
                  </Button>
                </>
              )}
            />
          ) : undefined}
        >
          <Tabs value={tab} onValueChange={(id) => setTab(id)}>
            <TabsList variant="underline" activateOnFocus aria-label="Advanced model settings">
              {ADVANCED_TABS.map((item) => (
                <TabsTrigger key={item.id} value={item.id} id={`models-tab-${item.id}`}>
                  {item.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          {tab === 'agents' && <AgentsTab m={m} />}
          {tab === 'aliases' && (
            <SearchInput
              label="Search aliases"
              value={aliasQuery}
              onValueChange={(query) => { setAliasQuery(query); setAliasPage('1'); setAliasShowAll('false') }}
              placeholder="Search aliases…"
            />
          )}
          {tab === 'aliases' && (
            <AliasesTab
              m={m}
              query={aliasQuery}
              pageValue={aliasPage}
              showAllValue={aliasShowAll}
              onQueryChange={(query) => { setAliasQuery(query); setAliasPage('1'); setAliasShowAll('false') }}
              onPageChange={setAliasPage}
              onShowAllChange={(showAll) => { setAliasShowAll(showAll); setAliasPage('1') }}
            />
          )}
          {tab === 'routing' && <RoutingTab m={m} />}
        </PageBody>
      )}

      <CatalogPanel catalog={m} defaultModel={defaultModel} />

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
