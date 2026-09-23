'use client'

/**
 * "Reset to this plan" (spec §3.4, S6): the consequence-first destructive
 * flow of `Recipes/Destructive settings flow` — a section that names what
 * goes away, one button, and a ConfirmDialog gated on typed confirmation
 * that lists every change and every clear the runtime cannot do. Immediate
 * on confirm through `POST /selections` with `snapshot: 'reset'` (undo =
 * `bakin models restore <file>`); refused while the page holds an unsaved
 * draft, because a reset over unsaved edits could never be undone exactly.
 */
import { useState } from 'react'
import { ConfirmDialog, KeyValue, type KeyValueItem } from '@makinbakin/sdk/patterns'
import { Section, Stack } from '@makinbakin/sdk/layout'
import { Button, Text } from '@makinbakin/sdk/ui'

import { buildResetOps, choresLane } from '../lib/simple'
import type { SelectionsData } from './use-selections'

/** "anthropic/claude-opus-4-6 · medium thinking" — what a setting holds today, in the words the page uses. */
function describeBefore(state: { model: string | null; thinking?: string }): string {
  const parts: string[] = []
  if (state.model) parts.push(state.model)
  if (state.thinking && state.thinking !== 'inherit') parts.push(`${state.thinking} thinking`)
  return parts.join(' · ') || 'unset'
}

export function ResetToPlan({ sel }: { sel: SelectionsData }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The snapshot written before the FIRST attempt — the only handle that
  // restores the configuration as it was. A retry after a partial reset
  // never asks for another one (that would snapshot an already half-cleared
  // state and bury the real undo point).
  const [snapshot, setSnapshot] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const selections = sel.selections
  // Once nothing is customized the section only lingers to show the undo handle.
  if (!selections || (sel.customizations.length === 0 && !done)) return null

  const lane = choresLane(sel.effective)
  const chores = lane.mixed ? null : lane.explicit ? lane.model : null
  const { ops, skipped } = buildResetOps(selections.states, selections.support, { chores })
  const agent = sel.effective('policy:defaultModel').model
  // Each change by the setting's label with its before-value — the reader
  // confirms what goes away, never a ref they have to decode.
  const byRef = new Map(selections.states.map((s) => [s.ref, s]))
  const items: KeyValueItem[] = [
    { label: 'Agent model', value: agent ?? 'Not set', mono: true },
    { label: 'Background chores', value: chores ?? `Same as the agent model${lane.mixed ? ' (the lanes were mixed)' : ''}`, mono: chores !== null },
    ...ops.map((op) => {
      const state = byRef.get(op.ref)
      const after = op.set.model === undefined
        ? `${state?.model ?? 'unset'} (thinking cleared)`
        : op.set.model === null ? 'cleared' : op.set.model
      return { label: state?.label ?? op.ref, value: `${state ? describeBefore(state) : 'unset'} → ${after}`, mono: true }
    }),
    ...skipped.map((s) => ({ label: `Kept ${s.label}`, value: s.reason })),
  ]

  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      const outcome = await sel.submit(ops, snapshot ? undefined : { snapshot: 'reset' })
      const handle = snapshot ?? outcome.snapshot ?? null
      if (handle && !snapshot) setSnapshot(handle)
      if (outcome.failed.length > 0) {
        const undo = handle ? ` The snapshot written before the first attempt still restores everything: \`bakin models restore ${handle}\`.` : ''
        setError(`${outcome.failed.length} change${outcome.failed.length === 1 ? '' : 's'} could not be written: ${outcome.failed.map((f) => `${f.ref} — ${f.message}`).join('; ')}.${undo}`)
        // Re-read so a retry lists only what is still customized.
        await sel.reload()
        return
      }
      setDone(handle)
      setOpen(false)
      await sel.reload()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Section spacing="compact" divider="top" aria-labelledby="reset-plan-heading">
      <div className="flex flex-wrap items-center justify-between gap-bakin-3">
        <Stack gap="dense">
          <h2 id="reset-plan-heading">Reset to this plan</h2>
          {sel.customizations.length > 0 ? (
            <Text size="meta" tone="muted">
              Clears the {sel.customizations.length} customization{sel.customizations.length === 1 ? '' : 's'} above so every agent and job follows the two lanes. A snapshot is saved first; <code>bakin models restore</code> undoes it.
            </Text>
          ) : null}
          {sel.dirty ? <Text size="meta" tone="muted" data-testid="reset-blocked">Save or discard your unsaved changes first.</Text> : null}
          {done ? <Text size="meta" tone="muted" role="status">Reset applied. Undo with <code>bakin models restore {done}</code>.</Text> : null}
        </Stack>
        {ops.length > 0 ? (
          <Button type="button" variant="outline" size="sm" disabled={sel.dirty} onClick={() => setOpen(true)}>
            Reset to this plan…
          </Button>
        ) : null}
      </div>
      <ConfirmDialog
        open={open}
        title="Reset every customization to this plan?"
        description={`${ops.length} change${ops.length === 1 ? '' : 's'} apply immediately. A snapshot is written first so the reset can be undone.`}
        confirmLabel="Reset"
        busyLabel="Resetting…"
        confirmTone="danger"
        confirmValue="reset"
        confirmPrompt="Type reset to confirm"
        busy={busy}
        error={error ?? undefined}
        onConfirm={() => void confirm()}
        onCancel={() => { if (!busy) { setOpen(false); setError(null) } }}
      >
        <KeyValue aria-label="Reset changes" layout="rows" items={items} />
      </ConfirmDialog>
    </Section>
  )
}
