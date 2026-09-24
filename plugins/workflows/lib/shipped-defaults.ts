/**
 * Shipped-defaults receipt + health check.
 *
 * `activate()` records what the plugin-resources resolver found and what
 * registered. The check turns "this build cannot see its own shipped
 * workflows" (the compiled-binary regression that ran silent for months —
 * every loader returned early on a missing directory) into an
 * action-required incident with the resolver's evidence, instead of a
 * Workflows page that is simply empty.
 */
import type { HealthCheckRunInput, HealthObservationInput } from '@bakin/core/plugin-types'
import { healthHealthy, healthObserved, healthUnknown, healthWarning } from '@makinbakin/sdk/utils'
import { describePluginDefaults, type ShippedWorkflowFile } from '../../../src/core/plugin-resources'
import type { LoadDefaultsResult } from './load-defaults'

export interface ShippedDefaultsReceipt extends LoadDefaultsResult {
  files: readonly ShippedWorkflowFile[]
  /** Plugin root the resolver was asked about (module dir on a checkout, /$bunfs inside a binary). */
  pluginPath?: string
}

let receipt: ShippedDefaultsReceipt | null = null

export function recordShippedDefaults(next: ShippedDefaultsReceipt): void {
  receipt = next
}

/** Test seam. */
export function resetShippedDefaults(): void {
  receipt = null
}

export function getShippedDefaultsReceipt(): ShippedDefaultsReceipt | null {
  return receipt
}

const RESOURCE = { kind: 'plugin', id: 'workflows', label: 'Workflows' } as const

export function checkShippedDefaults(): HealthCheckRunInput {
  if (!receipt) {
    return healthObserved([healthUnknown({
      key: 'shipped-defaults',
      summary: 'Shipped workflow defaults have not been loaded yet.',
      incident: {
        key: 'shipped-defaults-pending',
        title: 'Shipped workflow defaults not loaded yet',
        impact: 'The plugin has not activated in this process, so nothing can be verified.',
        disposition: 'watch',
        resources: [RESOURCE],
        resolution: { key: 'rerun', type: 'rerun', label: 'Rerun check' },
      },
    })])
  }

  const report = describePluginDefaults('workflows', receipt.pluginPath)
  const evidence = {
    source: report.source,
    diskDefaultsDir: report.diskDefaultsDir,
    embeddedEntries: report.embeddedCount,
    filesFound: receipt.files.length,
    registered: receipt.registered.length,
    skipped: receipt.skipped.length,
  }

  if (receipt.files.length === 0) {
    return healthObserved([healthWarning({
      key: 'shipped-defaults',
      summary: 'This build cannot locate the workflows the plugin ships.',
      evidence,
      incident: {
        key: 'shipped-defaults-missing',
        title: 'Shipped workflow defaults are unavailable',
        impact: report.source === 'embedded'
          ? 'The binary carries no embedded copy of the plugin defaults, so the default workflows and their step skills never register. This is a build defect — upgrade to a release whose embedded-assets manifest includes plugin defaults.'
          : 'The plugin directory exists but has no defaults/workflows/ entries, so no default workflows register.',
        disposition: 'action_required',
        resources: [RESOURCE],
        resolution: { key: 'review-workflows', type: 'navigate', label: 'Review Workflows', href: '/workflows' },
      },
    })])
  }

  const observations: HealthObservationInput[] = []
  for (const skipped of receipt.skipped) {
    observations.push(healthWarning({
      key: `shipped-default-${skipped.id}`,
      summary: `Shipped workflow ${skipped.id} did not register: ${skipped.errors.join('; ')}`.slice(0, 500),
      evidence: { id: skipped.id, errors: skipped.errors.join('; ').slice(0, 500) },
      incident: {
        key: `shipped-default-${skipped.id}`,
        title: `Shipped workflow ${skipped.id} did not register`,
        impact: 'The workflow is unavailable until the shipped definition validates.',
        disposition: 'watch',
        resources: [{ kind: 'workflow', id: skipped.id, label: skipped.id }],
        resolution: { key: 'review-workflows', type: 'navigate', label: 'Review Workflows', href: '/workflows' },
      },
    }))
  }
  if (observations.length === 0) {
    observations.push(healthHealthy({
      key: 'shipped-defaults',
      summary: `${receipt.registered.length} shipped workflow(s) registered from ${report.source === 'embedded' ? 'the embedded copies' : 'disk'}.`,
      evidence,
    }))
  }
  return healthObserved(observations as [HealthObservationInput, ...HealthObservationInput[]])
}
