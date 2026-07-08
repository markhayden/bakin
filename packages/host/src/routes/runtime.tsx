/**
 * /runtime — runtime-management page (P3.3).
 *
 * Shows the active runtime adapter, its capability matrix
 * (native/shimmed/unavailable per capability), tool-access status, and the
 * onboarding setup state; runs the orchestrated switch with confirmation +
 * live progress (runtime:switch SSE events) + honest carry report, and
 * surfaces the target runtime's setup steps after a switch.
 */
import { createRoute } from '@tanstack/react-router'
import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { PageLayout } from '@/components/page-layout'
import {
  capabilityRows,
  reduceSwitchProgress,
  SWITCH_PHASE_LABELS,
  type CapabilitiesPayload,
  type SwitchStepRow,
} from '../lib/runtime-report'
import { Route as RootRoute } from './__root'

interface CapabilityReport {
  adapter: string
  adapters: string[]
  runtime: { name: string; version: string }
  capabilities: CapabilitiesPayload
  toolAccess: { style: string; ok: boolean; issues: string[] }
}

interface OnboardingComponentStatus {
  name: string
  status: 'ok' | 'warn' | 'missing' | 'broken' | 'error' | string
  message: string
  remediation?: string
}

interface SwitchResultPayload {
  ok: boolean
  from: string
  to: string
  error?: string
  restored?: boolean
  backupPath: string | null
  restartRequired: boolean
  roster: {
    carried: Array<{ agentId: string; model?: string; mappedFrom?: string }>
    existing: string[]
    unmappedModels: Array<{ agentId: string; sourceModel: string }>
    failed: Array<{ agentId: string; error: string }>
  } | null
  sync: { drifted: boolean; findings: number; syncedAgents: number } | null
}

function modeBadgeClass(mode: string): string {
  if (mode === 'native') return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
  if (mode === 'shimmed') return 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
  return 'bg-zinc-500/15 text-zinc-500 dark:text-zinc-400'
}

function statusBadgeClass(status: string): string {
  if (status === 'ok') return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
  if (status === 'warn' || status === 'skipped') return 'bg-amber-500/15 text-amber-600 dark:text-amber-400'
  return 'bg-red-500/15 text-red-600 dark:text-red-400'
}

