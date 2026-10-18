/**
 * CLI identity on the wire (#898 D-H4/D-H5) — the headers every request
 * from this CLI carries, set once per invocation in the shared HTTP
 * plumbing so no command can forget them:
 *   - `X-Bakin-Agent-Context: <agent>` whenever the CLI runs in a detected
 *     agent context — it overrides any declaration;
 *   - otherwise `X-Bakin-Operator: declared` only with `--as human` (an
 *     approval decision or non-safe repair confirmation needs it).
 *
 * Kept free of `./http` imports (http imports this and supplies the probe).
 */
import { dirname, resolve } from 'path'
import {
  AGENT_CONTEXT_ENV,
  APPROVAL_AGENT_CONTEXT_HEADER,
  APPROVAL_OPERATOR_DECLARED,
  APPROVAL_OPERATOR_HEADER,
} from '../../packages/core/src/approvals/provenance'

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

export interface CliIdentity {
  /** The agent whose context this CLI runs in, if detected. */
  agentContext: string | null
  /** `--as human` was given. */
  operatorDeclared: boolean
}

/** Walk up from `start` to the nearest run-dir sidecar (lazy import keeps the binary entry light). */
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

/**
 * Who is running this CLI (#898 D-H5), detected BEFORE `--as` is honored:
 * the env marker an agent's shell carries, a run-dir sidecar above cwd,
 * and — only when `--as human` would otherwise declare the operator — the
 * server's view of whether cwd sits in an agent's workspace.
 */
export async function resolveCliIdentity(opts: {
  argv: string[]
  cwd: string
  env: Record<string, string | undefined>
  probeWorkspace: (cwd: string) => Promise<string | null>
}): Promise<CliIdentity> {
  const operatorDeclared = stripActorFlag(opts.argv).as === 'human'
  const marker = opts.env[AGENT_CONTEXT_ENV]
  if (marker !== undefined) return { agentContext: marker.trim() || marker, operatorDeclared }
  const fromRunDir = await agentFromRunDir(opts.cwd)
  if (fromRunDir) return { agentContext: fromRunDir, operatorDeclared }
  if (operatorDeclared) {
    const fromWorkspace = await opts.probeWorkspace(opts.cwd).catch(() => null)
    if (fromWorkspace) return { agentContext: fromWorkspace, operatorDeclared }
  }
  return { agentContext: null, operatorDeclared }
}

/** The headers an identity puts on every request: an agent context overrides the declaration. */
export function identityHeaders(identity: CliIdentity): Record<string, string> {
  if (identity.agentContext !== null) return { [APPROVAL_AGENT_CONTEXT_HEADER]: identity.agentContext }
  return identity.operatorDeclared ? { [APPROVAL_OPERATOR_HEADER]: APPROVAL_OPERATOR_DECLARED } : {}
}
