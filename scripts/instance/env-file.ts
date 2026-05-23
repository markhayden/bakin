/**
 * Minimal gitignored env-file loader for the rig.
 *
 * My shell exports don't persist across orchestrator runs, and a service-
 * account token doesn't belong in a shell profile. Instead the rig loads
 * host-side env (OP_SERVICE_ACCOUNT_TOKEN, OPENCLAW_IMAGE_TAG) from a gitignored
 * dev/docker/.env. Existing process.env values always win, so a real shell
 * export overrides the file.
 */
import { existsSync, readFileSync } from 'node:fs'

export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue // malformed; env files are user-edited — skip, don't throw
    const key = line.slice(0, eq).trim()
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

/** Merge parsed values into an env map without overriding already-set keys. */
export function mergeEnv(into: Record<string, string | undefined>, from: Record<string, string>): void {
  for (const [key, value] of Object.entries(from)) {
    if (into[key] === undefined) into[key] = value
  }
}

/** Load a gitignored env file into the given env map if it exists. */
export function loadEnvFile(path: string, into: Record<string, string | undefined>): void {
  if (!existsSync(path)) return
  mergeEnv(into, parseEnvFile(readFileSync(path, 'utf-8')))
}