function RuntimePage() {
  const [report, setReport] = useState<CapabilityReport | null>(null)
  const [reportError, setReportError] = useState<string | null>(null)
  const [onboarding, setOnboarding] = useState<OnboardingComponentStatus[] | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<string | null>(null)
  const [switching, setSwitching] = useState(false)
  const [steps, setSteps] = useState<SwitchStepRow[]>([])
  const [result, setResult] = useState<SwitchResultPayload | null>(null)
  const esRef = useRef<EventSource | null>(null)

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
    try {
      const res = await fetch('/api/runtime/onboarding')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const payload = await res.json() as { components: OnboardingComponentStatus[] }
      setOnboarding(payload.components)
    } catch {
      setOnboarding(null)
    }
  }, [])

  useEffect(() => {
    void loadReport()
    void loadOnboarding()
    return () => { esRef.current?.close() }
  }, [loadReport, loadOnboarding])

  const runSwitch = useCallback(async (target: string) => {
    setConfirmTarget(null)
    setSwitching(true)
    setSteps([])
    setResult(null)

    // Dedicated short-lived stream for the switch progress events.
    const es = new EventSource('/api/events')
    esRef.current = es
    es.onmessage = (msg) => {
      try {
        const event = JSON.parse(msg.data as string)
        if (event?.type === 'runtime:switch') setSteps((prev) => reduceSwitchProgress(prev, event))
      } catch { /* non-JSON keepalives */ }
    }

    try {
      const res = await fetch('/api/runtime/switch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target }),
      })
      const payload = await res.json() as SwitchResultPayload
      setResult(payload)
    } catch (err) {
      setResult({
        ok: false,
        from: report?.adapter ?? '?',
        to: target,
        error: err instanceof Error ? err.message : String(err),
        backupPath: null,
        restartRequired: false,
        roster: null,
        sync: null,
      })
    } finally {
      es.close()
      esRef.current = null
      setSwitching(false)
      void loadReport()
      void loadOnboarding()
    }
  }, [report, loadReport, loadOnboarding])

  const rows = capabilityRows(report?.capabilities)
  const otherAdapters = (report?.adapters ?? []).filter((name) => name !== report?.adapter)

  return (
    <PageLayout title="Runtime" subtitle="Adapter status, capability matrix, and switching">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4">
        {reportError && (
          <div className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm">
            Failed to load the runtime report: {reportError}
          </div>
        )}

        {report && (
          <section className="rounded-lg border p-4" data-testid="runtime-summary">
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="text-sm text-muted-foreground">Active runtime</div>
                <div className="text-lg font-semibold">
                  {report.adapter}
                  <span className="ml-2 text-sm font-normal text-muted-foreground">
                    {report.runtime.name}@{report.runtime.version}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={() => { void loadReport(); void loadOnboarding() }}
                className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-accent"
              >
                <RefreshCw className="size-3" /> Refresh
              </button>
            </div>
            <div className={`mt-2 text-sm ${report.toolAccess.ok ? 'text-muted-foreground' : 'text-red-500'}`}>
              Tool access: {report.toolAccess.ok ? `ok (${report.toolAccess.style})` : report.toolAccess.issues.join('; ')}
            </div>
          </section>
        )}

        {rows.length > 0 && (
          <section className="rounded-lg border p-4">
            <h2 className="mb-3 text-sm font-semibold">Capability matrix</h2>
            <div className="flex flex-col gap-2" data-testid="capability-matrix">
              {rows.map((row) => (
                <div key={row.key} className="flex items-center justify-between gap-2 text-sm">
                  <span>{row.label}</span>
                  <span className="flex items-center gap-2">
                    {row.detail && <span className="text-xs text-muted-foreground">{row.detail}</span>}
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${modeBadgeClass(row.mode)}`}>
                      {row.mode}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}

        {otherAdapters.length > 0 && (
          <section className="rounded-lg border p-4">
            <h2 className="mb-1 text-sm font-semibold">Switch runtime</h2>
            <p className="mb-3 text-xs text-muted-foreground">
              Settings are backed up first; the roster carries over best-effort with an honest report;
              a completed switch needs a server restart to rebind plugins. Failures auto-restore the
              previous runtime.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {otherAdapters.map((name) => (
                confirmTarget === name ? (
                  <span key={name} className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={switching}
                      onClick={() => void runSwitch(name)}
                      className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                    >
                      Confirm switch to {name}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmTarget(null)}
                      className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent"
                    >
                      Cancel
                    </button>
                  </span>
                ) : (
                  <button
                    key={name}
                    type="button"
                    disabled={switching}
                    onClick={() => setConfirmTarget(name)}
                    className="rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
                  >
                    Switch to {name}…
                  </button>
                )
              ))}
            </div>

            {(switching || steps.length > 0) && (
              <div className="mt-4 flex flex-col gap-1 text-sm" data-testid="switch-progress">
                {steps.map((step) => (
                  <div key={step.phase} className="flex items-center gap-2">
                    <span className={`inline-block size-2 rounded-full ${
                      step.status === 'ok' ? 'bg-emerald-500'
                        : step.status === 'running' ? 'animate-pulse bg-blue-500'
                          : step.status === 'skip' ? 'bg-zinc-400'
                            : 'bg-red-500'
                    }`} />
                    <span>{SWITCH_PHASE_LABELS[step.phase] ?? step.phase}</span>
                    {step.detail && <span className="text-xs text-muted-foreground">— {step.detail}</span>}
                  </div>
                ))}
              </div>
            )}

            {result && (
              <div className={`mt-4 rounded-md border p-3 text-sm ${result.ok ? 'border-emerald-500/30 bg-emerald-500/10' : 'border-red-500/30 bg-red-500/10'}`} data-testid="switch-result">
                {result.ok ? (
                  <>
                    <div className="font-medium">Switched {result.from} → {result.to}</div>
                    {result.roster && (
                      <div className="mt-1">
                        Roster: carried {result.roster.carried.length}, existing {result.roster.existing.length}, failed {result.roster.failed.length}
                      </div>
                    )}
                    {result.roster?.unmappedModels.map((u) => (
                      <div key={u.agentId} className="mt-1 text-amber-600 dark:text-amber-400">
                        ⚠ {u.agentId}: model “{u.sourceModel}” has no {result.to} equivalent — falls back to the routing default
                      </div>
                    ))}
                    {result.backupPath && (
                      <div className="mt-1 text-xs text-muted-foreground">Rollback backup: {result.backupPath}</div>
                    )}
                    {result.restartRequired && (
                      <div className="mt-2 font-medium">⚠ Restart required — run <code>bakin restart</code> so plugins rebind.</div>
                    )}
                  </>
                ) : (
                  <>
                    <div className="font-medium">Switch failed: {result.error}</div>
                    {result.restored !== undefined && (
                      <div className="mt-1">
                        {result.restored
                          ? `The previous runtime (${result.from}) was restored.`
                          : `RESTORE FAILED — compare settings.json with the backup: ${result.backupPath}`}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}
          </section>
        )}

        <section className="rounded-lg border p-4">
          <h2 className="mb-1 text-sm font-semibold">Runtime setup</h2>
          <p className="mb-3 text-xs text-muted-foreground">
            Onboarding status for the active runtime — anything below “ok” needs attention after a switch.
          </p>
          {onboarding === null ? (
            <div className="text-sm text-muted-foreground">Setup status unavailable.</div>
          ) : (
            <div className="flex flex-col gap-2" data-testid="onboarding-status">
              {onboarding.map((component) => (
                <div key={component.name} className="flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium">{component.name}</div>
                    <div className="truncate text-xs text-muted-foreground" title={component.message}>{component.message}</div>
                    {component.status !== 'ok' && component.remediation && (
                      <div className="mt-0.5 text-xs">{component.remediation}</div>
                    )}
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${statusBadgeClass(component.status)}`}>
                    {component.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </PageLayout>
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
