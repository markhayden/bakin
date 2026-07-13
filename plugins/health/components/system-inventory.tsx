'use client'

import { useMemo, useState } from 'react'
import type { HealthCheckState, HealthObservation, HealthReport } from '@makinbakin/sdk/types'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@makinbakin/sdk/ui'
import { StatTile, StatusBadge, type StatusTone } from '@makinbakin/sdk/components'
import { Clock3, Cpu, Hash, MemoryStick, Network, Users } from 'lucide-react'
import { formatAge } from '@makinbakin/sdk/utils'
import type { HealthSummary } from '../types'
import { formatUptime } from '../lib/format'
import type {
  SystemMutationState,
  SystemPluginManifestData,
  SystemPluginManifestEntry,
  SystemRegistryData,
  SystemRegistryPlugin,
} from '../hooks/use-system-data'

export interface SystemInventoryProps {
  report: HealthReport | null
  live: HealthSummary | null
  registry: SystemRegistryData | null
  manifest: SystemPluginManifestData | null
  loading?: boolean
  checkingUpdates?: boolean
  error?: string | null
  backgroundError?: string | null
  pluginMutation: SystemMutationState
  onCheckUpdates: () => void | Promise<unknown>
  onUpgrade: (pluginId: string, approvePermissions?: boolean) => void | Promise<void>
}

interface InventoryPlugin {
  id: string
  name: string
  description: string
  version: string
  latestVersion?: string | null
  source: string
  routes: number
  status: 'active' | 'failed'
  upgradeAvailable: boolean
  errorCode?: string
  errorMessage?: string
  missingDependencies?: string[]
}

type CheckTone = StatusTone

interface CheckPresentation {
  label: string
  tone: CheckTone
  detail: string
  concerning: boolean
}

const OBSERVATION_RANK: Record<HealthObservation['status'], number> = {
  healthy: 0,
  warning: 1,
  unknown: 2,
  error: 3,
}

function mergePlugins(
  registry: SystemRegistryData | null,
  manifest: SystemPluginManifestData | null,
): InventoryPlugin[] {
  const registryById = new Map((registry?.plugins ?? []).map((plugin) => [plugin.id, plugin]))
  const manifestById = new Map((manifest?.plugins ?? []).map((plugin) => [plugin.id, plugin]))
  const ids = new Set([...registryById.keys(), ...manifestById.keys()])
  return [...ids].map((id) => {
    const active: SystemRegistryPlugin | undefined = registryById.get(id)
    const installed: SystemPluginManifestEntry | undefined = manifestById.get(id)
    return {
      id,
      name: active?.name ?? installed?.name ?? id,
      description: active?.description ?? '',
      version: installed?.version ?? active?.version ?? 'unknown',
      latestVersion: installed?.latestVersion,
      source: installed?.source ?? active?.source ?? 'unknown',
      routes: active?.routes ?? 0,
      status: active?.status ?? installed?.status ?? 'active',
      upgradeAvailable: installed?.upgradeAvailable ?? false,
      errorCode: active?.errorCode ?? installed?.errorCode,
      errorMessage: active?.errorMessage ?? installed?.errorMessage,
      missingDependencies: active?.missingDependencies ?? installed?.missingDependencies,
    }
  }).sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
}

function worstObservation(observations: readonly HealthObservation[]): HealthObservation | null {
  return observations.reduce<HealthObservation | null>((worst, observation) => {
    if (!worst) return observation
    if (observation.snapshot === 'last_known' && worst.snapshot !== 'last_known') return observation
    if (worst.snapshot === 'last_known' && observation.snapshot !== 'last_known') return worst
    return OBSERVATION_RANK[observation.status] > OBSERVATION_RANK[worst.status] ? observation : worst
  }, null)
}

