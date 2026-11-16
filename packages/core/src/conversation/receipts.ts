/**
 * Tool receipts — how a tool call's structured payload reaches the
 * conversation row it belongs to.
 *
 * A tool handler never learns the runtime's tool-call id, and no runtime
 * transport carries structured tool output (Pi emits a one-line summary,
 * OpenClaw clips previews at 500 chars). So when a result carries something
 * the conversation must render, the host parks it here under a fresh id and
 * serialises the result inside a fixed outer envelope:
 *
 *   {"receipt":"bakin-receipt:<id>","result":{…}}
 *
 * The envelope is host-controlled — the token always leads the text, whatever
 * keys the tool returned — and the turn engine swaps the token for row
 * metadata. A receipt is bound to the tool and agent that produced it, so a
 * different tool that merely quotes a live token cannot take it.
 */
import { z } from 'zod'
import type { EntityRef } from '@makinbakin/sdk/types'
import type { ChatChunk } from '../adapters/runtime/concepts'
import { parseBakinQuestion, type BakinQuestion } from './questions'

const RECEIPT_TOKEN_RE = /bakin-receipt:(r_[a-z0-9]{16})/

/** Who produced a receipt; the only caller allowed to redeem it. */
export interface ReceiptOwner {
  agentId: string
  toolName: string
}

export interface ToolReceipt extends ReceiptOwner {
  id: string
  question?: BakinQuestion
  entities?: EntityRef[]
}

/** Bounds on what one tool call may report. */
export const ENTITY_REF_LIMITS = { title: 200, perResult: 50 } as const

const entityRefSchema = z.object({
  kind: z.string().regex(/^[a-z][a-z0-9-]{0,39}:[a-z][a-z0-9-]{0,39}$/),
  id: z.string().min(1).max(512),
  title: z.string().trim().min(1).transform((title) => title.slice(0, ENTITY_REF_LIMITS.title)),
  action: z.enum(['created', 'updated']),
  params: z.record(z.string(), z.string().min(1).max(512)).optional(),
}).strict()

export interface ReceiptRegistry {
  put(receipt: ToolReceipt): void
  /**
   * Remove and return a receipt — honoured exactly once, and only for the
   * tool and agent that produced it. A mismatched caller leaves it in place.
   */
  take(id: string, owner: ReceiptOwner): ToolReceipt | null
}

