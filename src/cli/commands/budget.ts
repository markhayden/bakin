/**
 * `bakin spend` + `bakin budget {show,set,rm,pause,resume,incidents}` —
 * terminal-native cost control (cost-control v2, #464).
 *
 * Every number comes from the models plugin's routes, which read the ONE
 * spend engine the dispatch gate enforces — CLI output matches the Spend
 * tab by construction. Unit-per-lane: metered rules cap estimated USD,
 * subscription rules cap tokens; the commands echo the unit back so a cap
 * can never be misread.
 */
import { api, apiGet, apiPost } from '../http'
import { print, printTable } from '../output'
import { exitUsage, exitUnknownSubcommand } from '../help'

interface RuleWire {
  scope: 'global' | 'agent' | 'provider' | 'model'
  scopeId?: string
  lane: 'metered' | 'subscription'
  dailyCap?: number
  monthlyCap?: number
  warnPct?: number
  atCap?: 'defer' | 'pause'
}
interface LaneSums { meteredUsdMicros: number; meteredTokens: number; subscriptionTokens: number; unpricedMeteredTokens: number }
interface ScopeSpend extends LaneSums { unattributed: { meteredUsdMicros: number; meteredTokens: number; subscriptionTokens: number } }
interface WindowSpend { startMs: number; global: ScopeSpend; byAgent: Record<string, ScopeSpend>; byProvider: Record<string, LaneSums>; byModel: Record<string, LaneSums> }
interface SpendPayload {
  window: string
  totalUsdMicros: number
  byAgent: Array<{ agent: string; costUsdMicros: number | null; runs: number }>
  byModel: Array<{ model: string; costUsdMicros: number | null; runs: number }>
  byWorkClass?: Array<{
    workClass: string; runs: number; totalTokens: number | null
    costUsdMicros: number | null; subscriptionTokens: number; avgCostUsdMicros: number | null
  }>
  facets?: {
    observedUsageEvidence?:
      | { status: 'available' }
      | { status: 'unavailable'; reason: 'usage_store_unavailable' }
    daily: WindowSpend
    monthly: WindowSpend
  }
  pace?: { daily: { meteredUsdMicros: number | null }; monthly: { meteredUsdMicros: number | null } }
}
interface IncidentWire {
  id: number; scope: string; scopeId: string; lane: 'metered' | 'subscription'
  window: string; kind: string; unit: 'usd_micros' | 'tokens'
  capValue: number; spentValue: number; atCap: string; status: string; openedAt: number
}

function usd(micros: number, unpricedTokens = 0): string {
  if (micros === 0 && unpricedTokens > 0) return '$ unavailable'
  return `$${(micros / 1_000_000).toFixed(2)}`
}

/** Parse a cap value: plain numbers, or k/M suffixes for token caps ("5M"). */
function parseCap(raw: string | undefined): number | undefined {
  if (!raw) return undefined
  const match = /^([0-9]*\.?[0-9]+)\s*([kKmM])?$/.exec(raw.trim())
  if (!match) return undefined
  const base = Number(match[1])
  if (!Number.isFinite(base) || base <= 0) return undefined
  const mult = match[2]?.toLowerCase() === 'm' ? 1_000_000 : match[2]?.toLowerCase() === 'k' ? 1_000 : 1
  return base * mult
}
function tokens(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `${(n / 1_000).toFixed(1)}k` : String(n)
}
function unitValue(lane: 'metered' | 'subscription', v: number, isMicros: boolean): string {
  return lane === 'metered' ? usd(isMicros ? v : v * 1_000_000) : `${tokens(v)} tokens`
}
function ruleName(r: { scope: string; scopeId?: string }): string {
  return r.scopeId ? `${r.scope}:${r.scopeId}` : 'global'
}
function flag(args: string[], name: string): string | undefined {
  const eq = args.find((a) => a.startsWith(`${name}=`))
  if (eq) return eq.split('=').slice(1).join('=')
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : undefined
}

async function fetchRules(): Promise<RuleWire[]> {
  const policy = (await apiGet('/api/plugins/models/budget')) as { rules?: RuleWire[] }
  return policy.rules ?? []
}

async function putRules(rules: RuleWire[]): Promise<void> {
  const result = (await api('/api/plugins/models/budget', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rules }),
  })) as { warnings?: string[] }
  for (const warning of result.warnings ?? []) console.log(`⚠ ${warning}`)
}

