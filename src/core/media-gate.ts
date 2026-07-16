/**
 * Per-call gate for billed media (image generate/edit): consult the kill
 * switch and the SAME budget gate dispatch uses — provider/lane resolve from
 * the image model, breaches open the shared incident + audit — BEFORE any
 * provider call or idempotency row exists. Closes the within-turn leak where
 * one turn loops billed generations past the cap (spec G7/V6). warn does not
 * block (mid-task flapping); defer and the kill switch do. Unexpected gate
 * failure refuses (fail-closed — consistent with billing posture).
 *
 * Lives in its own module (not agent-cost) so the import graph stays
 * acyclic: dispatch-turns → agent-cost (metering) is one direction; this
 * gate consumes dispatch-turns from the outside. Deps stay dynamic to keep
 * the dispatch graph out of the images plugin's static imports.
 */
import { createLogger } from './logger'

const log = createLogger('media-gate')

/** Typed refusal a billed media tool relays to the agent (cost-control v2). */
export interface MediaGateRefusal {
  code: 'budget_exceeded' | 'budget_evidence_incomplete' | 'dispatch_paused'
  scope?: string
  scopeId?: string
  lane?: 'metered' | 'subscription'
  window?: 'daily' | 'monthly'
  unit?: 'usd_micros' | 'tokens'
  capValue?: number
  spentValue?: number
  /** Human-readable reason the agent can surface honestly. */
  message: string
}

export type MediaGateResult = { allowed: true } | { allowed: false; refusal: MediaGateRefusal }

export async function gateBilledMediaCall(opts: { agent: string; model: string }): Promise<MediaGateResult> {
  try {
    const [{ dispatchPaused, budgetGate }, { getContentDir }] = await Promise.all([
      import('./dispatch-turns'),
      import('./content-dir'),
    ])
    const contentDir = getContentDir()
    if (dispatchPaused(contentDir)) {
      return {
        allowed: false,
        refusal: { code: 'dispatch_paused', message: 'Dispatch is paused (kill switch) — billed media calls are blocked until it is resumed in Settings.' },
      }
    }
    const decision = await budgetGate(opts.agent, contentDir, undefined, { model: opts.model, billedMedia: true })
    if (decision.action !== 'defer') return { allowed: true }
    if (decision.cause === 'spend_evidence_incomplete' || decision.cause === 'spend_evidence_unavailable') {
      const unavailable = decision.cause === 'spend_evidence_unavailable'
      return {
        allowed: false,
        refusal: {
          code: 'budget_evidence_incomplete',
          scope: decision.rule.scope,
          ...(decision.rule.scopeId ? { scopeId: decision.rule.scopeId } : {}),
          lane: decision.rule.lane,
          window: decision.window,
          unit: decision.unit,
          capValue: decision.capValue,
          spentValue: decision.spentValue,
          message: unavailable
            ? 'Budget spend evidence is unavailable — billed media is blocked until spend evidence can be read.'
            : 'Budget spend evidence is incomplete — billed media is blocked until spend can be verified.',
        },
      }
    }
    if (decision.cause === 'open_pause_incident') {
      return {
        allowed: false,
        refusal: {
          code: 'dispatch_paused',
          scope: decision.rule.scope,
          ...(decision.rule.scopeId ? { scopeId: decision.rule.scopeId } : {}),
          lane: decision.rule.lane,
          window: decision.window,
          unit: decision.unit,
          capValue: decision.capValue,
          spentValue: decision.spentValue,
          message: 'A pause-mode budget incident is blocking dispatch and billed media until an operator resolves it.',
        },
      }
    }
    const fmt = (v: number) => (decision.unit === 'usd_micros' ? `$${(v / 1_000_000).toFixed(2)}` : `${v.toLocaleString()} tokens`)
    const scopeLabel = decision.rule.scopeId ? `${decision.rule.scope} '${decision.rule.scopeId}'` : decision.rule.scope
    return {
      allowed: false,
      refusal: {
        code: 'budget_exceeded',
        scope: decision.rule.scope,
        ...(decision.rule.scopeId ? { scopeId: decision.rule.scopeId } : {}),
        lane: decision.rule.lane,
        window: decision.window,
        unit: decision.unit,
        capValue: decision.capValue,
        spentValue: decision.spentValue,
        message: `Budget exceeded: ${scopeLabel} ${decision.window} ${decision.rule.lane} spend ${fmt(decision.spentValue)} is at/over the ${fmt(decision.capValue)} cap — billed media is blocked until the window resets or the cap is raised.`,
      },
    }
  } catch (err) {
    log.error('Billed-media gate failed; refusing (fail-closed)', err, { agent: opts.agent, model: opts.model })
    return {
      allowed: false,
      refusal: { code: 'budget_evidence_incomplete', message: 'Budget gate unavailable — billed media is blocked (fail-closed).' },
    }
  }
}
