/**
 * One onboarding component install as an operation (#895 D11/D22) — the ONE
 * builder behind `POST /api/runtime/onboarding/install` and the CLI's
 * in-process mode, so a server run and a local run are the same operation.
 *
 * Identity is the component, the explicit options and the component's own
 * identity inputs (search: its settings); an identical live request attaches.
 * A request that waited rechecks those inputs before running — if they moved,
 * it settles `settings_changed` instead of running under an identity that no
 * longer describes it.
 */
import { createHash } from 'crypto'
import type { OperationOrigin, OperationOutcome, StartOperationInput } from '@bakin/core/operations'
import type { InstallableComponent, InstallResult } from './types'
import type { OnboardingInstallOptions } from './install-request'

/** The result body: today's `{ ok, result }` shape. */
export interface ComponentInstallBody {
  ok: boolean
  result: InstallResult
}

const TITLES: Record<string, string> = {
  mkdir: 'Create the Bakin home',
  settings: 'Write settings.json',
  search: 'Install the search engine',
  'search-models': 'Download the search models',
  media: 'Install the media store',
  'openclaw-integration': 'Sync the OpenClaw integration',
  'plugin-assets': 'Install plugin assets',
  'agent-sync': 'Sync agents',
  models: 'Apply the recommended model plan',
  'recommended-plugins': 'Install recommended plugins',
  'recommended-agents': 'Install official agents',
  capabilities: 'Install capability packs',
}

function key(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex').slice(0, 16)
}

/** JSON-safe: an `error` field may hold an Error, which serializes to `{}`. */
function publicResult(result: InstallResult): InstallResult {
  const { error: _error, ...rest } = result
  return rest
}

export function componentInstallOperation(
  component: InstallableComponent,
  options: OnboardingInstallOptions,
  origin: OperationOrigin,
): StartOperationInput<ComponentInstallBody> {
  const identity = () => key(component.identity?.())
  const requested = identity()
  return {
    kind: `onboarding:${component.name}`,
    owner: 'core',
    origin,
    title: TITLES[component.name] ?? `Set up ${component.name}`,
    href: '/runtime',
    fingerprint: `onboarding:${component.name}:${key(options)}:${requested}`,
    resources: [...component.resources],
    plan: component.plan,
    revalidate: async (): Promise<OperationOutcome<ComponentInstallBody> | void> => {
      if (identity() === requested) return
      const message = 'Its settings changed while it waited — run it again to use the current settings.'
      const result: InstallResult = { name: component.name, status: 'failed', message, durationMs: 0 }
      return { status: 'failed', code: 'settings_changed', message, httpStatus: 200, body: { ok: false, result } }
    },
    run: async (op): Promise<OperationOutcome<ComponentInstallBody>> => {
      const result = publicResult(await component.install(options, op))
      if (result.status === 'failed') {
        return { status: 'failed', code: component.failureCode ?? 'component_failed', message: result.message, httpStatus: 200, body: { ok: false, result } }
      }
      return { status: 'succeeded', code: result.status === 'skipped' ? 'skipped' : 'ok', httpStatus: 200, body: { ok: true, result } }
    },
  }
}
