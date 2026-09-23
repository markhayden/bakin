/**
 * Spend plugin settings — `~/.bakin/plugin-settings/spend.json`.
 *
 *   { limits:  { rules: BudgetRule[] (each with a uuid id), acceptUnattributedBefore? },
 *     billing: { overrides: BillingOverride[] } }
 *
 * ONE zod schema is the boundary for the file, the upgrade, and PUT /limits.
 * Rule ids are server-assigned and key the milestone ladder (a recreated
 * rule starts fresh); warnPct does not exist — the ladder is fixed.
 */
import { z } from 'zod'
import type { BudgetPolicy, BudgetRule } from '../../../src/core/budget'
import type { BillingOverride } from '../types'

export const BudgetRuleSchema = z
  .object({
    id: z.string().min(1),
    scope: z.enum(['global', 'agent', 'provider', 'model']),
    scopeId: z.string().min(1).optional(),
    lane: z.enum(['metered', 'subscription']),
    /** Whole USD on metered rules, tokens on subscription rules. */
    dailyCap: z.number().positive().optional(),
    monthlyCap: z.number().positive().optional(),
    atCap: z.enum(['defer', 'pause']).optional(),
  })
  .refine((r) => r.scope === 'global' || typeof r.scopeId === 'string', {
    message: 'scopeId is required for agent/provider/model rules',
  })
  .refine((r) => r.dailyCap !== undefined || r.monthlyCap !== undefined, {
    message: 'a limit needs a daily or a monthly cap',
  })

export const LimitsSchema = z.object({
  rules: z.array(BudgetRuleSchema),
  /** Written only by the accept-unattributed-history repair. */
  acceptUnattributedBefore: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

export const BillingOverridesSchema = z.object({
  overrides: z.array(
    z
      .object({
        agentId: z.string().min(1).optional(),
        provider: z.string().min(1).optional(),
        lane: z.enum(['metered', 'subscription']),
      })
      .refine((o) => o.agentId !== undefined || o.provider !== undefined, {
        message: 'an override needs an agentId, a provider, or both',
      }),
  ),
})

export const SpendSettingsSchema = z.object({
  limits: LimitsSchema,
  billing: BillingOverridesSchema,
})

export type SpendPluginSettings = z.infer<typeof SpendSettingsSchema>

export const EMPTY_SPEND_SETTINGS: SpendPluginSettings = { limits: { rules: [] }, billing: { overrides: [] } }

type SettingsReader = { getSettings<T>(): T }

/** The rule list as the gate consumes it (a valid document or nothing — never a half shape). */
export function readLimits(ctx: SettingsReader): BudgetPolicy {
  const parsed = SpendSettingsSchema.safeParse(ctx.getSettings<unknown>())
  if (!parsed.success) return { rules: [] }
  const { rules, acceptUnattributedBefore } = parsed.data.limits
  return { rules: rules as BudgetRule[], ...(acceptUnattributedBefore ? { acceptUnattributedBefore } : {}) }
}

export function readOverrides(ctx: SettingsReader): BillingOverride[] {
  const parsed = SpendSettingsSchema.safeParse(ctx.getSettings<unknown>())
  return parsed.success ? parsed.data.billing.overrides : []
}
