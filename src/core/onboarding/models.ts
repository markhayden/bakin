/**
 * models component — the recommended two-lane model plan at first run
 * (spec S7). Runs BEFORE any plugin is loaded, so it composes the core
 * pieces directly: the runtime catalog folded through eligibility, the
 * models plugin's routing settings file, the spend/assets settings files,
 * the ONE recommender (`src/core/model-plan.ts`) and the ONE write path
 * (`createSelectionMutator`, the same engine behind POST /selections).
 *
 *   check()  ok      — a persisted plan exists and both lanes are eligible
 *                      and suitable, or the install is already on the
 *                      recommendation
 *            missing — nothing persisted yet (fresh install): install() may
 *                      apply the recommendation
 *            warn    — a persisted plan has a dead or unsuitable lane; the
 *                      operator repairs it (`bakin models plan`, Models page)
 *                      — NEVER auto-applied, --yes included
 *   install() applies ONLY on --yes, an explicit TUI approval, or an
 *   interactive yes (the one permitted auto-apply: fresh install, no plan);
 *   nothing eligible ⇒ skipped with the credentials hint. A WORKING default
 *   is never moved (the recommender keeps an eligible current default); the
 *   only default --yes ever touches is a dead one, where nothing dispatches
 *   until it is repaired — leaving it would be the one outcome nobody wants.
 */
import { join } from 'path'

import type { AgentRuntimeAdapter } from '@bakin/core/adapters/runtime'
import type { BillingOverride } from '@bakin/core/llm/billing-lane'
import { mergePluginSettings, readPluginSettings } from '@bakin/core/plugins/settings-store'

import { createAppServices, maybeGetAppServices } from '../app-services'
import { appendAudit } from '../audit'
import { getBootId } from '../boot-id'
import { getContentDir } from '../content-dir'
import { createLogger } from '../logger'
import { createSelectionMutator } from '../model-mutations'
import { CHORES_CLASSES, recommendPlan, type PlanInput, type PlanRecommendation } from '../model-plan'
import { assemblePlanInput, listPlanCatalogRows } from '../model-plan-input'
import type { RoutingConfig } from '../model-routing'
import type { UiMode } from '../model-selections'
import { isLegacyRouting, migrateLegacyRouting } from '../routing-migration'
import { askYesNo } from './prompts'
import type { CheckResult, InstallResult, OnboardingComponent, OnboardingOptions } from './types'

const log = createLogger('onboarding:models')

interface ModelsSettingsFile { routing?: unknown; ui?: { mode?: string } }

async function getRuntime(): Promise<AgentRuntimeAdapter> {
  return maybeGetAppServices()?.runtime ?? (await createAppServices()).runtime
}

function loadRouting(): { routing: RoutingConfig; uiMode: UiMode | null } {
  const settings = readPluginSettings<ModelsSettingsFile>('models')
  const stored = settings.routing
  const routing = isLegacyRouting(stored) ? migrateLegacyRouting(stored) : ((stored as RoutingConfig | undefined) ?? { routes: [], tagOverrides: [] })
  const uiMode = settings.ui?.mode === 'simple' || settings.ui?.mode === 'advanced' ? settings.ui.mode : null
  return { routing, uiMode }
}

function saveRouting(routing: RoutingConfig, uiMode: UiMode | null): void {
  mergePluginSettings('models', { routing, ui: uiMode ? { mode: uiMode } : {} })
}

/** A plan is persisted once the operator (or onboarding) chose chores routes or visited the Models page. */
function planPersisted(routing: RoutingConfig, uiMode: UiMode | null): boolean {
  return uiMode !== null || routing.routes.some((r) => (CHORES_CLASSES as readonly string[]).includes(r.workClass) && r.model)
}

interface Assessment {
  input: PlanInput
  plan: PlanRecommendation
  persisted: boolean
  /** Lanes of the PERSISTED plan that cannot run or cannot do the job, in plain words. */
  problems: string[]
}

