/**
 * The ONE write path for model selections (#907, D25/D29).
 *
 * `createSelectionMutator(deps).mutate(request)` is serialized process-wide,
 * revision-checked under the lock, and validates every op (eligibility,
 * runtime support, reservations) before touching anything. Writes are
 * grouped per DOCUMENT — `policy` (runtime routing policy), `agent:<id>`
 * (one roster entry), `routing` (plugin routes / tags / page mode) — one
 * adapter write per document, in a fixed order.
 *
 * Outcomes are TRI-STATE. A write that settles is `applied` or `failed`. A
 * write that has not settled within `deadlineMs` is recorded PENDING in
 * `<stateDir>/pending-writes.json` and its document stays RESERVED: nothing
 * releases the reservation while the promise is unsettled in this process —
 * not a read, not a matching re-read (equal to `previous` only means the
 * adapter has not written yet). When it settles the record clears (ok) or
 * turns `failed` (Retry becomes available). Records from a PRIOR boot are
 * terminal by construction (the process that owned the promise is gone), so
 * `reconcile()` classifies them by re-read: intended ⇒ resolved, previous ⇒
 * failed ("not confirmed before restart"), anything else ⇒ conflict, which
 * keeps the document reserved until an operator acknowledges it.
 *
 * Snapshots (`snapshot: 'reset'`) are FULL STATE, never request bodies; the
 * restore path diffs a snapshot against current state (buildRestoreOps) and
 * submits through this same validated mutation under the current revision.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { AgentRuntimeAdapter, RuntimeRoutingPolicy, UpdateRuntimeAgentInput } from '@bakin/core/adapters/runtime'
import { createLogger } from '@/core/logger'
import type { EligibilityDeps, OpenRejection } from '@/core/model-eligibility'
import {
  computeRevision,
  documentOf,
  enumerateSelections,
  evaluateSelections,
  proposeRepairs,
  type Proposal,
  type SelectionDocument,
  type SelectionState,
  type UiMode,
} from '@/core/model-selections'
import { ROUTABLE_WORK_CLASSES, type RoutingConfig, type ThinkingSetting, type WorkClass } from '@/core/model-routing'

const log = createLogger('model-mutations')

export interface MutationOp {
  ref: string
  set: { model?: string | null; thinking?: ThinkingSetting | null }
}

export interface MutateRequest {
  revision: string
  ops: MutationOp[]
  /** Write a full-state snapshot to `<stateDir>/snapshots/` before applying (Reset). */
  snapshot?: 'reset'
}

export interface MutateResult {
  applied: string[]
  failed: Array<{ ref: string; error: { code: 'write_failed'; message: string } }>
  pending: Array<{ ref: string; intended: string | null }>
  warnings: string[]
  /** Revision computed from POST-write state (pending writes count as their previous value). */
  revision: string
  /** The full-state snapshot written before a Reset (`bakin models restore <file>` undoes it). */
  snapshot?: string
}

export type PendingState = 'unsettled' | 'failed' | 'conflict'

export interface PendingRecord {
  document: SelectionDocument
  refs: string[]
  previous: Record<string, string | null>
  intended: Record<string, string | null>
  startedAt: number
  revision: string
  bootId: string
  /** Set when the detached promise rejected, or a prior-boot re-read matched `previous`. */
  failed?: string
  /** Set when a prior-boot re-read matched neither previous nor intended. */
  conflict?: boolean
}

export interface PendingStatus {
  document: SelectionDocument
  refs: string[]
  intended: Record<string, string | null>
  state: PendingState
  detail?: string
  startedAt: number
}

export interface ReconcileResult {
  states: SelectionState[]
  revision: string
  pending: PendingStatus[]
}

export type RefusalCode = 'stale_revision' | 'write_pending' | 'model_not_eligible' | 'unsupported_by_runtime' | 'unknown_ref'

