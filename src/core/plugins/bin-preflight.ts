/**
 * Binary preflight — runs BEFORE consent and before any mutation (spec
 * plugin-managed-binaries §2.1/§2.4/§2.6):
 *   - every declared bin needs a download for the running platform;
 *   - no other owner (pack or plugin) may pin the same target differently.
 * Shared by the install route and every upgrade lane so a doomed operation
 * is refused without asking the user to consent to it first.
 */
import type { PluginBinRequirement } from '@makinbakin/sdk/types'
import { binPlatformKey } from '@/core/agent-packages/bin-installer'
import { BinPinConflictError, findBinPinConflicts } from './bin-owners'

export type BinPreflightVerdict =
  | { ok: true }
  | { ok: false; status: 400 | 409; error: string }

export function preflightPluginBins(pluginId: string, bins: readonly PluginBinRequirement[]): BinPreflightVerdict {
  if (bins.length === 0) return { ok: true }
  const platform = binPlatformKey()
  for (const bin of bins) {
    if (!platform || !bin.install[platform]) {
      return {
        ok: false,
        status: 400,
        error: `Binary "${bin.name}" has no build for this platform (${platform ?? `${process.platform}-${process.arch}`}) — `
          + `declared: ${Object.keys(bin.install).join(', ')}. This plugin cannot be installed here.`,
      }
    }
  }
  const conflicts = findBinPinConflicts(bins, { kind: 'plugin', id: pluginId }, platform)
  if (conflicts.length > 0) {
    return { ok: false, status: 409, error: BinPinConflictError.describe(conflicts, { kind: 'plugin', id: pluginId }) }
  }
  return { ok: true }
}

export function binPreflightResponse(verdict: BinPreflightVerdict): Response | null {
  if (verdict.ok) return null
  return Response.json({ ok: false, error: verdict.error }, { status: verdict.status })
}
