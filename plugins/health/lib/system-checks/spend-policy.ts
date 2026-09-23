/**
 * spend.policy-available — health-OWNED (D26): the spend plugin cannot
 * report its own activation failure, and while its `spend.getBudgetPolicy`
 * hook is absent or unanswering the dispatch gate fails closed with cause
 * `budget_policy_unavailable`. This check is what names that state on the
 * board and in the doctor.
 */
import { healthError, healthHealthy, healthObserved, healthUnknown } from '@makinbakin/sdk/utils'
import type { HealthCheckRunInput } from '@makinbakin/sdk'
import { getHookRegistry } from '@bakin/core/hooks/hook-registry-singleton'

const HOOK = 'spend.getBudgetPolicy'
const ANSWER_BUDGET_MS = 2_000

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
        impact: 'Task dispatch and billed media calls are deferring until the spend plugin answers.',
        disposition: 'action_required',
        resources: [{ kind: 'plugin', id: 'spend', label: 'Spend plugin' }],
        resolution: {
          key: 'inspect-spend-plugin',
          type: 'instructions',
          label: 'Inspect the spend plugin',
          steps: ['Check the server log for the spend plugin activation error, then restart Bakin and rerun Health.'],
        },
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
    return healthObserved([healthUnknown({
      key: 'hook',
      summary: 'The spend limits policy did not answer — dispatch is failing closed.',
      detail: err instanceof Error ? err.message : String(err),
      evidence: { hook: HOOK, registered: true },
      incident: {
        key: 'policy-unanswered',
        title: 'Spend limits policy is not answering',
        class: 'service_failure',
        impact: 'Task dispatch and billed media calls defer until the policy read succeeds.',
        disposition: 'watch',
        resources: [{ kind: 'plugin', id: 'spend', label: 'Spend plugin' }],
        resolution: { key: 'rerun', type: 'rerun', label: 'Rerun this check' },
      },
    })])
  }
}
