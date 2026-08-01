/**
 * /runtime — the runtime hub (pi-parity P4, story 7).
 *
 * Three tabs on the SDK kit, each answering one question in plain language:
 *   Overview     — who runs your agents and what it can do (honest modes)
 *   Capabilities — are installed capability packs actually working
 *   Runtimes     — the runtime roster + guided switch: preview (dry run)
 *                  first, confirm, live progress, grouped result cards
 * Sections fetch and fault independently (health-page pattern); tab state is
 * URL-backed for deep links. Page + PageHeader own page identity and padding
 * (storybook-refit T6.1 — the legacy p-6 frame + PluginHeader are gone).
 */
import { createRoute } from '@tanstack/react-router'
import { Suspense, useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useQueryState } from '@makinbakin/sdk/navigation'
import { Page, PageBody, PageHeader } from '@makinbakin/sdk/patterns'
import { Banner, Button, Skeleton, Tabs, TabsList, TabsTrigger } from '@makinbakin/sdk/ui'
import { OverviewTab } from '../components/runtime/overview-tab'
import { CapabilitiesTab } from '../components/runtime/capabilities-tab'
import { RuntimesTab } from '../components/runtime/runtimes-tab'
import type { CapabilityReport, OnboardingComponentStatus } from '../components/runtime/types'
import { Route as RootRoute } from './__root'

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'capabilities', label: 'Capabilities' },
  { id: 'runtimes', label: 'Runtimes' },
]

function RuntimePage() {
  const [tab, setTab] = useQueryState('tab', 'overview')
  // Unknown ?tab= values (typos, the retired ?tab=switch id) must never
  // strand the page on an empty pane — fall back to Overview.
  const activeTab = TABS.some((t) => t.id === tab) ? tab : 'overview'
  const [report, setReport] = useState<CapabilityReport | null>(null)
  const [reportError, setReportError] = useState<string | null>(null)
  // undefined = in flight (the setup check runs every component live —
  // seconds, not ms); null = fetch failed.
  const [onboarding, setOnboarding] = useState<OnboardingComponentStatus[] | null | undefined>(undefined)

  const loadReport = useCallback(async () => {
    try {
      const res = await fetch('/api/runtime/capabilities')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setReport(await res.json())
      setReportError(null)
    } catch (err) {
      setReportError(err instanceof Error ? err.message : String(err))
    }
  }, [])

  const loadOnboarding = useCallback(async () => {
    setOnboarding(undefined)
    try {
      const res = await fetch('/api/runtime/onboarding')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const payload = await res.json() as { components: OnboardingComponentStatus[] }
      setOnboarding(payload.components)
    } catch {
      setOnboarding(null)
    }
  }, [])

  const refresh = useCallback(() => {
    void loadReport()
    void loadOnboarding()
  }, [loadReport, loadOnboarding])

  useEffect(() => { refresh() }, [refresh])

  return (
    <Page>
      <PageHeader
        title="Runtime"
        description={report ? `${report.adapter} · ${report.runtime.name}@${report.runtime.version}` : 'The engine that runs your agents'}
        actions={
          <Button size="sm" variant="outline" onClick={refresh}>
            <RefreshCw className="mr-2 size-3.5" /> Refresh
          </Button>
        }
      />
      <PageBody label="Runtime report">
        <Tabs value={activeTab} onValueChange={(id) => setTab(id as string)}>
          <TabsList variant="underline" activateOnFocus aria-label="Runtime sections">
            {TABS.map((item) => (
              <TabsTrigger key={item.id} value={item.id}>
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {reportError && (
          <Banner
            tone="danger"
            announce="polite"
            title="The runtime report failed to load"
            description={reportError}
            action={<Button size="sm" variant="outline" onClick={refresh}>Retry</Button>}
          />
        )}

        {!report && !reportError && (
          <div className="flex flex-col gap-bakin-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        )}

        {report && activeTab === 'overview' && <OverviewTab report={report} onboarding={onboarding} onRefreshOnboarding={() => void loadOnboarding()} />}
        {activeTab === 'capabilities' && <CapabilitiesTab />}
        {report && activeTab === 'runtimes' && <RuntimesTab report={report} onSwitched={refresh} />}
      </PageBody>
    </Page>
  )
}

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: '/runtime',
  component: () => (
    <Suspense>
      <RuntimePage />
    </Suspense>
  ),
})
