/**
 * PR5 checkpoint (#895): the real-engine check for search operations, in a
 * DISPOSABLE Linux container — developer-run, never part of `bun run test`
 * or CI:
 *
 *   bun scripts/dev/search-container-check.ts
 *
 * The host side archives the committed tree (HEAD) and the pinned Bits ref,
 * then runs this same file with `--inside` in `oven/bun:<.bun-version>`,
 * which builds the host assets the way CI does and drives the real flows
 * against the pinned antfly release:
 *
 *   1. an engine install cancelled during its download (nothing installed,
 *      staging cleaned);
 *   2. `bakin install search`;
 *   3. a server boot, then `bakin search:reset --yes` (stop → wipe → boot →
 *      reindex as stages of one operation);
 *   4. `bakin reindex` while this driver holds search-engine the way a
 *      background migration pass does — the reindex must wait VISIBLY
 *      (naming the holder), then run once the engine is free;
 *   5. `bakin install search-models` before the server: the visual embedder
 *      must load on the pinned Linux engine (#993).
 *
 * The container has its own BAKIN_HOME, ANTFLY_HOME and HOME, and antfly runs
 * in strict-child mode, so this Mac's `io.bakin.antfly` unit and `~/.antfly`
 * are never touched. `--inside` refuses to run outside a container.
 */
import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const REPO = resolve(import.meta.dir, '..', '..')
const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))

if (process.argv[2] === '--inside') await inside()
else await host()

// ---------------------------------------------------------------------------
// Host: archive the tree, run the container
// ---------------------------------------------------------------------------

