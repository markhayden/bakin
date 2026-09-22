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
import { SHARP_PIN } from '../../../packages/core/src/media/pin'
import { importBundledSharp } from '../../../packages/core/src/media/sharp-import'
import { loadSharp } from '../../../packages/core/src/media/sharp-loader'
import { askYesNo } from './prompts'
import type { CheckResult, OnboardingComponent, OnboardingOptions } from './types'

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

async function install(opts: OnboardingOptions): Promise<InstallOutcome> {
  const started = Date.now()
  const current = await check()
  if (current.status === 'ok') {
    return { name: 'media', status: 'noop', message: current.message, durationMs: Date.now() - started }
  }
  if (current.status === 'warn') {
    return { name: 'media', status: 'skipped', message: current.message, durationMs: Date.now() - started }
  }

  const approved = opts.autoApprove || opts.approvedComponents?.includes('media') === true
  if (!approved && opts.interactive) {
    const yes = await askYesNo(`Download sharp ${SHARP_PIN.version} image-processing prebuilds (~8 MB) into ~/.bakin/media?`)
    if (!yes) {
      return { name: 'media', status: 'skipped', message: 'declined — image resize/thumbnails stay degraded on this install', durationMs: Date.now() - started }
    }
  } else if (!approved) {
    return { name: 'media', status: 'skipped', message: 'not approved for non-interactive install', durationMs: Date.now() - started }
  }

  try {
    const result = await installMediaStore({ force: current.status === 'broken' })
    return {
      name: 'media',
      status: 'installed',
      message: result.skipped
        ? `media store already at sharp ${SHARP_PIN.version}`
        : `media store installed (sharp ${SHARP_PIN.version}) → ${result.storeDir}`,
      durationMs: Date.now() - started,
    }
  } catch (err) {
    return {
      name: 'media',
      status: 'failed',
      message: `media store install failed: ${err instanceof Error ? err.message : String(err)}`,
      error: err,
      durationMs: Date.now() - started,
    }
  }
}

type InstallOutcome = Awaited<ReturnType<OnboardingComponent['install']>>

export const mediaComponent: OnboardingComponent = {
  name: 'media',
  check,
  install,
}