function ruleSpent(rule: RuleWire, w: WindowSpend): number {
  const bucket: ScopeSpend | LaneSums | undefined =
    rule.scope === 'global' ? w.global
    : rule.scope === 'agent' ? w.byAgent[rule.scopeId ?? '']
    : rule.scope === 'provider' ? w.byProvider[rule.scopeId ?? '']
    : w.byModel[rule.scopeId ?? '']
  if (!bucket) return 0
  const unattr = (bucket as Partial<ScopeSpend>).unattributed
  return rule.lane === 'subscription'
    ? bucket.subscriptionTokens + (unattr?.subscriptionTokens ?? 0)
    : bucket.meteredUsdMicros + (unattr?.meteredUsdMicros ?? 0)
}

// ── bakin spend ──────────────────────────────────────────────────────────────

export async function cmdSpend(args: string[]): Promise<void> {
  const window = flag(args, '--window') ?? '24h'
  const [spend, rules, status] = await Promise.all([
    apiGet(`/api/plugins/models/spend?window=${encodeURIComponent(window)}`) as Promise<SpendPayload>,
    fetchRules(),
    apiGet('/api/plugins/models/budget/status') as Promise<{ paused?: boolean }>,
  ])
  if (args.includes('--json')) {
    print({ ...spend, rules, paused: status.paused === true })
    return
  }

  console.log(`Estimated spend (${spend.window}): ${usd(spend.totalUsdMicros)}   (estimates — not an invoice)`)
  if (status.paused) console.log('⚠ DISPATCH PAUSED (kill switch) — resume with `bakin budget resume`')

  const g = spend.facets?.monthly.global
  if (g) {
    console.log(`This month: metered ${usd(g.meteredUsdMicros + g.unattributed.meteredUsdMicros, g.unpricedMeteredTokens)} (${tokens(g.meteredTokens + g.unattributed.meteredTokens)} tokens${g.unpricedMeteredTokens ? `, ${tokens(g.unpricedMeteredTokens)} unpriced` : ''}) · subscription ${tokens(g.subscriptionTokens + g.unattributed.subscriptionTokens)} tokens (no $ — plan quota)`)
    const unattr = g.unattributed
    if (unattr.meteredUsdMicros || unattr.meteredTokens || unattr.subscriptionTokens) {
      console.log(`  includes unattributed (outside Bakin tasks): ${usd(unattr.meteredUsdMicros)} / ${tokens(unattr.meteredTokens + unattr.subscriptionTokens)} tokens`)
    }
  }
  const paceDay = spend.pace?.daily.meteredUsdMicros
  const paceMonth = spend.pace?.monthly.meteredUsdMicros
  if (paceDay != null || paceMonth != null) {
    console.log(`On pace:${paceDay != null ? ` ~${usd(paceDay)} today` : ''}${paceDay != null && paceMonth != null ? ' ·' : ''}${paceMonth != null ? ` ~${usd(paceMonth)} this month` : ''}`)
  }

  if (rules.length && spend.facets) {
    console.log('\nBudget utilization:')
    const rows: Record<string, unknown>[] = []
    for (const rule of rules) {
      for (const w of ['daily', 'monthly'] as const) {
        const capRaw = w === 'daily' ? rule.dailyCap : rule.monthlyCap
        if (!capRaw) continue
        const cap = rule.lane === 'metered' ? capRaw * 1_000_000 : capRaw
        const spent = ruleSpent(rule, w === 'daily' ? spend.facets.daily : spend.facets.monthly)
        rows.push({
          rule: ruleName(rule), lane: rule.lane, window: w,
          spent: unitValue(rule.lane, spent, true),
          cap: unitValue(rule.lane, cap, true),
          util: `${Math.round((spent / cap) * 100)}%`,
          atCap: rule.atCap ?? 'defer',
        })
      }
    }
    printTable(rows)
  } else if (!rules.length) {
    console.log('\n⚠ No budget rules — spend is uncapped. `bakin budget set --scope global --lane metered --daily <usd>`')
  }

  if (spend.byAgent.length) {
    console.log(`\nBy agent (${spend.window}):`)
    printTable(spend.byAgent.map((r) => ({ agent: r.agent, runs: r.runs, 'est. cost': r.costUsdMicros ? usd(r.costUsdMicros) : '—' })))
  }
  if (spend.byModel.length) {
    console.log(`\nBy model (${spend.window}):`)
    printTable(spend.byModel.map((r) => ({ model: r.model, runs: r.runs, 'est. cost': r.costUsdMicros ? usd(r.costUsdMicros) : '—' })))
  }
  if (spend.byWorkClass?.length) {
    console.log(`\nBy work class (${spend.window}):`)
    printTable(spend.byWorkClass.map((r) => ({
      class: r.workClass === 'unclassified' ? 'unclassified (pre-migration)' : r.workClass,
      runs: r.runs,
      tokens: r.totalTokens !== null ? tokens(r.totalTokens) : '—',
      'est. cost': r.costUsdMicros !== null ? usd(r.costUsdMicros) : '—',
      'sub tokens': r.subscriptionTokens ? tokens(r.subscriptionTokens) : '—',
      'avg $/run': r.avgCostUsdMicros !== null ? usd(r.avgCostUsdMicros) : '—',
    })))
  }
}

