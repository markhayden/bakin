/**
 * spend.policy-available — health-OWNED (D26): the spend plugin cannot
 * report its own activation failure, and while its `spend.getBudgetPolicy`
 * hook is absent or unanswering the dispatch gate fails closed with cause
 * `budget_policy_unavailable`. This check is what names that state on the
 * board and in the doctor.
 */
import { healthError, healthHealthy, healthObserved, healthUnknown } from '@makinbakin/sdk/utils'
import type { HealthCheckRunInput, HealthIncidentDeclaration } from '@makinbakin/sdk'
import { getHookRegistry } from '@bakin/core/hooks/hook-registry-singleton'

const HOOK = 'spend.getBudgetPolicy'
const ANSWER_BUDGET_MS = 2_000

/** Row 39: an absent plugin is the fallback lane's; row 40: the operator fixes the file; row 41: an observation. */
export const SPEND_POLICY_INCIDENTS: HealthIncidentDeclaration[] = [
  { id: 'policy-unavailable', subjectKind: 'plugin', resolution: { type: 'repair', actionId: 'core.diagnose' }, required: 'always' },
  { id: 'policy-invalid', subjectKind: 'record', resolution: { type: 'human', needs: 'decision' }, required: 'always' },
]

export async function checkSpendPolicyAvailable(): Promise<HealthCheckRunInput> {
  const registry = getHookRegistry()
  if (!registry.has(HOOK)) {
    return healthObserved([healthError({
      key: 'hook',
      summary: 'The spend limits policy is unavailable — dispatch is failing closed.',
      detail: `The spend plugin has not registered ${HOOK}. Until it does, every budget-gated turn defers (budget_policy_unavailable).`,
      evidence: { hook: HOOK, registered: false },
      incident: {
        key: 'policy-unavailable',
        title: 'Spend limits policy is unavailable',
        class: 'service_failure',
        impact: 'Task dispatch and billed media calls are deferring until the spend plugin answers (its activation error is in the server log).',
        disposition: 'action_required',
        subject: { kind: 'plugin', id: 'spend', label: 'Spend plugin' },
        declarationId: 'policy-unavailable',
        resources: [{ kind: 'plugin', id: 'spend', label: 'Spend plugin' }],
        resolution: { key: 'inspect-spend-plugin', type: 'repair', label: 'Investigate the spend plugin', actionId: 'core.diagnose' },
      },
    })])
  }
  try {
    const policy = await Promise.race([
      registry.invoke<{ rules?: unknown[] }>(HOOK, {}),
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error(`no answer within ${ANSWER_BUDGET_MS} ms`)), ANSWER_BUDGET_MS)),
    ])
    const rules = Array.isArray(policy?.rules) ? policy.rules.length : 0
    return healthObserved([healthHealthy({
      key: 'hook',
      summary: rules === 0 ? 'Spend limits policy answers (no limits set).' : `Spend limits policy answers (${rules} limit${rules === 1 ? '' : 's'}).`,
      evidence: { hook: HOOK, registered: true, rules },
    })])
  } catch (err) {
    // The spend plugin refuses to read a spend.json that exists but is not a
    // valid policy (S13: never "no limits"). That is an operator-fixable
    // file, not a transient read — name it, action required.
    const invalid = err as { code?: string; file?: string; issues?: string[] }
    if (invalid?.code === 'spend_settings_invalid') {
      return healthObserved([healthError({
        key: 'hook',
        summary: 'The spend limits file is invalid — dispatch is failing closed until it is fixed.',
        detail: err instanceof Error ? err.message : String(err),
        evidence: { hook: HOOK, registered: true, file: invalid.file ?? null, issues: invalid.issues ?? [] },
        incident: {
          key: 'policy-invalid',
          title: 'Spend limits file is invalid',
          class: 'service_failure',
          impact: 'Task dispatch and billed media calls defer until spend.json is a valid policy again. Your limits are still in the file — nothing has overwritten it.',
          disposition: 'action_required',
          subject: { kind: 'record', id: 'spend.json', label: 'spend.json' },
          declarationId: 'policy-invalid',
          resources: [{ kind: 'plugin', id: 'spend', label: 'Spend plugin' }],
          resolution: { key: 'recover-spend-policy', type: 'human', needs: 'decision', label: 'Fix spend.json', href: '/spend?recover=1' },
        },
      })])
    }
    // Row 41: an unanswered read is an observation; the check's maxAgeMs re-runs it.
    return healthObserved([healthUnknown({
      key: 'hook',
      summary: 'The spend limits policy did not answer — dispatch is failing closed.',
      detail: err instanceof Error ? err.message : String(err),
      evidence: { hook: HOOK, registered: true },
    })])
  }
}