async function assess(): Promise<Assessment> {
  const runtime = await getRuntime()
  const { routing, uiMode } = loadRouting()
  const spend = readPluginSettings<{ billing?: { overrides?: BillingOverride[] } }>('spend')
  const assets = readPluginSettings<{ enrichmentEnabled?: boolean }>('assets')
  const input = await assemblePlanInput({
    runtime,
    rows: await listPlanCatalogRows(runtime),
    routing,
    enrichmentEnabled: assets.enrichmentEnabled !== false,
    billingOverrides: spend.billing?.overrides ?? [],
  })
  const plan = recommendPlan(input)
  const eligible = new Set(input.candidates.map((c) => c.id))
  const cannotSee = (model: string) => input.candidates.find((c) => c.id === model)?.vision === false
  const problems: string[] = []
  const agentModel = input.currentDefaultModel
  if (!agentModel) problems.push('no default model is set')
  else if (!eligible.has(agentModel)) problems.push(`the default model ${agentModel} cannot run here`)
  for (const workClass of CHORES_CLASSES) {
    const routed = routing.routes.find((r) => r.workClass === workClass)?.model ?? null
    if (!routed) {
      // An unrouted chore inherits the default, whose eligibility problem is
      // reported once above — but enrichment also needs to SEE, and a
      // text-only default inherited by enrichment fails on every image.
      if (workClass === 'enrichment' && input.enrichmentEnabled && agentModel && eligible.has(agentModel) && cannotSee(agentModel)) {
        problems.push(`enrichment inherits the default model ${agentModel}, which cannot see images`)
      }
      continue
    }
    if (!eligible.has(routed)) {
      problems.push(`${workClass} routes to ${routed}, which cannot run here`)
    } else if (workClass === 'enrichment' && input.enrichmentEnabled && cannotSee(routed)) {
      problems.push(`enrichment routes to ${routed}, which cannot see images`)
    }
  }
  // Nothing eligible can see: the recommender cannot route enrichment either,
  // so "on the recommended plan" is still not a plan under which enrichment runs.
  if (plan.enrichment === 'unset') {
    problems.push('no eligible model can see images, so enrichment (captions, OCR, tags) will fail until a vision-capable model is available')
  }
  return { input, plan, persisted: planPersisted(routing, uiMode), problems }
}

function describe(plan: PlanRecommendation): string {
  const agent = plan.agent.model ?? '(none)'
  const chores = plan.chores.model ?? '(none)'
  const enrichment = plan.enrichment === 'agent'
    ? `; enrichment on ${agent}`
    : plan.enrichment === 'unset' ? '; enrichment will fail until a vision-capable model is available' : ''
  return `agent model ${agent}, background chores ${chores} (${plan.chores.why})${enrichment}`
}

async function check(): Promise<CheckResult> {
  const { input, plan, persisted, problems } = await assess()
  const details = { agent: plan.agent.model, chores: plan.chores.model, enrichment: plan.enrichment, ops: plan.ops.length, candidates: input.candidates.length, persisted }
  if (input.candidates.length === 0) {
    return { name: 'models', status: 'missing', message: 'No model can run here yet — add credentials for a provider first.', remediation: 'Configure an LLM provider in the runtime, then rerun `bakin onboard` or `bakin models plan --apply`.', details }
  }
  // An install on the recommendation, or a persisted plan, is still not
  // "ok" while one of its jobs cannot run — enrichment on a model that
  // cannot see is the case an empty diff used to hide.
  const attention = (): CheckResult => ({
    name: 'models',
    status: 'warn',
    message: `Your model plan needs attention: ${problems.join('; ')}.`,
    remediation: `Review the recommendation with \`bakin models plan\` (apply with --apply) or open Models in the browser. Recommended: ${describe(plan)}.`,
    details: { ...details, problems },
  })
  if (plan.ops.length === 0) {
    if (problems.length > 0) return attention()
    return { name: 'models', status: 'ok', message: `Model plan in place: ${describe(plan)}.`, details }
  }
  if (persisted) {
    if (problems.length === 0) {
      return { name: 'models', status: 'ok', message: `Model plan in place (agent ${input.currentDefaultModel}); the recommended plan would differ — see \`bakin models plan\`.`, details }
    }
    return attention()
  }
  return {
    name: 'models',
    status: 'missing',
    message: `No model plan chosen yet. Recommended: ${describe(plan)}.`,
    remediation: 'Approve the recommendation during onboarding, run `bakin models plan --apply`, or pick models on the Models page.',
    details,
  }
}

