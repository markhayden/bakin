'use client'

import { forwardRef, useImperativeHandle, useMemo, useRef } from 'react'
import type { HealthCheckState, HealthReport } from '@makinbakin/sdk/types'
import { DisclosurePanel, Grid, Panel } from '@makinbakin/sdk/layout'
import {
  DataTable,
  ListRow,
  ListRows,
  StatTile,
  StatusBadge,
  type DataTableColumn,
} from '@makinbakin/sdk/patterns'
import { Badge, Banner, Button, Input, type BannerTone } from '@makinbakin/sdk/ui'
import { Clock3, Cpu, Hash, MemoryStick, Network, Users } from 'lucide-react'
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
  type InventoryPlugin,
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

function revealDisclosure(disclosure: HTMLDetailsElement | null): void {
  if (!disclosure) return
  disclosure.open = true
  const summary = disclosure.querySelector<HTMLElement>('summary')
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
  const hostDisclosureRef = useRef<HTMLDetailsElement>(null)
  const checksDisclosureRef = useRef<HTMLDetailsElement>(null)
  const pluginTableRef = useRef<HTMLDivElement>(null)
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

  const pluginColumns: ReadonlyArray<DataTableColumn<InventoryPlugin>> = [
    {
      key: 'plugin',
      header: 'Plugin',
      cellClassName: 'whitespace-normal',
      cell: (plugin) => (
        <>
          <p className="font-bakin-typography-weight-medium text-bakin-text-primary">{plugin.name}</p>
          <p className="font-bakin-typography-family-mono text-bakin-typography-size-meta text-bakin-text-muted">{plugin.id}</p>
          {(plugin.status === 'failed' || plugin.activationConflict) && (
            <div className="mt-bakin-1 max-w-md text-bakin-typography-size-meta leading-relaxed text-bakin-text-muted">
              <p>{plugin.activationConflict
                ? 'Registry and manifest activation states disagree.'
                : plugin.errorMessage ?? 'The plugin did not activate.'}</p>
              {plugin.errorCode && <p className="font-bakin-typography-family-mono">Code: {plugin.errorCode}</p>}
              {plugin.missingDependencies && plugin.missingDependencies.length > 0 && (
                <p>Missing dependencies: {plugin.missingDependencies.join(', ')}</p>
              )}
            </div>
          )}
        </>
      ),
    },
    {
      key: 'version',
      header: 'Version',
      cell: (plugin) => <span className="font-bakin-typography-family-mono text-bakin-text-muted">{plugin.version}</span>,
    },
    {
      key: 'source',
      header: 'Source',
      cell: (plugin) => <span className="text-bakin-text-muted">{plugin.source}</span>,
    },
    {
      key: 'routes',
      header: 'Routes',
      align: 'end',
      cell: (plugin) => <span className="font-bakin-typography-family-mono tabular-nums">{plugin.routes}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      cellClassName: 'whitespace-normal',
      cell: (plugin) => (
        <div className="flex flex-wrap items-center gap-bakin-2">
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
      ),
    },
  ]

  useImperativeHandle(ref, () => ({
    revealHost: () => revealDisclosure(hostDisclosureRef.current),
    revealPlugins: () => revealDisclosure(pluginsDisclosureRef.current),
    revealPlugin: (pluginId) => {
      const escaped = typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(pluginId) : pluginId
      const target = pluginTableRef.current?.querySelector<HTMLElement>(`[data-plugin-id="${escaped}"]`) ?? null
      if (!target) {
        revealDisclosure(pluginsDisclosureRef.current)
        return false
      }
      if (pluginsDisclosureRef.current) pluginsDisclosureRef.current.open = true
      focusSystemElement(target, { block: 'center' })
      return true
    },
    revealChecks: () => revealDisclosure(checksDisclosureRef.current),
    revealCheck: (checkId) => {
      if (checksDisclosureRef.current) checksDisclosureRef.current.open = true
      const groupId = checkGroupById.get(checkId)
      const group = groupId ? checkGroupRefs.current.get(groupId) : null
      if (group) group.open = true
      const target = checkRowRefs.current.get(checkId)
      if (!target) {
        const summary = checksDisclosureRef.current?.querySelector<HTMLElement>('summary')
        if (summary) focusSystemElement(summary)
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

      <DisclosurePanel
        ref={pluginsDisclosureRef}
        data-testid="installed-features-details"
        summary={(
          <span className="min-w-0">
            <span className="block text-bakin-typography-size-body font-bakin-typography-weight-semibold text-bakin-text-primary">Installed features</span>
            <span className="block text-bakin-typography-size-meta font-bakin-typography-weight-regular text-bakin-text-muted">Browse plugins, versions, activation state, and updates.</span>
          </span>
        )}
        summaryMeta={<Badge variant="secondary">{plugins.length}</Badge>}
      >
        <div className="space-y-bakin-3">
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
          <label className="block max-w-sm text-bakin-typography-size-meta font-bakin-typography-weight-medium text-bakin-text-muted">
            Find a plugin
            <Input
              type="search"
              value={pluginSearch}
              onChange={(event) => onPluginSearchChange(event.target.value)}
              placeholder="Name, id, or description"
              className="mt-bakin-1"
            />
          </label>
          {loading && plugins.length === 0 ? (
            <p className="text-bakin-typography-size-body text-bakin-text-muted">Loading installed plugins…</p>
          ) : filteredPlugins.length === 0 ? (
            <p className="text-bakin-typography-size-body text-bakin-text-muted">{pluginSearch ? 'No matching plugins.' : 'No plugins were discovered.'}</p>
          ) : (
            <Panel ref={pluginTableRef} scroll aria-label="Installed plugins" data-testid="installed-plugin-table-scroll" padding="compact" className="max-h-80">
              <DataTable<InventoryPlugin>
                label="Installed plugins"
                rows={filteredPlugins}
                rowKey={(plugin) => plugin.id}
                collapseBelow="none"
                renderRow={() => null}
                tableProps={{ className: 'min-w-[760px]' }}
                rowProps={(plugin) => ({
                  'data-plugin-id': plugin.id,
                  tabIndex: -1,
                  className: 'outline-none focus-visible:bg-bakin-signal-accent/10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-bakin-focus-ring',
                })}
                columns={pluginColumns}
              />
            </Panel>
          )}
        </div>
      </DisclosurePanel>

      <DisclosurePanel
        ref={hostDisclosureRef}
        data-testid="bakin-host-details"
        summary={(
          <span className="min-w-0">
            <span className="block text-bakin-typography-size-body font-bakin-typography-weight-semibold text-bakin-text-primary">Bakin host details</span>
            <span className="block text-bakin-typography-size-meta font-bakin-typography-weight-regular text-bakin-text-muted">Process, uptime, memory, port, and connected sessions.</span>
          </span>
        )}
        summaryMeta={<Badge variant="secondary">{sessions === null ? 'Unavailable' : `${sessions} ${sessions === 1 ? 'session' : 'sessions'}`}</Badge>}
      >
          <Grid layout="cards" gap="dense" aria-label="Bakin host metrics">
            <StatTile icon={Users} label="Connected sessions" value={sessions === null ? '—' : sessions} sub="Summed across agents" />
            <StatTile icon={Clock3} label="Uptime" value={live?.upSince ? formatUptime(live.upSince) : '—'} sub="Current host process" />
            <StatTile icon={MemoryStick} label="Memory" value={live?.server ? `${live.server.memoryMB} MB` : '—'} sub={live?.server ? `${live.server.totalMemoryMB} MB host total` : 'Host memory unavailable'} />
            <StatTile icon={Network} label="Port" value={live?.server ? live.server.port : '—'} sub="HTTP server" />
            <StatTile icon={Hash} label="PID" value={live?.server ? live.server.pid : '—'} sub="Process id" />
            <StatTile icon={Cpu} label="Node" value={live?.server?.nodeVersion ?? '—'} sub="Runtime version" />
          </Grid>
          {live?.activeSessions && live.activeSessions.length > 0 && (
            <details className="mt-bakin-3 rounded-bakin-control border border-bakin-border-subtle px-bakin-3 py-bakin-2">
              <summary className="cursor-pointer text-bakin-typography-size-body font-bakin-typography-weight-medium">Session detail</summary>
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
      </DisclosurePanel>

      <DisclosurePanel
        ref={checksDisclosureRef}
        data-testid="all-health-checks-details"
        summary={(
          <span className="min-w-0">
            <span className="block text-bakin-typography-size-body font-bakin-typography-weight-semibold text-bakin-text-primary">All health checks</span>
            <span className="block text-bakin-typography-size-meta font-bakin-typography-weight-regular text-bakin-text-muted">Every registered check, including healthy and not-applicable evidence.</span>
          </span>
        )}
        summaryMeta={(
          <>
            {report && checksToReview > 0 && (
              <StatusBadge tone="attention" variant="outline">{checksToReview} to review</StatusBadge>
            )}
            <Badge variant="secondary">{report ? `${report.checks.length} checks` : 'Unavailable'}</Badge>
          </>
        )}
      >
          {!report ? (
            <p className="text-bakin-typography-size-body text-bakin-text-muted">Waiting for the canonical health report…</p>
          ) : groupedChecks.length === 0 ? (
            <p className="text-bakin-typography-size-body text-bakin-text-muted">No health checks are registered.</p>
          ) : (
            <div className="space-y-bakin-2">
              {groupedChecks.map((group) => {
                const presentations = group.checks.map((check) => ({ check, presentation: presentSystemCheck(check) }))
                const concerning = presentations.filter((row) => row.presentation.concerning).length
                const concernTone = presentations.some((row) => row.presentation.tone === 'danger')
                  ? 'danger'
                  : presentations.some((row) => row.presentation.tone === 'attention') ? 'attention' : 'neutral'
                return (
                  <details
                    key={group.key}
                    ref={(element) => {
                      if (element) checkGroupRefs.current.set(group.key, element)
                      else checkGroupRefs.current.delete(group.key)
                    }}
                    className="rounded-bakin-control border border-bakin-border-subtle"
                    open={concerning > 0}
                  >
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-bakin-3 px-bakin-3 py-bakin-2 marker:hidden">
                      <span className="font-bakin-typography-weight-medium">{group.label}</span>
                      <span className="flex items-center gap-bakin-2">
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
                            <div className="flex flex-wrap items-center gap-bakin-2">
                              <h3 className="font-bakin-typography-weight-medium">{check.checkName}</h3>
                              <StatusBadge variant="outline" tone={presentation.tone}>{presentation.label}</StatusBadge>
                            </div>
                            <p className="mt-bakin-1 text-bakin-typography-size-meta text-bakin-text-muted">{check.description}</p>
                            <p className="mt-bakin-1 text-bakin-typography-size-meta text-bakin-text-primary">{presentation.detail}</p>
                          </div>
                          <div className="text-left text-bakin-typography-size-meta text-bakin-text-muted @[40rem]/health-system:text-right">
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
      </DisclosurePanel>
    </div>
  )
})
