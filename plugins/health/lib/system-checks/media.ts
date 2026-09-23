/**
 * System check — media.sharp (#889).
 *
 * Compiled-binary installs run without sharp unless the media store is
 * installed, which used to surface one failed enrichment at a time (>2 MB
 * images fail hard, exports throw, thumbnails degrade, the assets_visual
 * search leg loses thumbs). This check names that state ONCE, loudly
 * (unclassified incident → never demoted by sensitivity policy — visible in
 * quiet mode), with a one-click repair that runs the store installer.
 *
 * ok on dev trees (bundled sharp importable) and on installs with a store
 * receipt at the pin; warn-shaped healthy-with-caveat on platforms that
 * have no prebuilds at all.
 */
import { healthError, healthHealthy, healthObserved, healthWarning } from '@makinbakin/sdk/utils'
import type { HealthCheckRunInput, HealthRepairActionDefinition } from '@makinbakin/sdk'
import { repairTargetSelection } from '@bakin/core/health/repair-support'

export const MEDIA_REPAIR_ACTION_ID = 'media-install-store'

interface MediaDeps {
  bundledSharpAvailable(): Promise<boolean>
  checkStore(): import('../../../../packages/core/src/media/installer').MediaStoreStatus
  /** Does sharp ACTUALLY load right now? Receipts are claims; this is proof. */
  sharpLoads(): Promise<boolean>
  sharpVersion(): string
}

async function defaultDeps(): Promise<MediaDeps> {
  const installer = await import('../../../../packages/core/src/media/installer')
  const { SHARP_PIN } = await import('../../../../packages/core/src/media/pin')
  const { importBundledSharp } = await import('../../../../packages/core/src/media/sharp-import')
  const { loadSharp } = await import('../../../../packages/core/src/media/sharp-loader')
  return {
    bundledSharpAvailable: () => importBundledSharp().then(() => true, () => false),
    checkStore: () => installer.checkMediaStore(),
    sharpLoads: async () => (await loadSharp()) !== null,
    sharpVersion: () => SHARP_PIN.version,
  }
}

export async function checkMediaSharp(depsOverride?: MediaDeps): Promise<HealthCheckRunInput> {
  const deps = depsOverride ?? await defaultDeps()

  if (await deps.bundledSharpAvailable()) {
    return healthObserved([healthHealthy({
      key: 'media.sharp',
      summary: 'Image processing available (bundled sharp).',
      detail: 'sharp resolves from node_modules — dev tree or npm install.',
      evidence: { engine: 'bundled' },
    })])
  }

  const store = deps.checkStore()
  if (store.status === 'ok') {
    // A receipt is a CLAIM — prove the bundle loads before reporting healthy.
    // margo 2026-09-21: a delegation agent fabricated a receipt + hand-rolled
    // store that could never load in the compiled binary; trusting it made
    // the doctor say healthy while enrichment kept failing AND bricked the
    // idempotent repair path (install saw the receipt and skipped).
    if (!(await deps.sharpLoads())) {
      return healthObserved([healthError({
        key: 'media.sharp',
        summary: 'Media store receipt present, but the sharp bundle does not load.',
        detail: 'The store is corrupt or was not produced by the installer. The one-click repair reinstalls it from the pinned tarballs (forced past the receipt).',
        evidence: { engine: 'store-broken', sharpVersion: store.receipt.sharpVersion, platform: store.receipt.platform },
        incident: {
          key: 'media-store-broken',
          title: 'Image processing store is present but broken',
          impact: 'Images over 2 MB cannot be enriched; asset exports and thumbnails fail — while the receipt claims otherwise.',
          disposition: 'action_required',
          resolution: {
            key: 'reinstall-media-store',
            type: 'repair',
            label: 'Reinstall image processing (~8 MB download)',
            actionId: MEDIA_REPAIR_ACTION_ID,
          },
        },
      })])
    }
    return healthObserved([healthHealthy({
      key: 'media.sharp',
      summary: `Image processing available (media store, sharp ${store.receipt.sharpVersion}).`,
      detail: `Store installed for ${store.receipt.platform} at ${store.receipt.installedAt}; bundle load verified.`,
      evidence: { engine: 'store', sharpVersion: store.receipt.sharpVersion, platform: store.receipt.platform },
    })])
  }

  if (store.status === 'unsupported') {
    return healthObserved([healthWarning({
      key: 'media.sharp',
      summary: `No sharp prebuilds for this platform (${store.platform}).`,
      detail: 'Image resize, thumbnails, and >2 MB enrichment stay degraded — no remediation exists on this platform.',
      evidence: { platform: store.platform },
      incident: {
        key: 'unsupported-platform',
        title: 'Image processing has no prebuilds for this platform',
        class: 'unsupported_surface',
        impact: 'Images over 2 MB cannot be enriched; asset exports and thumbnails stay degraded.',
        disposition: 'advisory',
        resolution: {
          key: 'unsupported-platform-info',
          type: 'instructions',
          label: 'Why this platform is degraded',
          steps: [
            'sharp ships prebuilds for darwin-arm64, linux-x64 (glibc), and linux-arm64 (glibc) only.',
            'Run Bakin on a supported platform, or install from source with sharp as a devDependency.',
          ],
        },
      },
    })])
  }

  return healthObserved([healthError({
    key: 'media.sharp',
    summary: 'No image processing: sharp is unavailable and the media store is not installed.',
    detail: 'Enrichment of >2 MB images fails hard, asset exports throw, thumbnails degrade to ffmpeg-or-nothing, and visual search loses thumbs.',
    evidence: { engine: 'none', pinnedSharp: deps.sharpVersion() },
    incident: {
      key: 'media-store-missing',
      title: 'Image processing is degraded on this install',
      impact: 'Generated or attached images over 2 MB cannot be enriched or sent to vision models; asset exports and thumbnails fail.',
      disposition: 'action_required',
      resolution: {
        key: 'install-media-store',
        type: 'repair',
        label: 'Install image processing (~8 MB download)',
        actionId: MEDIA_REPAIR_ACTION_ID,
      },
    },
  })])
}

