'use client'

import { ArrowDown, ArrowUp, Plus, X, Users } from 'lucide-react'
import { Button, Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@makinbakin/sdk/ui"
import { EmptyState } from "@makinbakin/sdk/components"
import { AgentAvatar } from "@makinbakin/sdk/components"
import { ModelSelect } from "@makinbakin/sdk/components"
import type { ModelsData } from './use-models-data'
import { TableSkeleton, InlineEmpty } from './models-page-shared'

export function AgentsTab({ m }: { m: ModelsData }) {
  const {
    agents, loading, saving, modelsReady, modelOptions,
    pendingOwn, setPendingOwn, pendingSub, setPendingSub,
    setPendingDefaultModel, setPendingDefaultSubagentModel,
    pendingFallbackModels, setPendingFallbackModels, fallbackModels,
    saveAgent, saveAll, saveDefaults, hasPending, defaultsDirty,
    effectiveDefaultModel, effectiveDefaultSubagentModel, effectiveFallbackModels, fallbackCandidates,
  } = m

  return (
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
              <Button onClick={() => saveDefaults()} disabled={!!saving || !modelsReady} size="sm">
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
            <Button onClick={saveAll} disabled={!!saving || !modelsReady} size="sm">
              Save All
            </Button>
          </div>
        )}

        {loading ? (
          <TableSkeleton rows={5} cols={4} />
        ) : agents.length === 0 ? (
          <EmptyState icon={Users} title="No agents configured in the runtime" />
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
                            disabled={isSaving || !modelsReady}
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
  )
}
