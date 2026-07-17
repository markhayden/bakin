'use client'

import { useState } from 'react'
import { AlertTriangle, Pause, Plus, Trash2 } from 'lucide-react'
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

/**
 * One money formatter, three honest states: real dollars render as dollars
 * (including a genuine $0.00), "priced-nothing-yet-but-tokens-flowed"
 * renders as "$ unavailable" (unpriced model), and both are distinguishable
 * from each other everywhere.
 */
function formatUsd(micros: number, unpricedTokens = 0): string {
  if (micros === 0 && unpricedTokens > 0) return '$ unavailable'
  return `$${(micros / 1_000_000).toFixed(micros > 0 && micros < 10_000 ? 4 : 2)}`
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

/** Parse a cap input: plain numbers everywhere, k/M suffixes for token caps
 *  ("5M" → 5,000,000). Returns undefined for blank/invalid. */
export function parseCapInput(raw: string): number | undefined {
  const text = raw.trim()
  if (!text) return undefined
  const match = /^([0-9]*\.?[0-9]+)\s*([kKmM])?$/.exec(text)
  if (!match) return undefined
  const base = Number(match[1])
  if (!Number.isFinite(base) || base <= 0) return undefined
  const mult = match[2]?.toLowerCase() === 'm' ? 1_000_000 : match[2]?.toLowerCase() === 'k' ? 1_000 : 1
  return base * mult
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

function IncidentRow({ incident, resolveIncident, setError }: {
  incident: BudgetIncidentWire
  resolveIncident: ModelsData['resolveIncident']
  setError: (e: string | null) => void
}) {
  const [raiseValue, setRaiseValue] = useState('')
  const i = incident
  const isWarn = i.kind === 'warn'
  const tone = isWarn ? 'text-amber-400' : 'text-red-400'
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className={`tabular-nums ${isWarn ? '' : ''}`}>
        <span className={`font-medium ${tone}`}>{isWarn ? 'Warning' : 'Cap reached'}</span>{' '}
        — {i.scopeId ? `${i.scope} '${i.scopeId}'` : 'global'} · {i.window} · {i.lane} at{' '}
        {fmtUnit(i.lane, i.spentValue, i.unit === 'usd_micros')} of {fmtUnit(i.lane, i.capValue, i.unit === 'usd_micros')}
        {i.atCap === 'pause' && i.kind === 'cap' ? ' · PAUSED until resolved' : ''}
        {i.status === 'acknowledged' ? ' · acknowledged' : ''}
      </span>
      <span className="ml-auto flex items-center gap-1">
        {!isWarn && (
          <>
            <Input
              type="text" placeholder={i.lane === 'metered' ? 'new $ cap' : 'new cap (e.g. 5M)'}
              className="h-7 w-28 text-xs"
              value={raiseValue}
              onChange={(e) => setRaiseValue(e.target.value)}
            />
            <Button
              size="xs"
              onClick={async () => {
                const cap = parseCapInput(raiseValue)
                if (cap === undefined) { setError('Enter the new cap first (token caps accept k/M suffixes).'); return }
                setError(await resolveIncident(i.id, 'raise', cap))
              }}
            >
              Raise & resume
            </Button>
          </>
        )}
        {i.status === 'open' ? (
          <Button variant="outline" size="xs" title="Stop alerting; deferral (if any) continues until the window resets" onClick={async () => setError(await resolveIncident(i.id, 'ack'))}>Acknowledge</Button>
        ) : null}
        <Button
          variant="outline" size="xs"
          title={i.atCap === 'pause' && i.kind === 'cap' ? 'Clear this pause hold without raising the cap' : 'Dismiss this incident'}
          onClick={async () => setError(await resolveIncident(i.id, 'resume'))}
        >
          {i.atCap === 'pause' && i.kind === 'cap' ? 'Resume as-is' : 'Dismiss'}
        </Button>
      </span>
    </div>
  )
}

function IncidentBanner({ incidents, resolveIncident }: { incidents: BudgetIncidentWire[]; resolveIncident: ModelsData['resolveIncident'] }) {
  const [error, setError] = useState<string | null>(null)
  const live = incidents.filter((i) => i.status !== 'resolved')
  if (live.length === 0) return null
  const caps = live.filter((i) => i.kind === 'cap')
  const warns = live.filter((i) => i.kind === 'warn')
  const tone = caps.length > 0
    ? 'border-red-500/40 bg-red-500/5 text-red-500'
    : 'border-amber-500/40 bg-amber-500/5 text-amber-500'
  return (
    <div className={`rounded-xl border p-3 space-y-2 ${tone.split(' ').slice(0, 2).join(' ')}`}>
      <div className={`flex items-center gap-2 text-sm font-medium ${tone.split(' ')[2]}`}>
        <AlertTriangle className="h-4 w-4" />
        {caps.length > 0 ? `${caps.length} budget cap incident${caps.length === 1 ? '' : 's'}` : ''}
        {caps.length > 0 && warns.length > 0 ? ' · ' : ''}
        {warns.length > 0 ? `${warns.length} warning${warns.length === 1 ? '' : 's'}` : ''}
      </div>
      {error ? <div className="text-xs text-red-500">{error}</div> : null}
      {live.map((i) => (
        <IncidentRow key={i.id} incident={i} resolveIncident={resolveIncident} setError={setError} />
      ))}
    </div>
  )
}

const SCOPES = ['global', 'agent', 'provider', 'model'] as const

function CapInput({ rule, value, onChange }: { rule: BudgetRuleWire; value: number | undefined; onChange: (v: number | undefined) => void }) {
  // Text input with unit-aware parsing: token caps accept k/M suffixes
  // ("5M"), dollar caps take plain numbers. Local text state so a partial
  // entry ("5M" mid-type) isn't destroyed by the parse.
  const [text, setText] = useState<string | null>(null)
  const display = text ?? (value !== undefined ? String(value) : '')
  return (
    <Input
      type="text"
      className="h-7 w-24 text-xs"
      placeholder={rule.lane === 'metered' ? '$' : 'tokens (5M)'}
      value={display}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        if (text === null) return
        onChange(parseCapInput(text))
        setText(null)
      }}
    />
  )
}

