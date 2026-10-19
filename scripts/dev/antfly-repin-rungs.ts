/**
 * Engine repin load rungs (first written for 0.2.5 from the rungs described
 * in tasks/evidence-antfly-0.2.2.md):
 *   A. #617 + backfill pacing: a 20k-doc bge table backfills to ready, then a
 *      second leg (sem2) is added to the POPULATED table and must converge.
 *   B. Starvation: WHILE sem2 catches up, three create → fill → drop cycles of
 *      the assets shape (bge text leg + clipclap remoteMedia leg, 55 docs in
 *      sync full_index chunks of 10, 15 with images).
 *   Probes every 1 s throughout: engine status, a control-table read and a
 *   control-table write.
 *
 * MANUALLY INVOKED for an engine repin, never part of `bun run test`:
 *   bun scripts/dev/antfly-repin-rungs.ts <antfly-binary> [<bakin-repo>]
 * Scratch ports/data, machine models symlinked read-only; exits non-zero on
 * any probe failure. Results go in tasks/evidence-antfly-<version>.md.
 */
import { spawn } from 'child_process'
import { mkdirSync, mkdtempSync, openSync, realpathSync, symlinkSync, writeFileSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'

const binary = process.argv[2]!
const repo = process.argv[3] ?? join(import.meta.dir, '..', '..')
const { renderEngineConfig } = await import(`${repo}/packages/adapter-antfly/src/service`)
const nativeFetch = (Bun as unknown as { fetch: typeof fetch }).fetch
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const log = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a)

const root = realpathSync(mkdtempSync(join(tmpdir(), 'rung025-')))
const data = join(root, 'data'), models = join(root, 'models'), media = join(root, 'media')
for (const d of [data, models, media]) mkdirSync(d, { recursive: true })
for (const owner of ['BAAI', 'antflydb']) symlinkSync(join(homedir(), '.antfly', 'inference', 'models', owner), join(models, owner))
writeFileSync(join(root, 'engine.json'), renderEngineConfig({ mediaRoots: [media] }))
const PORT = 3871
const engine = spawn(binary, ['standalone', '--host', '127.0.0.1', '--port', String(PORT), '--health-port', String(PORT + 1),
  '--config', join(root, 'engine.json'), '--data-dir', data, '--models-dir', models,
  '--preload-model', 'embedder:BAAI/bge-small-en-v1.5', '--preload-model', 'embedder:antflydb/clipclap'],
  { stdio: ['ignore', openSync(join(root, 'engine.log'), 'a'), openSync(join(root, 'engine.log'), 'a')] })
const base = `http://127.0.0.1:${PORT}`
// Never orphan the eval engine, whatever happens below.
process.on('exit', () => { try { engine.kill('SIGKILL') } catch { /* already gone */ } })
process.on('uncaughtException', (err) => { console.error('RUNG FAILED', err); process.exit(2) })
process.on('unhandledRejection', (err) => { console.error('RUNG FAILED', err); process.exit(2) })

async function api(method: string, path: string, body?: unknown, timeoutMs = 30_000): Promise<{ status: number; json: any; ms: number }> {
  const t0 = performance.now()
  try {
    const r = await nativeFetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) })
    const text = await r.text()
    let json: any = text
    try { json = JSON.parse(text) } catch { /* raw */ }
    return { status: r.status, json, ms: performance.now() - t0 }
  } catch (err) {
    return { status: 0, json: String(err), ms: performance.now() - t0 }
  }
}
const bge = { provider: 'antfly', model: 'BAAI/bge-small-en-v1.5' }
const clip = { provider: 'antfly', model: 'antflydb/clipclap' }
const textLeg = (name: string) => ({ type: 'embeddings', template: '{{title}} {{body}}', dimension: 384, embedder: bge, name })
const legs = async (t: string) => ((await api('GET', `/db/v1/tables/${t}/indexes`)).json as any[] ?? []).filter((e) => e?.config?.type === 'embeddings')
/** Ready = every leg idle with its expected count (a media leg only covers docs that HAVE media). */
async function waitReady(t: string, docs: number | Record<string, number>, label: string, limitMs: number): Promise<number> {
  const t0 = Date.now()
  const want = (leg: string) => typeof docs === 'number' ? docs : docs[leg] ?? 0
  while (Date.now() - t0 < limitMs) {
    const ls = await legs(t)
    if (ls.length > 0 && ls.every((l) => l.status?.total_indexed >= want(l.config.name) && !l.status?.backfill_active && !l.status?.rebuilding)) return Date.now() - t0
    await sleep(2000)
  }
  throw new Error(`${label}: not ready in ${limitMs} ms — ${JSON.stringify((await legs(t)).map((l) => [l.config.name, l.status]))}`)
}

