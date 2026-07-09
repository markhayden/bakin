/**
 * OpenClaw adapter — shared leaf utilities.
 *
 * Pure JSON / object / string primitives used across the adapter's capability
 * modules (cron, sessions, channels, approvals, activity summarization). Kept
 * dependency-light so every sibling can import them without a cycle back
 * through runtime.ts. No filesystem state beyond readJsonFile's one-shot read.
 */
import { readFileSync } from 'fs'
import type { RuntimeMetadata } from '@bakin/core/adapters/runtime'

export const ANSI_RE = /\x1b\[[0-?]*[ -/]*[@-~]/g

export function stripAnsi(value: string): string {
  return value.replace(ANSI_RE, '')
}

export function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value
  }
  return undefined
}

export function firstStringAtPaths(value: unknown, paths: string[][]): string | null {
  for (const path of paths) {
    const found = stringAtPath(value, path)
    if (found) return found
  }
  return null
}

export function stringAtPath(value: unknown, path: string[]): string | null {
  let current = value
  for (const key of path) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) return null
    current = (current as Record<string, unknown>)[key]
  }
  return typeof current === 'string' && current.trim() ? current.trim() : null
}

export function getJsonPath(value: unknown, path: string[]): unknown {
  let current = value
  for (const part of path) {
    if (!isPlainObject(current)) return undefined
    current = current[part]
  }
  return current
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

export function readPath(source: Record<string, unknown>, key: string): unknown {
  let current: unknown = source
  for (const part of key.split('.')) {
    if (!isPlainObject(current) || !(part in current)) return undefined
    current = current[part]
  }
  return current
}

// Single-homed in @bakin/core (also used by settings.ts); re-exported so the
// adapter's callers keep their runtime-utils import path.
export { deepMerge } from '@bakin/core/merge'

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export function parseJsonValue(raw: string): unknown | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  try {
    return JSON.parse(trimmed)
  } catch {
    return null
  }
}

export function parseJsonObject(raw: string): Record<string, unknown> | null {
  const parsed = parseJsonValue(raw)
  return isPlainObject(parsed) ? parsed : null
}

export function parseJsonLines(raw: string): unknown[] {
  const entries: unknown[] = []
  for (const line of raw.split('\n')) {
    const parsed = parseJsonValue(line)
    if (parsed !== null) entries.push(parsed)
  }
  return entries
}

export function readJsonFile<T = unknown>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as T
  } catch {
    return null
  }
}

export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  if (maxLength <= 1) return value.slice(0, maxLength)
  return `${value.slice(0, Math.max(0, maxLength - 3))}...`
}

export function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `agent-${Date.now()}`
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function metadataValue(metadata: RuntimeMetadata | undefined, key: string): string | undefined {
  const value = metadata?.[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

export function metadataFiles(metadata: RuntimeMetadata | undefined): Array<{ name: string; path: string; contentType?: string }> {
  const value = metadata?.files
  if (!Array.isArray(value)) return []
  const files: Array<{ name: string; path: string; contentType?: string }> = []
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue
    const file = entry as Record<string, unknown>
    if (typeof file.name !== 'string' || typeof file.path !== 'string') continue
    files.push({
      name: file.name,
      path: file.path,
      ...(typeof file.contentType === 'string' ? { contentType: file.contentType } : {}),
    })
  }
  return files
}
