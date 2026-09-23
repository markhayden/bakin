/**
 * Model eligibility — the ONE engine that answers "can this model run on
 * this install?" (#907, #852, the model slice of #378).
 *
 * Four INDEPENDENT facts, each known or unknown, all phrased so TRUE means
 * "fine": inCatalog, runtimeAvailable, credentialed, notRejected. A model is
 * eligible iff every fact is known-true; ineligible with the FIRST
 * known-false fact's reason; unknown when nothing is known-false but some
 * evidence is missing. A failed lookup never erases an independently known
 * fact — a rejection the ledger recorded stays a rejection when the
 * credential read fails.
 *
 * The runtime is an explicit argument (dry-run switches evaluate the TARGET
 * adapter). Nothing here branches on adapter id; the runtime's own
 * `unavailableReason` is the only source of a per-model reason.
 */
import type { AgentRuntimeAdapter, ProviderCredentialInventory, RuntimeAvailableModel } from '@bakin/core/adapters/runtime'
import { createLogger } from '@/core/logger'
import { listModelRejections } from '@/core/execution-ledger'

const log = createLogger('model-eligibility')

export type EligibilityFact = { known: true; value: boolean } | { known: false }

export interface EligibilityFacts {
  inCatalog: EligibilityFact
  runtimeAvailable: EligibilityFact
  credentialed: EligibilityFact
  notRejected: EligibilityFact
  runtimeReason?: RuntimeAvailableModel['unavailableReason']
}

export type IneligibleReason = 'not_in_catalog' | 'runtime_unavailable' | 'no_credentials' | 'account_rejected'

export type Eligibility =
  | { status: 'eligible' }
  | { status: 'ineligible'; reason: IneligibleReason; detail: string }
  | { status: 'unknown'; detail: string }

export type EvidenceStatus = 'ok' | 'partial' | 'failed'

export interface EligibilityReport {
  /**
   * Keyed by the id as ASKED (an `extraIds` entry stays under its own key).
   * An id the catalog does not list verbatim is judged by the row the
   * RUNTIME resolves it to (`models.resolveId`, Pi's bare-id rule) and
   * carries `resolvedTo`; a runtime without a resolver runs exactly what
   * its catalog lists, so such an id is `not_in_catalog` there.
   */
  byModel: Map<string, { eligibility: Eligibility; facts: EligibilityFacts; rejection?: OpenRejection; resolvedTo?: string }>
  evidence: { catalog: EvidenceStatus; runtimeAvailability: EvidenceStatus; credentials: EvidenceStatus; rejections: EvidenceStatus }
  /** Runtime epoch the report was computed under; consumers discard reports from an older epoch. */
  epoch: number
}

export interface OpenRejection {
  model: string
  occurrences: number
  lastSeenAt: number
}

/** Injectable for tests; production reads the ledger facade. */
export interface EligibilityDeps {
  listOpenRejections: () => OpenRejection[]
}

const defaultDeps: EligibilityDeps = {
  listOpenRejections: () => listModelRejections({ openOnly: true }),
}

export interface EligibilityOptions {
  /** Scope credential evidence to one agent where the runtime keys it per agent. */
  agentId?: string
  /** Persisted selections to evaluate even when the catalog does not list them (⇒ not_in_catalog). */
  extraIds?: string[]
  /**
   * A catalog snapshot the caller already holds (the models plugin's cached
   * rows) — skips the live listAvailable call. Must be a COMPLETE snapshot
   * (unavailable rows included) or absent ids will read not_in_catalog.
   */
  catalog?: RuntimeAvailableModel[]
  epoch?: number
}

/**
 * The credential inventory is the one source that can cost a subprocess
 * (OpenClaw shells its CLI). Memoised briefly per (runtime, agentId) — the
 * same posture as the billing-lane cache — and dropped on epoch bumps
 * (runtime switch) or explicit reset.
 */
const INVENTORY_MEMO_MS = 30_000
const inventoryMemo = new WeakMap<object, Map<string, { at: number; value: Promise<Settled<ProviderCredentialInventory>> }>>()

let memoEpoch = 0

export function resetEligibilityMemo(): void {
  // WeakMap has no clear(); bumping the epoch in the memo key invalidates entries.
  memoEpoch++
}

