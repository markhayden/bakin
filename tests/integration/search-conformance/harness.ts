/**
 * Ephemeral antfly harness for integration suites. Spawns a private
 * instance from a dev/installed binary on unused ports with throwaway
 * data/models dirs. Suites SKIP (loudly) when no binary is present.
 *
 * Binary resolution: BAKIN_ANTFLY_BIN env → the antfly-main dev worktree
 * build → the machine install (~/.antfly/bin/antfly).
 * Dev-build recipe: tasks/evidence-search-rebuild.md (P0.1) — zig 0.16.0
 * from ~/toolchains, `make -C zig build` in the antfly-main worktree.
 */
import { createServer } from 'net'
import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync, mkdirSync, openSync, rmSync, symlinkSync } from 'fs'
import { tmpdir, homedir } from 'os'
import { join } from 'path'
import { spawn, type ChildProcess } from 'child_process'

import { ANTFLY_PIN } from '../../../packages/adapter-antfly/src/pin'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const DEV_BUILD = '/Users/roscoe/go/src/github.com/antflydb/antfly-main/zig/zig-out/bin/antfly'

export function resolveAntflyBinary(): string | null {
  // PINNED binary before any dev build: canaries and conformance certify
  // the engine Bakin actually ships (pin.ts). A stale dev build silently
  // green-lit pins against a pre-rc.18 engine (missed the /lookup →
  // /documents move — caught live 2026-07-11). BAKIN_ANTFLY_BIN stays
  // first as the explicit override for upstream-dev testing.
  const candidates = [
    process.env.BAKIN_ANTFLY_BIN,
    join(homedir(), '.antfly', 'bin', 'antfly'),
    DEV_BUILD,
  ]
  for (const candidate of candidates) {
    if (candidate && existsSync(candidate)) {
      // Version guard: a machine/dev binary older than the pin would fail
      // confusingly (e.g. pre-rc.19 binaries lack the `standalone`
      // subcommand and time out unready) — skip loudly instead, unless the
      // caller explicitly chose the binary via BAKIN_ANTFLY_BIN.
      if (candidate !== process.env.BAKIN_ANTFLY_BIN) {
        try {
          const reported = execFileSync(candidate, ['--version'], { encoding: 'utf-8', timeout: 10_000 }).trim()
          // Exact token equality, not substring: "0.2.0-rc.18" CONTAINS
          // "0.2.0", so an includes() check would let a stale rc binary
          // impersonate the final-release pin (the GATE-B stale-engine
          // incident, resurrected).
          const token = reported.match(/\d+\.\d+\.\d+[-.\w]*/)?.[0]
          if (token !== ANTFLY_PIN.version) {
            console.warn(
              `search-conformance: SKIPPING ${candidate} — reports "${reported}" but the pin is ${ANTFLY_PIN.version}. ` +
              'Run `bakin install search` to upgrade, or set BAKIN_ANTFLY_BIN to test this binary anyway.',
            )
            continue
          }
        } catch {
          console.warn(`search-conformance: SKIPPING ${candidate} — could not probe --version`)
          continue
        }
      }
      console.warn(`search-conformance: antfly binary = ${candidate}`)
      return candidate
    }
  }
  return null
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (address && typeof address === 'object') {
        const port = address.port
        server.close(() => resolve(port))
      } else {
        server.close(() => reject(new Error('no port')))
      }
    })
  })
}

export interface EphemeralAntfly {
  url: string
  port: number
  healthPort: number
  root: string
  modelsAvailable: boolean
  stop: () => Promise<void>
}

export interface SpawnOpts {
  /** Symlink these model owners from the machine models dir when present. */
  modelOwners?: string[]
  preloadModels?: string[]
  readyTimeoutMs?: number
}

export async function spawnEphemeralAntfly(binary: string, opts: SpawnOpts = {}): Promise<EphemeralAntfly> {
  const root = mkdtempSync(join(tmpdir(), 'bakin-antfly-it-'))
  const dataDir = join(root, 'data')
  const modelsDir = join(root, 'models')
  mkdirSync(dataDir, { recursive: true })
  mkdirSync(modelsDir, { recursive: true })

  const machineModels = join(homedir(), '.antfly', 'inference', 'models')
  let modelsAvailable = false
  for (const owner of opts.modelOwners ?? []) {
    const src = join(machineModels, owner)
    if (existsSync(src)) {
      symlinkSync(src, join(modelsDir, owner))
      modelsAvailable = true
    }
  }

  // Allocate two adjacent ports (api + health) with a collision retry.
  let port = await freePort()
  for (let attempt = 0; attempt < 5; attempt++) {
    const health = port + 1
    const clash = await new Promise<boolean>((resolve) => {
      const probe = createServer()
      probe.once('error', () => resolve(true))
      probe.listen(health, '127.0.0.1', () => probe.close(() => resolve(false)))
    })
    if (!clash) break
    port = await freePort()
  }
  const healthPort = port + 1

  const argv = [
    // `standalone` is the single-process server subcommand (rc.19+ rename;
    // the pinned 0.2.0 has no `swarm`). BAKIN_ANTFLY_SUBCOMMAND overrides for
    // cross-version evaluation runs (e.g. BAKIN_ANTFLY_BIN at a pre-rc.19
    // binary, which needs `swarm`).
    process.env.BAKIN_ANTFLY_SUBCOMMAND ?? 'standalone',
    '--host', '127.0.0.1',
    '--port', String(port),
    '--health-port', String(healthPort),
    '--data-dir', dataDir,
    '--models-dir', modelsDir,
    ...(opts.preloadModels ?? []).flatMap((m) => ['--preload-model', m]),
  ]
  const outFd = openSync(join(root, 'antfly.log'), 'a')
  const errFd = openSync(join(root, 'antfly.err.log'), 'a')
  const child: ChildProcess = spawn(binary, argv, { stdio: ['ignore', outFd, errFd] })

  // Bun.fetch, NOT global fetch: the test preload registers happy-dom,
  // whose window fetch breaks on real HTTP (HPE_UNEXPECTED_CONTENT_LENGTH).
  const nativeFetch = (Bun as unknown as { fetch: typeof fetch }).fetch
  const deadline = Date.now() + (opts.readyTimeoutMs ?? 120_000)
  let ready = false
  while (Date.now() < deadline) {
    try {
      const response = await nativeFetch(`http://127.0.0.1:${healthPort}/readyz`, { signal: AbortSignal.timeout(1_000) })
      if (response.ok && (await response.text()).includes('ready')) {
        ready = true
        break
      }
    } catch {
      // not up yet
    }
    await sleep(300)
  }
  if (!ready) {
    child.kill('SIGKILL')
    throw new Error(`ephemeral antfly never became ready (root: ${root})`)
  }

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    healthPort,
    root,
    modelsAvailable,
    stop: async () => {
      child.kill('SIGTERM')
      await sleep(300)
      if (child.exitCode === null) child.kill('SIGKILL')
      rmSync(root, { recursive: true, force: true })
    },
  }
}
