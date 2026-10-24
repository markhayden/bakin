/**
 * System check — capability-pack readiness.
 *
 * One finding per installed capability pack: ok when content + bins +
 * required secrets all stand, warn with the engine's remediation lines
 * otherwise. Readiness itself comes from the single engine in
 * src/core/agent-packages/capability-readiness.
 */
import { listCapabilities } from '../../../../src/core/agent-packages/capability-readiness'
import { capabilityRemedy } from '../../../../src/core/agent-packages/capability-remedy'
import { healthHealthy, healthObserved, healthWarning } from '@makinbakin/sdk/utils'
import type { HealthCheckRunInput, HealthObservationInput, HealthResolution } from '@makinbakin/sdk'
import { PACKAGE_REINSTALL_ACTION, PACKAGE_SYNC_ACTION } from './package-repairs'
import { stableKeyPart } from './key'

/**
 * Machine-fixable legs point at the matching pack repair (row 6); a human
 * need, and a platform-only gap, keep the Explore handoff until the 1.7
 * cutover gives them their own shapes.
 */
function capabilityResolution(remedy: ReturnType<typeof capabilityRemedy>, capability: string, name: string): HealthResolution {
  if (remedy === 'package-reinstall') return { key: PACKAGE_REINSTALL_ACTION, type: 'repair', label: `Reinstall ${name}`.slice(0, 120), actionId: PACKAGE_REINSTALL_ACTION }
  if (remedy === 'package-sync') return { key: PACKAGE_SYNC_ACTION, type: 'repair', label: `Sync ${name}`.slice(0, 120), actionId: PACKAGE_SYNC_ACTION }
  return {
    key: 'open-capability',
    type: 'navigate',
    label: 'Review capability setup',
    // The RAW slug (never the sanitized key): Explore matches it against the readiness rows (1.4c-2).
    href: `/explore?tab=capabilities&capability=${encodeURIComponent(capability)}`,
  }
}

export async function checkCapabilities(): Promise<HealthCheckRunInput> {
  const capabilities = await listCapabilities()
  if (capabilities.length === 0) {
    return healthObserved([healthHealthy({
      key: 'none-installed',
      summary: 'No capability packs are installed.',
      detail: 'Capability packs are optional and can be added from Explore when needed.',
      evidence: { installed: 0 },
    })])
  }

  const observations = capabilities.map<HealthObservationInput>((cap) => {
    const capabilityId = stableKeyPart(cap.capability)
    const capabilityName = cap.name.slice(0, 180)
    const missing = cap.missing.slice(0, 20).map((entry) => entry.slice(0, 500))
    const remedy = capabilityRemedy(cap)
    const evidence = {
      capability: cap.capability.slice(0, 500),
      packageId: cap.packageId.slice(0, 500),
      ready: cap.ready,
      remedy,
      missing,
    }
    if (cap.ready) {
      return healthHealthy({
        key: capabilityId,
        summary: `${capabilityName} is ready.`,
        evidence,
      })
    }
    return healthWarning({
      key: capabilityId,
      summary: `${capabilityName} needs setup.`,
      detail: missing.join('; ').slice(0, 4_000),
      evidence,
      incident: {
        key: `not-ready:${capabilityId}`,
        title: `${capabilityName.slice(0, 100)} is not ready`,
        impact: 'Agents cannot use this capability until its required content and tools are available.',
        disposition: 'action_required',
        resources: [{ kind: 'capability', id: capabilityId, label: capabilityName.slice(0, 120) }],
        resolution: capabilityResolution(remedy, cap.capability, capabilityName),
      },
    })
  })

  return healthObserved(observations as [HealthObservationInput, ...HealthObservationInput[]])
}
