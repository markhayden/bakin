'use client'

import { useEffect, useState } from 'react'
import { pluginFetchJson } from '@makinbakin/sdk/utils'
import { Grid, Stack } from '@makinbakin/sdk/layout'
import { StatTile } from '@makinbakin/sdk/patterns'
import {
  Alert,
  AlertDescription,
  Button,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  Fieldset,
  FieldsetDescription,
  FieldsetLegend,
  Input,
  Radio,
  RadioGroup,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Skeleton,
  Switch,
  Text,
} from '@makinbakin/sdk/ui'

import type { BudgetRuleWire, CoverageWire, LimitSuggestionWire, WindowSpendWire } from '../types'
import { formatTokens, formatUsd, parseCapInput } from './spend-utils'

/** What the dialog hands back: one rule identity (scope + lane) with its caps (merged onto the existing rule of that identity when there is one; the server assigns ids). */
export type LimitDraft = Pick<BudgetRuleWire, 'scope' | 'scopeId' | 'lane' | 'monthlyCap' | 'dailyCap' | 'atCap'>

type GuidedScope = 'global' | 'agent' | 'provider'

/** Observed spend for the chosen scope on a coverage window — the basis the dialog shows. */
function scopeSums(window: WindowSpendWire, scope: GuidedScope, scopeId: string): { meteredUsdMicros: number; subscriptionTokens: number } {
  if (scope === 'global') {
    return { meteredUsdMicros: window.global.meteredUsdMicros + window.global.unattributed.meteredUsdMicros, subscriptionTokens: window.global.subscriptionTokens + window.global.unattributed.subscriptionTokens }
  }
  if (scope === 'agent') {
    const bucket = window.byAgent[scopeId]
    return bucket ? { meteredUsdMicros: bucket.meteredUsdMicros + bucket.unattributed.meteredUsdMicros, subscriptionTokens: bucket.subscriptionTokens + bucket.unattributed.subscriptionTokens } : { meteredUsdMicros: 0, subscriptionTokens: 0 }
  }
  const bucket = window.byProvider[scopeId]
  return bucket ? { meteredUsdMicros: bucket.meteredUsdMicros, subscriptionTokens: bucket.subscriptionTokens } : { meteredUsdMicros: 0, subscriptionTokens: 0 }
}

