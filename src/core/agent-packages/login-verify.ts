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
import { existsSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
import { atomicWriteJson } from '@bakin/core/storage/atomic-write'
import { getStoredSecret, parseSecretSlot } from '@bakin/core/media/secret-store'
import type { LoginRequirement, SkillPackManifest } from '../../../packages/core/src/agent-packages/manifest'
import { readLockfile } from '../../../packages/core/src/agent-packages/lockfile'
import { loginEntryKey, safeParseManifest } from '../../../packages/core/src/agent-packages/manifest'
import { getPackageSourceDir } from '../../../packages/core/src/agent-packages/package-paths'
import { getBakinPaths, getContentDir } from '../content-dir'
import { createLogger } from '../logger'
import { binPlatformKey } from './bin-installer'
import { verifyInstalledBin } from './bin-verify'
import { matchExpect } from './expect-match'
import { getReceiptsDir } from './receipts'

export { loginEntryKey }

const log = createLogger('login-verify')

export type LoginStatus = 'ok' | 'missing' | 'unknown'
export type LoginReason = 'exit' | 'timeout' | 'killed' | 'spawn-error' | 'binary-missing' | 'binary-unverifiable' | 'no-match' | 'account-mismatch' | 'expect-timeout' | 'expect-error'

export const LOGIN_PROBE_TIMEOUT_MS = 5_000
export const LOGIN_OUTPUT_CAP_BYTES = 16 * 1024

/** The inputs a receipt is judged against; any change makes it stale. */
export interface LoginInputs {
  packVersion: string
  /** The executable the probe resolved to (null when it could not be resolved). */
  binaryPath: string | null
  /**
   * What identifies those bytes: the verified sha256 for a managed bin, a
   * `stat:<size>:<mtimeMs>` fingerprint for a PATH prereq (hashing a 50 MB
   * `gh` on every readiness read is not worth it; a replaced or upgraded
   * binary changes both). Null when unresolved.
   */
  binaryIdentity: string | null
  /** sha256 of the accountEnv value ('' when unset or undeclared). */
  accountInputHash: string
  /** The entry's `expect` pattern (null when undeclared) — a manifest edit that changes it invalidates the receipt. */
  expect: string | null
  /** sha256 over the pack's declared secrets — env AND store evidence for each. */
  secretSlotsHash: string
}

export interface LoginReceipt extends LoginInputs {
  status: LoginStatus
  reason?: LoginReason
  checkedAt: string
  probe: string[]
  exitCode: number | null
  /** The matched account (accountEnv) or the first non-empty stdout line. */
  account?: string
  /** Bounded stdout+stderr head (one shared 16 KB budget) — never secrets by the probe's own contract. */
  output: string
}

/** One receipt per (installed pack id, login entry) — two probes never share a verdict. */
export function loginReceiptPath(packId: string, entryName: string): string {
  return join(getReceiptsDir(), 'login', packId, `${loginEntryKey(entryName)}.json`)
}

export function readLoginReceipt(packId: string, entryName: string): LoginReceipt | null {
  const path = loginReceiptPath(packId, entryName)
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as Partial<LoginReceipt>
    if (parsed.status !== 'ok' && parsed.status !== 'missing' && parsed.status !== 'unknown') return null
    if (typeof parsed.checkedAt !== 'string' || !Array.isArray(parsed.probe)) return null
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

/**
 * Declared secrets as a stable digest. BOTH the env value and the stored
 * value count (env wins for injection, but a store change while an injected
 * value still sits in process.env must still invalidate the receipt).
 */
function secretSlotsHash(manifest: SkillPackManifest): string {
  const rows = (manifest.secrets ?? []).map((secret) => {
    const fromEnv = process.env[secret.name]
    const slot = secret.secretSlot ? parseSecretSlot(secret.secretSlot) : null
    const stored = slot ? getStoredSecret(slot.provider, slot.name) : null
    return `${secret.name}:${fromEnv ? sha256(fromEnv) : '-'}:${stored ? sha256(stored) : '-'}`
  })
  return sha256(rows.join('\n'))
}

type ResolvedProbe =
  | { ok: true; path: string; identity: string }
  | { ok: false; reason: 'binary-missing' | 'binary-unverifiable'; path: string | null }

/** A PATH binary's cheap identity: size + mtime (a replaced or upgraded executable changes both). */
function statIdentity(path: string): string | null {
  try {
    const stat = statSync(path)
    return `stat:${stat.size}:${Math.round(stat.mtimeMs)}`
  } catch {
    return null
  }
}

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
    return { ok: true, path: target, identity: `sha256:${verdict.onDiskSha256}` }
  }
  // The repo's hand-rolled Bun namespace omits `which` — cast (readiness precedent).
  // PATH is passed explicitly so a server-boot change (~/.bakin/bin prepended) is honoured.
  let found: string | null
  try {
    found = (Bun as unknown as { which: (bin: string, opts?: { PATH?: string }) => string | null }).which(name, { PATH: process.env.PATH ?? '' })
  } catch (err) {
    // `Bun.which` throws on a name it cannot even look up (past ~1 KB): not located, never a crash (Codex r8 B7).
    log.warn('login probe binary lookup failed', { packId: manifest.id, name: name.slice(0, 80), error: err instanceof Error ? err.message : String(err) })
    found = null
  }
  if (!found) return { ok: false, reason: 'binary-missing', path: null }
  const identity = statIdentity(found)
  return identity ? { ok: true, path: found, identity } : { ok: false, reason: 'binary-missing', path: found }
}

