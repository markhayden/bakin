'use client'

import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react'
import { useAgent, useAgentColor } from '@makinbakin/sdk/hooks'
import { AgentAvatar, ListRow, ListRows, ModelSelect } from '@makinbakin/sdk/patterns'
import { Button, Skeleton, SystemState } from '@makinbakin/sdk/ui'

import type { ModelsData } from './use-models-data'

/** Supplies registered-agent identity (headshot, color) to the presentation avatar. */
function OverrideAgentAvatar({ agentId, name }: { agentId: string; name: string }) {
  const agent = useAgent(agentId)
  const color = useAgentColor(agentId)
  return (
    <AgentAvatar
      agent={{
        id: agentId,
        name,
        imageSrc: agent?.headshot || undefined,
        color: agent ? color : undefined,
      }}
      size="sm"
      decorative
    />
  )
}

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
    <div className="@container/model-config flex min-w-0 flex-col gap-bakin-6">
      <section
        aria-labelledby="global-model-defaults-heading"
        className="flex min-w-0 flex-col gap-bakin-4 rounded-bakin-surface border border-bakin-border-subtle bg-bakin-surface-default p-bakin-4 @xl/model-config:p-bakin-6"
      >
        <div className="flex min-w-0 flex-col items-stretch gap-bakin-3 @lg/model-config:flex-row @lg/model-config:items-start @lg/model-config:justify-between">
          <div className="min-w-0">
            <h2
              id="global-model-defaults-heading"
            >
              Global Defaults
            </h2>
            <p className="m-0 mt-bakin-1 max-w-prose text-bakin-typography-size-body leading-relaxed text-bakin-text-muted">
              Choose the primary model, the default for delegated work, and ordered fallbacks used across agents.
            </p>
          </div>
          {defaultsDirty && (
            <Button
              onClick={() => saveDefaults()}
              disabled={!!saving || !modelsReady}
              size="sm"
              className="w-full @lg/model-config:w-auto"
            >
              Save Defaults
            </Button>
          )}
        </div>

        <div className="grid min-w-0 gap-bakin-4 @2xl/model-config:grid-cols-2">
          <div className="min-w-0">
            <label
              htmlFor="models-default-primary"
              className="mb-bakin-2 block text-bakin-typography-size-meta font-bakin-typography-weight-semibold text-bakin-text-muted"
            >
              Default Model
            </label>
            <ModelSelect
              id="models-default-primary"
              value={effectiveDefaultModel}
              onValueChange={(v) => setPendingDefaultModel(v)}
              models={modelOptions}
              className="w-full min-w-0"
            />
          </div>
          <div className="min-w-0">
            <label
              htmlFor="models-default-subagent"
              className="mb-bakin-2 block text-bakin-typography-size-meta font-bakin-typography-weight-semibold text-bakin-text-muted"
            >
              Default Subagent Model
            </label>
            <ModelSelect
              id="models-default-subagent"
              value={effectiveDefaultSubagentModel}
              onValueChange={(v) => setPendingDefaultSubagentModel(v === '__default__' ? null : v)}
              models={modelOptions}
              defaultLabel={`Use primary default (${effectiveDefaultModel})`}
              className="w-full min-w-0"
            />
          </div>
        </div>

        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-bakin-3">
            <h3 className="text-bakin-typography-size-body">
              Fallback Models
            </h3>
            <Button
              variant="outline"
              size="xs"
              onClick={() => setPendingFallbackModels([...(pendingFallbackModels ?? fallbackModels), fallbackCandidates[0]?.id ?? ''])}
              disabled={fallbackCandidates.length === 0}
            >
              <Plus className="size-3" />
              Add Fallback
            </Button>
          </div>

          <div className="mt-bakin-3 flex min-w-0 flex-col gap-bakin-2">
            {effectiveFallbackModels.length === 0 ? (
              <SystemState
                kind="initial-empty"
                scope="inline"
                title="No fallback models configured."
              />
            ) : (
              effectiveFallbackModels.map((modelId, index) => (
                <div
                  key={`${modelId}-${index}`}
                  className="flex min-w-0 flex-wrap items-center gap-bakin-2"
                >
                  <span className="text-bakin-typography-size-meta text-bakin-text-muted">
                    {index + 1}
                    <span className="sr-only"> in fallback order</span>
                  </span>
                  <ModelSelect
                    value={modelId}
                    ariaLabel={`Fallback model ${index + 1}`}
                    onValueChange={(value) => {
                      const next = [...effectiveFallbackModels]
                      next[index] = value
                      setPendingFallbackModels([...new Set(next.filter(Boolean).filter((id) => id !== effectiveDefaultModel))])
                    }}
                    models={fallbackCandidates}
                    className="min-w-48 flex-1"
                  />
                  <div className="flex items-center gap-bakin-2">
                    <Button
                      variant="outline"
                      size="icon-sm"
                      aria-label={`Move fallback ${index + 1} up`}
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
                      aria-label={`Move fallback ${index + 1} down`}
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
                      aria-label={`Remove fallback ${index + 1}`}
                      onClick={() => setPendingFallbackModels(effectiveFallbackModels.filter((_, i) => i !== index))}
                    >
                      <X className="size-3" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      {hasPending && (
        <div className="flex justify-end">
          <Button onClick={saveAll} disabled={!!saving || !modelsReady} size="sm">
            Save All Agent Changes
          </Button>
        </div>
      )}

      <section aria-labelledby="agent-model-overrides-heading" className="min-w-0">
        <div className="mb-bakin-3">
          <h2
            id="agent-model-overrides-heading"
          >
            Agent Overrides
          </h2>
          <p className="m-0 mt-bakin-1 max-w-prose text-bakin-typography-size-body leading-relaxed text-bakin-text-muted">
            Override the defaults only where an agent needs a different model.
          </p>
        </div>

        {loading ? (
          <div
            role="status"
            aria-label="Loading agent model configuration"
            className="space-y-bakin-2"
          >
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-16 w-full" />
            ))}
          </div>
        ) : agents.length === 0 ? (
          <SystemState
            kind="initial-empty"
            scope="section"
            title="No agents configured"
            description="Agents will appear here after the runtime reports its current roster."
          />
        ) : (
          <ListRows
            aria-label="Agent model overrides"
            variant="separated"
            columns="minmax(9rem,.55fr) minmax(0,1fr) minmax(0,1fr) auto"
            columnsAt="3xl"
            columnsAlign="end"
          >
            {agents.map((agent) => {
              const ownVal = pendingOwn[agent.agentId] ?? (agent.ownModel || '__default__')
              const subVal = pendingSub[agent.agentId] ?? (agent.subagentModel || '__default__')
              const hasDirty = agent.agentId in pendingOwn || agent.agentId in pendingSub
              const isSaving = saving === agent.agentId
              const ownModelId = `agent-${agent.agentId}-own-model`
              const subagentModelId = `agent-${agent.agentId}-subagent-model`

              return (
                <ListRow
                  key={agent.agentId}
                  data-agent-model-row
                  className="px-bakin-4 py-bakin-4"
                >
                  <div className="flex min-w-0 items-center gap-bakin-2 @3xl/list-rows:self-center">
                    <OverrideAgentAvatar agentId={agent.agentId} name={agent.name} />
                    <span className="min-w-0 truncate font-bakin-typography-weight-semibold text-bakin-text-primary">
                      {agent.name}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <label
                      htmlFor={ownModelId}
                      className="mb-bakin-2 block text-bakin-typography-size-meta font-bakin-typography-weight-semibold text-bakin-text-muted"
                    >
                      Own Model
                    </label>
                    <ModelSelect
                      id={ownModelId}
                      value={ownVal}
                      onValueChange={(v) => setPendingOwn((p) => ({ ...p, [agent.agentId]: v }))}
                      models={modelOptions}
                      defaultLabel={`Default (${agent.defaultModel})`}
                      className="w-full min-w-0"
                    />
                  </div>
                  <div className="min-w-0">
                    <label
                      htmlFor={subagentModelId}
                      className="mb-bakin-2 block text-bakin-typography-size-meta font-bakin-typography-weight-semibold text-bakin-text-muted"
                    >
                      Subagent Model
                    </label>
                    <ModelSelect
                      id={subagentModelId}
                      value={subVal}
                      onValueChange={(v) => setPendingSub((p) => ({ ...p, [agent.agentId]: v }))}
                      models={modelOptions}
                      defaultLabel={`Default (${agent.defaultSubagentModel || agent.defaultModel})`}
                      className="w-full min-w-0"
                    />
                  </div>
                  <div className="flex min-w-0 justify-end">
                    {hasDirty ? (
                      <Button
                        onClick={() => saveAgent(agent.agentId)}
                        disabled={isSaving || !modelsReady}
                        size="sm"
                        className="w-full @lg/model-config:w-auto"
                      >
                        {isSaving ? 'Saving...' : 'Save'}
                      </Button>
                    ) : (
                      <span className="sr-only">Using saved model settings</span>
                    )}
                  </div>
                </ListRow>
              )
            })}
          </ListRows>
        )}
      </section>
    </div>
  )
}