// ── bakin budget … ───────────────────────────────────────────────────────────

async function cmdBudgetShow(json: boolean): Promise<void> {
  const rules = await fetchRules()
  const status = (await apiGet('/api/plugins/models/budget/status')) as { paused?: boolean }
  if (json) {
    print({ rules, paused: status.paused === true })
    return
  }
  if (status.paused) console.log('⚠ DISPATCH PAUSED (kill switch) — `bakin budget resume` to restore')
  if (!rules.length) {
    console.log('No budget rules — spend is uncapped.')
    return
  }
  // Three distinct pause concepts exist — disambiguate in the one place a
  // confused operator will look first.
  console.log('(pause/resume = the global kill switch; a rule\'s "at cap: pause" holds until you resolve its incident — `bakin budget incidents`)')
  printTable(rules.map((r) => ({
    rule: ruleName(r),
    lane: r.lane,
    daily: r.dailyCap !== undefined ? unitValue(r.lane, r.dailyCap, false) : '—',
    monthly: r.monthlyCap !== undefined ? unitValue(r.lane, r.monthlyCap, false) : '—',
    'warn %': Math.round((r.warnPct ?? 0.8) * 100),
    'at cap': r.atCap ?? 'defer',
  })))
}

const SET_USAGE = 'bakin budget set --scope global|agent|provider|model [--id <scopeId>] --lane metered|subscription [--daily N] [--monthly N] [--warn-pct N] [--at-cap defer|pause] — caps are whole USD (metered) or tokens (subscription; k/M suffixes ok, e.g. 5M)'

async function cmdBudgetSet(args: string[]): Promise<void> {
  const scope = flag(args, '--scope') as RuleWire['scope'] | undefined
  const lane = flag(args, '--lane') as RuleWire['lane'] | undefined
  const scopeId = flag(args, '--id')
  if (!scope || !lane) await exitUsage(SET_USAGE)
  if (scope !== 'global' && !scopeId) await exitUsage(SET_USAGE, `--id is required for scope '${scope}'`)
  if (!['global', 'agent', 'provider', 'model'].includes(scope ?? '')) await exitUsage(SET_USAGE, `Unknown scope '${scope}'.`)
  if (lane !== 'metered' && lane !== 'subscription') await exitUsage(SET_USAGE, `Unknown lane '${lane}'.`)
  const daily = parseCap(flag(args, '--daily'))
  const monthly = parseCap(flag(args, '--monthly'))
  const warnPct = flag(args, '--warn-pct')
  const atCap = flag(args, '--at-cap') as RuleWire['atCap'] | undefined

  const rules = await fetchRules()
  const others = rules.filter((r) => !(r.scope === scope && (r.scopeId ?? '') === (scopeId ?? '') && r.lane === lane))
  const rule: RuleWire = {
    scope: scope!,
    ...(scopeId ? { scopeId } : {}),
    lane: lane!,
    ...(daily !== undefined ? { dailyCap: daily } : {}),
    ...(monthly !== undefined ? { monthlyCap: monthly } : {}),
    ...(warnPct ? { warnPct: Number(warnPct) / 100 } : {}),
    ...(atCap ? { atCap } : {}),
  }
  if (!rule.dailyCap && !rule.monthlyCap) {
    await exitUsage(SET_USAGE, 'Set at least one of --daily / --monthly (values in whole USD for metered rules, tokens for subscription rules).')
  }
  await putRules([...others, rule])
  const unit = lane === 'metered' ? 'USD' : 'tokens'
  console.log(`Set ${ruleName(rule)} ${lane} rule (${unit}): ${rule.dailyCap ? `${rule.dailyCap}/day ` : ''}${rule.monthlyCap ? `${rule.monthlyCap}/month` : ''}`.trim())
}

