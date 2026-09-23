'use client'

import { useQueryArrayState, useQueryState } from '@makinbakin/sdk/navigation'
import {
  Page,
  PageBody,
  PageHeader,
  SearchInput,
} from '@makinbakin/sdk/patterns'
import { Banner, Button, Tabs, TabsList, TabsTrigger } from '@makinbakin/sdk/ui'

import { useModelsData } from './use-models-data'
import { AgentsTab } from './agents-tab'
import { AvailableModelsTab } from './available-models-tab'
import { AliasesTab } from './aliases-tab'
import { RoutingTab } from './routing-tab'

const TABS = [
  { id: 'agents', label: 'Agent Config' },
  { id: 'available', label: 'Available Models' },
  { id: 'aliases', label: 'Aliases' },
  { id: 'routing', label: 'Routing' },
] as const

// ---------------------------------------------------------------------------
// Main component — page shell: header, banners, tab bar, and the four tabs
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

  const headerControls = tab === 'available' ? (
    <SearchInput
      align="end"
      label="Search available models"
      value={modelQuery}
      onValueChange={updateModelQuery}
      placeholder="Search models…"
      mobileFullWidth
    />
  ) : tab === 'aliases' ? (
    <SearchInput
      align="end"
      label="Search aliases"
      value={aliasQuery}
      onValueChange={updateAliasQuery}
      placeholder="Search aliases…"
      mobileFullWidth
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
  ) : undefined

  return (
    <Page>
      <PageHeader
        title="Models"
        description="Choose which AI models Bakin and each agent use, then set fallbacks and routing rules."
        controls={headerControls}
        controlsLabel={tab === 'aliases' ? 'Alias search' : 'Available model search'}
        actions={headerActions}
        actionsLabel="Alias actions"
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

      <PageBody
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
      </PageBody>
    </Page>
  )
}
