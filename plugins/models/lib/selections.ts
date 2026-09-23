/**
 * Plugin-side composition of the ONE model-selection write path (#907):
 * the core mutator over this plugin's routing settings + the active runtime,
 * with pending-write state and snapshots under plugin-settings/models/.
 * One mutator per process — the mutex and in-process reservations live on it.
 */
import { join } from 'path'
import type { PluginContext } from '@bakin/core/plugin-types'
import type { RuntimeConfigChangeKind } from '@bakin/core/adapters/runtime'
import { createLogger } from '../../../src/core/logger'
import { getContentDir } from '../../../src/core/content-dir'
import { getBootId } from '../../../src/core/boot-id'
import { createSelectionMutator, type MutateRequest, type MutateResult, type SelectionMutator } from '../../../src/core/model-mutations'
import { evaluateSelections, proposeRepairs } from '../../../src/core/model-selections'
import { recommendForRef } from '../../../src/core/model-plan-input'
import { notePendingChange } from '../../../src/core/pending-restart'
import { setModelsCache } from './available-models'
import { readRoutingSettings } from './routing-settings'
import { currentPlan, lastPlan } from './plan'

export { readRoutingSettings }

const log = createLogger('models:selections')

const holder = globalThis as typeof globalThis & { __bakinSelectionMutator?: SelectionMutator }

export function modelsStateDir(): string {
  return join(getContentDir(), 'plugin-settings', 'models')
}

export function getSelectionMutator(ctx: PluginContext): SelectionMutator {
  if (holder.__bakinSelectionMutator) return holder.__bakinSelectionMutator
  const mutator = createSelectionMutator({
    runtime: ctx.runtime,
    loadRouting: () => readRoutingSettings(ctx),
    saveRouting: (routing, uiMode) => {
      ctx.updateSettings({ routing, ui: uiMode ? { mode: uiMode } : {} })
    },
    stateDir: modelsStateDir(),
    bootId: getBootId(),
    // A refused write's proposal reads the last computed plan (GET /plan or
    // /selections refresh it); every proposal is re-checked for eligibility.
    recommendFor: (ref) => {
      const plan = lastPlan()
      return plan ? recommendForRef(plan, ref) : null
    },
    audit: (event, data) => ctx.activity.audit(event.replace(/^models\./, ''), 'system', data),
  })
  holder.__bakinSelectionMutator = mutator
  return mutator
}

/** Test-only: drop the process singleton so a fresh ctx composes a new mutator. */
export function _resetSelectionMutator(): void {
  delete holder.__bakinSelectionMutator
}

/**
 * The ONE write: mutate + the post-write side effects every writer needs —
 * POST /selections, the dead-selections repair and the recommended-routes
 * repair all land here. Runtime-config refs (agent pins, the runtime
 * policy) ask the adapter whether a restart is needed (#878), drop the
 * catalog's default/fallback flags and tell every mounted picker the
 * catalog changed; route/tag/page-mode refs touch neither the runtime
 * config nor the catalog and stay silent.
 */
export async function applySelections(ctx: PluginContext, request: MutateRequest): Promise<MutateResult> {
  const result = await getSelectionMutator(ctx).mutate(request)
  const touched = [...result.applied, ...result.pending.map((p) => p.ref)]
  const kinds = new Set<RuntimeConfigChangeKind>()
  for (const ref of touched) {
    if (ref.startsWith('agent:')) kinds.add('model-config')
    else if (ref.startsWith('policy:')) kinds.add('routing-policy')
  }
  if (kinds.size > 0) {
    notePendingChange(ctx.runtime, [...kinds])
    setModelsCache(null)
    ctx.events.emit('models.catalog_changed', { reason: 'selections', refs: touched })
  }
  return result
}

/** GET /selections payload: states + revision + per-selection eligibility + proposals + pending writes. */
export async function describeSelections(ctx: PluginContext) {
  const mutator = getSelectionMutator(ctx)
  const { states, revision, pending } = await mutator.reconcile()
  // Each agent pin is judged under ITS agent's credentials (evaluateSelections);
  // proposals read the plan when it is available, same-id mapping otherwise.
  const [evaluation, plan] = await Promise.all([
    evaluateSelections(ctx.runtime, states),
    currentPlan(ctx).catch((err: unknown) => {
      log.warn('Model plan unavailable for proposals; same-id mapping only', { err: err instanceof Error ? err.message : String(err) })
      return null
    }),
  ])
  const proposals = proposeRepairs(states.filter((s) => s.ref !== 'ui:mode'), evaluation.reportFor, { recommendFor: (ref) => (plan ? recommendForRef(plan, ref) : null), revision })
  return {
    revision,
    // Which routing knobs the ACTIVE runtime honors — the page hides the rest.
    support: ctx.runtime.models.routingSupport(),
    states: states.map((s) => ({
      ...s,
      eligibility: s.model && s.ref !== 'ui:mode' ? evaluation.eligibilityOf(s) ?? { status: 'unknown', detail: 'not evaluated' } : undefined,
    })),
    proposals,
    pending,
    evidence: evaluation.evidence,
  }
}
