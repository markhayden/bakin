'use client'

// React
import { useEffect, useState, useCallback } from 'react'
// External
import { AlertCircle } from 'lucide-react'
// Internal
import { Button } from '@/components/ui/button'
import { PluginHeader } from '@/components/plugin-header'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem, SelectGroup, SelectLabel,
} from '@/components/ui/select'
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/components/ui/table'
import { useQueryState } from '@/hooks/use-query-state'
import { AgentAvatar } from '@/components/agent-avatar'
// Relative
import type { AgentModelConfig, AvailableModel, TaskProfile } from '../types'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const TIER_STYLES: Record<string, string> = {
  budget: 'bg-green-500/10 text-green-400',
  standard: 'bg-blue-500/10 text-blue-400',
  premium: 'bg-purple-500/10 text-purple-400',
}

const TOOL_MODELS: Record<string, string> = {
  pixel: 'Nano Banana Pro',
  rolo: 'Runway Gen-4, ElevenLabs',
  patch: 'Claude Code',
}

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

function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3">
      <AlertCircle className="size-4 text-destructive shrink-0" />
      <span className="text-sm text-destructive flex-1">{message}</span>
      {onRetry && (
        <Button variant="outline" size="xs" onClick={onRetry}>Retry</Button>
      )}
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="py-12 text-center text-sm text-muted-foreground">{message}</div>
  )
}

