/**
 * T21 tuning runner — MANUALLY INVOKED, not part of `bun run test`:
 *
 *   bun tests/integration/antfly/tuning-run.ts
 *
 * Spawns a real ephemeral engine (dev binary + local models), indexes the
 * golden corpus into an assets-shaped table (text + media legs), then
 * measures hit@1/hit@3 + latency per config: RRF vs RSF fusion, media-leg
 * weight sweep, and the reranker on top-10 candidates. Prints a markdown
 * table for .claude/knowledge/search-tuning.md.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { AntflySearchClient } from '../../../packages/adapter-antfly/src/client'
import { DEFAULT_SETTINGS, type AntflySettings } from '../../../packages/adapter-antfly/src/defaults'
import { resolveAntflyBinary, spawnEphemeralAntfly } from '../search-conformance/harness'
import {
  GOLDEN_CORPUS,
  GOLDEN_QUERIES,
  solidPng,
  scoreOutcome,
  summarize,
  type ConfigSummary,
  type QueryOutcome,
} from './golden-queries'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const TABLE = 'golden_assets'
const SEARCHABLE = ['title', 'tags_text']

interface RunConfig {
  name: string
  fusion: 'rrf' | 'rsf'
  weights: { g_text: number; g_vis: number }
  rerank?: boolean
}

const CONFIGS: RunConfig[] = [
  { name: 'rrf t0.5/v2 (current defaults)', fusion: 'rrf', weights: { g_text: 0.5, g_vis: 2 } },
  { name: 'rrf t1/v1', fusion: 'rrf', weights: { g_text: 1, g_vis: 1 } },
  { name: 'rrf t0.5/v3', fusion: 'rrf', weights: { g_text: 0.5, g_vis: 3 } },
  { name: 'rrf t1/v2', fusion: 'rrf', weights: { g_text: 1, g_vis: 2 } },
  { name: 'rsf t0.5/v2', fusion: 'rsf', weights: { g_text: 0.5, g_vis: 2 } },
  { name: 'rsf t1/v1', fusion: 'rsf', weights: { g_text: 1, g_vis: 1 } },
]

function clientFor(url: string, fusion: 'rrf' | 'rsf'): AntflySearchClient {
  const settings: AntflySettings = {
    ...DEFAULT_SETTINGS,
    url,
    search: { ...DEFAULT_SETTINGS.search, fusionStrategy: fusion },
  }
  return new AntflySearchClient(settings)
}

async function main() {
  const binary = resolveAntflyBinary()
  if (!binary) throw new Error('no antfly binary — build the dev worktree first (evidence file P0.1)')
  console.log(`engine: ${binary}`)
  const instance = await spawnEphemeralAntfly(binary, {
    modelOwners: ['BAAI', 'antflydb', 'mixedbread-ai'],
    preloadModels: ['embedder:BAAI/bge-small-en-v1.5', 'embedder:antflydb/clipclap'],
  })
  const imagesDir = join(instance.root, 'corpus-images')
  mkdirSync(imagesDir, { recursive: true })

  try {
    const setup = clientFor(instance.url, 'rrf')
    await setup.tables.create(TABLE, {
      fields: { title: { type: 'text' }, tags_text: { type: 'text' }, kind: { type: 'keyword' } },
      legs: [
        { name: 'full_text', capability: 'full-text', fields: SEARCHABLE },
        { name: 'g_text', capability: 'text-embedding', fields: SEARCHABLE },
        { name: 'g_vis', capability: 'media-embedding', fields: [], mediaUrlField: 'media_url' },
      ],
    })
    await sleep(1200)

    const items = GOLDEN_CORPUS.map((doc) => {
      let media_url: string | undefined
      if (doc.color) {
        const file = join(imagesDir, `${doc.key}.png`)
        writeFileSync(file, solidPng(doc.color))
        media_url = `file://${file}`
      }
      return { key: doc.key, doc: { title: doc.title, tags_text: doc.tags, kind: doc.kind, ...(media_url ? { media_url } : {}) } }
    })
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        await setup.documents.batchIndex(TABLE, items)
        break
      } catch {
        await sleep(600)
      }
    }

    // wait for every leg (incl. clipclap embeds) to be ready
    const deadline = Date.now() + 240_000
    for (;;) {
      const legs = await setup.tables.health(TABLE).catch(() => [])
      const ready = legs.length > 0 && legs.every((l) => l.state === 'ready')
        && (legs.find((l) => l.leg === 'g_vis')?.indexedCount ?? 0) >= GOLDEN_CORPUS.filter((d) => d.color).length
      if (ready) break
      if (Date.now() > deadline) {
        console.log('leg state at timeout:', JSON.stringify(legs))
        throw new Error('legs never converged')
      }
      await sleep(1000)
    }
    console.log('corpus indexed + converged\n')

    const summaries: ConfigSummary[] = []
    for (const config of CONFIGS) {
      const client = clientFor(instance.url, config.fusion)
      const outcomes: QueryOutcome[] = []
      for (const query of GOLDEN_QUERIES) {
        const t0 = Date.now()
        const result = await client.query(TABLE, {
          text: query.q,
          limit: 10,
          adapterOptions: {
            searchableFields: SEARCHABLE,
            indexes: ['g_text', 'g_vis'],
            indexWeights: config.weights,
          },
        })
        outcomes.push(scoreOutcome(query, result.hits.map((h) => h.key), Date.now() - t0))
      }
      summaries.push(summarize(config.name, outcomes))
      console.log(`done: ${config.name}`)
    }

    // Reranker pass on the current-default config, rerank top-10 by title.
    let rerankSummary: ConfigSummary | null = null
    let rerankError: string | null = null
    try {
      const client = clientFor(instance.url, 'rrf')
      const outcomes: QueryOutcome[] = []
      for (const query of GOLDEN_QUERIES) {
        const t0 = Date.now()
        const result = await client.query(TABLE, {
          text: query.q,
          limit: 10,
          rerank: true,
          adapterOptions: {
            searchableFields: SEARCHABLE,
            indexes: ['g_text', 'g_vis'],
            indexWeights: { g_text: 0.5, g_vis: 2 },
            rerankField: 'title',
          },
        })
        outcomes.push(scoreOutcome(query, result.hits.map((h) => h.key), Date.now() - t0))
      }
      rerankSummary = summarize('rrf t0.5/v2 + rerank@10(title)', outcomes)
    } catch (err) {
      rerankError = err instanceof Error ? err.message : String(err)
    }

    // ---- report ----
    const rows = [...summaries, ...(rerankSummary ? [rerankSummary] : [])]
    const pct = (v: number) => `${Math.round(v * 100)}%`
    console.log('\n| config | hit@1 | hit@3 | visual h@1 | semantic h@1 | mean ms |')
    console.log('|---|---|---|---|---|---|')
    for (const row of rows) {
      const vis = row.byCategory.visual ?? { hit1: 0, n: 1 }
      const sem = row.byCategory.semantic ?? { hit1: 0, n: 1 }
      console.log(`| ${row.config} | ${pct(row.hit1)} | ${pct(row.hit3)} | ${vis.hit1}/${vis.n} | ${sem.hit1}/${sem.n} | ${Math.round(row.meanLatencyMs)} |`)
    }
    if (rerankError) console.log(`\nreranker: FAILED — ${rerankError}`)
    console.log('\nper-category detail (json):')
    console.log(JSON.stringify(rows, null, 1))
  } finally {
    await instance.stop()
  }
}

await main()
