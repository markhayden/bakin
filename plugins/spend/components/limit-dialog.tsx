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
  Skeleton,
  Switch,
  Text,
} from '@makinbakin/sdk/ui'

import type { BudgetRuleWire, CoverageWire, LimitSuggestionWire } from '../types'
import { formatTokens, formatUsd, parseCapInput } from './spend-utils'

/** What the dialog hands back: one global metered rule, id-less (the server assigns it). */
export type LimitDraft = Pick<BudgetRuleWire, 'scope' | 'lane' | 'monthlyCap' | 'dailyCap' | 'atCap'>

/**
 * The guided "Add a limit" flow (spec §6, D27): what you spend on the days
 * Bakin watched, then a monthly limit prefilled from that — or the honest
 * reason there is no prefill yet. Pattern: overlays/dialog — Decision, with
 * forms/form-composition Fieldset + primitives/radio-group composition. The
 * whole action lives in the modal; nothing inline on the page.
 */
export function LimitDialog({
  open,
  onOpenChange,
  onSave,
  saving = false,
  error = null,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Persist the drafted rule; resolves when the server answered. */
  onSave: (draft: LimitDraft) => Promise<void>
  saving?: boolean
  /** A rejected save, rendered inside the dialog. */
  error?: string | null
}) {
  const [coverage, setCoverage] = useState<CoverageWire | null>(null)
  const [coverageError, setCoverageError] = useState<string | null>(null)
  const [monthly, setMonthly] = useState('')
  const [dailyOn, setDailyOn] = useState(false)
  const [daily, setDaily] = useState('')
  const [reaction, setReaction] = useState<'defer' | 'pause'>('defer')
  const [fieldError, setFieldError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setCoverage(null)
    setCoverageError(null)
    setFieldError(null)
    pluginFetchJson<CoverageWire>('spend', 'coverage', { label: 'Coverage', timeoutMs: 20_000, signal: controller.signal })
      .then((data) => {
        setCoverage(data)
        if (data.suggestion.status === 'ready') setMonthly(String(data.suggestion.monthlyUsd))
      })
      .catch((err: unknown) => {
        if ((err as { name?: string }).name === 'AbortError') return
        setCoverageError(err instanceof Error ? err.message : String(err))
      })
    return () => controller.abort()
  }, [open])

  const submit = async () => {
    const monthlyCap = parseCapInput(monthly)
    if (monthlyCap === undefined || monthlyCap <= 0) {
      setFieldError('Enter a monthly limit in whole dollars.')
      return
    }
    const dailyCap = dailyOn ? parseCapInput(daily) : undefined
    if (dailyOn && (dailyCap === undefined || dailyCap <= 0)) {
      setFieldError('Enter a daily limit in whole dollars, or turn the daily limit off.')
      return
    }
    setFieldError(null)
    await onSave({ scope: 'global', lane: 'metered', monthlyCap, ...(dailyOn && dailyCap !== undefined ? { dailyCap } : {}), atCap: reaction })
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
          <section aria-labelledby="limit-dialog-basis">
            <Stack gap="dense">
              <Text as="h3" id="limit-dialog-basis" size="body" weight="semibold">1. What you spend</Text>
              {coverageError ? (
                <Alert tone="danger"><AlertDescription>Spend history could not be read: {coverageError}</AlertDescription></Alert>
              ) : coverage ? (
                <CoverageBasis coverage={coverage} />
              ) : (
                <Grid layout="split" gap="dense" aria-hidden="true">
                  <Skeleton className="h-bakin-8 w-full" />
                  <Skeleton className="h-bakin-8 w-full" />
                </Grid>
              )}
            </Stack>
          </section>

          <Fieldset>
            <FieldsetLegend>2. Set a limit</FieldsetLegend>
            <FieldsetDescription>
              Limits are checked against recorded metered spend; work already running can finish past the line.
            </FieldsetDescription>
            <Stack gap="item">
              <Field name="limit-monthly" invalid={Boolean(fieldError)}>
                <FieldLabel>Monthly limit (USD)</FieldLabel>
                <Input
                  inputMode="decimal"
                  placeholder={coverage?.suggestion.status === 'ready' ? String(coverage.suggestion.monthlyUsd) : 'e.g. 100'}
                  value={monthly}
                  onChange={(event) => setMonthly(event.currentTarget.value)}
                />
                {coverage ? <FieldDescription>{suggestionCopy(coverage.suggestion)}</FieldDescription> : null}
                {fieldError ? <FieldError match>{fieldError}</FieldError> : null}
              </Field>

              <Field orientation="horizontal" name="limit-daily-on">
                <Switch checked={dailyOn} onCheckedChange={(checked) => setDailyOn(Boolean(checked))} />
                <FieldLabel>Also cap each day</FieldLabel>
                <FieldDescription>Useful when one runaway day matters more than the month.</FieldDescription>
              </Field>
              {dailyOn ? (
                <Field name="limit-daily">
                  <FieldLabel>Daily limit (USD)</FieldLabel>
                  <Input inputMode="decimal" placeholder="e.g. 10" value={daily} onChange={(event) => setDaily(event.currentTarget.value)} />
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

function CoverageBasis({ coverage }: { coverage: CoverageWire }) {
  const observed = coverage.covered.window.global.meteredUsdMicros + coverage.covered.window.global.unattributed.meteredUsdMicros
  const unobserved = coverage.uncovered.window.global.meteredUsdMicros + coverage.uncovered.window.global.unattributed.meteredUsdMicros
  const days = coverage.coveredDays.length
  return (
    <Grid layout="split" gap="dense" role="group" aria-label="Observed spend basis">
      <StatTile
        variant="surface"
        label={`Last ${coverage.lookbackDays} days · observed`}
        value={formatUsd(observed)}
        sub={`${days} of ${coverage.lookbackDays} days watched${days > 0 ? ` · ${formatUsd(Math.round(observed / days))}/day` : ''}`}
      />
      <StatTile
        variant="surface"
        label="On unobserved days"
        value={unobserved > 0 ? formatUsd(unobserved) : '—'}
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