function RuleEditor({ m }: { m: ModelsData }) {
  const { budgetRules, pendingRules, setPendingRules, saveBudgetRules, saving, budgetError, budgetWarnings, agents, availableProviders, modelOptions, spend } = m
  const rules = pendingRules ?? budgetRules
  const edit = (index: number, patch: Partial<BudgetRuleWire>) => {
    const next = rules.map((r, i) => (i === index ? { ...r, ...patch } : r))
    setPendingRules(next)
  }
  const monthlyTokens = spend?.facets
    ? spend.facets.monthly.global.subscriptionTokens + spend.facets.monthly.global.unattributed.subscriptionTokens
    : 0
  return (
    <div className="rounded-xl border border-border bg-card p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-xs text-muted-foreground">
          Cap rules — metered caps are estimated USD; subscription caps are tokens (plan quota; k/M suffixes ok{monthlyTokens > 0 ? ` — you used ${fmtTokens(monthlyTokens)} subscription tokens this month` : ''}). At 100%: defer resumes at window reset; pause holds until you resolve.
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
      {budgetError ? <p className="text-xs text-red-500">{budgetError}</p> : null}
      {budgetWarnings.map((w, i) => <p key={i} className="text-xs text-amber-500">⚠ {w}</p>)}
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
                    <>
                      <Input
                        className="h-7 w-32 text-xs" list={`budget-ids-${r.scope}`}
                        placeholder={r.scope === 'agent' ? 'agent id' : r.scope === 'provider' ? 'e.g. google' : 'provider/model'}
                        value={r.scopeId ?? ''} onChange={(e) => edit(i, { scopeId: e.target.value || undefined })}
                      />
                      <datalist id={`budget-ids-${r.scope}`}>
                        {(r.scope === 'agent' ? agents.map((a) => a.agentId)
                          : r.scope === 'provider' ? availableProviders
                          : modelOptions.map((mo) => (typeof mo === 'string' ? mo : mo.id))
                        ).map((id) => <option key={id} value={id} />)}
                      </datalist>
                    </>
                  )}
                </TableCell>
                <TableCell>
                  <select className="h-7 rounded border border-border bg-background text-xs" value={r.lane} onChange={(e) => edit(i, { lane: e.target.value as BudgetRuleWire['lane'] })}>
                    <option value="metered">metered ($)</option>
                    <option value="subscription">subscription (tokens)</option>
                  </select>
                </TableCell>
                <TableCell><CapInput rule={r} value={r.dailyCap} onChange={(v) => edit(i, { dailyCap: v })} /></TableCell>
                <TableCell><CapInput rule={r} value={r.monthlyCap} onChange={(v) => edit(i, { monthlyCap: v })} /></TableCell>
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

