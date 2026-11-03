/**
 * The ONE mode policy (spec D2, §3.2): does a repair run unattended
 * (self-heal) or wait for the operator's click (one-click)?
 *
 * A repair self-heals unless it deletes user content, spends money, or
 * widens what the operator authorized (new permissions, binaries, secrets,
 * npm payloads, or a spend/routing/policy change). Restarting a supervised
 * service is NOT by itself a reason to ask — the maintenance coordinator
 * (§3.12) decides WHEN such a repair may run, not WHETHER.
 *
 * Nothing else may re-derive this decision: every surface (the repair
 * engine, the planner, the CLI, the cards) calls `repairMode`.
 */

import type { HealthRepairEffects, HealthRepairMode } from '@makinbakin/sdk/types'

export type { HealthRepairEffects, HealthRepairMode }

export function repairMode(effects: HealthRepairEffects): HealthRepairMode {
  return effects.deletesUserContent || effects.spendsMoney || effects.widensAuthorization ? 'one-click' : 'self-heal'
}
