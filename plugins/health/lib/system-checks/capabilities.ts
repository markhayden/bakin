/**
 * System check — capability-pack readiness.
 *
 * One finding per installed capability pack: ok when content + bins +
 * required secrets all stand, warn with the engine's remediation lines
 * otherwise. Readiness itself comes from the single engine in
 * src/core/agent-packages/capability-readiness.
 */
import { listCapabilities, type CapabilityReadiness } from '../../../../src/core/agent-packages/capability-readiness'
import { readLockfile, type Lockfile } from '../../../../packages/core/src/agent-packages/lockfile'
import { capabilityRemedy } from '../../../../src/core/agent-packages/capability-remedy'
import { healthHealthy, healthObserved, healthWarning } from '@makinbakin/sdk/utils'
import type { HealthCheckRunInput, HealthIncidentDeclaration, HealthObservationInput, HealthResolution } from '@makinbakin/sdk'
import { PACKAGE_REINSTALL_ACTION, PACKAGE_SYNC_ACTION } from './package-repairs'
import { stableKeyPart } from './key'

/**
 * Row 6 (split): the `not-ready:<capability>` incident belongs to ONE of four
 * families, chosen by `capabilityRemedy` — the content legs sync, a binary or
 * manifest problem reinstalls, a missing required secret is the operator's
 * credential, a missing required tool is an install outside Bakin. A
 * platform-only gap is an observation. Required only while an agent declares
 * the capability: an installed agent package that depends on the pack (the
 * lockfile's `dependents` / the agent entry's `dependencies`). A pack nothing
 * declares is advisory — installed, not yet put to use.
 */
export const CAPABILITIES_INCIDENTS: HealthIncidentDeclaration[] = [
  { id: 'not-ready-sync', subjectKind: 'package', resolution: { type: 'repair', actionId: PACKAGE_SYNC_ACTION }, required: 'owner-decides' },
  { id: 'not-ready-reinstall', subjectKind: 'package', resolution: { type: 'repair', actionId: PACKAGE_REINSTALL_ACTION }, required: 'owner-decides' },
  { id: 'not-ready-credential', subjectKind: 'package', resolution: { type: 'human', needs: 'credential' }, required: 'owner-decides' },
  { id: 'not-ready-install', subjectKind: 'package', resolution: { type: 'human', needs: 'external-install' }, required: 'owner-decides' },
]

type Family = HealthIncidentDeclaration['id']

/** The family and resolution a not-ready pack lands in; null for a platform-only gap (an observation). */
export function capabilityFamily(cap: CapabilityReadiness): { declarationId: Family; resolution: HealthResolution } | null {
  const remedy = capabilityRemedy(cap)
  const name = cap.name.slice(0, 100)
  // The RAW slug (never the sanitized key): Explore matches it against the readiness rows (1.4c-2).
  const href = `/explore?tab=capabilities&capability=${encodeURIComponent(cap.capability)}`
  if (remedy === 'package-reinstall') return { declarationId: 'not-ready-reinstall', resolution: { key: PACKAGE_REINSTALL_ACTION, type: 'repair', label: `Reinstall ${name}`.slice(0, 120), actionId: PACKAGE_REINSTALL_ACTION } }
  if (remedy === 'package-sync') return { declarationId: 'not-ready-sync', resolution: { key: PACKAGE_SYNC_ACTION, type: 'repair', label: `Sync ${name}`.slice(0, 120), actionId: PACKAGE_SYNC_ACTION } }
  if (remedy === 'human') {
    const secret = cap.secrets.find((row) => row.required && row.status === 'missing')
    if (secret) {
      return {
        declarationId: 'not-ready-credential',
        resolution: { key: 'add-secret', type: 'human', needs: 'credential', label: `Add ${secret.name} in Settings → Integrations & Keys`.slice(0, 120), href, ...(secret.secretSlot ? { field: `secret-slot-${secret.secretSlot}` } : {}) },
      }
    }
    const prereq = cap.prereqs.find((row) => !row.optional && row.status === 'missing')
    return {
      declarationId: 'not-ready-install',
      resolution: { key: 'install-prereq', type: 'human', needs: 'external-install', label: `Install ${prereq?.name ?? 'the missing tool'}`.slice(0, 120), href, ...(prereq?.help ? { handoff: { command: prereq.help } } : {}) },
    }
  }
  return null
}

/** Pure: the installed agent packages that declare this pack (lockfile `dependents` ∪ agent entries whose `dependencies` name it). */
export function capabilityDeclaredBy(lock: Lockfile, cap: Pick<CapabilityReadiness, 'packageId' | 'version'>): string[] {
  const key = `${cap.packageId}@${cap.version}`
  const entry = lock.packages[key] ?? lock.packages[cap.packageId]
  const declared = new Set<string>(entry?.dependents ?? [])
  for (const [agentKey, candidate] of Object.entries(lock.packages)) {
    if (candidate.kind !== 'agent') continue
    if ((candidate.dependencies ?? []).some((dep) => dep === key || dep === cap.packageId || dep.startsWith(`${cap.packageId}@`))) declared.add(agentKey)
  }
  return [...declared].sort()
}

export async function checkCapabilities(deps: { lockfile?: () => Lockfile } = {}): Promise<HealthCheckRunInput> {
  const capabilities = await listCapabilities()
  const lock = (deps.lockfile ?? readLockfile)()
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
    const family = capabilityFamily(cap)
    // Row 6: required only while an agent declares the capability (a usage FACT from the lockfile), else advisory.
    const declaredBy = capabilityDeclaredBy(lock, cap)
    const required = declaredBy.length > 0
    if (!family) {
      // A platform-only gap (or optional prereqs): an observation, never a card.
      return healthWarning({
        key: capabilityId,
        summary: `${capabilityName} is unavailable on this platform.`,
        detail: missing.join('; ').slice(0, 4_000),
        evidence,
      })
    }
    return healthWarning({
      key: capabilityId,
      summary: `${capabilityName} needs setup.`,
      detail: missing.join('; ').slice(0, 4_000),
      evidence: { ...evidence, declaredBy },
      incident: {
        key: `not-ready:${capabilityId}`,
        title: `${capabilityName.slice(0, 100)} is not ready`,
        impact: required
          ? `Agents that declare this capability (${declaredBy.join(', ')}) cannot use it until its required content and tools are available.`
          : 'No installed agent declares this capability yet; nothing is blocked until one does.',
        disposition: required ? 'action_required' : 'advisory',
        subject: { kind: 'package', id: cap.packageId.slice(0, 500), label: capabilityName.slice(0, 120) },
        declarationId: family.declarationId,
        required,
        resources: [{ kind: 'capability', id: capabilityId, label: capabilityName.slice(0, 120) }],
        resolution: family.resolution,
      },
    })
  })

  return healthObserved(observations as [HealthObservationInput, ...HealthObservationInput[]])
}
