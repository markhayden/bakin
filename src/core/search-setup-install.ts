/**
 * Search setup installs (the engine, the models) for callers that are not
 * inside an operation yet (onboarding until PR6 of #895): runs the adapter's
 * install as a local operation that declares `search-engine`, so it is
 * serialized with resets, reindexes and the background migration passes,
 * shows in the operations tray, and reports its stages. Always resolves with
 * the install result — a cancelled or crashed operation becomes a failed one.
 */
import { createHash } from 'crypto'
import type { SearchAdapterSetupComponent, SearchAdapterSetupInstallResult, SearchAdapterSetupOptions } from '@bakin/core/adapters/search'
import { noteSearchEngineProgress } from '@bakin/core/search/progress'
import { runLocal } from './operations'

export interface SearchSetupInstallMeta {
  kind: 'install:search' | 'install:search-models'
  title: string
  /** The outcome code for an install that reports `status: 'failed'`. */
  failureCode: string
}

/** The component built from the settings in force right now, and those settings. */
export interface ResolvedSearchSetupComponent {
  component: SearchAdapterSetupComponent
  settings: unknown
}

/** Settled when the settings moved while the install waited; the caller starts again under the new identity. */
const SETTINGS_CHANGED = 'settings_changed'
const MAX_SETTINGS_RETRIES = 3

function settingsKeyOf(settings: unknown): string {
  return createHash('sha256').update(JSON.stringify(settings ?? null)).digest('hex').slice(0, 16)
}

export async function installSearchComponentLocally(
  resolve: () => ResolvedSearchSetupComponent,
  opts: Omit<SearchAdapterSetupOptions, 'op'>,
  meta: SearchSetupInstallMeta,
  attempt = 1,
): Promise<SearchAdapterSetupInstallResult> {
  const started = Date.now()
  const requested = resolve()
  const settingsKey = settingsKeyOf(requested.settings)
  const view = await runLocal<SearchAdapterSetupInstallResult>({
    kind: meta.kind,
    owner: 'core',
    origin: 'system',
    title: meta.title,
    href: '/health',
    // Options and settings are part of identity: an unapproved run must never
    // answer for an approved one, nor an install for other models or another endpoint.
    fingerprint: `${meta.kind}:${opts.autoApprove ? 'approved' : 'ask'}:${opts.allowServiceClaim ? 'claim' : 'setup'}:${settingsKey}`,
    resources: ['search-engine'],
    plan: requested.component.plan,
    run: async (op) => {
      // Settings may have changed while this waited for search-engine. Running
      // anyway would install under an identity that no longer describes it, so
      // a request for the old settings could attach and take this result.
      const current = resolve()
      if (settingsKeyOf(current.settings) !== settingsKey) {
        const message = 'Search settings changed while the install waited; starting again with the current settings.'
        return { status: 'failed', code: SETTINGS_CHANGED, message, httpStatus: 200, body: { name: current.component.name, status: 'failed', message, durationMs: Date.now() - started } }
      }
      const result = await current.component.install({ ...opts, op })
      // A freshly (re)started engine is progress for the wedge watchdog.
      if (result.status === 'installed' || result.status === 'noop') noteSearchEngineProgress()
      return result.status === 'failed'
        ? { status: 'failed', code: meta.failureCode, message: result.message, httpStatus: 200, body: result }
        : { status: 'succeeded', code: result.status === 'skipped' ? 'skipped' : 'ok', httpStatus: 200, body: result }
    },
  })
  if (view.outcome?.code === SETTINGS_CHANGED && attempt < MAX_SETTINGS_RETRIES) {
    return installSearchComponentLocally(resolve, opts, meta, attempt + 1)
  }
  // A thrown install settles `unexpected` with an `{ error }` body — not an install result.
  if (view.result && view.outcome?.code !== 'unexpected') return view.result.body
  return {
    name: requested.component.name,
    status: 'failed',
    message: view.outcome?.message ?? `${meta.title} ${view.status}`,
    durationMs: Date.now() - started,
  }
}