function presentCheck(check: HealthCheckState): CheckPresentation {
  const execution = check.latestExecution
  if (execution.outcome === 'not_applicable') {
    return {
      label: 'Not applicable', tone: 'neutral', concerning: false,
      detail: execution.reason ?? 'This check does not apply to the current configuration.',
    }
  }
  if (execution.outcome === 'failed' || execution.outcome === 'invalid') {
    return {
      label: 'Unable to verify', tone: 'neutral', concerning: true,
      detail: execution.error?.message ?? `The check ${execution.outcome}.`,
    }
  }
  const observation = worstObservation(check.latestValidSnapshot?.observations ?? [])
  if (!observation) {
    return { label: 'Unable to verify', tone: 'neutral', concerning: true, detail: 'No valid evidence was returned.' }
  }
  if (observation.snapshot === 'last_known') {
    return {
      label: 'Last known', tone: 'neutral', concerning: true,
      detail: `${observation.summary} Current evidence could not be verified.`,
    }
  }
  switch (observation.status) {
    case 'healthy': return { label: 'Healthy', tone: 'success', concerning: false, detail: observation.summary }
    case 'warning': return { label: 'Watching', tone: 'warning', concerning: true, detail: observation.summary }
    case 'error': return { label: 'Needs attention', tone: 'destructive', concerning: true, detail: observation.summary }
    case 'unknown': return { label: 'Unable to verify', tone: 'neutral', concerning: true, detail: observation.summary }
  }
}

function mutationClass(status: SystemMutationState['status']): string {
  if (status === 'error') return 'border-destructive/25 bg-destructive/10 text-destructive'
  if (status === 'success') return 'border-success/25 bg-success/10 text-success'
  if (status === 'confirmation') return 'border-warning/25 bg-warning/10 text-warning'
  return 'border-border bg-muted/40 text-muted-foreground'
}

