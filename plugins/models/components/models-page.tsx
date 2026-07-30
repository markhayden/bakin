'use client'

import { Pause, Play } from 'lucide-react'
import { useQueryArrayState, useQueryState } from '@makinbakin/sdk/navigation'
import {
  PageHeader,
  SearchInput,
  SegmentedControl,
  SettingsPage,
  SettingsPageContent,
} from '@makinbakin/sdk/patterns'
import { Banner, Button, Tabs, TabsList, TabsTrigger } from '@makinbakin/sdk/ui'

import { useModelsData } from './use-models-data'
import { AgentsTab } from './agents-tab'
import { AvailableModelsTab } from './available-models-tab'
import { AliasesTab } from './aliases-tab'
import { RoutingTab } from './routing-tab'
import { SpendTab } from './spend-tab'
import type { SpendBreakdownDimension } from './spend-breakdown'

const TABS = [
  { id: 'agents', label: 'Agent Config' },
  { id: 'available', label: 'Available Models' },
  { id: 'aliases', label: 'Aliases' },
  { id: 'routing', label: 'Routing' },
  { id: 'spend', label: 'Spend' },
] as const

const SPEND_WINDOWS = [
  { value: '24h', label: '24 hours' },
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: 'all', label: 'All time' },
] as const

// ---------------------------------------------------------------------------
// Main component — page shell: header, banners, tab bar, and the five tabs
// (each fed the shared useModelsData() object).
// ---------------------------------------------------------------------------
export function ModelsPage() {
  const m = useModelsData()
  const { tab, setTab, error, fetchConfig, runtimeStatus } = m
  const [modelQuery, setModelQuery] = useQueryState('modelQuery', '')
  const [modelProviders, setModelProviders] = useQueryArrayState('modelProviders')
  const [modelPage, setModelPage] = useQueryState('modelPage', '1')
  const [modelShowAll, setModelShowAll] = useQueryState('modelAll', 'false')
  const [aliasQuery, setAliasQuery] = useQueryState('aliasQuery', '')
  const [aliasPage, setAliasPage] = useQueryState('aliasPage', '1')
  const [aliasShowAll, setAliasShowAll] = useQueryState('aliasAll', 'false')
  const [spendBreakdown, setSpendBreakdown] = useQueryState('spendBy', 'agents')
  const [spendMetric, setSpendMetric] = useQueryState('spendMetric', 'cost')
  const [spendPage, setSpendPage] = useQueryState('spendPage', '1')
  const [spendShowAll, setSpendShowAll] = useQueryState('spendAll', 'false')

  const updateModelQuery = (query: string) => {
    setModelQuery(query)
    setModelPage('1')
    setModelShowAll('false')
  }
  const updateAliasQuery = (query: string) => {
    setAliasQuery(query)
    setAliasPage('1')
    setAliasShowAll('false')
  }
  const spendPaused = m.budgetStatus?.paused === true

  const headerControls = tab === 'available' ? (
    <SearchInput
      label="Search available models"
      value={modelQuery}
      onValueChange={updateModelQuery}
      placeholder="Search models…"
      mobileFullWidth
    />
  ) : tab === 'aliases' ? (
    <SearchInput
      label="Search aliases"
      value={aliasQuery}
      onValueChange={updateAliasQuery}
      placeholder="Search aliases…"
      mobileFullWidth
    />
  ) : tab === 'spend' ? (
    <SegmentedControl
      options={SPEND_WINDOWS}
      value={m.spendWindow as (typeof SPEND_WINDOWS)[number]['value']}
      onValueChange={(window) => {
        m.setSpendWindow(window)
        setSpendPage('1')
        setSpendShowAll('false')
      }}
      ariaLabel="Spend window"
    />
  ) : undefined

  const headerActions = tab === 'aliases' ? (
    <Button
      type="button"
      variant="outline"
      disabled={m.saving === 'aliases'}
      onClick={() => void m.prepopulateAliases()}
    >
      Add recommended aliases
    </Button>
  ) : tab === 'spend' ? (
    <Button
      type="button"
      variant={spendPaused ? 'primary' : 'danger'}
      onClick={() => void m.setDispatchPaused(!spendPaused)}
    >
      {spendPaused ? <Play /> : <Pause />}
      {spendPaused ? 'Resume dispatch' : 'Pause all dispatch'}
    </Button>
  ) : undefined

  const pendingFeedback = tab === 'routing' && m.pendingRouting ? (
    <Banner
      tone="attention"
      announce="polite"
      headingLevel={2}
      title="Unsaved routing changes"
      description="Save these routes before leaving this tab, or discard them to return to the current runtime configuration."
      action={(
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={m.saving === 'routing'}
            onClick={() => m.setPendingRouting(null)}
          >
            Discard changes
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={m.saving === 'routing'}
            onClick={() => void m.saveRouting()}
          >
            {m.saving === 'routing' ? 'Saving…' : 'Save routing'}
          </Button>
        </>
      )}
    />
  ) : tab === 'spend' && m.pendingRules ? (
    <Banner
      tone="attention"
      announce="polite"
      headingLevel={2}
      title="Unsaved budget rules"
      description="Save these limits before leaving this tab, or discard them to restore the current budget policy."
      action={(
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={m.saving === 'budget'}
            onClick={() => m.setPendingRules(null)}
          >
            Discard changes
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={m.saving === 'budget'}
            onClick={() => void m.saveBudgetRules()}
          >
            {m.saving === 'budget' ? 'Saving…' : 'Save budget rules'}
          </Button>
        </>
      )}
    />
  ) : undefined

  return (
    <SettingsPage width="full">
      <PageHeader
        title="Models"
        description="Choose which AI models Bakin and each agent use, then set fallbacks, routing rules, and spending limits."
        controls={headerControls}
        controlsLabel={tab === 'spend' ? 'Spend window' : tab === 'aliases' ? 'Alias search' : 'Available model search'}
        actions={headerActions}
        actionsLabel={tab === 'spend' ? 'Dispatch controls' : 'Alias actions'}
      />

      {error ? (
        <Banner
          tone="danger"
          announce="assertive"
          title="Model configuration could not be loaded"
          description={error}
          action={(
            <Button variant="outline" size="sm" onClick={fetchConfig}>
              Retry
            </Button>
          )}
        />
      ) : null}

      {runtimeStatus.restartNeeded && (
        <Banner
          tone="attention"
          title="Runtime config out of sync. Restart to apply changes."
          description="Your saved settings are retained, but the runtime will keep using its current model configuration until it restarts."
          action={(
            <Button
              onClick={runtimeStatus.restart}
              disabled={runtimeStatus.restarting}
              variant="outline"
              size="sm"
            >
              {runtimeStatus.restarting ? 'Restarting...' : 'Restart Runtime'}
            </Button>
          )}
        />
      )}

      <Tabs value={tab} onValueChange={(id) => setTab(id as typeof tab)}>
        <TabsList variant="underline" activateOnFocus aria-label="Model settings">
          {TABS.map((item) => (
            <TabsTrigger
              key={item.id}
              value={item.id}
              id={`models-tab-${item.id}`}
              aria-controls={`models-panel-${item.id}`}
            >
              {item.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <SettingsPageContent
        id={`models-panel-${tab}`}
        role="tabpanel"
        labelledBy={`models-tab-${tab}`}
        feedback={pendingFeedback}
      >
        {tab === 'agents' && <AgentsTab m={m} />}
        {tab === 'available' && (
          <AvailableModelsTab
            m={m}
            query={modelQuery}
            providers={modelProviders}
            pageValue={modelPage}
            showAllValue={modelShowAll}
            onQueryChange={updateModelQuery}
            onProvidersChange={(providers) => {
              setModelProviders(providers)
              setModelPage('1')
              setModelShowAll('false')
            }}
            onPageChange={setModelPage}
            onShowAllChange={(showAll) => {
              setModelShowAll(showAll)
              setModelPage('1')
            }}
          />
        )}
        {tab === 'aliases' && (
          <AliasesTab
            m={m}
            query={aliasQuery}
            pageValue={aliasPage}
            showAllValue={aliasShowAll}
            onQueryChange={updateAliasQuery}
            onPageChange={setAliasPage}
            onShowAllChange={(showAll) => {
              setAliasShowAll(showAll)
              setAliasPage('1')
            }}
          />
        )}
        {tab === 'routing' && <RoutingTab m={m} />}
        {tab === 'spend' && (
          <SpendTab
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
        )}
      </SettingsPageContent>
    </SettingsPage>
  )
}
