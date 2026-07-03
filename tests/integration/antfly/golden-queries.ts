/**
 * Golden-query relevance set for the measured tuning pass (T21) — a
 * synthetic-but-realistic corpus (image-like docs with captions/tags, text
 * notes, task-like docs) with expected-top-hit labels.
 *
 * Re-runnable: `bun tests/integration/antfly/tuning-run.ts` measures
 * hit@1/hit@3 + latency per fusion/weight/reranker config against a real
 * ephemeral engine. Results + decisions: .claude/knowledge/search-tuning.md
 */
import { deflateSync } from 'node:zlib'

export interface GoldenDoc {
  key: string
  title: string
  tags: string
  kind: 'image' | 'note' | 'task'
  /** Solid fill for generated corpus images (visual-leg signal). */
  color?: [number, number, number]
}

export interface GoldenQuery {
  q: string
  /** hit@1 target. */
  expected: string
  /** Additional acceptable keys for hit@3 scoring. */
  acceptable?: string[]
  category: 'caption' | 'semantic' | 'keyword' | 'visual' | 'conflict'
}

export const GOLDEN_CORPUS: GoldenDoc[] = [
  // Image-like docs — captions/tags carry semantics; pixels carry only color.
  { key: 'img-crimson', title: 'crimson swatch used for the brand palette refresh', tags: 'brand, palette, design', kind: 'image', color: [220, 20, 40] },
  { key: 'img-ocean', title: 'deep ocean water texture for the hero banner', tags: 'hero, banner, texture', kind: 'image', color: [10, 60, 200] },
  { key: 'img-forest', title: 'mossy forest floor macro shot', tags: 'nature, macro', kind: 'image', color: [20, 140, 50] },
  { key: 'img-sunset', title: 'warm sunset gradient over the marina', tags: 'gradient, warm', kind: 'image', color: [240, 140, 30] },
  { key: 'img-dashboard', title: 'dark mode dashboard mockup with revenue chart and sidebar navigation', tags: 'dashboard, mockup, dark-mode', kind: 'image', color: [40, 40, 48] },
  { key: 'img-cat', title: 'tabby cat sleeping on a beige couch', tags: 'pet, photo', kind: 'image', color: [160, 120, 90] },
  // Text notes.
  { key: 'note-standup', title: 'standup notes: shipping the billing migration on thursday', tags: 'meeting', kind: 'note' },
  { key: 'note-recipe', title: 'sourdough starter feeding schedule and hydration ratios', tags: 'kitchen', kind: 'note' },
  { key: 'note-runbook', title: 'deployment runbook: rolling restart, health checks, rollback steps', tags: 'ops', kind: 'note' },
  { key: 'note-onboarding', title: 'new agent onboarding checklist with workspace conventions', tags: 'process', kind: 'note' },
  { key: 'note-redteam', title: 'red team findings: prompt injection vectors in the mail pipeline', tags: 'security', kind: 'note' },
  { key: 'note-budget', title: 'quarterly infra budget: gpu spend up, storage flat', tags: 'finance', kind: 'note' },
  { key: 'note-piano', title: 'practice log: czerny etudes and voicing exercises', tags: 'music', kind: 'note' },
  { key: 'note-travel', title: 'kyoto itinerary: temples, kaiseki reservations, rail passes', tags: 'travel', kind: 'note' },
  // Task-like docs.
  { key: 'task-login', title: 'fix login redirect loop after session expiry', tags: 'bug, auth', kind: 'task' },
  { key: 'task-search', title: 'ship the global search overlay with keyboard navigation', tags: 'feature, ui', kind: 'task' },
  { key: 'task-backup', title: 'nightly database backup verification job', tags: 'ops, cron', kind: 'task' },
  { key: 'task-video', title: 'edit the product demo video voiceover', tags: 'content', kind: 'task' },
  { key: 'task-invoice', title: 'reconcile stripe invoices against the ledger', tags: 'finance', kind: 'task' },
  { key: 'task-a11y', title: 'audit color contrast for accessibility compliance', tags: 'ui, accessibility', kind: 'task' },
]