function inventoryFor(runtime: AgentRuntimeAdapter, agentId: string | undefined): Promise<Settled<ProviderCredentialInventory>> {
  const providersFn = runtime.credentials?.providers
  if (!providersFn) {
    return Promise.resolve({ ok: false, error: new Error('runtime omits credentials.providers()') })
  }
  const key = `${memoEpoch}:${agentId ?? ''}`
  let perRuntime = inventoryMemo.get(runtime)
  if (!perRuntime) {
    perRuntime = new Map()
    inventoryMemo.set(runtime, perRuntime)
  }
  const hit = perRuntime.get(key)
  const now = Date.now()
  if (hit && now - hit.at < INVENTORY_MEMO_MS) return hit.value
  const value = settle(providersFn.call(runtime.credentials, agentId ? { agentId } : undefined))
  perRuntime.set(key, { at: now, value })
  return value
}

const KNOWN = (value: boolean): EligibilityFact => ({ known: true, value })
const UNKNOWN: EligibilityFact = { known: false }

export function providerOf(modelId: string): string | null {
  const slash = modelId.indexOf('/')
  return slash > 0 ? modelId.slice(0, slash) : null
}

/** Pure: facts → verdict. Order of reasons = order of facts. */
export function deriveEligibility(facts: EligibilityFacts, ctx: { modelId: string; rejection?: OpenRejection }): Eligibility {
  const provider = providerOf(ctx.modelId) ?? 'unknown provider'
  if (facts.inCatalog.known && !facts.inCatalog.value) {
    return { status: 'ineligible', reason: 'not_in_catalog', detail: `${ctx.modelId} is not in the runtime's model catalog` }
  }
  if (facts.runtimeAvailable.known && !facts.runtimeAvailable.value) {
    if (facts.runtimeReason === 'no_credentials') {
      return { status: 'ineligible', reason: 'no_credentials', detail: `no credentials for ${provider}` }
    }
    return { status: 'ineligible', reason: 'runtime_unavailable', detail: 'your runtime reports this model unavailable' }
  }
  if (facts.credentialed.known && !facts.credentialed.value) {
    return { status: 'ineligible', reason: 'no_credentials', detail: `no credentials for ${provider}` }
  }
  if (facts.notRejected.known && !facts.notRejected.value) {
    const r = ctx.rejection
    const when = r ? new Date(r.lastSeenAt).toISOString().slice(0, 10) : 'recently'
    const count = r ? `${r.occurrences} failure${r.occurrences === 1 ? '' : 's'}` : 'failures'
    return { status: 'ineligible', reason: 'account_rejected', detail: `rejected by your account (${count}, last ${when})` }
  }
  const unknowns = (['inCatalog', 'runtimeAvailable', 'credentialed', 'notRejected'] as const).filter((k) => !facts[k].known)
  if (unknowns.length > 0) {
    return { status: 'unknown', detail: `couldn't verify ${unknowns.join(', ')}` }
  }
  return { status: 'eligible' }
}

/**
 * The catalog id the runtime would run `id` as, when the catalog does not
 * list it verbatim — the ADAPTER's resolution (feature-detected), never a
 * catalog-shape guess: a runtime without `models.resolveId` resolves
 * nothing beyond its listed ids. A throwing resolver reads as unresolved.
 */
export async function resolveCatalogId(runtime: AgentRuntimeAdapter, id: string): Promise<string | null> {
  const resolve = runtime.models.resolveId
  if (!resolve) return null
  try {
    return await resolve.call(runtime.models, id)
  } catch (error) {
    log.warn('runtime model resolution failed; treating the id as unresolved', { id, error: String(error) })
    return null
  }
}

type Settled<T> = { ok: true; value: T } | { ok: false; error: unknown }

async function settle<T>(p: Promise<T>): Promise<Settled<T>> {
  try {
    return { ok: true, value: await p }
  } catch (error) {
    return { ok: false, error }
  }
}

function settleSync<T>(fn: () => T): Settled<T> {
  try {
    return { ok: true, value: fn() }
  } catch (error) {
    return { ok: false, error }
  }
}