export class MutationRefused extends Error {
  readonly status: 400 | 409
  readonly code: RefusalCode
  readonly ref?: string
  readonly document?: SelectionDocument
  readonly current?: string
  readonly proposal?: Proposal
  readonly reason?: string
  constructor(code: RefusalCode, message: string, extra: { ref?: string; document?: SelectionDocument; current?: string; proposal?: Proposal; reason?: string } = {}) {
    super(message)
    this.name = 'MutationRefused'
    this.code = code
    this.status = code === 'stale_revision' || code === 'write_pending' ? 409 : 400
    Object.assign(this, extra)
  }
  toBody(): Record<string, unknown> {
    return {
      error: this.code,
      message: this.message,
      ...(this.ref ? { ref: this.ref } : {}),
      ...(this.document ? { document: this.document } : {}),
      ...(this.current ? { current: this.current } : {}),
      ...(this.proposal ? { proposal: this.proposal } : {}),
      ...(this.reason ? { reason: this.reason } : {}),
    }
  }
}

export interface MutationDeps {
  runtime: AgentRuntimeAdapter
  loadRouting: () => { routing: RoutingConfig; uiMode: UiMode | null }
  saveRouting: (routing: RoutingConfig, uiMode: UiMode | null) => void
  /** Directory for pending-writes.json and snapshots/ (the models plugin's settings dir). */
  stateDir: string
  bootId: string
  /** Per-document adapter-write deadline before the write is recorded pending. */
  deadlineMs?: number
  listOpenRejections?: EligibilityDeps['listOpenRejections']
  /** Lane recommender for proposals (T3.2 supplies the real one). */
  recommendFor?: (ref: string) => string | null
  audit?: (event: string, data: Record<string, unknown>) => void
}

const DEFAULT_DEADLINE_MS = 10_000
const SNAPSHOT_KEEP = 5

/** Parse a `route:<class>` / `tag:<tag>` / `policy:*` / `agent:<id>:<field>` ref. */
function parseRef(ref: string): { kind: 'policy'; field: string; name?: string } | { kind: 'agent'; agentId: string; field: 'model' | 'subagentModel' } | { kind: 'route'; workClass: WorkClass } | { kind: 'tag'; tag: string } | { kind: 'ui' } {
  const parts = ref.split(':')
  if (parts[0] === 'policy' && parts[1]) return { kind: 'policy', field: parts[1], ...(parts[2] !== undefined ? { name: parts.slice(2).join(':') } : {}) }
  if (parts[0] === 'agent' && parts[1] && (parts[2] === 'model' || parts[2] === 'subagentModel')) return { kind: 'agent', agentId: parts[1], field: parts[2] }
  if (parts[0] === 'route' && parts[1] && (ROUTABLE_WORK_CLASSES as readonly string[]).includes(parts[1])) return { kind: 'route', workClass: parts[1] as WorkClass }
  if (parts[0] === 'tag' && parts.length >= 2) return { kind: 'tag', tag: parts.slice(1).join(':') }
  if (ref === 'ui:mode') return { kind: 'ui' }
  throw new MutationRefused('unknown_ref', `unknown selection ref: ${ref}`, { ref })
}

function readPending(stateDir: string): PendingRecord[] {
  const file = join(stateDir, 'pending-writes.json')
  if (!existsSync(file)) return []
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { writes?: PendingRecord[] }
    return Array.isArray(parsed.writes) ? parsed.writes : []
  } catch (err) {
    log.warn('pending-writes.json unreadable; treating as empty', { error: String(err) })
    return []
  }
}

function writePending(stateDir: string, writes: PendingRecord[]): void {
  mkdirSync(stateDir, { recursive: true })
  const file = join(stateDir, 'pending-writes.json')
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify({ writes }, null, 2))
  renameSync(tmp, file)
}

let snapshotSeq = 0

function writeSnapshot(stateDir: string, revision: string, states: SelectionState[]): string {
  const dir = join(stateDir, 'snapshots')
  mkdirSync(dir, { recursive: true })
  // Timestamp + process-monotonic sequence: two resets in one millisecond
  // must not overwrite each other, and lexical order must stay chronological.
  snapshotSeq = (snapshotSeq + 1) % 1000
  const name = `${new Date().toISOString().replace(/[:.]/g, '-')}-${String(snapshotSeq).padStart(3, '0')}.json`
  const file = join(dir, name)
  writeFileSync(file, JSON.stringify({ takenAt: Date.now(), revision, states }, null, 2))
  const all = readdirSync(dir).filter((f) => f.endsWith('.json')).sort()
  for (const stale of all.slice(0, Math.max(0, all.length - SNAPSHOT_KEEP))) rmSync(join(dir, stale), { force: true })
  return file
}

