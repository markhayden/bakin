/**
 * One-shot, crash-safe, idempotent move of the budget + billing keys out of
 * models.json into spend.json (spec §10). Runs at spend activation BEFORE
 * the spend.* hooks register, so the gate (fail-closed while the hooks are
 * absent) never runs uncapped mid-upgrade.
 *
 *   0. Either file present-but-unreadable, or spend.json present-but-invalid
 *      ⇒ BLOCKED: nothing is written (the operator's limits are still in
 *      those bytes), the hooks then fail closed and Health names the file.
 *   1. spend.json valid + models.json without the keys ⇒ done.
 *      spend.json valid + models.json still carrying the keys: with the
 *      backup present that is a crash between steps 3 and 4 — resume by
 *      stripping; WITHOUT the backup there is no proof the keys were ever
 *      migrated (an earlier boot initialized an empty destination while the
 *      source was unreadable), so they are MERGED into the destination.
 *   2. models.json has budget/billing ⇒ write models.json.pre-spend.bak
 *      atomically, only if absent (the honest rollback, never rewritten).
 *   3. Build the spend document — rule-list budgets AND the pre-v2
 *      `{ global, perAgent }` metered-dollar shape (its mapper is composed
 *      here so a box that skipped releases keeps its caps) — id per rule,
 *      warnPct dropped, atCap kept; validate; write via the atomic store.
 *   4. Strip budget/billing from models.json (atomic).
 */
import { existsSync, renameSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { pluginSettingsPath, readPluginSettingsFile, writePluginSettings } from '@bakin/core/plugins/settings-store'
import { createLogger } from '../../../src/core/logger'
import { BudgetRuleSchema, EMPTY_SPEND_SETTINGS, SPEND_PLUGIN_ID, SpendSettingsSchema, describeSchemaIssues, ruleIdentity, type SpendPluginSettings } from './settings'

const log = createLogger('spend:upgrade')

export const SOURCE_PLUGIN_ID = 'models'
export { SPEND_PLUGIN_ID }

export type UpgradeResult =
  | { status: 'noop' }
  | { status: 'initialized' }
  | { status: 'resumed' }
  | { status: 'upgraded'; rules: number; merged?: true; skipped?: Array<{ index: number; reason: string }> }
  /** Nothing was written; `reason` names the file the operator has to fix. */
  | { status: 'blocked'; reason: string }

interface LegacyCaps { dailyUsd?: number; monthlyUsd?: number }

interface LegacyModelsSettings {
  budget?: { rules?: unknown[]; acceptUnattributedBefore?: unknown; global?: LegacyCaps & { warnPct?: number }; perAgent?: Record<string, LegacyCaps> }
  billing?: { overrides?: unknown }
  [key: string]: unknown
}

function hasSourceKeys(models: LegacyModelsSettings): boolean {
  return models.budget !== undefined || models.billing !== undefined
}

function stripSourceKeys(models: LegacyModelsSettings): void {
  const { budget: _budget, billing: _billing, ...rest } = models
  writePluginSettings(SOURCE_PLUGIN_ID, rest)
}

function backupPath(): string {
  return `${pluginSettingsPath(SOURCE_PLUGIN_ID)}.pre-spend.bak`
}

/** Atomic (tmp + rename): an interrupted backup must never exist as a truncated file that then blocks a real one. */
function writeBackupOnce(models: LegacyModelsSettings): void {
  const file = backupPath()
  if (existsSync(file)) return
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(models, null, 2))
  renameSync(tmp, file)
}

/**
 * The pre-v2 shape ({global:{dailyUsd,monthlyUsd,warnPct}, perAgent:{id:{…}}})
 * → raw rule candidates. Legacy caps were always metered dollars; the single
 * warnPct has no v2 equivalent (the ladder is fixed) and is dropped.
 */
function legacyCapsToRules(budget: NonNullable<LegacyModelsSettings['budget']>): unknown[] {
  const rules: unknown[] = []
  const g = budget.global
  if (g && (g.dailyUsd || g.monthlyUsd)) {
    rules.push({ scope: 'global', lane: 'metered', ...(g.dailyUsd ? { dailyCap: g.dailyUsd } : {}), ...(g.monthlyUsd ? { monthlyCap: g.monthlyUsd } : {}) })
  }
  for (const [agentId, caps] of Object.entries(budget.perAgent ?? {})) {
    if (!caps || (!caps.dailyUsd && !caps.monthlyUsd)) continue
    rules.push({ scope: 'agent', scopeId: agentId, lane: 'metered', ...(caps.dailyUsd ? { dailyCap: caps.dailyUsd } : {}), ...(caps.monthlyUsd ? { monthlyCap: caps.monthlyUsd } : {}) })
  }
  return rules
}

