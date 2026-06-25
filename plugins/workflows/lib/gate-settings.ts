/**
 * Gate notification settings accessor
 *
 * Holds the seed/fallback gate-notification settings (formerly a mutable
 * module global in index.ts). `activeGateSettings()` prefers the live
 * notifications store and falls back to this seed — preserving the exact
 * resolution order. activate() seeds it; onSettingsChange updates the store
 * only (matching prior behavior, where the seed was the initial value and the
 * store was the live source of truth).
 */
import { getGateNotificationSettings, type GateNotificationSettings } from './notifications'

let gateNotificationSettings: GateNotificationSettings = {
  approvalChannelAlerts: false,
  approvalChannel: 'general',
  requireRejectReason: true,
}

export function setGateSettings(settings: GateNotificationSettings): void {
  gateNotificationSettings = settings
}

export function getGateSettings(): GateNotificationSettings {
  return gateNotificationSettings
}

export function activeGateSettings(): GateNotificationSettings {
  return getGateNotificationSettings() ?? gateNotificationSettings
}
