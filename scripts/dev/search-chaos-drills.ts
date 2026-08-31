/**
 * T22 chaos drills — MANUALLY INVOKED, never part of `bun run test`:
 *
 *   bun scripts/dev/search-chaos-drills.ts            # run all five drills
 *   bun scripts/dev/search-chaos-drills.ts --child-migrate <bakinHome> <url>
 *                                                     # internal (drill 2)
 *
 * Everything is ephemeral: temp BAKIN_HOME, temp engine data dirs, random
 * ports, dev binary. Results are recorded in
 * .claude/knowledge/search-chaos-drills.md. A drill failure exits non-zero.
 */
import { mkdtempSync, mkdirSync, openSync, rmSync, symlinkSync, existsSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const DEV_BINARY = '/Users/roscoe/go/src/github.com/antflydb/antfly-main/zig/zig-out/bin/antfly'
const REPO = '/Users/roscoe/go/src/github.com/markhayden/bakin'

// ONE BAKIN_HOME for the whole run, set BEFORE any repo import —
// getContentDir() caches on first resolution, so per-drill reassignment
// silently reads the wrong search.db (learned the hard way; drills use
// per-drill table names instead).
if (process.argv[2] !== '--child-migrate') {
  process.env.BAKIN_HOME = mkdtempSync(join(tmpdir(), 'chaos-bakin-'))
}

// ---------------------------------------------------------------------------
// Child mode (drill 2): start a migration with a slow generator, get killed.
// ---------------------------------------------------------------------------
if (process.argv[2] === '--child-migrate') {
  process.env.BAKIN_HOME = process.argv[3]
  const url = process.argv[4]
  const { AntflySearchClient } = await import(`${REPO}/packages/adapter-antfly/src/client`)
  const { DEFAULT_SETTINGS } = await import(`${REPO}/packages/adapter-antfly/src/defaults`)
  const { ensureTable } = await import(`${REPO}/packages/core/src/search/tables`)
  const client = new AntflySearchClient({ ...DEFAULT_SETTINGS, url })
  console.log('[child] starting slow migration to v2')
  await ensureTable(client, {
    logical: 'chaos2_t',
    schemaVersion: 2,
    config: { fields: { title: { type: 'text' } }, legs: [{ name: 'full_text', capability: 'full-text', fields: ['title'] }] },
    reindex: async function* () {
      for (let i = 0; i < 200; i++) {
        yield { key: `d${i}`, doc: { title: `doc ${i} v2` } }
        await sleep(60) // slow enough to be killed mid-backfill
      }
    },
  }, 'chaos-fp')
  console.log('[child] migration finished (should not happen — parent kills us)')
  process.exit(0)
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------
interface Engine { url: string; port: number; dataDir: string; kill: (sig?: NodeJS.Signals) => void; proc: ChildProcess }

async function startEngine(root: string, port: number, binary = DEV_BINARY): Promise<Engine> {
  const dataDir = join(root, 'engine-data')
  const modelsDir = join(root, 'models')
  mkdirSync(dataDir, { recursive: true })
  mkdirSync(modelsDir, { recursive: true })
  for (const owner of ['BAAI', 'antflydb']) {
    const src = join(homedir(), '.antfly', 'inference', 'models', owner)
    const dst = join(modelsDir, owner)
    if (existsSync(src) && !existsSync(dst)) symlinkSync(src, dst)
  }
  const fd = openSync(join(root, 'engine.log'), 'a')
  const proc = spawn(binary, ['standalone', '--host', '127.0.0.1', '--port', String(port), '--health-port', String(port + 1),
    '--data-dir', dataDir, '--models-dir', modelsDir], { stdio: ['ignore', fd, fd] })
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port + 1}/readyz`, { signal: AbortSignal.timeout(1000) })
      if (r.ok && (await r.text()).includes('ready')) {
        return { url: `http://127.0.0.1:${port}`, port, dataDir, kill: (sig = 'SIGTERM') => proc.kill(sig), proc }
      }
    } catch { /* booting */ }
    await sleep(300)
  }
  throw new Error('engine never ready')
}

let failures = 0
function verdict(name: string, pass: boolean, detail: string) {
  console.log(`\n=== ${pass ? 'PASS' : 'FAIL'} — ${name}\n    ${detail}`)
  if (!pass) failures++
}

