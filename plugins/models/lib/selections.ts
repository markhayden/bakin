/**
 * Plugin-side composition of the ONE model-selection write path (#907):
 * the core mutator over this plugin's routing settings + the active runtime,
 * with pending-write state and snapshots under plugin-settings/models/.
 * One mutator per process — the mutex and in-process reservations live on it.
 */
import { join } from 'path'
import type { PluginContext } from '@bakin/core/plugin-types'
import { getContentDir } from '../../../src/core/content-dir'
import { getBootId } from '../../../src/core/boot-id'
import { createSelectionMutator, type SelectionMutator } from '../../../src/core/model-mutations'
import { evaluateSelections, proposeRepairs, type UiMode } from '../../../src/core/model-selections'
import type { RoutingConfig } from '../../../src/core/model-routing'
import type { ModelsPluginSettings } from '../types'
import { isLegacyRouting, migrateLegacyRouting } from './routing-migration'

const holder = globalThis as typeof globalThis & { __bakinSelectionMutator?: SelectionMutator }

export function readRoutingSettings(ctx: PluginContext): { routing: RoutingConfig; uiMode: UiMode | null } {
  const settings = ctx.getSettings<ModelsPluginSettings>()
  const stored = settings.routing
  const routing = isLegacyRouting(stored) ? migrateLegacyRouting(stored) : (stored ?? { routes: [], tagOverrides: [] })
  const uiMode = settings.ui?.mode === 'simple' || settings.ui?.mode === 'advanced' ? settings.ui.mode : null
  return { routing, uiMode }
}

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
    audit: (event, data) => ctx.activity.audit(event.replace(/^models\./, ''), 'system', data),
  })
  holder.__bakinSelectionMutator = mutator
  return mutator
}

/** Test-only: drop the process singleton so a fresh ctx composes a new mutator. */
export function _resetSelectionMutator(): void {
  delete holder.__bakinSelectionMutator
}

/** GET /selections payload: states + revision + per-selection eligibility + proposals + pending writes. */
export async function describeSelections(ctx: PluginContext) {
  const mutator = getSelectionMutator(ctx)
  const { states, revision, pending } = await mutator.reconcile()
  // Each agent pin is judged under ITS agent's credentials (evaluateSelections).
  const evaluation = await evaluateSelections(ctx.runtime, states)
  const proposals = proposeRepairs(states.filter((s) => s.ref !== 'ui:mode'), evaluation.reportFor, { recommendFor: () => null, revision })
  return {
    revision,
    states: states.map((s) => ({
      ...s,
      eligibility: s.model && s.ref !== 'ui:mode' ? evaluation.eligibilityOf(s) ?? { status: 'unknown', detail: 'not evaluated' } : undefined,
    })),
    proposals,
    pending,
    evidence: evaluation.evidence,
  }
}
