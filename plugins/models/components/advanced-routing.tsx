'use client'

/**
 * Advanced › Work routing: a model and thinking level per kind of work —
 * Agent work (the five dispatch classes + direct send) and Background
 * chores (the five small jobs Bakin runs on its own) — plus tag overrides
 * that take priority over both. Opens with guidance on what each group is
 * and when a route is worth setting. `perTurnModel === false` ⇒ notice +
 * read-only.
 */
import { useState } from 'react'
import { Plus, Route, Wand2, X } from 'lucide-react'
import { Section, Stack } from '@makinbakin/sdk/layout'
import { ConfirmDialog, DEFAULT_MODEL_VALUE, DataTable, KeyValue, ListRow, ListRows, ModelSelect, type DataTableColumn, type KeyValueItem, type ModelSelectOption } from '@makinbakin/sdk/patterns'
import { Alert, Button, Field, FieldLabel, Input, Text } from '@makinbakin/sdk/ui'

import { effectiveTagOverrides } from '../lib/advanced'
import { WORK_CLASSES } from '../lib/mode'
import { GuideCard } from '@makinbakin/sdk/patterns'
import { ALL_THINKING_LEVELS, StagedMark, ThinkingSelect } from './advanced-shared'
import { PendingChip, SelectionCallout } from './selection-callout'
import type { SelectionsData } from './use-selections'

const AGENT_WORK_ROWS = WORK_CLASSES.filter((c) => c.routable && c.recommendedTier === undefined)
const CHORES_ROWS = WORK_CLASSES.filter((c) => c.routable && c.recommendedTier !== undefined)
type RouteRow = (typeof WORK_CLASSES)[number]

export interface AdvancedRoutingProps {
  sel: SelectionsData
  modelOptions: readonly ModelSelectOption[]
}