export const GOLDEN_QUERIES: GoldenQuery[] = [
  // caption: exact-ish wording present in one doc
  { q: 'dark mode dashboard mockup', expected: 'img-dashboard', category: 'caption' },
  { q: 'sourdough hydration ratios', expected: 'note-recipe', category: 'caption' },
  { q: 'rolling restart rollback steps', expected: 'note-runbook', category: 'caption' },
  { q: 'login redirect loop', expected: 'task-login', category: 'caption' },
  { q: 'stripe invoice reconciliation', expected: 'task-invoice', category: 'caption' },
  // semantic: no shared keywords, meaning must carry
  { q: 'picture of a sleeping pet', expected: 'img-cat', category: 'semantic' },
  { q: 'how much are we spending on compute', expected: 'note-budget', acceptable: ['task-invoice'], category: 'semantic' },
  { q: 'security vulnerabilities found in email handling', expected: 'note-redteam', category: 'semantic' },
  { q: 'japan trip planning', expected: 'note-travel', category: 'semantic' },
  { q: 'keyboard shortcuts for finding things anywhere', expected: 'task-search', category: 'semantic' },
  { q: 'making bread at home', expected: 'note-recipe', category: 'semantic' },
  // keyword: short, term-y
  { q: 'czerny', expected: 'note-piano', category: 'keyword' },
  { q: 'kaiseki', expected: 'note-travel', category: 'keyword' },
  { q: 'accessibility contrast', expected: 'task-a11y', category: 'keyword' },
  // visual: color words ABSENT from the expected doc's caption/tags —
  // only the pixels (visual leg) can rank it first
  { q: 'a solid red image', expected: 'img-crimson', category: 'visual' },
  { q: 'blue background picture', expected: 'img-ocean', acceptable: ['img-sunset'], category: 'visual' },
  { q: 'green photo', expected: 'img-forest', category: 'visual' },
  // conflict: a text doc mentions the color word; the pixels disagree
  { q: 'red colored graphic', expected: 'img-crimson', acceptable: ['note-redteam'], category: 'conflict' },
]

// ---------------------------------------------------------------------------
// Minimal PNG encoder — solid-color 16x16 RGB, no dependencies. CLIP scales
// everything to 224x224, so a swatch is a legitimate color-only signal.
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

export function solidPng([r, g, b]: [number, number, number], size = 16): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(size * 3)])
  for (let x = 0; x < size; x++) {
    row[1 + x * 3] = r
    row[2 + x * 3] = g
    row[3 + x * 3] = b
  }
  const raw = Buffer.concat(Array.from({ length: size }, () => row))
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---------------------------------------------------------------------------
// Scoring helpers
// ---------------------------------------------------------------------------

export interface QueryOutcome {
  q: string
  category: GoldenQuery['category']
  rankOfExpected: number | null
  hit1: boolean
  hit3: boolean
  latencyMs: number
}

export function scoreOutcome(query: GoldenQuery, resultKeys: string[], latencyMs: number): QueryOutcome {
  const okSet = new Set([query.expected, ...(query.acceptable ?? [])])
  const rank = resultKeys.indexOf(query.expected)
  const top3 = resultKeys.slice(0, 3)
  return {
    q: query.q,
    category: query.category,
    rankOfExpected: rank === -1 ? null : rank + 1,
    hit1: resultKeys[0] !== undefined && okSet.has(resultKeys[0]),
    hit3: top3.some((k) => okSet.has(k)),
    latencyMs,
  }
}

export interface ConfigSummary {
  config: string
  hit1: number
  hit3: number
  byCategory: Record<string, { hit1: number; hit3: number; n: number }>
  meanLatencyMs: number
}

export function summarize(config: string, outcomes: QueryOutcome[]): ConfigSummary {
  const byCategory: ConfigSummary['byCategory'] = {}
  for (const outcome of outcomes) {
    const bucket = byCategory[outcome.category] ?? { hit1: 0, hit3: 0, n: 0 }
    bucket.n += 1
    if (outcome.hit1) bucket.hit1 += 1
    if (outcome.hit3) bucket.hit3 += 1
    byCategory[outcome.category] = bucket
  }
  return {
    config,
    hit1: outcomes.filter((o) => o.hit1).length / outcomes.length,
    hit3: outcomes.filter((o) => o.hit3).length / outcomes.length,
    byCategory,
    meanLatencyMs: outcomes.reduce((sum, o) => sum + o.latencyMs, 0) / outcomes.length,
  }
}
