/**
 * settings component — this home's settings.json exists, can be trusted,
 * and records which runtime the home uses.
 *
 * `initBakinHome()` already drops an empty `{}` settings.json during mkdir,
 * but this component is a standalone gate because a user can delete or
 * damage the file afterwards, and everything later reads `getSettings()`.
 *
 * Two rules the install never breaks:
 *
 * 1. It never writes over a file it cannot trust. A settings file that is
 *    not JSON, or that stores a runtime Bakin does not support, is the
 *    operator's to fix: silently reseeding it would throw their
 *    configuration away, and reading it as defaults would run the home on
 *    a runtime nobody chose. (A zero-byte file holds nothing to lose and
 *    is reseeded.)
 * 2. It is where a first-run runtime choice is COMMITTED. The choice made
 *    by `decideRuntime` is a proposal carried in the install options; the
 *    install owns `install-state`, re-reads what is stored at that moment,
 *    and writes the proposal only when nothing is stored yet. A different
 *    stored runtime, or a server already running on a different one, fails
 *    the install with a typed code — so two runs deciding at once produce
 *    one winner and one refusal, and onboarding never switches a runtime.
 */
import { existsSync, readFileSync, statSync } from 'fs'
import { createLogger } from '../logger'
import { maybeGetAppServices } from '../app-services-store'
import { getBakinPaths } from '../content-dir'
import { getSupportedRuntimeAdapterNames } from '../runtime-adapter-factory'
import { readLiveServerLock } from '../server-lock'
import { resetSettingsCache, updateSettings, type RuntimeAdapterName } from '../settings'
import type { OperationContext } from '@bakin/core/operations'
import type { CheckResult, ComponentInstallOptions, InstallableComponent, InstallResult } from './types'

const log = createLogger('onboarding:settings')

function settingsPath(): string {
  return getBakinPaths().settings
}

function isSupportedAdapter(value: unknown): value is RuntimeAdapterName {
  return (getSupportedRuntimeAdapterNames() as readonly unknown[]).includes(value)
}

/** What is on disk, read strictly: the file as it is, not the merged defaults. */
export type SettingsFileState =
  /** No file. */
  | { kind: 'absent' }
  /** A zero-byte file: nothing stored, nothing to lose. */
  | { kind: 'empty' }
  /** A JSON object; `storedAdapter` is the supported runtime it names, if it names one. */
  | { kind: 'readable'; storedAdapter?: RuntimeAdapterName }
  /** A file the install must never write over. */
  | { kind: 'untrustworthy'; why: 'unreadable' | 'not_json' | 'not_an_object' | 'unsupported_runtime'; message: string }