export function AdvancedRouting({ sel, modelOptions }: AdvancedRoutingProps) {
  const selections = sel.selections
  const states = selections?.states ?? []
  const support = selections?.support
  const perTurnModel = support?.perTurnModel !== false
  const supportedThinking = support?.supportedThinkingLevels ?? [...ALL_THINKING_LEVELS]
  const [routesOpen, setRoutesOpen] = useState(false)
  const [newTag, setNewTag] = useState({ tag: '', model: '' })
  const tagRows = effectiveTagOverrides(states, sel.draft, sel.effective)
  const highlight = sel.highlightRef
  const routesSet = [...AGENT_WORK_ROWS, ...CHORES_ROWS].filter((c) => sel.effective(`route:${c.id}`).model || sel.effective(`route:${c.id}`).thinking).length

  const routeColumns: ReadonlyArray<DataTableColumn<RouteRow>> = [
    {
      key: 'workClass',
      header: 'Kind of work',
      cellClassName: 'whitespace-normal align-top',
      cell: (row) => {
        const eff = sel.effective(`route:${row.id}`)
        return (
          <div className="min-w-0" data-route-row={row.id} data-highlighted={highlight === `route:${row.id}` ? 'true' : undefined}>
            <div className="flex flex-wrap items-center gap-bakin-2">
              <h3 className="m-0">{row.label}</h3>
              <StagedMark staged={eff.staged} />
              <PendingChip sel={sel} refName={`route:${row.id}`} />
            </div>
            <Text as="p" size="meta" tone="muted" className="mt-bakin-1 leading-relaxed">{row.description}</Text>
            <SelectionCallout sel={sel} refName={`route:${row.id}`} />
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
      cell: (row) => (
        <ThinkingSelect
          id={`routing-${row.id}-thinking`}
          label={`${row.label} thinking`}
          value={sel.effective(`route:${row.id}`).thinking}
          supported={supportedThinking}
          disabled={!perTurnModel}
          onChange={(value) => sel.stage(`route:${row.id}`, { thinking: value })}
        />
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

  return (
    <Stack gap="section">
      <GuideCard
        icon={Route}
        title="Match the model to the kind of work"
        lead={`Every turn Bakin runs has a kind of work. A route sends that kind to a specific model and thinking level; anything unrouted uses the agent's model. ${routesSet === 0 ? 'Nothing is routed right now — everything runs on the agent model.' : `${routesSet} of ${AGENT_WORK_ROWS.length + CHORES_ROWS.length} kinds are routed.`}`}
        points={[
          { heading: 'Agent work is the real work', body: 'Scheduled, workflow, ad-hoc, recovery and decomposition turns are the tasks your agents do; direct send is you messaging an agent. Route these only when a kind deserves a different quality or depth — for example, workflows on a stronger model, recovery at higher thinking.' },
          { heading: 'Background chores are cheap and frequent', body: 'Chat titles, asset enrichment, notifications, team routing and skill mapping run constantly and need little intelligence. This is where a budget model saves the most; enrichment is the one chore that needs a model that can see images.' },
          { heading: 'Thinking and tags refine it', body: 'Thinking levels trade depth for speed and cost — only the levels your runtime honors are offered. A tag override wins over every route for tasks carrying that tag; use it for a few exceptional jobs, not as a second routing table.' },
        ]}
        actions={(
          <Button type="button" variant="outline" size="sm" disabled={!perTurnModel || proposals.proposals.length === 0} onClick={() => setRoutesOpen(true)}>
            <Wand2 className="size-bakin-4" />
            Use recommended routes
          </Button>
        )}
      />

      {!perTurnModel ? (
        <Alert tone="attention" data-testid="per-turn-clamped">
          The active runtime does not honor per-turn model overrides — routes are shown for reference and cannot be edited here.
        </Alert>
      ) : null}

      <Section spacing="compact" aria-labelledby="agent-work-heading">
        <div className="min-w-0">
          <h2 id="agent-work-heading" className="m-0">Agent work</h2>
          <Text as="p" size="meta" tone="muted" className="mt-bakin-1 max-w-prose leading-relaxed">The turns your agents spend on tasks and conversations. Leave these on the agent model unless one kind consistently needs more (or less).</Text>
        </div>
        <DataTable label="Agent work routes" columns={routeColumns} rows={AGENT_WORK_ROWS} rowKey={(row) => row.id} rowProps={(row) => ({ 'data-routing-row': row.id })} />
      </Section>

      <Section spacing="compact" divider="top" aria-labelledby="chores-heading">
        <div className="min-w-0">
          <h2 id="chores-heading" className="m-0">Background chores</h2>
          <Text as="p" size="meta" tone="muted" className="mt-bakin-1 max-w-prose leading-relaxed">Small jobs Bakin runs on its own, many times a day. A light model here is the easiest saving on the page.</Text>
        </div>
        <DataTable label="Background chores routes" columns={routeColumns} rows={CHORES_ROWS} rowKey={(row) => row.id} rowProps={(row) => ({ 'data-routing-row': row.id })} />
      </Section>

      <Section spacing="compact" divider="top" aria-labelledby="tag-overrides-heading">
        <div className="flex min-w-0 flex-wrap items-end justify-between gap-bakin-3">
          <div className="min-w-0">
            <h2 id="tag-overrides-heading" className="m-0">Tag overrides</h2>
            <Text as="p" size="meta" tone="muted" className="mt-bakin-1 max-w-prose leading-relaxed">A task carrying this tag uses this model and thinking level before any route above is consulted. The first matching override wins.</Text>
          </div>
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
                  <PendingChip sel={sel} refName={row.ref} />
                  <SelectionCallout sel={sel} refName={row.ref} />
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
                <ThinkingSelect id={`tag-${row.tag}-thinking`} label={`Tag override ${row.tag} thinking`} value={row.thinking} supported={supportedThinking} disabled={!perTurnModel} onChange={(value) => sel.stage(row.ref, { thinking: value })} />
                <Button type="button" variant="outline" size="icon-sm" aria-label={`Remove tag override ${row.tag}`} disabled={!perTurnModel} onClick={() => (row.added ? sel.unstage(row.ref) : sel.stage(row.ref, { model: null, thinking: null }))}>
                  <X className="size-bakin-4" />
                </Button>
              </ListRow>
            ))}
          </ListRows>
        )}
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
