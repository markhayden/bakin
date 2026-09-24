'use client'

/**
 * The ladder's 90% and cap attention as toasts the operator has to close
 * (decision 2026-09-23: no header bars, no auto-dismiss). One persistent
 * toast per unacknowledged 90% row and per open cap incident, derived from
 * the same durable rows as the badge: created when a row appears,
 * dismissed when it was handled elsewhere (another tab, the Spend page,
 * rollover), and CLOSING one acknowledges it — the kit toast's own close
 * control is the Dismiss/Acknowledge the bars used to carry, detected by
 * watching the toast id leave the store.
 */
import { useEffect, useRef, useState } from 'react'
import { emitPluginEvent, toast, useToastStore } from '@makinbakin/sdk/hooks'
import { PluginLink } from '@makinbakin/sdk/navigation'
import { Button } from '@makinbakin/sdk/ui'
import { pluginFetch } from '@makinbakin/sdk/utils'

import { refusalMessage } from '../lib/refusal-message'
import { capBars, formatValue, scopeLabel, warningBars, type LiveMilestoneRow, type OpenIncidentRow } from './attention'

type Tracked = { id: string; kind: 'warning'; row: LiveMilestoneRow } | { id: string; kind: 'cap'; row: OpenIncidentRow }

export function warningToastCopy(row: LiveMilestoneRow): { title: string; message: string } {
  return {
    title: `90% of your ${row.window} limit`,
    message: `${formatValue(row.unit, row.spentValue)} of ${formatValue(row.unit, row.capValue)} — work stops at the line. Close to acknowledge.`,
  }
}

export function capToastCopy(row: OpenIncidentRow): { title: string; message: string } {
  return {
    title: `${row.window} limit reached`,
    message: `${scopeLabel(row.scope, row.scopeId)} · ${formatValue(row.unit, row.spentValue)} of ${formatValue(row.unit, row.capValue)} ${row.lane}${
      row.atCap === 'pause' ? ' — matching work is paused until you act.' : ' — matching work waits for the next period.'
    } Close to acknowledge.`,
  }
}

/**
 * A cap toast's actions: Raise limit (→ Limits), and for a pause rule
 * Resume as-is — which the server refuses while spend is still over the cap
 * (409); the link then reads "Raise limit to resume" and carries the reason.
 */
export function CapToastActions({ row, onResolved }: { row: OpenIncidentRow; onResolved: () => void }) {
  const [busy, setBusy] = useState(false)
  const [stillOver, setStillOver] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const resume = async () => {
    setBusy(true)
    setFailure(null)
    try {
      const res = await pluginFetch('spend', `incidents/${row.id}/resolve`, { method: 'POST', body: { action: 'resume' } })
      if (res.status === 409) { setStillOver(true); setFailure(await refusalMessage(res, 'Spend is still at or over this limit — raise the limit to resume.')); return }
      if (!res.ok) { setFailure(await refusalMessage(res, `Could not resume (${res.status}).`)); return }
      onResolved()
    } catch (err) {
      setFailure(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-bakin-2">
      <PluginLink to="/spend?tab=limits" className="underline-offset-4 hover:underline">
        {stillOver ? 'Raise limit to resume' : 'Raise limit'}
      </PluginLink>
      {row.atCap === 'pause' && !stillOver ? (
        <Button type="button" size="xs" variant="danger" onClick={() => void resume()} disabled={busy}>
          {busy ? 'Resuming…' : 'Resume as-is'}
        </Button>
      ) : null}
      {failure ? <span role="alert" className="text-bakin-text-muted">{failure}</span> : null}
    </span>
  )
}

function keyOf(item: { kind: 'warning'; row: LiveMilestoneRow } | { kind: 'cap'; row: OpenIncidentRow }): string {
  return item.kind === 'warning' ? `warn-${item.row.id}` : `cap-${item.row.id}-${item.row.eventId}`
}

/** Keep the store's ladder toasts equal to the live rows, and turn a user close into the acknowledgement it means. */
export function useLadderToasts(rows: LiveMilestoneRow[], incidents: OpenIncidentRow[], refresh: () => void): void {
  const tracked = useRef(new Map<string, Tracked>())

  useEffect(() => {
    const desired = new Map<string, { kind: 'warning'; row: LiveMilestoneRow } | { kind: 'cap'; row: OpenIncidentRow }>()
    for (const row of warningBars(rows)) desired.set(keyOf({ kind: 'warning', row }), { kind: 'warning', row })
    for (const row of capBars(incidents)) desired.set(keyOf({ kind: 'cap', row }), { kind: 'cap', row })
    const store = useToastStore.getState()
    // Handled elsewhere (acknowledged on another tab, resolved, rolled over):
    // untrack FIRST so the store watcher below reads the dismissal as ours.
    for (const [key, item] of [...tracked.current]) {
      if (desired.has(key)) continue
      tracked.current.delete(key)
      store.dismiss(item.id)
    }
    for (const [key, item] of desired) {
      if (tracked.current.has(key)) continue
      const copy = item.kind === 'warning' ? warningToastCopy(item.row) : capToastCopy(item.row)
      const id = store.add({
        type: item.kind === 'warning' ? 'info' : 'error',
        title: copy.title,
        message: copy.message,
        action: item.kind === 'warning'
          ? <PluginLink to="/spend" className="underline-offset-4 hover:underline">Review</PluginLink>
          : <CapToastActions row={item.row} onResolved={refresh} />,
        persistent: true,
      })
      tracked.current.set(key, item.kind === 'warning' ? { id, kind: 'warning', row: item.row } : { id, kind: 'cap', row: item.row })
    }
  }, [rows, incidents, refresh])

  // A tracked toast that leaves the store without being untracked was closed
  // by the operator: that close IS the acknowledgement.
  useEffect(() => useToastStore.subscribe((state) => {
    const live = new Set(state.toasts.map((t) => t.id))
    for (const [key, item] of [...tracked.current]) {
      if (live.has(item.id)) continue
      tracked.current.delete(key)
      void acknowledge(item, refresh)
    }
  }), [refresh])
}

async function acknowledge(item: Tracked, refresh: () => void): Promise<void> {
  try {
    const res = item.kind === 'warning'
      ? await pluginFetch('spend', `milestones/${item.row.id}/ack`, { method: 'POST' })
      : await pluginFetch('spend', `incidents/${item.row.id}/resolve`, { method: 'POST', body: { action: 'ack' } })
    if (!res.ok) {
      // The row is still live: say so (briefly — this one may auto-dismiss) and re-derive.
      toast(await refusalMessage(res, `Could not acknowledge (${res.status}).`), 'error')
    } else if (item.kind === 'warning') {
      emitPluginEvent({ event: 'spend.milestone_acknowledged', milestoneId: item.row.id })
    }
  } catch (err) {
    toast(err instanceof Error ? err.message : String(err), 'error')
  }
  refresh()
}
