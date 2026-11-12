/**
 * `bakin onboard`'s first step: which runtime does this home use?
 *
 * Gathers the four facts (the `--runtime` flag, the environment override,
 * what this home's settings store, what is set up on the machine), runs the
 * pure decision table, and puts the question to the operator when the
 * table says to ask. It reads; it writes nothing. A choice that is to be
 * kept is committed later, by the settings step.
 */
/** `--runtime pi` or `--runtime=pi`; undefined when the flag is absent. A flag with no value is an empty name. */
export function readRuntimeFlag(args: string[]): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg === '--runtime') return args[i + 1] !== undefined && !args[i + 1]!.startsWith('--') ? args[i + 1] : ''
    if (arg.startsWith('--runtime=')) return arg.slice('--runtime='.length)
  }
  return undefined
}

export type ChosenRuntime =
  | { kind: 'use'; adapter: import('../core/settings').RuntimeAdapterName; source: import('../core/onboarding/summary').RuntimeSource; persist: boolean; found: import('../core/settings').RuntimeAdapterName[] }
  | { kind: 'refused'; code: string; message: string; found: import('../core/settings').RuntimeAdapterName[] }
  /** No decision: the settings file cannot be trusted, so nothing is chosen on top of it and the settings step reports it. */
  | { kind: 'none'; found: import('../core/settings').RuntimeAdapterName[] }
  | { kind: 'cancelled'; found: import('../core/settings').RuntimeAdapterName[] }

/**
 * Gather the four facts, run the decision table, and put the question to
 * the operator when the table says to ask. Reads only; writes nothing.
 */
export async function chooseRuntime(input: {
  flag: string | undefined
  interactive: boolean
  promptRuntimeChoice: typeof import('../core/cli/onboarding-interactive').promptRuntimeChoice
}): Promise<ChosenRuntime> {
  const { decideRuntime } = await import('../core/onboarding/runtime-choice')
  const { inspectSettingsFile } = await import('../core/onboarding/settings')
  const { detectRuntimes, getRuntimeAdapterSupport, getSupportedRuntimeAdapterNames } = await import('../core/runtime-adapter-factory')
  const found = detectRuntimes()
  const file = inspectSettingsFile()
  if (file.kind === 'untrustworthy' && input.flag === undefined && !process.env.BAKIN_RUNTIME_ADAPTER) return { kind: 'none', found }
  const decision = decideRuntime({
    flag: input.flag,
    env: process.env.BAKIN_RUNTIME_ADAPTER || undefined,
    stored: file.kind === 'readable' ? file.storedAdapter : undefined,
    found,
    canAsk: input.interactive,
    supported: getSupportedRuntimeAdapterNames(),
  })
  if (decision.kind === 'refuse') return { kind: 'refused', code: decision.code, message: decision.message, found }
  if (decision.kind === 'use') {
    // Nothing is chosen ON TOP of a settings file nobody can trust; an
    // explicit flag or environment value still names the runtime for the
    // run, and the settings step reports the file.
    return { kind: 'use', adapter: decision.adapter, source: decision.source, persist: decision.persist && file.kind !== 'untrustworthy', found }
  }
  const { OnboardingCancelledError } = await import('../core/cli/onboarding-interactive')
  try {
    const picked = await input.promptRuntimeChoice(
      decision.choices.map((choice) => ({ adapter: choice.adapter, found: choice.found, label: getRuntimeAdapterSupport(choice.adapter).label, summary: getRuntimeAdapterSupport(choice.adapter).summary })),
      decision.preselected,
    )
    const adapter = getSupportedRuntimeAdapterNames().find((name) => name === picked)
    if (!adapter) return { kind: 'refused', code: 'invalid_runtime', message: `${picked} is not a runtime Bakin supports.`, found }
    return { kind: 'use', adapter, source: 'asked', persist: true, found }
  } catch (err) {
    if (err instanceof OnboardingCancelledError) return { kind: 'cancelled', found }
    throw err
  }
}
