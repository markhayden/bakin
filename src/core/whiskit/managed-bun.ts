/**
 * Managed bun runtime (margo, 2026-09-21): capability-pack npm payloads
 * shell out to a system `bun` the compiled binary cannot provide — so when
 * none exists, install Bakin's own pinned bun into `~/.bakin/bin` (already
 * prepended to PATH at server boot). Install-time only: only pack/plugin
 * install flows call this, never request paths.
 *
 * Ladder: BAKIN_BUN_PATH / PATH (findSystemBun) → previously-managed bun on
 * disk → pinned download (stall-proof shared downloader, sha256 verify, tar
 * extract, verify-then-commit `--version` run, atomic rename).
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync, mkdirSync, mkdtempSync, copyFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { getBakinPaths } from '@/core/content-dir'
import { createLogger } from '@/core/logger'
import type { RequirementOp } from '@/core/agent-packages/requirement-op'
import { commitFileAtomic, downloadToFile, extractTarball, opTransfer } from '../../../packages/core/src/net/download'
import { mediaPlatformKey } from '../../../packages/core/src/media/pin'
import { MANAGED_BUN_DOWNLOADS, MANAGED_BUN_VERSION } from './bun-pin'
import { findSystemBun } from './command'

const log = createLogger('managed-bun')
const execFileAsync = promisify(execFile)

const DOWNLOAD_TIMEOUT_MS = 180_000
const VERIFY_TIMEOUT_MS = 15_000

export interface EnsureBunOptions {
  /** Tests pass Bun.fetch — happy-dom's global fetch can't drive real sockets. */
  fetchImpl?: typeof fetch
  /** Seam for tests: system-bun lookup (null = none found). Default wraps findSystemBun. */
  locate?: () => string | null
  /** A download, when one is needed, reports as its own item with bytes (#895). */
  op?: RequirementOp
}

/** The operation item id of the managed bun download. */
export const MANAGED_BUN_ITEM_ID = 'managed-bun'

/** `~/.bakin/bin/bun` — the managed install target. */
export function managedBunPath(): string {
  return join(getBakinPaths().bin, 'bun')
}

/**
 * Return a usable `bun` executable path, installing the pinned managed bun
 * when the system has none. Throws honestly on unsupported platforms and
 * download/verify failures.
 */
export async function ensureBunAvailable(options: EnsureBunOptions = {}): Promise<string> {
  const locate = options.locate ?? (() => {
    try {
      return findSystemBun()
    } catch {
      return null
    }
  })
  const system = locate()
  if (system) return system

  const managed = managedBunPath()
  if (existsSync(managed)) {
    try {
      await execFileAsync(managed, ['--version'], { timeout: VERIFY_TIMEOUT_MS })
      return managed
    } catch (err) {
      log.warn('managed bun on disk failed its version check — reinstalling', {
        path: managed,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  const platform = mediaPlatformKey()
  if (!platform) {
    throw new Error(
      `No system \`bun\` found and no managed bun build exists for this platform (${process.platform}-${process.arch}). `
      + 'Install Bun (https://bun.sh) or set BAKIN_BUN_PATH.',
    )
  }
  const download = MANAGED_BUN_DOWNLOADS[platform]

  log.info(`installing managed bun ${MANAGED_BUN_VERSION} (${platform}) — no system bun on PATH`)
  const op = options.op?.op
  const stageId = options.op?.stageId ?? ''
  const item = { id: MANAGED_BUN_ITEM_ID, label: `bun ${MANAGED_BUN_VERSION} (managed runtime)` }
  op?.item(stageId, { ...item, status: 'active' })
  const workDir = mkdtempSync(join(tmpdir(), 'bakin-managed-bun-'))
  try {
    const tarPath = join(workDir, 'bun.tgz')
    const started = Date.now()
    const downloaded = await downloadToFile(download.url, tarPath, {
      sha256: download.sha256,
      timeoutMs: DOWNLOAD_TIMEOUT_MS,
      fetchImpl: options.fetchImpl,
      label: `Managed bun ${MANAGED_BUN_VERSION}`,
      signal: op?.signal,
      ...(op ? { onEvent: opTransfer(op, stageId, item.id) } : {}),
    })
    log.info(`managed bun downloaded — ${downloaded.bytes} bytes in ${Date.now() - started}ms`)
    await extractTarball(tarPath, workDir, { stripComponents: 1, label: `Managed bun ${MANAGED_BUN_VERSION}`, signal: op?.signal })
    const extracted = join(workDir, 'bin', 'bun')
    if (!existsSync(extracted)) {
      throw new Error(`Managed bun ${MANAGED_BUN_VERSION} tarball did not contain bin/bun`)
    }

    mkdirSync(getBakinPaths().bin, { recursive: true })
    const tmp = `${managed}.tmp-${process.pid}`
    copyFileSync(extracted, tmp)
    await commitFileAtomic(tmp, managed, {
      mode: 0o755,
      verify: async (tmpPath) => {
        try {
          await execFileAsync(tmpPath, ['--version'], { timeout: VERIFY_TIMEOUT_MS })
        } catch (err) {
          throw new Error(
            `Managed bun ${MANAGED_BUN_VERSION} verify run failed (--version): ${err instanceof Error ? err.message : String(err)}`,
          )
        }
      },
    })
    log.info(`managed bun installed → ${managed}`)
    op?.item(stageId, { ...item, status: 'done' })
    return managed
  } catch (err) {
    op?.item(stageId, { ...item, status: 'failed', message: err instanceof Error ? err.message : String(err) })
    throw err
  } finally {
    rmSync(workDir, { recursive: true, force: true })
  }
}