/** True when a state carries a real thinking override (absent / `inherit` do not). */
function hasThinking(s: Pick<SelectionState, 'thinking'>): boolean {
  return s.thinking !== undefined && s.thinking !== 'inherit'
}

/**
 * Snapshot → current diff: every ref that differs becomes an op; refs
 * present now but absent then are cleared. FULL state: the page mode rides
 * along, and a thinking-only override (a tag with no model) counts.
 */
export function buildRestoreOps(snapshot: readonly SelectionState[], current: readonly SelectionState[]): MutationOp[] {
  const ops: MutationOp[] = []
  const currentByRef = new Map(current.map((s) => [s.ref, s]))
  for (const s of snapshot) {
    const c = currentByRef.get(s.ref)
    if (c && c.model === s.model && (c.thinking ?? null) === (s.thinking ?? null)) continue
    const set: MutationOp['set'] = { model: s.model }
    if (s.thinking !== undefined || (c && c.thinking !== undefined)) set.thinking = s.thinking ?? null
    ops.push({ ref: s.ref, set })
  }
  const snapshotRefs = new Set(snapshot.map((s) => s.ref))
  for (const c of current) {
    if (snapshotRefs.has(c.ref) || (c.model === null && !hasThinking(c))) continue
    // Only refs that can be REMOVED are cleared (fallbacks, aliases, tags);
    // fixed refs (routes, agents, policy defaults) absent from a snapshot
    // simply were not captured and are left alone.
    if (c.ref.startsWith('tag:') || c.ref.startsWith('policy:alias:') || c.ref.startsWith('policy:fallback:')) {
      ops.push({ ref: c.ref, set: { model: null, thinking: null } })
    }
  }
  return ops
}

interface PlannedWrite {
  document: SelectionDocument
  refs: string[]
  previous: Record<string, string | null>
  intended: Record<string, string | null>
  run: () => Promise<void>
}

