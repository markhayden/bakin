/**
 * `core.onboard` (self-healing PR1 slice 1.3c, re-homing row 205): the
 * onboarding gate's one button. It runs exactly what `bakin onboard --yes`
 * runs — every applicable component in dependency order, defaults approved —
 * each component as its own operation (the ONE builder behind the CLI and
 * `POST /api/runtime/onboarding/install`), and writes the marker at the end.
 * First-run choices are made for the operator here, so the repair is
 * `manual`: a click or an approval, never unattended.
 *
 * This module is a leaf on purpose: the onboarding engine is injected by the
 * doctor coordinator (`src/core/doctor.ts`), because `doctor-execution` is
 * reachable from the onboarding components' own checks and a static edge
 * back into `onboarding/index` would close an import cycle.
 */
import type { HealthRepairActionDefinition, HealthRepairApplyResult, OperationContext } from '@makinbakin/sdk'
import { repairTargetSelection } from '@bakin/core/health/repair-support'
import type { InstallResult, InstallableComponent, OnboardingOptions } from './onboarding/types'
import type { OnboardingInstallOptions } from './onboarding/install-request'

export const ONBOARD_ACTION = 'onboard'
const CHECK_ID = 'core.onboarded'

export interface OnboardRepairDeps {
  runOnboard: (
    opts: OnboardingOptions,
    installComponent: (component: InstallableComponent, options: OnboardingInstallOptions) => Promise<InstallResult>,
  ) => Promise<{ markerWritten: boolean }>
  /** One component as its own operation; the repair's op only lists the outcomes. */
  runComponent: (name: string, options: OnboardingInstallOptions, op: OperationContext) => Promise<InstallResult>
}

export function onboardRepair(deps: OnboardRepairDeps): HealthRepairActionDefinition {
  return {
    id: ONBOARD_ACTION,
    name: 'Complete first-run setup',
    // Each component is its own operation and owns its own resources.
    operationPlan: () => ({ stages: [{ id: 'components', kind: 'installing', label: 'Run the setup components' }], pointOfNoReturn: 'components' }),
    async plan(target) {
      return [{
        id: ONBOARD_ACTION,
        actionId: ONBOARD_ACTION,
        title: 'Complete first-run setup with the default choices',
        reason: 'Bakin has not completed first-run setup on this machine, so runtime and plugin checks cannot be trusted yet.',
        safety: 'manual',
        ...repairTargetSelection(target),
        changes: [{ kind: 'setting', target: 'onboarding', action: 'update', description: 'Run every setup component with its default choices — what `bakin onboard --yes` does — and mark this machine onboarded when they all succeed.' }],
      }]
    },
    async apply(items, op) {
      if (items.length === 0) return []
      const result = (status: HealthRepairApplyResult['status'], message: string): HealthRepairApplyResult[] =>
        items.map((item) => ({ itemId: item.id, actionId: item.actionId, status, message, affectedCheckIds: [CHECK_ID], changes: item.changes }))
      op.stage('components')
      const failed: string[] = []
      try {
        const run = await deps.runOnboard(
          {
            autoApprove: true,
            json: false,
            checkOnly: false,
            force: false,
            onOutcome: (outcome) => {
              if (outcome.finalStatus === 'error') failed.push(`${outcome.name}: ${outcome.message}`)
            },
          },
          async (component, options) => {
            op.item('components', { id: component.name, label: component.name, status: 'active' })
            const installed = await deps.runComponent(component.name, options, op)
            if (installed.status === 'failed') failed.push(`${component.name}: ${installed.message}`)
            op.item('components', { id: component.name, label: component.name, status: installed.status === 'failed' ? 'failed' : installed.status === 'skipped' ? 'skipped' : 'done', message: installed.message })
            return installed
          },
        )
        if (run.markerWritten) return result('applied', 'First-run setup completed with the default choices.')
        return result('failed', `First-run setup did not complete${failed.length > 0 ? `: ${[...new Set(failed)].join('; ')}` : ''}.`)
      } catch (err) {
        return result('failed', `First-run setup stopped: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
  }
}
