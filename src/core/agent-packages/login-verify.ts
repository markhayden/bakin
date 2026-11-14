/**
 * Login verification (spec provider-integrations §4.1, plan 1.3).
 *
 * A pack may declare `requires.login[]`: a read-only probe whose exit status
 * says whether the operator has logged the pack's tool into its provider
 * (`gog auth list --check`, `gh auth status`). This module RUNS that probe —
 * only on explicit triggers (install/sync completion, `bakin check
 * capabilities`, a "Check login" action); readiness never spawns anything,
 * it reads the receipt this module writes and judges its staleness.
 *
 * Rules:
 *  - argv, no shell, stdin closed, output capped, hard timeout that KILLS.
 *  - probe[0] resolves ONLY to the pack's own declared binary: a managed bin
 *    at its verified path (a missing/drifted bin never executes → `unknown`),
 *    or a binary prereq on PATH.
 *  - `accountEnv`: when the named env var is set, the output must mention
 *    its value or the status is `missing` (account-mismatch).
 *  - receipts live under ~/.bakin/packages/receipts/login/<packId>.json and
 *    record the inputs that make them stale: pack version, binary sha,
 *    account input, declared secrets.
 */
import { createHash } from 'crypto'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { atomicWriteJson } from '@bakin/core/storage/atomic-write'
import { getStoredSecret, parseSecretSlot } from '@bakin/core/media/secret-store'
import type { LoginRequirement, SkillPackManifest } from '../../../packages/core/src/agent-packages/manifest'
import { readLockfile } from '../../../packages/core/src/agent-packages/lockfile'
import { safeParseManifest } from '../../../packages/core/src/agent-packages/manifest'
import { getPackageSourceDir } from '../../../packages/core/src/agent-packages/package-paths'
import { getBakinPaths, getContentDir } from '../content-dir'
import { createLogger } from '../logger'
import { binPlatformKey } from './bin-installer'
import { verifyInstalledBin } from './bin-verify'
import { getReceiptsDir } from './receipts'

const log = createLogger('login-verify')

export type LoginStatus = 'ok' | 'missing' | 'unknown'
export type LoginReason = 'exit' | 'timeout' | 'spawn-error' | 'binary-missing' | 'binary-unverifiable' | 'account-mismatch'

export const LOGIN_PROBE_TIMEOUT_MS = 5_000
export const LOGIN_OUTPUT_CAP_BYTES = 16 * 1024

/** The inputs a receipt is judged against; any change makes it stale. */
export interface LoginInputs {
  packVersion: string
  /** sha256 of the managed binary (bin route); absent on the prereq route. */
  binarySha256?: string
  /** sha256 of the accountEnv value ('' when unset or undeclared). */
  accountInputHash: string
  /** sha256 over the pack's declared secrets (name + where it comes from + value hash). */
  secretSlotsHash: string
}

export interface LoginReceipt extends LoginInputs {
  status: LoginStatus
  reason?: LoginReason
  checkedAt: string
  probe: string[]
  exitCode: number | null
  binaryPath: string | null
  /** The matched account (accountEnv) or the first non-empty output line. */
  account?: string
  /** Bounded stdout+stderr head — never secrets by the probe's own contract. */
  output: string
}

export function loginReceiptPath(packId: string): string {
  return join(getReceiptsDir(), 'login', `${packId}.json`)
}

export function readLoginReceipt(packId: string): LoginReceipt | null {
  const path = loginReceiptPath(packId)
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<LoginReceipt>
    if (parsed.status !== 'ok' && parsed.status !== 'missing' && parsed.status !== 'unknown') return null
    if (typeof parsed.checkedAt !== 'string') return null
    return parsed as LoginReceipt
  } catch {
    return null
  }
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function accountValue(entry: LoginRequirement): string | null {
  if (!entry.accountEnv) return null
  const raw = process.env[entry.accountEnv]?.trim()
  return raw ? raw : null
}

