/**
 * One-shot, crash-safe, idempotent move of the budget + billing keys out of
 * models.json into spend.json (spec §10). Runs at spend activation BEFORE
 * the spend.* hooks register, so the gate (fail-closed while the hooks are
 * absent) never runs uncapped mid-upgrade.
 *
 *   1. spend.json already valid ⇒ done (destination validity is the marker);
 *      if models.json still carries the keys, that is a crash between steps
 *      3 and 4 — resume by stripping them.
 *   2. models.json has budget/billing ⇒ write models.json.pre-spend.bak, only
 *      if absent (the backup is the honest rollback and is never rewritten).
 *   3. Build the spend document (id per rule, warnPct dropped, atCap kept),
 *      validate, write via the atomic settings store.
 *   4. Strip budget/billing from models.json (atomic).
 */
import { existsSync, writeFileSync } from 'fs'
import { randomUUID } from 'crypto'
import { pluginSettingsPath, readPluginSettings, writePluginSettings } from '@bakin/core/plugins/settings-store'
import { createLogger } from '../../../src/core/logger'
import { BudgetRuleSchema, EMPTY_SPEND_SETTINGS, SpendSettingsSchema, type SpendPluginSettings } from './settings'

const log = createLogger('spend:upgrade')

export const SOURCE_PLUGIN_ID = 'models'
export const SPEND_PLUGIN_ID = 'spend'

export type UpgradeResult =
  | { status: 'noop' }
  | { status: 'initialized' }
  | { status: 'resumed' }
  | { status: 'upgraded'; rules: number; skipped?: Array<{ index: number; reason: string }> }

interface LegacyModelsSettings {
  budget?: { rules?: unknown[]; acceptUnattributedBefore?: unknown }
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

export function upgradeSpendSettings(): UpgradeResult {
  const models = readPluginSettings<LegacyModelsSettings>(SOURCE_PLUGIN_ID)
  const destination = SpendSettingsSchema.safeParse(readPluginSettings<unknown>(SPEND_PLUGIN_ID))

  if (destination.success) {
    if (!hasSourceKeys(models)) return { status: 'noop' }
    stripSourceKeys(models)
    log.info('spend settings upgrade resumed: source keys stripped')
    return { status: 'resumed' }
  }

  if (!hasSourceKeys(models)) {
    writePluginSettings(SPEND_PLUGIN_ID, EMPTY_SPEND_SETTINGS)
    return { status: 'initialized' }
  }

  const backup = `${pluginSettingsPath(SOURCE_PLUGIN_ID)}.pre-spend.bak`
  if (!existsSync(backup)) writeFileSync(backup, JSON.stringify(models, null, 2))

  const skipped: Array<{ index: number; reason: string }> = []
  const rules: SpendPluginSettings['limits']['rules'] = []
  const legacyRules = Array.isArray(models.budget?.rules) ? models.budget.rules : []
  legacyRules.forEach((raw, index) => {
    const source = raw !== null && typeof raw === 'object' ? { ...(raw as Record<string, unknown>) } : {}
    delete source.warnPct
    const candidate = { ...source, id: typeof source.id === 'string' && source.id ? source.id : randomUUID() }
    const parsed = BudgetRuleSchema.safeParse(candidate)
    if (parsed.success) rules.push(parsed.data)
    else skipped.push({ index, reason: parsed.error.issues.map((i) => i.message).join('; ') })
  })
  const cutoff = models.budget?.acceptUnattributedBefore
  const billing = SpendSettingsSchema.shape.billing.safeParse(models.billing ?? { overrides: [] })
  const overrides = billing.success ? billing.data.overrides : []
  const document: SpendPluginSettings = {
    limits: { rules, ...(typeof cutoff === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(cutoff) ? { acceptUnattributedBefore: cutoff } : {}) },
    billing: { overrides },
  }
  writePluginSettings(SPEND_PLUGIN_ID, SpendSettingsSchema.parse(document))
  stripSourceKeys(models)
  if (skipped.length > 0) log.warn('spend settings upgrade skipped invalid legacy rules', { skipped })
  log.info('spend settings upgraded from models.json', { rules: rules.length, backup })
  return { status: 'upgraded', rules: rules.length, ...(skipped.length ? { skipped } : {}) }
}
