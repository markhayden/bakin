'use client'

/**
 * Advanced › Overview: the default model beside the recommended plan, a
 * glance at what is actually in use (agents on the default vs pinned, the
 * chores model, routes set, tag overrides, agents by model), and the
 * runtime-gated extras (default subagent model, fallbacks, aliases) folded
 * behind a disclosure. The place future recommendations and model news land.
 */
import { useState } from 'react'
import { Plus, Sparkles, X } from 'lucide-react'
import { CompositionBar } from '@makinbakin/sdk/charts'
import { DisclosurePanel, Grid, Stack } from '@makinbakin/sdk/layout'
import { ConfirmDialog, DEFAULT_MODEL_VALUE, KeyValue, ListRow, ListRows, ModelSelect, StatGroup, StatTile, type KeyValueItem, type ModelSelectOption } from '@makinbakin/sdk/patterns'
import { Badge, Button, Card, CardContent, CardFooter, CardHeader, Field, FieldDescription, FieldLabel, Input, Text } from '@makinbakin/sdk/ui'

import { agentRows, effectiveAliases, effectiveFallbacks, effectiveTagOverrides } from '../lib/advanced'
import { WORK_CLASSES } from '../lib/mode'
import { choresLane } from '../lib/simple'
import { StagedMark } from './advanced-shared'
import { PendingChip, SelectionCallout } from './selection-callout'
import { useDeepLinkFocus } from './use-deep-link-focus'
import type { SelectionsData } from './use-selections'

export interface AdvancedOverviewProps {
  sel: SelectionsData
  modelOptions: readonly ModelSelectOption[]
}

const ROUTABLE = WORK_CLASSES.filter((c) => c.routable)

function shortModel(id: string | null): string {
  if (!id) return '—'
  return id.includes('/') ? id.slice(id.indexOf('/') + 1) : id
}

