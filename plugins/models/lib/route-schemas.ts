/**
 * Zod schemas for models-route request validation + response shapes: the
 * selections mutation body and the shared passthrough/ok/error responses.
 */
import { z } from 'zod'


// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------
export const okResponse = z.object({ ok: z.literal(true) }).passthrough()
export const errorResponse = z.object({ error: z.string() }).passthrough()
export const passthrough = z.object({}).passthrough()

const ThinkingSettingSchema = z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive', 'max', 'inherit'])

// The ONE model-selection write (#907, D25): ops per selection ref under a
// revision. `model: null` clears; `thinking: null` clears; `ui:mode` takes
// 'simple' | 'advanced' as its model.
export const MutationOpSchema = z.object({
  ref: z.string().min(1),
  set: z.object({
    model: z.string().min(1).nullable().optional(),
    thinking: ThinkingSettingSchema.nullable().optional(),
  }).refine((s) => s.model !== undefined || s.thinking !== undefined, { message: 'an op must set model and/or thinking' }),
})
export const MutateSelectionsSchema = z.object({
  revision: z.string().min(1),
  ops: z.array(MutationOpSchema).min(1),
  snapshot: z.literal('reset').optional(),
})
/** Operator acknowledgement of a CONFLICTED pending write — frees its document (`policy` | `routing` | `agent:<id>`). */
export const AcknowledgePendingSchema = z.object({
  document: z.string().regex(/^(policy|routing|agent:[^:\s]+)$/, 'document must be policy, routing or agent:<id>'),
})

