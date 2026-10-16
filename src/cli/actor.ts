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
 *   2. The `.bakin-run.json` sidecar found walking up from cwd: an agent's
 *      dispatch shell runs inside `~/.bakin/run-workspaces/<agent>/<run>/`
 *      (a bound-repo worktree one level below), so a `bakin` call from there
 *      attributes to that agent with no flag. Identity rides the sidecar
 *      because the Pi SDK has no per-session env to carry it.
 *   3. The roster's main agent — today's default, so existing scripts keep
 *      their behavior.
 *
 * Only `apiGet` and a lazy import of the sidecar reader are pulled in; the
 * binary entry's import graph stays light.
 */
import { dirname, resolve } from 'path'

import { apiGet } from './http'

export interface CliActor {
  agent: string
  /** Present only for the operator (`--as human`). */
  channel?: 'human'
}

export const ACTOR_FLAG_USAGE = '--as needs a value: --as=<agent> to act as that agent, or --as=human for an operator action'

/**
 * Remove `--as <value>` / `--as=<value>` wherever it sits; positionals keep
 * their order. A flag with no value, an empty value, or an option-shaped
 * value (`--as --json`) is `invalid` — the command must refuse it rather
 * than silently act under a different identity.
 */
export function stripActorFlag(args: string[]): { as: string | undefined; rest: string[]; invalid?: string } {
  const rest: string[] = []
  let as: string | undefined
  let invalid: string | undefined
  const take = (value: string | undefined): void => {
    if (!value || value.startsWith('-')) invalid = ACTOR_FLAG_USAGE
    else as = value
  }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--as') {
      take(args[i + 1])
      if (args[i + 1] !== undefined && !args[i + 1].startsWith('-')) i++
      continue
    }
    if (arg.startsWith('--as=')) {
      take(arg.slice('--as='.length))
      continue
    }
    rest.push(arg)
  }
  return { as, rest, ...(invalid ? { invalid } : {}) }
}

/** One CLI invocation runs one command — no memo, one roster read at most. */
async function rosterMainAgent(): Promise<string> {
  const roster = await apiGet('/api/plugins/team/') as { agents?: Array<{ id?: unknown }>; mainAgentId?: string | null }
  const ids = (roster.agents ?? []).map((a) => a.id).filter((id): id is string => typeof id === 'string' && id.length > 0)
  return roster.mainAgentId ?? ids[0] ?? 'main'
}

async function agentFromRunDir(start: string): Promise<string | null> {
  const { readRunSidecar } = await import('../core/run-workspace')
  let dir = resolve(start)
  for (;;) {
    const sidecar = readRunSidecar(dir)
    if (sidecar) return sidecar.agentId
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

export async function resolveCliActor(as: string | undefined): Promise<CliActor> {
  if (as === 'human') return { agent: 'human', channel: 'human' }
  if (as) return { agent: as }
  const fromRun = await agentFromRunDir(process.cwd())
  if (fromRun) return { agent: fromRun }
  return { agent: await rosterMainAgent() }
}