function buildDocument(models: LegacyModelsSettings): { document: SpendPluginSettings; skipped: Array<{ index: number; reason: string }> } {
  const skipped: Array<{ index: number; reason: string }> = []
  const rules: SpendPluginSettings['limits']['rules'] = []
  const budget = models.budget
  const legacyRules = Array.isArray(budget?.rules)
    ? budget.rules
    : budget && (budget.global !== undefined || budget.perAgent !== undefined)
      ? legacyCapsToRules(budget)
      : []
  const seenIdentities = new Set<string>()
  legacyRules.forEach((raw, index) => {
    const source = raw !== null && typeof raw === 'object' ? { ...(raw as Record<string, unknown>) } : {}
    delete source.warnPct
    const candidate = { ...source, id: typeof source.id === 'string' && source.id ? source.id : randomUUID() }
    const parsed = BudgetRuleSchema.safeParse(candidate)
    if (!parsed.success) {
      skipped.push({ index, reason: parsed.error.issues.map((i) => i.message).join('; ') })
      return
    }
    const identity = ruleIdentity(parsed.data)
    if (seenIdentities.has(identity)) {
      skipped.push({ index, reason: 'duplicates an earlier rule with the same scope and lane' })
      return
    }
    seenIdentities.add(identity)
    rules.push(parsed.data)
  })
  const cutoff = budget?.acceptUnattributedBefore
  const billing = SpendSettingsSchema.shape.billing.safeParse(models.billing ?? { overrides: [] })
  const document: SpendPluginSettings = {
    limits: { rules, ...(typeof cutoff === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(cutoff) ? { acceptUnattributedBefore: cutoff } : {}) },
    billing: { overrides: billing.success ? billing.data.overrides : [] },
  }
  return { document, skipped }
}

/** Destination wins on every collision; source rules/overrides the destination lacks are appended. */
function mergeDocuments(destination: SpendPluginSettings, source: SpendPluginSettings): SpendPluginSettings {
  const ids = new Set(destination.limits.rules.map((r) => r.id))
  const identities = new Set(destination.limits.rules.map(ruleIdentity))
  const rules = [...destination.limits.rules, ...source.limits.rules.filter((r) => !ids.has(r.id) && !identities.has(ruleIdentity(r)))]
  const overrideKey = (o: { agentId?: string; provider?: string }) => `${o.agentId ?? ''}\u0000${o.provider ?? ''}`
  const overrideKeys = new Set(destination.billing.overrides.map(overrideKey))
  const overrides = [...destination.billing.overrides, ...source.billing.overrides.filter((o) => !overrideKeys.has(overrideKey(o)))]
  return {
    limits: { rules, ...(destination.limits.acceptUnattributedBefore ?? source.limits.acceptUnattributedBefore ? { acceptUnattributedBefore: destination.limits.acceptUnattributedBefore ?? source.limits.acceptUnattributedBefore } : {}) },
    billing: { overrides },
  }
}

export function upgradeSpendSettings(): UpgradeResult {
  const source = readPluginSettingsFile(SOURCE_PLUGIN_ID)
  if (source.status === 'unreadable') {
    const reason = `${source.file} cannot be parsed (${source.error}); its budget/billing keys may still hold limits — nothing was migrated. Fix or restore the file.`
    log.error('spend settings upgrade blocked on an unreadable source', undefined, { file: source.file, error: source.error })
    return { status: 'blocked', reason }
  }
  const destinationRead = readPluginSettingsFile(SPEND_PLUGIN_ID)
  if (destinationRead.status === 'unreadable') {
    const reason = `${destinationRead.file} cannot be parsed (${destinationRead.error}) — limits cannot be read, dispatch fails closed. Fix or remove the file.`
    log.error('spend settings upgrade blocked on an unreadable destination', undefined, { file: destinationRead.file, error: destinationRead.error })
    return { status: 'blocked', reason }
  }
  const destination = destinationRead.status === 'ok' ? SpendSettingsSchema.safeParse(destinationRead.value) : null
  if (destination && !destination.success) {
    const issues = describeSchemaIssues(destination.error)
    const reason = `${pluginSettingsPath(SPEND_PLUGIN_ID)} is not a valid spend policy (${issues.join('; ')}) — limits cannot be read, dispatch fails closed. Fix or remove the file.`
    log.error('spend settings upgrade blocked on an invalid destination', undefined, { issues })
    return { status: 'blocked', reason }
  }

  const models = (source.status === 'ok' && source.value !== null && typeof source.value === 'object' ? source.value : {}) as LegacyModelsSettings

  if (destination?.success) {
    if (!hasSourceKeys(models)) return { status: 'noop' }
    if (existsSync(backupPath())) {
      // A crash between writing spend.json and stripping models.json.
      stripSourceKeys(models)
      log.info('spend settings upgrade resumed: source keys stripped')
      return { status: 'resumed' }
    }
    // No backup ⇒ no proof these keys were migrated: an earlier boot
    // initialized the destination while the source was unreadable. Merge.
    writeBackupOnce(models)
    const { document: built, skipped } = buildDocument(models)
    const merged = SpendSettingsSchema.parse(mergeDocuments(destination.data, built))
    writePluginSettings(SPEND_PLUGIN_ID, merged)
    stripSourceKeys(models)
    if (skipped.length > 0) log.warn('spend settings upgrade skipped invalid legacy rules', { skipped })
    log.info('spend settings merged from models.json into an existing spend.json', { rules: merged.limits.rules.length })
    return { status: 'upgraded', rules: merged.limits.rules.length, merged: true, ...(skipped.length ? { skipped } : {}) }
  }

  if (!hasSourceKeys(models)) {
    writePluginSettings(SPEND_PLUGIN_ID, EMPTY_SPEND_SETTINGS)
    return { status: 'initialized' }
  }

  writeBackupOnce(models)
  const { document, skipped } = buildDocument(models)
  writePluginSettings(SPEND_PLUGIN_ID, SpendSettingsSchema.parse(document))
  stripSourceKeys(models)
  if (skipped.length > 0) log.warn('spend settings upgrade skipped invalid legacy rules', { skipped })
  log.info('spend settings upgraded from models.json', { rules: document.limits.rules.length, backup: backupPath() })
  return { status: 'upgraded', rules: document.limits.rules.length, ...(skipped.length ? { skipped } : {}) }
}
