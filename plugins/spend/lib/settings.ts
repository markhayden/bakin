/**
 * Spend plugin settings — `~/.bakin/plugin-settings/spend.json`.
 *
 *   { limits:  { rules: BudgetRule[] (each with a uuid id), acceptUnattributedBefore? },
 *     billing: { overrides: BillingOverride[] } }
 *
 * ONE zod schema is the boundary for the file, the upgrade, and PUT /limits.
 * Rule ids are server-assigned and key the milestone ladder (a recreated
 * rule starts fresh); warnPct does not exist — the ladder is fixed.
 *
 * Money never fails open (S13): an ABSENT file is "no limits"; a file that
 * exists but cannot be parsed or validated is "we cannot know" — every read
 * throws `SpendSettingsInvalidError`, so the `spend.getBudgetPolicy` hook
 * throws, the dispatch/media gates defer with `budget_policy_unavailable`,
 * and the health checks name the file. Nothing ever writes over an invalid
 * document (the operator's limits are still in those bytes).
 *
 * Every write goes through `withSpendPolicyWrite`: a process-wide queue that
 * re-reads the document at the final write boundary and checks the caller's
 * `expectRevision`, so a raise that awaited a spend read cannot overwrite a
 * PUT that landed meanwhile, and a stale editor snapshot is refused (409)
 * rather than replacing limits it never saw.
 */
import { createHash } from 'crypto'
import { z } from 'zod'
import { pluginSettingsPath, readPluginSettingsFile, writePluginSettings } from '@bakin/core/plugins/settings-store'
import type { BudgetPolicy, BudgetRule } from '../../../src/core/budget'
import type { BillingOverride } from '../types'

export const SPEND_PLUGIN_ID = 'spend'

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

/** A rule's identity — one rule per (scope, scopeId, lane); daily + monthly live on that one rule. */
export function ruleIdentity(rule: { scope: string; scopeId?: string; lane: string }): string {
  return `${rule.scope}\u0000${rule.scopeId ?? ''}\u0000${rule.lane}`
}

/** Refinement shared by the file schema and PUT /limits: unique ids AND unique identities. */
export function ruleListIssues(rules: ReadonlyArray<{ id?: string; scope: string; scopeId?: string; lane: string }>): string[] {
  const issues: string[] = []
  const ids = new Map<string, number>()
  const identities = new Map<string, number>()
  rules.forEach((rule, index) => {
    if (rule.id !== undefined) {
      const first = ids.get(rule.id)
      if (first !== undefined) issues.push(`rule ${index + 1} repeats the id of rule ${first + 1}`)
      else ids.set(rule.id, index)
    }
    const identity = ruleIdentity(rule)
    const first = identities.get(identity)
    if (first !== undefined) {
      const label = rule.scopeId ? `${rule.scope} '${rule.scopeId}' ${rule.lane}` : `${rule.scope} ${rule.lane}`
      issues.push(`rule ${index + 1} duplicates rule ${first + 1} (${label}) — put both caps on one rule`)
    } else identities.set(identity, index)
  })
  return issues
}

export const LimitsSchema = z.object({
  rules: z.array(BudgetRuleSchema).superRefine((rules, ctx) => {
    for (const message of ruleListIssues(rules)) ctx.addIssue({ code: z.ZodIssueCode.custom, message })
  }),
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

/** The document exists but is not a spend policy — money cannot know, so it fails closed. */
export class SpendSettingsInvalidError extends Error {
  readonly code = 'spend_settings_invalid' as const
  readonly file: string
  readonly issues: string[]
  constructor(file: string, issues: string[]) {
    super(`${file} is not a valid spend policy (${issues.join('; ')}) — limits cannot be read, so dispatch fails closed. Fix or remove the file.`)
    this.name = 'SpendSettingsInvalidError'
    this.file = file
    this.issues = issues
  }
}

/** A writer's `expectRevision` no longer matches the document on disk. */
export class SpendRevisionStaleError extends Error {
  readonly code = 'stale_revision' as const
  readonly current: string
  constructor(current: string) {
    super('the spend limits changed since this edit was loaded — reload and try again')
    this.name = 'SpendRevisionStaleError'
    this.current = current
  }
}

export function spendSettingsFile(): string {
  return pluginSettingsPath(SPEND_PLUGIN_ID)
}

/** Format a zod failure as the issue list the error and the health check carry. */
export function describeSchemaIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => (issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message))
}

/**
 * Read + validate the document. Absent ⇒ the empty policy (no limits is a
 * plain fact); present-but-unparseable or present-but-invalid ⇒ throws.
 */
export function readSpendSettings(): SpendPluginSettings {
  const read = readPluginSettingsFile(SPEND_PLUGIN_ID)
  if (read.status === 'absent') return EMPTY_SPEND_SETTINGS
  if (read.status === 'unreadable') throw new SpendSettingsInvalidError(read.file, [`unreadable: ${read.error}`])
  const parsed = SpendSettingsSchema.safeParse(read.value)
  if (!parsed.success) throw new SpendSettingsInvalidError(spendSettingsFile(), describeSchemaIssues(parsed.error))
  return parsed.data
}

/** Canonical content hash — the revision every writer must present. */
export function spendRevision(document: SpendPluginSettings): string {
  return createHash('sha256').update(JSON.stringify(document)).digest('hex').slice(0, 16)
}

/** The rule list as the gate consumes it. Throws on an invalid document (fail closed). */
export function readLimits(): BudgetPolicy {
  const { rules, acceptUnattributedBefore } = readSpendSettings().limits
  return { rules: rules as BudgetRule[], ...(acceptUnattributedBefore ? { acceptUnattributedBefore } : {}) }
}

export function readOverrides(): BillingOverride[] {
  return readSpendSettings().billing.overrides
}

// Process-wide write queue: writers run one at a time, each reading the
// document fresh INSIDE its turn. The async boundary a writer awaited before
// entering (a spend read, a roster lookup) can no longer race another write.
let writeChain: Promise<unknown> = Promise.resolve()

export interface SpendPolicyWriteResult<T> {
  document: SpendPluginSettings
  revision: string
  result: T
}

/**
 * Serialized read-modify-write over spend.json. `mutate` receives the
 * CURRENT validated document (never a stale snapshot) and returns the next
 * one plus anything the caller wants back; the write is refused when the
 * document is invalid (throws `SpendSettingsInvalidError` — the operator's
 * bytes stay put) or when `expectRevision` is set and no longer matches
 * (throws `SpendRevisionStaleError`).
 */
export function withSpendPolicyWrite<T>(
  mutate: (current: SpendPluginSettings, revision: string) => { next: SpendPluginSettings; result: T },
  opts: { expectRevision?: string } = {},
): Promise<SpendPolicyWriteResult<T>> {
  const run = writeChain.then(() => {
    const current = readSpendSettings()
    const revision = spendRevision(current)
    if (opts.expectRevision !== undefined && opts.expectRevision !== revision) throw new SpendRevisionStaleError(revision)
    const { next, result } = mutate(current, revision)
    const document = SpendSettingsSchema.parse(next)
    writePluginSettings(SPEND_PLUGIN_ID, document)
    return { document, revision: spendRevision(document), result }
  })
  writeChain = run.catch(() => undefined)
  return run
}
