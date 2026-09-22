/**
 * Zod schemas for models-route request validation + response shapes.
 *
 * Extracted from index.ts. Request bodies (config/defaults/aliases/routing/
 * budget), the shared passthrough/ok/error response shapes, and the spend
 * window parsing used by GET /spend.
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

// Cap rules (cost-control v2): scope × lane; unit-per-lane — dailyCap /
// monthlyCap are whole USD on metered rules, tokens on subscription rules.
// 'model' scope is accepted today (evaluator handles it); the UI ships
// through provider.
export const BudgetRuleSchema = z
  .object({
    scope: z.enum(['global', 'agent', 'provider', 'model']),
    scopeId: z.string().min(1).optional(),
    lane: z.enum(['metered', 'subscription']),
    dailyCap: z.number().positive().optional(),
    monthlyCap: z.number().positive().optional(),
    atCap: z.enum(['defer', 'pause']).optional(),
  })
  .refine((r) => r.scope === 'global' || typeof r.scopeId === 'string', {
    message: 'scopeId is required for agent/provider/model rules',
  })
export const BudgetPolicySchema = z.object({
  rules: z.array(BudgetRuleSchema).optional(),
  // Written only by the accept-unattributed-history repair.
  acceptUnattributedBefore: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

// Spend reporting windows. Coarser than the live-usage 5m/1h windows —
// spend is a daily/monthly story. 'all' = since the beginning of time.
export type SpendWindow = '24h' | '7d' | '30d' | 'all'
export const SPEND_WINDOW_MS: Record<Exclude<SpendWindow, 'all'>, number> = {
  '24h': 86_400_000,
  '7d': 604_800_000,
  '30d': 2_592_000_000,
}
export function parseSpendWindow(raw: string | null): SpendWindow {
  return raw === '7d' || raw === '30d' || raw === 'all' ? raw : '24h'
}
