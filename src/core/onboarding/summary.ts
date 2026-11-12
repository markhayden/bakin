/**
 * The last line of `bakin onboard --json`: what the run came to. One
 * object under a `summary` key, so it can never be mistaken for a
 * component line.
 */
import { getSupportedRuntimeAdapterNames } from '../runtime-adapter-factory'
import { getSettings, type RuntimeAdapterName } from '../settings'
import { readStoredRuntimeAdapter } from './settings'

/**
 * Where the active runtime adapter came from:
 *  - `env`: `BAKIN_RUNTIME_ADAPTER` for this process (never persisted)
 *  - `existing`: `runtime.adapter` stored in this home's settings
 *  - `default`: neither; the built-in default
 */
export type RuntimeSource = 'env' | 'existing' | 'default'

export interface RunSummary {
  exitCode: 0 | 1 | 2
  markerWritten: boolean
  runtime: { adapter: RuntimeAdapterName; source: RuntimeSource }
}

function isAdapter(value: unknown): value is RuntimeAdapterName {
  return (getSupportedRuntimeAdapterNames() as readonly unknown[]).includes(value)
}

export function activeRuntime(): RunSummary['runtime'] {
  const adapter = getSettings().runtime.adapter
  if (isAdapter(process.env.BAKIN_RUNTIME_ADAPTER)) return { adapter, source: 'env' }
  return { adapter, source: readStoredRuntimeAdapter() ? 'existing' : 'default' }
}

export function runSummary(result: { exitCode: 0 | 1 | 2; markerWritten: boolean }): { summary: RunSummary } {
  return { summary: { exitCode: result.exitCode, markerWritten: result.markerWritten, runtime: activeRuntime() } }
}
