/**
 * Seed runtime session transcripts with usage data for the usage-history
 * scanner (#599 / #359).
 *
 * Generates `agents/<id>/sessions/<sessionId>.jsonl` files with dates
 * RELATIVE TO NOW spanning the last ~30 days, so all three Usage History
 * windows (24h / 7d / 30d) render populated. Line shape matches
 * `parseSessionUsageMessages` (src/core/agent-usage.ts): a `session` header
 * line, then assistant `message` lines carrying `message.usage`
 * {input, output, cacheRead, cacheWrite, totalTokens, cost?}.
 *
 * Deterministic: a fixed-seed LCG drives all variation so re-seeding
 * produces identical numbers — screenshots stay reproducible.
 */
import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

const DAY = 86_400_000
const HOUR = 3_600_000

// Small deterministic PRNG (LCG) — same numbers on every seed run.
function makeRng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0xffffffff
  }
}

interface SessionSpec {
  agent: string
  /** Session start, in days before now (fractional ok). */
  daysAgo: number
  model: string
  /** Assistant messages in the session. */
  messages: number
  /** Rough input tokens per message (varied ±40% by the rng). */
  inputScale: number
  /** ChatGPT-OAuth-style sessions report no cost — exercises the em-dash path. */
  withCost: boolean
}

// Coverage: every window has data, several models, one costless model,
// pixel is the heavy user, patch barely shows up.
const SESSIONS: SessionSpec[] = [
  // Today / last 24h
  { agent: 'main', daysAgo: 0.15, model: 'claude-sonnet-4-20250514', messages: 14, inputScale: 9000, withCost: true },
  { agent: 'pixel', daysAgo: 0.3, model: 'gpt-5.5', messages: 22, inputScale: 12000, withCost: false },
  { agent: 'rolo', daysAgo: 0.6, model: 'claude-haiku-4-5', messages: 9, inputScale: 3000, withCost: true },
  // This week
  { agent: 'main', daysAgo: 1.2, model: 'claude-sonnet-4-20250514', messages: 18, inputScale: 8000, withCost: true },
  { agent: 'pixel', daysAgo: 2.4, model: 'gpt-5.5', messages: 31, inputScale: 14000, withCost: false },
  { agent: 'jessica', daysAgo: 3.1, model: 'claude-sonnet-4-20250514', messages: 12, inputScale: 7000, withCost: true },
  { agent: 'pixel', daysAgo: 4.7, model: 'claude-haiku-4-5', messages: 26, inputScale: 2500, withCost: true },
  { agent: 'rolo', daysAgo: 5.5, model: 'claude-sonnet-4-20250514', messages: 8, inputScale: 6000, withCost: true },
  // This month
  { agent: 'main', daysAgo: 9, model: 'claude-sonnet-4-20250514', messages: 20, inputScale: 8500, withCost: true },
  { agent: 'jessica', daysAgo: 12, model: 'gpt-5.5', messages: 16, inputScale: 10000, withCost: false },
  { agent: 'pixel', daysAgo: 16, model: 'claude-sonnet-4-20250514', messages: 35, inputScale: 11000, withCost: true },
  { agent: 'rolo', daysAgo: 21, model: 'claude-haiku-4-5', messages: 11, inputScale: 2800, withCost: true },
  { agent: 'patch', daysAgo: 25, model: 'claude-haiku-4-5', messages: 4, inputScale: 2000, withCost: true },
  { agent: 'main', daysAgo: 28, model: 'claude-sonnet-4-20250514', messages: 15, inputScale: 7500, withCost: true },
]

// $/MTok rough rates per model family for plausible cost numbers.
const RATES: Record<string, { in: number; out: number; cacheRead: number }> = {
  'claude-sonnet-4-20250514': { in: 3, out: 15, cacheRead: 0.3 },
  'claude-haiku-4-5': { in: 1, out: 5, cacheRead: 0.1 },
  'gpt-5.5': { in: 2, out: 8, cacheRead: 0.2 },
}

const SNIPPETS = [
  'Drafted the outline and moved on to the supporting sections.',
  'Pulled the latest task board and summarized open items.',
  'Generated the requested variants; saving the best two as assets.',
  'Checked overnight runs — all green, one retry recovered cleanly.',
  'Updated the copy per the approval notes and re-queued the gate.',
]

export function seedUsageSessions(mockHome: string): void {
  const rng = makeRng(0xbacca)
  const now = Date.now()
  let files = 0

  for (const [i, spec] of SESSIONS.entries()) {
    const sessionId = `mock-${spec.agent}-${String(i + 1).padStart(3, '0')}`
    const startMs = now - spec.daysAgo * DAY
    const lines: string[] = [
      JSON.stringify({ type: 'session', id: sessionId, timestamp: new Date(startMs).toISOString() }),
    ]

    for (let m = 0; m < spec.messages; m++) {
      const ts = startMs + m * (2 + rng() * 10) * 60_000
      const vary = (base: number) => Math.round(base * (0.6 + rng() * 0.8))
      const input = vary(spec.inputScale)
      const output = vary(spec.inputScale / 8)
      const cacheRead = vary(spec.inputScale * 2)
      const cacheWrite = m === 0 ? vary(spec.inputScale) : 0
      const usage: Record<string, unknown> = {
        input, output, cacheRead, cacheWrite,
        totalTokens: input + output + cacheRead + cacheWrite,
      }
      if (spec.withCost) {
        const r = RATES[spec.model] ?? RATES['claude-haiku-4-5']
        const cost = {
          input: (input / 1e6) * r.in,
          output: (output / 1e6) * r.out,
          cacheRead: (cacheRead / 1e6) * r.cacheRead,
          cacheWrite: 0,
          total: 0,
        }
        cost.total = cost.input + cost.output + cost.cacheRead
        usage.cost = cost
      }
      lines.push(JSON.stringify({
        type: 'message',
        id: `msg-${sessionId}-${m}`,
        timestamp: new Date(ts).toISOString(),
        message: {
          role: 'assistant',
          model: spec.model,
          content: [{ type: 'text', text: SNIPPETS[m % SNIPPETS.length] }],
          usage,
        },
      }))
    }

    const dir = join(mockHome, 'agents', spec.agent, 'sessions')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, `${sessionId}.jsonl`), lines.join('\n') + '\n', 'utf-8')
    files++
  }

  console.log(`[seed] Usage session transcripts seeded (${files} sessions across 5 agents, 30 days)`)
}
