'use client'

import { useState } from 'react'
import { AlertTriangle, Plus, Trash2 } from 'lucide-react'
import { Button, Input, Skeleton, Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@makinbakin/sdk/ui"
import { EmptyState } from "@makinbakin/sdk/components"
import type { ModelsData } from './use-models-data'
import type { BudgetRuleWire, BudgetIncidentWire, WindowSpendWire, LaneSumsWire, ScopeSpendWire, SpendResponse } from './use-models-data'

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

function fmtTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`
  return String(tokens)
}

/** Value in a rule's unit → human string ($ for metered, tokens for subscription). */
function fmtUnit(lane: 'metered' | 'subscription', value: number, isMicros: boolean): string {
  if (lane === 'metered') return `$${((isMicros ? value / 1_000_000 : value)).toFixed(2)}`
  return `${fmtTokens(value)} tokens`
}

/** Spend for a rule's scope × lane out of the engine facets (display only —
 *  the same extraction the evaluator/gate use server-side). */
function ruleSpent(rule: BudgetRuleWire, w: WindowSpendWire): number {
  const bucket: ScopeSpendWire | LaneSumsWire | undefined =
    rule.scope === 'global' ? w.global
    : rule.scope === 'agent' ? w.byAgent[rule.scopeId ?? '']
    : rule.scope === 'provider' ? w.byProvider[rule.scopeId ?? '']
    : w.byModel[rule.scopeId ?? '']
  if (!bucket) return 0
  const unattr = (bucket as Partial<ScopeSpendWire>).unattributed
  return rule.lane === 'subscription'
    ? bucket.subscriptionTokens + (unattr?.subscriptionTokens ?? 0)
    : bucket.meteredUsdMicros + (unattr?.meteredUsdMicros ?? 0)
}

function UtilizationBar({ pct, warnPct }: { pct: number; warnPct: number }) {
  const color = pct >= 100 ? 'bg-red-500' : pct >= warnPct * 100 ? 'bg-amber-500' : 'bg-emerald-500'
  return (
    <div className="relative h-2 w-full overflow-hidden rounded bg-muted">
      <div className={`h-full ${color}`} style={{ width: `${Math.min(100, pct)}%` }} />
      {/* warn threshold marker */}
      <div className="absolute top-0 h-full w-px bg-foreground/40" style={{ left: `${Math.min(100, warnPct * 100)}%` }} />
    </div>
  )
}

function ruleLabel(rule: BudgetRuleWire): string {
  const scope = rule.scope === 'global' ? 'Global' : `${rule.scope} ${rule.scopeId ?? ''}`
  return `${scope} · ${rule.lane}`
}

function UtilizationCards({ rules, spend }: { rules: BudgetRuleWire[]; spend: SpendResponse }) {
  const facets = spend.facets
  if (!facets || rules.length === 0) return null
  const cards: Array<{ key: string; rule: BudgetRuleWire; window: 'daily' | 'monthly'; cap: number; spent: number; pace: number | null; endsMs: number }> = []
  for (const rule of rules) {
    for (const window of ['daily', 'monthly'] as const) {
      const capRaw = window === 'daily' ? rule.dailyCap : rule.monthlyCap
      if (!capRaw) continue
      const cap = rule.lane === 'metered' ? capRaw * 1_000_000 : capRaw
      const w = window === 'daily' ? facets.daily : facets.monthly
      const spent = ruleSpent(rule, w)
      const paceW = window === 'daily' ? spend.pace?.daily : spend.pace?.monthly
      // Pace is only computed globally server-side; show it on global rules.
      const pace = rule.scope === 'global'
        ? (rule.lane === 'metered' ? paceW?.meteredUsdMicros ?? null : paceW?.subscriptionTokens ?? null)
        : null
      cards.push({ key: `${ruleLabel(rule)}:${window}`, rule, window, cap, spent, pace, endsMs: paceW?.endsMs ?? 0 })
    }
  }
  if (cards.length === 0) return null
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      {cards.map(({ key, rule, window, cap, spent, pace, endsMs }) => {
        const pct = cap > 0 ? (spent / cap) * 100 : 0
        const remaining = Math.max(0, cap - spent)
        return (
          <div key={key} className="rounded-xl border border-border bg-card p-3 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium">{ruleLabel(rule)} · {window}</span>
              <span className="tabular-nums text-muted-foreground">
                {fmtUnit(rule.lane, spent, rule.lane === 'metered')} of {fmtUnit(rule.lane, cap, rule.lane === 'metered')} ({Math.round(pct)}%)
              </span>
            </div>
            <UtilizationBar pct={pct} warnPct={rule.warnPct ?? 0.8} />
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{fmtUnit(rule.lane, remaining, rule.lane === 'metered')} remaining{endsMs ? ` · resets ${new Date(endsMs).toLocaleString()}` : ''}</span>
              {pace !== null ? (
                <span className={pace >= cap ? 'text-red-500' : ''}>
                  on pace for ~{fmtUnit(rule.lane, pace, rule.lane === 'metered')}
                </span>
              ) : null}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function IncidentBanner({ incidents, resolveIncident }: { incidents: BudgetIncidentWire[]; resolveIncident: ModelsData['resolveIncident'] }) {
  const [raiseValue, setRaiseValue] = useState<Record<number, string>>({})
  const [error, setError] = useState<string | null>(null)
  const live = incidents.filter((i) => i.status !== 'resolved')
  if (live.length === 0) return null
  return (
    <div className="rounded-xl border border-red-500/40 bg-red-500/5 p-3 space-y-2">
      <div className="flex items-center gap-2 text-sm font-medium text-red-500">
        <AlertTriangle className="h-4 w-4" />
        {live.length} open budget incident{live.length === 1 ? '' : 's'}
      </div>
      {error ? <div className="text-xs text-red-500">{error}</div> : null}
      {live.map((i) => (
        <div key={i.id} className="flex flex-wrap items-center gap-2 text-xs">
          <span className="tabular-nums">
            {i.scopeId ? `${i.scope} '${i.scopeId}'` : 'global'} · {i.window} · {i.lane} — {i.kind === 'cap' ? 'cap reached' : 'warning'} at{' '}
            {fmtUnit(i.lane, i.spentValue, i.unit === 'usd_micros')} of {fmtUnit(i.lane, i.capValue, i.unit === 'usd_micros')}
            {i.atCap === 'pause' && i.kind === 'cap' ? ' · PAUSED until resolved' : ''}
            {i.status === 'acknowledged' ? ' · acknowledged' : ''}
          </span>
          <span className="ml-auto flex items-center gap-1">
            <Input
              type="number" min="0" placeholder={i.lane === 'metered' ? 'new $ cap' : 'new token cap'}
              className="h-7 w-28 text-xs"
              value={raiseValue[i.id] ?? ''}
              onChange={(e) => setRaiseValue({ ...raiseValue, [i.id]: e.target.value })}
            />
            <Button
              size="xs"
              onClick={async () => {
                const cap = Number(raiseValue[i.id])
                if (!Number.isFinite(cap) || cap <= 0) { setError('Enter the new cap first'); return }
                setError(await resolveIncident(i.id, 'raise', cap))
              }}
            >
              Raise & resume
            </Button>
            {i.status === 'open' ? (
              <Button variant="outline" size="xs" onClick={async () => setError(await resolveIncident(i.id, 'ack'))}>Acknowledge</Button>
            ) : null}
            {i.atCap === 'pause' && i.kind === 'cap' ? (
              <Button variant="outline" size="xs" onClick={async () => setError(await resolveIncident(i.id, 'resume'))}>Resume as-is</Button>
            ) : null}
          </span>
        </div>
      ))}
    </div>
  )
}

const SCOPES = ['global', 'agent', 'provider'] as const

function RuleEditor({ m }: { m: ModelsData }) {
  const { budgetRules, pendingRules, setPendingRules, saveBudgetRules, saving } = m
  const rules = pendingRules ?? budgetRules
  const edit = (index: number, patch: Partial<BudgetRuleWire>) => {
    const next = rules.map((r, i) => (i === index ? { ...r, ...patch } : r))
    setPendingRules(next)
  }
  return (
    <div className="rounded-xl border border-border bg-card p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          Cap rules — metered caps are estimated USD; subscription caps are tokens (plan quota). At 100%: defer resumes at window reset; pause holds until you resolve.
        </div>
        <div className="flex items-center gap-2">
          {pendingRules ? (
            <>
              <Button variant="outline" size="xs" onClick={() => setPendingRules(null)}>Discard</Button>
              <Button size="xs" onClick={saveBudgetRules} disabled={saving === 'budget'}>{saving === 'budget' ? 'Saving...' : 'Save'}</Button>
            </>
          ) : null}
          <Button
            variant="outline" size="xs"
            onClick={() => setPendingRules([...rules, { scope: 'global', lane: 'metered' }])}
          >
            <Plus className="h-3 w-3" /> Rule
          </Button>
        </div>
      </div>
      {rules.length === 0 ? (
        <p className="text-xs text-amber-500">No budget rules — spend is uncapped.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="bg-card">
              <TableHead>Scope</TableHead>
              <TableHead>Id</TableHead>
              <TableHead>Lane</TableHead>
              <TableHead>Daily</TableHead>
              <TableHead>Monthly</TableHead>
              <TableHead>Warn %</TableHead>
              <TableHead>At cap</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {rules.map((r, i) => (
              <TableRow key={i}>
                <TableCell>
                  <select className="h-7 rounded border border-border bg-background text-xs" value={r.scope} onChange={(e) => edit(i, { scope: e.target.value as BudgetRuleWire['scope'], ...(e.target.value === 'global' ? { scopeId: undefined } : {}) })}>
                    {SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                </TableCell>
                <TableCell>
                  {r.scope === 'global' ? <span className="text-xs text-muted-foreground">—</span> : (
                    <Input className="h-7 w-28 text-xs" placeholder={r.scope === 'agent' ? 'agent id' : 'e.g. google'} value={r.scopeId ?? ''} onChange={(e) => edit(i, { scopeId: e.target.value || undefined })} />
                  )}
                </TableCell>
                <TableCell>
                  <select className="h-7 rounded border border-border bg-background text-xs" value={r.lane} onChange={(e) => edit(i, { lane: e.target.value as BudgetRuleWire['lane'] })}>
                    <option value="metered">metered ($)</option>
                    <option value="subscription">subscription (tokens)</option>
                  </select>
                </TableCell>
                <TableCell>
                  <Input type="number" min="0" className="h-7 w-24 text-xs" placeholder={r.lane === 'metered' ? '$' : 'tokens'} value={r.dailyCap ?? ''} onChange={(e) => edit(i, { dailyCap: e.target.value ? Number(e.target.value) : undefined })} />
                </TableCell>
                <TableCell>
                  <Input type="number" min="0" className="h-7 w-24 text-xs" placeholder={r.lane === 'metered' ? '$' : 'tokens'} value={r.monthlyCap ?? ''} onChange={(e) => edit(i, { monthlyCap: e.target.value ? Number(e.target.value) : undefined })} />
                </TableCell>
                <TableCell>
                  <Input type="number" min="1" max="100" className="h-7 w-16 text-xs" placeholder="80" value={r.warnPct !== undefined ? Math.round(r.warnPct * 100) : ''} onChange={(e) => edit(i, { warnPct: e.target.value ? Number(e.target.value) / 100 : undefined })} />
                </TableCell>
                <TableCell>
                  <select className="h-7 rounded border border-border bg-background text-xs" value={r.atCap ?? 'defer'} onChange={(e) => edit(i, { atCap: e.target.value as BudgetRuleWire['atCap'] })}>
                    <option value="defer">defer</option>
                    <option value="pause">pause</option>
                  </select>
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="xs" onClick={() => setPendingRules(rules.filter((_, j) => j !== i))}><Trash2 className="h-3 w-3" /></Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}

function LaneSummary({ spend }: { spend: SpendResponse }) {
  const g = spend.facets?.monthly.global
  if (!g) return null
  const unattr = g.unattributed
  const hasUnattr = unattr.meteredUsdMicros > 0 || unattr.meteredTokens > 0 || unattr.subscriptionTokens > 0
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-1">
      <div className="text-xs text-muted-foreground">This month (cap windows)</div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm tabular-nums">
        <span>Metered: <span className="font-semibold">{formatUsdMicros(g.meteredUsdMicros + unattr.meteredUsdMicros) ?? '$0.00'}</span> <span className="text-muted-foreground">({fmtTokens(g.meteredTokens + unattr.meteredTokens)} tokens)</span></span>
        <span>Subscription: <span className="font-semibold">{fmtTokens(g.subscriptionTokens + unattr.subscriptionTokens)} tokens</span> <span className="text-muted-foreground">(included in plan — no $)</span></span>
        {g.unpricedMeteredTokens > 0 ? <span className="text-muted-foreground">Unpriced metered: {fmtTokens(g.unpricedMeteredTokens)} tokens</span> : null}
      </div>
      {hasUnattr ? (
        <p className="text-[11px] text-muted-foreground">
          Includes {formatUsdMicros(unattr.meteredUsdMicros) ?? '$0'} / {fmtTokens(unattr.meteredTokens + unattr.subscriptionTokens)} tokens of UNATTRIBUTED spend — agent activity outside Bakin-managed tasks, observed from runtime transcripts (~5&nbsp;min lag; dollars only where the runtime reported cost). It counts toward the caps.
        </p>
      ) : null}
    </div>
  )
}

export function SpendTab({ m }: { m: ModelsData }) {
  const { spendWindow, setSpendWindow, spend, spendLoading, budgetRules, incidents, resolveIncident } = m

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

      <IncidentBanner incidents={incidents} resolveIncident={resolveIncident} />

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
            <LaneSummary spend={spend} />
          </div>

          <UtilizationCards rules={budgetRules} spend={spend} />

          <RuleEditor m={m} />

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
                    <TableHead>Provider (this month)</TableHead>
                    <TableHead className="text-right">Metered $</TableHead>
                    <TableHead className="text-right">Subscription tokens</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!spend.facets || Object.keys(spend.facets.monthly.byProvider).length === 0 ? (
                    <TableRow><TableCell colSpan={3} className="text-muted-foreground">No attributed spend this month</TableCell></TableRow>
                  ) : Object.entries(spend.facets.monthly.byProvider).map(([provider, sums]) => (
                    <TableRow key={provider}>
                      <TableCell className="font-medium">{provider}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatUsdMicros(sums.meteredUsdMicros) ?? <span className="text-muted-foreground">—</span>}</TableCell>
                      <TableCell className="text-right tabular-nums">{sums.subscriptionTokens ? fmtTokens(sums.subscriptionTokens) : <span className="text-muted-foreground">—</span>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
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
        </>
      )}
    </div>
  )
}
