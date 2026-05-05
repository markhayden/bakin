/**
 * Sign and notarize the macOS release binary.
 *
 * Dry-run mode prints a redacted command plan and can run on any platform.
 * Real mode is intended for macOS CI after `bakin-darwin-arm64` has been
 * built and before checksums are computed.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

const REPO_ROOT = resolve(import.meta.dir, '..')

export const SIGNING_ENV_KEYS = [
  'APPLE_DEVELOPER_ID_CERT_P12_BASE64',
  'APPLE_DEVELOPER_ID_CERT_PASSWORD',
  'APPLE_DEVELOPER_IDENTITY',
  'APP_STORE_CONNECT_KEY_ID',
  'APP_STORE_CONNECT_ISSUER_ID',
  'APP_STORE_CONNECT_PRIVATE_KEY',
] as const

type SigningEnvKey = (typeof SIGNING_ENV_KEYS)[number]
type SecretName = SigningEnvKey | 'KEYCHAIN_PASSWORD' | 'NOTARY_SUBMISSION_ID'

interface CommandArg {
  value: string
  secret?: SecretName
}

interface CommandStep {
  kind: 'command'
  label: string
  command: string
  args: CommandArg[]
  optional?: boolean
}

interface WriteSecretStep {
  kind: 'write-secret'
  label: string
  path: string
  secret: SigningEnvKey
  encoding: 'base64' | 'utf8'
}

export type SigningPlanStep = CommandStep | WriteSecretStep

export interface SigningPlan {
  binary: string
  tempDir: string
  steps: SigningPlanStep[]
}

export interface SignMacosOptions {
  binary: string
  dryRun: boolean
  env?: Record<string, string | undefined>
  platform?: NodeJS.Platform
  tempDir?: string
}

interface CliOptions {
  binary: string
  dryRun: boolean
}

interface CommandResult {
  status: number | null
  stdout: string
  stderr: string
}

function arg(value: string, secret?: SecretName): CommandArg {
  return { value, secret }
}

function envValue(env: Record<string, string | undefined>, key: SigningEnvKey): string {
  return env[key] ?? `<${key}>`
}

function redacted(secret: SecretName): string {
  return `<redacted:${secret}>`
}

function normalizePrivateKey(value: string): string {
  return value.replace(/\\n/g, '\n')
}

export function parseArgs(argv: string[]): CliOptions {
  const dryRun = argv.includes('--dry-run')
  const binaryIndex = argv.indexOf('--binary')
  if (binaryIndex === -1 || !argv[binaryIndex + 1]) {
    throw new Error('Usage: bun run scripts/sign-macos-binary.ts --binary <path> [--dry-run]')
  }
  if (argv[binaryIndex + 1].startsWith('--')) {
    throw new Error('Usage: bun run scripts/sign-macos-binary.ts --binary <path> [--dry-run]')
  }

  const knownArgs = new Set(['--dry-run', '--binary', argv[binaryIndex + 1]])
  const unknown = argv.filter((item) => !knownArgs.has(item))
  if (unknown.length > 0) {
    throw new Error(`Unexpected arguments: ${unknown.join(' ')}`)
  }

  return {
    binary: argv[binaryIndex + 1],
    dryRun,
  }
}

export function validateSigningInputs(opts: SignMacosOptions): void {
  if (!opts.dryRun) {
    const env = opts.env ?? process.env
    const missing = SIGNING_ENV_KEYS.filter((key) => !env[key])
    if (missing.length > 0) {
      throw new Error(`Missing macOS signing env vars: ${missing.join(', ')}`)
    }
    if ((opts.platform ?? process.platform) !== 'darwin') {
      throw new Error('macOS signing/notarization must run on macOS')
    }
    if (!existsSync(opts.binary)) {
      throw new Error(`macOS binary does not exist: ${opts.binary}`)
    }
  }
}

export function buildSigningPlan(opts: SignMacosOptions): SigningPlan {
  const env = opts.env ?? process.env
  const tempDir = opts.tempDir ?? join(tmpdir(), 'bakin-macos-signing')
  const binary = resolve(REPO_ROOT, opts.binary)
  const keychainPassword = env.KEYCHAIN_PASSWORD ?? randomUUID()
  const keychainPath = join(tempDir, 'bakin-signing.keychain-db')
  const certPath = join(tempDir, 'developer-id.p12')
  const privateKeyPath = join(tempDir, 'app-store-connect-key.p8')
  const notaryZipPath = join(tempDir, 'bakin-darwin-arm64-notary.zip')

  return {
    binary,
    tempDir,
    steps: [
      {
        kind: 'write-secret',
        label: 'Write Developer ID certificate',
        path: certPath,
        secret: 'APPLE_DEVELOPER_ID_CERT_P12_BASE64',
        encoding: 'base64',
      },
      {
        kind: 'write-secret',
        label: 'Write App Store Connect private key',
        path: privateKeyPath,
        secret: 'APP_STORE_CONNECT_PRIVATE_KEY',
        encoding: 'utf8',
      },
      {
        kind: 'command',
        label: 'Create signing keychain',
        command: 'security',
        args: ['create-keychain', '-p', keychainPassword, keychainPath].map((value, index) => arg(value, index === 2 ? 'KEYCHAIN_PASSWORD' : undefined)),
      },
      {
        kind: 'command',
        label: 'Set keychain timeout',
        command: 'security',
        args: ['set-keychain-settings', '-lut', '21600', keychainPath].map((value) => arg(value)),
      },
      {
        kind: 'command',
        label: 'Unlock signing keychain',
        command: 'security',
        args: ['unlock-keychain', '-p', keychainPassword, keychainPath].map((value, index) => arg(value, index === 2 ? 'KEYCHAIN_PASSWORD' : undefined)),
      },
      {
        kind: 'command',
        label: 'Use signing keychain for this job',
        command: 'security',
        args: [arg('list-keychains'), arg('-d'), arg('user'), arg('-s'), arg(keychainPath)],
      },
      {
        kind: 'command',
        label: 'Set default signing keychain',
        command: 'security',
        args: [arg('default-keychain'), arg('-s'), arg(keychainPath)],
      },
      {
        kind: 'command',
        label: 'Import Developer ID certificate',
        command: 'security',
        args: [
          arg('import'),
          arg(certPath),
          arg('-k'),
          arg(keychainPath),
          arg('-P'),
          arg(envValue(env, 'APPLE_DEVELOPER_ID_CERT_PASSWORD'), 'APPLE_DEVELOPER_ID_CERT_PASSWORD'),
          arg('-T'),
          arg('/usr/bin/codesign'),
        ],
      },
      {
        kind: 'command',
        label: 'Allow codesign to use the imported key',
        command: 'security',
        args: [
          arg('set-key-partition-list'),
          arg('-S'),
          arg('apple-tool:,apple:,codesign:'),
          arg('-s'),
          arg('-k'),
          arg(keychainPassword, 'KEYCHAIN_PASSWORD'),
          arg(keychainPath),
        ],
      },
      {
        kind: 'command',
        label: 'Sign macOS binary',
        command: 'codesign',
        args: [
          arg('--force'),
          arg('--options'),
          arg('runtime'),
          arg('--timestamp'),
          arg('--sign'),
          arg(envValue(env, 'APPLE_DEVELOPER_IDENTITY')),
          arg(binary),
        ],
      },
      {
        kind: 'command',
        label: 'Verify macOS signature',
        command: 'codesign',
        args: [arg('--verify'), arg('--verbose=3'), arg('--strict'), arg(binary)],
      },
      {
        kind: 'command',
        label: 'Zip signed binary for notarization',
        command: '/usr/bin/ditto',
        args: [arg('-c'), arg('-k'), arg('--keepParent'), arg(binary), arg(notaryZipPath)],
      },
      {
        kind: 'command',
        label: 'Submit notarization request',
        command: 'xcrun',
        args: [
          arg('notarytool'),
          arg('submit'),
          arg(notaryZipPath),
          arg('--key'),
          arg(privateKeyPath),
          arg('--key-id'),
          arg(envValue(env, 'APP_STORE_CONNECT_KEY_ID')),
          arg('--issuer'),
          arg(envValue(env, 'APP_STORE_CONNECT_ISSUER_ID')),
          arg('--wait'),
          arg('--output-format'),
          arg('json'),
        ],
      },
      {
        kind: 'command',
        label: 'Fetch notarization log on failure',
        command: 'xcrun',
        optional: true,
        args: [
          arg('notarytool'),
          arg('log'),
          arg('<submission-id>', 'NOTARY_SUBMISSION_ID'),
          arg('--key'),
          arg(privateKeyPath),
          arg('--key-id'),
          arg(envValue(env, 'APP_STORE_CONNECT_KEY_ID')),
          arg('--issuer'),
          arg(envValue(env, 'APP_STORE_CONNECT_ISSUER_ID')),
        ],
      },
      {
        kind: 'command',
        label: 'Assess binary with Gatekeeper',
        command: 'spctl',
        args: [arg('--assess'), arg('--type'), arg('execute'), arg('--verbose'), arg(binary)],
      },
    ],
  }
}

export function formatSigningPlan(plan: SigningPlan): string {
  const lines = [
    'macOS signing plan',
    '------------------',
    `Binary: ${plan.binary}`,
    `Temp:   ${plan.tempDir}`,
  ]

  plan.steps.forEach((step, index) => {
    const prefix = `${String(index + 1).padStart(2, '0')}.`
    if (step.kind === 'write-secret') {
      lines.push(`${prefix} ${step.label}: write ${redacted(step.secret)} to ${step.path}`)
      return
    }
    const args = step.args.map((item) => item.secret ? redacted(item.secret) : item.value)
    lines.push(`${prefix} ${step.label}: ${step.command} ${args.join(' ')}${step.optional ? ' (only on failure)' : ''}`)
  })

  lines.push('Checksums are intentionally not computed here.')
  return lines.join('\n')
}

function runCommand(step: CommandStep, argsOverride?: string[]): CommandResult {
  const result = spawnSync(step.command, argsOverride ?? step.args.map((item) => item.value), {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
  })
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function echoResult(result: CommandResult): void {
  if (result.stdout) process.stdout.write(result.stdout)
  if (result.stderr) process.stderr.write(result.stderr)
}

function requireOk(step: CommandStep, result: CommandResult): void {
  echoResult(result)
  if (result.status !== 0) {
    throw new Error(`${step.label} failed`)
  }
}

function parseNotarySubmissionId(output: string): string | null {
  try {
    const parsed = JSON.parse(output) as { id?: unknown }
    if (typeof parsed.id === 'string' && parsed.id.length > 0) return parsed.id
  } catch {
    // Fall back to text output below.
  }
  return /id:\s*([0-9a-f-]+)/i.exec(output)?.[1] ?? null
}

function writeSecret(step: WriteSecretStep, env: Record<string, string | undefined>): void {
  const value = env[step.secret]
  if (!value) throw new Error(`Missing macOS signing env var: ${step.secret}`)
  const content = step.encoding === 'base64'
    ? Buffer.from(value, 'base64')
    : Buffer.from(normalizePrivateKey(value), 'utf-8')
  writeFileSync(step.path, content)
}

export async function signMacosBinary(opts: SignMacosOptions): Promise<void> {
  validateSigningInputs(opts)
  const env = opts.env ?? process.env
  const tempDir = opts.tempDir ?? (opts.dryRun ? join(tmpdir(), 'bakin-macos-signing-dry-run') : mkdtempSync(join(tmpdir(), 'bakin-macos-signing-')))
  const plan = buildSigningPlan({ ...opts, env, tempDir })

  if (opts.dryRun) {
    console.log(formatSigningPlan(plan))
    return
  }

  try {
    for (const step of plan.steps) {
      if (step.kind === 'write-secret') {
        writeSecret(step, env)
        continue
      }
      if (step.optional) continue

      const result = runCommand(step)
      if (step.label === 'Submit notarization request' && result.status !== 0) {
        echoResult(result)
        const submissionId = parseNotarySubmissionId(`${result.stdout}\n${result.stderr}`)
        const logStep = plan.steps.find((candidate): candidate is CommandStep => candidate.kind === 'command' && candidate.label === 'Fetch notarization log on failure')
        if (submissionId && logStep) {
          const logArgs = logStep.args.map((item) => item.secret === 'NOTARY_SUBMISSION_ID' ? submissionId : item.value)
          echoResult(runCommand(logStep, logArgs))
        }
        throw new Error('Submit notarization request failed')
      }
      requireOk(step, result)
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true })
  }
}

if (import.meta.main) {
  const opts = parseArgs(process.argv.slice(2))
  signMacosBinary(opts).catch((err) => {
    console.error(err instanceof Error ? err.message : String(err))
    process.exit(1)
  })
}
