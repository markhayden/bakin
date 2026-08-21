'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { HealthIncident, HealthRepairTarget } from '@makinbakin/sdk/types'
import { usePathname, useQueryState } from '@makinbakin/sdk/hooks'
import { pluginFetch } from '@makinbakin/sdk/utils'
import {
  Page,
  PageBody,
  PageHeader,
} from '@makinbakin/sdk/patterns'
import { Alert, AlertDescription, Button, Tabs, TabsList, TabsTrigger } from '@makinbakin/sdk/ui'
import { RefreshCw } from 'lucide-react'
import { useOverviewData } from '../hooks/use-overview-data'
import {
  HEALTH_REPORT_SWEEP_TIMEOUT_MS,
  HEALTH_REPORT_URL,
  requestHealthReport,
} from '../lib/health-report-client'
import { withDeadline } from '../lib/request-deadline'
import { ActivityTab } from './activity-tab'
import { AgentsTab } from './agents-tab'
import { OverviewTab } from './overview-tab'
import { RepairDialog } from './repair-dialog'
import { SystemTab } from './system-tab'

const HEALTH_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'agents', label: 'Agents' },
  { id: 'activity', label: 'Activity' },
  { id: 'system', label: 'System' },
] as const

type HealthTab = typeof HEALTH_TABS[number]['id']
type RunChecks = () => Promise<unknown>

function isHealthTab(value: string): value is HealthTab {
  return HEALTH_TABS.some((tab) => tab.id === value)
}

interface OverviewPanelProps {
  onRunChecksReady: (runChecks: RunChecks | null) => void
  onRunChecks: () => Promise<void>
}

interface SelectedRepair {
  incident: HealthIncident
  reportId: string
}

/**
 * Keeps Overview's polling resources inside its tab boundary. The page header
 * receives only an imperative Run checks callback, so selecting another tab
 * fully unmounts Overview and stops its background endpoint traffic.
 */
function OverviewPanel({ onRunChecksReady, onRunChecks }: OverviewPanelProps) {
  const overview = useOverviewData()
  const [selectedRepair, setSelectedRepair] = useState<SelectedRepair | null>(null)

  useEffect(() => {
    onRunChecksReady(overview.runChecks)
    return () => onRunChecksReady(null)
  }, [onRunChecksReady, overview.runChecks])

  const reviewRepair = useCallback((incident: HealthIncident) => {
    if (!overview.model.reportId) return
    // Capture the report with the incident. A background refresh must not
    // silently retarget an already-open repair plan to newer evidence.
    setSelectedRepair({ incident, reportId: overview.model.reportId })
  }, [overview.model.reportId])

  // The "I know" verb: POST, surface failures inline, and let the SSE
  // republish (health.report.changed fires on every ack write) plus an
  // explicit refresh update every consumer.
  const [ackError, setAckError] = useState<string | null>(null)
  const ackIncident = useCallback(async (
    incident: HealthIncident,
    action: 'ack' | 'snooze' | 'clear',
    window?: '24h' | '7d',
  ) => {
    setAckError(null)
    try {
      const response = await pluginFetch('health', '/doctor/ack', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ incidentId: incident.id, action, ...(window ? { for: window } : {}) }),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error ?? `Acknowledge failed (${response.status})`)
      }
      void overview.refresh()
    } catch (error) {
      setAckError(error instanceof Error ? error.message : String(error))
    }
  }, [overview])

  const repairTarget: HealthRepairTarget | null = selectedRepair
    ? {
        type: 'incidents',
        reportId: selectedRepair.reportId,
        ids: [selectedRepair.incident.id],
      }
    : null

  return (
    <>
      {ackError && (
        <Alert tone="danger">
          <AlertDescription>{ackError}</AlertDescription>
        </Alert>
      )}
      <OverviewTab
        data={overview}
        onRepair={reviewRepair}
        onRerun={() => { void onRunChecks() }}
        onAck={(incident, action, window) => { void ackIncident(incident, action, window) }}
      />

      {selectedRepair && repairTarget && (
        <RepairDialog
          open
          onOpenChange={(open) => {
            if (!open) setSelectedRepair(null)
          }}
          target={repairTarget}
          title={`Repair ${selectedRepair.incident.title}`}
          onApplied={() => { void overview.refresh() }}
        />
      )}
    </>
  )
}