async function apply(runtime: AgentRuntimeAdapter, ops: PlanRecommendation['ops']): Promise<{ applied: number; failed: string[]; pending: number }> {
  const contentDir = getContentDir()
  const mutator = createSelectionMutator({
    runtime,
    loadRouting,
    saveRouting,
    stateDir: join(contentDir, 'plugin-settings', 'models'),
    bootId: getBootId(),
    // Same trail the plugin path writes — an onboarding write is still a write.
    audit: (event, data) => appendAudit(contentDir, event, 'system', data, 'system'),
  })
  const { revision } = await mutator.reconcile()
  const result = await mutator.mutate({ revision, ops })
  return { applied: result.applied.length, failed: result.failed.map((f) => `${f.ref}: ${f.error.message}`), pending: result.pending.length }
}

async function install(opts: OnboardingOptions): Promise<InstallResult> {
  const start = Date.now()
  const { input, plan, persisted, problems } = await assess()
  if (input.candidates.length === 0) {
    return { name: 'models', status: 'skipped', message: 'No model can run here yet — add credentials for a provider, then `bakin models plan --apply`.', durationMs: Date.now() - start }
  }
  if (plan.ops.length === 0) {
    const caveat = problems.length > 0 ? ` Needs attention: ${problems.join('; ')}.` : ''
    return { name: 'models', status: 'noop', message: `Already on the recommended plan: ${describe(plan)}.${caveat}`, durationMs: Date.now() - start }
  }
  if (persisted) {
    // Never auto-apply over an existing plan — the operator repairs it.
    const why = problems.length > 0 ? `needs attention (${problems.join('; ')})` : 'is in place'
    return { name: 'models', status: 'skipped', message: `Your model plan ${why} — review with \`bakin models plan\`; onboarding never changes an existing plan.`, durationMs: Date.now() - start }
  }

  const approved = opts.autoApprove || opts.approvedComponents?.includes('models') === true
  if (!approved && opts.interactive) {
    console.log(`  Recommended model plan: ${describe(plan)}.`)
    for (const note of plan.notes) console.log(`  Note: ${note}`)
    const yes = await askYesNo('Use this plan? (change it any time on the Models page)')
    if (!yes) {
      return { name: 'models', status: 'skipped', message: 'declined — pick models on the Models page or run `bakin models plan --apply`', durationMs: Date.now() - start }
    }
  } else if (!approved) {
    return { name: 'models', status: 'skipped', message: 'not approved for non-interactive install — run `bakin models plan --apply` to use the recommendation', durationMs: Date.now() - start }
  }

  try {
    const runtime = await getRuntime()
    const outcome = await apply(runtime, plan.ops)
    if (outcome.failed.length > 0) {
      return { name: 'models', status: 'failed', message: `Model plan partially applied (${outcome.applied} ok): ${outcome.failed.join('; ')}`, durationMs: Date.now() - start }
    }
    const pending = outcome.pending > 0 ? ` (${outcome.pending} write${outcome.pending === 1 ? '' : 's'} still pending runtime confirmation)` : ''
    return { name: 'models', status: 'installed', message: `Model plan applied: ${describe(plan)}${pending}.`, durationMs: Date.now() - start }
  } catch (err) {
    log.error('Model plan apply failed', err)
    return { name: 'models', status: 'failed', message: `Model plan apply failed: ${err instanceof Error ? err.message : String(err)}`, error: err, durationMs: Date.now() - start }
  }
}

export const modelsComponent: OnboardingComponent = {
  name: 'models',
  check,
  install,
}