async function host(): Promise<void> {
  const docker = spawnSync('docker', ['info', '--format', '{{.OSType}}'], { encoding: 'utf-8' })
  if (docker.status !== 0) fail('Docker is not available — start Docker Desktop and retry.')

  const work = mkdtempSync(join(tmpdir(), 'bakin-search-container-'))
  try {
    const bitsRef = (JSON.parse(readFileSync(join(REPO, 'design-system/compatibility.json'), 'utf-8')) as {
      repositories: Record<string, { ref: string }>
    }).repositories['bakin-bits-official']!.ref
    const bits = resolve(REPO, '..', 'bakin-bits-official')
    if (spawnSync('git', ['-C', bits, 'cat-file', '-e', `${bitsRef}^{commit}`]).status !== 0) {
      fail(`The pinned Bits ref ${bitsRef} is not in ${bits} — fetch it there first.`)
    }
    run('git', ['-C', REPO, 'archive', '--format=tar', '-o', join(work, 'bakin.tar'), 'HEAD'])
    run('git', ['-C', bits, 'archive', '--format=tar', '-o', join(work, 'bits.tar'), bitsRef])

    const bunVersion = readFileSync(join(REPO, '.bun-version'), 'utf-8').trim()
    const setup = [
      'set -euo pipefail',
      // The slim image has no system CA bundle; bun ships its own, antfly's
      // model pulls (HuggingFace over TLS) need the system one.
      'apt-get update -qq && apt-get install -y -qq --no-install-recommends ca-certificates >/dev/null',
      'mkdir -p /work/bakin /work/bakin-bits-official',
      'tar -xf /check/bakin.tar -C /work/bakin',
      'tar -xf /check/bits.tar -C /work/bakin-bits-official',
      'cd /work/bakin',
      'bun install --frozen-lockfile',
      'bun run build:host && bun run build:plugins && bun run build:assets-manifest',
      'bun scripts/dev/search-container-check.ts --inside',
    ].join(' && ')
    console.log(`[host] running the check in oven/bun:${bunVersion} (HEAD of ${REPO})`)
    const code = await stream('docker', ['run', '--rm', '-v', `${work}:/check:ro`, `oven/bun:${bunVersion}`, 'bash', '-c', setup], 'container')
    process.exit(code)
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

// ---------------------------------------------------------------------------
// Inside the container: drive the real flows
// ---------------------------------------------------------------------------

interface OperationsList { operations: Array<{ id: string; kind: string; status: string; origin: string; waitingFor?: { holderTitle: string }; stages: Array<{ id: string; status: string; items?: unknown[] }> }> }

async function inside(): Promise<void> {
  if (!existsSync('/.dockerenv')) fail('--inside runs only in the disposable container (no /.dockerenv here).')

  // Homes the container owns, never under /tmp (temporary homes cannot claim
  // the engine), set before ANY repo import — the resolvers cache.
  const env = {
    BAKIN_HOME: '/work/home',
    ANTFLY_HOME: '/work/antfly-home',
    HOME: '/work/os-home',
    BAKIN_SEARCH_SERVICE_MODE: 'child',
    BAKIN_SKIP_ONBOARDING_CHECK: '1',
    BAKIN_DISABLE_FILE_LOG: '1',
  }
  for (const dir of [env.BAKIN_HOME, env.ANTFLY_HOME, env.HOME]) mkdirSync(dir, { recursive: true })
  Object.assign(process.env, env)
  const childEnv = { ...process.env, ...env }

  const results: Array<{ name: string; ok: boolean; detail?: string }> = []
  const check = (name: string, ok: boolean, detail?: string) => {
    results.push({ name, ok, ...(detail ? { detail } : {}) })
    console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  }
  const cli = (args: string[]) => stream('bun', ['cli/bakin.ts', ...args], `bakin ${args[0]}`, childEnv)
  /** A CLI command's stdout (for --json checks). */
  const capture = (args: string[]) => new Promise<string>((resolve) => {
    const child = spawn('bun', ['cli/bakin.ts', ...args], { cwd: REPO, env: childEnv, stdio: ['ignore', 'pipe', 'inherit'] })
    let out = ''
    child.stdout.on('data', (chunk: Buffer) => { out += chunk.toString() })
    child.on('close', () => resolve(out))
  })
  const engine = join(env.ANTFLY_HOME, 'bin', 'antfly')

  // 1. Cancel an engine install during its download.
  {
    const { searchComponent } = await import(`${REPO}/src/core/onboarding/search`)
    const { componentInstallOperation } = await import(`${REPO}/src/core/onboarding/operation`)
    const { getOperationRegistry } = await import(`${REPO}/src/core/operations`)
    // The same operation `bakin install search` runs in-process.
    const started = await getOperationRegistry().start(componentInstallOperation(searchComponent, { autoApprove: true, allowServiceClaim: true }, 'cli'))
    const pending = getOperationRegistry().await(started.operationId)
    const registry = getOperationRegistry()
    let cancelled: string | null = null
    for (let i = 0; i < 1200 && !cancelled; i++) {
      const view = registry.list().find((v: { kind: string }) => v.kind === 'onboarding:search')
      const download = view?.stages.find((s: { id: string }) => s.id === 'download')
      if (view && (download?.bytes?.received ?? 0) > 0) cancelled = registry.cancel(view.id)
      else await sleep(25)
    }
    const view = await pending
    check('engine install cancelled during download', cancelled === 'cancelling' && view.status === 'cancelled', `cancel=${cancelled} status=${view.status}`)
    check('a cancelled engine install leaves nothing behind', !existsSync(engine) && !existsSync(join(env.ANTFLY_HOME, 'tmp')))
  }

  // 2. Real installs through the CLI.
  // In strict-child mode the CLI starts the engine as ITS child, which keeps
  // the CLI alive after the install finishes (true on main too) — stop the
  // engine once the binary is in place so the CLI can exit; the server
  // starts its own.
  const install = cli(['install', 'search', '--yes'])
  // Only once the engine answers: the install's own ready stage waits for it.
  let answered = 0
  const reaper = setInterval(() => {
    void fetch('http://127.0.0.1:3739/readyz', { signal: AbortSignal.timeout(1_000) }).then(
      (res) => { answered = res.ok ? answered + 1 : 0; if (answered >= 3) stopStrayEngines() },
      () => { answered = 0 },
    )
  }, 1_000)
  const installCode = await install
  clearInterval(reaper)
  check('bakin install search', installCode === 0 && existsSync(engine))
  stopStrayEngines()

  // Models BEFORE the server (#993): the visual embedder is pulled as its
  // GGUF variant, which the pinned static Linux engine loads — the install's
  // own load probe must say so, and Health must be clean.
  check('bakin install search-models', (await cli(['install', 'search-models', '--yes'])) === 0)
  stopStrayEngines()
  const modelsCheck = await capture(['check', 'search-models', '--json'])
  const modelsStatus = (() => { try { return (JSON.parse(modelsCheck) as { status?: string; message?: string }) } catch { return {} } })()
  check('every search model is present and loads here', modelsStatus.status === 'ok', `status=${modelsStatus.status} message=${modelsStatus.message}`)
  // The install's own load probes: every model it pulled must have loaded.
  const receipts = (() => {
    const dir = join(env.ANTFLY_HOME, 'bakin-model-load')
    try {
      return readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => ({ file: f, ...(JSON.parse(readFileSync(join(dir, f), 'utf8')) as { loadable?: boolean; reason?: string }) }))
    } catch { return [] }
  })()
  check('the engine itself loaded every pulled model', receipts.length > 0 && receipts.every((r) => r.loadable === true), `receipts=${JSON.stringify(receipts)}`)

  // 3. Boot the server, then reset.
  const server = spawn('bun', ['server.ts', 'serve'], { cwd: REPO, env: childEnv, stdio: ['ignore', 'inherit', 'inherit'] })
  try {
    const base = 'http://127.0.0.1:3737'
    const operations = async (): Promise<OperationsList['operations']> => {
      const res = await fetch(`${base}/api/operations`)
      return ((await res.json()) as OperationsList).operations
    }
    let up = false
    for (let i = 0; i < 240 && !up; i++) {
      up = await fetch(`${base}/api/operations`).then((r) => r.ok, () => false)
      if (!up) await sleep(500)
    }
    check('server boots', up)
    if (!up) return finish(results)
    // The engine came up with the models present — search answers (not 503).
    let searchStatus = 0
    for (let i = 0; i < 120 && searchStatus !== 200; i++) {
      searchStatus = await fetch(`${base}/api/search?q=hello`).then((r) => r.status, () => 0)
      if (searchStatus !== 200) await sleep(500)
    }
    check('search answers with the models installed', searchStatus === 200, `status=${searchStatus}`)

    const resetCode = await cli(['search:reset', '--yes'])
    const reset = (await operations()).find((o) => o.kind === 'search:reset')
    check('bakin search:reset', resetCode === 0 && reset?.status === 'succeeded',
      `exit=${resetCode} status=${reset?.status} stages=${reset?.stages.map((s) => `${s.id}:${s.status}`).join(',')}`)

    // 4. A reindex behind a background-migration holder waits visibly, then runs.
    const { holdNow } = await import(`${REPO}/packages/core/src/operations`)
    let release!: () => void
    const held = holdNow(['search-engine'], { title: 'Background index migration' }, () => new Promise<void>((done) => { release = done }))
    const reindex = cli(['reindex'])
    let waiting: string | undefined
    for (let i = 0; i < 240 && !waiting; i++) {
      waiting = (await operations()).find((o) => o.kind === 'search:reindex' && o.status === 'running')?.waitingFor?.holderTitle
      if (!waiting) await sleep(250)
    }
    check('a reindex waits visibly for the background holder', waiting === 'Background index migration', `waitingFor=${waiting}`)
    release()
    await held
    const reindexCode = await reindex
    const done = (await operations()).find((o) => o.kind === 'search:reindex')
    check('bakin reindex runs once the engine is free', reindexCode === 0 && done?.status === 'succeeded',
      `exit=${reindexCode} status=${done?.status} tables=${done?.stages[0]?.items?.length ?? 0}`)

    // 5. With a server running for this home, an install runs ON it (the CLI
    // reads server.lock — step 2 ran in-process with none) and the server's
    // tray lists it as CLI-started.
    const mkdirCode = await cli(['mkdir', '--json'])
    const onServer = (await operations()).find((o) => o.kind === 'onboarding:mkdir')
    check('an install runs on the running server and shows in its tray', mkdirCode === 0 && onServer?.status === 'succeeded' && onServer.origin === 'cli',
      `exit=${mkdirCode} status=${onServer?.status} origin=${onServer?.origin}`)
  } finally {
    server.kill('SIGTERM')
  }

  finish(results)
}

/** In child mode a CLI install leaves its engine child behind; the server spawns its own. */
function stopStrayEngines(): void {
  for (const pid of readdirSync('/proc').filter((name) => /^\d+$/.test(name))) {
    let cmdline = ''
    try {
      cmdline = readFileSync(`/proc/${pid}/cmdline`, 'utf-8')
    } catch {
      continue // exited while we looked
    }
    if (cmdline.startsWith('/work/antfly-home/bin/antfly')) process.kill(Number(pid), 'SIGTERM')
  }
}

function finish(results: Array<{ ok: boolean }>): never {
  const failed = results.filter((r) => !r.ok).length
  // The container is discarded on exit: show the engine's own account of a failure.
  const engineLog = '/work/home/logs/antfly.log'
  if (failed > 0 && existsSync(engineLog)) {
    console.log(`\n--- last 60 lines of ${engineLog} ---`)
    console.log(readFileSync(engineLog, 'utf-8').split('\n').slice(-60).join('\n'))
  }
  console.log(failed === 0 ? `\nAll ${results.length} checks passed.` : `\n${failed} of ${results.length} checks FAILED.`)
  process.exit(failed === 0 ? 0 : 1)
}

// ---------------------------------------------------------------------------
// Process helpers
// ---------------------------------------------------------------------------

function run(cmd: string, args: string[]): void {
  const result = spawnSync(cmd, args, { stdio: 'inherit' })
  if (result.status !== 0) fail(`${cmd} ${args.join(' ')} exited ${result.status}`)
}

function stream(cmd: string, args: string[], label: string, env: NodeJS.ProcessEnv = process.env): Promise<number> {
  return new Promise((done) => {
    const child = spawn(cmd, args, { cwd: process.argv[2] === '--inside' ? REPO : undefined, env, stdio: ['ignore', 'pipe', 'pipe'] })
    const prefix = (chunk: Buffer) => chunk.toString().split('\n').filter(Boolean).map((line) => `[${label}] ${line}\n`).join('')
    child.stdout.on('data', (chunk: Buffer) => process.stdout.write(prefix(chunk)))
    child.stderr.on('data', (chunk: Buffer) => process.stderr.write(prefix(chunk)))
    child.on('close', (code) => done(code ?? 1))
  })
}

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}
