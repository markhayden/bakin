'use client'

import { Suspense, useEffect, useRef } from 'react'
import { Pause, Play } from 'lucide-react'
import { emitPluginEvent } from '@makinbakin/sdk/hooks'
import { useQueryState, useUnsavedChangesGuard } from '@makinbakin/sdk/navigation'
import { pluginFetch } from '@makinbakin/sdk/utils'
import { Page, PageBody, PageHeader, SegmentedControl } from '@makinbakin/sdk/patterns'
import { Banner, Button, Tabs, TabsList, TabsTrigger } from '@makinbakin/sdk/ui'

import type { SpendTab, SpendWindow } from '../types'
import { IncidentBanners } from './incident-banners'
import { LimitsTab } from './limits-tab'
import { OverviewTab } from './overview-tab'
import type { SpendBreakdownDimension } from './spend-breakdown'
import { useSpendData } from './use-spend-data'

const TABS: Array<{ id: SpendTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'limits', label: 'Limits' },
]

const SPEND_WINDOWS: ReadonlyArray<{ value: SpendWindow; label: string }> = [
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'all', label: 'All time' },
]

/**
 * /spend — Overview (what you spend) and Limits (opt-in caps). Pattern:
 * storybook/public/recipes/settings-dashboard-pages — DashboardOverview /
 * SettingsCategories. Tab + window + breakdown state ride the URL.
 */
export function SpendPage() {
  const m = useSpendData()
  const [tabParam, setTab] = useQueryState('tab')
  const tab: SpendTab = tabParam === 'limits' ? 'limits' : 'overview'
  const [spendBreakdown, setSpendBreakdown] = useQueryState('spendBy', 'agents')
  const [spendMetric, setSpendMetric] = useQueryState('spendMetric', 'cost')
  const [spendPage, setSpendPage] = useQueryState('spendPage', '1')
  const [spendShowAll, setSpendShowAll] = useQueryState('spendAll', 'false')
  const paused = m.budgetStatus?.paused === true

  // Opening Spend is "seen" for the 50/75 heads-ups: their badge entries
  // acknowledge here (the 90 row keeps its explicit Dismiss). Once per row.
  const acked = useRef(new Set<number>())
  const headsUp = (m.budgetStatus?.milestones ?? []).filter((row) => row.milestone < 90 && row.acknowledgedAt === null && !acked.current.has(row.id))
  useEffect(() => {
    for (const row of headsUp) {
      acked.current.add(row.id)
      void pluginFetch('spend', `milestones/${row.id}/ack`, { method: 'POST' })
        .then((res) => { if (res.ok) emitPluginEvent({ event: 'spend.milestone_acknowledged', milestoneId: row.id }) })
        .catch(() => { acked.current.delete(row.id) })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headsUp.map((row) => row.id).join(',')])

  // Staged rule edits are unsaved work: leaving the page (route, anchor,
  // unload, back) asks — save, discard, or stay — instead of dropping them.
  const unsavedGuard = useUnsavedChangesGuard({
    hasUnsavedChanges: m.pendingRules !== null,
    saving: m.saving === 'budget',
    title: 'Unsaved budget rules',
    description: 'You have unsaved changes to your spend limits. Save them before leaving, discard them, or stay here.',
    saveLabel: 'Save budget rules',
    onSaveAndExit: m.saveBudgetRules,
    onDiscardAndExit: () => m.setPendingRules(null),
    error: m.budgetError,
  })

  const headerControls = tab === 'overview' ? (
    <SegmentedControl
      options={SPEND_WINDOWS}
      value={m.spendWindow as SpendWindow}
      onValueChange={(window) => {
        m.setSpendWindow(window)
        setSpendPage('1')
        setSpendShowAll('false')
      }}
      ariaLabel="Spend window"
    />
  ) : undefined

  const pendingFeedback = tab === 'limits' && m.pendingRules ? (
    <Banner
      tone="attention"
      announce="polite"
      headingLevel={2}
      title="Unsaved budget rules"
      description="Save these limits before leaving, or discard them to restore the current budget policy."
      action={(
        <>
          <Button type="button" variant="outline" size="sm" disabled={m.saving === 'budget'} onClick={() => m.setPendingRules(null)}>
            Discard changes
          </Button>
          <Button type="button" size="sm" disabled={m.saving === 'budget'} onClick={() => void m.saveBudgetRules()}>
            {m.saving === 'budget' ? 'Saving…' : 'Save budget rules'}
          </Button>
        </>
      )}
    />
  ) : undefined

  return (
    <Page>
      <PageHeader
        title="Spend"
        description="What your agents spend, observed and projected — and the limits you choose to set once you know what normal looks like."
        controls={headerControls}
        controlsLabel="Spend window"
        actions={(
          <Button type="button" variant={paused ? 'primary' : 'danger'} onClick={() => void m.setDispatchPaused(!paused)}>
            {paused ? <Play /> : <Pause />}
            {paused ? 'Resume dispatch' : 'Pause all dispatch'}
          </Button>
        )}
        actionsLabel="Dispatch controls"
      />

      {paused ? (
        <Banner
          tone="danger"
          announce="assertive"
          title="All task dispatch is paused"
          description="No new billed work will start until an operator resumes dispatch."
        />
      ) : null}
      {m.budgetError ? (
        <Banner
          tone="danger"
          announce="assertive"
          title="Budget information could not be loaded or updated"
          description={m.budgetError}
        />
      ) : null}
      {m.budgetWarnings.map((warning) => (
        <Banner key={warning} tone="attention" title="Budget rule needs review" description={warning} />
      ))}
      <IncidentBanners incidents={m.incidents} resolveIncident={m.resolveIncident} rules={m.budgetRules} facets={m.spend?.facets} />

      <Tabs value={tab} onValueChange={(id) => setTab(id === 'overview' ? null : id)}>
        <TabsList variant="underline" activateOnFocus aria-label="Spend sections">
          {TABS.map((item) => (
            <TabsTrigger key={item.id} value={item.id} id={`spend-tab-${item.id}`} aria-controls={`spend-panel-${item.id}`}>
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <PageBody id={`spend-panel-${tab}`} role="tabpanel" labelledBy={`spend-tab-${tab}`} feedback={pendingFeedback}>
        <Suspense>
          {tab === 'overview' ? (
            <OverviewTab
              m={m}
              breakdown={spendBreakdown as SpendBreakdownDimension}
              metric={spendMetric === 'tokens' ? 'tokens' : 'cost'}
              pageValue={spendPage}
              showAllValue={spendShowAll}
              onBreakdownChange={(dimension) => setSpendBreakdown(dimension)}
              onMetricChange={setSpendMetric}
              onPageChange={setSpendPage}
              onShowAllChange={setSpendShowAll}
            />
          ) : (
            <LimitsTab m={m} />
          )}
        </Suspense>
      </PageBody>
      {unsavedGuard.dialog}
    </Page>
  )
}