function ScopeIdSelect({ label, value, options, placeholder, onValueChange }: { label: string; value: string; options: ReadonlyArray<{ value: string; label: string }>; placeholder: string; onValueChange: (value: string) => void }) {
  return (
    <Select value={value || null} onValueChange={(next) => onValueChange(next ?? '')}>
      <SelectTrigger aria-label={label} className="w-full min-w-0">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * The guided "Add a limit" flow (spec §6, D27): what you spend on the days
 * Bakin watched, then a monthly limit prefilled from that — or the honest
 * reason there is no prefill yet. Everything (global), one agent or one
 * provider; metered dollars or subscription tokens (Bakin's own usage, never
 * the provider's allowance). Pattern: overlays/dialog — Decision, with
 * forms/form-composition Fieldset + primitives/radio-group composition. The
 * whole action lives in the modal; nothing inline on the page.
 */
export function LimitDialog({
  open,
  onOpenChange,
  onSave,
  saving = false,
  error = null,
  agents = [],
  providers = [],
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Persist the drafted rule; resolves when the server answered. */
  onSave: (draft: LimitDraft) => Promise<void>
  saving?: boolean
  /** A rejected save, rendered inside the dialog. */
  error?: string | null
  /** The roster, for a per-agent limit. */
  agents?: ReadonlyArray<{ agentId: string; name: string }>
  /** Providers the catalog knows, for a per-provider limit. */
  providers?: readonly string[]
}) {
  const [coverage, setCoverage] = useState<CoverageWire | null>(null)
  const [coverageError, setCoverageError] = useState<string | null>(null)
  const [scope, setScope] = useState<GuidedScope>('global')
  const [scopeId, setScopeId] = useState('')
  const [lane, setLane] = useState<'metered' | 'subscription'>('metered')
  const [monthly, setMonthly] = useState('')
  const [dailyOn, setDailyOn] = useState(false)
  const [daily, setDaily] = useState('')
  const [reaction, setReaction] = useState<'defer' | 'pause'>('defer')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const [scopeError, setScopeError] = useState<string | null>(null)
  const [dailyError, setDailyError] = useState<string | null>(null)
  const unit = lane === 'metered' ? 'USD' : 'tokens'
  // The server's suggestion is for everything-metered; any other identity gets its observed basis and no prefill.
  const suggested = scope === 'global' && lane === 'metered'

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    // Every opening starts from a clean draft — a dismissed dialog's numbers
    // must not reappear as if chosen.
    setCoverage(null)
    setCoverageError(null)
    setFieldError(null)
    setScopeError(null)
    setDailyError(null)
    setScope('global')
    setScopeId('')
    setLane('metered')
    setMonthly('')
    setDailyOn(false)
    setDaily('')
    setReaction('defer')
    pluginFetchJson<CoverageWire>('spend', 'coverage', { label: 'Coverage', timeoutMs: 20_000, signal: controller.signal })
      .then((data) => {
        setCoverage(data)
        // The suggestion is a PREFILL: it fills an empty field and never
        // clobbers a number the operator typed while the read was in flight.
        if (data.suggestion.status === 'ready') setMonthly((current) => (current.trim() === '' ? String(data.suggestion.status === 'ready' ? data.suggestion.monthlyUsd : '') : current))
      })
      .catch((err: unknown) => {
        if ((err as { name?: string }).name === 'AbortError') return
        setCoverageError(err instanceof Error ? err.message : String(err))
      })
    return () => controller.abort()
  }, [open])

  const submit = async () => {
    if (scope !== 'global' && !scopeId) {
      setScopeError(scope === 'agent' ? 'Choose the agent this limit applies to.' : 'Choose the provider this limit applies to.')
      return
    }
    setScopeError(null)
    const monthlyCap = parseCapInput(monthly)
    if (monthlyCap === undefined || monthlyCap <= 0) {
      setFieldError(lane === 'metered' ? 'Enter a monthly limit in dollars.' : 'Enter a monthly limit in tokens (k or M suffixes work).')
      return
    }
    setFieldError(null)
    const dailyCap = dailyOn ? parseCapInput(daily) : undefined
    if (dailyOn && (dailyCap === undefined || dailyCap <= 0)) {
      setDailyError(lane === 'metered' ? 'Enter a daily limit in dollars, or turn the daily limit off.' : 'Enter a daily limit in tokens, or turn the daily limit off.')
      return
    }
    setDailyError(null)
    await onSave({
      scope,
      ...(scope !== 'global' ? { scopeId } : {}),
      lane,
      monthlyCap,
      ...(dailyOn && dailyCap !== undefined ? { dailyCap } : {}),
      atCap: reaction,
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} busy={saving}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a spending limit</DialogTitle>
          <DialogDescription>
            Bakin records everything already. A limit only adds notifications on the way up and a stop at the line.
          </DialogDescription>
        </DialogHeader>

        <Stack gap="section">
          <Fieldset>
            <FieldsetLegend>1. What to limit</FieldsetLegend>
            <FieldsetDescription>
              One limit per scope and lane — everything, one agent or one provider; metered dollars or subscription tokens.
            </FieldsetDescription>
            <Stack gap="item">
              <Stack gap="dense">
                <Text as="p" id="limit-scope-label" size="body" weight="medium">Scope</Text>
                <RadioGroup aria-labelledby="limit-scope-label" value={scope} onValueChange={(value) => { setScope(value === 'agent' ? 'agent' : value === 'provider' ? 'provider' : 'global'); setScopeId(''); setScopeError(null) }}>
                  <label className="flex items-center gap-bakin-2"><Radio value="global" />Everything</label>
                  <label className="flex items-center gap-bakin-2"><Radio value="agent" />One agent</label>
                  <label className="flex items-center gap-bakin-2"><Radio value="provider" />One provider</label>
                </RadioGroup>
              </Stack>
              {scope !== 'global' ? (
                <Field name="limit-scope-id" invalid={Boolean(scopeError)}>
                  <FieldLabel>{scope === 'agent' ? 'Agent' : 'Provider'}</FieldLabel>
                  <ScopeIdSelect
                    label={scope === 'agent' ? 'Limit agent' : 'Limit provider'}
                    value={scopeId}
                    placeholder={scope === 'agent' ? 'Choose an agent' : 'Choose a provider'}
                    options={scope === 'agent'
                      ? agents.map((agent) => ({ value: agent.agentId, label: agent.name }))
                      : providers.map((provider) => ({ value: provider, label: provider }))}
                    onValueChange={(next) => { setScopeId(next); setScopeError(null) }}
                  />
                  {scopeError ? <FieldError match>{scopeError}</FieldError> : null}
                </Field>
              ) : null}
              <Stack gap="dense">
                <Text as="p" id="limit-lane-label" size="body" weight="medium">What to count</Text>
                <RadioGroup aria-labelledby="limit-lane-label" value={lane} onValueChange={(value) => { setLane(value === 'subscription' ? 'subscription' : 'metered'); setMonthly(''); setDaily(''); setFieldError(null); setDailyError(null) }}>
                  <label className="flex items-center gap-bakin-2"><Radio value="metered" />Metered dollars (API keys)</label>
                  <label className="flex items-center gap-bakin-2"><Radio value="subscription" />Subscription tokens (plan logins)</label>
                </RadioGroup>
                {lane === 'subscription' ? (
                  <Text size="meta" tone="muted" as="p">A token limit caps Bakin's own usage on that plan — it is not your provider's allowance.</Text>
                ) : null}
              </Stack>
            </Stack>
          </Fieldset>

          <section aria-labelledby="limit-dialog-basis">
            <Stack gap="dense">
              <Text as="h3" id="limit-dialog-basis" size="body" weight="semibold">2. What you spend</Text>
              {coverageError ? (
                <Alert tone="danger"><AlertDescription>Spend history could not be read: {coverageError}</AlertDescription></Alert>
              ) : coverage ? (
                <CoverageBasis coverage={coverage} scope={scope} scopeId={scopeId} lane={lane} />
              ) : (
                <Grid layout="split" gap="dense" aria-hidden="true">
                  <Skeleton className="h-bakin-8 w-full" />
                  <Skeleton className="h-bakin-8 w-full" />
                </Grid>
              )}
            </Stack>
          </section>

          <Fieldset>
            <FieldsetLegend>3. Set a limit</FieldsetLegend>
            <FieldsetDescription>
              {lane === 'metered'
                ? 'Limits are checked against recorded metered spend; work already running can finish past the line.'
                : 'Limits are checked against recorded subscription tokens; work already running can finish past the line.'}
            </FieldsetDescription>
            <Stack gap="item">
              <Field name="limit-monthly" invalid={Boolean(fieldError)}>
                <FieldLabel>Monthly limit ({unit})</FieldLabel>
                <Input
                  inputMode="decimal"
                  placeholder={lane === 'metered' ? 'Dollars per month' : 'Tokens per month (k or M)'}
                  value={monthly}
                  onChange={(event) => setMonthly(event.currentTarget.value)}
                />
                {coverage ? (
                  <FieldDescription>
                    {suggested
                      ? suggestionCopy(coverage.suggestion)
                      : 'No suggested number for a scoped or token limit — set it from the observed figures above.'}
                  </FieldDescription>
                ) : null}
                {fieldError ? <FieldError match>{fieldError}</FieldError> : null}
              </Field>

              <Field orientation="horizontal" name="limit-daily-on">
                <Switch checked={dailyOn} onCheckedChange={(checked) => setDailyOn(Boolean(checked))} />
                <FieldLabel>Also cap each day</FieldLabel>
                <FieldDescription>Useful when one runaway day matters more than the month.</FieldDescription>
              </Field>
              {dailyOn ? (
                <Field name="limit-daily" invalid={Boolean(dailyError)}>
                  <FieldLabel>Daily limit ({unit})</FieldLabel>
                  <Input inputMode="decimal" placeholder={lane === 'metered' ? 'Dollars per day' : 'Tokens per day (k or M)'} value={daily} onChange={(event) => setDaily(event.currentTarget.value)} />
                  {dailyError ? <FieldError match>{dailyError}</FieldError> : null}
                </Field>
              ) : null}

              {/* Option rows are composition (primitives/radio-group): each Radio
                  keeps its own visible label; a Field wrapper would relabel every
                  radio with the group title. */}
              <Stack gap="dense">
                <Text as="p" id="limit-reaction-label" size="body" weight="medium">When the limit is reached</Text>
                <RadioGroup aria-labelledby="limit-reaction-label" value={reaction} onValueChange={(value) => setReaction(value === 'pause' ? 'pause' : 'defer')}>
                  <label className="flex items-center gap-bakin-2">
                    <Radio value="defer" />
                    Wait for the next period
                  </label>
                  <label className="flex items-center gap-bakin-2">
                    <Radio value="pause" />
                    Pause matching work until I raise or resume
                  </label>
                </RadioGroup>
              </Stack>

              <Text size="meta" tone="muted" as="p">
                You'll be notified at 50%, 75%, 90% and when the limit is reached.
              </Text>
            </Stack>
          </Fieldset>

          {error ? <Alert tone="danger"><AlertDescription>{error}</AlertDescription></Alert> : null}
        </Stack>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button busy={saving} disabled={saving} onClick={() => void submit()}>Save limit</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CoverageBasis({ coverage, scope, scopeId, lane }: { coverage: CoverageWire; scope: GuidedScope; scopeId: string; lane: 'metered' | 'subscription' }) {
  const covered = scopeSums(coverage.covered.window, scope, scopeId)
  const uncovered = scopeSums(coverage.uncovered.window, scope, scopeId)
  const observed = lane === 'metered' ? covered.meteredUsdMicros : covered.subscriptionTokens
  const unobserved = lane === 'metered' ? uncovered.meteredUsdMicros : uncovered.subscriptionTokens
  const fmt = (value: number) => (lane === 'metered' ? formatUsd(value) : `${formatTokens(value)} tokens`)
  const days = coverage.coveredDays.length
  const who = scope === 'global' ? '' : scopeId ? ` · ${scopeId}` : scope === 'agent' ? ' · choose an agent' : ' · choose a provider'
  return (
    <Grid layout="split" gap="dense" role="group" aria-label="Observed spend basis">
      <StatTile
        variant="surface"
        label={`Last ${coverage.lookbackDays} days · observed${who}`}
        value={fmt(observed)}
        sub={`${days} of ${coverage.lookbackDays} days watched${days > 0 ? ` · ${fmt(Math.round(observed / days))}/day` : ''}`}
      />
      <StatTile
        variant="surface"
        label="On unobserved days"
        value={unobserved > 0 ? fmt(unobserved) : '—'}
        sub={unobserved > 0 ? 'Recorded while Bakin was not watching — not in the rate' : 'Nothing recorded outside watched days'}
      />
    </Grid>
  )
}

function suggestionCopy(suggestion: LimitSuggestionWire): string {
  switch (suggestion.status) {
    case 'ready':
      return `Suggested $${suggestion.monthlyUsd}: about 1.5× your observed rate over ${suggestion.basis.coveredDays} watched days, rounded.`
    case 'insufficient_history':
      return `Not enough observed history yet — enter a number, or come back in ${suggestion.daysNeeded} day${suggestion.daysNeeded === 1 ? '' : 's'}.`
    case 'evidence_incomplete':
      return 'Some spend on watched days could not be priced, so no number is suggested — Health names the gaps.'
    case 'no_metered_spend':
      return `No metered spend was recorded in this period${suggestion.subscriptionTokens > 0 ? ` (${formatTokens(suggestion.subscriptionTokens)} subscription tokens)` : ''}. A dollar limit would only apply if metered usage appears; you can limit subscription tokens instead in the rule editor — that caps Bakin's usage, it is not your provider's allowance.`
  }
}