// ---- boot
for (let i = 0; i < 180; i++) { if ((await api('GET', '/db/v1/status', undefined, 2000)).status === 200) break; await sleep(1000) }
log('engine up', (await api('GET', '/db/v1/status')).status)

// ---- control table + probes
await api('POST', '/db/v1/tables/ctrl', { num_shards: 1 }); await sleep(800)
await api('POST', '/db/v1/tables/ctrl/batch', { inserts: { c1: { title: 'control' } }, sync_level: 'full_index' })
const probes = { n: 0, failures: [] as string[], worst: { status: 0, read: 0, write: 0 } }
let probing = true
const prober = (async () => {
  let i = 0
  while (probing) {
    const [s, r, w] = await Promise.all([
      api('GET', '/db/v1/status', undefined, 10_000),
      api('GET', '/db/v1/tables/ctrl/documents/c1', undefined, 10_000),
      api('POST', '/db/v1/tables/ctrl/batch', { inserts: { [`w${i++}`]: { title: 'probe' } } }, 10_000),
    ])
    probes.n++
    if (s.status !== 200) probes.failures.push(`status ${s.status}`)
    if (r.status !== 200) probes.failures.push(`read ${r.status}`)
    if (w.status >= 300 || w.status === 0) probes.failures.push(`write ${w.status}`)
    probes.worst.status = Math.max(probes.worst.status, s.ms); probes.worst.read = Math.max(probes.worst.read, r.ms); probes.worst.write = Math.max(probes.worst.write, w.ms)
    await sleep(1000)
  }
})()

// ---- A. 20k bge table → ready, then add sem2 to the populated table
const N = 20_000
await api('POST', '/db/v1/tables/sem', { num_shards: 1 }); await sleep(800)
log('create sem leg', (await api('POST', '/db/v1/tables/sem/indexes/sem1', textLeg('sem1'))).status)
const words = ['alpha', 'beta', 'gamma', 'delta', 'cats', 'dogs', 'tacos', 'river', 'mountain', 'engine']
const tA = Date.now()
for (let start = 0; start < N; start += 500) {
  const inserts: Record<string, unknown> = {}
  for (let k = start; k < start + 500; k++) inserts[`d${k}`] = { title: `${words[k % 10]} ${words[(k * 7) % 10]} ${k}`, body: `document number ${k} about ${words[(k * 3) % 10]}` }
  const r = await api('POST', '/db/v1/tables/sem/batch', { inserts }, 60_000)
  if (r.status >= 300) throw new Error(`20k insert batch ${start}: ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`)
}
log('20k inserted in', Date.now() - tA, 'ms')
const backfillMs = await waitReady('sem', N, 'sem1 backfill', 45 * 60_000)
log(`sem1 ready: 20k in ${(backfillMs / 1000).toFixed(0)} s (${(N / (backfillMs / 1000)).toFixed(1)} docs/s)`)

const addStatus = (await api('POST', '/db/v1/tables/sem/indexes/sem2', textLeg('sem2'))).status
const tAdd = Date.now()
log('add sem2 to populated table →', addStatus)
let workerStartedMs = -1
let sem2Converged = false
const sem2Done = (async () => {
  while (true) {
    const s2 = (await legs('sem')).find((l) => l.config.name === 'sem2')
    if (workerStartedMs < 0 && (s2?.status?.total_indexed ?? 0) > 0) workerStartedMs = Date.now() - tAdd
    if (s2 && s2.status?.total_indexed >= N && !s2.status?.backfill_active) { sem2Converged = true; return Date.now() - tAdd }
    if (Date.now() - tAdd > 60 * 60_000) throw new Error(`sem2 not converged in 60 min: ${JSON.stringify(s2?.status)}`)
    await sleep(2000)
  }
})()