export function AdvancedOverview({ sel, modelOptions }: AdvancedOverviewProps) {
  const selections = sel.selections
  const states = selections?.states ?? []
  const support = selections?.support
  const plan = sel.plan
  const [planOpen, setPlanOpen] = useState(false)
  const [newAlias, setNewAlias] = useState({ name: '', target: '' })

  const agent = sel.effective('policy:defaultModel')
  const defaultSub = sel.effective('policy:defaultSubagentModel')
  const fallbacks = effectiveFallbacks(states, sel.draft, sel.effective)
  const aliases = effectiveAliases(states, sel.draft, sel.effective)
  const tagRows = effectiveTagOverrides(states, sel.draft, sel.effective)
  const agents = agentRows(states)
  const chores = choresLane(sel.effective)
  const highlight = sel.highlightRef
  useDeepLinkFocus(highlight, selections !== null)

  // What is in use, from the DRAFT (staged values win).
  const byModel = new Map<string, number>()
  let pinned = 0
  for (const row of agents) {
    const own = sel.effective(row.modelRef).model
    if (own) pinned += 1
    const effectiveModel = own ?? agent.model ?? 'unset'
    byModel.set(effectiveModel, (byModel.get(effectiveModel) ?? 0) + 1)
  }
  const routesSet = ROUTABLE.filter((c) => sel.effective(`route:${c.id}`).model || sel.effective(`route:${c.id}`).thinking).length
  const recommendedOps = plan?.recommended.ops ?? []
  const onPlan = plan !== null && recommendedOps.length === 0
  // What the recommendation would change, in one sentence — the agent lane
  // (keep vs switch) and the chores lane (same model vs a lighter one).
  const planSentence = (() => {
    if (!plan) return 'The recommendation loads with the page.'
    if (onPlan) return 'You are on the recommended plan: your agents run on a model that can run here, and the background chores use the lightest model that can do them.'
    const rec = plan.recommended
    const agentPart = rec.agent.model === agent.model
      ? `keep ${shortModel(rec.agent.model)} for your agents`
      : `switch your agents to ${shortModel(rec.agent.model)}`
    const choresPart = rec.chores.model === rec.agent.model
      ? 'run the background chores on it too'
      : `move the background chores to ${shortModel(rec.chores.model)} — ${rec.chores.why}`
    return `Bakin would ${agentPart} and ${choresPart}.`
  })()

  const planItems: KeyValueItem[] = plan
    ? [
      { label: 'Agent model', value: plan.recommended.agent.model ?? '—', mono: true },
      { label: 'Background chores', value: plan.recommended.chores.model ?? '—', mono: true },
      ...recommendedOps.map((op) => ({ label: op.ref, value: op.set.model ?? 'inherit', mono: true })),
    ]
    : []

  const setFallbacks = (next: string[]) => {
    const persistedMax = states.filter((s) => s.ref.startsWith('policy:fallback:')).map((s) => Number(s.ref.slice('policy:fallback:'.length)) + 1)
    const max = Math.max(fallbacks.length, next.length, ...persistedMax)
    sel.stageAll(Array.from({ length: max }, (_, n) => ({ ref: `policy:fallback:${n}`, set: { model: next[n] ?? null } })))
  }
  const fallbackCandidates = modelOptions.filter((m) => m.id !== agent.model && !fallbacks.includes(m.id))
  const addAlias = () => {
    const name = newAlias.name.trim()
    if (!name || !newAlias.target) return
    sel.stage(`policy:alias:${name}`, { model: newAlias.target })
    setNewAlias({ name: '', target: '' })
  }
  const extras = support ? [support.defaultSubagentModel && 'default subagent model', support.fallbackModels && 'fallbacks', support.aliases && 'aliases'].filter(Boolean) as string[] : []
  const hiddenKnobs = support ? [!support.fallbackModels && 'fallbacks', !support.aliases && 'aliases', !support.defaultSubagentModel && 'a default subagent model'].filter(Boolean) as string[] : []

  return (
    <Stack gap="section">
      <Grid layout="split" gap="item" align="stretch">
        {/* ── The one choice most people make ───────────────────────── */}
        <Card data-testid="overview-default">
          <CardHeader>
            <h2 id="overview-default-heading" className="m-0">Default model</h2>
            <Text as="p" size="meta" tone="muted" className="mt-bakin-1 max-w-prose leading-relaxed">
              Every agent and every job uses this unless something in Agents or Work routing says otherwise. Pick the model you want doing real work — chat, direct messages, and tasks.
            </Text>
          </CardHeader>
          <CardContent>
          <Field name="advanced-default-model" data-selection-ref="policy:defaultModel">
            <FieldLabel htmlFor="advanced-default-model">Default model <StagedMark staged={agent.staged} /> <PendingChip sel={sel} refName="policy:defaultModel" /></FieldLabel>
            <ModelSelect
              id="advanced-default-model"
              value={agent.model ?? DEFAULT_MODEL_VALUE}
              onValueChange={(value) => sel.stage('policy:defaultModel', { model: value === DEFAULT_MODEL_VALUE ? null : value })}
              models={modelOptions}
              defaultLabel="Not set"
              className="w-full min-w-0"
            />
            {plan?.recommended.agent.model && plan.recommended.agent.model !== agent.model ? (
              <FieldDescription>Recommended: {plan.recommended.agent.model} — {plan.recommended.agent.why}</FieldDescription>
            ) : null}
            <SelectionCallout sel={sel} refName="policy:defaultModel" />
          </Field>
          </CardContent>
        </Card>

        {/* ── Recommendation ────────────────────────────────────────── */}
        <Card data-testid="overview-plan">
          <CardHeader>
          <div className="flex min-w-0 items-start gap-bakin-3">
            <span aria-hidden="true" className="mt-bakin-1 flex size-bakin-8 shrink-0 items-center justify-center rounded-bakin-pill bg-bakin-action-primary-background/10 text-bakin-action-primary-background">
              <Sparkles className="size-bakin-4" />
            </span>
            <div className="min-w-0">
              <h2 id="overview-plan-heading" className="m-0">Recommended plan</h2>
              <Text as="p" size="meta" tone="muted" className="mt-bakin-1 max-w-prose leading-relaxed">{planSentence}</Text>
            </div>
          </div>
          </CardHeader>
          {plan?.recommended.notes.length ? (
            <CardContent className="flex min-w-0 flex-col gap-bakin-2">
              {plan.recommended.notes.map((note) => (
                <Text key={note} size="meta" tone="muted" className="leading-relaxed">{note}</Text>
              ))}
            </CardContent>
          ) : null}
          {plan ? (
            <CardFooter className="mt-auto flex flex-wrap items-center justify-between gap-bakin-3">
              <Text size="meta" tone="muted">{plan.candidates} model{plan.candidates === 1 ? '' : 's'} can run here</Text>
              {onPlan ? (
                <Badge tone="success" variant="soft">On the recommended plan</Badge>
              ) : (
                <Button type="button" size="sm" onClick={() => setPlanOpen(true)}>Use recommended plan</Button>
              )}
            </CardFooter>
          ) : null}
        </Card>
      </Grid>

      {/* ── What is in use ────────────────────────────────────────── */}
      <Stack gap="item" data-testid="overview-stats">
        <div className="min-w-0">
          <h2 className="m-0">In use today</h2>
          <Text as="p" size="meta" tone="muted" className="mt-bakin-1 max-w-prose leading-relaxed">Where your models actually run, counting the changes you have staged.</Text>
        </div>
        <StatGroup label="Model usage">
          <StatTile variant="surface" label="Agents on the default" value={`${agents.length - pinned}`} sub={`of ${agents.length} agent${agents.length === 1 ? '' : 's'}`} />
          <StatTile variant="surface" label="Agents with their own model" value={`${pinned}`} valueTone={pinned > 0 ? 'accent' : 'neutral'} sub={pinned > 0 ? 'set in Agents' : 'none pinned'} />
          <StatTile variant="surface" label="Background chores" value={chores.mixed ? 'Mixed' : shortModel(chores.model)} sub={chores.mixed ? `${chores.models.length} models across 5 chores` : chores.explicit ? 'routed' : 'same as the default'} />
          <StatTile variant="surface" label="Work routes set" value={`${routesSet}`} sub={`of ${ROUTABLE.length} kinds of work`} />
          <StatTile variant="surface" label="Tag overrides" value={`${tagRows.length}`} sub={tagRows.length > 0 ? 'take priority over routes' : 'none'} />
        </StatGroup>
        {agents.length > 0 ? (
          <Card data-testid="overview-agents-by-model">
            <CardHeader>
              <h3 className="m-0">Agents by model</h3>
              <Text as="p" size="meta" tone="muted" className="mt-bakin-1">Which model each of your {agents.length} agent{agents.length === 1 ? ' runs' : 's run'} on, counting overrides.</Text>
            </CardHeader>
            <CardContent>
              <CompositionBar
                size="large"
                label="Agents by model"
                data={[...byModel.entries()].map(([model, count]) => ({ key: model, label: shortModel(model), value: count }))}
                formatValue={(v) => `${v} agent${v === 1 ? '' : 's'}`}
              />
            </CardContent>
          </Card>
        ) : null}
      </Stack>

      {/* ── Runtime-gated extras ──────────────────────────────────── */}
      {extras.length > 0 ? (
        <DisclosurePanel summary="More defaults" summaryMeta={extras.join(' · ')} data-testid="overview-extras">
          <Stack gap="section">
            {support?.defaultSubagentModel ? (
              <Field name="advanced-default-subagent" data-selection-ref="policy:defaultSubagentModel">
                <FieldLabel htmlFor="advanced-default-subagent">Default subagent model <StagedMark staged={defaultSub.staged} /></FieldLabel>
                <FieldDescription>What an agent uses when it delegates work to helpers. Set the orchestrator to a strong model here and let its helpers run on something lighter.</FieldDescription>
                <ModelSelect
                  id="advanced-default-subagent"
                  value={defaultSub.model ?? DEFAULT_MODEL_VALUE}
                  onValueChange={(value) => sel.stage('policy:defaultSubagentModel', { model: value === DEFAULT_MODEL_VALUE ? null : value })}
                  models={modelOptions}
                  defaultLabel={`Use the default model${agent.model ? ` (${agent.model})` : ''}`}
                  className="w-full min-w-0"
                />
                <SelectionCallout sel={sel} refName="policy:defaultSubagentModel" />
              </Field>
            ) : null}

            {support?.fallbackModels ? (
              <Stack gap="dense">
                <div className="flex flex-wrap items-center justify-between gap-bakin-3">
                  <div className="min-w-0">
                    <h3 className="m-0">Fallback models</h3>
                    <Text as="p" size="meta" tone="muted" className="mt-bakin-1 max-w-prose">If the default model fails to answer, the runtime tries these in order.</Text>
                  </div>
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
                          <PendingChip sel={sel} refName={`policy:fallback:${index}`} />
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
                <div className="min-w-0">
                  <h3 className="m-0">Aliases</h3>
                  <Text as="p" size="meta" tone="muted" className="mt-bakin-1 max-w-prose">Short names agents and prompts can use in place of a full model id — define <code>fast</code> once, swap what it points at later.</Text>
                </div>
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
                        <SelectionCallout sel={sel} refName={`policy:alias:${name}`} />
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
          </Stack>
        </DisclosurePanel>
      ) : null}
      {hiddenKnobs.length > 0 ? (
        <Text size="meta" tone="muted" data-testid="unsupported-knobs">
          The active runtime doesn&apos;t support {hiddenKnobs.join(', ')}.
        </Text>
      ) : null}

      <ConfirmDialog
        open={planOpen}
        title="Use the recommended plan?"
        description="These changes are staged into your draft — nothing is written until you save."
        confirmLabel="Stage changes"
        onConfirm={() => {
          sel.stageAll(recommendedOps)
          setPlanOpen(false)
        }}
        onCancel={() => setPlanOpen(false)}
      >
        <KeyValue aria-label="Recommended plan changes" layout="rows" items={planItems} />
      </ConfirmDialog>
    </Stack>
  )
}
