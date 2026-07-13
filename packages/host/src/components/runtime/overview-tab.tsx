/**
 * Runtime hub — Overview: who is running the agents, what it can do (in
 * plain language), and whether setup is healthy. Every non-native state
 * says what happens instead — the reader never has to decode an enum.
 */
import { useState } from 'react'
import { Loader2, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from '@/hooks/use-toast'
import { capabilityRows } from '../../lib/runtime-report'
import { ModeBadge, MODE_LEGEND, StatusBadge, capabilityStateCopy } from './shared'
import type { CapabilityReport, OnboardingComponentStatus } from './types'

function CredentialTiles({ report }: { report: CapabilityReport }) {
  const creds = report.credentialStatus
  const providers = creds?.llmProviders ?? []
  const kinds = new Map((creds?.llmCredentials ?? []).map((c) => [c.provider, c.kind]))
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Active runtime</CardDescription>
          <CardTitle className="text-xl">{report.adapter}</CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground">
          {report.runtime.name}@{report.runtime.version}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Model providers</CardDescription>
          <CardTitle className="text-xl">{providers.length}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-1.5 text-xs">
          {providers.length === 0 && <span className="text-muted-foreground">None configured — agents cannot run turns.</span>}
          {providers.map((p) => (
            <span key={p} className="rounded-full border border-border px-2 py-0.5 text-muted-foreground">
              {p}{kinds.get(p) === 'oauth' ? ' · subscription' : kinds.has(p) ? ' · API key' : ''}
            </span>
          ))}
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Tool access</CardDescription>
          <CardTitle className="text-xl">{report.toolAccess.ok ? 'Healthy' : 'Needs attention'}</CardTitle>
        </CardHeader>
        <CardContent className="text-xs text-muted-foreground">
          {report.toolAccess.ok
            ? capabilityStateCopy('toolCalling', 'native', report.adapter, report.toolAccess.style)
            : report.toolAccess.issues.join('; ')}
        </CardContent>
      </Card>
    </div>
  )
}

function CapabilityGrid({ report }: { report: CapabilityReport }) {
  const rows = capabilityRows(report.capabilities).filter((row) => row.key !== 'toolCalling' && row.key !== 'input')
  const input = report.capabilities.input
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold">What this runtime can do</h2>
        <p className="text-xs text-muted-foreground">{MODE_LEGEND}</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {rows.map((row) => (
          <Card key={row.key}>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm">{row.label}</CardTitle>
              <ModeBadge mode={row.mode} />
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              {capabilityStateCopy(row.key, row.mode, report.adapter, row.detail)}
            </CardContent>
          </Card>
        ))}
        {input && (
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm">Attachments</CardTitle>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              {input.imageInput ? 'Agents can see images you attach.' : 'The active model cannot take image attachments.'}{' '}
              {input.audioInput ? 'Audio attachments work too.' : ''}
            </CardContent>
          </Card>
        )}
      </div>
    </section>
  )
}

/** Setup checks whose install() is safe to run headlessly from the UI. */
const FIXABLE_COMPONENTS = new Set(['mkdir', 'settings', 'search', 'search-models', 'plugin-assets', 'agent-sync'])

function SetupSection({ onboarding, onFixed }: { onboarding: OnboardingComponentStatus[] | null | undefined; onFixed: () => void }) {
  const [confirmTarget, setConfirmTarget] = useState<OnboardingComponentStatus | null>(null)
  const [repairing, setRepairing] = useState<string | null>(null)
  const [repairError, setRepairError] = useState<string | null>(null)

  const runRepair = async (name: string) => {
    setConfirmTarget(null)
    setRepairing(name)
    setRepairError(null)
    try {
      const res = await fetch('/api/runtime/onboarding/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ component: name }),
      })
      const body = await res.json().catch(() => null) as { ok?: boolean; result?: { message?: string; status?: string }; error?: string } | null
      if (!res.ok || body?.ok === false) {
        setRepairError(`${name} repair failed: ${body?.result?.message ?? body?.error ?? `HTTP ${res.status}`}`)
        return
      }
      toast(`Repaired ${name}${body?.result?.message ? ` — ${body.result.message}` : ''}`, 'success')
      onFixed()
    } catch (err) {
      setRepairError(`${name} repair failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setRepairing(null)
    }
  }

  return (
    <section className="space-y-3" data-testid="onboarding-status">
      <div>
        <h2 className="text-sm font-semibold">Setup checks</h2>
        <p className="text-xs text-muted-foreground">Live checks against the active runtime — the same ones `bakin check all` runs.</p>
      </div>
      {onboarding === undefined && (
        <div className="space-y-2">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-8 w-full" />
        </div>
      )}
      {onboarding === null && (
        <p className="text-sm text-muted-foreground">Setup checks are unavailable right now — retry with Refresh.</p>
      )}
      {repairError && (
        <p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{repairError}</p>
      )}
      {onboarding && (
        <Card>
          <CardContent className="divide-y divide-border p-0">
            {onboarding.map((component) => {
              const repairable = component.status !== 'ok' && FIXABLE_COMPONENTS.has(component.name)
              return (
                <div key={component.name} className="flex items-center justify-between gap-3 px-4 py-2.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{component.name}</p>
                    <p className="truncate text-xs text-muted-foreground" title={component.message}>{component.message}</p>
                    {component.remediation && component.status !== 'ok' && (
                      <p className="mt-0.5 text-xs text-muted-foreground/80">→ {component.remediation}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {repairable && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={repairing !== null}
                        onClick={() => setConfirmTarget(component)}
                        data-testid={`setup-fix-${component.name}`}
                      >
                        {repairing === component.name
                          ? (<><Loader2 className="mr-1.5 size-3 animate-spin" /> Repairing…</>)
                          : (<><Wrench className="mr-1.5 size-3" /> Repair</>)}
                      </Button>
                    )}
                    <StatusBadge status={component.status} />
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}

      <ConfirmDialog
        open={confirmTarget !== null}
        onCancel={() => setConfirmTarget(null)}
        title={`Repair ${confirmTarget?.name}?`}
        description={confirmTarget
          ? `${confirmTarget.message}. This runs the same repair as \`bakin install ${confirmTarget.name}\` and may take a moment.`
          : ''}
        confirmLabel="Repair"
        confirmTestId="setup-repair-confirm"
        onConfirm={() => { if (confirmTarget) void runRepair(confirmTarget.name) }}
      />
    </section>
  )
}

export function OverviewTab({
  report,
  onboarding,
  onRefreshOnboarding,
}: {
  report: CapabilityReport
  onboarding: OnboardingComponentStatus[] | null | undefined
  onRefreshOnboarding: () => void
}) {
  return (
    <div className="space-y-6" data-testid="runtime-summary">
      <CredentialTiles report={report} />
      <CapabilityGrid report={report} />
      <SetupSection onboarding={onboarding} onFixed={onRefreshOnboarding} />
    </div>
  )
}