export function mediaStoreRepair(): HealthRepairActionDefinition {
  return {
    id: MEDIA_REPAIR_ACTION_ID,
    name: 'Install the media store (sharp prebuilds)',
    async plan(target) {
      return [{
        id: 'install-media-store',
        actionId: MEDIA_REPAIR_ACTION_ID,
        title: 'Download pinned sharp prebuilds into ~/.bakin/media',
        reason: 'The compiled binary cannot carry sharp’s native modules; the store provides them with a probe-verified install.',
        safety: 'safe',
        ...repairTargetSelection(target),
        changes: [{
          kind: 'other',
          target: '~/.bakin/media',
          action: 'create',
          description: 'Download ~8 MB of sha256-pinned npm tarballs, bundle and probe-verify sharp, and commit the store atomically. The running server picks it up without a restart.',
        }],
      }]
    },
    async apply(items) {
      if (items.length === 0) return []
      const { checkMediaStore, installMediaStore } = await import('../../../../packages/core/src/media/installer')
      const { loadSharp } = await import('../../../../packages/core/src/media/sharp-loader')
      try {
        // Receipt present but unloadable = corrupt/fabricated store — the
        // idempotent fast path would skip it; force a clean reinstall.
        const force = checkMediaStore().status === 'ok' && (await loadSharp()) === null
        const result = await installMediaStore({ force })
        return items.map((item) => ({
          itemId: item.id,
          actionId: item.actionId,
          status: 'applied' as const,
          message: result.skipped
            ? 'Media store already installed at the pinned sharp version.'
            : `Media store installed → ${result.storeDir}. Image processing is live (no restart needed).`,
          affectedCheckIds: ['health.media.sharp'],
          changes: item.changes,
        }))
      } catch (err) {
        return items.map((item) => ({
          itemId: item.id,
          actionId: item.actionId,
          status: 'failed' as const,
          message: `Media store install failed: ${err instanceof Error ? err.message : String(err)}`,
          affectedCheckIds: ['health.media.sharp'],
          changes: item.changes,
        }))
      }
    },
  }
}
