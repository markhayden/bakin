'use client'

import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react'
import type { HealthCheckState, HealthReport } from '@makinbakin/sdk/types'
import { Grid } from '@makinbakin/sdk/layout'
import {
  ListRow,
  ListRows,
  StatTile,
  StatusBadge,
  type StatusTone,
} from '@makinbakin/sdk/patterns'
import { Badge, Banner, Button, Input, type BannerTone } from '@makinbakin/sdk/ui'
import { ChevronRight, Clock3, Cpu, Hash, MemoryStick, Network, Users } from 'lucide-react'
import { formatAge } from '@makinbakin/sdk/utils'
import type { HealthSummary } from '../types'
import { formatUptime } from '../lib/format'
import type {
  SystemMutationState,
  SystemPluginManifestData,
  SystemRegistryData,
} from '../hooks/use-system-data'
import {
  mergeSystemPlugins,
  presentSystemCheck,
} from '../lib/system-view-model'
import { focusSystemElement } from './system-navigation'

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
  pluginInventoryCurrent: boolean
  pluginSearch: string
  onPluginSearchChange: (value: string) => void
  onCheckUpdates: () => void | Promise<unknown>
  onUpgrade: (pluginId: string, approvePermissions?: boolean) => void | Promise<void>
}

export interface SystemInventoryHandle {
  revealHost: () => void
  revealPlugins: () => void
  revealPlugin: (pluginId: string) => boolean
  revealChecks: () => void
  revealCheck: (checkId: string) => boolean
}

function mutationTone(status: SystemMutationState['status']): BannerTone {
  if (status === 'error') return 'danger'
  if (status === 'success') return 'success'
  if (status === 'confirmation' || status === 'outcome-unknown') return 'attention'
  return 'info'
}

function canonicalTone(tone: string): StatusTone {
  if (tone === 'destructive') return 'danger'
  if (tone === 'warning') return 'attention'
  if (tone === 'success' || tone === 'accent') return tone
  return 'neutral'
}

function revealDisclosure(
  disclosure: HTMLDetailsElement | null,
  summary: HTMLElement | null,
): void {
  if (!disclosure) return
  disclosure.open = true
  if (summary) focusSystemElement(summary)
}

