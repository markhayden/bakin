/**
 * The names of every onboarding component, in run order, and of the ones
 * that have an install. A leaf with no imports: the CLI's argument checks,
 * its help text and the install request schema all derive from these, so
 * `bakin check <x>` and `bakin install <x>` cannot drift from what
 * onboarding actually runs. A test pins both lists to `COMPONENT_ORDER`.
 */
export const COMPONENT_NAMES = [
  'mkdir',
  'settings',
  'runtime',
  'llm',
  'search',
  'search-models',
  'media',
  'openclaw-integration',
  'plugin-assets',
  'agent-sync',
  'models',
  'budget',
  'channels',
  'recommended-plugins',
  'recommended-agents',
  'capabilities',
] as const

export type ComponentName = (typeof COMPONENT_NAMES)[number]

/** Check-only: set up outside Bakin or opt-in, so there is nothing to install. */
const CHECK_ONLY: readonly ComponentName[] = ['llm', 'budget', 'channels']

/** Components whose install changes something. */
export const INSTALLABLE_COMPONENT_NAMES = COMPONENT_NAMES.filter((name) => !CHECK_ONLY.includes(name)) as Exclude<ComponentName, 'llm' | 'budget' | 'channels'>[]

export function isComponentName(value: string | undefined): value is ComponentName {
  return value !== undefined && (COMPONENT_NAMES as readonly string[]).includes(value)
}

export function isInstallableComponentName(value: string | undefined): value is (typeof INSTALLABLE_COMPONENT_NAMES)[number] {
  return value !== undefined && (INSTALLABLE_COMPONENT_NAMES as readonly string[]).includes(value)
}