function mintReceiptId(): string {
  return `r_${globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
}

/**
 * The envelope at the very start of a tool's output — as plain text, or as the
 * JSON-escaped text of an MCP `content` wrapper. Redemption requires this
 * position: an ordinary result is never shaped like it, so a later call that
 * merely echoes a live token (in a field, in an error) cannot redeem it.
 */
const RECEIPT_ENVELOPE_RE =
  /^\s*(?:\{\s*"content":\s*\[\s*\{\s*(?:"type":\s*"text",\s*)?"text":\s*")?\{(?:\\n|\s)*\\?"receipt\\?":\s*\\?"bakin-receipt:(r_[a-z0-9]{16})\\?"/

/** The receipt id a tool output opens with, if it is a sealed envelope. */
export function envelopeReceiptId(text: string | undefined): string | null {
  return text ? RECEIPT_ENVELOPE_RE.exec(text)?.[1] ?? null : null
}

/** The receipt id a tool result's text carries, if any. */
export function findReceiptToken(text: string | undefined): string | null {
  return text ? RECEIPT_TOKEN_RE.exec(text)?.[1] ?? null : null
}

/**
 * In-memory id → receipt map. Redemption happens in-process within the same
 * turn, so nothing is persisted: the TTL and the capacity bound cap what
 * orphans (a dispatch run never reaches the turn engine) can hold. Insertion
 * order is expiry order — every entry gets the same TTL — so a sweep stops at
 * the first live entry.
 */
export function createReceiptRegistry(
  { ttlMs = 10 * 60_000, capacity = 256, now = Date.now }: { ttlMs?: number; capacity?: number; now?: () => number } = {},
): ReceiptRegistry {
  const entries = new Map<string, { receipt: ToolReceipt; expiresAt: number }>()
  const sweep = () => {
    const at = now()
    for (const [id, entry] of entries) {
      if (entry.expiresAt > at) break
      entries.delete(id)
    }
  }
  return {
    put(receipt) {
      sweep()
      entries.set(receipt.id, { receipt, expiresAt: now() + ttlMs })
      while (entries.size > capacity) entries.delete(entries.keys().next().value!)
    },
    take(id, owner) {
      sweep()
      const receipt = entries.get(id)?.receipt
      if (!receipt || receipt.agentId !== owner.agentId || receipt.toolName !== owner.toolName) return null
      entries.delete(id)
      return receipt
    },
  }
}

/** The process-wide registry shared by the tool invoke paths and the turn engine. */
export const receiptRegistry: ReceiptRegistry = createReceiptRegistry()

export interface SealOptions {
  registry?: ReceiptRegistry
  /** Kinds the tool's manifest entry declares (`contributes.execTools[].reports`). */
  reports?: readonly string[]
  /** Called with the references that were dropped: malformed, or a kind the tool does not declare. */
  onRejected?: (refs: unknown[]) => void
}

/**
 * Serialise a successful tool result for the agent. A result with nothing for
 * the conversation serialises as-is; otherwise the payload (a question, the
 * entities the call created or changed) is parked in the registry, removed
 * from what the agent reads, and the rest is wrapped in the receipt envelope.
 * Only kinds the tool declares are carried. THE one serialiser for both
 * invoke paths.
 */
export function sealToolResult(
  result: Record<string, unknown>,
  owner: ReceiptOwner,
  { registry = receiptRegistry, reports = [], onRejected }: SealOptions = {},
): string {
  const { entities: reported, ...withoutEntities } = result
  const question = parseBakinQuestion(result.question)

  const entities: EntityRef[] = []
  const rejected: unknown[] = []
  for (const ref of Array.isArray(reported) ? reported : []) {
    const parsed = entityRefSchema.safeParse(ref)
    if (parsed.success && reports.includes(parsed.data.kind) && entities.length < ENTITY_REF_LIMITS.perResult) {
      entities.push(parsed.data)
    } else if (!parsed.success || !reports.includes(parsed.data.kind)) {
      rejected.push(ref)
    }
  }
  if (rejected.length > 0) onRejected?.(rejected)

  // `entities` is the host's field: an array there never reaches the agent.
  const rest = Array.isArray(reported) ? withoutEntities : result
  if (!question && entities.length === 0) return JSON.stringify(rest, null, 2)

  const { question: _carried, ...body } = rest
  const id = mintReceiptId()
  registry.put({
    id,
    ...owner,
    ...(question ? { question } : {}),
    ...(entities.length > 0 ? { entities } : {}),
  })
  return JSON.stringify({ receipt: `bakin-receipt:${id}`, result: question ? body : rest }, null, 2)
}

/**
 * Redeem the receipt a tool result chunk carries and attach its payload as
 * row metadata, so the live event and the persisted row both hold it. The
 * envelope must open the clipped output preview (both runtimes) or the chunk
 * text; a token anywhere else is ignored and the chunk returned untouched. `agentId` is the agent the turn runs
 * as: with the chunk's tool name it must match the receipt's producer, so a
 * later tool that reads a transcript or log quoting a live token never takes
 * it, and a redeemed token is gone.
 */
export function enrichReceiptChunk(
  chunk: ChatChunk,
  agentId: string,
  registry: ReceiptRegistry = receiptRegistry,
): ChatChunk {
  if (chunk.type !== 'tool' || chunk.data.phase !== 'result') return chunk
  const id = envelopeReceiptId(chunk.data.outputPreview) ?? envelopeReceiptId(chunk.content)
  const receipt = id ? registry.take(id, { agentId, toolName: chunk.data.toolName }) : null
  if (!receipt) return chunk
  return {
    ...chunk,
    data: {
      ...chunk.data,
      metadata: {
        ...chunk.data.metadata,
        ...(receipt.question ? { bakinQuestion: receipt.question } : {}),
        ...(receipt.entities ? { bakinEntities: receipt.entities } : {}),
      },
    },
  }
}
