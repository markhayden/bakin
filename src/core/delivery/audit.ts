/**
 * delivery.* audit events (D13/§4.6): every connect/disconnect, successful
 * send, exhausted-retry failure, and denied interaction leaves a structured
 * trail in audit.jsonl — denials and final failures are never silent.
 */
import { appendAudit } from '@/core/audit'
import { getContentDir } from '@/core/content-dir'

export type DeliveryAuditEvent =
  | 'delivery.connected'
  | 'delivery.disconnected'
  | 'delivery.sent'
  | 'delivery.send_failed'
  | 'delivery.approval_rendered'
  | 'delivery.approval_denied'
  | 'delivery.inbound_denied'

export function auditDelivery(event: DeliveryAuditEvent, data: Record<string, unknown> = {}): void {
  appendAudit(getContentDir(), event, 'system', { platform: 'discord', ...data }, 'system')
}