export async function getModelEligibility(
  runtime: AgentRuntimeAdapter,
  opts: EligibilityOptions = {},
  deps: EligibilityDeps = defaultDeps,
): Promise<EligibilityReport> {
  const [catalog, credentials, rejections] = await Promise.all([
    opts.catalog
      ? Promise.resolve<Settled<RuntimeAvailableModel[]>>({ ok: true, value: opts.catalog })
      : settle(runtime.models.listAvailable({ includeUnavailable: true })),
    inventoryFor(runtime, opts.agentId),
    Promise.resolve(settleSync(() => deps.listOpenRejections())),
  ])

  if (!catalog.ok) log.warn('model catalog read failed; eligibility unknown', { error: String(catalog.error) })
  if (!credentials.ok) log.debug('credential inventory unavailable; credential facts unknown', { error: String(credentials.error) })
  if (!rejections.ok) log.warn('model rejections read failed; rejection facts unknown', { error: String(rejections.error) })

  const catalogById = new Map<string, RuntimeAvailableModel>()
  if (catalog.ok) for (const m of catalog.value) if (m.id) catalogById.set(m.id, m)

  const providerStatus = new Map<string, { configured: boolean; authFree: boolean }>()
  if (credentials.ok) {
    for (const p of credentials.value.providers) providerStatus.set(p.providerId, { configured: p.configured, authFree: p.authFree === true })
  }
  const credentialsEvidence: EvidenceStatus = !credentials.ok ? 'failed' : credentials.value.evidence === 'partial' ? 'partial' : 'ok'

  const rejectionByModel = new Map<string, OpenRejection>()
  if (rejections.ok) for (const r of rejections.value) rejectionByModel.set(r.model, r)

  const ids = new Set<string>([...catalogById.keys(), ...(opts.extraIds ?? [])])
  const byModel: EligibilityReport['byModel'] = new Map()

  // An asked-for id the catalog does not list verbatim is judged by the row
  // the RUNTIME resolves it to — its rule, not a catalog-shape guess (an
  // ambiguous bare id is the adapter's call; a wrong provider on a real id
  // never resolves by bare name because the runtime would not run it).
  const resolutions = new Map<string, string | null>()
  if (catalog.ok) {
    await Promise.all([...ids].filter((id) => !catalogById.has(id)).map(async (id) => {
      const resolved = await resolveCatalogId(runtime, id)
      resolutions.set(id, resolved !== null && resolved !== id && catalogById.has(resolved) ? resolved : null)
    }))
  }

  for (const id of ids) {
    const resolvedTo = resolutions.get(id) ?? null
    const row = catalogById.get(resolvedTo ?? id)
    const provider = providerOf(resolvedTo ?? id)

    const inCatalog: EligibilityFact = catalog.ok ? KNOWN(row !== undefined) : UNKNOWN
    const runtimeAvailable: EligibilityFact = catalog.ok && row ? KNOWN(row.available !== false) : UNKNOWN

    let credentialed: EligibilityFact = UNKNOWN
    if (row?.local === true) {
      credentialed = KNOWN(true)
    } else if (credentials.ok && provider) {
      const status = providerStatus.get(provider)
      if (status) credentialed = KNOWN(status.configured || status.authFree)
      else if (credentials.value.evidence === 'complete') credentialed = KNOWN(false)
      // partial inventory + provider absent ⇒ unknown, never credential-less
    }

    const rejection = rejectionByModel.get(id) ?? (resolvedTo ? rejectionByModel.get(resolvedTo) : undefined)
    const notRejected: EligibilityFact = rejections.ok ? KNOWN(rejection === undefined) : UNKNOWN

    const facts: EligibilityFacts = {
      inCatalog,
      runtimeAvailable,
      credentialed,
      notRejected,
      ...(row?.unavailableReason ? { runtimeReason: row.unavailableReason } : {}),
    }
    byModel.set(id, {
      facts,
      eligibility: deriveEligibility(facts, { modelId: id, rejection }),
      ...(rejection ? { rejection } : {}),
      ...(resolvedTo ? { resolvedTo } : {}),
    })
  }

  return {
    byModel,
    evidence: {
      catalog: catalog.ok ? 'ok' : 'failed',
      runtimeAvailability: catalog.ok ? 'ok' : 'failed',
      credentials: credentialsEvidence,
      rejections: rejections.ok ? 'ok' : 'failed',
    },
    epoch: opts.epoch ?? 0,
  }
}