/** Declared secrets as a stable digest: env wins over the store, as everywhere. */
function secretSlotsHash(manifest: SkillPackManifest): string {
  const rows = (manifest.secrets ?? []).map((secret) => {
    const fromEnv = process.env[secret.name]
    if (fromEnv) return `${secret.name}:env:${sha256(fromEnv)}`
    const slot = secret.secretSlot ? parseSecretSlot(secret.secretSlot) : null
    const stored = slot ? getStoredSecret(slot.provider, slot.name) : null
    return stored ? `${secret.name}:store:${sha256(stored)}` : `${secret.name}:absent`
  })
  return sha256(rows.join('\n'))
}

type ResolvedProbe =
  | { ok: true; path: string; binarySha256?: string }
  | { ok: false; reason: 'binary-missing' | 'binary-unverifiable'; path: string | null }

/**
 * probe[0] → an executable path, by the pack's own declarations only. A
 * managed bin resolves to its verified path (hash must match the pin); a
 * binary prereq resolves on PATH. The manifest schema already guarantees one
 * of the two declares it.
 */
function resolveProbe(manifest: SkillPackManifest, entry: LoginRequirement): ResolvedProbe {
  const name = entry.probe[0]!
  const bin = manifest.requires?.bins?.find((b) => b.name === name)
  if (bin) {
    const platform = binPlatformKey()
    const download = platform ? bin.install[platform] : undefined
    const target = join(getBakinPaths().bin, name)
    if (!download) return { ok: false, reason: 'binary-unverifiable', path: target }
    const verdict = verifyInstalledBin(target, download)
    if (verdict.status === 'missing') return { ok: false, reason: 'binary-missing', path: target }
    if (verdict.status === 'drifted') return { ok: false, reason: 'binary-unverifiable', path: target }
    return { ok: true, path: target, binarySha256: verdict.onDiskSha256 }
  }
  // The repo's hand-rolled Bun namespace omits `which` — cast (readiness precedent).
  // PATH is passed explicitly so a server-boot change (~/.bakin/bin prepended) is honoured.
  const found = (Bun as unknown as { which: (bin: string, opts?: { PATH?: string }) => string | null }).which(name, { PATH: process.env.PATH ?? '' })
  return found ? { ok: true, path: found } : { ok: false, reason: 'binary-missing', path: null }
}

/** What a fresh receipt would record as its inputs right now. */
export function currentLoginInputs(manifest: SkillPackManifest, entry: LoginRequirement = manifest.requires!.login![0]!): LoginInputs {
  const resolved = resolveProbe(manifest, entry)
  const account = accountValue(entry)
  return {
    packVersion: manifest.version,
    ...(resolved.ok && resolved.binarySha256 ? { binarySha256: resolved.binarySha256 } : {}),
    accountInputHash: account ? sha256(account) : '',
    secretSlotsHash: secretSlotsHash(manifest),
  }
}

/** A receipt whose inputs no longer match is stale — readiness reports it `unknown` until re-checked. */
export function isReceiptStale(receipt: LoginInputs, current: LoginInputs): boolean {
  return receipt.packVersion !== current.packVersion
    || (receipt.binarySha256 ?? null) !== (current.binarySha256 ?? null)
    || receipt.accountInputHash !== current.accountInputHash
    || receipt.secretSlotsHash !== current.secretSlotsHash
}

/**
 * Drain a stream fully (so the child never blocks on a full pipe) but keep
 * only the first `cap` bytes. `cancel` lets the timeout path stop a drain a
 * killed shell's grandchild (`sleep` still holding the pipe) would otherwise
 * keep open indefinitely.
 */
async function drainCapped(
  stream: ReadableStream<Uint8Array> | null | undefined,
  cap: number,
  cancel: { current: (() => void) | null },
): Promise<string> {
  if (!stream) return ''
  const reader = stream.getReader()
  const previous = cancel.current
  cancel.current = () => {
    previous?.()
    reader.cancel().catch(() => { /* already closed */ })
  }
  const chunks: Uint8Array[] = []
  let kept = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (kept < cap) {
        const slice = value.subarray(0, Math.min(value.length, cap - kept))
        chunks.push(slice)
        kept += slice.length
      }
    }
  } catch {
    // cancelled by the timeout path — keep what arrived
  }
  return Buffer.concat(chunks).toString('utf-8')
}

