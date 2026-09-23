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
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
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
  const read = readPluginSettingsFile(pluginId)
  return (read.status === 'ok' ? read.value : {}) as T
}

/**
 * The HONEST read: a file that is absent is different from one that exists
 * but cannot be parsed. Money-bearing settings (the spend policy) must
 * never mistake "unreadable" for "empty" — an absent policy is no limits,
 * an unreadable one is "we cannot know".
 */
export type PluginSettingsRead =
  | { status: 'absent' }
  | { status: 'ok'; value: unknown }
  | { status: 'unreadable'; file: string; error: string }

export function readPluginSettingsFile(pluginId: string): PluginSettingsRead {
  const file = pluginSettingsPath(pluginId)
  if (!existsSync(file)) return { status: 'absent' }
  try {
    return { status: 'ok', value: JSON.parse(readFileSync(file, 'utf-8')) as unknown }
  } catch (err) {
    return { status: 'unreadable', file, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Write a plugin's settings (full replace), creating the dir if needed.
 * Atomic: the document lands in a temp file and is renamed over the target,
 * so a crash mid-write can never leave a truncated settings file and a
 * reader never sees a half-written one.
 */
export function writePluginSettings(pluginId: string, value: unknown): void {
  const dir = settingsDir()
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const file = pluginSettingsPath(pluginId)
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(value, null, 2))
  renameSync(tmp, file)
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
