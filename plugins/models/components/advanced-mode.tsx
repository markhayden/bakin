'use client'

/**
 * The Advanced view (spec §3.4): three sections on one page over the same
 * draft Simple edits — Defaults (default model + the runtime-supported
 * policy knobs), Agents (per-agent overrides), and Work routing (the 11
 * routable classes grouped Agent work / Background chores, tag overrides,
 * "Use recommended routes"). Every edit stages an op; the page's one
 * SaveBar writes. Controls the active runtime cannot persist are HIDDEN
 * behind one muted line, not disabled (D11); `perTurnModel === false`
 * shows an Alert and makes the routing columns read-only.
 */
import { useState } from 'react'
import { Plus, Wand2, X } from 'lucide-react'
import { useAgent, useAgentColor } from '@makinbakin/sdk/hooks'
import { Grid, Section, Stack } from '@makinbakin/sdk/layout'
import {
  AgentAvatar,
  ConfirmDialog,
  DEFAULT_MODEL_VALUE,
  DataTable,
  KeyValue,
  ListRow,
  ListRows,
  ModelSelect,
  type DataTableColumn,
  type KeyValueItem,
  type ModelSelectOption,
} from '@makinbakin/sdk/patterns'
import {
  Alert,
  Badge,
  Button,
  Field,
  FieldLabel,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SystemState,
  Text,
} from '@makinbakin/sdk/ui'

import { agentRows, effectiveAliases, effectiveFallbacks, effectiveTagOverrides } from '../lib/advanced'
import { WORK_CLASSES } from '../lib/mode'
import type { SelectionsData } from './use-selections'

// The full ordered ladder; the active runtime's declared support filters it.
const ALL_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive', 'max'] as const
const THINKING_LABELS: Record<string, string> = {
  inherit: 'Inherit agent setting',
  off: 'Off',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  adaptive: 'Adaptive',
  max: 'Maximum',
}
const AGENT_WORK_ROWS = WORK_CLASSES.filter((c) => c.routable && c.recommendedTier === undefined)
const CHORES_ROWS = WORK_CLASSES.filter((c) => c.routable && c.recommendedTier !== undefined)
type RouteRow = (typeof WORK_CLASSES)[number]

export interface AdvancedModeProps {
  sel: SelectionsData
  modelOptions: readonly ModelSelectOption[]
}

/** Supplies registered-agent identity (headshot, color) to the presentation avatar. */
function OverrideAgentAvatar({ agentId, name }: { agentId: string; name: string }) {
  const agent = useAgent(agentId)
  const color = useAgentColor(agentId)
  return (
    <AgentAvatar
      agent={{ id: agentId, name, imageSrc: agent?.headshot || undefined, color: agent ? color : undefined }}
      size="sm"
      decorative
    />
  )
}

function StagedMark({ staged }: { staged: boolean }) {
  return staged ? <Badge tone="attention" variant="outline" size="xs">unsaved</Badge> : null
}

