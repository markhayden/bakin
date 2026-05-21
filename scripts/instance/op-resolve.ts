/**
 * Resolve non-OAuth secrets from a 1Password service account, host-side.
 *
 * A committed template (dev/docker/secrets.op.env) lists `KEY=op://...`
 * references — references are not secrets, so they live in the repo. At
 * `instance up` the host's `op` CLI resolves each reference and only the
 * resolved VALUES are injected into the disposable container. The service-
 * account token never enters the container.
 *
 * Pure parsing + injected runner so it is fully unit-testable.
 */
import { z } from 'zod'

import type { CommandRunner } from './runner'

export interface SecretRef {
  key: string
  ref: string
}

const ENV_KEY_RE = /^[A-Z][A-Z0-9_]*$/

const SecretRefSchema = z.object({
  key: z.string().regex(ENV_KEY_RE, 'must be an UPPER_SNAKE_CASE env key'),
  ref: z.string().startsWith('op://', 'must be a 1Password op:// reference'),
})

/**
 * Parse a `KEY=op://...` env-style template. Blank lines and `#` comments are
 * skipped. Any malformed line throws — a silent skip could drop a required
 * secret and surface as a confusing runtime failure later.
 */
export function parseSecretsTemplate(text: string): SecretRef[] {
  const refs: SecretRef[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (line === '' || line.startsWith('#')) continue

    const eq = line.indexOf('=')
    if (eq === -1) {
      throw new Error(`secrets template line ${i + 1}: expected \`KEY=op://...\`, got "${line}"`)
    }
    const key = line.slice(0, eq).trim()
    const ref = line.slice(eq + 1).trim()

    const parsed = SecretRefSchema.safeParse({ key, ref })
    if (!parsed.success) {
      const reason = parsed.error.issues.map((issue) => issue.message).join('; ')
      throw new Error(`secrets template line ${i + 1} ("${line}"): ${reason}`)
    }
    refs.push(parsed.data)
  }
  return refs
}

/**
 * Resolve each reference via `op read`. Throws an actionable error naming the
 * failing key on any non-zero exit; never logs the resolved value.
 */
export async function resolveSecrets(
  refs: SecretRef[],
  runner: CommandRunner,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (const { key, ref } of refs) {
    const result = await runner.run(['op', 'read', ref])
    if (result.code !== 0) {
      throw new Error(
        `Failed to resolve ${key} from 1Password (${ref}): ${result.stderr.trim() || `exit ${result.code}`}. `
          + `Ensure the item exists and OP_SERVICE_ACCOUNT_TOKEN can read it.`,
      )
    }
    out[key] = result.stdout.trim()
  }
  return out
}

/** Mask every resolved secret value in a string before logging it. */
export function redactSecrets(line: string, secrets: string[]): string {
  let masked = line
  for (const secret of secrets) {
    const trimmed = secret.trim()
    if (trimmed.length === 0) continue
    masked = masked.split(secret).join('***')
  }
  return masked
}