const FTS_DEF = (logical: string, schemaVersion: number, suffix = '') => ({
  logical,
  schemaVersion,
  config: { fields: { title: { type: 'text' as const } }, legs: [{ name: 'full_text', capability: 'full-text' as const, fields: ['title'] }] },
  reindex: async function* () {
    for (let i = 0; i < 200; i++) yield { key: `d${i}`, doc: { title: `doc ${i}${suffix}` } }
  },
})

async function main() {
  if (!existsSync(DEV_BINARY)) throw new Error('dev binary missing — see evidence file P0.1')
  const basePort = 49100 + Math.floor(Math.random() * 200)

  // ---------------- Drill 1: SIGKILL engine mid-backfill ----------------
  {
    const root = mkdtempSync(join(tmpdir(), 'chaos1-'))
    const { AntflySearchClient } = await import(`${REPO}/packages/adapter-antfly/src/client`)
    const { DEFAULT_SETTINGS } = await import(`${REPO}/packages/adapter-antfly/src/defaults`)
    const tables = await import(`${REPO}/packages/core/src/search/tables`)
    let engine = await startEngine(root, basePort)
    const client = new AntflySearchClient({ ...DEFAULT_SETTINGS, url: engine.url })

    await tables.ensureTable(client, FTS_DEF('chaos1_t', 1), 'chaos-fp')
    const blue = tables.queryTarget('chaos1_t')!
    // slow migration; kill the ENGINE mid-backfill
    const migration = tables.ensureTable(client, {
      ...FTS_DEF('chaos1_t', 2, ' v2'),
      reindex: async function* () {
        for (let i = 0; i < 200; i++) {
          yield { key: `d${i}`, doc: { title: `doc ${i} v2` } }
          await sleep(25)
        }
      },
    }, 'chaos-fp')
    await sleep(1500)
    engine.kill('SIGKILL')
    const result = await migration.catch((err: Error) => `threw: ${err.message.slice(0, 60)}`)
    const stayedOnBlue = tables.queryTarget('chaos1_t') === blue
    const stateAfterKill = tables.tableStatus('chaos1_t')
    engine = await startEngine(root, basePort) // same data dir
    await tables.resumeMigrations(client, [FTS_DEF('chaos1_t', 2, ' v2')], 'chaos-fp')
    const flipped = tables.queryTarget('chaos1_t')?.startsWith('chaos1_t_v2') === true
    const greenCount = flipped ? (await client.tables.stats(tables.queryTarget('chaos1_t')!))?.documents : 0
    verdict('drill 1: SIGKILL engine mid-backfill → resume completes',
      stayedOnBlue && stateAfterKill?.state === 'migrating' && flipped && greenCount === 200,
      `during-kill result=${JSON.stringify(result).slice(0, 80)} stayedOnBlue=${stayedOnBlue} resumedTo=${tables.queryTarget('chaos1_t')} docs=${greenCount}`)
    engine.kill()
    rmSync(root, { recursive: true, force: true })
  }

  // ---------------- Drill 2: SIGKILL the DRIVING PROCESS mid-migration ----------------
  {
    const root = mkdtempSync(join(tmpdir(), 'chaos2-'))
    const bakinHome = process.env.BAKIN_HOME!
    const { AntflySearchClient } = await import(`${REPO}/packages/adapter-antfly/src/client`)
    const { DEFAULT_SETTINGS } = await import(`${REPO}/packages/adapter-antfly/src/defaults`)
    const tables = await import(`${REPO}/packages/core/src/search/tables`)
    const engine = await startEngine(root, basePort + 10)
    const client = new AntflySearchClient({ ...DEFAULT_SETTINGS, url: engine.url })
    await tables.ensureTable(client, FTS_DEF('chaos2_t', 1), 'chaos-fp')
    const blue = tables.queryTarget('chaos2_t')!

    const child = spawn('bun', [join(REPO, 'scripts/dev/search-chaos-drills.ts'), '--child-migrate', bakinHome, engine.url], { stdio: ['ignore', 'pipe', 'pipe'] })
    let childOut = ''
    child.stdout?.on('data', (d: Buffer) => { childOut += d.toString() })
    child.stderr?.on('data', (d: Buffer) => { childOut += d.toString() })
    // wait until the child has PERSISTED the migrating state (poll), then
    // kill it mid-backfill
    const { closeAllDbs } = await import(`${REPO}/packages/core/src/storage/db`)
    const killDeadline = Date.now() + 20_000
    while (Date.now() < killDeadline) {
      closeAllDbs() // fresh read — the child process writes the same file
      if (tables.tableStatus('chaos2_t')?.state === 'migrating') break
      await sleep(300)
    }
    await sleep(1200) // some backfill progress
    child.kill('SIGKILL')
    await sleep(500)
    closeAllDbs() // child wrote the registry; reopen fresh
    const stateAfterKill = tables.tableStatus('chaos2_t')
    await tables.resumeMigrations(client, [FTS_DEF('chaos2_t', 2, ' v2')], 'chaos-fp')
    const flipped = tables.queryTarget('chaos2_t')?.startsWith('chaos2_t_v2') === true
    const docs = flipped ? (await client.tables.stats(tables.queryTarget('chaos2_t')!))?.documents : 0
    verdict('drill 2: SIGKILL driving process mid-migration → fresh process resumes',
      stateAfterKill?.state === 'migrating' && blue.startsWith('chaos2_t_v1') && flipped && docs === 200,
      `childStarted=${childOut.includes('starting slow migration')} stateAfterKill=${stateAfterKill?.state}/${stateAfterKill?.phase} resumedTo=${tables.queryTarget('chaos2_t')} docs=${docs}`)
    engine.kill()
    rmSync(root, { recursive: true, force: true })
  }

  // ---------------- Drill 3: 2-day-down replay (500+ writes) ----------------
  {
    const root = mkdtempSync(join(tmpdir(), 'chaos3-'))
    const { AntflySearchClient } = await import(`${REPO}/packages/adapter-antfly/src/client`)
    const { DEFAULT_SETTINGS } = await import(`${REPO}/packages/adapter-antfly/src/defaults`)
    const outbox = await import(`${REPO}/packages/core/src/search/outbox`)
    let engine = await startEngine(root, basePort + 20)
    const client = new AntflySearchClient({ ...DEFAULT_SETTINGS, url: engine.url })
    await client.tables.create('chaos_replay', { fields: { title: { type: 'text' } }, legs: [{ name: 'full_text', capability: 'full-text', fields: ['title'] }] })
    await sleep(1200)
    engine.kill('SIGKILL')
    await sleep(500)

    const N = 550
    for (let i = 0; i < N; i++) outbox.enqueueIndex('chaos_replay', `k${i}`, { title: `queued while down ${i}` })
    const queued = outbox.outboxStats().pending

    engine = await startEngine(root, basePort + 20)
    let drained = 0
    for (let i = 0; i < 60 && outbox.outboxStats().pending > 0; i++) {
      const report = await outbox.drainOnce({ adapter: client, resolveTargets: (l: string) => [l] }, { ignoreBackoff: true })
      drained += report.processed
      if (report.processed === 0 && report.failedTransient > 0) await sleep(500)
    }
    const docs = (await client.tables.stats('chaos_replay'))?.documents ?? 0
    // acked-dedupe: re-enqueue identical docs → all no-ops
    for (let i = 0; i < N; i++) outbox.enqueueIndex('chaos_replay', `k${i}`, { title: `queued while down ${i}` })
    const dedupedPending = outbox.outboxStats().pending
    verdict('drill 3: 550 writes while down → drain lands all; identical re-enqueue is a no-op',
      queued === N && drained === N && docs === N && dedupedPending === 0,
      `queued=${queued} drained=${drained} engineDocs=${docs} reEnqueuePending=${dedupedPending}`)
    engine.kill()
    rmSync(root, { recursive: true, force: true })
  }

  // ---------------- Drill 4: engine data wiped, Bakin state intact ----------------
  {
    const root = mkdtempSync(join(tmpdir(), 'chaos4-'))
    const { AntflySearchClient } = await import(`${REPO}/packages/adapter-antfly/src/client`)
    const { DEFAULT_SETTINGS } = await import(`${REPO}/packages/adapter-antfly/src/defaults`)
    const tables = await import(`${REPO}/packages/core/src/search/tables`)
    let engine = await startEngine(root, basePort + 30)
    const client = new AntflySearchClient({ ...DEFAULT_SETTINGS, url: engine.url })
    await tables.ensureTable(client, FTS_DEF('chaos4_t', 1), 'chaos-fp')
    const physical = tables.queryTarget('chaos4_t')!

    engine.kill('SIGKILL')
    await sleep(500)
    rmSync(engine.dataDir, { recursive: true, force: true }) // WIPE
    engine = await startEngine(root, basePort + 30)

    // detection primitive the doctor consistency check uses: registry says
    // active, engine says the physical doesn't exist
    const stats = await client.tables.stats(physical)
    const detectedWipe = stats === null && tables.tableStatus('chaos4_t')?.state === 'active'
    // repair = forced blue/green rebuild (same machinery the doctor invokes)
    await tables.rebuildTable(client, FTS_DEF('chaos4_t', 1), 'chaos-fp')
    const rebuilt = tables.queryTarget('chaos4_t')!
    const docs = (await client.tables.stats(rebuilt))?.documents ?? 0
    verdict('drill 4: engine wiped, Bakin state intact → detected + rebuild restores',
      detectedWipe && rebuilt !== physical && docs === 200,
      `detectedWipe=${detectedWipe} rebuiltTo=${rebuilt} docs=${docs}`)
    engine.kill()
    rmSync(root, { recursive: true, force: true })
  }

  // ---------------- Drill 5: upgrade under load (stop → swap → start) ----------------
  {
    const root = mkdtempSync(join(tmpdir(), 'chaos5-'))
    const { AntflySearchClient } = await import(`${REPO}/packages/adapter-antfly/src/client`)
    const { DEFAULT_SETTINGS } = await import(`${REPO}/packages/adapter-antfly/src/defaults`)
    const outbox = await import(`${REPO}/packages/core/src/search/outbox`)

    // "installed" binary lives at a swappable path (upgrade choreography)
    const binDir = join(root, 'bin')
    mkdirSync(binDir, { recursive: true })
    const installed = join(binDir, 'antfly')
    symlinkSync(DEV_BINARY, installed)

    let engine = await startEngine(root, basePort + 40, installed)
    const client = new AntflySearchClient({ ...DEFAULT_SETTINGS, url: engine.url })
    await client.tables.create('chaos_up', { fields: { title: { type: 'text' } }, legs: [{ name: 'full_text', capability: 'full-text', fields: ['title'] }] })
    await sleep(1200)

    // writes flowing on an interval, draining opportunistically
    let written = 0
    let stop = false
    const writer = (async () => {
      while (!stop) {
        outbox.enqueueIndex('chaos_up', `w${written}`, { title: `under load ${written}` })
        written++
        await outbox.drainOnce({ adapter: client, resolveTargets: (l: string) => [l] }, { ignoreBackoff: true }).catch(() => null)
        await sleep(40)
      }
    })()

    await sleep(1500)
    // UPGRADE: stop → swap binary → start (same engine data dir)
    engine.kill('SIGTERM')
    await sleep(800)
    rmSync(installed)
    symlinkSync(DEV_BINARY, installed) // the "new version"
    engine = await startEngine(root, basePort + 40, installed)
    await sleep(1500)
    stop = true
    await writer

    // final drain to land anything still queued
    for (let i = 0; i < 40 && outbox.outboxStats().pending > 0; i++) {
      const r = await outbox.drainOnce({ adapter: client, resolveTargets: (l: string) => [l] }, { ignoreBackoff: true })
      if (r.processed === 0) await sleep(300)
    }
    const docs = (await client.tables.stats('chaos_up'))?.documents ?? 0
    verdict('drill 5: upgrade under load → zero lost writes',
      written > 30 && docs === written && outbox.outboxStats().pending === 0,
      `written=${written} landed=${docs} pending=${outbox.outboxStats().pending}`)
    engine.kill()
    rmSync(root, { recursive: true, force: true })
  }

  console.log(`\n${failures === 0 ? 'ALL DRILLS PASSED' : `${failures} DRILL(S) FAILED`}`)
  process.exit(failures === 0 ? 0 : 1)
}

await main()