export function AdvancedMode({ sel, modelOptions }: AdvancedModeProps) {
  const selections = sel.selections
  const states = selections?.states ?? []
  const support = selections?.support
  const perTurnModel = support?.perTurnModel !== false
  const [routesOpen, setRoutesOpen] = useState(false)
  const [newTag, setNewTag] = useState({ tag: '', model: '' })
  const [newAlias, setNewAlias] = useState({ name: '', target: '' })

  const agent = sel.effective('policy:defaultModel')
  const defaultSub = sel.effective('policy:defaultSubagentModel')
  const fallbacks = effectiveFallbacks(states, sel.draft, sel.effective)
  const aliases = effectiveAliases(states, sel.draft, sel.effective)
  const tagRows = effectiveTagOverrides(states, sel.draft, sel.effective)
  const agents = agentRows(states)
  const highlight = sel.highlightRef

  const supportedThinking = support?.supportedThinkingLevels ?? [...ALL_THINKING_LEVELS]
  const thinkingLevels = ['inherit', ...supportedThinking]
  const thinkingSelect = (id: string, label: string, value: string | null, onChange: (v: string | null) => void) => (
    <Select value={value ?? 'inherit'} onValueChange={(next) => onChange(!next || next === 'inherit' ? null : next)} disabled={!perTurnModel}>
      <SelectTrigger id={id} size="sm" aria-label={label} className="w-full min-w-0">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {thinkingLevels.map((level) => (
          <SelectItem key={level} value={level}>{THINKING_LABELS[level] ?? level}</SelectItem>
        ))}
        {value && !thinkingLevels.includes(value) ? (
          <SelectItem value={value}>{THINKING_LABELS[value] ?? value} · unsupported by this runtime</SelectItem>
        ) : null}
      </SelectContent>
    </Select>
  )

  const setFallbacks = (next: string[]) => {
    const max = Math.max(fallbacks.length, next.length, ...states.filter((s) => s.ref.startsWith('policy:fallback:')).map((s) => Number(s.ref.slice('policy:fallback:'.length)) + 1))
    const ops = []
    for (let n = 0; n < max; n++) ops.push({ ref: `policy:fallback:${n}`, set: { model: next[n] ?? null } })
    sel.stageAll(ops)
  }
  const fallbackCandidates = modelOptions.filter((m) => m.id !== agent.model && !fallbacks.includes(m.id))

  const routeColumns: ReadonlyArray<DataTableColumn<RouteRow>> = [
    {
      key: 'workClass',
      header: 'Work class',
      cellClassName: 'whitespace-normal align-top',
      cell: (row) => {
        const eff = sel.effective(`route:${row.id}`)
        return (
          <div className="min-w-0" data-route-row={row.id} data-highlighted={highlight === `route:${row.id}` ? 'true' : undefined}>
            <div className="flex flex-wrap items-center gap-bakin-2">
              <h3>{row.label}</h3>
              <StagedMark staged={eff.staged} />
            </div>
            <Text as="p" size="meta" tone="muted" className="mt-bakin-1 leading-relaxed">{row.description}</Text>
          </div>
        )
      },
    },
    {
      key: 'model',
      header: 'Model',
      cellClassName: 'align-top',
      cell: (row) => (
        <ModelSelect
          id={`routing-${row.id}-model`}
          value={sel.effective(`route:${row.id}`).model ?? DEFAULT_MODEL_VALUE}
          onValueChange={(value) => sel.stage(`route:${row.id}`, { model: value === DEFAULT_MODEL_VALUE ? null : value })}
          models={modelOptions}
          defaultLabel="Use agent model"
          ariaLabel={`${row.label} model`}
          disabled={!perTurnModel}
          className="w-full min-w-0"
        />
      ),
    },
    {
      key: 'thinking',
      header: 'Thinking',
      cellClassName: 'align-top',
      cell: (row) => thinkingSelect(
        `routing-${row.id}-thinking`,
        `${row.label} thinking`,
        sel.effective(`route:${row.id}`).thinking,
        (value) => sel.stage(`route:${row.id}`, { thinking: value }),
      ),
    },
  ]

  const proposals = sel.plan?.routeProposals ?? { proposals: [], skipped: [] }
  const proposalItems: KeyValueItem[] = [
    ...proposals.proposals.map((p) => ({ label: p.workClass, mono: true, value: `${p.model} (${p.reason})` })),
    ...proposals.skipped.map((s) => ({ label: `Skipped ${s.workClass}`, value: s.reason })),
  ]

  // A new override needs a model to mean anything (tag + nothing = no op).
  const addTag = () => {
    const tag = newTag.tag.trim()
    if (!tag || !newTag.model) return
    sel.stage(`tag:${tag}`, { model: newTag.model })
    setNewTag({ tag: '', model: '' })
  }
  const addAlias = () => {
    const name = newAlias.name.trim()
    if (!name || !newAlias.target) return
    sel.stage(`policy:alias:${name}`, { model: newAlias.target })
    setNewAlias({ name: '', target: '' })
  }

  const hiddenKnobs = support
    ? [!support.fallbackModels && 'fallbacks', !support.aliases && 'aliases', !support.defaultSubagentModel && 'a default subagent model'].filter(Boolean) as string[]
    : []

  return (
    <Stack gap="section">
      {/* ── 1. Defaults ─────────────────────────────────────────────── */}
      <Section spacing="compact" aria-labelledby="defaults-heading">
        <Stack gap="dense">
          <h2 id="defaults-heading">Defaults</h2>
          <Text size="meta" tone="muted">The model every agent and job uses unless something below says otherwise.</Text>
        </Stack>
        <div className="grid min-w-0 gap-bakin-4 @2xl/page-shell:grid-cols-2">
          <Field name="advanced-default-model" data-highlighted={highlight === 'policy:defaultModel' ? 'true' : undefined}>
            <FieldLabel htmlFor="advanced-default-model">Default model <StagedMark staged={agent.staged} /></FieldLabel>
            <ModelSelect
              id="advanced-default-model"
              value={agent.model ?? DEFAULT_MODEL_VALUE}
              onValueChange={(value) => sel.stage('policy:defaultModel', { model: value === DEFAULT_MODEL_VALUE ? null : value })}
              models={modelOptions}
              defaultLabel="Not set"
              className="w-full min-w-0"
            />
          </Field>
          {support?.defaultSubagentModel ? (
            <Field name="advanced-default-subagent" data-highlighted={highlight === 'policy:defaultSubagentModel' ? 'true' : undefined}>
              <FieldLabel htmlFor="advanced-default-subagent">Default subagent model <StagedMark staged={defaultSub.staged} /></FieldLabel>
              <ModelSelect
                id="advanced-default-subagent"
                value={defaultSub.model ?? DEFAULT_MODEL_VALUE}
                onValueChange={(value) => sel.stage('policy:defaultSubagentModel', { model: value === DEFAULT_MODEL_VALUE ? null : value })}
                models={modelOptions}
                defaultLabel={`Use the default model${agent.model ? ` (${agent.model})` : ''}`}
                className="w-full min-w-0"
              />
            </Field>
          ) : null}
        </div>

        {support?.fallbackModels ? (
          <Stack gap="dense">
            <div className="flex flex-wrap items-center justify-between gap-bakin-3">
              <h3>Fallback models</h3>
              <Button type="button" variant="outline" size="xs" disabled={fallbackCandidates.length === 0} onClick={() => setFallbacks([...fallbacks, fallbackCandidates[0]!.id])}>
                <Plus className="size-bakin-3" />
                Add fallback
              </Button>
            </div>
            {fallbacks.length === 0 ? (
              <Text size="meta" tone="muted">No fallbacks — a failed turn is not retried on another model.</Text>
            ) : (
              <ListRows aria-label="Fallback models" variant="separated" columns="auto minmax(0,1fr) auto" columnsAt="2xl" columnsAlign="end">
                {fallbacks.map((model, index) => (
                  <ListRow key={`${index}-${model}`} data-fallback-row={index} className="px-bakin-4 py-bakin-3">
                    <Text size="meta" tone="muted">{index + 1}</Text>
                    <ModelSelect
                      id={`advanced-fallback-${index}`}
                      value={model}
                      onValueChange={(value) => setFallbacks(fallbacks.map((m, i) => (i === index ? value : m)))}
                      models={modelOptions.filter((m) => m.id !== agent.model)}
                      ariaLabel={`Fallback ${index + 1}`}
                      className="w-full min-w-0"
                    />
                    <div className="flex gap-bakin-1">
                      <Button type="button" variant="outline" size="icon-sm" aria-label={`Move fallback ${index + 1} up`} disabled={index === 0} onClick={() => { const next = [...fallbacks]; [next[index - 1], next[index]] = [next[index]!, next[index - 1]!]; setFallbacks(next) }}>↑</Button>
                      <Button type="button" variant="outline" size="icon-sm" aria-label={`Move fallback ${index + 1} down`} disabled={index === fallbacks.length - 1} onClick={() => { const next = [...fallbacks]; [next[index + 1], next[index]] = [next[index]!, next[index + 1]!]; setFallbacks(next) }}>↓</Button>
                      <Button type="button" variant="outline" size="icon-sm" aria-label={`Remove fallback ${index + 1}`} onClick={() => setFallbacks(fallbacks.filter((_, i) => i !== index))}>
                        <X className="size-bakin-3" />
                      </Button>
                    </div>
                  </ListRow>
                ))}
              </ListRows>
            )}
          </Stack>
        ) : null}

        {support?.aliases ? (
          <Stack gap="dense">
            <h3>Aliases</h3>
            <Text size="meta" tone="muted">Short names agents and prompts can use in place of a full model id.</Text>
            {Object.keys(aliases).length === 0 ? (
              <Text size="meta" tone="muted">No aliases.</Text>
            ) : (
              <ListRows aria-label="Model aliases" variant="separated" columns="minmax(8rem,.4fr) minmax(0,1fr) auto" columnsAt="2xl" columnsAlign="end">
                {Object.entries(aliases).map(([name, target]) => (
                  <ListRow key={name} data-alias-row={name} className="px-bakin-4 py-bakin-3">
                    <span className="font-bakin-typography-family-mono text-bakin-text-primary">{name}</span>
                    <ModelSelect
                      id={`advanced-alias-${name}`}
                      value={target}
                      onValueChange={(value) => sel.stage(`policy:alias:${name}`, { model: value })}
                      models={modelOptions}
                      ariaLabel={`Alias ${name} target`}
                      className="w-full min-w-0"
                    />
                    <Button type="button" variant="outline" size="icon-sm" aria-label={`Remove alias ${name}`} onClick={() => sel.stage(`policy:alias:${name}`, { model: null })}>
                      <X className="size-bakin-3" />
                    </Button>
                  </ListRow>
                ))}
              </ListRows>
            )}
            <Grid layout="thirds" gap="item" align="end">
              <Field name="advanced-new-alias-name">
                <FieldLabel htmlFor="advanced-new-alias-name">New alias</FieldLabel>
                <Input id="advanced-new-alias-name" value={newAlias.name} placeholder="e.g. fast" onChange={(event) => setNewAlias((p) => ({ ...p, name: event.target.value }))} />
              </Field>
              <Field name="advanced-new-alias-target">
                <FieldLabel htmlFor="advanced-new-alias-target">Target model</FieldLabel>
                <ModelSelect id="advanced-new-alias-target" value={newAlias.target || DEFAULT_MODEL_VALUE} onValueChange={(value) => setNewAlias((p) => ({ ...p, target: value === DEFAULT_MODEL_VALUE ? '' : value }))} models={modelOptions} defaultLabel="Choose a model…" className="w-full min-w-0" />
              </Field>
              <Button type="button" variant="outline" size="sm" disabled={!newAlias.name.trim() || !newAlias.target} onClick={addAlias}>
                <Plus className="size-bakin-4" />
                Add alias
              </Button>
            </Grid>
          </Stack>
        ) : null}

        {hiddenKnobs.length > 0 ? (
          <Text size="meta" tone="muted" data-testid="unsupported-knobs">
            The active runtime doesn&apos;t support {hiddenKnobs.join(', ')}.
          </Text>
        ) : null}
      </Section>

      {/* ── 2. Agents ───────────────────────────────────────────────── */}
      <Section spacing="compact" divider="top" aria-labelledby="agents-heading">
        <Stack gap="dense">
          <h2 id="agents-heading">Agents</h2>
          <Text size="meta" tone="muted">Override the default only where an agent needs a different model.</Text>
        </Stack>
        {agents.length === 0 ? (
          <SystemState kind="initial-empty" scope="section" title="No agents configured" description="Agents appear here once the runtime reports its roster." />
        ) : (
          <ListRows
            aria-label="Agent model overrides"
            variant="separated"
            columns={support?.perAgentSubagentModel ? 'minmax(9rem,.55fr) minmax(0,1fr) minmax(0,1fr)' : 'minmax(9rem,.55fr) minmax(0,1fr)'}
            columnsAt="3xl"
            columnsAlign="end"
          >
            {agents.map((row) => {
              const own = sel.effective(row.modelRef)
              const sub = sel.effective(row.subagentRef)
              const effectiveModel = own.model ?? agent.model
              return (
                <ListRow key={row.agentId} data-agent-model-row={row.agentId} data-highlighted={highlight === row.modelRef || highlight === row.subagentRef ? 'true' : undefined} className="px-bakin-4 py-bakin-4">
                  <div className="flex min-w-0 flex-wrap items-center gap-bakin-2 @3xl/list-rows:self-center">
                    <OverrideAgentAvatar agentId={row.agentId} name={row.name} />
                    <span className="min-w-0 truncate font-bakin-typography-weight-semibold text-bakin-text-primary">{row.name}</span>
                    {effectiveModel ? <Badge tone={own.model ? 'accent' : 'neutral'} variant="outline" size="xs" title={own.model ? 'Pinned' : 'Uses the default model'}>{effectiveModel}</Badge> : null}
                  </div>
                  <Field name={`agent-${row.agentId}-model`}>
                    <FieldLabel htmlFor={`agent-${row.agentId}-model`}>Override <StagedMark staged={own.staged} /></FieldLabel>
                    <ModelSelect
                      id={`agent-${row.agentId}-model`}
                      value={own.model ?? DEFAULT_MODEL_VALUE}
                      onValueChange={(value) => sel.stage(row.modelRef, { model: value === DEFAULT_MODEL_VALUE ? null : value })}
                      models={modelOptions}
                      defaultLabel="Use default model"
                      className="w-full min-w-0"
                    />
                  </Field>
                  {support?.perAgentSubagentModel ? (
                    <Field name={`agent-${row.agentId}-subagent`}>
                      <FieldLabel htmlFor={`agent-${row.agentId}-subagent`}>Subagents <StagedMark staged={sub.staged} /></FieldLabel>
                      <ModelSelect
                        id={`agent-${row.agentId}-subagent`}
                        value={sub.model ?? DEFAULT_MODEL_VALUE}
                        onValueChange={(value) => sel.stage(row.subagentRef, { model: value === DEFAULT_MODEL_VALUE ? null : value })}
                        models={modelOptions}
                        defaultLabel="Use default subagent model"
                        className="w-full min-w-0"
                      />
                    </Field>
                  ) : null}
                </ListRow>
              )
            })}
          </ListRows>
        )}
      </Section>

      {/* ── 3. Work routing ─────────────────────────────────────────── */}
      <Section spacing="compact" divider="top" aria-labelledby="routing-heading">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-bakin-3">
          <Stack gap="dense">
            <h2 id="routing-heading">Work routing</h2>
            <Text size="meta" tone="muted">A model and thinking level per kind of work. Blank routes use the agent model; tag overrides take priority over routes. Interactive chat keeps the operator&apos;s model.</Text>
          </Stack>
          <Button type="button" variant="outline" size="sm" disabled={!perTurnModel || proposals.proposals.length === 0} onClick={() => setRoutesOpen(true)}>
            <Wand2 className="size-bakin-4" />
            Use recommended routes
          </Button>
        </div>
        {!perTurnModel ? (
          <Alert tone="attention" data-testid="per-turn-clamped">
            The active runtime does not honor per-turn model overrides — routes are shown for reference and cannot be edited here.
          </Alert>
        ) : null}
        <Section spacing="compact" aria-label="Agent work routes">
          <h3>Agent work</h3>
          <DataTable label="Agent work routes" columns={routeColumns} rows={AGENT_WORK_ROWS} rowKey={(row) => row.id} rowProps={(row) => ({ 'data-routing-row': row.id })} />
        </Section>
        <Section spacing="compact" divider="top" aria-label="Background chores routes">
          <h3>Background chores</h3>
          <DataTable label="Background chores routes" columns={routeColumns} rows={CHORES_ROWS} rowKey={(row) => row.id} rowProps={(row) => ({ 'data-routing-row': row.id })} />
        </Section>

        <Section spacing="compact" divider="top" aria-labelledby="tag-overrides-heading">
          <div className="flex min-w-0 flex-wrap items-end justify-between gap-bakin-3">
            <Stack gap="dense">
              <h3 id="tag-overrides-heading">Tag overrides</h3>
              <Text size="meta" tone="muted">Match a task tag before its work-class route. The first matching override wins.</Text>
            </Stack>
            <div className="flex flex-wrap items-end gap-bakin-2">
              <Field name="advanced-new-tag">
                <FieldLabel htmlFor="advanced-new-tag">Task tag</FieldLabel>
                <Input id="advanced-new-tag" value={newTag.tag} placeholder="e.g. heavy" disabled={!perTurnModel} onChange={(event) => setNewTag((p) => ({ ...p, tag: event.target.value }))} />
              </Field>
              <Field name="advanced-new-tag-model">
                <FieldLabel htmlFor="advanced-new-tag-model">Model</FieldLabel>
                <ModelSelect id="advanced-new-tag-model" value={newTag.model || DEFAULT_MODEL_VALUE} onValueChange={(value) => setNewTag((p) => ({ ...p, model: value === DEFAULT_MODEL_VALUE ? '' : value }))} models={modelOptions} defaultLabel="Choose a model…" disabled={!perTurnModel} className="w-full min-w-0" />
              </Field>
              <Button type="button" variant="outline" size="sm" disabled={!perTurnModel || !newTag.tag.trim() || !newTag.model} onClick={addTag}>
                <Plus className="size-bakin-4" />
                Add override
              </Button>
            </div>
          </div>
          {tagRows.length === 0 ? (
            <Text size="meta" tone="muted">No tag overrides.</Text>
          ) : (
            <ListRows aria-label="Tag routing overrides" variant="separated" columns="minmax(8rem,.5fr) minmax(0,1fr) minmax(10rem,.5fr) auto" columnsAt="3xl" columnsAlign="end">
              {tagRows.map((row) => (
                <ListRow key={row.ref} data-tag-row={row.tag} data-highlighted={highlight === row.ref ? 'true' : undefined} className="px-bakin-4 py-bakin-3">
                  <div className="flex flex-wrap items-center gap-bakin-2">
                    <span className="font-bakin-typography-family-mono text-bakin-text-primary">{row.tag}</span>
                    <StagedMark staged={row.staged} />
                  </div>
                  <ModelSelect
                    id={`tag-${row.tag}-model`}
                    value={row.model ?? DEFAULT_MODEL_VALUE}
                    onValueChange={(value) => sel.stage(row.ref, { model: value === DEFAULT_MODEL_VALUE ? null : value })}
                    models={modelOptions}
                    defaultLabel="Use work route"
                    ariaLabel={`Tag override ${row.tag} model`}
                    disabled={!perTurnModel}
                    className="w-full min-w-0"
                  />
                  {thinkingSelect(`tag-${row.tag}-thinking`, `Tag override ${row.tag} thinking`, row.thinking, (value) => sel.stage(row.ref, { thinking: value }))}
                  <Button type="button" variant="outline" size="icon-sm" aria-label={`Remove tag override ${row.tag}`} disabled={!perTurnModel} onClick={() => (row.added ? sel.unstage(row.ref) : sel.stage(row.ref, { model: null, thinking: null }))}>
                    <X className="size-bakin-4" />
                  </Button>
                </ListRow>
              ))}
            </ListRows>
          )}
        </Section>
      </Section>

      <ConfirmDialog
        open={routesOpen}
        title="Use recommended routes?"
        description="Unrouted background chores move to the plan's chores model. Routes you already set stay as they are. The changes are staged — nothing is written until you save."
        confirmLabel={`Stage ${proposals.proposals.length} route${proposals.proposals.length === 1 ? '' : 's'}`}
        onConfirm={() => {
          sel.stageAll(proposals.proposals.map((p) => ({ ref: `route:${p.workClass}`, set: { model: p.model } })))
          setRoutesOpen(false)
        }}
        onCancel={() => setRoutesOpen(false)}
      >
        <KeyValue aria-label="Proposed route changes" layout="rows" items={proposalItems} />
      </ConfirmDialog>
    </Stack>
  )
}
