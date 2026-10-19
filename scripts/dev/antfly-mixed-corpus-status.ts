/**
 * Engine repin check: how does the engine report a MEDIA leg over a mixed
 * corpus (some docs without media_url)? Run it against the old and new pin and
 * compare — mapIndexStatuses must keep mapping the result `ready`.
 *   bun scripts/dev/antfly-mixed-corpus-status.ts <antfly-binary> <port> [<bakin-repo>]
 */
import { spawn } from 'child_process'
import { mkdirSync, mkdtempSync, openSync, realpathSync, symlinkSync, writeFileSync } from 'fs'
import { homedir, tmpdir } from 'os'
import { join } from 'path'
const binary = process.argv[2]!
const portArg = process.argv[3]!
const repo = process.argv[4] ?? join(import.meta.dir, '..', '..')
const { renderEngineConfig } = await import(`${repo}/packages/adapter-antfly/src/service`)
const sharp = (await import(Bun.resolveSync('sharp', repo))).default
const f = (Bun as unknown as { fetch: typeof fetch }).fetch
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const root = realpathSync(mkdtempSync(join(tmpdir(), 'mixed-')))
const media = join(root, 'media'); for (const d of ['data', 'models', 'media']) mkdirSync(join(root, d))
for (const o of ['BAAI', 'antflydb']) symlinkSync(join(homedir(), '.antfly', 'inference', 'models', o), join(root, 'models', o))
writeFileSync(join(root, 'e.json'), renderEngineConfig({ mediaRoots: [media] }))
const port = Number(portArg)
const engine = spawn(binary, ['standalone', '--host', '127.0.0.1', '--port', String(port), '--health-port', String(port + 1), '--config', join(root, 'e.json'), '--data-dir', join(root, 'data'), '--models-dir', join(root, 'models'), '--preload-model', 'embedder:antflydb/clipclap'], { stdio: ['ignore', openSync(join(root, 'e.log'), 'a'), openSync(join(root, 'e.log'), 'a')] })
process.on('exit', () => { try { engine.kill('SIGKILL') } catch { /* gone */ } })
const api = async (m: string, p: string, b?: unknown) => { const r = await f(`http://127.0.0.1:${port}${p}`, { method: m, headers: { 'content-type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) }); const t = await r.text(); try { return { s: r.status, j: JSON.parse(t) } } catch { return { s: r.status, j: t } } }
for (let i = 0; i < 120; i++) { try { if ((await api('GET', '/db/v1/status')).s === 200) break } catch { /* booting */ } await sleep(1000) }
await api('POST', '/db/v1/tables/mix', { num_shards: 1 }); await sleep(800)
await api('POST', '/db/v1/tables/mix/indexes/visual', { type: 'embeddings', template: '{{#if media_url}}{{remoteMedia url=media_url}}{{/if}}', dimension: 512, embedder: { provider: 'antfly', model: 'antflydb/clipclap' } })
await sleep(1200)
const inserts: Record<string, unknown> = {}
for (let k = 0; k < 20; k++) {
  if (k < 5) await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: k * 40, g: 90, b: 30 } } }).jpeg().toFile(join(media, `i${k}.jpg`))
  inserts[`a${k}`] = { title: `asset ${k}`, ...(k < 5 ? { media_url: `file://${join(media, `i${k}.jpg`)}` } : {}) }
}
console.log('write', (await api('POST', '/db/v1/tables/mix/batch', { inserts, sync_level: 'full_index' })).s)
let st: any
for (let i = 0; i < 60; i++) { st = ((await api('GET', '/db/v1/tables/mix/indexes')).j as any[]).find((e) => e.config.name === 'visual')?.status; if (st && !st.backfill_active && !st.rebuilding && st.total_indexed >= 5) break; await sleep(1000) }
console.log(JSON.stringify({ version: binary, total_indexed: st.total_indexed, backfill_state: st.backfill_state, readiness: st.readiness?.state, pending_reasons: st.readiness?.pending_reasons, coverage: { covered: st.coverage?.covered, skipped: st.coverage?.skipped, healthy: st.coverage?.healthy, degraded: st.coverage?.degraded }, worker_failed: st.enrichment_runtime?.worker_failed, fatal: st.enrichment_runtime?.fatal_error_count }))
process.exit(0)
