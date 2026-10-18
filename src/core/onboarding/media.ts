/**
 * Onboarding component `media` (#889): working image processing for
 * compiled-binary installs.
 *
 * Dev trees / npm installs already have sharp in node_modules — check() is
 * ok and install() a noop there. Compiled binaries need the media store
 * (`~/.bakin/media/`, pinned sharp prebuilds; see
 * packages/core/src/media/installer.ts), or big-image enrichment, asset
 * exports, and thumbnails degrade.
 */
import { checkMediaStore, installMediaStore } from '../../../packages/core/src/media/installer'
import { MEDIA_PLAN } from '../../../packages/core/src/media/install-plan'
import { SHARP_PIN } from '../../../packages/core/src/media/pin'
import { importBundledSharp } from '../../../packages/core/src/media/sharp-import'
import { loadSharp } from '../../../packages/core/src/media/sharp-loader'
import type { OperationContext } from '@bakin/core/operations'
import type { CheckResult, ComponentInstallOptions, InstallResult, InstallableComponent } from './types'

const REMEDIATION = 'Run `bakin install media` (or Health → repair) to download the pinned sharp prebuilds.'

async function bundledSharpAvailable(): Promise<boolean> {
  try {
    await importBundledSharp()
    return true
  } catch {
    return false
  }
}

async function check(): Promise<CheckResult> {
  if (await bundledSharpAvailable()) {
    return { name: 'media', status: 'ok', message: 'sharp available from node_modules (dev tree / npm install)' }
  }
  const store = checkMediaStore()
  if (store.status === 'ok') {
    // Receipts are claims; prove the bundle loads (a fabricated/corrupt
    // store otherwise bricks the idempotent install path — margo 2026-09-21).
    if ((await loadSharp()) === null) {
      return {
        name: 'media',
        status: 'broken',
        message: `media store receipt present (sharp ${store.receipt.sharpVersion}) but the bundle does not load — reinstall required`,
        remediation: REMEDIATION,
      }
    }
    return { name: 'media', status: 'ok', message: `media store installed (sharp ${store.receipt.sharpVersion}, ${store.receipt.platform})` }
  }
  if (store.status === 'unsupported') {
    return {
      name: 'media',
      status: 'warn',
      message: `no sharp prebuilds for this platform (${store.platform}) — image resize/thumbnails stay degraded`,
      details: { platform: store.platform },
    }
  }
  return {
    name: 'media',
    status: 'missing',
    message: 'no image processing: sharp is not importable and the media store is not installed — >2 MB enrichment, asset exports, and thumbnails will fail',
    remediation: REMEDIATION,
  }
}

async function install(opts: ComponentInstallOptions, op: OperationContext): Promise<InstallResult> {
  const started = Date.now()
  const skipAll = (reason: string) => { for (const stage of MEDIA_PLAN.stages) op.skip(stage.id, reason) }
  const current = await check()
  if (current.status === 'ok') {
    skipAll('already working')
    return { name: 'media', status: 'noop', message: current.message, durationMs: Date.now() - started }
  }
  if (current.status === 'warn') {
    skipAll('no prebuilds for this platform')
    return { name: 'media', status: 'skipped', message: current.message, durationMs: Date.now() - started }
  }
  if (!opts.autoApprove && opts.approvedComponents?.includes('media') !== true) {
    skipAll('not approved')
    return { name: 'media', status: 'skipped', message: `sharp ${SHARP_PIN.version} prebuilds (~8 MB) not approved — image resize/thumbnails stay degraded`, durationMs: Date.now() - started }
  }

  try {
    const result = await installMediaStore(op, { force: current.status === 'broken' })
    return {
      name: 'media',
      status: 'installed',
      message: result.skipped
        ? `media store already at sharp ${SHARP_PIN.version}`
        : `media store installed (sharp ${SHARP_PIN.version}) → ${result.storeDir}`,
      durationMs: Date.now() - started,
    }
  } catch (err) {
    // A cancel accepted before the commit settles cancelled, not failed.
    op.throwIfCancelled()
    return {
      name: 'media',
      status: 'failed',
      message: `media store install failed: ${err instanceof Error ? err.message : String(err)}`,
      error: err,
      durationMs: Date.now() - started,
    }
  }
}

export const mediaComponent: InstallableComponent = {
  plan: MEDIA_PLAN,
  resources: ['media-store'],
  name: 'media',
  check,
  install,
}
