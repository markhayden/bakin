'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from "@makinbakin/sdk/ui"
import { Badge } from "@makinbakin/sdk/ui"
import { Button } from "@makinbakin/sdk/ui"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@makinbakin/sdk/ui"
import { ListSearch } from './health-sections'
import type { PluginInfo, RegistryData, PluginManifestData } from '../types'

const PLUGIN_CHECK_INTERVAL_MS = 60 * 60 * 1000
const REGISTRY_POLL_MS = 10_000

/**
 * Self-contained Active Plugins section: registry list + manifest update state +
 * the upgrade modal, all polled/loaded independently of the rest of the page.
 * `refreshNonce` re-triggers on the header Refresh button.
 */
export function PluginsSection({ refreshNonce }: { refreshNonce: number }) {
  const [registry, setRegistry] = useState<RegistryData | null>(null)
  const [pluginManifest, setPluginManifest] = useState<PluginManifestData | null>(null)
  const [pluginChecking, setPluginChecking] = useState(false)
  const [pluginSearch, setPluginSearch] = useState('')
  const [pluginUpgradeTarget, setPluginUpgradeTarget] = useState<PluginInfo | null>(null)
  const [pluginUpgrading, setPluginUpgrading] = useState(false)
  const [pluginUpgradeError, setPluginUpgradeError] = useState<string | null>(null)
  const [pluginUpgradeMessage, setPluginUpgradeMessage] = useState<string | null>(null)
  const [pluginConsentPermissions, setPluginConsentPermissions] = useState<string[] | null>(null)
  const lastPluginCheckRef = useRef(0)

  const fetchPluginManifest = useCallback(async (force = false) => {
    const now = Date.now()
    const shouldCheck = force || lastPluginCheckRef.current === 0 || now - lastPluginCheckRef.current >= PLUGIN_CHECK_INTERVAL_MS
    const path = `/api/plugins/manifest${shouldCheck ? '?check=1' : ''}`
    if (shouldCheck) setPluginChecking(true)
    try {
      const res = await fetch(path)
      const json = await res.json()
      if (json && Array.isArray(json.plugins)) {
        setPluginManifest(json)
        if (shouldCheck) lastPluginCheckRef.current = now
      }
    } catch {
      // Manifest status is optional for Health; keep the registry list visible.
    } finally {
      if (shouldCheck) setPluginChecking(false)
    }
  }, [])

  const loadRegistry = useCallback(async () => {
    try {
      const res = await fetch('/api/plugins/health/registry')
      const regJson = await res.json()
      setRegistry(regJson)
    } catch { /* registry endpoint optional */ }
    await fetchPluginManifest(false)
  }, [fetchPluginManifest])

  useEffect(() => {
    loadRegistry()
    const interval = setInterval(loadRegistry, REGISTRY_POLL_MS)
    return () => clearInterval(interval)
  }, [loadRegistry, refreshNonce])

  const filteredPlugins = useMemo(() => {
    if (!registry) return []
    const manifestById = new Map((pluginManifest?.plugins ?? []).map((plugin) => [plugin.id, plugin]))
    const merged = registry.plugins.map((plugin) => {
      const manifest = manifestById.get(plugin.id)
      if (!manifest) return plugin
      return {
        ...plugin,
        version: manifest.version ?? plugin.version,
        source: manifest.source === 'core' ? 'built-in' as const : 'user' as const,
        installed: manifest.installed,
        latestVersion: manifest.latestVersion,
        upgradeAvailable: manifest.upgradeAvailable,
        staleHintDays: manifest.staleHintDays,
      }
    })
    if (!pluginSearch) return merged
    const q = pluginSearch.toLowerCase()
    return merged.filter(p =>
      p.name.toLowerCase().includes(q) || p.description?.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)
    )
  }, [pluginManifest, registry, pluginSearch])

  const openPluginUpgrade = useCallback((plugin: PluginInfo) => {
    setPluginUpgradeTarget(plugin)
    setPluginUpgradeError(null)
    setPluginUpgradeMessage(null)
    setPluginConsentPermissions(null)
  }, [])

  const runPluginUpgrade = useCallback(async (yes = false) => {
    if (!pluginUpgradeTarget) return
    setPluginUpgrading(true)
    setPluginUpgradeError(null)
    setPluginUpgradeMessage(null)
    try {
      const res = await fetch('/api/plugins/upgrade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pluginId: pluginUpgradeTarget.id, ...(yes ? { yes: true } : {}) }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || body?.ok === false) {
        throw new Error(typeof body?.error === 'string' ? body.error : 'Plugin upgrade failed.')
      }
      if (body?.awaitingConsent) {
        setPluginConsentPermissions(Array.isArray(body.newPermissions) ? body.newPermissions.map(String) : [])
        return
      }
      setPluginConsentPermissions(null)
      setPluginUpgradeMessage(`${pluginUpgradeTarget.name} upgraded.`)
      await fetchPluginManifest(true)
    } catch (err) {
      setPluginUpgradeError(err instanceof Error ? err.message : String(err))
    } finally {
      setPluginUpgrading(false)
    }
  }, [fetchPluginManifest, pluginUpgradeTarget])

  if (!registry) return null

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Active Plugins</span>
            <span className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                aria-label="Check plugin updates now"
                disabled={pluginChecking}
                onClick={() => fetchPluginManifest(true)}
              >
                {pluginChecking ? 'Checking...' : 'Check now'}
              </Button>
              <Badge variant="secondary" className="font-mono text-xs">{registry.plugins.length}</Badge>
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ListSearch value={pluginSearch} onChange={setPluginSearch} placeholder="Search plugins..." />
          {filteredPlugins.length === 0 ? (
            <p className="text-sm text-muted-foreground">{pluginSearch ? 'No matching plugins' : 'No plugins loaded'}</p>
          ) : (
            <div className="space-y-1.5">
              <div className="flex items-center text-[10px] text-muted-foreground uppercase tracking-wider pb-1 border-b border-white/5">
                <span className="flex-1">Plugin</span>
                <span className="w-16 text-right">Version</span>
                <span className="w-16 text-right">Source</span>
                <span className="w-14 text-right">Routes</span>
                <span className="w-32 text-right">Status</span>
              </div>
              {filteredPlugins.map((p) => (
                <div
                  key={p.id}
                  className={`flex items-center rounded-md px-2 py-1 text-sm -mx-2 ${p.upgradeAvailable ? 'border border-info/20 bg-info/5' : ''}`}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="font-medium">{p.name}</span>
                      {p.upgradeAvailable && (
                        <Badge className="shrink-0 text-[10px] px-1.5 bg-info/10 text-info border-info/20">
                          Update available
                        </Badge>
                      )}
                    </div>
                    {p.description && (
                      <p className="text-[11px] text-muted-foreground truncate">{p.description}</p>
                    )}
                  </div>
                  <span className="w-16 text-right font-mono text-xs text-muted-foreground shrink-0">{p.version}</span>
                  <span className="w-16 text-right shrink-0">
                    <Badge variant="secondary" className="text-[10px] px-1.5">
                      {p.source}
                    </Badge>
                  </span>
                  <span className="w-14 text-right font-mono text-xs text-muted-foreground shrink-0">{p.routes}</span>
                  <span className="w-32 shrink-0 text-right">
                    {p.source === 'built-in' ? (
                      <span className="text-[11px] text-muted-foreground">Core</span>
                    ) : p.upgradeAvailable ? (
                      <Button
                        size="xs"
                        variant="outline"
                        className="border-info/30 bg-info/10 text-info hover:bg-info/20"
                        aria-label={`Upgrade ${p.name}`}
                        onClick={() => openPluginUpgrade(p)}
                      >
                        Upgrade
                      </Button>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">Current</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog
        open={Boolean(pluginUpgradeTarget)}
        onOpenChange={(open) => {
          if (!open) {
            setPluginUpgradeTarget(null)
            setPluginUpgradeError(null)
            setPluginUpgradeMessage(null)
            setPluginConsentPermissions(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upgrade {pluginUpgradeTarget?.name}</DialogTitle>
            <DialogDescription>
              Bakin will update this user plugin from its recorded source and reactivate it after the upgrade completes.
            </DialogDescription>
          </DialogHeader>
          {pluginUpgradeTarget && (
            <div className="rounded-md border border-border bg-muted/30 px-3 py-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Current version</p>
                  <p className="mt-1 font-mono text-lg font-semibold text-foreground">{pluginUpgradeTarget.version}</p>
                  <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                    commit {pluginUpgradeTarget.installed?.commitSha ?? 'unknown'}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Available version</p>
                  <p className="mt-1 font-mono text-lg font-semibold text-info">
                    {pluginUpgradeTarget.latestVersion ?? 'latest'}
                  </p>
                  <p className="mt-0.5 font-mono text-xs text-muted-foreground">
                    commit {pluginUpgradeTarget.installed?.remoteHeadSha ?? 'unknown'}
                  </p>
                </div>
              </div>
            </div>
          )}
          {pluginConsentPermissions && (
            <div className="rounded-md border border-warning/20 bg-warning/10 px-3 py-2 text-sm">
              <p className="font-medium text-warning">New permissions requested</p>
              <p className="mt-1 text-xs text-muted-foreground">{pluginConsentPermissions.length ? pluginConsentPermissions.join(', ') : 'Review the updated plugin permissions before continuing.'}</p>
            </div>
          )}
          {pluginUpgradeError && (
            <div className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {pluginUpgradeError}
            </div>
          )}
          {pluginUpgradeMessage && (
            <div className="rounded-md border border-success/20 bg-success/10 px-3 py-2 text-sm text-success">
              {pluginUpgradeMessage}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPluginUpgradeTarget(null)}>
              Close
            </Button>
            {!pluginUpgradeMessage && (
              <Button
                variant={pluginConsentPermissions ? 'warning' : 'default'}
                disabled={pluginUpgrading}
                onClick={() => runPluginUpgrade(Boolean(pluginConsentPermissions))}
              >
                {pluginUpgrading ? 'Upgrading...' : pluginConsentPermissions ? 'Approve and upgrade' : 'Upgrade plugin'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
