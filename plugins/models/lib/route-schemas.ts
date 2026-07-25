/**
 * Zod schemas for models-route request validation + response shapes.
 *
 * Extracted from index.ts. Request bodies (config/defaults/aliases/routing/
 * budget), the shared passthrough/ok/error response shapes, and the spend
 * window parsing used by GET /spend.
 */
import { z } from 'zod'

import { ROUTABLE_WORK_CLASSES } from '../../../src/core/model-routing'

// ---------------------------------------------------------------------------
// Zod schemas for request validation
// ---------------------------------------------------------------------------
export const ConfigUpdateSchema = z.object({
  agentId: z.string().min(1, 'agentId required'),
  ownModel: z.string().nullable().optional(),
  subagentModel: z.string().nullable().optional(),
})

export const DefaultsUpdateSchema = z.object({
  defaultModel: z.string().optional(),
  defaultSubagentModel: z.string().nullable().optional(),
  fallbackModels: z.array(z.string()).optional(),
})

export const AliasActionSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('add'), name: z.string().min(1), target: z.string().min(1) }),
  z.object({ action: z.literal('delete'), name: z.string().min(1) }),
  z.object({ action: z.literal('prepopulate') }),
]).or(z.object({ aliases: z.record(z.string(), z.string()) }))


// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------
export const okResponse = z.object({ ok: z.literal(true) }).passthrough()
export const errorResponse = z.object({ error: z.string() }).passthrough()
export const passthrough = z.object({}).passthrough()

const ThinkingSettingSchema = z.enum(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive', 'max', 'inherit'])
// Routes may target any routable work class ('chat' is metered-only and
// rejected by construction).
const WorkClassRouteSchema = z.object({
  workClass: z.enum(ROUTABLE_WORK_CLASSES as unknown as [string, ...string[]]),
  model: z.string().optional(),
  thinking: ThinkingSettingSchema.optional(),
})
const TagOverrideSchema = z.object({
  tag: z.string().min(1),
  model: z.string().optional(),
  thinking: ThinkingSettingSchema.optional(),
})
export const RoutingConfigSchema = z.object({
  routes: z.array(WorkClassRouteSchema),
  tagOverrides: z.array(TagOverrideSchema),
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
    warnPct: z.number().gt(0).lte(1).optional(),
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
