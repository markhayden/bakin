'use client'

import { AlertTriangle } from 'lucide-react'
import { Button, Input, Skeleton, Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@makinbakin/sdk/ui"
import { EmptyState } from "@makinbakin/sdk/components"
import type { ModelsData } from './use-models-data'

const SPEND_WINDOWS = [
  { id: '24h', label: '24h' },
  { id: '7d', label: '7 days' },
  { id: '30d', label: '30 days' },
  { id: 'all', label: 'All time' },
] as const

/** Render micro-dollars as a dollar amount. Returns null for an unmetered
 *  (zero-cost) row so the UI can show "$ unavailable" instead of "$0.00". */
function formatUsdMicros(micros: number): string | null {
  if (!micros) return null
  return `$${(micros / 1_000_000).toFixed(micros < 10_000 ? 4 : 2)}`
}

export function SpendTab({ m }: { m: ModelsData }) {
  const { spendWindow, setSpendWindow, spend, spendLoading, pendingBudget, setPendingBudget, saveBudget, saving, budget } = m

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Estimated spend from recorded token usage. Cached-token discounts aren&apos;t modeled, so totals read slightly high — treat as estimates, not an invoice.
        </p>
        <div className="flex items-center gap-1">
          {SPEND_WINDOWS.map((w) => (
            <Button
              key={w.id}
              variant={spendWindow === w.id ? 'default' : 'outline'}
              size="xs"
              onClick={() => setSpendWindow(w.id)}
            >
              {w.label}
            </Button>
          ))}
        </div>
      </div>

      {spendLoading && !spend ? (
        <Skeleton className="h-32 w-full" />
      ) : !spend ? (
        <EmptyState icon={AlertTriangle} title="Spend data unavailable" />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-border bg-card p-4">
              <div className="text-xs text-muted-foreground">Estimated total ({spend.window})</div>
              <div className="text-2xl font-semibold tabular-nums">
                {formatUsdMicros(spend.totalUsdMicros) ?? '$ unavailable'}
              </div>
            </div>

            <div className="rounded-xl border border-border bg-card p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs text-muted-foreground">Budget caps (global)</div>
                {pendingBudget ? (
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="xs" onClick={() => setPendingBudget(null)}>Discard</Button>
                    <Button size="xs" onClick={saveBudget} disabled={saving === 'budget'}>{saving === 'budget' ? 'Saving...' : 'Save'}</Button>
                  </div>
                ) : null}
              </div>
              <div className="flex items-center gap-3">
                <label className="flex-1 text-xs text-muted-foreground">
                  Daily $
                  <Input
                    type="number" min="0" className="mt-1 h-8 text-sm"
                    value={(pendingBudget ?? budget).global?.dailyUsd ?? ''}
                    onChange={(e) => setPendingBudget({ ...(pendingBudget ?? budget), global: { ...(pendingBudget ?? budget).global, dailyUsd: e.target.value ? Number(e.target.value) : undefined } })}
                  />
                </label>
                <label className="flex-1 text-xs text-muted-foreground">
                  Monthly $
                  <Input
                    type="number" min="0" className="mt-1 h-8 text-sm"
                    value={(pendingBudget ?? budget).global?.monthlyUsd ?? ''}
                    onChange={(e) => setPendingBudget({ ...(pendingBudget ?? budget), global: { ...(pendingBudget ?? budget).global, monthlyUsd: e.target.value ? Number(e.target.value) : undefined } })}
                  />
                </label>
              </div>
              <p className="text-[11px] text-muted-foreground">At 100% of a cap, dispatch defers new turns until the window resets. Leave blank for no limit.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div className="overflow-hidden rounded-xl border border-border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-card">
                    <TableHead>Agent</TableHead>
                    <TableHead className="text-right">Runs</TableHead>
                    <TableHead className="text-right">Est. cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {spend.byAgent.length === 0 ? (
                    <TableRow><TableCell colSpan={3} className="text-muted-foreground">No spend in this window</TableCell></TableRow>
                  ) : spend.byAgent.map((r) => (
                    <TableRow key={r.agent}>
                      <TableCell className="font-medium">{r.agent}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.runs}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatUsdMicros(r.costUsdMicros) ?? <span className="text-muted-foreground">$ unavailable</span>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="overflow-hidden rounded-xl border border-border">
              <Table>
                <TableHeader>
                  <TableRow className="bg-card">
                    <TableHead>Model</TableHead>
                    <TableHead className="text-right">Runs</TableHead>
                    <TableHead className="text-right">Est. cost</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {spend.byModel.length === 0 ? (
                    <TableRow><TableCell colSpan={3} className="text-muted-foreground">No spend in this window</TableCell></TableRow>
                  ) : spend.byModel.map((r) => (
                    <TableRow key={r.model}>
                      <TableCell className="font-medium">{r.model}</TableCell>
                      <TableCell className="text-right tabular-nums">{r.runs}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatUsdMicros(r.costUsdMicros) ?? <span className="text-muted-foreground">$ unavailable</span>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
