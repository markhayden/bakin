'use client'

/**
 * The Simple view (spec §3.4, D24): two lanes over the same selections the
 * Advanced view edits — the AGENT model (`policy:defaultModel`) and the
 * BACKGROUND CHORES model (the five chores routes). A VIEW, never
 * destructive: every edit stages an op into the shared draft; the page's
 * one SaveBar writes it. The chores lane shows ONE value only when all
 * five routes name the same model and none sets thinking, else "Mixed"
 * with "Set all to…". Everything Simple cannot express is the
 * customizations line, which deep-links into Advanced.
 */
import { useState, type ReactNode } from 'react'
import { DEFAULT_MODEL_VALUE, ConfirmDialog, KeyValue, ModelSelect, type KeyValueItem, type ModelSelectOption } from '@makinbakin/sdk/patterns'
import { Grid, Section, Stack } from '@makinbakin/sdk/layout'
import { Alert, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Field, FieldDescription, FieldLabel, Text } from '@makinbakin/sdk/ui'

import { CHORES_CLASSES } from '../lib/mode'
import { choresLane, setAllChoresOps } from '../lib/simple'
import { ResetToPlan } from './reset-dialog'
import { PendingChip, SelectionCallout } from './selection-callout'
import type { SelectionsData } from './use-selections'

export interface SimpleModeProps {
  sel: SelectionsData
  /** Picker options (ineligible rows disabled with their reason). */
  modelOptions: readonly ModelSelectOption[]
  onAdvanced: () => void
}

function PlanLane({ id, title, description, children, staged, highlighted }: { id: string; title: string; description: string; children: ReactNode; staged: boolean; highlighted: boolean }) {
  return (
    <Card data-testid={id} data-highlighted={highlighted ? 'true' : undefined} data-staged={staged ? 'true' : undefined}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <Stack gap="dense">{children}</Stack>
      </CardContent>
    </Card>
  )
}

