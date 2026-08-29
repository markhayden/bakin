'use client'

import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react'
import { useAgent, useAgentColor } from '@makinbakin/sdk/hooks'
import { Panel } from '@makinbakin/sdk/layout'
import { AgentAvatar, ListRow, ListRows, ModelSelect } from '@makinbakin/sdk/patterns'
import { Button, Field, FieldLabel, SystemState, Text } from '@makinbakin/sdk/ui'

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
      <Panel
        as="section"
        aria-labelledby="global-model-defaults-heading"
        className="flex flex-col gap-bakin-4 @xl/model-config:p-bakin-6"
      >
        <div className="flex min-w-0 flex-col items-stretch gap-bakin-3 @lg/model-config:flex-row @lg/model-config:items-start @lg/model-config:justify-between">
          <div className="min-w-0">
            <h2 id="global-model-defaults-heading">Global Defaults</h2>
            <Text size="body" tone="muted" as="p" className="mt-bakin-1 max-w-prose leading-relaxed">
              Choose the primary model, the default for delegated work, and ordered fallbacks used across agents.
            </Text>
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
          <Field name="models-default-primary">
            <FieldLabel htmlFor="models-default-primary">Default Model</FieldLabel>
            <ModelSelect
              id="models-default-primary"
              value={effectiveDefaultModel}
              onValueChange={(v) => setPendingDefaultModel(v)}
              models={modelOptions}
              className="w-full min-w-0"
            />
          </Field>
          <Field name="models-default-subagent">
            <FieldLabel htmlFor="models-default-subagent">Default Subagent Model</FieldLabel>
            <ModelSelect
              id="models-default-subagent"
              value={effectiveDefaultSubagentModel}
              onValueChange={(v) => setPendingDefaultSubagentModel(v === '__default__' ? null : v)}
              models={modelOptions}
              defaultLabel={`Use primary default (${effectiveDefaultModel})`}
              className="w-full min-w-0"
            />
          </Field>
        </div>

        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-bakin-3">
            <h3>Fallback Models</h3>
            <Button
              variant="outline"
              size="xs"
              onClick={() => setPendingFallbackModels([...(pendingFallbackModels ?? fallbackModels), fallbackCandidates[0]?.id ?? ''])}
              disabled={fallbackCandidates.length === 0}
            >
              <Plus className="size-bakin-3" />
              Add Fallback
            </Button>
          </div>

          <div className="mt-bakin-3 min-w-0">
            {effectiveFallbackModels.length === 0 ? (
              <SystemState
                kind="initial-empty"
                scope="inline"
                title="No fallback models configured."
              />
            ) : (
              <ListRows
                aria-label="Fallback models in priority order"
                variant="plain"
                size="sm"
              >
                {effectiveFallbackModels.map((modelId, index) => (
                  <ListRow
                    key={`${modelId}-${index}`}
                    className="flex flex-wrap items-center gap-bakin-2 px-bakin-0"
                  >
                    <Text size="meta" tone="muted">
                      {index + 1}
                      <span className="sr-only"> in fallback order</span>
                    </Text>
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
                        <ArrowUp className="size-bakin-3" />
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
                        <ArrowDown className="size-bakin-3" />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon-sm"
                        aria-label={`Remove fallback ${index + 1}`}
                        onClick={() => setPendingFallbackModels(effectiveFallbackModels.filter((_, i) => i !== index))}
                      >
                        <X className="size-bakin-3" />
                      </Button>
                    </div>
                  </ListRow>
                ))}
              </ListRows>
            )}
          </div>
        </div>
      </Panel>

      {hasPending && (
        <div className="flex justify-end">
          <Button onClick={saveAll} disabled={!!saving || !modelsReady} size="sm">
            Save All Agent Changes
          </Button>
        </div>
      )}

      <section aria-labelledby="agent-model-overrides-heading" className="min-w-0">
        <div className="mb-bakin-3">
          <h2 id="agent-model-overrides-heading">Agent Overrides</h2>
          <Text size="body" tone="muted" as="p" className="mt-bakin-1 max-w-prose leading-relaxed">
            Override the defaults only where an agent needs a different model.
          </Text>
        </div>

        {loading ? (
          <SystemState
            kind="loading"
            scope="section"
            title="Loading agent model configuration"
            description="Each agent's own and subagent model appear once the runtime reports its roster."
          />
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
                  <Field name={ownModelId}>
                    <FieldLabel htmlFor={ownModelId}>Own Model</FieldLabel>
                    <ModelSelect
                      id={ownModelId}
                      value={ownVal}
                      onValueChange={(v) => setPendingOwn((p) => ({ ...p, [agent.agentId]: v }))}
                      models={modelOptions}
                      defaultLabel={`Default (${agent.defaultModel})`}
                      className="w-full min-w-0"
                    />
                  </Field>
                  <Field name={subagentModelId}>
                    <FieldLabel htmlFor={subagentModelId}>Subagent Model</FieldLabel>
                    <ModelSelect
                      id={subagentModelId}
                      value={subVal}
                      onValueChange={(v) => setPendingSub((p) => ({ ...p, [agent.agentId]: v }))}
                      models={modelOptions}
                      defaultLabel={`Default (${agent.defaultSubagentModel || agent.defaultModel})`}
                      className="w-full min-w-0"
                    />
                  </Field>
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