export const SystemInventory = forwardRef<SystemInventoryHandle, SystemInventoryProps>(function SystemInventory({
  report,
  live,
  registry,
  manifest,
  loading = false,
  checkingUpdates = false,
  error = null,
  backgroundError = null,
  pluginMutation,
  pluginInventoryCurrent,
  pluginSearch,
  onPluginSearchChange,
  onCheckUpdates,
  onUpgrade,
}, ref) {
  const pluginsDisclosureRef = useRef<HTMLDetailsElement>(null)
  const pluginsSummaryRef = useRef<HTMLElement>(null)
  const hostDisclosureRef = useRef<HTMLDetailsElement>(null)
  const hostSummaryRef = useRef<HTMLElement>(null)
  const checksDisclosureRef = useRef<HTMLDetailsElement>(null)
  const checksSummaryRef = useRef<HTMLElement>(null)
  const pluginRowRefs = useRef(new Map<string, HTMLTableRowElement>())
  const checkRowRefs = useRef(new Map<string, HTMLElement>())
  const checkGroupRefs = useRef(new Map<string, HTMLDetailsElement>())
  const plugins = useMemo(() => mergeSystemPlugins(registry, manifest), [manifest, registry])
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
  const checksToReview = useMemo(() => (report?.checks ?? [])
    .filter((check) => presentSystemCheck(check).concerning).length, [report])
  const checkGroupById = useMemo(() => {
    const groupByCheckId = new Map<string, string>()
    for (const group of groupedChecks) {
      for (const check of group.checks) groupByCheckId.set(check.checkId, group.key)
    }
    return groupByCheckId
  }, [groupedChecks])

  useImperativeHandle(ref, () => ({
    revealHost: () => revealDisclosure(hostDisclosureRef.current, hostSummaryRef.current),
    revealPlugins: () => revealDisclosure(pluginsDisclosureRef.current, pluginsSummaryRef.current),
    revealPlugin: (pluginId) => {
      const target = pluginRowRefs.current.get(pluginId)
      if (!target) {
        revealDisclosure(pluginsDisclosureRef.current, pluginsSummaryRef.current)
        return false
      }
      if (pluginsDisclosureRef.current) pluginsDisclosureRef.current.open = true
      focusSystemElement(target, { block: 'center' })
      return true
    },
    revealChecks: () => revealDisclosure(checksDisclosureRef.current, checksSummaryRef.current),
    revealCheck: (checkId) => {
      if (checksDisclosureRef.current) checksDisclosureRef.current.open = true
      const groupId = checkGroupById.get(checkId)
      const group = groupId ? checkGroupRefs.current.get(groupId) : null
      if (group) group.open = true
      const target = checkRowRefs.current.get(checkId)
      if (!target) {
        if (checksSummaryRef.current) focusSystemElement(checksSummaryRef.current)
        return false
      }
      focusSystemElement(target, { block: 'center' })
      return true
    },
  }), [checkGroupById])

  return (
    <div className="space-y-5">
      {pluginMutation.status !== 'idle' && pluginMutation.message && (
        <Banner
          tone={mutationTone(pluginMutation.status)}
          announce={pluginMutation.status === 'error' ? 'assertive' : 'polite'}
          headingLevel={3}
          title={pluginMutation.status === 'confirmation' ? 'Update needs approval' : 'Plugin inventory update'}
          description={pluginMutation.status === 'confirmation'
            ? `${pluginMutation.message} Requested permissions: ${pluginMutation.permissions?.length
              ? pluginMutation.permissions.join(', ')
              : 'No permission names were returned.'}`
            : pluginMutation.message}
          action={pluginMutation.status === 'confirmation' && pluginMutation.target ? (
            <Button
              size="sm"
              variant="warning"
              onClick={() => void onUpgrade(pluginMutation.target!, true)}
            >
              Approve update
            </Button>
          ) : undefined}
        />
      )}

      <details ref={pluginsDisclosureRef} data-testid="installed-features-details" className="group overflow-hidden rounded-xl border border-border bg-card">
        <summary ref={pluginsSummaryRef} className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 marker:hidden">
          <span className="min-w-0">
            <span className="block text-sm font-semibold">Installed features</span>
            <span className="block text-xs text-muted-foreground">Browse plugins, versions, activation state, and updates.</span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <Badge variant="secondary">{plugins.length}</Badge>
            <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground transition-transform group-open:rotate-90 motion-reduce:transition-none" />
          </span>
        </summary>
        <div className="space-y-3 border-t border-border p-4">
          <div className="flex justify-end">
            <Button
              size="sm"
              variant="outline"
              disabled={pluginMutation.status === 'pending' || checkingUpdates}
              onClick={() => void onCheckUpdates()}
            >
              {checkingUpdates ? 'Checking…' : 'Check for updates'}
            </Button>
          </div>
          {(error || backgroundError) && (
            <Banner
              tone="attention"
              announce="polite"
              headingLevel={3}
              title="Plugin inventory could not be refreshed"
              description={error ?? backgroundError}
            />
          )}
          <label className="block max-w-sm text-xs font-medium text-muted-foreground">
            Find a plugin
            <Input
              type="search"
              value={pluginSearch}
              onChange={(event) => onPluginSearchChange(event.target.value)}
              placeholder="Name, id, or description"
              className="mt-1"
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
                    <tr
                      key={plugin.id}
                      ref={(element) => {
                        if (element) pluginRowRefs.current.set(plugin.id, element)
                        else pluginRowRefs.current.delete(plugin.id)
                      }}
                      data-plugin-id={plugin.id}
                      tabIndex={-1}
                      className="outline-none focus-visible:bg-accent/[0.06] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    >
                      <td className="px-3 py-2.5">
                        <p className="font-medium text-foreground">{plugin.name}</p>
                        <p className="font-mono text-[10px] text-muted-foreground">{plugin.id}</p>
                        {(plugin.status === 'failed' || plugin.activationConflict) && (
                          <div className="mt-1 max-w-md text-[10px] leading-relaxed text-muted-foreground">
                            <p>{plugin.activationConflict
                              ? 'Registry and manifest activation states disagree.'
                              : plugin.errorMessage ?? 'The plugin did not activate.'}</p>
                            {plugin.errorCode && <p className="font-mono">Code: {plugin.errorCode}</p>}
                            {plugin.missingDependencies && plugin.missingDependencies.length > 0 && (
                              <p>Missing dependencies: {plugin.missingDependencies.join(', ')}</p>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-muted-foreground">{plugin.version}</td>
                      <td className="px-3 py-2.5 text-muted-foreground">{plugin.source}</td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums">{plugin.routes}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge
                            variant="outline"
                            tone={!pluginInventoryCurrent ? 'neutral' : plugin.status === 'failed' ? 'danger' : plugin.status === 'unknown' ? 'neutral' : plugin.upgradeAvailable ? 'accent' : 'success'}
                          >
                            {!pluginInventoryCurrent
                              ? `Last loaded · ${plugin.status === 'failed' ? 'Failed' : plugin.status === 'unknown' ? 'Unknown' : plugin.upgradeAvailable ? 'Update available' : 'Active'}`
                              : plugin.status === 'failed' ? 'Failed' : plugin.status === 'unknown' ? 'Activation unknown' : plugin.upgradeAvailable ? 'Update available' : 'Active'}
                          </StatusBadge>
                          {plugin.upgradeAvailable && plugin.status === 'active' && (
                            <Button
                              size="xs"
                              variant="info"
                              disabled={pluginMutation.status === 'pending'
                                || (pluginMutation.status === 'outcome-unknown' && pluginMutation.target === plugin.id)}
                              onClick={() => void onUpgrade(plugin.id)}
                              aria-label={`Update ${plugin.name}`}
                            >
                              {pluginMutation.status === 'pending' && pluginMutation.target === plugin.id ? 'Updating…' : 'Update'}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </details>

      <details ref={hostDisclosureRef} data-testid="bakin-host-details" className="group overflow-hidden rounded-xl border border-border bg-card">
        <summary ref={hostSummaryRef} className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 marker:hidden">
          <span className="min-w-0">
            <span className="block text-sm font-semibold">Bakin host details</span>
            <span className="block text-xs text-muted-foreground">Process, uptime, memory, port, and connected sessions.</span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <Badge variant="secondary">{sessions === null ? 'Unavailable' : `${sessions} ${sessions === 1 ? 'session' : 'sessions'}`}</Badge>
            <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground transition-transform group-open:rotate-90 motion-reduce:transition-none" />
          </span>
        </summary>
        <div className="border-t border-border p-4">
          <Grid layout="cards" gap="dense" aria-label="Bakin host metrics">
            <StatTile icon={Users} label="Connected sessions" value={sessions === null ? '—' : sessions} sub="Summed across agents" />
            <StatTile icon={Clock3} label="Uptime" value={live?.upSince ? formatUptime(live.upSince) : '—'} sub="Current host process" />
            <StatTile icon={MemoryStick} label="Memory" value={live?.server ? `${live.server.memoryMB} MB` : '—'} sub={live?.server ? `${live.server.totalMemoryMB} MB host total` : 'Host memory unavailable'} />
            <StatTile icon={Network} label="Port" value={live?.server ? live.server.port : '—'} sub="HTTP server" />
            <StatTile icon={Hash} label="PID" value={live?.server ? live.server.pid : '—'} sub="Process id" />
            <StatTile icon={Cpu} label="Node" value={live?.server?.nodeVersion ?? '—'} sub="Runtime version" />
          </Grid>
          {live?.activeSessions && live.activeSessions.length > 0 && (
            <details className="mt-3 rounded-lg border border-border px-3 py-2">
              <summary className="cursor-pointer text-sm font-medium">Session detail</summary>
              <ListRows variant="separated" className="mt-bakin-2 text-bakin-typography-size-meta">
                {live.activeSessions.map((session) => (
                  <ListRow key={`${session.agent}:${session.connectedAt}`} className="flex items-center justify-between gap-bakin-3">
                    <span className="font-bakin-typography-weight-medium text-bakin-text-primary">{session.agent}</span>
                    <span className="text-bakin-text-muted">{session.sessions} · connected {formatAge(session.connectedAt)}</span>
                  </ListRow>
                ))}
              </ListRows>
            </details>
          )}
        </div>
      </details>

      <details
        ref={checksDisclosureRef}
        data-testid="all-health-checks-details"
        className="group overflow-hidden rounded-xl border border-border bg-card"
      >
        <summary ref={checksSummaryRef} className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 marker:hidden">
          <span className="min-w-0">
            <span className="block text-sm font-semibold">All health checks</span>
            <span className="block text-xs text-muted-foreground">Every registered check, including healthy and not-applicable evidence.</span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            {report && checksToReview > 0 && (
              <StatusBadge tone="attention" variant="outline">{checksToReview} to review</StatusBadge>
            )}
            <Badge variant="secondary">{report ? `${report.checks.length} checks` : 'Unavailable'}</Badge>
            <ChevronRight aria-hidden="true" className="size-4 text-muted-foreground transition-transform group-open:rotate-90 motion-reduce:transition-none" />
          </span>
        </summary>
        <div className="border-t border-border p-4">
          {!report ? (
            <p className="text-sm text-muted-foreground">Waiting for the canonical health report…</p>
          ) : groupedChecks.length === 0 ? (
            <p className="text-sm text-muted-foreground">No health checks are registered.</p>
          ) : (
            <div className="space-y-2">
              {groupedChecks.map((group) => {
                const presentations = group.checks.map((check) => ({ check, presentation: presentSystemCheck(check) }))
                const concerning = presentations.filter((row) => row.presentation.concerning).length
                const concernTone = presentations.some((row) => row.presentation.tone === 'destructive')
                  ? 'danger'
                  : presentations.some((row) => row.presentation.tone === 'warning') ? 'attention' : 'neutral'
                return (
                  <details
                    key={group.key}
                    ref={(element) => {
                      if (element) checkGroupRefs.current.set(group.key, element)
                      else checkGroupRefs.current.delete(group.key)
                    }}
                    className="rounded-lg border border-border"
                    open={concerning > 0}
                  >
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 marker:hidden">
                      <span className="font-medium">{group.label}</span>
                      <span className="flex items-center gap-2">
                        {concerning > 0 && <StatusBadge tone={concernTone} variant="outline">{concerning} to review</StatusBadge>}
                        <Badge variant="secondary">{group.checks.length}</Badge>
                      </span>
                    </summary>
                    <ListRows variant="separated">
                      {presentations.map(({ check, presentation }) => (
                        <ListRow
                          key={check.checkId}
                          ref={(element) => {
                            if (element) checkRowRefs.current.set(check.checkId, element)
                            else checkRowRefs.current.delete(check.checkId)
                          }}
                          data-check-id={check.checkId}
                          tabIndex={-1}
                          className="grid gap-bakin-2 outline-none focus-visible:bg-bakin-signal-accent/10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-bakin-focus-ring @[40rem]/health-system:grid-cols-[minmax(0,1fr)_auto]"
                        >
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="font-medium">{check.checkName}</h3>
                              <StatusBadge variant="outline" tone={canonicalTone(presentation.tone)}>{presentation.label}</StatusBadge>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">{check.description}</p>
                            <p className="mt-1 text-xs text-foreground/80">{presentation.detail}</p>
                          </div>
                          <div className="text-left text-[10px] text-muted-foreground @[40rem]/health-system:text-right">
                            <p>{check.owner.label}</p>
                            <p>{formatAge(check.latestExecution.completedAt)}</p>
                          </div>
                        </ListRow>
                      ))}
                    </ListRows>
                  </details>
                )
              })}
            </div>
          )}
        </div>
      </details>
    </div>
  )
})
