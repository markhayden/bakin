'use client'

import { useEffect, useState, useCallback } from 'react'
import type { AgentModelConfig, AvailableModel } from '../types'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from '@/components/ui/table'

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

const COMPLEXITY_PROFILES = [
  { taskType: 'Heartbeat check', model: 'Claude Haiku 4.5', notes: 'Fast, cheap' },
  { taskType: 'Content writing', model: 'Claude Sonnet 4.6', notes: 'Quality output' },
  { taskType: 'Image brief', model: 'Claude Sonnet 4.6', notes: 'Creative' },
  { taskType: 'Video production', model: 'Claude Sonnet 4.6', notes: 'Creative' },
  { taskType: 'Code/development', model: 'Claude Opus 4.6', notes: 'Complex reasoning' },
  { taskType: 'Orchestration', model: 'Claude Sonnet 4.6', notes: 'Multi-step planning' },
]

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function ModelsPage() {
  const [agents, setAgents] = useState<AgentModelConfig[]>([])
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([])
  const [modelsCached, setModelsCached] = useState(false)
  const [aliases, setAliases] = useState<Record<string, string>>({})
  const [pendingOwn, setPendingOwn] = useState<Record<string, string>>({})
  const [pendingSub, setPendingSub] = useState<Record<string, string>>({})
  const [restartNeeded, setRestartNeeded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [restarting, setRestarting] = useState(false)
  const [newAliasName, setNewAliasName] = useState('')
  const [newAliasTarget, setNewAliasTarget] = useState('')

  // -------------------------------------------------------------------------
  // Data fetching
  // -------------------------------------------------------------------------
  const fetchConfig = useCallback(async () => {
    try {
      const res = await fetch('/api/plugins/models/config')
      const data = await res.json()
      if (data.agents) setAgents(data.agents)
    } catch (err) {
      console.error('Failed to fetch model config:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  const fetchAvailable = useCallback(async () => {
    try {
      const res = await fetch('/api/plugins/models/available')
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
      const data = await res.json()
      if (data.aliases) setAliases(data.aliases)
    } catch (err) {
      console.error('Failed to fetch aliases:', err)
    }
  }, [])

  useEffect(() => {
    fetchConfig()
    fetchAvailable()
    fetchAliases()
  }, [fetchConfig, fetchAvailable, fetchAliases])

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
  // Restart
  // -------------------------------------------------------------------------
  const handleRestart = async () => {
    setRestarting(true)
    try {
      await fetch('/api/plugins/models/restart', { method: 'POST' })
      setRestartNeeded(false)
    } catch (err) {
      console.error('Failed to restart:', err)
    } finally {
      setRestarting(false)
    }
  }

  const hasPending = Object.keys(pendingOwn).length > 0 || Object.keys(pendingSub).length > 0

  // Build model options for selects (available models with anthropic/ prefix for matching)
  const modelOptions = availableModels.length > 0
    ? availableModels
    : [
        { id: 'claude-opus-4-6-20250514', name: 'Claude Opus 4.6', tier: 'premium' as const },
        { id: 'claude-sonnet-4-6-20250514', name: 'Claude Sonnet 4.6', tier: 'standard' as const },
        { id: 'claude-sonnet-4-5-20250414', name: 'Claude Sonnet 4.5', tier: 'standard' as const },
        { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', tier: 'budget' as const },
      ]

  // Group available models by tier for Tab 2
  const modelsByTier = {
    premium: modelOptions.filter((m) => m.tier === 'premium'),
    standard: modelOptions.filter((m) => m.tier === 'standard'),
    budget: modelOptions.filter((m) => m.tier === 'budget'),
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Models</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure models for agents, view available models, and manage aliases.
        </p>
      </div>

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

      <Tabs defaultValue="agents">
        <TabsList>
          <TabsTrigger value="agents">Agent Config</TabsTrigger>
          <TabsTrigger value="available">Available Models</TabsTrigger>
          <TabsTrigger value="aliases">Aliases</TabsTrigger>
          <TabsTrigger value="profiles">Task Profiles</TabsTrigger>
        </TabsList>

        {/* ================================================================= */}
        {/* Tab 1: Agent Config                                                */}
        {/* ================================================================= */}
        <TabsContent value="agents">
          <div className="mt-4 space-y-4">
            {hasPending && (
              <div className="flex justify-end">
                <Button onClick={saveAll} disabled={!!saving} size="sm">
                  Save All
                </Button>
              </div>
            )}

            {loading ? (
              <div className="text-sm text-muted-foreground py-8 text-center">Loading...</div>
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
                              <span className="text-lg">{agent.emoji}</span>
                              <span className="font-medium">{agent.name}</span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <select
                              value={ownVal}
                              onChange={(e) => setPendingOwn((p) => ({ ...p, [agent.agentId]: e.target.value }))}
                              className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-ring"
                            >
                              <option value="__default__">
                                Default ({agent.defaultModel})
                              </option>
                              {modelOptions.map((m) => (
                                <option key={m.id} value={m.id}>{m.name}</option>
                              ))}
                            </select>
                          </TableCell>
                          <TableCell>
                            <select
                              value={subVal}
                              onChange={(e) => setPendingSub((p) => ({ ...p, [agent.agentId]: e.target.value }))}
                              className="w-full rounded-lg border border-border bg-background px-2 py-1.5 text-sm text-foreground outline-none focus:border-ring"
                            >
                              <option value="__default__">
                                Default ({agent.defaultSubagentModel || agent.defaultModel})
                              </option>
                              {modelOptions.map((m) => (
                                <option key={m.id} value={m.id}>{m.name}</option>
                              ))}
                            </select>
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
        </TabsContent>

        {/* ================================================================= */}
        {/* Tab 2: Available Models                                             */}
        {/* ================================================================= */}
        <TabsContent value="available">
          <div className="mt-4 space-y-6">
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
              <p className="text-sm text-muted-foreground py-4 text-center">
                Could not fetch models from Anthropic API. Showing fallback list.
              </p>
            )}
          </div>
        </TabsContent>

        {/* ================================================================= */}
        {/* Tab 3: Aliases                                                     */}
        {/* ================================================================= */}
        <TabsContent value="aliases">
          <div className="mt-4 space-y-4">
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
                      <TableCell colSpan={3} className="text-center text-muted-foreground py-6">
                        No aliases defined
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
                <select
                  value={newAliasTarget}
                  onChange={(e) => setNewAliasTarget(e.target.value)}
                  className="h-8 w-full rounded-lg border border-border bg-background px-2.5 py-1 text-sm text-foreground outline-none focus:border-ring"
                >
                  <option value="">Select model...</option>
                  {modelOptions.map((m) => (
                    <option key={m.id} value={m.id}>{m.name} ({m.id})</option>
                  ))}
                </select>
              </div>
              <Button onClick={addAlias} disabled={!newAliasName.trim() || !newAliasTarget.trim()}>
                Add
              </Button>
            </div>
          </div>
        </TabsContent>

        {/* ================================================================= */}
        {/* Tab 4: Task Profiles                                               */}
        {/* ================================================================= */}
        <TabsContent value="profiles">
          <div className="mt-4">
            <div className="overflow-hidden rounded-xl border border-border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-card">
                    <TableHead>Task Type</TableHead>
                    <TableHead>Recommended Model</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {COMPLEXITY_PROFILES.map((row) => (
                    <TableRow key={row.taskType}>
                      <TableCell>{row.taskType}</TableCell>
                      <TableCell className="text-muted-foreground">{row.model}</TableCell>
                      <TableCell className="text-muted-foreground">{row.notes}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
