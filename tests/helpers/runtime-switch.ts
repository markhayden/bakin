/**
 * The runtime switch inside a real operation that owns install-state, the
 * way `POST /api/runtime/switch` runs it (#895) — with the plan the route
 * declares, so tests read the phases as the operation's stages.
 */
import type { OperationStageStatus } from '@bakin/core/operations'
import {
  RUNTIME_SWITCH_DRY_RUN_PLAN,
  RUNTIME_SWITCH_PLAN,
  switchRuntime,
  type RuntimeSwitchResult,
  type SwitchRuntimeOptions,
} from '../../src/core/runtime-switch'
import { withOperationView } from './operation-harness'

type SwitchOptions = Omit<SwitchRuntimeOptions, 'op'>

/** The switch and each stage's final status (`done`, `skipped`, `failed`, `pending`). */
export async function switchWithStages(target: string, opts: SwitchOptions = {}): Promise<{ result: RuntimeSwitchResult; stages: Record<string, OperationStageStatus> }> {
  const { value, view } = await withOperationView(
    { plan: opts.dryRun ? RUNTIME_SWITCH_DRY_RUN_PLAN : RUNTIME_SWITCH_PLAN, resources: ['install-state'] },
    (op) => switchRuntime(target, { ...opts, op }),
  )
  return { result: value, stages: Object.fromEntries(view.stages.map((s) => [s.id, s.status])) }
}

export async function switchInOperation(target: string, opts: SwitchOptions = {}): Promise<RuntimeSwitchResult> {
  return (await switchWithStages(target, opts)).result
}
