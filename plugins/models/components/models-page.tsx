'use client'

// React
import { useEffect, useState, useCallback } from 'react'
// External
import { ArrowDown, ArrowUp, Plus, X, Users, Layers, RefreshCw, AlertTriangle } from 'lucide-react'
// Internal
import { Button } from '@/components/ui/button'
import { PluginHeader } from '@/components/plugin-header'
import { ErrorBanner } from '@/components/error-banner'
import { EmptyState } from '@/components/empty-state'
import { UnderlineTabs } from '@/components/underline-tabs'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/components/ui/table'
import { useQueryState } from '@/hooks/use-query-state'
import { AgentAvatar } from '@/components/agent-avatar'
import { ModelSelect } from '@/components/model-select'
import { useGatewayStatus } from '@/hooks/use-gateway-status'
// Relative
import type { AgentModelConfig, AvailableModel, ModelsConfigResponse, TaskProfile } from '../types'
import { BrandIcon } from './brand-icon'

// ---------------------------------------------------------------------------
// Relative-time formatter — under 1h: minutes, under 24h: hours, else date.
// ---------------------------------------------------------------------------
function formatRelativeTime(ts: number | null): string {
  if (!ts) return 'never'
  const delta = Date.now() - ts
  const seconds = Math.max(0, Math.floor(delta / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const TIER_STYLES: Record<string, string> = {
  budget: 'bg-green-500/10 text-green-400',
  standard: 'bg-blue-500/10 text-blue-400',
  premium: 'bg-purple-500/10 text-purple-400',
}

const FALLBACK_MODEL_OPTIONS: AvailableModel[] = [
  { id: 'openai-codex/gpt-5.4', name: 'GPT-5.4', tier: 'premium', provider: 'openai-codex', configured: true, isDefault: true, fallbackIndex: null },
  { id: 'anthropic/claude-sonnet-4-6', name: 'Claude Sonnet 4.6', tier: 'standard', provider: 'anthropic', configured: true, isDefault: false, fallbackIndex: 0 },
  { id: 'anthropic/claude-opus-4-6', name: 'Claude Opus 4.6', tier: 'premium', provider: 'anthropic', configured: true, isDefault: false, fallbackIndex: null },
  { id: 'anthropic/claude-haiku-4-5', name: 'Claude Haiku 4.5', tier: 'budget', provider: 'anthropic', configured: true, isDefault: false, fallbackIndex: null },
]

const TABS = [
  { id: 'agents', label: 'Agent Config' },
  { id: 'available', label: 'Available Models' },
  { id: 'aliases', label: 'Aliases' },
  { id: 'profiles', label: 'Task Profiles' },
] as const

// ---------------------------------------------------------------------------
// Loading skeleton
// ---------------------------------------------------------------------------
function TableSkeleton({ rows = 4, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <Table>
        <TableHeader>
          <TableRow className="bg-card">
            {Array.from({ length: cols }).map((_, i) => (
              <TableHead key={i}><Skeleton className="h-4 w-20" /></TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: rows }).map((_, r) => (
            <TableRow key={r}>
              {Array.from({ length: cols }).map((_, c) => (
                <TableCell key={c}><Skeleton className="h-4 w-full" /></TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function InlineEmpty({ message }: { message: string }) {
  return (
    <div className="py-6 text-center text-sm text-muted-foreground">{message}</div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function ModelsPage() {
  const [tab, setTab] = useQueryState('tab', 'agents')
  const [agents, setAgents] = useState<AgentModelConfig[]>([])
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([])
  const [modelsCached, setModelsCached] = useState(false)
  const [modelsCachedAt, setModelsCachedAt] = useState<number | null>(null)
  const [modelsStale, setModelsStale] = useState(false)
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [modelsLoaded, setModelsLoaded] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [aliases, setAliases] = useState<Record<string, string>>({})
  const [profiles, setProfiles] = useState<TaskProfile[]>([])
  const [pendingOwn, setPendingOwn] = useState<Record<string, string>>({})
  const [pendingSub, setPendingSub] = useState<Record<string, string>>({})
  const [defaultModel, setDefaultModel] = useState('')
  const [defaultSubagentModel, setDefaultSubagentModel] = useState<string | null>(null)
  const [fallbackModels, setFallbackModels] = useState<string[]>([])
  const [pendingDefaultModel, setPendingDefaultModel] = useState<string | null>(null)
  const [pendingDefaultSubagentModel, setPendingDefaultSubagentModel] = useState<string | null | undefined>(undefined)
  const [pendingFallbackModels, setPendingFallbackModels] = useState<string[] | null>(null)
  const [pendingProfiles, setPendingProfiles] = useState<TaskProfile[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const gateway = useGatewayStatus()
  const [newAliasName, setNewAliasName] = useState('')
  const [newAliasTarget, setNewAliasTarget] = useState('')
  const [error, setError] = useState<string | null>(null)

  // -------------------------------------------------------------------------
  // Data fetching
  // -------------------------------------------------------------------------
  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/plugins/models/config')
      if (!res.ok) throw new Error(`Config fetch failed (${res.status})`)
      const data = await res.json() as ModelsConfigResponse
      if (data.agents) setAgents(data.agents)
      setDefaultModel(data.defaultModel)
      setDefaultSubagentModel(data.defaultSubagentModel)
      setFallbackModels(data.fallbackModels ?? [])
      setPendingDefaultModel(null)
      setPendingDefaultSubagentModel(undefined)
      setPendingFallbackModels(null)
      setError(null)
    } catch (err) {
      setError(`Failed to load agent config: ${err instanceof Error ? err.message : err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchAvailable = useCallback(async () => {
    try {
      const res = await fetch('/api/plugins/models/available')
      if (!res.ok) throw new Error(`Models fetch failed (${res.status})`)
      const data = await res.json()
      setAvailableModels(data.models ?? [])
      setModelsCached(!!data.cached)
      setModelsCachedAt(data.cachedAt ?? null)
      setModelsStale(!!data.stale)
      setModelsError(data.error ?? null)
    } catch (err) {
      console.error('Failed to fetch available models:', err)
      setModelsError(err instanceof Error ? err.message : String(err))
    } finally {
      setModelsLoaded(true)
    }
  }, [])

  const handleRefresh = useCallback(async () => {
    if (refreshing) return
    setRefreshing(true)
    try {
      const res = await fetch('/api/plugins/models/refresh', { method: 'POST' })
      const data = await res.json()
      if (Array.isArray(data.models)) {
        setAvailableModels(data.models)
      }
      setModelsCached(!!data.cached)
      setModelsCachedAt(data.cachedAt ?? null)
      setModelsStale(!!data.stale)
      setModelsError(res.ok ? null : (data.error ?? `Refresh failed (${res.status})`))
    } catch (err) {
      setModelsError(err instanceof Error ? err.message : String(err))
    } finally {
      setRefreshing(false)
    }
  }, [refreshing])

  const fetchAliases = useCallback(async () => {
    try {
      const res = await fetch('/api/plugins/models/aliases')
      if (!res.ok) throw new Error(`Aliases fetch failed (${res.status})`)
      const data = await res.json()
      if (data.aliases) setAliases(data.aliases)
    } catch (err) {
      console.error('Failed to fetch aliases:', err)
    }
  }, [])

  const fetchProfiles = useCallback(async () => {
    try {
      const res = await fetch('/api/plugins/models/profiles')
      if (!res.ok) throw new Error(`Profiles fetch failed (${res.status})`)
      const data = await res.json()
      if (data.profiles) setProfiles(data.profiles)
    } catch (err) {
      console.error('Failed to fetch profiles:', err)
    }
  }, [])

  useEffect(() => {
    fetchConfig()
    fetchAvailable()
    fetchAliases()
    fetchProfiles()
  }, [fetchConfig, fetchAvailable, fetchAliases, fetchProfiles])

  // Auto-refresh in the background when the served cache was stale.
  // We surface the cached data immediately; the refresh swaps rows
  // in place when it returns. handleRefresh guards against double-firing.
  useEffect(() => {
    if (modelsLoaded && modelsStale && !refreshing) {
      handleRefresh()
    }
    // Only react to the stale signal changing after initial load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelsLoaded, modelsStale])

  // -------------------------------------------------------------------------
  // Agent config actions
  // -------------------------------------------------------------------------
  const saveAgent = async (agentId: string) => {
    const ownModel = pendingOwn[agentId]
    const subagentModel = pendingSub[agentId]
    if (ownModel === undefined && subagentModel === undefined) return

    setSaving(agentId)
    try {
      const body: Record<string, unknown> = { agentId }
      if (ownModel !== undefined) {
        body.ownModel = ownModel === '__default__' ? null : ownModel
      }
      if (subagentModel !== undefined) {
        body.subagentModel = subagentModel === '__default__' ? null : subagentModel
      }
      const res = await fetch('/api/plugins/models/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.ok) {
        setPendingOwn((prev) => { const n = { ...prev }; delete n[agentId]; return n })
        setPendingSub((prev) => { const n = { ...prev }; delete n[agentId]; return n })
        gateway.markDirty()
        await fetchConfig()
      }
    } catch (err) {
      console.error('Failed to save:', err)
    } finally {
      setSaving(null)
    }
  }

  const saveAll = async () => {
    const ids = new Set([...Object.keys(pendingOwn), ...Object.keys(pendingSub)])
    for (const id of ids) {
      await saveAgent(id)
    }
  }

  const saveDefaults = async (overrides?: { defaultModel?: string; defaultSubagentModel?: string | null; fallbackModels?: string[] }) => {
    const nextDefaultModel = overrides?.defaultModel ?? pendingDefaultModel ?? defaultModel
    const nextDefaultSubagentModel = overrides?.defaultSubagentModel ?? (pendingDefaultSubagentModel === undefined
      ? defaultSubagentModel
      : pendingDefaultSubagentModel)
    const nextFallbackModels = [...new Set((overrides?.fallbackModels ?? pendingFallbackModels ?? fallbackModels).filter((id) => id && id !== nextDefaultModel))]

    setSaving('defaults')
    try {
      const res = await fetch('/api/plugins/models/defaults', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          defaultModel: nextDefaultModel,
          defaultSubagentModel: nextDefaultSubagentModel,
          fallbackModels: nextFallbackModels,
        }),
      })
      const data = await res.json()
      if (data.ok) {
        gateway.markDirty()
        await fetchConfig()
        await fetchAvailable()
      }
    } catch (err) {
      console.error('Failed to set default:', err)
    } finally {
      setSaving(null)
    }
  }

  const setAsDefault = async (modelId: string) => {
    await saveDefaults({ defaultModel: modelId })
  }

  // -------------------------------------------------------------------------
  // Alias actions
  // -------------------------------------------------------------------------
  const addAlias = async () => {
    if (!newAliasName.trim() || !newAliasTarget.trim()) return
    try {
      const res = await fetch('/api/plugins/models/aliases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add', name: newAliasName.trim(), target: newAliasTarget.trim() }),
      })
      const data = await res.json()
      if (data.ok) {
        setNewAliasName('')
        setNewAliasTarget('')
        await fetchAliases()
        await fetchAvailable()
      }
    } catch (err) {
      console.error('Failed to add alias:', err)
    }
  }

  const deleteAlias = async (name: string) => {
    try {
      const res = await fetch('/api/plugins/models/aliases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete', name }),
      })
      const data = await res.json()
      if (data.ok) {
        await fetchAliases()
        await fetchAvailable()
      }
    } catch (err) {
      console.error('Failed to delete alias:', err)
    }
  }

  const prepopulateAliases = async () => {
    try {
      const res = await fetch('/api/plugins/models/aliases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'prepopulate' }),
      })
      const data = await res.json()
      if (data.ok) {
        await fetchAliases()
        await fetchAvailable()
      }
    } catch (err) {
      console.error('Failed to prepopulate aliases:', err)
    }
  }

  // -------------------------------------------------------------------------
  // Profile actions
  // -------------------------------------------------------------------------
  const updateProfile = (index: number, field: keyof TaskProfile, value: string) => {
    const current = pendingProfiles ?? [...profiles]
    const updated = [...current]
    updated[index] = { ...updated[index], [field]: value }
    setPendingProfiles(updated)
  }

  const addProfile = () => {
    const current = pendingProfiles ?? [...profiles]
    setPendingProfiles([...current, { taskType: '', recommendedModel: '', notes: '' }])
  }

  const removeProfile = (index: number) => {
    const current = pendingProfiles ?? [...profiles]
    setPendingProfiles(current.filter((_, i) => i !== index))
  }

  const saveProfiles = async () => {
    if (!pendingProfiles) return
    setSaving('profiles')
    try {
      const res = await fetch('/api/plugins/models/profiles', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profiles: pendingProfiles }),
      })
      const data = await res.json()
      if (data.ok) {
        setProfiles(pendingProfiles)
        setPendingProfiles(null)
      }
    } catch (err) {
      console.error('Failed to save profiles:', err)
    } finally {
      setSaving(null)
    }
  }

  const hasPending = Object.keys(pendingOwn).length > 0 || Object.keys(pendingSub).length > 0
  const defaultsDirty = pendingDefaultModel !== null || pendingDefaultSubagentModel !== undefined || pendingFallbackModels !== null

  // Build model options (available or fallback)
  const modelOptions: AvailableModel[] = availableModels.length > 0
    ? availableModels
    : FALLBACK_MODEL_OPTIONS

  const availableProviders = [...new Set(modelOptions.map((m) => m.provider))].sort((a, b) => a.localeCompare(b))
  const effectiveDefaultModel = pendingDefaultModel ?? defaultModel
  const effectiveDefaultSubagentModel = pendingDefaultSubagentModel === undefined
    ? (defaultSubagentModel || '__default__')
    : (pendingDefaultSubagentModel || '__default__')
  const effectiveFallbackModels = pendingFallbackModels ?? fallbackModels
  const fallbackCandidates = modelOptions.filter((model) => model.id !== effectiveDefaultModel)

  const displayProfiles = pendingProfiles ?? profiles

  return (
    <div className="p-6 flex flex-col flex-1 gap-6">
      <PluginHeader
        title="Models"
        count={modelOptions.length}
        subtitle="Agent model config, aliases, and task profiles"
      />

      {/* Error banner */}
      {error && <ErrorBanner message={error} onRetry={fetchConfig} />}

      {/* Restart banner */}
      {gateway.restartNeeded && (
        <div className="flex items-center justify-between rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3">
          <span className="text-sm text-amber-400">
            Gateway config out of sync. Restart to apply changes.
          </span>
          <Button
            onClick={gateway.restart}
            disabled={gateway.restarting}
            variant="outline"
            size="sm"
            className="border-amber-500/30 text-amber-400 hover:bg-amber-500/20"
          >
            {gateway.restarting ? 'Restarting...' : 'Restart Gateway'}
          </Button>
        </div>
      )}

      {/* Tab bar */}
      <UnderlineTabs
        tabs={TABS}
        value={tab}
        onValueChange={(id) => setTab(id as typeof tab)}
      />


      {/* Tab content */}
      {tab === 'agents' && (
        <div className="space-y-4">
            <div className="rounded-xl border border-border bg-card p-4 space-y-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold">Global Defaults</h3>
                  <p className="text-sm text-muted-foreground">
                    Controls <code className="text-xs">agents.defaults.model.primary</code>, <code className="text-xs">fallbacks</code>, and the default subagent model.
                  </p>
                </div>
                {defaultsDirty && (
                  <Button onClick={() => saveDefaults()} disabled={!!saving} size="sm">
                    Save Defaults
                  </Button>
                )}
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">Default Model</label>
                  <ModelSelect
                    value={effectiveDefaultModel}
                    onChange={(v) => setPendingDefaultModel(v)}
                    models={modelOptions}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-medium text-muted-foreground">Default Subagent Model</label>
                  <ModelSelect
                    value={effectiveDefaultSubagentModel}
                    onChange={(v) => setPendingDefaultSubagentModel(v === '__default__' ? null : v)}
                    models={modelOptions}
                    defaultLabel={`Use primary default (${effectiveDefaultModel})`}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-4">
                  <label className="text-xs font-medium text-muted-foreground">Fallback Models</label>
                  <Button
                    variant="outline"
                    size="xs"
                    onClick={() => setPendingFallbackModels([...(pendingFallbackModels ?? fallbackModels), fallbackCandidates[0]?.id ?? ''])}
                    disabled={fallbackCandidates.length === 0}
                  >
                    <Plus className="mr-1 size-3" />
                    Add Fallback
                  </Button>
                </div>

                <div className="space-y-2">
                  {effectiveFallbackModels.length === 0 ? (
                    <InlineEmpty message="No fallback models configured." />
                  ) : (
                    effectiveFallbackModels.map((modelId, index) => (
                      <div key={`${modelId}-${index}`} className="flex items-center gap-2">
                        <span className="w-16 text-xs text-muted-foreground">#{index + 1}</span>
                        <ModelSelect
                          value={modelId}
                          onChange={(value) => {
                            const next = [...effectiveFallbackModels]
                            next[index] = value
                            setPendingFallbackModels([...new Set(next.filter(Boolean).filter((id) => id !== effectiveDefaultModel))])
                          }}
                          models={fallbackCandidates}
                          className="flex-1"
                        />
                        <Button
                          variant="outline"
                          size="icon-sm"
                          onClick={() => {
                            if (index === 0) return
                            const next = [...effectiveFallbackModels]
                            ;[next[index - 1], next[index]] = [next[index], next[index - 1]]
                            setPendingFallbackModels(next)
                          }}
                          disabled={index === 0}
                        >
                          <ArrowUp className="size-3" />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon-sm"
                          onClick={() => {
                            if (index === effectiveFallbackModels.length - 1) return
                            const next = [...effectiveFallbackModels]
                            ;[next[index], next[index + 1]] = [next[index + 1], next[index]]
                            setPendingFallbackModels(next)
                          }}
                          disabled={index === effectiveFallbackModels.length - 1}
                        >
                          <ArrowDown className="size-3" />
                        </Button>
                        <Button
                          variant="outline"
                          size="icon-sm"
                          onClick={() => setPendingFallbackModels(effectiveFallbackModels.filter((_, i) => i !== index))}
                        >
                          <X className="size-3" />
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {hasPending && (
              <div className="flex justify-end">
                <Button onClick={saveAll} disabled={!!saving} size="sm">
                  Save All
                </Button>
              </div>
            )}

            {loading ? (
              <TableSkeleton rows={5} cols={4} />
            ) : agents.length === 0 ? (
              <EmptyState icon={Users} title="No agents configured in OpenClaw" />
            ) : (
              <div className="overflow-hidden rounded-xl border border-border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-card">
                      <TableHead className="w-[140px]">Agent</TableHead>
                      <TableHead>Own Model</TableHead>
                      <TableHead>Subagent Model</TableHead>
                      <TableHead className="w-[100px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {agents.map((agent) => {
                      const ownVal = pendingOwn[agent.agentId] ?? (agent.ownModel || '__default__')
                      const subVal = pendingSub[agent.agentId] ?? (agent.subagentModel || '__default__')
                      const hasDirty = agent.agentId in pendingOwn || agent.agentId in pendingSub
                      const isSaving = saving === agent.agentId

                      return (
                        <TableRow key={agent.agentId}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <AgentAvatar agentId={agent.agentId} size="sm" />
                              <span className="font-medium">{agent.name}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <ModelSelect
                              value={ownVal}
                              onChange={(v) => setPendingOwn((p) => ({ ...p, [agent.agentId]: v }))}
                              models={modelOptions}
                              defaultLabel={`Default (${agent.defaultModel})`}
                            />
                          </TableCell>
                          <TableCell>
                            <ModelSelect
                              value={subVal}
                              onChange={(v) => setPendingSub((p) => ({ ...p, [agent.agentId]: v }))}
                              models={modelOptions}
                              defaultLabel={`Default (${agent.defaultSubagentModel || agent.defaultModel})`}
                            />
                          </TableCell>
                          <TableCell>
                            {hasDirty && (
                              <Button
                                onClick={() => saveAgent(agent.agentId)}
                                disabled={isSaving}
                                size="xs"
                              >
                                {isSaving ? 'Saving...' : 'Save'}
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
        </div>
      )}

      {tab === 'available' && (
        <div className="space-y-6">
            {/* Gateway-out-of-sync banner */}
            {gateway.restartNeeded && (
              <div className="flex items-center justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="size-3.5" />
                  <span>
                    OpenClaw config changed since the last gateway restart. Model list may be out of date until you restart.
                  </span>
                </div>
                <Button
                  size="xs"
                  variant="outline"
                  disabled={gateway.restarting}
                  onClick={gateway.restart}
                >
                  {gateway.restarting ? 'Restarting…' : 'Restart gateway'}
                </Button>
              </div>
            )}

            {/* Refresh + cache-age header */}
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs text-muted-foreground">
                {modelsLoaded && modelsCached && modelsCachedAt ? (
                  <span>
                    Last refreshed: <span className="font-medium text-foreground">{formatRelativeTime(modelsCachedAt)}</span>
                    {modelsStale && <span className="ml-2 text-amber-400">(stale — refreshing…)</span>}
                  </span>
                ) : modelsLoaded && !modelsCached && availableModels.length > 0 ? (
                  <span>Just refreshed</span>
                ) : null}
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={handleRefresh}
                disabled={refreshing}
              >
                <RefreshCw className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                <span className="ml-1">{refreshing ? 'Refreshing…' : 'Refresh'}</span>
              </Button>
            </div>

            {/* States: loading / error / list */}
            {!modelsLoaded || (refreshing && availableModels.length === 0) ? (
              <div className="flex flex-col items-center justify-center rounded-xl border border-border bg-card py-12 gap-3 text-sm text-muted-foreground">
                <RefreshCw className="size-5 animate-spin text-foreground/60" />
                <div>Querying OpenClaw gateway — this can take up to 30 seconds on first load.</div>
              </div>
            ) : availableModels.length === 0 ? (
              <div className="rounded-xl border border-border bg-card p-6 space-y-3">
                <div className="flex items-center gap-2 text-sm text-foreground">
                  <AlertTriangle className="size-4 text-red-400" />
                  Could not load models from OpenClaw.
                </div>
                {modelsError && (
                  <div className="font-mono text-xs text-muted-foreground break-all">{modelsError}</div>
                )}
                <Button size="sm" onClick={handleRefresh} disabled={refreshing}>
                  <RefreshCw className={`size-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                  <span className="ml-1">Retry</span>
                </Button>
              </div>
            ) : (
              availableProviders.map((provider) => {
                const models = modelOptions.filter((m) => m.provider === provider)
                if (models.length === 0) return null
                // Provider-level metadata from the first model (they all share provider fields).
                const providerMeta = models.find((m) => m.providerLabel) ?? models[0]
                const providerLabel = providerMeta.providerLabel ?? provider.replace(/[-_]/g, ' ')
                return (
                  <div key={provider}>
                    <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                      <BrandIcon
                        slug={providerMeta.providerBrandIconSlug}
                        fallbackText={providerLabel}
                        fallbackColor={providerMeta.providerBrandColor}
                        size="sm"
                      />
                      <span>{providerLabel}</span>
                      <span className="inline-block rounded-full px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground">
                        {models.length}
                      </span>
                    </h3>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {models.map((m) => (
                        <div
                          key={m.id}
                          className="rounded-xl border border-border bg-card p-4 space-y-2"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-2 min-w-0">
                              <BrandIcon
                                slug={m.brandIconSlug ?? m.providerBrandIconSlug}
                                fallbackText={m.providerLabel ?? m.provider}
                                fallbackColor={m.providerBrandColor}
                                size="sm"
                              />
                              <span className="font-medium truncate">{m.name}</span>
                              {m.contextWindowDisplay && (
                                <span className="font-mono text-[10px] text-muted-foreground shrink-0">
                                  {m.contextWindowDisplay}
                                </span>
                              )}
                            </div>
                            <Badge variant="secondary" className={`${TIER_STYLES[m.tier]} shrink-0`}>
                              {m.tier}
                            </Badge>
                          </div>
                          <div className="font-mono text-xs text-muted-foreground truncate">{m.id}</div>
                          {m.description && (
                            <p className="text-xs text-muted-foreground">{m.description}</p>
                          )}
                          <div className="flex flex-wrap items-center gap-1">
                            {m.bestFor && (
                              <Badge variant="outline" className="text-[10px] font-normal">
                                {m.bestFor}
                              </Badge>
                            )}
                            {m.tags && m.tags.map((tag) => (
                              <Badge key={tag} variant="outline" className="text-[10px]">{tag}</Badge>
                            ))}
                          </div>
                          <div className="flex items-center justify-between gap-2 pt-1">
                            {m.costRange ? (
                              <span className="text-[10px] text-muted-foreground">{m.costRange}</span>
                            ) : <span />}
                            <Button
                              variant="outline"
                              size="xs"
                              onClick={() => setAsDefault(m.id)}
                            >
                              Set as Default
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })
            )}
        </div>
      )}

      {tab === 'aliases' && (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Model aliases from <code className="text-xs">agents.defaults.models</code>
              </p>
              <Button variant="outline" size="xs" onClick={prepopulateAliases}>
                Pre-populate Defaults
              </Button>
            </div>

            <div className="overflow-hidden rounded-xl border border-border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-card">
                    <TableHead>Alias</TableHead>
                    <TableHead>Target Model</TableHead>
                    <TableHead className="w-[80px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(aliases).length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3}>
                        <InlineEmpty message="No aliases defined" />
                      </TableCell>
                    </TableRow>
                  ) : (
                    Object.entries(aliases).map(([name, target]) => (
                      <TableRow key={name}>
                        <TableCell>
                          <code className="text-sm font-medium">{name}</code>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm text-muted-foreground font-mono">{target}</span>
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="destructive"
                            size="xs"
                            onClick={() => deleteAlias(name)}
                          >
                            Delete
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>

            {/* Add alias form */}
            <div className="flex items-end gap-3 rounded-xl border border-border bg-card p-4">
              <div className="flex-1 space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Alias Name</label>
                <Input
                  value={newAliasName}
                  onChange={(e) => setNewAliasName(e.target.value)}
                  placeholder="e.g. opus"
                />
              </div>
              <div className="flex-1 space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Target Model</label>
                <ModelSelect
                  value={newAliasTarget}
                  onChange={setNewAliasTarget}
                  models={modelOptions}
                />
              </div>
              <Button onClick={addAlias} disabled={!newAliasName.trim() || !newAliasTarget.trim()}>
                Add
              </Button>
            </div>
        </div>
      )}

      {tab === 'profiles' && (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Map task types to recommended models. Not yet wired to dispatch — used as configuration reference.
              </p>
              <div className="flex items-center gap-2">
                {pendingProfiles && (
                  <>
                    <Button variant="outline" size="xs" onClick={() => setPendingProfiles(null)}>
                      Discard
                    </Button>
                    <Button size="xs" onClick={saveProfiles} disabled={saving === 'profiles'}>
                      {saving === 'profiles' ? 'Saving...' : 'Save Profiles'}
                    </Button>
                  </>
                )}
                <Button variant="outline" size="xs" onClick={addProfile}>
                  Add Profile
                </Button>
              </div>
            </div>

            {displayProfiles.length === 0 ? (
              <EmptyState icon={Layers} title="No task profiles configured" />
            ) : (
              <div className="overflow-hidden rounded-xl border border-border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-card">
                      <TableHead>Task Type</TableHead>
                      <TableHead>Recommended Model</TableHead>
                      <TableHead>Notes</TableHead>
                      <TableHead className="w-[60px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {displayProfiles.map((row, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          <Input
                            value={row.taskType}
                            onChange={(e) => updateProfile(i, 'taskType', e.target.value)}
                            className="h-8 text-sm"
                            placeholder="e.g. Heartbeat check"
                          />
                        </TableCell>
                        <TableCell>
                          <ModelSelect
                            value={row.recommendedModel}
                            onChange={(v) => updateProfile(i, 'recommendedModel', v)}
                            models={modelOptions}
                          />
                        </TableCell>
                        <TableCell>
                          <Input
                            value={row.notes}
                            onChange={(e) => updateProfile(i, 'notes', e.target.value)}
                            className="h-8 text-sm"
                            placeholder="e.g. Fast, cheap"
                          />
                        </TableCell>
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => removeProfile(i)}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            Remove
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
        </div>
      )}
    </div>
  )
}