/** What a fresh receipt would record as its inputs right now. */
export function currentLoginInputs(manifest: SkillPackManifest, entry: LoginRequirement = manifest.requires!.login![0]!): LoginInputs {
  const resolved = resolveProbe(manifest, entry)
  const account = accountValue(entry)
  return {
    packVersion: manifest.version,
    binaryPath: resolved.path,
    binaryIdentity: resolved.ok ? resolved.identity : null,
    accountInputHash: account ? sha256(account) : '',
    secretSlotsHash: secretSlotsHash(manifest),
    expect: entry.expect ?? null,
  }
}

/**
 * A receipt whose inputs no longer match is stale — readiness reports it
 * `unknown` until re-checked. The recorded probe must also be the entry's
 * current probe (a manifest edit that changes the command invalidates it).
 */
export function isReceiptStale(receipt: LoginInputs & { probe?: string[] }, current: LoginInputs, probe?: string[]): boolean {
  if (probe && receipt.probe && (receipt.probe.length !== probe.length || receipt.probe.some((arg, i) => arg !== probe[i]))) return true
  return receipt.packVersion !== current.packVersion
    || receipt.binaryPath !== current.binaryPath
    || receipt.binaryIdentity !== current.binaryIdentity
    || receipt.accountInputHash !== current.accountInputHash
    || receipt.secretSlotsHash !== current.secretSlotsHash
    || (receipt.expect ?? null) !== (current.expect ?? null)
}

/**
 * Drain a stream fully (so the child never blocks on a full pipe) but keep
 * only the first `cap` bytes. `cancel` lets the timeout path stop a drain a
 * killed shell's grandchild (`sleep` still holding the pipe) would otherwise
 * keep open indefinitely.
 */
async function drainCapped(
  stream: ReadableStream<Uint8Array> | null | undefined,
  budget: { remaining: number },
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
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (budget.remaining > 0) {
        // ONE byte budget shared by both streams; the decoder below never
        // throws on a multibyte character cut at the boundary.
        const slice = value.subarray(0, Math.min(value.length, budget.remaining))
        chunks.push(slice)
        budget.remaining -= slice.length
      }
    }
  } catch {
    // cancelled by the timeout path — keep what arrived
  }
  return new TextDecoder('utf-8', { fatal: false }).decode(Buffer.concat(chunks))
}

/**
 * Cut `text` to at most `bytes` of UTF-8 and never end on a torn character:
 * the stream budget is exact in bytes, but decoding a sequence cut mid-character
 * yields U+FFFD (three bytes for one or two), and the stdout/stderr separator
 * adds one more — so the PERSISTED string is bounded here, once.
 */