export function inspectSettingsFile(): SettingsFileState {
  const path = settingsPath()
  if (!existsSync(path)) return { kind: 'absent' }
  let raw: string
  try {
    if (statSync(path).size === 0) return { kind: 'empty' }
    raw = readFileSync(path, 'utf-8')
  } catch (err) {
    return { kind: 'untrustworthy', why: 'unreadable', message: `settings.json at ${path} could not be read: ${err instanceof Error ? err.message : String(err)}` }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (err) {
    return { kind: 'untrustworthy', why: 'not_json', message: `settings.json at ${path} is not valid JSON: ${err instanceof Error ? err.message : String(err)}` }
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { kind: 'untrustworthy', why: 'not_an_object', message: `settings.json at ${path} is not a JSON object` }
  }
  const adapter = (parsed as { runtime?: { adapter?: unknown } }).runtime?.adapter
  if (adapter === undefined) return { kind: 'readable' }
  if (!isSupportedAdapter(adapter)) {
    return {
      kind: 'untrustworthy',
      why: 'unsupported_runtime',
      message: `settings.json at ${path} names a runtime Bakin does not support: ${JSON.stringify(adapter)} (supported: ${getSupportedRuntimeAdapterNames().join(', ')})`,
    }
  }
  return { kind: 'readable', storedAdapter: adapter }
}

/** The supported runtime this home's settings file stores, if it stores one. */
export function readStoredRuntimeAdapter(): RuntimeAdapterName | undefined {
  const state = inspectSettingsFile()
  return state.kind === 'readable' ? state.storedAdapter : undefined
}

const FIX_BY_HAND = 'Fix the file by hand, or move it aside and run `bakin settings init`. Bakin will not write over it.'

async function check(): Promise<CheckResult> {
  const path = settingsPath()
  const state = inspectSettingsFile()
  switch (state.kind) {
    case 'absent':
      return {
        name: 'settings',
        status: 'missing',
        message: `settings.json not found at ${path}`,
        remediation: 'Run `bakin settings init` to seed the file with defaults.',
      }
    case 'empty':
      // Zero bytes counts as missing work, not as a usable file: a user who
      // sees an empty file will (rightly) think something is wrong.
      return {
        name: 'settings',
        status: 'broken',
        message: `settings.json at ${path} is empty`,
        remediation: 'Run `bakin settings init` to rewrite the file.',
      }
    case 'untrustworthy':
      // An error, not something an install repairs: the operator decides.
      return { name: 'settings', status: 'error', message: state.message, remediation: FIX_BY_HAND, details: { why: state.why } }
    case 'readable':
      return {
        name: 'settings',
        status: 'ok',
        message: `settings.json is present and parses at ${path}`,
        ...(state.storedAdapter ? { details: { runtimeAdapter: state.storedAdapter } } : {}),
      }
  }
}

/**
 * The runtime a server running in THIS process bound at boot, if this
 * process is that server. Plugins bind `ctx.runtime` at activation, so a
 * live server cannot follow a newly written adapter: committing a
 * different one underneath it would leave the home and its server
 * disagreeing until a restart.
 */
function boundServerAdapter(): string | undefined {
  const lock = readLiveServerLock()
  if (!lock || lock.pid !== process.pid) return undefined
  return maybeGetAppServices()?.runtime.name
}

async function install(opts: ComponentInstallOptions, op: OperationContext): Promise<InstallResult> {
  const start = Date.now()
  const result = (status: InstallResult['status'], message: string, extra: Partial<InstallResult> = {}): InstallResult =>
    ({ name: 'settings', status, message, durationMs: Date.now() - start, ...extra })
  op.stage('write')

  // Read what is stored NOW, inside the operation that owns install-state:
  // whatever another run committed while this one waited is visible here.
  const state = inspectSettingsFile()
  if (state.kind === 'untrustworthy') {
    return result('failed', `${state.message}. ${FIX_BY_HAND}`, { code: 'settings_untrustworthy' })
  }
  const stored = state.kind === 'readable' ? state.storedAdapter : undefined
  const proposal = opts.runtimeAdapter
  if (proposal !== undefined && !isSupportedAdapter(proposal)) {
    return result('failed', `${JSON.stringify(proposal)} is not a runtime Bakin supports (${getSupportedRuntimeAdapterNames().join(', ')}); nothing was stored.`, { code: 'invalid_runtime' })
  }
  if (proposal !== undefined) {
    if (stored !== undefined && stored !== proposal) {
      return result('failed', `This home already uses ${stored}; it was not changed to ${proposal}. To change runtimes run \`bakin runtime use ${proposal}\` — onboarding never switches one.`, { code: 'runtime_already_set' })
    }
    const live = boundServerAdapter()
    if (live !== undefined && live !== proposal) {
      return result('failed', `Bakin is running on ${live} for this home; ${proposal} was not stored. Stop Bakin first, or use \`bakin runtime use ${proposal}\`.`, { code: 'server_running_other_runtime' })
    }
  }

  try {
    // updateSettings writes the override file (seeding `{}` when there is
    // none), invalidates the cache, and returns the merged settings. A
    // proposal is written only when nothing is stored: an equal stored
    // value is already the answer.
    const commit = proposal !== undefined && stored === undefined
    resetSettingsCache()
    updateSettings(commit ? { runtime: { adapter: proposal } } : {})
    log.info('Settings file initialized', { path: settingsPath(), ...(commit ? { runtimeAdapter: proposal } : {}) })
    return result('installed', commit ? `Wrote ${settingsPath()} (runtime: ${proposal})` : `Wrote ${settingsPath()}`)
  } catch (err) {
    log.error('Failed to initialize settings file', err)
    return result('failed', `Failed to write settings.json: ${err instanceof Error ? err.message : String(err)}`, { error: err })
  }
}

export const settingsComponent: InstallableComponent = {
  plan: { stages: [{ id: 'write', kind: 'installing', label: 'Write settings.json' }], pointOfNoReturn: 'start' },
  // The runtime choice is install state: one writer at a time.
  resources: ['install-state'],
  name: 'settings',
  requires: ['mkdir'],
  usableWhenMissing: true,
  check,
  install,
}
