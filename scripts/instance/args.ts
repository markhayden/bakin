/**
 * Argument parsing for the disposable OpenClaw dev/onboarding rig.
 *
 * Pure: takes argv (without the `node script` prefix) and returns a validated
 * options object, or throws with an actionable message. No I/O, no side
 * effects — so it is exhaustively unit-testable.
 */

export const VERBS = ['up', 'dev', 'reset', 'down', 'shell', 'status', 'env', 'run'] as const
export type Verb = (typeof VERBS)[number]

export const MODES = ['native', 'isolated', 'sandbox'] as const
export type Mode = (typeof MODES)[number]

export const SOURCES = ['repo', 'installed'] as const
export type Source = (typeof SOURCES)[number]

export interface InstanceArgs {
  verb: Verb
  mode: Mode
  /** Wipe instance state before bringing it up. */
  fresh: boolean
  /** Where Bakin comes from in isolated/sandbox modes. */
  source: Source
  /** Sandbox only: auto-run `bakin onboard --yes` instead of leaving it manual. */
  preconfigure: boolean
  /** Passthrough args after `--` (used by the `run` verb). */
  rest: string[]
}

function isVerb(value: string): value is Verb {
  return (VERBS as readonly string[]).includes(value)
}

export function parseInstanceArgs(argv: string[]): InstanceArgs {
  const verb = argv[0]
  if (!verb) {
    throw new Error(`Missing verb. Expected one of: ${VERBS.join(', ')}`)
  }
  if (!isVerb(verb)) {
    throw new Error(`Unknown verb "${verb}". Expected one of: ${VERBS.join(', ')}`)
  }

  let mode: Mode = 'native'
  let fresh = false
  let source: Source = 'repo'
  let preconfigure = false
  let sourceProvided = false
  const rest: string[] = []

  for (let i = 1; i < argv.length; i++) {
    const token = argv[i]
    if (token === '--') {
      rest.push(...argv.slice(i + 1))
      break
    }
    switch (token) {
      case '--mode': {
        const value = argv[++i]
        if (!value || !(MODES as readonly string[]).includes(value)) {
          throw new Error(`Invalid --mode "${value ?? ''}". Expected one of: ${MODES.join(', ')}`)
        }
        mode = value as Mode
        break
      }
      case '--source': {
        const value = argv[++i]
        if (!value || !(SOURCES as readonly string[]).includes(value)) {
          throw new Error(`Invalid --source "${value ?? ''}". Expected one of: ${SOURCES.join(', ')}`)
        }
        source = value as Source
        sourceProvided = true
        break
      }
      case '--fresh':
        fresh = true
        break
      case '--preconfigure':
        preconfigure = true
        break
      default:
        throw new Error(`Unknown flag "${token}"`)
    }
  }

  // Cross-flag validation.
  if (sourceProvided && mode === 'native') {
    throw new Error('--source is only valid with --mode isolated or sandbox (native always runs this repo)')
  }
  if (preconfigure && mode !== 'sandbox') {
    throw new Error('--preconfigure is only valid with --mode sandbox')
  }
  if (verb === 'run' && rest.length === 0) {
    throw new Error('run requires passthrough args, e.g. `instance run -- doctor --json`')
  }

  return { verb, mode, fresh, source, preconfigure, rest }
}
