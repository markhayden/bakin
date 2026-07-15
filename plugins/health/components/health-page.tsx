'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { HealthIncident, HealthRepairTarget } from '@makinbakin/sdk/types'
import { PluginHeader, UnderlineTabs } from '@makinbakin/sdk/components'
import { usePathname, useQueryState } from '@makinbakin/sdk/hooks'
import { Button } from '@makinbakin/sdk/ui'
import { RefreshCw } from 'lucide-react'
import { useOverviewData } from '../hooks/use-overview-data'
import { requestWithTimeout } from '../hooks/use-health-resource'
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

const HEALTH_CHECKS_TIMEOUT_MS = 60_000

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

  const repairTarget: HealthRepairTarget | null = selectedRepair
    ? {
        type: 'incidents',
        reportId: selectedRepair.reportId,
        ids: [selectedRepair.incident.id],
      }
    : null

  return (
    <>
      <OverviewTab
        data={overview}
        onRepair={reviewRepair}
        onRerun={() => { void onRunChecks() }}
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
          await requestWithTimeout(
            (async () => {
              const response = await fetch('/api/plugins/health/doctor?fresh=true', {
                signal: controller.signal,
              })
              if (!response.ok) throw new Error(`Health checks failed (${response.status})`)
              await response.json()
            })(),
            HEALTH_CHECKS_TIMEOUT_MS,
            () => controller.abort(),
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
    <div
      className="health-page @container/health min-w-0 space-y-5 p-4 sm:space-y-6 sm:p-6"
      data-testid="health-page"
    >
      <PluginHeader
        title="Health"
        meta={announcement ? (
          <span
            className={runningChecks
              ? 'text-xs font-medium text-muted-foreground'
              : announcement === 'Health checks completed.'
                ? 'text-xs font-medium text-success'
                : 'text-xs font-medium text-destructive'}
            data-testid="health-action-visible-status"
            aria-hidden="true"
          >
            {announcement}
          </span>
        ) : undefined}
        actions={(
          <Button type="button" onClick={() => { void runChecks() }} disabled={runningChecks}>
            <RefreshCw
              className={runningChecks ? 'animate-spin motion-reduce:animate-none' : undefined}
              aria-hidden="true"
            />
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

      <div className="min-w-0">
        <UnderlineTabs
          tabs={HEALTH_TABS}
          value={activeTab}
          onValueChange={(value) => {
            if (isHealthTab(value)) setTabParam(value)
          }}
          ariaLabel="Health sections"
          idPrefix="health"
          className="min-w-0 overflow-x-auto overflow-y-hidden"
        />

        <div
          id={`health-panel-${activeTab}`}
          role="tabpanel"
          aria-labelledby={`health-tab-${activeTab}`}
          className="min-w-0 pt-4"
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
      </div>
    </div>
  )
}
