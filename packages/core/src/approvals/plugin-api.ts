/**
 * The ONE implementation of `ctx.approvals` (spec D26), shared by the host
 * and the SDK testing harness — each injects its own backend (the real
 * approvals service, or an in-memory store), so the namespacing rules are
 * identical in production and in plugin authors' tests.
 *
 * Rules: the owner's `pluginId` comes from the context, never the caller;
 * approval ids must start with `<pluginId>:`; a plugin can read, cancel or
 * re-request only its OWN plugin-gate records (a pending record's owner is
 * refreshed on re-request, so an unchecked id could take over another
 * owner's approval).
 */
import type {
  PluginApproval,
  PluginApprovalDecision,
  PluginApprovalOption,
  PluginApprovalsAPI,
  PluginGateHandler,
} from '@makinbakin/sdk/types'
import type { ApprovalProvenance } from '../adapters/runtime/channels'
import { describeApprovalProvenance } from './provenance'
import type { ApprovalOwner, ApprovalRecord, ApprovalRequest } from './types'

type PluginGateRecord = ApprovalRecord & { owner: Extract<ApprovalOwner, { kind: 'plugin-gate' }> }

/** A decision as the core kind handler receives it. */
export interface CoreGateDecision {
  option: string
  comment?: string
  respondedAt?: string
  provenance: ApprovalProvenance
}

export interface CoreGateHandler {
  ownerState(record: PluginGateRecord): Promise<'live' | 'orphaned' | 'unknown'>
  onResolve(record: PluginGateRecord, decision: CoreGateDecision): Promise<unknown>
}

export interface PluginApprovalsBackend {
  request(input: { approvalId: string; owner: ApprovalOwner; request: ApprovalRequest }): ApprovalRecord
  get(approvalId: string): ApprovalRecord | null
  listPending(): ApprovalRecord[]
  cancel(approvalId: string, reason: string): Promise<ApprovalRecord | null>
  registerGate(pluginId: string, gateKind: string, handler: CoreGateHandler): () => void
  refusal(message: string, status: 400 | 409): Error
}

export const DEFAULT_GATE_OPTIONS: PluginApprovalOption[] = [
  { id: 'approve', label: 'Approve', variant: 'primary' },
  { id: 'reject', label: 'Reject', variant: 'destructive' },
]

function isOwned(record: ApprovalRecord | null, pluginId: string): record is PluginGateRecord {
  return record?.owner.kind === 'plugin-gate' && record.owner.pluginId === pluginId
}

export function toPluginApproval(record: PluginGateRecord): PluginApproval {
  const { owner, request, response } = record
  return {
    approvalId: record.approvalId,
    gateKind: owner.gateKind,
    entityId: owner.entityId,
    taskId: owner.taskId,
    status: record.status,
    title: request.title,
    summary: request.body,
    options: request.options.map((o) => ({ ...o })),
    createdAt: record.createdAt,
    ...(record.resolvedAt ? { resolvedAt: record.resolvedAt } : {}),
    ...(response
      ? {
          response: {
            option: response.selectedOption,
            respondedAt: response.respondedAt,
            ...(response.comment !== undefined ? { comment: response.comment } : {}),
            ...(response.provenance ? { decidedBy: describeApprovalProvenance(response.provenance) } : {}),
          },
        }
      : {}),
  }
}

/**
 * The ONE reject-reason rule (host dispatcher and SDK harness): a reject typed
 * on a Bakin surface needs a reason when the setting asks for one; a channel
 * button without a reason modal is the provider's decision.
 */
export function rejectReasonMissing(decision: CoreGateDecision, requireRejectReason: boolean): boolean {
  const typedSurface = decision.provenance.channel !== 'discord' && decision.provenance.channel !== 'runtime'
  return decision.option === 'reject' && !decision.comment?.trim() && typedSurface && requireRejectReason
}

function toPluginDecision(decision: CoreGateDecision): PluginApprovalDecision {
  return {
    option: decision.option,
    ...(decision.comment ? { comment: decision.comment } : {}),
    respondedAt: decision.respondedAt ?? new Date().toISOString(),
    decidedBy: describeApprovalProvenance(decision.provenance),
  }
}

