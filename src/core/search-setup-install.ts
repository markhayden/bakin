/**
 * Search setup installs (the engine, the models) for callers that are not
 * inside an operation yet (onboarding until PR6 of #895): runs the adapter's
 * install as a local operation that declares `search-engine`, so it is
 * serialized with resets, reindexes and the background migration passes,
 * shows in the operations tray, and reports its stages. Always resolves with
 * the install result — a cancelled or crashed operation becomes a failed one.
 */
import type { SearchAdapterSetupComponent, SearchAdapterSetupInstallResult, SearchAdapterSetupOptions } from '@bakin/core/adapters/search'
import { noteSearchEngineProgress } from '@bakin/core/search/progress'
import { runLocal } from './operations'

export interface SearchSetupInstallMeta {
  kind: 'install:search' | 'install:search-models'
  title: string
  /** The outcome code for an install that reports `status: 'failed'`. */
  failureCode: string
}

export async function installSearchComponentLocally(
  component: SearchAdapterSetupComponent,
  opts: Omit<SearchAdapterSetupOptions, 'op'>,
  meta: SearchSetupInstallMeta,
): Promise<SearchAdapterSetupInstallResult> {
  const started = Date.now()
  const view = await runLocal<SearchAdapterSetupInstallResult>({
    kind: meta.kind,
    owner: 'core',
    origin: 'system',
    title: meta.title,
    href: '/health',
    // Options are part of identity: an unapproved run must never answer for an approved one.
    fingerprint: `${meta.kind}:${opts.autoApprove ? 'approved' : 'ask'}:${opts.allowServiceClaim ? 'claim' : 'setup'}`,
    resources: ['search-engine'],
    plan: component.plan,
    run: async (op) => {
      const result = await component.install({ ...opts, op })
      // A freshly (re)started engine is progress for the wedge watchdog.
      if (result.status === 'installed' || result.status === 'noop') noteSearchEngineProgress()
      return result.status === 'failed'
        ? { status: 'failed', code: meta.failureCode, message: result.message, httpStatus: 200, body: result }
        : { status: 'succeeded', code: result.status === 'skipped' ? 'skipped' : 'ok', httpStatus: 200, body: result }
    },
  })
  // A thrown install settles `unexpected` with an `{ error }` body — not an install result.
  if (view.result && view.outcome?.code !== 'unexpected') return view.result.body
  return {
    name: component.name,
    status: 'failed',
    message: view.outcome?.message ?? `${meta.title} ${view.status}`,
    durationMs: Date.now() - started,
  }
}