export function createSelectionMutator(deps: MutationDeps) {
  const deadlineMs = deps.deadlineMs ?? DEFAULT_DEADLINE_MS
  /** In-process reservations: document → the unsettled adapter promise. */
  const unsettled = new Map<SelectionDocument, Promise<void>>()
  let chain: Promise<unknown> = Promise.resolve()

  const eligibilityDeps: EligibilityDeps | undefined = deps.listOpenRejections ? { listOpenRejections: deps.listOpenRejections } : undefined

  async function currentStates(): Promise<SelectionState[]> {
    const { routing, uiMode } = deps.loadRouting()
    return enumerateSelections(deps.runtime, { routing, uiMode })
  }

  /** Classify prior-boot records by re-read; keep in-process records as they are. */
  async function reconcileRecords(states: SelectionState[]): Promise<PendingRecord[]> {
    const records = readPending(deps.stateDir)
    if (records.length === 0) return records
    const byRef = new Map(states.map((s) => [s.ref, s.model]))
    const kept: PendingRecord[] = []
    let changed = false
    for (const r of records) {
      if (r.bootId === deps.bootId || r.failed || r.conflict) {
        kept.push(r)
        continue
      }
      const matches = (target: Record<string, string | null>) => r.refs.every((ref) => (byRef.get(ref) ?? null) === (target[ref] ?? null))
      if (matches(r.intended)) {
        changed = true // resolved ⇒ dropped
        deps.audit?.('models.pending_write_resolved', { document: r.document, refs: r.refs, via: 'restart' })
        continue
      }
      changed = true
      if (matches(r.previous)) kept.push({ ...r, failed: 'not confirmed before restart' })
      else kept.push({ ...r, conflict: true })
    }
    if (changed) writePending(deps.stateDir, kept)
    return kept
  }

  function toStatus(records: PendingRecord[]): PendingStatus[] {
    return records.map((r) => ({
      document: r.document,
      refs: r.refs,
      intended: r.intended,
      state: r.conflict ? 'conflict' : r.failed ? 'failed' : 'unsettled',
      ...(r.failed ? { detail: r.failed } : r.conflict ? { detail: 'changed outside Bakin while a write was pending' } : {}),
      startedAt: r.startedAt,
    }))
  }

  async function reconcile(): Promise<ReconcileResult> {
    const states = await currentStates()
    const records = await reconcileRecords(states)
    return { states, revision: computeRevision(states), pending: toStatus(records) }
  }

  function reservedDocuments(records: PendingRecord[]): Set<SelectionDocument> {
    const reserved = new Set<SelectionDocument>(unsettled.keys())
    for (const r of records) if (!r.failed) reserved.add(r.document) // conflict + unsettled reserve; failed frees
    return reserved
  }

  async function plan(ops: MutationOp[], states: SelectionState[], revision: string): Promise<{ writes: PlannedWrite[]; warnings: string[] }> {
    const support = deps.runtime.models.routingSupport()
    const byRef = new Map(states.map((s) => [s.ref, s]))
    const warnings: string[] = []

    // Eligibility for every model being SET, plus the current states (for
    // proposals) — each judged under the credentials of the agent it belongs
    // to (an agent pin is only as runnable as THAT agent's keys).
    const targets: SelectionState[] = ops
      .filter((o) => typeof o.set.model === 'string' && o.set.model.length > 0)
      .map((o) => ({ ref: o.ref, model: o.set.model as string, document: documentOf(o.ref), label: o.ref }))
    const evaluation = await evaluateSelections(deps.runtime, [...targets, ...states], eligibilityDeps)
    for (const op of ops) {
      const parsed = parseRef(op.ref)
      if (parsed.kind === 'ui') continue
      const model = op.set.model
      if (typeof model !== 'string' || model.length === 0) continue
      const e = evaluation.eligibilityOf({ ref: op.ref, model })
      if (e?.status === 'ineligible') {
        const [proposal] = proposeRepairs([{ ref: op.ref, model, document: documentOf(op.ref), label: op.ref }], evaluation.reportFor, { recommendFor: deps.recommendFor ?? (() => null), revision })
        throw new MutationRefused('model_not_eligible', `${model} cannot run here: ${e.detail}`, { ref: op.ref, reason: e.reason, ...(proposal && proposal.to ? { proposal } : {}) })
      }
      if (!e || e.status === 'unknown') warnings.push(`${op.ref}: could not verify ${model} (${e?.detail ?? 'no evidence'}) — saved anyway`)
    }

    // Runtime support: a knob the runtime ignores must never be stored.
    for (const op of ops) {
      const parsed = parseRef(op.ref)
      const setsValue = typeof op.set.model === 'string' && op.set.model.length > 0
      if (parsed.kind === 'agent' && parsed.field === 'subagentModel' && !support.perAgentSubagentModel) {
        throw new MutationRefused('unsupported_by_runtime', 'this runtime has no per-agent subagent model', { ref: op.ref })
      }
      if (parsed.kind === 'policy') {
        if (parsed.field === 'fallback' && setsValue && !support.fallbackModels) throw new MutationRefused('unsupported_by_runtime', 'this runtime has no fallback models', { ref: op.ref })
        if (parsed.field === 'defaultSubagentModel' && setsValue && !support.defaultSubagentModel) throw new MutationRefused('unsupported_by_runtime', 'this runtime has no default subagent model', { ref: op.ref })
        if (parsed.field === 'alias' && setsValue && !support.aliases) throw new MutationRefused('unsupported_by_runtime', 'this runtime has no model aliases', { ref: op.ref })
      }
    }

    // Group per document.
    const groups = new Map<SelectionDocument, MutationOp[]>()
    for (const op of ops) {
      const doc = documentOf(op.ref)
      ;(groups.get(doc) ?? groups.set(doc, []).get(doc)!).push(op)
    }

    const writes: PlannedWrite[] = []
    const order = (d: SelectionDocument) => (d === 'policy' ? 0 : d === 'routing' ? 1 : 2)
    for (const [document, docOps] of [...groups.entries()].sort(([a], [b]) => order(a) - order(b))) {
      const refs = docOps.map((o) => o.ref)
      const previous: Record<string, string | null> = {}
      const intended: Record<string, string | null> = {}
      for (const op of docOps) {
        previous[op.ref] = byRef.get(op.ref)?.model ?? null
        intended[op.ref] = op.set.model === undefined ? (byRef.get(op.ref)?.model ?? null) : op.set.model
      }

      if (document === 'policy') {
        const policy = await deps.runtime.models.routingPolicy()
        const patch: Partial<RuntimeRoutingPolicy> = {}
        let fallbacks: string[] | null = null
        let aliases: Record<string, string> | null = null
        for (const op of docOps) {
          const parsed = parseRef(op.ref) as { kind: 'policy'; field: string; name?: string }
          if (parsed.field === 'defaultModel') patch.defaultModel = op.set.model ?? ''
          else if (parsed.field === 'defaultSubagentModel') patch.defaultSubagentModel = op.set.model ?? null
          else if (parsed.field === 'fallback') {
            fallbacks ??= [...policy.fallbackModels]
            const n = Number(parsed.name)
            if (op.set.model === null) fallbacks[n] = ''
            else if (typeof op.set.model === 'string') fallbacks[n] = op.set.model
          } else if (parsed.field === 'alias' && parsed.name) {
            aliases ??= { ...policy.aliases }
            if (op.set.model === null) delete aliases[parsed.name]
            else if (typeof op.set.model === 'string') aliases[parsed.name] = op.set.model
          } else throw new MutationRefused('unknown_ref', `unknown policy field in ${op.ref}`, { ref: op.ref })
        }
        if (fallbacks) patch.fallbackModels = fallbacks.filter((m) => m.length > 0)
        if (aliases) patch.aliases = aliases
        writes.push({ document, refs, previous, intended, run: () => deps.runtime.models.setRoutingPolicy(patch, 'models.selections') })
        continue
      }

      if (document === 'routing') {
        writes.push({
          document, refs, previous, intended,
          run: async () => {
            const { routing, uiMode } = deps.loadRouting()
            const routes = routing.routes.map((r) => ({ ...r }))
            const tagOverrides = routing.tagOverrides.map((t) => ({ ...t }))
            let nextMode = uiMode
            for (const op of docOps) {
              const parsed = parseRef(op.ref)
              if (parsed.kind === 'route') {
                let route = routes.find((r) => r.workClass === parsed.workClass)
                if (!route) { route = { workClass: parsed.workClass }; routes.push(route) }
                if (op.set.model !== undefined) { if (op.set.model) route.model = op.set.model; else delete route.model }
                if (op.set.thinking !== undefined) { if (op.set.thinking) route.thinking = op.set.thinking; else delete route.thinking }
              } else if (parsed.kind === 'tag') {
                const idx = tagOverrides.findIndex((t) => t.tag === parsed.tag)
                const tag = idx >= 0 ? tagOverrides[idx]! : { tag: parsed.tag }
                if (op.set.model !== undefined) { if (op.set.model) tag.model = op.set.model; else delete tag.model }
                if (op.set.thinking !== undefined) { if (op.set.thinking) tag.thinking = op.set.thinking; else delete tag.thinking }
                const empty = !tag.model && !tag.thinking
                if (idx >= 0) { if (empty) tagOverrides.splice(idx, 1) } else if (!empty) tagOverrides.push(tag)
              } else if (parsed.kind === 'ui') {
                nextMode = op.set.model === 'simple' || op.set.model === 'advanced' ? op.set.model : null
              }
            }
            // A route with neither model nor thinking is not a route.
            deps.saveRouting({ routes: routes.filter((r) => r.model || r.thinking), tagOverrides }, nextMode)
          },
        })
        continue
      }

      // agent:<id>
      const agentId = document.slice('agent:'.length)
      const input: UpdateRuntimeAgentInput = {}
      for (const op of docOps) {
        const parsed = parseRef(op.ref) as { kind: 'agent'; field: 'model' | 'subagentModel' }
        if (op.set.model !== undefined) input[parsed.field] = op.set.model
      }
      writes.push({ document, refs, previous, intended, run: async () => { await deps.runtime.agents.update(agentId, input) } })
    }
    return { writes, warnings }
  }

  async function mutateLocked(request: MutateRequest): Promise<MutateResult> {
    const states = await currentStates()
    const records = await reconcileRecords(states)
    const revision = computeRevision(states)
    if (request.revision !== revision) {
      throw new MutationRefused('stale_revision', 'the configuration changed since this change was planned', { current: revision })
    }
    for (const op of request.ops) parseRef(op.ref) // unknown refs refuse before any validation side effects
    const reserved = reservedDocuments(records)
    for (const op of request.ops) {
      const doc = documentOf(op.ref)
      if (reserved.has(doc)) throw new MutationRefused('write_pending', `a write to ${doc} is still pending`, { ref: op.ref, document: doc })
    }

    const { writes, warnings } = await plan(request.ops, states, revision)
    let snapshot: string | undefined
    if (request.snapshot === 'reset') {
      snapshot = writeSnapshot(deps.stateDir, revision, states)
      deps.audit?.('models.snapshot_written', { file: snapshot, reason: 'reset' })
    }

    const result: MutateResult = { applied: [], failed: [], pending: [], warnings, revision, ...(snapshot ? { snapshot } : {}) }
    // A retried document whose earlier record FAILED is being replaced now.
    // Every write to the pending file below re-reads it first — including
    // this one: `records` was read BEFORE the asynchronous plan() above, and
    // a detached settle can land during planning or while a LATER write is
    // still awaiting its deadline. Writing from a stale in-memory list would
    // resurrect that record (a document reserved until restart).
    const retried = new Set(writes.map((w) => w.document))
    const dropReplacedFailures = (list: PendingRecord[]) => list.filter((r) => !(r.failed && retried.has(r.document)))
    writePending(deps.stateDir, dropReplacedFailures(readPending(deps.stateDir)))

    for (const w of writes) {
      let settled = false
      const promise = w.run().then(
        () => { settled = true },
        (err) => { settled = true; throw err },
      )
      const timeout = new Promise<'timeout'>((res) => setTimeout(() => res('timeout'), deadlineMs))
      const outcome = await Promise.race([promise.then(() => 'ok' as const, (err) => ({ err })), timeout])
      if (outcome === 'ok') {
        result.applied.push(...w.refs)
        continue
      }
      if (outcome !== 'timeout') {
        const message = outcome.err instanceof Error ? outcome.err.message : String(outcome.err)
        result.failed.push(...w.refs.map((ref) => ({ ref, error: { code: 'write_failed' as const, message } })))
        continue
      }
      // Unsettled past the deadline: record + reserve; the detached promise owns the release.
      void settled
      const record: PendingRecord = { document: w.document, refs: w.refs, previous: w.previous, intended: w.intended, startedAt: Date.now(), revision, bootId: deps.bootId }
      writePending(deps.stateDir, [...readPending(deps.stateDir).filter((r) => r.document !== w.document), record])
      result.pending.push(...w.refs.map((ref) => ({ ref, intended: w.intended[ref] ?? null })))
      const detached = promise.then(
        () => {
          unsettled.delete(w.document)
          writePending(deps.stateDir, readPending(deps.stateDir).filter((r) => !(r.document === w.document && r.startedAt === record.startedAt)))
          deps.audit?.('models.pending_write_resolved', { document: w.document, refs: w.refs, via: 'settled' })
        },
        (err) => {
          unsettled.delete(w.document)
          const message = err instanceof Error ? err.message : String(err)
          writePending(deps.stateDir, readPending(deps.stateDir).map((r) => (r.document === w.document && r.startedAt === record.startedAt ? { ...r, failed: message } : r)))
          deps.audit?.('models.pending_write_failed', { document: w.document, refs: w.refs, message })
        },
      )
      unsettled.set(w.document, detached)
    }

    result.revision = computeRevision(await currentStates())
    deps.audit?.('models.selections_mutated', {
      ops: request.ops, applied: result.applied, failed: result.failed.map((f) => f.ref), pending: result.pending.map((p) => p.ref), snapshot: request.snapshot ?? null,
    })
    return result
  }

  function mutate(request: MutateRequest): Promise<MutateResult> {
    const run = chain.then(() => mutateLocked(request))
    chain = run.catch(() => undefined)
    return run
  }

  /** Operator acknowledgement of a conflict record frees its document. */
  function acknowledgeConflict(document: SelectionDocument): void {
    writePending(deps.stateDir, readPending(deps.stateDir).filter((r) => !(r.document === document && r.conflict)))
  }

  return { mutate, reconcile, acknowledgeConflict }
}

export type SelectionMutator = ReturnType<typeof createSelectionMutator>
export type { OpenRejection }
