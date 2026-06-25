/**
 * Plugin settings persistence — the single place that reads/writes
 * `~/.bakin/plugin-settings/<pluginId>.json`.
 *
 * Previously the read (JSON.parse-with-empty-fallback) and write
 * (mkdir + writeFile) mechanics were hand-rolled in five places (the plugin
 * context factory, the per-request ctx, the plugin-settings REST route, the
 * agents settings route, and the team plugin). This owns only the storage
 * mechanics; change-notification policy stays with each caller (the ctx fires
 * the plugin's onSettingsChange; the REST route notifies the registry + SSE).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { getContentDir } from '../content-dir'

function settingsDir(): string {
  return join(getContentDir(), 'plugin-settings')
}

/** Absolute path to a plugin's settings file. */
export function pluginSettingsPath(pluginId: string): string {
  return join(settingsDir(), `${pluginId}.json`)
}

/** Read a plugin's settings, or `{}` when absent/corrupt. */
export function readPluginSettings<T = Record<string, unknown>>(pluginId: string): T {
  const file = pluginSettingsPath(pluginId)
  try {
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf-8')) as T
  } catch { /* fall through to empty */ }
  return {} as T
}

/** Write a plugin's settings (full replace), creating the dir if needed. */
export function writePluginSettings(pluginId: string, value: unknown): void {
  const dir = settingsDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(pluginSettingsPath(pluginId), JSON.stringify(value, null, 2))
}

/** Read, shallow-merge the patch, persist, and return the merged result. */
export function mergePluginSettings(
  pluginId: string,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const merged = { ...readPluginSettings<Record<string, unknown>>(pluginId), ...patch }
  writePluginSettings(pluginId, merged)
  return merged
}
