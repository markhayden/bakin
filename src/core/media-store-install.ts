/**
 * The media store install for callers that are not inside an operation yet
 * (onboarding until PR6; the Health apply until the repair switch): runs
 * `installMediaStore` as a local operation that declares `media-store`, so it
 * is serialized with every other media install, shows in the operations tray,
 * and reports its stages. Throws with the operation's failure message.
 */
import type { OperationOrigin } from '@bakin/core/operations'
import { installMediaStore, MEDIA_PLAN, type MediaInstallResult } from '../../packages/core/src/media/installer'
import { runLocal } from './operations'

export async function installMediaStoreLocally(opts: { force?: boolean; origin?: OperationOrigin } = {}): Promise<MediaInstallResult> {
  const view = await runLocal<MediaInstallResult>({
    kind: 'install:media',
    owner: 'core',
    origin: opts.origin ?? 'system',
    title: 'Install the media store',
    href: '/health',
    fingerprint: `install:media:${opts.force ? 'force' : 'auto'}`,
    resources: ['media-store'],
    plan: MEDIA_PLAN,
    run: async (op) => ({ status: 'succeeded', code: 'ok', httpStatus: 200, body: await installMediaStore(op, { force: opts.force }) }),
  })
  if (view.status !== 'succeeded' || !view.result) {
    throw new Error(view.outcome?.message ?? `media store install ${view.status}`)
  }
  return view.result.body
}
