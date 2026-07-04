/**
 * `bakin settings {get,set,init}` — server settings via the HTTP API
 * (`init` delegates to the onboarding settings component). Relocated
 * verbatim from cli/bakin.ts (B5.3 command-module split).
 */
import { apiGet, apiPost } from '../http'
import { print } from '../output'
import { exitUsage, exitUnknownSubcommand } from '../help'
import { renderInkReport } from '../../core/cli/ui/render-report'
import type { SettingsActionData } from '../../core/cli/ui/readonly'
import { cmdOnboardingSettingsInit } from './onboarding'

async function printSettingsTui(settings: Record<string, unknown>): Promise<void> {
  return renderInkReport(() => import('../../core/cli/ui/readonly'), (m) => m.SettingsReport, { settings })
}

async function printSettingsActionTui(action: SettingsActionData): Promise<void> {
  return renderInkReport(() => import('../../core/cli/ui/readonly'), (m) => m.SettingsActionReport, { action })
}

async function cmdSettingsGet(key?: string, opts: { json?: boolean } = {}): Promise<void> {
  const settings = await apiGet('/api/settings') as Record<string, unknown>
  if (key) {
    const parts = key.split('.')
    let val: unknown = settings
    let found = true
    for (const part of parts) {
      if (val && typeof val === 'object' && Object.prototype.hasOwnProperty.call(val, part)) {
        val = (val as Record<string, unknown>)[part]
      } else {
        val = undefined
        found = false
        break
      }
    }
    if (opts.json) {
      print(found ? val : null)
      return
    }
    if (!opts.json && process.stdout.isTTY) {
      await printSettingsTui({ [key]: val })
      return
    }
    print(val)
  } else {
    if (opts.json) {
      print(settings)
      return
    }
    if (process.stdout.isTTY) {
      await printSettingsTui(settings)
      return
    }
    print(settings)
  }
}

async function cmdSettingsSet(key: string, value: string, opts: { json?: boolean } = {}): Promise<void> {
  const parts = key.split('.')
  const obj: Record<string, unknown> = {}
  let current = obj
  for (let i = 0; i < parts.length - 1; i++) {
    current[parts[i]] = {}
    current = current[parts[i]] as Record<string, unknown>
  }

  // Try to parse as JSON, fall back to string
  let parsedValue: unknown
  try {
    parsedValue = JSON.parse(value)
  } catch {
    parsedValue = value
  }
  current[parts[parts.length - 1]] = parsedValue

  const result = await apiPost('/api/settings', obj)
  if (!opts.json && process.stdout.isTTY) {
    await printSettingsActionTui({
      action: 'updated',
      key,
      value: parsedValue,
      result,
    })
    return
  }

  print(result)
}

export async function run(args: string[]): Promise<void> {
  const sub = args[1]
  if (sub === 'get') {
    const flags = args.slice(2)
    const key = flags.find(arg => !arg.startsWith('--'))
    await cmdSettingsGet(key, { json: flags.includes('--json') })
  } else if (sub === 'set') {
    if (!args[2] || !args[3]) await exitUsage('bakin settings set <key> <value>')
    await cmdSettingsSet(args[2], args[3], { json: args.slice(4).includes('--json') })
  } else if (sub === 'init') {
    await cmdOnboardingSettingsInit({ json: args.slice(2).includes('--json') })
  } else {
    await exitUnknownSubcommand('settings', sub, ['get', 'set', 'init'])
  }
}