/** Detected billing lane per agent with the manual override affordance —
 *  the "why does my Codex agent read as metered?" surface. */
function BillingLanesCard({ m }: { m: ModelsData }) {
  const { budgetStatus, setAgentLaneOverride } = m
  const billing = budgetStatus?.billing ?? {}
  const entries = Object.entries(billing)
  if (entries.length === 0) return null
  const overrides = budgetStatus?.overrides ?? []
  const agentOverrides = new Map(overrides.filter((o) => o.agentId && !o.provider).map((o) => [o.agentId as string, o.lane]))
  const agentsWithProviderOverrides = new Set(overrides.filter((o) => o.agentId && o.provider).map((o) => o.agentId as string))
  return (
    <div className="rounded-xl border border-border bg-card p-3 space-y-2">
      <div className="text-xs text-muted-foreground">
        Billing lanes — detected from each agent&apos;s auth (API key → metered $; OAuth login → subscription tokens). Override when detection is wrong (e.g. a Codex subscription whose OAuth lives outside the per-agent auth profiles).
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-1">
        {entries.map(([agentId, b]) => (
          <div key={agentId} className="flex items-center gap-2 text-xs">
            <span className="font-medium">{agentId}</span>
            <span className="text-muted-foreground">{b.provider}</span>
            <select
              className="h-6 rounded border border-border bg-background text-xs"
              value={agentOverrides.has(agentId) ? agentOverrides.get(agentId) : 'auto'}
              onChange={(e) => setAgentLaneOverride(agentId, e.target.value as 'auto' | 'metered' | 'subscription')}
            >
              <option value="auto">auto ({b.lane})</option>
              <option value="metered">metered ($)</option>
              <option value="subscription">subscription (tokens)</option>
            </select>
            {agentsWithProviderOverrides.has(agentId) ? (
              <span className="text-[10px] text-muted-foreground" title="This agent also has per-provider lane overrides (settings billing.overrides) that win over this select for those providers.">+provider overrides</span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  )
}

function LaneSummary({ spend }: { spend: SpendResponse }) {
  const g = spend.facets?.monthly.global
  if (!g) return null
  const unattr = g.unattributed
  const hasUnattr = unattr.meteredUsdMicros > 0 || unattr.meteredTokens > 0 || unattr.subscriptionTokens > 0
  const meteredMicros = g.meteredUsdMicros + unattr.meteredUsdMicros
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-1">
      <div className="text-xs text-muted-foreground">This month (cap windows, incl. unattributed)</div>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm tabular-nums">
        <span>Metered: <span className="font-semibold">{formatUsd(meteredMicros, g.unpricedMeteredTokens)}</span> <span className="text-muted-foreground">({fmtTokens(g.meteredTokens + unattr.meteredTokens)} tokens)</span></span>
        <span>Subscription: <span className="font-semibold">{fmtTokens(g.subscriptionTokens + unattr.subscriptionTokens)} tokens</span> <span className="text-muted-foreground">(included in plan — no $)</span></span>
        {g.unpricedMeteredTokens > 0 ? <span className="text-muted-foreground">Unpriced metered: {fmtTokens(g.unpricedMeteredTokens)} tokens</span> : null}
      </div>
      {hasUnattr ? (
        <p className="text-[11px] text-muted-foreground">
          Includes {formatUsd(unattr.meteredUsdMicros)} / {fmtTokens(unattr.meteredTokens + unattr.subscriptionTokens)} tokens of UNATTRIBUTED spend — agent activity outside Bakin-managed tasks, observed from runtime transcripts (~5&nbsp;min lag; dollars only where the runtime reported cost). It counts toward the caps.
        </p>
      ) : null}
    </div>
  )
}

export function SpendTab({ m }: { m: ModelsData }) {
  const { spendWindow, setSpendWindow, spend, spendLoading, budgetRules, incidents, resolveIncident, budgetStatus, setDispatchPaused } = m
  const paused = budgetStatus?.paused === true

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
          <Button
            variant={paused ? 'destructive' : 'outline'}
            size="xs"
            title={paused ? 'Dispatch is paused — click to resume' : 'Break-glass: pause ALL task dispatch and billed media now'}
            onClick={() => setDispatchPaused(!paused)}
          >
            <Pause className="h-3 w-3" /> {paused ? 'Resume dispatch' : 'Pause all dispatch'}
          </Button>
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
              <div className="text-xs text-muted-foreground">Estimated total ({spend.window}, attributed only — cap math uses the month card)</div>
              <div className="text-2xl font-semibold tabular-nums">
                {formatUsd(spend.totalUsdMicros, spend.facets?.monthly.global.unpricedMeteredTokens ?? 0)}
              </div>
            </div>
            <LaneSummary spend={spend} />
          </div>

          <UtilizationCards rules={budgetRules} spend={spend} />

          <RuleEditor m={m} />

          <BillingLanesCard m={m} />

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
                      <TableCell className="text-right tabular-nums">{r.costUsdMicros ? formatUsd(r.costUsdMicros) : <span className="text-muted-foreground">$ unavailable</span>}</TableCell>
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
                      <TableCell className="text-right tabular-nums">{sums.meteredUsdMicros ? formatUsd(sums.meteredUsdMicros) : sums.unpricedMeteredTokens > 0 ? <span className="text-muted-foreground">$ unavailable ({fmtTokens(sums.unpricedMeteredTokens)} unpriced)</span> : <span className="text-muted-foreground">—</span>}</TableCell>
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
                    <TableCell className="text-right tabular-nums">{r.costUsdMicros ? formatUsd(r.costUsdMicros) : <span className="text-muted-foreground">$ unavailable</span>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div className="overflow-hidden rounded-xl border border-border">
            <Table>
              <TableHeader>
                <TableRow className="bg-card">
                  <TableHead>Work class</TableHead>
                  <TableHead className="text-right">Runs</TableHead>
                  <TableHead className="text-right">Tokens</TableHead>
                  <TableHead className="text-right">Est. cost</TableHead>
                  <TableHead className="text-right">Subscription tokens</TableHead>
                  <TableHead className="text-right">Avg $/run</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!spend.byWorkClass || spend.byWorkClass.length === 0 ? (
                  <TableRow><TableCell colSpan={6} className="text-muted-foreground">No spend in this window</TableCell></TableRow>
                ) : spend.byWorkClass.map((r) => (
                  <TableRow key={r.workClass}>
                    <TableCell className="font-medium">{r.workClass === 'unclassified' ? <span className="text-muted-foreground">unclassified (pre-migration)</span> : r.workClass}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.runs}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.totalTokens !== null ? fmtTokens(r.totalTokens) : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.costUsdMicros !== null ? formatUsd(r.costUsdMicros) : <span className="text-muted-foreground">$ unavailable</span>}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.subscriptionTokens ? fmtTokens(r.subscriptionTokens) : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-right tabular-nums">{r.avgCostUsdMicros !== null ? formatUsd(r.avgCostUsdMicros) : <span className="text-muted-foreground">—</span>}</TableCell>
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
