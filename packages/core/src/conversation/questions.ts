/**
 * Structured questions — an agent asks ONE question with options and a
 * recommendation; the conversation kit renders an answerable card.
 *
 * Runtime transports cannot carry the structured question (Pi emits only a
 * one-line result summary; OpenClaw clips previews at 500 chars), so the
 * exec tool returns a short `bakin-question:<id>` token and parks the full
 * question in the in-process registry; the turn engine swaps the token for
 * `metadata.bakinQuestion` before emitting and persisting the row.
 *
 * Type homes: `BakinQuestion` here (zod-inferred, server) mirrors the
 * canonical `@makinbakin/sdk/types` declaration and the dependency-free UI
 * copy; the SDK's private message-contract module pins all three.
 */
import { z } from 'zod'

export const QUESTION_LIMITS = {
  question: 200,
  label: 60,
  description: 160,
  minOptions: 2,
  maxOptions: 5,
  /** JSON-serialized size cap — field caps alone do not bound escaped JSON. */
  serializedBytes: 2048,
} as const

const QUESTION_ID_RE = /^q_[a-z0-9]{16}$/
const QUESTION_TOKEN_RE = /bakin-question:(q_[a-z0-9]{16})/

const optionSchema = z.object({
  label: z.string().trim().min(1).max(QUESTION_LIMITS.label),
  description: z.string().trim().min(1).max(QUESTION_LIMITS.description).optional(),
}).strict()

const questionFields = {
  question: z.string().trim().min(1).max(QUESTION_LIMITS.question),
  options: z.array(optionSchema).min(QUESTION_LIMITS.minOptions).max(QUESTION_LIMITS.maxOptions),
  recommended: z.number().int().min(0).optional(),
}

type QuestionShape = {
  question: string
  options: { label: string; description?: string }[]
  recommended?: number
}

function checkQuestion(value: QuestionShape, ctx: z.RefinementCtx): void {
  if (value.recommended !== undefined && value.recommended >= value.options.length) {
    ctx.addIssue({ code: 'custom', path: ['recommended'], message: 'recommended must index one of the options' })
  }
  const labels = value.options.map(option => option.label.toLowerCase())
  if (new Set(labels).size !== labels.length) {
    ctx.addIssue({ code: 'custom', path: ['options'], message: 'option labels must be unique' })
  }
  if (new TextEncoder().encode(JSON.stringify(value)).length > QUESTION_LIMITS.serializedBytes) {
    ctx.addIssue({ code: 'custom', path: [], message: `question is too large (max ${QUESTION_LIMITS.serializedBytes} bytes serialized)` })
  }
}

/** What an agent passes to `bakin_exec_ask_user`. */
export const bakinQuestionInputSchema = z.object({
  ...questionFields,
  allowOther: z.boolean().default(true),
}).strict().superRefine(checkQuestion)

/** The minted, stored envelope the kit renders. */
export const bakinQuestionSchema = z.object({
  v: z.literal(1),
  id: z.string().regex(QUESTION_ID_RE),
  ...questionFields,
  allowOther: z.boolean(),
}).strict().superRefine(checkQuestion)

export type BakinQuestionInput = z.output<typeof bakinQuestionInputSchema>
export type BakinQuestion = z.output<typeof bakinQuestionSchema>

export function validateBakinQuestionInput(
  value: unknown,
): { ok: true; value: BakinQuestionInput } | { ok: false; error: string } {
  const result = bakinQuestionInputSchema.safeParse(value)
  if (result.success) return { ok: true, value: result.data }
  const issue = result.error.issues[0]
  const where = issue?.path.length ? `${issue.path.join('.')}: ` : ''
  return { ok: false, error: `${where}${issue?.message ?? 'invalid question'}` }
}

/** Parse a stored envelope; null when it is not a valid question. */
export function parseBakinQuestion(value: unknown): BakinQuestion | null {
  const result = bakinQuestionSchema.safeParse(value)
  return result.success ? result.data : null
}

export function mintQuestionId(): string {
  return `q_${globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`
}

export function questionToken(id: string): string {
  return `bakin-question:${id}`
}

/** The question id a tool result's text carries, if any. */
export function findQuestionToken(text: string | undefined): string | null {
  return text ? QUESTION_TOKEN_RE.exec(text)?.[1] ?? null : null
}

export interface QuestionRegistry {
  put(question: BakinQuestion): void
  get(id: string): BakinQuestion | null
}

/**
 * In-memory id → question map. Enrichment happens in-process within the
 * same turn, so the TTL only bounds memory; nothing is persisted here.
 */
export function createQuestionRegistry(
  { ttlMs = 10 * 60_000, now = Date.now }: { ttlMs?: number; now?: () => number } = {},
): QuestionRegistry {
  const entries = new Map<string, { question: BakinQuestion; expiresAt: number }>()
  const sweep = () => {
    const at = now()
    for (const [id, entry] of entries) if (entry.expiresAt <= at) entries.delete(id)
  }
  return {
    put(question) {
      sweep()
      entries.set(question.id, { question, expiresAt: now() + ttlMs })
    },
    get(id) {
      sweep()
      return entries.get(id)?.question ?? null
    },
  }
}

/** The process-wide registry shared by the tool and the turn engine. */
export const questionRegistry: QuestionRegistry = createQuestionRegistry()