/**
 * Option ids travel through every decision transport — Discord custom ids
 * split on `:`, the decision endpoint caps them at 64 — so only ids every
 * transport round-trips losslessly are accepted.
 */
const OPTION_ID = /^[A-Za-z0-9_-]{1,64}$/

function validOptions(options: PluginApprovalOption[]): PluginApprovalOption[] {
  const seen = new Set<string>()
  for (const option of options) {
    if (!OPTION_ID.test(option.id)) {
      throw new Error(`ctx.approvals.request: option id "${option.id}" must be 1–64 characters of letters, digits, "-" or "_"`)
    }
    if (seen.has(option.id)) throw new Error(`ctx.approvals.request: option id "${option.id}" is offered twice`)
    if (!option.label?.trim()) throw new Error(`ctx.approvals.request: option "${option.id}" needs a label`)
    seen.add(option.id)
  }
  return options
}

function requireText(field: string, value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`ctx.approvals.request: ${field} is required`)
  return value
}

export function createPluginApprovalsAPI(pluginId: string, backend: PluginApprovalsBackend): PluginApprovalsAPI {
  const prefix = `${pluginId}:`
  return {
    registerGate(gateKind: string, handler: PluginGateHandler) {
      requireText('gateKind', gateKind)
      return backend.registerGate(pluginId, gateKind, {
        ownerState: async (record) => handler.ownerState(toPluginApproval(record)),
        onResolve: async (record, decision) => {
          // Only what the approval offered reaches plugin code — an unoffered
          // id would otherwise take whichever branch the gate falls through to.
          if (!record.request.options.some((o) => o.id === decision.option)) {
            throw backend.refusal(`"${decision.option}" is not an option on this approval`, 400)
          }
          return handler.onResolve(toPluginApproval(record), toPluginDecision(decision))
        },
      })
    },

    request(input) {
      const approvalId = requireText('approvalId', input.approvalId)
      if (!approvalId.startsWith(prefix) || approvalId.length === prefix.length) {
        throw new Error(`ctx.approvals.request: approvalId must start with "${prefix}" — got "${approvalId}"`)
      }
      const existing = backend.get(approvalId)
      if (existing && !isOwned(existing, pluginId)) {
        throw new Error(`ctx.approvals.request: approval "${approvalId}" belongs to another owner`)
      }
      // Pending or decided, an existing id is never rewritten (spec D26): a
      // refresh could swap the subject under a resolver mid-decision. A
      // changed request is a new generation — a new id.
      if (existing) return toPluginApproval(existing)
      const options = input.options?.length ? validOptions(input.options) : DEFAULT_GATE_OPTIONS
      const record = backend.request({
        approvalId,
        owner: {
          kind: 'plugin-gate',
          pluginId,
          gateKind: requireText('gateKind', input.gateKind),
          entityId: requireText('entityId', input.entityId),
          taskId: requireText('taskId', input.taskId),
        },
        request: { title: requireText('title', input.title), body: input.summary ?? '', options },
      })
      return toPluginApproval(record as PluginGateRecord)
    },

    async cancel(approvalId, reason) {
      if (!isOwned(backend.get(approvalId), pluginId)) return null
      const cancelled = await backend.cancel(approvalId, reason)
      return isOwned(cancelled, pluginId) ? toPluginApproval(cancelled) : null
    },

    get(approvalId) {
      const record = backend.get(approvalId)
      return isOwned(record, pluginId) ? toPluginApproval(record) : null
    },

    listPending(filter = {}) {
      return backend.listPending()
        .filter((record): record is PluginGateRecord => isOwned(record, pluginId))
        .filter((record) => !filter.entityId || record.owner.entityId === filter.entityId)
        .filter((record) => !filter.gateKind || record.owner.gateKind === filter.gateKind)
        .map(toPluginApproval)
    },

    refusal: (message, status = 409) => backend.refusal(message, status),
  }
}

/** A refusal thrown by the in-memory backend — carries the status like the host's ApprovalResolveError. */
export class PluginApprovalRefusal extends Error {
  constructor(message: string, readonly status: 400 | 409) {
    super(message)
    this.name = 'PluginApprovalRefusal'
  }
}

