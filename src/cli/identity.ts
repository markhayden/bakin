/**
 * CLI identity on the wire (#898 D-H4/D-H5) — the headers every request
 * from this CLI carries, set once per invocation in the shared HTTP
 * plumbing so no command can forget them:
 *   - `X-Bakin-Operator: declared` only with `--as human` (an approval
 *     decision or non-safe repair confirmation from the CLI needs it).
 *
 * Kept free of `./http` imports (http imports this).
 */
import { APPROVAL_OPERATOR_DECLARED, APPROVAL_OPERATOR_HEADER } from '../../packages/core/src/approvals/provenance'

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

let memo: Record<string, string> | null = null

/** The identity headers for this invocation, from `process.argv`. */
export function cliIdentityHeaders(argv: string[] = process.argv.slice(2)): Record<string, string> {
  if (memo) return memo
  const { as } = stripActorFlag(argv)
  memo = as === 'human' ? { [APPROVAL_OPERATOR_HEADER]: APPROVAL_OPERATOR_DECLARED } : {}
  return memo
}

/** Test seam: forget the memoized identity. */
export function resetCliIdentityForTests(): void {
  memo = null
}