// ---- B. starvation cycles while sem2 catches up
const sharp = (await import(Bun.resolveSync('sharp', repo))).default
for (let i = 0; i < 15; i++) {
  await sharp({ create: { width: 256, height: 256, channels: 3, background: { r: (i * 37) % 255, g: (i * 91) % 255, b: (i * 53) % 255 } } }).jpeg().toFile(join(media, `img${i}.jpg`))
}
const cycles: Array<{ cycle: number; buildMs: number; readyMs: number }> = []
// Rebuild cycles for the WHOLE sem2 catch-up (at least 3), not a 10 s burst.
for (let c = 1; c <= 3 || !sem2Converged; c++) {
  const t = `assets_c${c}`
  const t0 = Date.now()
  await api('POST', `/db/v1/tables/${t}`, { num_shards: 1 }); await sleep(800)
  const a = await api('POST', `/db/v1/tables/${t}/indexes/text`, textLeg('text'))
  const b = await api('POST', `/db/v1/tables/${t}/indexes/visual`, { type: 'embeddings', template: '{{#if media_url}}{{remoteMedia url=media_url}}{{/if}}', dimension: 512, embedder: clip, name: 'visual' })
  if (a.status >= 300 || b.status >= 300) throw new Error(`cycle ${c} index create ${a.status}/${b.status}`)
  for (let start = 0; start < 55; start += 10) {
    const inserts: Record<string, unknown> = {}
    for (let k = start; k < Math.min(55, start + 10); k++) inserts[`a${k}`] = { title: `asset ${k} ${words[k % 10]}`, body: `caption ${k}`, ...(k < 15 ? { media_url: `file://${join(media, `img${k}.jpg`)}` } : {}) }
    const r = await api('POST', `/db/v1/tables/${t}/batch`, { inserts, sync_level: 'full_index' }, 120_000)
    if (r.status >= 300) throw new Error(`cycle ${c} chunk ${start}: ${r.status} ${JSON.stringify(r.json).slice(0, 300)}`)
  }
  const buildMs = Date.now() - t0
  const readyMs = await waitReady(t, { text: 55, visual: 15 }, `cycle ${c}`, 10 * 60_000)
  const vis = (await legs(t)).find((l) => l.config.name === 'visual')?.status
  log(`cycle ${c}: visual leg backfill_state=${vis?.backfill_state} readiness=${vis?.readiness?.state} reasons=${JSON.stringify(vis?.readiness?.pending_reasons)} worker_failed=${vis?.enrichment_runtime?.worker_failed}`)
  cycles.push({ cycle: c, buildMs, readyMs })
  log(`cycle ${c}: built in ${buildMs} ms, ready after ${readyMs} ms more`)
  const q = await api('POST', `/db/v1/tables/${t}/query`, { semantic_search: 'asset alpha', indexes: ['text', 'visual'], limit: 3 })
  log(`cycle ${c}: hybrid query ${q.status}`)
  if (q.status !== 200) throw new Error(`cycle ${c} query ${q.status} ${JSON.stringify(q.json).slice(0, 300)}`)
  log(`cycle ${c}: drop ${(await api('DELETE', `/db/v1/tables/${t}`)).status}`)
}

const sem2Ms = await sem2Done
probing = false
await prober
const summary = {
  backfill: { docs: N, seconds: Math.round(backfillMs / 1000), docsPerSec: +(N / (backfillMs / 1000)).toFixed(1) },
  addLegToPopulated: { addStatus, workerStartedSec: Math.round(workerStartedMs / 1000), convergedSec: Math.round(sem2Ms / 1000), docsPerSec: +(N / (sem2Ms / 1000)).toFixed(1) },
  starvationCycles: { count: cycles.length, worstBuildMs: Math.max(...cycles.map((x) => x.buildMs)), worstReadyMs: Math.max(...cycles.map((x) => x.readyMs)) },
  probes: { count: probes.n, failures: probes.failures.length, failureSample: probes.failures.slice(0, 10), worstMs: Object.fromEntries(Object.entries(probes.worst).map(([k, v]) => [k, Math.round(v)])) },
  engineLog: join(root, 'engine.log'),
}
console.log('SUMMARY ' + JSON.stringify(summary, null, 2))
engine.kill('SIGTERM')
await sleep(2000)
process.exit(probes.failures.length === 0 ? 0 : 1)