// ---------------------------------------------------------------------------
// Model Select (reusable)
// ---------------------------------------------------------------------------
function ModelSelect({
  value,
  onChange,
  models,
  defaultLabel,
  className,
}: {
  value: string
  onChange: (v: string) => void
  models: AvailableModel[]
  defaultLabel?: string
  className?: string
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v ?? '')}>
      <SelectTrigger className={className ?? 'w-full'} size="sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {defaultLabel && <SelectItem value="__default__">{defaultLabel}</SelectItem>}
        <SelectGroup>
          <SelectLabel>Premium</SelectLabel>
          {models.filter((m) => m.tier === 'premium').map((m) => (
            <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
          ))}
        </SelectGroup>
        <SelectGroup>
          <SelectLabel>Standard</SelectLabel>
          {models.filter((m) => m.tier === 'standard').map((m) => (
            <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
          ))}
        </SelectGroup>
        <SelectGroup>
          <SelectLabel>Budget</SelectLabel>
          {models.filter((m) => m.tier === 'budget').map((m) => (
            <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
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
  const [aliases, setAliases] = useState<Record<string, string>>({})
  const [profiles, setProfiles] = useState<TaskProfile[]>([])
  const [pendingOwn, setPendingOwn] = useState<Record<string, string>>({})
  const [pendingSub, setPendingSub] = useState<Record<string, string>>({})
  const [pendingProfiles, setPendingProfiles] = useState<TaskProfile[] | null>(null)
  const [restartNeeded, setRestartNeeded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [restarting, setRestarting] = useState(false)
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
      const data = await res.json()
      if (data.agents) setAgents(data.agents)
      setError(null)
    } catch (err) {
      setError(`Failed to load agent config: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchAvailable = useCallback(async () => {
    try {
      const res = await fetch('/api/plugins/models/available')
      if (!res.ok) throw new Error(`Models fetch failed (${res.status})`)
      const data = await res.json()
      if (data.models) {
        setAvailableModels(data.models)
        setModelsCached(!!data.cached)
      }
    } catch (err) {
      console.error('Failed to fetch available models:', err)
    }
  }, [])

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
        setRestartNeeded(true)
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

  const setAsDefault = async (modelId: string) => {
    try {
      const res = await fetch('/api/plugins/models/defaults', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ defaultModel: modelId }),
      })
      const data = await res.json()
      if (data.ok) {
        setRestartNeeded(true)
        await fetchConfig()
      }
    } catch (err) {
      console.error('Failed to set default:', err)
    }
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
      if (data.ok) await fetchAliases()
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
      if (data.ok) await fetchAliases()
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

  // -------------------------------------------------------------------------
  // Restart
  // -------------------------------------------------------------------------
  const handleRestart = async () => {
    setRestarting(true)
    try {
      await fetch('/api/plugins/models/gateway/restart', { method: 'POST' })
      setRestartNeeded(false)
    } catch (err) {
      console.error('Failed to restart:', err)
    } finally {
      setRestarting(false)
    }
  }

  const hasPending = Object.keys(pendingOwn).length > 0 || Object.keys(pendingSub).length > 0

  // Build model options (available or fallback)
  const modelOptions: AvailableModel[] = availableModels.length > 0
    ? availableModels
    : [
        { id: 'claude-opus-4-6-20250514', name: 'Claude Opus 4.6', tier: 'premium' },
        { id: 'claude-sonnet-4-6-20250514', name: 'Claude Sonnet 4.6', tier: 'standard' },
        { id: 'claude-sonnet-4-5-20250414', name: 'Claude Sonnet 4.5', tier: 'standard' },
        { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', tier: 'budget' },
      ]

  // Group available models by tier for the catalog tab
  const modelsByTier = {
    premium: modelOptions.filter((m) => m.tier === 'premium'),
    standard: modelOptions.filter((m) => m.tier === 'standard'),
    budget: modelOptions.filter((m) => m.tier === 'budget'),
  }

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
      {restartNeeded && (
        <div className="flex items-center justify-between rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3">
          <span className="text-sm text-amber-400">
            Configuration saved. Restart the gateway to apply changes.
          </span>
          <Button
            onClick={handleRestart}
            disabled={restarting}
            variant="outline"
            size="sm"
            className="border-amber-500/30 text-amber-400 hover:bg-amber-500/20"
          >
            {restarting ? 'Restarting...' : 'Restart Gateway'}
          </Button>
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`px-3 py-2 text-sm transition-colors ${
              tab === t.id
                ? 'text-foreground border-b-2 border-accent font-medium'
                : 'text-muted-foreground hover:text-foreground'
            }`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'agents' && (
        <div className="space-y-4">
            {hasPending && (
              <div className="flex justify-end">
                <Button onClick={saveAll} disabled={!!saving} size="sm">
                  Save All
                </Button>
              </div>
            )}

            {loading ? (
              <TableSkeleton rows={5} cols={5} />
            ) : agents.length === 0 ? (
              <EmptyState message="No agents configured in OpenClaw" />
            ) : (
              <div className="overflow-hidden rounded-xl border border-border">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-card">
                      <TableHead className="w-[140px]">Agent</TableHead>
                      <TableHead>Own Model</TableHead>
                      <TableHead>Subagent Model</TableHead>
                      <TableHead>Tool Models</TableHead>
                      <TableHead className="w-[100px]" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {agents.map((agent) => {
                      const ownVal = pendingOwn[agent.agentId] ?? (agent.ownModel || '__default__')
                      const subVal = pendingSub[agent.agentId] ?? (agent.subagentModel || '__default__')
                      const hasDirty = agent.agentId in pendingOwn || agent.agentId in pendingSub
                      const isSaving = saving === agent.agentId
                      const toolModel = TOOL_MODELS[agent.agentId] || '-'

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
                            <span className="text-sm text-muted-foreground">{toolModel}</span>
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
            {modelsCached && (
              <p className="text-xs text-muted-foreground">Showing cached results (1h TTL)</p>
            )}

            {(['premium', 'standard', 'budget'] as const).map((tier) => {
              const models = modelsByTier[tier]
              if (models.length === 0) return null
              return (
                <div key={tier}>
                  <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                    {tier.charAt(0).toUpperCase() + tier.slice(1)}
                    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${TIER_STYLES[tier]}`}>
                      {models.length}
                    </span>
                  </h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {models.map((m) => (
                      <div
                        key={m.id}
                        className="rounded-xl border border-border bg-card p-4 space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium">{m.name}</span>
                          <Badge variant="secondary" className={TIER_STYLES[m.tier]}>
                            {m.tier}
                          </Badge>
                        </div>
                        <div className="font-mono text-xs text-muted-foreground">{m.id}</div>
                        <div className="pt-1">
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
            })}

            {availableModels.length === 0 && (
              <EmptyState message="Could not fetch models from Anthropic API. Showing fallback list." />
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
                        <EmptyState message="No aliases defined" />
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
              <EmptyState message="No task profiles configured" />
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
