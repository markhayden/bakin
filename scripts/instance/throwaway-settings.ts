/**
 * Settings merge-patch for THROWAWAY rig homes (isolated mode). Writes
 * runtime.adapter + the guest-mode search URL into the instance's own
 * settings.json — never the real ~/.bakin (paths.bakinHome is null there).
 *
 * The search URL is the launchd-clobber guard's first layer: any non-default
 * URL puts the antfly adapter in guest mode, which never provisions, spawns,
 * or writes the machine-global io.bakin.antfly unit.
 */
import type { ThrowawaySettingsPatch } from './modes'

function deepMerge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    const prev = out[key]
    out[key] = value && typeof value === 'object' && !Array.isArray(value)
      && prev && typeof prev === 'object' && !Array.isArray(prev)
      ? deepMerge(prev as Record<string, unknown>, value as Record<string, unknown>)
      : value
  }
  return out
}

export function mergeThrowawaySettings(
  existingText: string | null,
  patch: ThrowawaySettingsPatch,
): string {
  let existing: Record<string, unknown> = {}
  if (existingText !== null) {
    try {
      const parsed = JSON.parse(existingText) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        existing = parsed as Record<string, unknown>
      }
    } catch {
      // corrupt throwaway settings: start from the patch alone
    }
  }
  const overlay: Record<string, unknown> = { runtime: { adapter: patch.runtimeAdapter } }
  if (patch.searchUrl) overlay.search = { settings: { url: patch.searchUrl } }
  return JSON.stringify(deepMerge(existing, overlay), null, 2)
}