export function SystemInventory({
  report,
  live,
  registry,
  manifest,
  loading = false,
  checkingUpdates = false,
  error = null,
  backgroundError = null,
  pluginMutation,
  onCheckUpdates,
  onUpgrade,
}: SystemInventoryProps) {
  const [pluginSearch, setPluginSearch] = useState('')
  const plugins = useMemo(() => mergePlugins(registry, manifest), [manifest, registry])
  const exceptions = plugins.filter((plugin) => plugin.status === 'failed' || plugin.upgradeAvailable)
  const filteredPlugins = useMemo(() => {
    const query = pluginSearch.trim().toLowerCase()
    if (!query) return plugins
    return plugins.filter((plugin) =>
      plugin.name.toLowerCase().includes(query)
      || plugin.id.toLowerCase().includes(query)
      || plugin.description.toLowerCase().includes(query))
  }, [pluginSearch, plugins])
  const sessions = live?.activeSessions?.reduce((total, row) => total + row.sessions, 0) ?? null
  const groupedChecks = useMemo(() => {
    const groups = new Map<string, { key: string; label: string; checks: HealthCheckState[] }>()
    for (const check of report?.checks ?? []) {
      const group = groups.get(check.group.key) ?? { key: check.group.key, label: check.group.label, checks: [] }
      group.checks.push(check)
      groups.set(check.group.key, group)
    }
    return [...groups.values()].sort((left, right) => left.label.localeCompare(right.label))
  }, [report])

  return (
    <div className="space-y-5">
      {exceptions.length > 0 && (
        <section aria-labelledby="plugin-exceptions-title">
          <div className="mb-2 flex items-end justify-between gap-3">
            <div>
              <h2 id="plugin-exceptions-title" className="text-base font-semibold">Plugin exceptions</h2>
              <p className="text-sm text-muted-foreground">Failures and available updates are shown before the full inventory.</p>
            </div>
            <Badge variant="destructive">{exceptions.length}</Badge>
          </div>
          <div className="grid gap-3 @[56rem]/health-system:grid-cols-2">
            {exceptions.map((plugin) => (
              <Card key={plugin.id} size="sm" className={plugin.status === 'failed' ? 'ring-destructive/30' : 'ring-info/30'}>
                <CardContent className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-medium">{plugin.name}</h3>
                      {plugin.status === 'failed' ? (
                        <StatusBadge variant="outline" tone="destructive">Failed to activate</StatusBadge>
                      ) : (
                        <StatusBadge variant="outline" tone="accent">Update available</StatusBadge>
                      )}
                    </div>
                    {plugin.status === 'failed' ? (
                      <div className="mt-2 text-xs text-muted-foreground">
                        <p>{plugin.errorMessage ?? 'The plugin did not activate.'}</p>
                        {plugin.errorCode && <p className="mt-1 font-mono">Code: {plugin.errorCode}</p>}
                        {plugin.missingDependencies && plugin.missingDependencies.length > 0 && (
                          <p className="mt-1">Missing dependencies: {plugin.missingDependencies.join(', ')}</p>
                        )}
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Installed {plugin.version} · available {plugin.latestVersion ?? 'latest'}
                      </p>
                    )}
                  </div>
                  {plugin.upgradeAvailable && plugin.status !== 'failed' && (
                    <Button
                      size="sm"
                      variant="info"
                      disabled={pluginMutation.status === 'pending'}
                      onClick={() => void onUpgrade(plugin.id)}
                      aria-label={`Update ${plugin.name}`}
                    >
                      {pluginMutation.status === 'pending' && pluginMutation.target === plugin.id ? 'Updating…' : 'Update'}
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </section>
      )}

      {pluginMutation.status !== 'idle' && pluginMutation.message && (
        <div
          role={pluginMutation.status === 'error' ? 'alert' : 'status'}
          aria-live="polite"
          className={`rounded-lg border px-3 py-2 text-sm ${mutationClass(pluginMutation.status)}`}
        >
          <p>{pluginMutation.message}</p>
          {pluginMutation.status === 'confirmation' && pluginMutation.target && (
            <div className="mt-2">
              <p className="text-xs">
                Requested permissions: {pluginMutation.permissions?.length
                  ? pluginMutation.permissions.join(', ')
                  : 'No permission names were returned.'}
              </p>
              <Button
                className="mt-2"
                size="sm"
                variant="warning"
                onClick={() => void onUpgrade(pluginMutation.target!, true)}
              >
                Approve update
              </Button>
            </div>
          )}
        </div>
      )}

      <Card>
        <CardHeader className="border-b">
          <CardTitle className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Installed plugins</h2>
              <p className="mt-1 text-sm font-normal text-muted-foreground">Everything currently discovered by the host.</p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{plugins.length}</Badge>
              <Button
                size="sm"
                variant="outline"
                disabled={pluginMutation.status === 'pending' || checkingUpdates}
                onClick={() => void onCheckUpdates()}
              >
                {checkingUpdates ? 'Checking…' : 'Check for updates'}
              </Button>
            </div>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(error || backgroundError) && (
            <div role="alert" className="rounded-lg border border-warning/25 bg-warning/10 px-3 py-2 text-sm text-warning">
              Plugin inventory could not be refreshed: {error ?? backgroundError}
            </div>
          )}
          <label className="block max-w-sm text-xs font-medium text-muted-foreground">
            Find a plugin
            <input
              type="search"
              value={pluginSearch}
              onChange={(event) => setPluginSearch(event.target.value)}
              placeholder="Name, id, or description"
              className="mt-1 h-8 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
            />
          </label>
          {loading && plugins.length === 0 ? (
            <p className="text-sm text-muted-foreground">Loading installed plugins…</p>
          ) : filteredPlugins.length === 0 ? (
            <p className="text-sm text-muted-foreground">{pluginSearch ? 'No matching plugins.' : 'No plugins were discovered.'}</p>
          ) : (
            <div data-testid="installed-plugin-table-scroll" className="max-h-80 overflow-auto rounded-lg border border-border">
              <table className="w-full min-w-[760px] text-left text-xs">
                <thead className="sticky top-0 z-10 bg-muted text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2 font-medium">Plugin</th>
                    <th scope="col" className="px-3 py-2 font-medium">Version</th>
                    <th scope="col" className="px-3 py-2 font-medium">Source</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Routes</th>
                    <th scope="col" className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredPlugins.map((plugin) => (
                    <tr key={plugin.id}>
                      <td className="px-3 py-2.5">
                        <p className="font-medium text-foreground">{plugin.name}</p>
                        <p className="font-mono text-[10px] text-muted-foreground">{plugin.id}</p>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-muted-foreground">{plugin.version}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">{plugin.source}</td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">{plugin.routes}</td>
                      <td className="px-3 py-2.5">
                        <StatusBadge variant="outline" tone={plugin.status === 'failed' ? 'destructive' : plugin.upgradeAvailable ? 'accent' : 'success'}>
                          {plugin.status === 'failed' ? 'Failed' : plugin.upgradeAvailable ? 'Update available' : 'Active'}
                        </StatusBadge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b">
          <CardTitle>
            <h2 className="text-base font-semibold">Runtime</h2>
            <p className="mt-1 text-sm font-normal text-muted-foreground">Current host process and connected client sessions.</p>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 @[30rem]/health-system:grid-cols-2 @[50rem]/health-system:grid-cols-3 @[70rem]/health-system:grid-cols-6">
            <StatTile icon={Users} label="Connected sessions" value={sessions === null ? '—' : sessions} sub="Summed across agents" />
            <StatTile icon={Clock3} label="Uptime" value={live?.upSince ? formatUptime(live.upSince) : '—'} sub="Current host process" />
            <StatTile icon={MemoryStick} label="Memory" value={live?.server ? `${live.server.memoryMB} MB` : '—'} sub={live?.server ? `${live.server.totalMemoryMB} MB host total` : 'Host memory unavailable'} />
            <StatTile icon={Network} label="Port" value={live?.server ? live.server.port : '—'} sub="HTTP server" />
            <StatTile icon={Hash} label="PID" value={live?.server ? live.server.pid : '—'} sub="Process id" />
            <StatTile icon={Cpu} label="Node" value={live?.server?.nodeVersion ?? '—'} sub="Runtime version" />
          </div>
          {live?.activeSessions && live.activeSessions.length > 0 && (
            <details className="mt-3 rounded-lg border border-border px-3 py-2">
              <summary className="cursor-pointer text-sm font-medium">Session detail</summary>
              <ul className="mt-2 divide-y divide-border text-xs">
                {live.activeSessions.map((session) => (
                  <li key={`${session.agent}:${session.connectedAt}`} className="flex items-center justify-between gap-3 py-2">
                    <span className="font-medium">{session.agent}</span>
                    <span className="text-muted-foreground">{session.sessions} · connected {formatAge(session.connectedAt)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="border-b">
          <CardTitle className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold">Full check inventory</h2>
              <p className="mt-1 text-sm font-normal text-muted-foreground">Every registered check, including healthy and not-applicable results.</p>
            </div>
            <Badge variant="secondary">{report?.checks.length ?? 0} checks</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!report ? (
            <p className="text-sm text-muted-foreground">Waiting for the canonical health report…</p>
          ) : groupedChecks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No health checks are registered.</p>
          ) : (
            <div className="space-y-2">
              {groupedChecks.map((group) => {
                const presentations = group.checks.map((check) => ({ check, presentation: presentCheck(check) }))
                const concerning = presentations.filter((row) => row.presentation.concerning).length
                return (
                  <details key={group.key} className="rounded-lg border border-border" open={concerning > 0}>
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 marker:hidden">
                      <span className="font-medium">{group.label}</span>
                      <span className="flex items-center gap-2">
                        {concerning > 0 && <Badge variant="destructive">{concerning} need review</Badge>}
                        <Badge variant="secondary">{group.checks.length}</Badge>
                      </span>
                    </summary>
                    <div className="divide-y divide-border border-t border-border">
                      {presentations.map(({ check, presentation }) => (
                        <div key={check.checkId} className="grid gap-2 px-3 py-3 @[40rem]/health-system:grid-cols-[minmax(0,1fr)_auto]">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="font-medium">{check.checkName}</h3>
                              <StatusBadge variant="outline" tone={presentation.tone}>{presentation.label}</StatusBadge>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">{check.description}</p>
                            <p className="mt-1 text-xs text-foreground/80">{presentation.detail}</p>
                          </div>
                          <div className="text-left text-[10px] text-muted-foreground @[40rem]/health-system:text-right">
                            <p>{check.owner.label}</p>
                            <p>{formatAge(check.latestExecution.completedAt)}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
