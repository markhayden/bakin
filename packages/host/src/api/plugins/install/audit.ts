/**
 * Security-rejection audit trail for the install endpoint. Shared by every
 * install phase module so the forensic-event shape can't drift between
 * phases.
 */
import { getContentDir } from '@/core/content-dir'
import { appendAudit } from '@/core/audit'

/**
 * Append a `plugin.install.rejected` audit entry with `kind: 'security'`
 * so operators can grep `~/.bakin/audit.jsonl` for the forensic trail
 * across path-traversal rejections, core-id collisions, manifest size
 * limits, consent-token failures, etc. Best-effort — never throws.
 */
export function auditInstallRejected(reason: string, source: string, extra: Record<string, unknown> = {}): void {
  try {
    appendAudit(getContentDir(), 'plugin.install.rejected', 'system', {
      kind: 'security',
      reason,
      source,
      ...extra,
    }, 'system')
  } catch {
    // best-effort
  }
}
