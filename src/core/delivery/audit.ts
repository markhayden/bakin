/**
 * delivery.* audit events (D13/§4.6, #908): every reconcile attempt,
 * connect/connect-failure/disconnect, successful send, exhausted-retry
 * failure, and denied interaction leaves a structured trail in audit.jsonl —
 * denials and final failures are never silent. Never carries a token.
 */
import { appendAudit } from '@/core/audit'
import { getContentDir } from '@/core/content-dir'

export type DeliveryAuditEvent =
  | 'delivery.reconciling'
  | 'delivery.connected'
  | 'delivery.connect_failed'
  | 'delivery.disconnected'
  | 'delivery.sent'
  | 'delivery.send_failed'
  | 'delivery.approval_rendered'
  | 'delivery.approval_denied'
  | 'delivery.inbound_denied'

export function auditDelivery(event: DeliveryAuditEvent, data: Record<string, unknown> = {}): void {
  appendAudit(getContentDir(), event, 'system', { platform: 'discord', ...data }, 'system')
}
