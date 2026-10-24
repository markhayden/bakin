/**
 * The repair runtime contract (#895 D10): every repair action declares an
 * operation plan and reports through the `op` context it receives — a
 * one-argument `apply` still type-checks, so this is checked at runtime.
 *
 * `runRepairContract` applies an action inside a real operation (in-memory
 * resources, so no lock files) built from its own `operationPlan`, records
 * every call it makes on `op`, and `expectRepairContract` asserts:
 * - it declares a plan with unique stage ids;
 * - it reported at least once;
 * - every stage it entered is declared, in plan order;
 * - no op call threw (an undeclared stage or item would);
 * - the operation finished and the rows came back.
 */
import { expect } from 'bun:test'

import {
  createMemoryResourceAcquirer,
  createOperationRegistry,
  type OperationContext,
  type OperationView,
} from '@bakin/core/operations'
import type { HealthRepairActionDefinition, HealthRepairApplyResult, HealthRepairPlanItem, HealthRepairPlanItemInput } from '@makinbakin/sdk/types'

export interface RepairContractRun {
  results: HealthRepairApplyResult[]
  view: OperationView
  /** Every op call in order, e.g. `stage:scan`, `item:scan:a`, `log`. */
  calls: string[]
  /** Errors thrown by op calls (swallowed by actions that catch). */
  opErrors: unknown[]
}

export async function runRepairContract(action: HealthRepairActionDefinition, items: HealthRepairPlanItem[]): Promise<RepairContractRun> {
  if (!action.operationPlan) throw new Error(`Repair action "${action.id}" declares no operationPlan`)
  const plan = action.operationPlan(items)
  const registry = createOperationRegistry({
    bootId: () => 'contract-boot',
    publish: () => {},
    quietCheckIntervalMs: 0,
    acquireResources: createMemoryResourceAcquirer(1),
  })
  const calls: string[] = []
  const opErrors: unknown[] = []
  let results: HealthRepairApplyResult[] = []
  const record = <F extends (...args: never[]) => void>(label: (args: Parameters<F>) => string, fn: F): F =>
    ((...args: Parameters<F>) => {
      calls.push(label(args))
      try {
        fn(...args)
      } catch (err) {
        opErrors.push(err)
        throw err
      }
    }) as F
  try {
    const { operationId } = await registry.start({
      kind: `repair:${action.id}`,
      owner: 'core',
      origin: 'system',
      title: action.name,
      fingerprint: `contract:${action.id}:${Math.random()}`,
      resources: action.resources ?? [],
      plan,
      run: async (inner) => {
        const op: OperationContext = {
          ...inner,
          id: inner.id,
          signal: inner.signal,
          stage: record(([id]) => `stage:${id}`, inner.stage),
          item: record(([stageId, item]) => `item:${stageId}:${item.id}`, inner.item),
          bytes: record(([stageId]) => `bytes:${stageId}`, inner.bytes),
          attempt: record(([stageId]) => `attempt:${stageId}`, inner.attempt),
          output: record(() => 'output', inner.output),
          log: record(() => 'log', inner.log),
          skip: record(([stageId]) => `skip:${stageId}`, inner.skip),
          throwIfCancelled: inner.throwIfCancelled,
          holds: inner.holds,
        }
        results = await action.apply(items, op)
        return { status: 'succeeded', code: 'ok', httpStatus: 200, body: results }
      },
    })
    const view = await registry.await(operationId)
    return { results, view, calls, opErrors }
  } finally {
    registry.dispose()
  }
}

export function expectRepairContract(action: HealthRepairActionDefinition, run: RepairContractRun): void {
  const planIds = run.view.plan.stages.map((s) => s.id)
  expect(new Set(planIds).size).toBe(planIds.length)
  expect(run.opErrors).toEqual([])
  expect(run.calls.length).toBeGreaterThan(0)
  const entered = run.calls.filter((c) => c.startsWith('stage:')).map((c) => c.slice('stage:'.length))
  for (const id of entered) expect(planIds).toContain(id)
  const order = entered.map((id) => planIds.indexOf(id))
  expect(order).toEqual([...order].sort((a, b) => a - b))
  expect(run.view.status).toBe('succeeded')
  expect(run.results.every((r) => r.actionId === action.id)).toBe(true)
}

/**
 * Canonical items from a planner's output, exactly as core stamps them
 * (three-outcomes cutover): `effects` default to the action's own, `mode`
 * comes from the ONE policy (one-click iff the effects delete content, spend
 * money or widen authorization).
 */
export function stampPlanItems(action: HealthRepairActionDefinition, items: HealthRepairPlanItemInput[]): HealthRepairPlanItem[] {
  return items.map((item) => {
    const effects = item.effects ?? action.effects
    const oneClick = effects.deletesUserContent || effects.spendsMoney || effects.widensAuthorization
    return { ...item, effects, mode: oneClick ? 'one-click' : 'self-heal' }
  })
}