export function SimpleMode({ sel, modelOptions, onAdvanced }: SimpleModeProps) {
  const plan = sel.plan
  const agent = sel.effective('policy:defaultModel')
  const chores = choresLane(sel.effective)
  const [planOpen, setPlanOpen] = useState(false)
  const recommendedOps = plan?.recommended.ops ?? []
  const stagedAgentLabel = agent.staged ? ' (unsaved)' : ''
  const choresStaged = CHORES_CLASSES.some((c) => sel.effective(`route:${c}`).staged)
  const highlighted = sel.highlightRef
  // The runtime refuses per-turn model overrides (#880): chores routes are
  // saved here but every chore runs on the agent model until that changes.
  const perTurnModel = sel.selections?.support.perTurnModel !== false

  const planItems: KeyValueItem[] = plan
    ? [
      { label: 'Agent model', value: plan.recommended.agent.model ?? '—', mono: true },
      { label: 'Background chores', value: plan.recommended.chores.model ?? '—', mono: true },
      ...(plan.recommended.enrichment === 'agent' ? [{ label: 'Enrichment', value: `${plan.recommended.agent.model} — the only eligible model that can see images` }] : []),
      ...(plan.recommended.enrichment === 'unset' ? [{ label: 'Enrichment', value: 'No eligible model can see images — enrichment will fail until one is available' }] : []),
      ...recommendedOps.map((op) => ({ label: op.ref, value: op.set.model ?? 'inherit', mono: true })),
    ]
    : []

  return (
    <Stack gap="section">
      <Grid layout="split" gap="item" align="stretch">
        <PlanLane
          id="lane-agent"
          title="Agent model"
          description="Chat, direct messages, and every task your agents run."
          staged={agent.staged}
          highlighted={highlighted === 'policy:defaultModel'}
        >
          <Field name="lane-agent-model">
            <FieldLabel htmlFor="lane-agent-model">Model{stagedAgentLabel} <PendingChip sel={sel} refName="policy:defaultModel" /></FieldLabel>
            <ModelSelect
              id="lane-agent-model"
              value={agent.model ?? DEFAULT_MODEL_VALUE}
              onValueChange={(value) => sel.stage('policy:defaultModel', { model: value === DEFAULT_MODEL_VALUE ? null : value })}
              models={modelOptions}
              defaultLabel="Not set"
              className="w-full min-w-0"
            />
            {plan?.recommended.agent.model && plan.recommended.agent.model !== agent.model ? (
              <FieldDescription>Recommended: {plan.recommended.agent.model} — {plan.recommended.agent.why}</FieldDescription>
            ) : null}
          </Field>
          <SelectionCallout sel={sel} refName="policy:defaultModel" />
        </PlanLane>

        <PlanLane
          id="lane-chores"
          title="Background chores"
          description="Titles, asset enrichment, notifications, team routing, and skill mapping — the lighter model that does the small jobs."
          staged={choresStaged}
          highlighted={highlighted !== null && highlighted.startsWith('route:') && (CHORES_CLASSES as readonly string[]).includes(highlighted.slice(6))}
        >
          {!perTurnModel ? (
            <Alert tone="attention" data-testid="chores-not-applied">
              Saved here but not applied: the active runtime doesn&apos;t honor per-turn model overrides, so background chores run on the agent model.
            </Alert>
          ) : null}
          {chores.mixed ? (
            <Stack gap="dense">
              <div className="flex flex-wrap items-center gap-bakin-2">
                <Badge tone="attention" variant="outline" data-testid="chores-mixed">Mixed ({chores.models.length} model{chores.models.length === 1 ? '' : 's'}{chores.thinkingSet ? ', thinking set' : ''})</Badge>
              </div>
              <Field name="lane-chores-set-all">
                <FieldLabel htmlFor="lane-chores-set-all">Set all to</FieldLabel>
                <ModelSelect
                  id="lane-chores-set-all"
                  value={DEFAULT_MODEL_VALUE}
                  onValueChange={(value) => sel.stageAll(setAllChoresOps(value === DEFAULT_MODEL_VALUE ? null : value))}
                  models={modelOptions}
                  defaultLabel="Choose a model…"
                  className="w-full min-w-0"
                />
                <FieldDescription>Sets the five chores to one model; per-chore thinking levels stay as they are.</FieldDescription>
              </Field>
            </Stack>
          ) : (
            <Field name="lane-chores-model">
              <FieldLabel htmlFor="lane-chores-model">Model{choresStaged ? ' (unsaved)' : ''}</FieldLabel>
              <ModelSelect
                id="lane-chores-model"
                value={chores.explicit && chores.model ? chores.model : DEFAULT_MODEL_VALUE}
                onValueChange={(value) => sel.stageAll(setAllChoresOps(value === DEFAULT_MODEL_VALUE ? null : value))}
                models={modelOptions}
                defaultLabel={`Same as the agent model${agent.model ? ` (${agent.model})` : ''}`}
                className="w-full min-w-0"
              />
              {plan?.recommended.chores.model && plan.recommended.chores.model !== chores.model ? (
                <FieldDescription>Recommended: {plan.recommended.chores.model} — {plan.recommended.chores.why}</FieldDescription>
              ) : null}
            </Field>
          )}
          {CHORES_CLASSES.map((workClass) => (
            <SelectionCallout key={workClass} sel={sel} refName={`route:${workClass}`} />
          ))}
        </PlanLane>
      </Grid>

      {plan ? (
        <Section spacing="compact" aria-labelledby="recommended-plan-heading">
          <div className="flex flex-wrap items-center justify-between gap-bakin-3">
            <Stack gap="dense">
              <h2 id="recommended-plan-heading">Recommended plan</h2>
              <Text size="meta" tone="muted">
                {recommendedOps.length === 0
                  ? 'You are on the recommended plan.'
                  : `${recommendedOps.length} change${recommendedOps.length === 1 ? '' : 's'} would bring you onto it — review before anything is staged.`}
              </Text>
            </Stack>
            {recommendedOps.length > 0 ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setPlanOpen(true)}>Use recommended plan</Button>
            ) : null}
          </div>
          {plan.recommended.notes.map((note) => (
            <Text key={note} size="meta" tone="muted">{note}</Text>
          ))}
        </Section>
      ) : null}

      {sel.customizations.length > 0 ? (
        <Text size="meta" tone="muted" data-testid="customizations-line">
          {sel.customizations.length} customization{sel.customizations.length === 1 ? '' : 's'} active ({sel.customizations.map((c) => c.detail).join('; ')}).{' '}
          <Button type="button" variant="link" size="xs" onClick={onAdvanced}>View in Advanced</Button>
        </Text>
      ) : null}

      <ResetToPlan sel={sel} />

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
