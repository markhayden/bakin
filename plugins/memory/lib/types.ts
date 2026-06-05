/**
 * Memory plugin — shared types and Zod schemas.
 *
 * Every row written to the `bakin_memory` search table conforms to
 * `MemoryRow`. The `tier` facet discriminates row shape; per-tier details
 * are stored in `meta` (JSON-stringified) and validated at index time
 * against the per-tier meta schemas below.
 *
 * See .claude/knowledge/memory-plugin.md.
 */
import { z } from 'zod'

// ─── Tier enum ───────────────────────────────────────────────────────────────

export const MEMORY_TIERS = [
  'session',
  'turn',
  'checkpoint',
  'daily_note',
  'dream',
  'durable',
  'audit',
] as const

export const MemoryTierSchema = z.enum(MEMORY_TIERS)
export type MemoryTier = z.infer<typeof MemoryTierSchema>

// ─── SourceRef ───────────────────────────────────────────────────────────────

export const SourceRefSchema = z.object({
  backend: z.enum(['runtime', 'bakin']),
  path: z.string(),
  file: z.string(),
  offset: z.number().int().nonnegative().optional(),
  sessionId: z.string().optional(),
  eventId: z.string().optional(),
  checkpointId: z.string().optional(),
})
export type SourceRef = z.infer<typeof SourceRefSchema>

// ─── Common MemoryRow ────────────────────────────────────────────────────────

export const MemoryRowSchema = z.object({
  id: z.string(),
  tier: MemoryTierSchema,
  agent: z.string(),
  // Sub-tier discriminator. Durable tier uses this to distinguish
  // soul / rules / tools / identity / heartbeat / skill etc. Other tiers
  // leave it undefined today but the schema slot is reserved so the
  // `kind` facet registered on `bakin_memory` has a column to aggregate.
  kind: z.string().optional(),
  title: z.string(),
  snippet: z.string(),
  content: z.string(),
  sourceRef: SourceRefSchema,
  updatedAt: z.number(),
  createdAt: z.number(),
  meta: z.string(),
})
export type MemoryRow = z.infer<typeof MemoryRowSchema>

// ─── Per-tier meta schemas ───────────────────────────────────────────────────

export const SessionOriginSchema = z.object({
  label: z.string().nullable(),
  provider: z.string().nullable(),
  surface: z.string().nullable(),
  chatType: z.string().nullable(),
  from: z.string().nullable(),
  to: z.string().nullable(),
  accountId: z.string().nullable(),
})

export const SessionMetaSchema = z.object({
  sessionKey: z.string(),
  sessionId: z.string(),
  kind: z.string(),
  chatType: z.string().nullable(),
  model: z.string().nullable(),
  modelProvider: z.string().nullable(),
  inputTokens: z.number().nullable(),
  outputTokens: z.number().nullable(),
  totalTokens: z.number().nullable(),
  contextTokens: z.number().nullable(),
  estimatedCostUsd: z.number().nullable(),
  status: z.string(),
  startedAt: z.number().nullable(),
  endedAt: z.number().nullable(),
  runtimeMs: z.number().nullable(),
  abortedLastRun: z.boolean(),
  systemSent: z.boolean(),
  origin: SessionOriginSchema.nullable(),
})
export type SessionMeta = z.infer<typeof SessionMetaSchema>

export const TurnEventTypeSchema = z.enum(['message', 'tool_call', 'tool_result'])
export type TurnEventType = z.infer<typeof TurnEventTypeSchema>

export const TurnUsageSchema = z.object({
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  cacheRead: z.number().optional(),
  cacheWrite: z.number().optional(),
}).nullable()

export const TurnMetaSchema = z.object({
  sessionId: z.string(),
  sessionKey: z.string(),
  eventType: TurnEventTypeSchema,
  role: z.string().nullable(),
  parentId: z.string().nullable(),
  timestamp: z.number(),
  tool: z.string().optional(),
  toolCallId: z.string().optional(),
  usage: TurnUsageSchema.optional(),
  costUsd: z.number().nullable().optional(),
  provider: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  truncated: z.boolean(),
  rawByteOffset: z.number().nullable(),
})
export type TurnMeta = z.infer<typeof TurnMetaSchema>

export const CheckpointMetaSchema = z.object({
  sessionId: z.string(),
  checkpointId: z.string(),
  trigger: z.string(),
  tokensBefore: z.number().nullable(),
  tokensAfter: z.number().nullable(),
  summary: z.string(),
  createdAt: z.number(),
})
export type CheckpointMeta = z.infer<typeof CheckpointMetaSchema>

export const DailyNoteMetaSchema = z.object({
  file: z.string(),
  date: z.string(),
  sizeBytes: z.number().nonnegative(),
  runtimeIndexed: z.boolean(),
})
export type DailyNoteMeta = z.infer<typeof DailyNoteMetaSchema>

export const DreamArtifactTypeSchema = z.enum([
  'phase_doc',
  'short_term_recall',
  'phase_signals',
  'events_log',
  'session_corpus',
])
export type DreamArtifactType = z.infer<typeof DreamArtifactTypeSchema>

export const DreamMetaSchema = z.object({
  phase: z.string().nullable(),
  date: z.string().nullable(),
  sourceDay: z.string().nullable(),
  artifactType: DreamArtifactTypeSchema,
})
export type DreamMeta = z.infer<typeof DreamMetaSchema>

export const DurableMetaSchema = z.object({
  file: z.string(),
  headingLevel: z.number().int().min(0).max(6),
  headingPath: z.array(z.string()),
  chunkIndex: z.number().int().nonnegative(),
})
export type DurableMeta = z.infer<typeof DurableMetaSchema>

export const AuditMetaSchema = z.object({
  event: z.string(),
  agent: z.string().nullable(),
  channel: z.string().nullable(),
  actor: z.string().nullable(),
  data: z.unknown(),
})
export type AuditMeta = z.infer<typeof AuditMetaSchema>

// ─── Discriminated row types (for callers that already know the tier) ───────

export interface SessionRow extends MemoryRow { tier: 'session' }
export interface TurnRow extends MemoryRow { tier: 'turn' }
export interface CheckpointRow extends MemoryRow { tier: 'checkpoint' }
export interface DailyNoteRow extends MemoryRow { tier: 'daily_note' }
export interface DreamRow extends MemoryRow { tier: 'dream' }
export interface DurableRow extends MemoryRow { tier: 'durable' }
export interface AuditRow extends MemoryRow { tier: 'audit' }
