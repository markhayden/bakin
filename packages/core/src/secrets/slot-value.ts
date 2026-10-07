/**
 * The PRIVATE value path for declared secret slots. Only transports and the
 * boot-time env injector import this; every status/UI surface uses
 * `resolveSecretSlotStatus` from `./slots` instead. Not re-exported by the
 * `@bakin/core` root barrel (pinned by tests/core/secrets/slots.test.ts).
 */
import { getStoredSecret } from '../media/secret-store'
import type { SecretSlotDef } from './slots'

/** Env first (trimmed, blank = unset), then the store, else null. */
export function readSecretSlotValue(def: SecretSlotDef): string | null {
  if (def.envVar) {
    const raw = process.env[def.envVar]?.trim()
    if (raw) return raw
  }
  return getStoredSecret(def.provider, def.name)
}