interface ProbeRun {
  exitCode: number | null
  timedOut: boolean
  spawnError?: string
  output: string
}

async function runProbe(path: string, args: string[], timeoutMs: number): Promise<ProbeRun> {
  let proc: ReturnType<typeof Bun.spawn>
  try {
    proc = Bun.spawn([path, ...args], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', env: process.env })
  } catch (err) {
    return { exitCode: null, timedOut: false, spawnError: err instanceof Error ? err.message : String(err), output: '' }
  }
  let timedOut = false
  const cancel: { current: (() => void) | null } = { current: null }
  const timer = setTimeout(() => {
    timedOut = true
    try { proc.kill('SIGKILL') } catch (err) { log.warn('login probe kill failed', { path, error: err instanceof Error ? err.message : String(err) }) }
    cancel.current?.()
  }, timeoutMs)
  try {
    const [stdout, stderr, exitCode] = await Promise.all([
      drainCapped(proc.stdout as ReadableStream<Uint8Array>, LOGIN_OUTPUT_CAP_BYTES, cancel),
      drainCapped(proc.stderr as ReadableStream<Uint8Array>, LOGIN_OUTPUT_CAP_BYTES, cancel),
      proc.exited,
    ])
    const output = (stdout + (stderr ? `\n${stderr}` : '')).slice(0, LOGIN_OUTPUT_CAP_BYTES)
    return { exitCode: timedOut ? null : exitCode, timedOut, output }
  } finally {
    clearTimeout(timer)
  }
}

export interface VerifyLoginInput {
  manifest: SkillPackManifest
  /** Defaults to the pack's first login entry. */
  entry?: LoginRequirement
  timeoutMs?: number
}

const inFlight = new Map<string, Promise<LoginReceipt>>()

/**
 * Run the pack's login probe once (concurrent callers share the run), write
 * the receipt, return it. Never throws: every failure is a receipt status.
 */
export function verifyLogin(input: VerifyLoginInput): Promise<LoginReceipt> {
  const entry = input.entry ?? input.manifest.requires?.login?.[0]
  if (!entry) throw new Error(`Pack "${input.manifest.id}" declares no login requirement`)
  const key = `${input.manifest.id}\u0000${entry.probe.join('\u0000')}`
  const running = inFlight.get(key)
  if (running) return running
  const run = verifyLoginUncached(input.manifest, entry, input.timeoutMs ?? LOGIN_PROBE_TIMEOUT_MS).finally(() => inFlight.delete(key))
  inFlight.set(key, run)
  return run
}

async function verifyLoginUncached(manifest: SkillPackManifest, entry: LoginRequirement, timeoutMs: number): Promise<LoginReceipt> {
  const inputs = currentLoginInputs(manifest, entry)
  const checkedAt = new Date().toISOString()
  const base = { ...inputs, checkedAt, probe: entry.probe }
  const resolved = resolveProbe(manifest, entry)
  let receipt: LoginReceipt
  if (!resolved.ok) {
    receipt = { ...base, status: 'unknown', reason: resolved.reason, exitCode: null, binaryPath: resolved.path, output: '' }
  } else {
    const run = await runProbe(resolved.path, entry.probe.slice(1), timeoutMs)
    const firstLine = run.output.split('\n').map((line) => line.trim()).find((line) => line.length > 0)
    const wanted = accountValue(entry)
    if (run.spawnError !== undefined) {
      receipt = { ...base, status: 'unknown', reason: 'spawn-error', exitCode: null, binaryPath: resolved.path, output: run.spawnError.slice(0, LOGIN_OUTPUT_CAP_BYTES) }
    } else if (run.timedOut) {
      receipt = { ...base, status: 'unknown', reason: 'timeout', exitCode: null, binaryPath: resolved.path, output: run.output }
    } else if (run.exitCode !== 0) {
      receipt = { ...base, status: 'missing', reason: 'exit', exitCode: run.exitCode, binaryPath: resolved.path, output: run.output }
    } else if (wanted && !run.output.includes(wanted)) {
      receipt = { ...base, status: 'missing', reason: 'account-mismatch', exitCode: 0, binaryPath: resolved.path, output: run.output }
    } else {
      receipt = {
        ...base,
        status: 'ok',
        exitCode: 0,
        binaryPath: resolved.path,
        output: run.output,
        ...((wanted ?? firstLine) ? { account: wanted ?? firstLine } : {}),
      }
    }
  }
  try {
    atomicWriteJson(loginReceiptPath(manifest.id), receipt)
  } catch (err) {
    log.error('login receipt write failed', err, { packId: manifest.id })
  }
  log.info('login probe checked', { packId: manifest.id, status: receipt.status, reason: receipt.reason ?? null })
  return receipt
}

export interface InstalledLoginPack {
  /** Bare pack id (receipts are keyed by it). */
  id: string
  /** Lockfile key (`<id>@<version>`). */
  key: string
  manifest: SkillPackManifest
}

/**
 * Every installed skill-pack that declares `requires.login`, read from the
 * lockfile + its installed manifest (the same two sources readiness judges).
 * Invalid or missing manifests are skipped here — readiness already reports
 * them as not-ready rows; a probe for them cannot be bound anyway.
 */
export function listInstalledLoginPacks(): InstalledLoginPack[] {
  const lock = readLockfile()
  const out: InstalledLoginPack[] = []
  const seen = new Set<string>()
  for (const [key, entry] of Object.entries(lock.packages)) {
    if (entry.kind !== 'skill-pack') continue
    const id = key.includes('@') ? key.slice(0, key.lastIndexOf('@')) : key
    if (seen.has(`${id}@${entry.version}`)) continue
    seen.add(`${id}@${entry.version}`)
    const path = join(getPackageSourceDir(getContentDir(), entry.kind, id, entry.version), 'bakin-package.json')
    if (!existsSync(path)) continue
    let raw: unknown
    try {
      raw = JSON.parse(readFileSync(path, 'utf-8'))
    } catch {
      continue
    }
    const parsed = safeParseManifest(raw)
    if (!parsed.success || parsed.data.kind !== 'skill-pack') continue
    if (!parsed.data.requires?.login?.length) continue
    out.push({ id, key, manifest: parsed.data })
  }
  return out
}

export interface VerifyInstalledFilter {
  /** A lockfile key or bare id; absent = every login pack. */
  packId?: string
  /** Only packs declaring a secret bound to this `<provider>.<name>` slot. */
  secretSlot?: string
  /** Skip packs whose receipt exists and is not stale. */
  onlyIfStale?: boolean
}

export interface InstalledLoginResult {
  packId: string
  key: string
  entry: LoginRequirement
  receipt: LoginReceipt
}

/** Re-check the login of installed packs matching the filter. Never throws. */
export async function verifyInstalledPackLogins(filter: VerifyInstalledFilter = {}): Promise<InstalledLoginResult[]> {
  const results: InstalledLoginResult[] = []
  for (const pack of listInstalledLoginPacks()) {
    if (filter.packId && filter.packId !== pack.id && filter.packId !== pack.key) continue
    if (filter.secretSlot && !(pack.manifest.secrets ?? []).some((secret) => secret.secretSlot === filter.secretSlot)) continue
    for (const entry of pack.manifest.requires!.login!) {
      if (filter.onlyIfStale) {
        const receipt = readLoginReceipt(pack.id)
        if (receipt && !isReceiptStale(receipt, currentLoginInputs(pack.manifest, entry))) continue
      }
      results.push({ packId: pack.id, key: pack.key, entry, receipt: await verifyLogin({ manifest: pack.manifest, entry }) })
    }
  }
  return results
}
