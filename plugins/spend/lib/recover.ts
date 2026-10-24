/**
 * The spend.json recover editor's engine (self-healing PR1 slice 1.4b;
 * re-homing rows 40/161). An invalid limits file fails dispatch closed and
 * nothing in Bakin ever writes over it — the operator fixes the text here
 * (validated before it lands) or starts without limits (the file is moved
 * aside, never deleted).
 */
import { existsSync, readFileSync, renameSync } from 'node:fs'
import { readPluginSettingsFile, writePluginSettings } from '@bakin/core/plugins/settings-store'
import { SPEND_PLUGIN_ID, SpendSettingsSchema, describeSchemaIssues, spendSettingsFile } from './settings'

export interface SpendPolicyFileReport {
  file: string
  status: 'absent' | 'ok' | 'invalid'
  /** The raw text as it is on disk (null when absent). */
  text: string | null
  /** Why the file is invalid (empty when ok or absent). */
  issues: string[]
}

export function inspectSpendPolicyFile(): SpendPolicyFileReport {
  const file = spendSettingsFile()
  if (!existsSync(file)) return { file, status: 'absent', text: null, issues: [] }
  const text = readFileSync(file, 'utf-8')
  const read = readPluginSettingsFile(SPEND_PLUGIN_ID)
  if (read.status === 'unreadable') return { file, status: 'invalid', text, issues: [`not JSON: ${read.error}`] }
  if (read.status === 'absent') return { file, status: 'absent', text: null, issues: [] }
  const parsed = SpendSettingsSchema.safeParse(read.value)
  return parsed.success ? { file, status: 'ok', text, issues: [] } : { file, status: 'invalid', text, issues: describeSchemaIssues(parsed.error) }
}

/** The edited text, validated as a spend policy before it is written atomically. Returns the issues instead of writing when it is not one. */
export function writeSpendPolicyText(text: string): { ok: true } | { ok: false; issues: string[] } {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (err) {
    return { ok: false, issues: [`not JSON: ${err instanceof Error ? err.message : String(err)}`] }
  }
  const parsed = SpendSettingsSchema.safeParse(value)
  if (!parsed.success) return { ok: false, issues: describeSchemaIssues(parsed.error) }
  writePluginSettings(SPEND_PLUGIN_ID, parsed.data)
  return { ok: true }
}

/** Start without limits: the file is moved to a dated `.rejected-*` copy, never deleted. */
export function resetSpendPolicyFile(): { movedTo: string | null } {
  const file = spendSettingsFile()
  if (!existsSync(file)) return { movedTo: null }
  const movedTo = `${file}.rejected-${new Date().toISOString().replace(/[:.]/g, '-')}`
  renameSync(file, movedTo)
  return { movedTo }
}
