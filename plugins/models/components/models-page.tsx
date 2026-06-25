'use client'

// Internal
import { Button } from "@makinbakin/sdk/ui"
import { PluginHeader } from "@makinbakin/sdk/components"
import { ErrorBanner } from "@makinbakin/sdk/components"
import { UnderlineTabs } from "@makinbakin/sdk/components"
// Relative
import { useModelsData } from './use-models-data'
import { AgentsTab } from './agents-tab'
import { AvailableModelsTab } from './available-models-tab'
import { AliasesTab } from './aliases-tab'
import { RoutingTab } from './routing-tab'
import { SpendTab } from './spend-tab'

const TABS = [
  { id: 'agents', label: 'Agent Config' },
  { id: 'available', label: 'Available Models' },
  { id: 'aliases', label: 'Aliases' },
  { id: 'routing', label: 'Routing' },
  { id: 'spend', label: 'Spend' },
] as const

// ---------------------------------------------------------------------------
// Main component — page shell: header, banners, tab bar, and the five tabs
// (each fed the shared useModelsData() object).
// ---------------------------------------------------------------------------
export function ModelsPage() {
  const m = useModelsData()
  const { tab, setTab, error, fetchConfig, runtimeStatus, modelOptions } = m

  return (
    <div className="p-6 flex flex-col flex-1 gap-6">
      <PluginHeader
        title="Models"
        count={modelOptions.length}
        subtitle="Agent model config and aliases"
      />

      {/* Error banner */}
      {error && <ErrorBanner message={error} onRetry={fetchConfig} />}

      {/* Restart banner */}
      {runtimeStatus.restartNeeded && (
        <div className="flex items-center justify-between rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3">
          <span className="text-sm text-amber-400">
            Runtime config out of sync. Restart to apply changes.
          </span>
          <Button
            onClick={runtimeStatus.restart}
            disabled={runtimeStatus.restarting}
            variant="outline"
            size="sm"
            className="border-amber-500/30 text-amber-400 hover:bg-amber-500/20"
          >
            {runtimeStatus.restarting ? 'Restarting...' : 'Restart Runtime'}
          </Button>
        </div>
      )}

      {/* Tab bar */}
      <UnderlineTabs
        tabs={TABS}
        value={tab}
        onValueChange={(id) => setTab(id as typeof tab)}
      />

      {/* Tab content */}
      {tab === 'agents' && <AgentsTab m={m} />}
      {tab === 'available' && <AvailableModelsTab m={m} />}
      {tab === 'aliases' && <AliasesTab m={m} />}
      {tab === 'routing' && <RoutingTab m={m} />}
      {tab === 'spend' && <SpendTab m={m} />}
    </div>
  )
}
