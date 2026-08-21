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
 * (storybook-refit T6.1 — the legacy padded frame + PluginHeader are gone).
 */
import { createRoute } from '@tanstack/react-router'
import { Suspense, useCallback } from 'react'
import { RefreshCw } from 'lucide-react'
import { useJsonFetch } from '@makinbakin/sdk/hooks'
import { Stack } from '@makinbakin/sdk/layout'
import { useQueryState } from '@makinbakin/sdk/navigation'
import { Page, PageBody, PageHeader } from '@makinbakin/sdk/patterns'
import { Banner, Button, Skeleton, Tabs, TabsContent, TabsList, TabsTrigger } from '@makinbakin/sdk/ui'
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

/**
 * The capability report is NOT a cheap in-memory read: it awaits
 * `credentialStatus()`, which on OpenClaw shells out to the binary under a
 * 15s exec budget. A client deadline below that aborts requests the server
 * would still have answered — and because this page renders only the error
 * banner when the report is missing, that strands the user on the very
 * runtime they came here to switch away from. Stay above the server's budget.
 */
const REPORT_TIMEOUT_MS = 20_000
/**
 * The setup check runs every onboarding component live against the runtime
 * and the filesystem — seconds, not milliseconds. Bounded anyway: a hung
 * runtime must resolve to an honest failure, never a permanent spinner.
 */
const ONBOARDING_TIMEOUT_MS = 45_000

function RuntimePage() {
  const [tab, setTab] = useQueryState('tab', 'overview')
  // Unknown ?tab= values (typos, the retired ?tab=switch id) must never
  // strand the page on an empty pane — fall back to Overview.
  const activeTab = TABS.some((t) => t.id === tab) ? tab : 'overview'

  const {
    data: report,
    error: reportError,
    refresh: refreshReport,
  } = useJsonFetch<CapabilityReport>('/api/runtime/capabilities', { timeoutMs: REPORT_TIMEOUT_MS })

  const {
    data: onboardingPayload,
    loading: onboardingLoading,
    error: onboardingError,
    refresh: refreshOnboarding,
  } = useJsonFetch<{ components: OnboardingComponentStatus[] }>('/api/runtime/onboarding', { timeoutMs: ONBOARDING_TIMEOUT_MS })

  // undefined = in flight; null = the scan failed and the tab says so.
  const onboarding: OnboardingComponentStatus[] | null | undefined = onboardingLoading
    ? undefined
    : onboardingError
      ? null
      : onboardingPayload?.components ?? null

  const refresh = useCallback(() => {
    refreshReport()
    refreshOnboarding()
  }, [refreshReport, refreshOnboarding])

  return (
    <Page>
      <PageHeader
        title="Runtime"
        description={report ? `${report.adapter} · ${report.runtime.name}@${report.runtime.version}` : 'The engine that runs your agents'}
        actions={
          <Button size="sm" variant="outline" onClick={refresh}>
            <RefreshCw /> Refresh
          </Button>
        }
      />
      <PageBody label="Runtime report">
        <Tabs value={activeTab} onValueChange={(id: string) => setTab(id)}>
          <TabsList variant="underline" activateOnFocus aria-label="Runtime sections">
            {TABS.map((item) => (
              <TabsTrigger key={item.id} value={item.id}>
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* The panel belongs INSIDE the Tabs root: TabsContent is what emits
              the tabpanel and the aria-controls target the triggers point at.
              Bare conditionals outside the root left the tablist wired to
              nothing (same defect fixed in team/agent-detail). */}
          <TabsContent value={activeTab}>
            <Stack gap="section">
              {reportError && (
                <Banner
                  tone="danger"
                  announce="polite"
                  title="The runtime report failed to load"
                  // The switch flow needs the report (it names the active
                  // adapter and the roster), so a failed read hides the one
                  // control that recovers from a bad runtime. Name the CLI
                  // escape hatch rather than leaving a dead end.
                  description={activeTab === 'runtimes'
                    ? `${reportError} Switching runtimes needs this report; until it loads, use \`bakin runtime use <adapter>\` from a terminal.`
                    : reportError}
                  action={<Button size="sm" variant="outline" onClick={refresh}>Retry</Button>}
                />
              )}

              {!report && !reportError && (
                <Stack gap="item">
                  <Skeleton className="h-24 w-full" />
                  <Skeleton className="h-40 w-full" />
                </Stack>
              )}

              {report && activeTab === 'overview' && <OverviewTab report={report} onboarding={onboarding} onRefreshOnboarding={refreshOnboarding} />}
              {activeTab === 'capabilities' && <CapabilitiesTab />}
              {report && activeTab === 'runtimes' && <RuntimesTab report={report} onSwitched={refresh} />}
            </Stack>
          </TabsContent>
        </Tabs>
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