export interface MemoryApprovalsBackend extends PluginApprovalsBackend {
  /**
   * Decide a pending approval the way the operator would: runs the plugin's
   * gate (a refusal rejects and leaves it pending), then records the
   * decision. Throws when no gate is registered for it.
   */
  resolve(approvalId: string, option: string, comment?: string): Promise<ApprovalRecord>
}

/**
 * In-memory backend for the SDK testing harness and host test contexts — no
 * files, no events. `requireRejectReason` mirrors the host setting (default
 * on, as on the host).
 */
export function createMemoryApprovalsBackend(opts: { requireRejectReason?: boolean } = {}): MemoryApprovalsBackend {
  const requireRejectReason = opts.requireRejectReason ?? true
  const records = new Map<string, ApprovalRecord>()
  const gates = new Map<string, CoreGateHandler>()
  // The host's resolve guards: one resolver at a time, and the decision only
  // lands on a record that is STILL pending after the gate ran (CAS).
  const resolving = new Set<string>()
  const gateKey = (pluginId: string, gateKind: string) => `${pluginId}\u0000${gateKind}`
  return {
    request({ approvalId, owner, request: input }) {
      const now = new Date().toISOString()
      const request = { ...input, context: { ...input.context, requireRejectReason } }
      const existing = records.get(approvalId)
      if (existing && existing.status !== 'pending') return existing
      const record: ApprovalRecord = existing
        ? { ...existing, owner, request, updatedAt: now }
        : { approvalId, owner, request, status: 'pending', deliveries: [], createdAt: now, updatedAt: now }
      records.set(approvalId, record)
      return record
    },
    get: (approvalId) => records.get(approvalId) ?? null,
    listPending: () => [...records.values()].filter((r) => r.status === 'pending'),
    async cancel(approvalId) {
      const record = records.get(approvalId)
      if (!record) return null
      if (record.status !== 'pending') return record
      const now = new Date().toISOString()
      const cancelled: ApprovalRecord = { ...record, status: 'cancelled', updatedAt: now, resolvedAt: now }
      records.set(approvalId, cancelled)
      return cancelled
    },
    registerGate(pluginId, gateKind, handler) {
      const key = gateKey(pluginId, gateKind)
      gates.set(key, handler)
      return () => {
        if (gates.get(key) === handler) gates.delete(key)
      }
    },
    refusal: (message, status) => new PluginApprovalRefusal(message, status),
    async resolve(approvalId, option, comment) {
      const record = records.get(approvalId)
      if (!record || record.status !== 'pending' || record.owner.kind !== 'plugin-gate') {
        throw new Error(`No pending plugin approval "${approvalId}"`)
      }
      const gate = gates.get(gateKey(record.owner.pluginId, record.owner.gateKind))
      if (!gate) throw new Error(`No gate registered for ${record.owner.pluginId}/${record.owner.gateKind}`)
      if (resolving.has(approvalId)) throw new Error(`Approval "${approvalId}" is already being resolved`)
      resolving.add(approvalId)
      const respondedAt = new Date().toISOString()
      const provenance: ApprovalProvenance = { channel: 'ui', actor: { kind: 'operator-declared' }, evidence: 'declared' }
      if (rejectReasonMissing({ option, comment, provenance }, requireRejectReason)) {
        resolving.delete(approvalId)
        throw new PluginApprovalRefusal('A reject reason is required', 400)
      }
      try {
        await gate.onResolve(record as PluginGateRecord, { option, ...(comment ? { comment } : {}), respondedAt, provenance })
      } finally {
        resolving.delete(approvalId)
      }
      const current = records.get(approvalId)
      if (current?.status !== 'pending') throw new Error(`Approval "${approvalId}" is no longer pending (${current?.status ?? 'deleted'})`)
      const resolved: ApprovalRecord = {
        ...current,
        status: option === 'reject' || option === 'dismiss' ? 'rejected' : 'approved',
        response: { selectedOption: option, respondedAt, provenance, ...(comment !== undefined ? { comment } : {}) },
        updatedAt: respondedAt,
        resolvedAt: respondedAt,
      }
      records.set(approvalId, resolved)
      return resolved
    },
  }
}
