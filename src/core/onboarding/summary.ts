/**
 * The last line of `bakin onboard --json`: what the run came to. One
 * object under a `summary` key, so it can never be mistaken for a
 * component line.
 */
import { getSupportedRuntimeAdapterNames } from '../runtime-adapter-factory'
import { getSettings, type RuntimeAdapterName } from '../settings'
import { readStoredRuntimeAdapter } from './settings'
import type { SetupChecklist } from './setup-checklist'

/**
 * Where the active runtime adapter came from:
 *  - `env`: `BAKIN_RUNTIME_ADAPTER` for this process (never persisted)
 *  - `existing`: `runtime.adapter` stored in this home's settings
 *  - `default`: neither; the built-in default
 */
export type RuntimeSource = 'env' | 'existing' | 'flag' | 'default' | 'detected' | 'asked'

/** The runtime the run used, or why none was chosen. */
export type SummaryRuntime =
  | { adapter: RuntimeAdapterName; source: RuntimeSource }
  | { refused: string; found: RuntimeAdapterName[] }

export interface RunSummary {
  exitCode: 0 | 1 | 2
  markerWritten: boolean
  runtime: SummaryRuntime
  /** What is left to set up. Absent when the run was blocked: the blocker is the next step. */
  checklist?: SetupChecklist
}

function isAdapter(value: unknown): value is RuntimeAdapterName {
  return (getSupportedRuntimeAdapterNames() as readonly unknown[]).includes(value)
}

/** The runtime this process is on and where that came from, when no decision was made for the run. */
export function activeRuntime(): { adapter: RuntimeAdapterName; source: RuntimeSource } {
  const adapter = getSettings().runtime.adapter
  if (isAdapter(process.env.BAKIN_RUNTIME_ADAPTER)) return { adapter, source: 'env' }
  return { adapter, source: readStoredRuntimeAdapter() ? 'existing' : 'default' }
}

/** Codes with which the settings step refuses to commit a runtime choice. */
const COMMIT_REFUSALS = new Set(['runtime_already_set', 'server_running_other_runtime'])

/**
 * The summary line. `decided` is the runtime chosen for this run; without
 * one it is read from the process. A choice the settings step refused to
 * commit (another run stored a different runtime first) is reported as a
 * refusal, like one made before anything ran.
 */
export function runSummary(
  result: { exitCode: 0 | 1 | 2; markerWritten: boolean; outcomes?: ReadonlyArray<{ name: string; code?: string }> },
  decided?: { adapter: RuntimeAdapterName; source: RuntimeSource },
  found: RuntimeAdapterName[] = [],
  checklist?: SetupChecklist,
): { summary: RunSummary } {
  const refused = result.outcomes?.find((outcome) => outcome.name === 'settings' && outcome.code !== undefined && COMMIT_REFUSALS.has(outcome.code))?.code
  const runtime: SummaryRuntime = refused ? { refused, found } : decided ?? activeRuntime()
  return { summary: { exitCode: result.exitCode, markerWritten: result.markerWritten, runtime, ...(checklist ? { checklist } : {}) } }
}

/** The whole output of a run that was refused before anything ran. */
export function refusalSummary(code: string, found: RuntimeAdapterName[]): { summary: RunSummary } {
  return { summary: { exitCode: 1, markerWritten: false, runtime: { refused: code, found } } }
}
