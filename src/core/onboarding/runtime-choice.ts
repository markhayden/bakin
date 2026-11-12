/**
 * Which runtime does this home use? One pure decision, made once at the
 * start of `bakin onboard`, from four facts: the `--runtime` flag, the
 * `BAKIN_RUNTIME_ADAPTER` environment override, the adapter already stored
 * in this home's settings, and the runtimes found on the machine.
 *
 * It never performs I/O and never picks on the operator's behalf: when a
 * person should choose it answers `ask`, and when a script gave it
 * something it cannot honour it refuses with a typed code. A refusal
 * happens before anything is written.
 *
 * The decision is a PROPOSAL. A decision with `persist: true` is committed
 * by the `settings` component's install, under `install-state`, which
 * re-reads what is stored at that moment — so two runs deciding at once
 * cannot both win.
 */
import type { RuntimeAdapterName } from '../settings'

/** Where the chosen runtime came from. `asked` is set by the caller that showed the question. */
export type RuntimeDecisionSource = 'env' | 'existing' | 'flag' | 'default' | 'detected' | 'asked'

export type RuntimeRefusalCode =
  /** `--runtime` or `BAKIN_RUNTIME_ADAPTER` names something that is not a supported runtime. */
  | 'invalid_runtime'
  /** `--runtime` and `BAKIN_RUNTIME_ADAPTER` name different runtimes. */
  | 'runtime_conflict'
  /** This home already stores a runtime and `--runtime` names another. */
  | 'runtime_already_set'
  /** More than one runtime was found and nobody is there to choose. */
  | 'ambiguous_runtime'

export interface RuntimeDecisionInput {
  /** The value of `--runtime`, exactly as typed, or undefined when absent. */
  flag?: string
  /** The value of `BAKIN_RUNTIME_ADAPTER`, or undefined when unset or empty. */
  env?: string
  /** The supported adapter stored in this home's settings, if any. */
  stored?: RuntimeAdapterName
  /** Runtimes found on this machine, in the factory's fixed order. */
  found: readonly RuntimeAdapterName[]
  /** A person is at a terminal and no flag asked for a scripted run. */
  interactive: boolean
  /** Every runtime Bakin supports, in the factory's order. */
  supported: readonly RuntimeAdapterName[]
}

export type RuntimeDecision =
  | {
    kind: 'use'
    adapter: RuntimeAdapterName
    source: Exclude<RuntimeDecisionSource, 'asked'>
    /** Whether this choice is written to the home's settings. */
    persist: boolean
  }
  | {
    kind: 'ask'
    /** Every supported runtime, each marked with whether it was found here. */
    choices: Array<{ adapter: RuntimeAdapterName; found: boolean }>
    /** The first runtime found: what Enter picks. */
    preselected: RuntimeAdapterName
  }
  | {
    kind: 'refuse'
    code: RuntimeRefusalCode
    message: string
    found: RuntimeAdapterName[]
  }

/** What Bakin uses when nothing is found and nobody said otherwise: it ships in-process. */
export const DEFAULT_RUNTIME_WHEN_NONE_FOUND: RuntimeAdapterName = 'pi'

export function decideRuntime(input: RuntimeDecisionInput): RuntimeDecision {
  const supported = input.supported
  const isSupported = (value: string): value is RuntimeAdapterName => (supported as readonly string[]).includes(value)
  const found = [...input.found]
  const refuse = (code: RuntimeRefusalCode, message: string): RuntimeDecision => ({ kind: 'refuse', code, message, found })
  const list = supported.join(', ')

  // 1. A name nobody supports, from either source. The environment
  //    override is checked here too: silently ignoring a typo would run
  //    onboarding on a different runtime than the one that was asked for.
  if (input.flag !== undefined && !isSupported(input.flag)) {
    return refuse('invalid_runtime', `--runtime ${input.flag} is not a runtime Bakin supports (${list}).`)
  }
  if (input.env !== undefined && !isSupported(input.env)) {
    return refuse('invalid_runtime', `BAKIN_RUNTIME_ADAPTER=${input.env} is not a runtime Bakin supports (${list}).`)
  }
  const flag = input.flag as RuntimeAdapterName | undefined
  const env = input.env as RuntimeAdapterName | undefined

  // 2-3. The environment override is process-scoped and wins over what is
  //      stored; it is never written down.
  if (env !== undefined) {
    if (flag !== undefined && flag !== env) {
      return refuse('runtime_conflict', `--runtime ${flag} and BAKIN_RUNTIME_ADAPTER=${env} name different runtimes. Unset one of them.`)
    }
    return { kind: 'use', adapter: env, source: 'env', persist: false }
  }

  // 4-5. This home already decided. Onboarding is first-time setup, never
  //      a switch.
  if (input.stored !== undefined) {
    if (flag !== undefined && flag !== input.stored) {
      return refuse('runtime_already_set', `This home already uses ${input.stored}. To change runtimes run \`bakin runtime use ${flag}\`; onboarding never switches one.`)
    }
    return { kind: 'use', adapter: input.stored, source: 'existing', persist: false }
  }

  // 6. An explicit choice for an undecided home.
  if (flag !== undefined) return { kind: 'use', adapter: flag, source: 'flag', persist: true }

  // 7. Nothing here to choose between.
  if (found.length === 0) return { kind: 'use', adapter: DEFAULT_RUNTIME_WHEN_NONE_FOUND, source: 'default', persist: true }

  // 8. A person is here: let them choose, with what was found marked.
  if (input.interactive) {
    return {
      kind: 'ask',
      choices: supported.map((adapter) => ({ adapter, found: found.includes(adapter) })),
      preselected: found[0]!,
    }
  }

  // 9. A script, and exactly one answer.
  if (found.length === 1) return { kind: 'use', adapter: found[0]!, source: 'detected', persist: true }

  // 10. A script, and more than one answer: guessing would be wrong half the time.
  return refuse('ambiguous_runtime', `More than one runtime is set up here (${found.join(', ')}). Say which one with --runtime <${supported.join('|')}>.`)
}
