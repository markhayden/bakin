/**
 * Interactive permission consent prompts for `bakin plugins install`
 * and `bakin plugins upgrade` (#142 layer 2).
 *
 * Pure-ish: stdin/stdout are injected so tests can verify exact prompt
 * text + simulated input. Production code passes process.stdin/stdout.
 *
 * Acceptance is binary — `y`/`Y` accepts, anything else (including empty
 * line) rejects. No prompt rendering shortcuts to color codes (terminals
 * vary).
 */
import type { Permission } from '@bakin/core/plugins/permissions'
import { PERMISSION_DESCRIPTIONS } from '@bakin/core/plugins/permissions'

export interface PromptIO {
  stdin: NodeJS.ReadStream
  stdout: NodeJS.WriteStream
}

const defaultIO = (): PromptIO => ({ stdin: process.stdin, stdout: process.stdout })

export interface InstallConsentInput {
  pluginId: string
  version: string
  permissions: Permission[]
  io?: PromptIO
  /** Skip the prompt and accept. Used by --yes / scripted installs. */
  yes?: boolean
}

export interface UpgradeConsentInput {
  pluginId: string
  fromVersion: string
  toVersion: string
  /**
   * Permissions that newly appear in the upgraded manifest. Only these
   * trigger the prompt — removed permissions don't (no security concern).
   */
  newPermissions: Permission[]
  io?: PromptIO
  yes?: boolean
}

/** Render the install prompt body. Exported for tests / introspection. */
export function renderInstallPrompt(input: InstallConsentInput): string {
  const { pluginId, version, permissions } = input
  const lines = [
    `Installing: ${pluginId} v${version}`,
    `Permissions requested:`,
  ]
  if (permissions.length === 0) {
    lines.push('  (none)')
  } else {
    const widest = permissions.reduce((w, p) => Math.max(w, p.length), 0)
    for (const p of permissions) {
      lines.push(`  ${p.padEnd(widest)}    ${PERMISSION_DESCRIPTIONS[p]}`)
    }
  }
  lines.push(`Continue? [y/N] `)
  return lines.join('\n')
}

/** Render the upgrade prompt body — only the *added* permissions. */
export function renderUpgradePrompt(input: UpgradeConsentInput): string {
  const { pluginId, fromVersion, toVersion, newPermissions } = input
  const lines = [
    `Upgrading: ${pluginId} v${fromVersion} → v${toVersion}`,
    `NEW permissions requested:`,
  ]
  const widest = newPermissions.reduce((w, p) => Math.max(w, p.length), 0)
  for (const p of newPermissions) {
    lines.push(`  + ${p.padEnd(widest)}  ${PERMISSION_DESCRIPTIONS[p]}`)
  }
  lines.push(`Continue? [y/N] `)
  return lines.join('\n')
}

/**
 * Prompt the user to accept an install. `--yes` (input.yes) short-circuits
 * to true without writing to stdout.
 *
 * Returns true on accept (`y` / `Y`), false on anything else.
 */
export async function promptInstallConsent(input: InstallConsentInput): Promise<boolean> {
  if (input.yes) return true
  const io = input.io ?? defaultIO()
  io.stdout.write(renderInstallPrompt(input))
  return readYesNo(io)
}

/**
 * Prompt the user to accept an upgrade. Only call this when permissions
 * actually widened (newPermissions.length > 0). `--yes` short-circuits.
 */
export async function promptUpgradeConsent(input: UpgradeConsentInput): Promise<boolean> {
  if (input.yes) return true
  if (input.newPermissions.length === 0) return true
  const io = input.io ?? defaultIO()
  io.stdout.write(renderUpgradePrompt(input))
  return readYesNo(io)
}

/**
 * Read a single line from stdin and resolve true iff it's `y` or `Y`.
 * Trims whitespace; empty input → false. Closes the stdin reader on
 * resolution so the calling process doesn't hang waiting for more input.
 */
function readYesNo(io: PromptIO): Promise<boolean> {
  return new Promise(resolve => {
    let buf = ''
    const onData = (chunk: Buffer | string) => {
      buf += typeof chunk === 'string' ? chunk : chunk.toString('utf-8')
      const newlineIdx = buf.indexOf('\n')
      if (newlineIdx === -1) return
      io.stdin.removeListener('data', onData)
      const line = buf.slice(0, newlineIdx).trim().toLowerCase()
      resolve(line === 'y')
    }
    io.stdin.on('data', onData)
    if (typeof (io.stdin as unknown as { resume?: () => void }).resume === 'function') {
      (io.stdin as unknown as { resume: () => void }).resume()
    }
  })
}