async function cmdBudgetRm(args: string[]): Promise<void> {
  const scope = flag(args, '--scope') as RuleWire['scope'] | undefined
  const lane = flag(args, '--lane') as RuleWire['lane'] | undefined
  const scopeId = flag(args, '--id')
  if (!scope || !lane) await exitUsage('bakin budget rm --scope global|agent|provider|model [--id <scopeId>] --lane metered|subscription')
  const rules = await fetchRules()
  const next = rules.filter((r) => !(r.scope === scope && (r.scopeId ?? '') === (scopeId ?? '') && r.lane === lane))
  if (next.length === rules.length) {
    console.error(`No matching rule (${scope}${scopeId ? `:${scopeId}` : ''} ${lane}).`)
    process.exit(1)
  }
  await putRules(next)
  console.log(`Removed ${scope}${scopeId ? `:${scopeId}` : ''} ${lane} rule.`)
}

async function setPaused(paused: boolean): Promise<void> {
  await apiPost('/api/settings', { dispatch: { paused } })
  console.log(paused
    ? 'Dispatch PAUSED — no task dispatch or billed media until resumed (`bakin budget resume`).'
    : 'Dispatch resumed.')
}

async function cmdBudgetIncidents(args: string[]): Promise<void> {
  const resolveId = flag(args, '--resolve')
  if (resolveId) {
    const action = flag(args, '--action')
    if (action !== 'raise' && action !== 'ack' && action !== 'resume') {
      await exitUsage('bakin budget incidents --resolve <id> --action raise|ack|resume [--cap N]')
    }
    const cap = parseCap(flag(args, '--cap'))
    const body: Record<string, unknown> = { action, ...(cap !== undefined ? { cap } : {}) }
    await apiPost(`/api/plugins/models/budget/incidents/${resolveId}/resolve`, body)
    console.log(`Incident ${resolveId}: ${action}${cap ? ` (new cap ${cap})` : ''}.`)
    return
  }
  const all = args.includes('--all')
  const data = (await apiGet(`/api/plugins/models/budget/incidents${all ? '?all=1' : ''}`)) as { incidents?: IncidentWire[] }
  const incidents = data.incidents ?? []
  if (args.includes('--json')) {
    print({ incidents })
    return
  }
  if (!incidents.length) {
    console.log(all ? 'No budget incidents recorded.' : 'No open budget incidents.')
    return
  }
  printTable(incidents.map((i) => ({
    id: i.id,
    rule: ruleName(i),
    lane: i.lane,
    window: i.window,
    kind: i.kind,
    spent: unitValue(i.lane, i.spentValue, i.unit === 'usd_micros'),
    cap: unitValue(i.lane, i.capValue, i.unit === 'usd_micros'),
    mode: i.atCap,
    status: i.status,
    opened: new Date(i.openedAt).toLocaleString(),
  })))
  console.log('\nResolve: bakin budget incidents --resolve <id> --action raise|ack|resume [--cap N]')
}

export async function run(args: string[]): Promise<void> {
  if (args[0] === 'spend') {
    await cmdSpend(args)
    return
  }
  const sub = args[1]
  if (sub === 'show' || sub === undefined) await cmdBudgetShow(args.includes('--json'))
  else if (sub === 'set') await cmdBudgetSet(args)
  else if (sub === 'rm') await cmdBudgetRm(args)
  else if (sub === 'pause') await setPaused(true)
  else if (sub === 'resume') await setPaused(false)
  else if (sub === 'incidents') await cmdBudgetIncidents(args)
  else await exitUnknownSubcommand('budget', sub, ['show', 'set', 'rm', 'pause', 'resume', 'incidents'])
}