function capUtf8(text: string, bytes: number): string {
  if (Buffer.byteLength(text, 'utf-8') <= bytes) return text
  const cut = new TextDecoder('utf-8', { fatal: false }).decode(Buffer.from(text, 'utf-8').subarray(0, bytes))
  return cut.endsWith('\uFFFD') ? cut.slice(0, -1) : cut
}

interface ProbeRun {
  exitCode: number | null
  /** The signal that ended the child, when one did (our timeout kill, or someone else's). */
  signal: string | null
  timedOut: boolean
  spawnError?: string
  stdout: string
  stderr: string
}

async function runProbe(path: string, args: string[], timeoutMs: number): Promise<ProbeRun> {
  let proc: ReturnType<typeof Bun.spawn>
  try {
    proc = Bun.spawn([path, ...args], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', env: process.env })
  } catch (err) {
    return { exitCode: null, signal: null, timedOut: false, spawnError: err instanceof Error ? err.message : String(err), stdout: '', stderr: '' }
  }
  let timedOut = false
  const cancel: { current: (() => void) | null } = { current: null }
  const timer = setTimeout(() => {
    timedOut = true
    try { proc.kill('SIGKILL') } catch (err) { log.warn('login probe kill failed', { path, error: err instanceof Error ? err.message : String(err) }) }
    cancel.current?.()
  }, timeoutMs)
  try {
    const budget = { remaining: LOGIN_OUTPUT_CAP_BYTES }
    const [stdout, stderr, exitCode] = await Promise.all([
      drainCapped(proc.stdout as ReadableStream<Uint8Array>, budget, cancel),
      drainCapped(proc.stderr as ReadableStream<Uint8Array>, budget, cancel),
      proc.exited,
    ])
    const signal = (proc as { signalCode?: string | null }).signalCode ?? null
    return { exitCode: timedOut || signal ? null : exitCode, signal, timedOut, stdout, stderr }
  } finally {
    clearTimeout(timer)
  }
}

export interface VerifyLoginInput {
  manifest: SkillPackManifest
  /** Defaults to the pack's first login entry. */
  entry?: LoginRequirement
  /** The INSTALLED pack id the receipt is filed under (an aliased install differs from manifest.id). */
  packId?: string
  timeoutMs?: number
}

const inFlight = new Map<string, Promise<LoginReceipt>>()

/**
 * Run the pack's login probe once — concurrent callers with the SAME inputs
 * (pack identity, entry, resolved binary, account, secrets) share the run; a
 * check for a new version or a changed key never attaches to an older run.
 * Writes the receipt, returns it. Never throws: every failure is a status.
 */
export function verifyLogin(input: VerifyLoginInput): Promise<LoginReceipt> {
  const entry = input.entry ?? input.manifest.requires?.login?.[0]
  if (!entry) throw new Error(`Pack "${input.manifest.id}" declares no login requirement`)
  const packId = input.packId ?? input.manifest.id
  const inputs = currentLoginInputs(input.manifest, entry)
  // The home is part of the identity: two homes in one process never share a run.
  const key = JSON.stringify([getContentDir(), packId, loginEntryKey(entry.name), entry.probe, inputs])
  const running = inFlight.get(key)
  if (running) return running
  const run = verifyLoginUncached(packId, input.manifest, entry, inputs, input.timeoutMs ?? LOGIN_PROBE_TIMEOUT_MS).finally(() => inFlight.delete(key))
  inFlight.set(key, run)
  return run
}

async function verifyLoginUncached(packId: string, manifest: SkillPackManifest, entry: LoginRequirement, inputs: LoginInputs, timeoutMs: number): Promise<LoginReceipt> {
  const checkedAt = new Date().toISOString()
  const base = { ...inputs, checkedAt, probe: entry.probe }
  const resolved = resolveProbe(manifest, entry)
  let receipt: LoginReceipt
  if (!resolved.ok) {
    receipt = { ...base, status: 'unknown', reason: resolved.reason, exitCode: null, output: '' }
  } else {
    const run = await runProbe(resolved.path, entry.probe.slice(1), timeoutMs)
    const output = capUtf8((run.stdout + (run.stderr ? `\n${run.stderr}` : '')).trimEnd(), LOGIN_OUTPUT_CAP_BYTES)
    if (run.spawnError !== undefined) {
      receipt = { ...base, status: 'unknown', reason: 'spawn-error', exitCode: null, output: capUtf8(run.spawnError, LOGIN_OUTPUT_CAP_BYTES) }
    } else if (run.timedOut) {
      receipt = { ...base, status: 'unknown', reason: 'timeout', exitCode: null, output }
    } else if (run.signal) {
      // Ended by a signal we did not send: not a verdict about the account.
      receipt = { ...base, status: 'unknown', reason: 'killed', exitCode: null, output }
    } else if (run.exitCode !== 0) {
      receipt = { ...base, status: 'missing', reason: 'exit', exitCode: run.exitCode, output }
    } else {
      const verdict = await judgeStdout(entry, run.stdout, timeoutMs)
      if (verdict.status === 'ok') {
        receipt = { ...base, status: 'ok', exitCode: 0, output, ...(verdict.account ? { account: verdict.account } : {}) }
      } else {
        if (verdict.detail) log.warn('login expect pattern could not be evaluated', { packId, reason: verdict.reason, detail: verdict.detail })
        receipt = { ...base, status: verdict.status, reason: verdict.reason, exitCode: 0, output }
      }
    }
  }
  try {
    atomicWriteJson(loginReceiptPath(packId, entry.name), receipt)
  } catch (err) {
    log.error('login receipt write failed', err, { packId })
  }
  log.info('login probe checked', { packId, status: receipt.status, reason: receipt.reason ?? null })
  return receipt
}

type StdoutVerdict =
  | { status: 'ok'; account?: string }
  | { status: 'missing'; reason: 'no-match' | 'account-mismatch'; detail?: undefined }
  | { status: 'unknown'; reason: 'expect-timeout' | 'expect-error'; detail: string }

/**
 * Exit 0 happened; what the probe PRINTED decides. The account is read from
 * STDOUT only — a diagnostic on stderr that happens to name the wanted
 * account is not a login.
 *
 * Without `expect`: ok when the configured account (if any) appears
 * anywhere; the account shown is that, else the first line.
 *
 * With `expect`: the pattern runs in a killable child (a pack-authored
 * regex must never stall the server). No match is `no-match`. The
 * accounts are the distinct first captures of EVERY match, and a configured
 * account must BE one of them exactly — a valid second account never
 * vouches for a revoked first one, and the configured one succeeds wherever
 * it sits in the list (PR1 Codex r4 B2).
 */
async function judgeStdout(entry: LoginRequirement, stdout: string, timeoutMs: number): Promise<StdoutVerdict> {
  const wanted = accountValue(entry)
  if (entry.expect === undefined) {
    if (wanted && !stdout.includes(wanted)) return { status: 'missing', reason: 'account-mismatch' }
    const firstLine = stdout.split('\n').map((line) => line.trim()).find((line) => line.length > 0)
    return { status: 'ok', ...((wanted ?? firstLine) ? { account: wanted ?? firstLine } : {}) }
  }
  const matched = await matchExpect(entry.expect, stdout, { timeoutMs, ...(wanted ? { wanted } : {}) })
  if (!matched.ok) return { status: 'unknown', reason: matched.reason, detail: matched.detail }
  const { matched: count, captures: accounts, wantedFound } = matched.summary
  if (count === 0) return { status: 'missing', reason: 'no-match' }
  // Membership is the child's verdict over EVERY match — the capped list is for display.
  if (wanted) return wantedFound ? { status: 'ok', account: wanted } : { status: 'missing', reason: 'account-mismatch' }
  return { status: 'ok', ...(accounts[0] ? { account: accounts[0] } : {}) }
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
      // One pack's failure to even start its check never costs the others theirs (Codex r8 B7).
      try {
        if (filter.onlyIfStale) {
          const receipt = readLoginReceipt(pack.id, entry.name)
          if (receipt && !isReceiptStale(receipt, currentLoginInputs(pack.manifest, entry), entry.probe)) continue
        }
        results.push({ packId: pack.id, key: pack.key, entry, receipt: await verifyLogin({ manifest: pack.manifest, entry, packId: pack.id }) })
      } catch (err) {
        log.error('login check could not run for an installed pack', err, { packId: pack.id, entry: entry.name })
      }
    }
  }
  return results
}
