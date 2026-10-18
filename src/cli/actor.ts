/**
 * CLI actor identity (spec D12) — ONE resolver for every command that
 * attributes an action (`tasks create/move/log/block/depend/complete`,
 * `workflows submit`).
 *
 * Resolution order:
 *   1. `--as <agent|human>` (also `--as=<value>`), stripped before positional
 *      parsing so it may sit anywhere on the line. `human` is the operator:
 *      the request carries `agent: 'human'` + `channel: 'human'`, exactly what
 *      the board UI sends, so `bakin tasks move <id> todo --as human` is an
 *      operator move (resets the recovery budget, spec D4).
 *   2. The detected agent context (`./identity`): the env marker an agent's
 *      shell carries, or the `.bakin-run.json` sidecar found walking up
 *      from cwd — a `bakin` call from an agent's shell attributes to that
 *      agent with no flag, and `--as human` there is NOT honored (#898).
 *   3. The roster's main agent — today's default, so existing scripts keep
 *      their behavior.
 *
 * Only `apiGet` and a lazy import of the sidecar reader are pulled in; the
 * binary entry's import graph stays light.
 */
import { apiGet, cliIdentity } from './http'

export interface CliActor {
  agent: string
  /** Present only for the operator (`--as human`). */
  channel?: 'human'
}

export { ACTOR_FLAG_USAGE, stripActorFlag } from './identity'

/** One CLI invocation runs one command — no memo, one roster read at most. */
async function rosterMainAgent(): Promise<string> {
  const roster = await apiGet('/api/plugins/team/') as { agents?: Array<{ id?: unknown }>; mainAgentId?: string | null }
  const ids = (roster.agents ?? []).map((a) => a.id).filter((id): id is string => typeof id === 'string' && id.length > 0)
  return roster.mainAgentId ?? ids[0] ?? 'main'
}

export async function resolveCliActor(as: string | undefined): Promise<CliActor> {
  // The agent context is detected BEFORE `--as` is honored (#898): an agent
  // shell cannot claim the operator with `--as human`.
  const { agentContext, operatorDeclared, declarationWithheld } = await cliIdentity()
  if (as === 'human') {
    if (agentContext !== null) {
      console.error(`Running in agent "${agentContext}"'s context — --as human is not honored here; acting as ${agentContext}.`)
      return { agent: agentContext }
    }
    // Unconfirmed is not the operator: an operator action fails rather than
    // acting under an identity nobody could check (#898).
    if (!operatorDeclared) throw new Error(`--as human could not be confirmed${declarationWithheld ? `: ${declarationWithheld}` : ''}`)
    return { agent: 'human', channel: 'human' }
  }
  if (as) return { agent: as }
  if (agentContext !== null) return { agent: agentContext }
  return { agent: await rosterMainAgent() }
}
