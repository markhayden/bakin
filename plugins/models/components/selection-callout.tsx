'use client'

/**
 * Per-selection callouts (spec §3.4, #907): a selection whose model cannot
 * run shows WHY (no credentials, rejected by the account, gone from the
 * catalog, runtime-unavailable) and, when the server proposed a repair,
 * one button that STAGES the proposal into the draft — never an immediate
 * write. `unknown` eligibility is information only (missing evidence is
 * not a defect). A ref with a staged change hides its callout: the user
 * already acted. `PendingChip` marks a ref whose adapter write has not
 * settled ("saving…"), or failed / conflicted on a prior boot.
 */
import { Alert, Badge, Button } from '@makinbakin/sdk/ui'

import type { SelectionsData } from './use-selections'

export function SelectionCallout({ sel, refName }: { sel: SelectionsData; refName: string }) {
  const state = sel.selections?.states.find((s) => s.ref === refName)
  const eligibility = state?.eligibility
  if (!state?.model || !eligibility || eligibility.status === 'eligible') return null
  if (sel.effective(refName).staged) return null
  if (eligibility.status === 'unknown') {
    return (
      <Alert tone="neutral" data-testid={`callout-${refName}`} data-callout="unknown">
        Could not verify that {state.model} can run here: {eligibility.detail}
      </Alert>
    )
  }
  const proposal = sel.selections?.proposals.find((p) => p.ref === refName)
  return (
    <Alert tone="danger" data-testid={`callout-${refName}`} data-callout="ineligible">
      <span>{state.model} cannot run here — {eligibility.detail}.</span>
      {proposal?.to ? (
        <Button type="button" variant="outline" size="xs" onClick={() => sel.stage(refName, { model: proposal.to })}>
          Use {proposal.to}
        </Button>
      ) : (
        <span> No eligible replacement is available — add credentials for a provider or pick another model.</span>
      )}
    </Alert>
  )
}

export function PendingChip({ sel, refName }: { sel: SelectionsData; refName: string }) {
  const pending = sel.pendingRefs.get(refName)
  if (!pending) return null
  const label = pending.state === 'unsettled' ? 'saving…' : pending.state === 'failed' ? 'not confirmed' : 'conflict'
  return (
    <Badge tone={pending.state === 'unsettled' ? 'attention' : 'danger'} variant="soft" size="xs" data-testid={`pending-${refName}`}>
      {label}
      {/* The detail reaches assistive tech too — a title tooltip is mouse-only. */}
      {pending.detail ? <span className="sr-only"> — {pending.detail}</span> : null}
    </Badge>
  )
}