/** Four focused Health views with URL-backed navigation and on-demand checks. */
export function HealthPage() {
  const [tabParam, setTabParam] = useQueryState('tab', 'overview')
  const pathname = usePathname()
  const activeTab: HealthTab = isHealthTab(tabParam) ? tabParam : 'overview'
  const overviewRunChecksRef = useRef<RunChecks | null>(null)
  const checksInFlightRef = useRef<Promise<void> | null>(null)
  const [runningChecks, setRunningChecks] = useState(false)
  const [announcement, setAnnouncement] = useState('')

  useEffect(() => {
    // The outgoing page can observe the destination search params for one
    // render before it unmounts. Never normalize those params onto the next
    // route (for example /team/main?tab=diagnostics).
    if (pathname === '/health' && !isHealthTab(tabParam)) setTabParam('overview')
  }, [pathname, setTabParam, tabParam])

  const registerOverviewRunChecks = useCallback((runChecks: RunChecks | null) => {
    overviewRunChecksRef.current = runChecks
  }, [])

  const runChecks = useCallback((): Promise<void> => {
    if (checksInFlightRef.current) return checksInFlightRef.current

    setRunningChecks(true)
    setAnnouncement('Running health checks.')

    const request = (async () => {
      try {
        if (overviewRunChecksRef.current) {
          const report = await overviewRunChecksRef.current()
          if (!report) throw new Error('Health checks did not return a report')
        } else {
          const controller = new AbortController()
          await withDeadline(
            requestHealthReport(HEALTH_REPORT_URL, { fresh: true, signal: controller.signal }),
            HEALTH_REPORT_SWEEP_TIMEOUT_MS,
            { onTimeout: () => controller.abort() },
          )
        }
        setAnnouncement('Health checks completed.')
      } catch {
        setAnnouncement('Health checks could not be completed. Existing evidence remains visible.')
      } finally {
        setRunningChecks(false)
        checksInFlightRef.current = null
      }
    })()

    checksInFlightRef.current = request
    return request
  }, [])

  return (
    <Page
      className="health-page"
      data-testid="health-page"
    >
      <PageHeader
        title="Health"
        description="Monitor operational readiness, investigate failed work, and repair issues before they block agents."
        meta={announcement ? (
          <span
            className={runningChecks
              ? 'font-bakin-typography-weight-medium text-bakin-text-muted'
              : announcement === 'Health checks completed.'
                ? 'font-bakin-typography-weight-medium text-bakin-action-primary-background'
                : 'font-bakin-typography-weight-medium text-bakin-signal-danger'}
            data-testid="health-action-visible-status"
            aria-hidden="true"
          >
            {announcement}
          </span>
        ) : undefined}
        actions={(
          <Button type="button" onClick={() => { void runChecks() }} busy={runningChecks}>
            <RefreshCw aria-hidden="true" />
            {runningChecks ? 'Running checks…' : 'Run checks'}
          </Button>
        )}
      />

      <p
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        data-testid="health-action-status"
      >
        {announcement}
      </p>

      <div className="@container/health min-w-0" data-slot="health-tab-frame">
        <Tabs
          value={activeTab}
          onValueChange={(value) => {
            if (isHealthTab(value)) setTabParam(value)
          }}
        >
          <TabsList
            variant="underline"
            activateOnFocus
            aria-label="Health sections"
            className="min-w-0 overflow-x-auto overflow-y-hidden"
          >
            {HEALTH_TABS.map((tab) => (
              <TabsTrigger
                key={tab.id}
                value={tab.id}
                id={`health-tab-${tab.id}`}
                aria-controls={`health-panel-${tab.id}`}
              >
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <PageBody
          gap="page"
          label={`${HEALTH_TABS.find((tab) => tab.id === activeTab)?.label ?? 'Health'} health view`}
          busy={runningChecks}
          className="pt-bakin-6"
        >
          <div
            id={`health-panel-${activeTab}`}
            role="tabpanel"
            aria-labelledby={`health-tab-${activeTab}`}
            className="min-w-0"
          >
            {activeTab === 'overview' && (
              <OverviewPanel
                onRunChecksReady={registerOverviewRunChecks}
                onRunChecks={runChecks}
              />
            )}
            {activeTab === 'agents' && <AgentsTab />}
            {activeTab === 'activity' && <ActivityTab />}
            {activeTab === 'system' && <SystemTab />}
          </div>
        </PageBody>
      </div>
    </Page>
  )
}
