/**
 * System check — capability-pack readiness.
 *
 * One finding per installed capability pack: ok when content + bins +
 * required secrets all stand, warn with the engine's remediation lines
 * otherwise. Readiness itself comes from the single engine in
 * src/core/agent-packages/capability-readiness.
 */
import { listCapabilities } from '../../../../src/core/agent-packages/capability-readiness'
import type { HealthCheckResult } from '../../../../packages/core/src/plugin-types'

export async function checkCapabilities(): Promise<HealthCheckResult[]> {
  const capabilities = await listCapabilities()
  if (capabilities.length === 0) {
    return [{
      check: 'capabilities',
      status: 'ok',
      message: 'No capability packs installed — browse Explore → Capabilities to add some.',
      autoFixable: false,
    }]
  }
  return capabilities.map((cap) => ({
    check: `capability.${cap.capability}`,
    status: cap.ready ? 'ok' as const : 'warn' as const,
    message: cap.ready
      ? `${cap.name} is ready`
      : `${cap.name} is not ready: ${cap.missing.join('; ')}`,
    autoFixable: false,
    data: { capability: cap.capability, packageId: cap.packageId, ready: cap.ready, missing: cap.missing },
  }))
}
